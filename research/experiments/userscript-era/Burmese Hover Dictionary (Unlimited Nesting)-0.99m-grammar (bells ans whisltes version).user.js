// ==UserScript==
// @name         Burmese Hover Dictionary (Unlimited Nesting)
// @namespace    http://tampermonkey.net/
// @version      0.99m-grammar
// @description  Unlimited nested dictionary popups + POS grammar overlay
// @match        http*://*/*
// @match        file://*/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// ==/UserScript==

(function () {
    'use strict';

    const API_URL = 'http://127.0.0.1:5000/lookup';
    const SUBSEG_API_URL = 'http://127.0.0.1:5000/subsegments';

    // ADDED: Simple in-memory cache for lookups (reduces server load dramatically)
    const lookupCache = new Map();
    const CACHE_MAX_SIZE = 500;
    const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

    // ------------------------------------------------------------------
    // POS COLOURING / GRAMMAR OVERLAY (UI SIDE)
    // ------------------------------------------------------------------

    // Coarse tag set – must match server-side tags
    const COARSE_POS_TAGS = new Set([
        'adj', 'adv', 'conj', 'exp', 'int', 'kjano',
        'n', 'part', 'pos', 'ppm', 'pron', 'v'
    ]);

    // Base RGB colours per coarse POS (tweak to taste)
    const POS_COLOUR_RGB = {
        n:     [56, 142,  60],   // green
        v:     [25, 118, 210],   // blue
        adj:   [156, 39, 176],   // purple
        adv:   [255, 143,  0],   // orange
        pron:  [0, 121, 107],    // teal
        conj:  [121, 85,  72],   // brown
        part:  [233, 30,  99],   // pink
        ppm:   [63,  81, 181],   // indigo
        pos:   [0,  150, 136],   // cyan-ish
        exp:   [120,120,120],    // grey
        int:   [244, 81,  30],   // red
        kjano: [255, 193,  7],   // yellow
    };

    // JS clone of _coarse_pos_tag from the server
    function coarsePosTag(raw) {
        let p = (raw || '').trim().toLowerCase();
        if (!p) return '';

        if (p.startsWith('adj')) return 'adj';
        if (p.startsWith('adv')) return 'adv';
        if (p.startsWith('pron')) return 'pron';
        if (p.startsWith('conj')) return 'conj';
        if (p.startsWith('exp')) return 'exp';
        if (p.startsWith('int') || p.startsWith('interj')) return 'int';
        if (p.startsWith('pos')) return 'pos';

        if (p.startsWith('kjano') || p.startsWith('num') || p === 'm' || p === 'nm') return 'kjano';

        if (p.startsWith('ppm') || p.startsWith('postp') || p.startsWith('prep')) return 'ppm';

        if (p.startsWith('part') || p.startsWith('particle')) return 'part';

        if (p.startsWith('n')) return 'n';

        if (p.startsWith('v') || p.startsWith('aux')) return 'v';

        return COARSE_POS_TAGS.has(p) ? p : '';
    }

    // MODIFIED: Apply colour to POS text (not background blob) with intensity based on confidence
    function applyPosCellStyle(el, tag, confidence) {
        const rgb = POS_COLOUR_RGB[tag];
        if (!rgb) return;

        // Clamp confidence
        const c = Math.max(0, Math.min(1, Number(confidence) || 0));
        const pct = Math.round(c * 100);

        const [r, g, b] = rgb;

        // CHANGED: Color intensity based on confidence (0.35 min to 1.0 max)
        const colorAlpha = 0.35 + 0.65 * c;

        // CHANGED: Style the text itself, not background
        el.style.color = `rgba(${r},${g},${b},${colorAlpha})`;
        el.style.fontSize = '13px';        // Larger than default 11px
        el.style.fontWeight = '600';       // Bold to make it stand out
        el.style.backgroundColor = 'transparent';
        el.style.border = 'none';
        el.style.borderRadius = '0';
        el.style.padding = '0';
        el.style.display = 'inline-block';

        // ADDED: Store confidence for custom instant tooltip
        el.setAttribute('data-pos-confidence', pct);
    }

    // Use segments + pos_overlay to colour POS cells in a given popup/container
    function applyPosOverlayToPopup(container, data) {
        if (!data || !data.pos_overlay || !Array.isArray(data.pos_overlay.tokens)) return;
        if (!Array.isArray(data.segments) || !data.segments.length) return;

        const tokens = data.pos_overlay.tokens;
        const segs   = data.segments;
        const n      = Math.min(tokens.length, segs.length);
        if (!n) return;

        // Build map: surface token text -> best tag + confidence (keep strongest if dup)
        const map = new Map();
        for (let i = 0; i < n; i++) {
            const surf = (segs[i] || '').trim();
            const info = tokens[i] || {};
            const tag  = info.best_pos || '';
            const conf = Number(info.confidence) || 0;
            if (!surf || !tag) continue;

            const existing = map.get(surf);
            if (!existing || conf > existing.confidence) {
                map.set(surf, { tag, confidence: conf });
            }
        }

        if (!map.size) return;

        // For each card: look up the headword in the map, then colour matching POS cells
        const cards = container.querySelectorAll('.bh-entry-card, .bh-entry-card-secondary');
        cards.forEach(card => {
            const head = (card.getAttribute('data-head') || '').trim();
            if (!head) return;

            const info = map.get(head);
            if (!info || !info.tag) return;

            const coarseBest = info.tag;

            const cells = card.querySelectorAll('.bh-pos-cell');
            cells.forEach(cell => {
                const rawPos = cell.getAttribute('data-pos-raw') || '';
                const coarse = coarsePosTag(rawPos);
                if (!coarse) return;

                if (coarse === coarseBest) {
                    applyPosCellStyle(cell, coarseBest, info.confidence);
                } else {
                    // MODIFIED: Non-selected POS: gray out instead of just opacity
                    cell.style.color = '#aaa';
                    cell.style.opacity = '0.6';
                }
            });
        });
    }

    // ADDED: Track all nested popups for unlimited nesting
    const nestedPopups = [];
    const BASE_Z_INDEX = 1000001;

    function isMyanmarChar(ch) {
        if (!ch) return false;
        const code = ch.charCodeAt(0);
        return code >= 0x1000 && code <= 0x109F;
    }

    // Rough Myanmar combining mark check (for building grapheme-ish clusters)
    function isMyanmarCombining(ch) {
        if (!ch) return false;
        const code = ch.charCodeAt(0);
        // main combining range + viramas/medials
        if (code >= 0x102B && code <= 0x103E) return true;
        if (code >= 0x1050 && code <= 0x1059) return true;
        if (code === 0x1039 || code === 0x103A) return true;
        // ADDED: Additional marks
        if (code === 0x1036 || code === 0x1038) return true;
        return false;
    }

    // Return Burmese grapheme-ish clusters as an array
    function splitMyanmarClusters(s) {
        const clusters = [];
        let current = '';

        for (const ch of s) {
            if (isMyanmarChar(ch) && !isMyanmarCombining(ch)) {
                if (current) clusters.push(current);
                current = ch;
            } else if (isMyanmarCombining(ch) && current) {
                current += ch;
            } else {
                if (current) {
                    clusters.push(current);
                    current = '';
                }
                // keep non-Myanmar or stray as separate chunk if you want it visible
                clusters.push(ch);
            }
        }
        if (current) clusters.push(current);
        return clusters;
    }

    // For "Spelling:" display
    function phoneticBreakdown(s) {
        return splitMyanmarClusters(s).join(' · ');
    }

    // --- G2P (pronunciation) UI layer ------------------------------------
    let currentG2P = null;

    // Small popup for per-syllable breakdown
    const syllPopup = document.createElement('div');
    syllPopup.id = 'burmese-hover-syll-popup';
    Object.assign(syllPopup.style, {
        position: 'absolute',
        zIndex: '1000002',
        background: 'white',
        border: '1px solid #aaa',
        borderRadius: '4px',
        padding: '6px 8px',
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
        fontSize: '12px',
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        maxWidth: '260px',
        maxHeight: '60vh',
        overflowY: 'auto',
        display: 'none'
    });
    document.body.appendChild(syllPopup);

    // ADDED: Custom instant tooltip for POS confidence and rarity
    const instantTooltip = document.createElement('div');
    instantTooltip.id = 'burmese-hover-instant-tooltip';
    Object.assign(instantTooltip.style, {
        position: 'absolute',
        zIndex: '1000003',
        background: 'rgba(0,0,0,0.8)',
        color: 'white',
        borderRadius: '4px',
        padding: '4px 8px',
        fontSize: '11px',
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        pointerEvents: 'none',
        display: 'none',
        whiteSpace: 'nowrap'
    });
    document.body.appendChild(instantTooltip);

    // ADDED: Helper to check if G2P syllable is valid (not garbage)
    function isValidG2PSyllable(syl) {
        if (!syl) return false;
        const orth = syl.orth || '';
        const roman = syl.roman || '';

        // If no roman, it's not useful
        if (!roman || !roman.trim()) return false;

        // If roman is just the orth repeated (G2P failed), skip it
        if (roman.trim() === orth.trim()) return false;

        // If orth contains no Myanmar chars, it's garbage
        if (![...orth].some(isMyanmarChar)) return false;

        return true;
    }

    // ADDED: Group G2P syllables by segments
    function groupSyllablesBySegments(syllables, segments) {
        if (!syllables || !syllables.length) return [];
        if (!segments || !segments.length) {
            // No segments, return all syllables as one group
            return [syllables.filter(isValidG2PSyllable)];
        }

        const groups = [];
        let syllIdx = 0;

        for (const seg of segments) {
            const group = [];
            let accum = '';
            const segNorm = seg.replace(/\s/g, '');

            while (syllIdx < syllables.length) {
                const syl = syllables[syllIdx];
                const orth = (syl.orth || '').replace(/\s/g, '');

                // Check if adding this syllable would exceed segment length
                if (accum.length >= segNorm.length) break;

                if (isValidG2PSyllable(syl)) {
                    group.push(syl);
                }
                accum += orth;
                syllIdx++;

                // If we've matched the segment, move on
                if (accum.length >= segNorm.length) break;
            }

            if (group.length > 0) {
                groups.push(group);
            }
        }

        // Any remaining valid syllables
        const remaining = syllables.slice(syllIdx).filter(isValidG2PSyllable);
        if (remaining.length > 0) {
            groups.push(remaining);
        }

        return groups;
    }

    // MODIFIED: Build G2P layer with syllables grouped by segments, handling unknown pronunciations
    function buildG2PLayerHtml(g2p, segments) {
        if (!g2p || !Array.isArray(g2p.syllables)) {
            return '';
        }

        // Build mapping of which segments have valid G2P
        const segmentG2PMap = new Map(); // segment -> array of valid syllables

        if (segments && segments.length) {
            let syllIdx = 0;
            for (const seg of segments) {
                const group = [];
                let accum = '';
                const segNorm = seg.replace(/\s/g, '');

                while (syllIdx < g2p.syllables.length) {
                    const syl = g2p.syllables[syllIdx];
                    const orth = (syl.orth || '').replace(/\s/g, '');

                    if (accum.length >= segNorm.length) break;

                    if (isValidG2PSyllable(syl)) {
                        group.push(syl);
                    }
                    accum += orth;
                    syllIdx++;

                    if (accum.length >= segNorm.length) break;
                }

                segmentG2PMap.set(seg, group);
            }
        }

        const overall = g2p.overall_roman || '';

        let h = '<div class="bh-g2p-layer" ' +
                'style="padding:4px 8px 6px 8px;border-bottom:1px solid #eee;' +
                'background:#fafafa;font-size:12px;line-height:1.5;text-align:center;">';

        if (overall) {
            h += '<div class="bh-g2p-overall" style="text-align:center;">' +
                 '<span style="font-weight:600;margin-right:4px;">Pronunciation:</span>' +
                 '<span class="bh-g2p-roman" style="font-style:italic;color:#444;">' +
                 overall +
                 '</span></div>';
        }

        // Render syllables grouped by segment with spacing between groups
        h += '<div class="bh-g2p-syllables" ' +
             'style="margin-top:3px;display:flex;flex-wrap:wrap;gap:0;justify-content:center;align-items:center;">';

        let globalIdx = 0;
        let groupIdx = 0;

        if (segments && segments.length) {
            for (const seg of segments) {
                // Add spacing between groups (word boundaries)
                if (groupIdx > 0) {
                    h += '<span style="width:10px;display:inline-block;"></span>';
                }

                const group = segmentG2PMap.get(seg) || [];

                if (group.length === 0) {
                    // No valid G2P for this segment - show token in red only
                    h += '<span class="bh-g2p-syll bh-g2p-unknown" ' +
                         'style="padding:2px 4px;border-radius:3px;border:1px solid #fca5a5;' +
                         'cursor:default;background:#fef2f2;margin:0;color:#ef4444;font-weight:600;">' +
                         seg +
                         '</span>';
                } else {
                    // Render syllables within group flush (no margin)
                    group.forEach((syl, sylIdx) => {
                        const orth = syl.orth || '';
                        const roman = syl.roman || '';
                        // MODIFIED: margin:0 for flush rendering, border-radius only on edges
                        const isFirst = sylIdx === 0;
                        const isLast = sylIdx === group.length - 1;
                        const borderRadius = isFirst && isLast ? '3px' :
                                            isFirst ? '3px 0 0 3px' :
                                            isLast ? '0 3px 3px 0' : '0';
                        const borderRight = isLast ? '1px solid #ddd' : 'none';

                        h += '<span class="bh-g2p-syll" data-syll-idx="' + globalIdx + '" ' +
                             'style="padding:2px 4px;border-radius:' + borderRadius + ';' +
                             'border:1px solid #ddd;border-right:' + borderRight + ';' +
                             'cursor:default;background:white;margin:0;">' +
                             '<span class="bh-g2p-syll-orth" style="font-weight:600;">' + orth + '</span>';
                        if (roman) {
                            h += '<span class="bh-g2p-syll-roman" ' +
                                 'style="margin-left:3px;font-style:italic;color:#666;">' +
                                 roman +
                                 '</span>';
                        }
                        h += '</span>';
                        globalIdx++;
                    });
                }
                groupIdx++;
            }
        } else {
            // No segments, render all valid syllables as one group
            const validSylls = g2p.syllables.filter(isValidG2PSyllable);
            validSylls.forEach((syl, sylIdx) => {
                const orth = syl.orth || '';
                const roman = syl.roman || '';
                const isFirst = sylIdx === 0;
                const isLast = sylIdx === validSylls.length - 1;
                const borderRadius = isFirst && isLast ? '3px' :
                                    isFirst ? '3px 0 0 3px' :
                                    isLast ? '0 3px 3px 0' : '0';
                const borderRight = isLast ? '1px solid #ddd' : 'none';

                h += '<span class="bh-g2p-syll" data-syll-idx="' + globalIdx + '" ' +
                     'style="padding:2px 4px;border-radius:' + borderRadius + ';' +
                     'border:1px solid #ddd;border-right:' + borderRight + ';' +
                     'cursor:default;background:white;margin:0;">' +
                     '<span class="bh-g2p-syll-orth" style="font-weight:600;">' + orth + '</span>';
                if (roman) {
                    h += '<span class="bh-g2p-syll-roman" ' +
                         'style="margin-left:3px;font-style:italic;color:#666;">' +
                         roman +
                         '</span>';
                }
                h += '</span>';
                globalIdx++;
            });
        }

        h += '</div></div>';
        return h;
    }

    function showSyllablePopup(info, anchorEl) {
        if (!info) return;

        let ih = '<div class="bh-syll-title" style="margin-bottom:4px;">' +
                 '<span style="font-weight:bold;font-size:13px;">' +
                 (info.orth || '') +
                 '</span>';
        if (info.roman) {
            ih += ' <span style="margin-left:4px;font-style:italic;color:#555;">' +
                  info.roman +
                  '</span>';
        }
        ih += '</div><ul class="bh-syll-parts" style="margin:0;padding-left:16px;">';

        function addPart(label, item) {
            if (!item) return;
            const ch = item.ch || '';
            const rom = item.roman || '';
            const lab = item.label || '';
            ih += '<li><b>' + label + ':</b> ' + ch;
            if (rom) ih += ' (' + rom + ')';
            if (lab) ih += ' — ' + lab;
            ih += '</li>';
        }

        addPart('Base consonant', info.base);

        if (Array.isArray(info.medials)) {
            info.medials.forEach(m => addPart('Medial', m));
        }
        if (Array.isArray(info.vowels)) {
            info.vowels.forEach(v => addPart('Vowel sign', v));
        }
        if (Array.isArray(info.finals)) {
            info.finals.forEach(f => addPart('Final', f));
        }
        if (Array.isArray(info.marks)) {
            info.marks.forEach(mk => addPart('Mark', mk));
        }

        ih += '</ul>';

        syllPopup.innerHTML = ih;

        const rect = anchorEl.getBoundingClientRect();
        const x = rect.left + window.scrollX;
        const y = rect.bottom + 4 + window.scrollY;

        syllPopup.style.left = x + 'px';
        syllPopup.style.top = y + 'px';
        syllPopup.style.display = 'block';
    }

    function attachG2PHandlers(container, g2pData) {
        if (!g2pData ||
            !Array.isArray(g2pData.syllables) ||
            !g2pData.syllables.length) {
            return;
        }

        // Build flat array of valid syllables for index lookup
        const validSyllables = g2pData.syllables.filter(isValidG2PSyllable);

        const spans = container.querySelectorAll('.bh-g2p-syll');
        spans.forEach((span, idx) => {
            // CHANGED: Use hover only (mouseenter/mouseleave), no click
            span.addEventListener('mouseenter', (e) => {
                const info = validSyllables[idx];
                if (info) {
                    showSyllablePopup(info, span);
                }
            });
            span.addEventListener('mouseleave', () => {
                syllPopup.style.display = 'none';
            });
        });
    }

    // Count Burmese chars in a string (for "weak match" heuristic)
    function burmeseLength(s) {
        let n = 0;
        for (const ch of s) {
            if (isMyanmarChar(ch)) n++;
        }
        return n;
    }

    // FIXED: More robust hierarchical tab-delimited sense parser
    function renderSenseLines(senses) {
        if (!senses || !senses.length) return '';

        // CSS Grid with 4 columns: headword | roman | POS | sense
        let html = '<div style="display:grid;grid-template-columns:auto auto auto 1fr;gap:0 12px;align-items:start;font-size:12px;line-height:1.8;">';

        for (const line of senses) {
            // ADDED: Skip empty lines
            if (!line || !line.trim()) continue;

            // Count leading tabs
            let tabCount = 0;
            for (const ch of line) {
                if (ch === '\t') tabCount++;
                else break;
            }

            const content = line.substring(tabCount);

            // ADDED: Skip if content is empty
            if (!content || !content.trim()) continue;

            if (tabCount === 0) {
                // headword\troman\tpos\tsense
                const parts = content.split('\t');
                if (parts.length >= 4) {
                    const [headword, roman, pos, ...senseParts] = parts;
                    const sense = senseParts.join('\t');

                    html += `<div class="bh-headword" style="font-weight:bold;font-size:13px;">${headword || ''}</div>`;
                    html += `<div style="font-style:italic;color:#666;">${roman || ''}</div>`;
                    html += `<div class="bh-pos-cell"
                                  data-pos-raw="${pos || ''}"
                                  style="color:#888;font-size:11px;">[${pos || ''}]</div>`;
                    html += `<div class="bh-sense-text" style="color:#333;">${sense || ''}</div>`;
                } else {
                    // ADDED: Handle malformed lines with < 4 parts
                    console.warn('[BurmeseDict] Malformed line (tabCount=0):', line);
                }
            } else if (tabCount === 2) {
                // \t\tpos\tsense (new POS under same roman)
                const parts = content.split('\t');
                if (parts.length >= 2) {
                    const [pos, ...senseParts] = parts;
                    const sense = senseParts.join('\t');

                    html += `<div></div><div></div>`;  // Empty cols 1 & 2
                    html += `<div class="bh-pos-cell"
                                  data-pos-raw="${pos || ''}"
                                  style="color:#888;font-size:11px;">[${pos || ''}]</div>`;
                    html += `<div class="bh-sense-text" style="color:#333;">${sense || ''}</div>`;
                } else {
                    // ADDED: Handle malformed lines
                    console.warn('[BurmeseDict] Malformed line (tabCount=2):', line);
                }
            } else if (tabCount === 3) {
                // \t\t\tsense (continuation)
                const sense = content.trim();

                html += `<div></div><div></div><div></div>`;  // Empty cols 1, 2, 3
                html += `<div class="bh-sense-text" style="color:#333;">${sense || ''}</div>`;
            } else {
                // ADDED: Handle unexpected tab counts
                console.warn('[BurmeseDict] Unexpected tab count:', tabCount, 'in line:', line);
                // Try to render it anyway as a continuation sense
                const sense = content.trim();
                if (sense) {
                    html += `<div></div><div></div><div></div>`;
                    html += `<div class="bh-sense-text" style="color:#333;">${sense}</div>`;
                }
            }
        }

        html += '</div>';
        return html;
    }

    // ---- helper: is this node inside an editable/input area? ----
    function isInEditable(node) {
        let el = (node.nodeType === 1) ? node : node.parentNode;
        while (el && el !== document.body) {
            if (el.isContentEditable) return true;
            const tag = el.tagName;
            if (tag === 'TEXTAREA' || tag === 'INPUT') return true;
            el = el.parentNode;
        }
        return false;
    }

    // ---- single sticky popup ----
    const popup = document.createElement('div');
    popup.id = 'burmese-hover-popup';
    Object.assign(popup.style, {
        position: 'fixed',
        zIndex: '999999',
        background: 'white',
        border: '1px solid #888',
        borderRadius: '4px',
        padding: '0',
        boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
        fontSize: '13px',
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        maxWidth: '90vw',
        maxHeight: '80vh',   // NEW: cap height
        height: 'auto',      // NEW: let content determine height
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        display: 'none',
        flexDirection: 'column'
    });

    document.body.appendChild(popup);

    // NEW: inner tooltip popup for components (popup-within-popup on hover)
    const innerPopup = document.createElement('div');
    innerPopup.id = 'burmese-hover-inner-popup';
    Object.assign(innerPopup.style, {
        position: 'absolute',
        zIndex: '1000000',
        background: 'white',
        border: '1px solid #aaa',
        borderRadius: '4px',
        padding: '4px 6px',
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
        fontSize: '12px',
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        maxWidth: '90vw',
        maxHeight: '60vh',
        overflowY: 'auto',
        display: 'none',
        pointerEvents: 'none'
    });
    document.body.appendChild(innerPopup);

    // CHANGED: Function to create nested popups dynamically (replaces single breakdownPopup)
    function createNestedPopup() {
        const nestedPopup = document.createElement('div');
        nestedPopup.className = 'burmese-hover-nested-popup';
        const zIndex = BASE_Z_INDEX + nestedPopups.length;

        Object.assign(nestedPopup.style, {
            position: 'fixed',
            zIndex: zIndex.toString(),
            background: 'white',
            border: '1px solid #aaa',
            borderRadius: '4px',
            padding: '8px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            fontSize: '12px',
            fontFamily: 'Segoe UI, system-ui, sans-serif',
            maxWidth: '90vw',
            maxHeight: '60vh',
            overflowY: 'auto',
            display: 'none',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)'
        });

        document.body.appendChild(nestedPopup);

        // Keep clicks/scrolls inside popup from closing it
        nestedPopup.addEventListener('mousedown', (e) => e.stopPropagation(), true);
        nestedPopup.addEventListener('click', (e) => e.stopPropagation(), true);
        nestedPopup.addEventListener('wheel', (e) => e.stopPropagation(), { capture: true, passive: true });

        return nestedPopup;
    }

    // NEW: shared helper to fit popup width to its card container, capped at a fraction of viewport width
    function adjustPopupToContent(popupEl, containerSelector, maxVwFraction) {
        const container = popupEl.querySelector(containerSelector);
        if (!container) return;

        const maxWidthPx = window.innerWidth * maxVwFraction;

        // Reset to natural size first so the browser can shrink-wrap
        popupEl.style.width = 'auto';
        container.style.overflowX = 'auto';

        // Wait a tick so layout/scrollWidth are accurate
        requestAnimationFrame(() => {
            const neededWidth = container.scrollWidth + 16; // small padding buffer

            if (neededWidth <= maxWidthPx) {
                // Everything fits: shrink popup to content and hide horiz scrollbar
                popupEl.style.width = neededWidth + 'px';
                container.style.overflowX = 'hidden';
            } else {
                // Too wide: clamp popup and allow horizontal scrolling
                popupEl.style.width = maxWidthPx + 'px';
                container.style.overflowX = 'auto';
            }
        });
    }

    // keep clicks/scrolls inside popup from closing it
    popup.addEventListener('mousedown', (e) => e.stopPropagation(), true);
    popup.addEventListener('click', (e) => e.stopPropagation(), true);
    popup.addEventListener('wheel', (e) => e.stopPropagation(), { capture: true, passive: true });

    // Hide inner popup (and syllable popup) when leaving the main popup
    popup.addEventListener('mouseleave', () => {
        innerPopup.style.display = 'none';
        syllPopup.style.display = 'none';
    });

    // ADDED: Cache management
    function getCachedLookup(chunk) {
        const cached = lookupCache.get(chunk);
        if (!cached) return null;

        // Check if cache is stale
        if (Date.now() - cached.timestamp > CACHE_DURATION_MS) {
            lookupCache.delete(chunk);
            return null;
        }

        return cached.data;
    }

    function setCachedLookup(chunk, data) {
        // Simple LRU: if cache is full, delete oldest entries
        if (lookupCache.size >= CACHE_MAX_SIZE) {
            const firstKey = lookupCache.keys().next().value;
            lookupCache.delete(firstKey);
        }

        lookupCache.set(chunk, {
            data: data,
            timestamp: Date.now()
        });
    }

    // ---- dictionary lookup via GM_xmlhttpRequest with caching ----
    function lookupWord(chunk) {
        // ADDED: Check cache first
        const cached = getCachedLookup(chunk);
        if (cached) {
            return Promise.resolve(cached);
        }

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: API_URL + '?q=' + encodeURIComponent(chunk),
                timeout: 5000, // ADDED: 5 second timeout
                onload: (resp) => {
                    try {
                        const data = JSON.parse(resp.responseText);
                        setCachedLookup(chunk, data); // ADDED: Cache the result
                        resolve(data);
                    } catch (e) {
                        console.error('[BurmeseHoverDict] parse error', e);
                        reject(e);
                    }
                },
                onerror: (e) => {
                    console.error('[BurmeseHoverDict] network error', e);
                    reject(e);
                },
                ontimeout: () => {
                    console.error('[BurmeseHoverDict] timeout');
                    reject(new Error('Request timeout'));
                }
            });
        });
    }

    // Fallback: lookup components for an unknown/any word by splitting into grapheme clusters
    async function lookupComponentsForUnknown(head) {
        const clusters = splitMyanmarClusters(head);
        const components = [];

        for (const c of clusters) {
            const hasBur = [...c].some(isMyanmarChar);
            if (!hasBur || !c.trim()) continue;

            try {
                const compData = await lookupWord(c);
                if (compData.ok && compData.results && compData.results.length) {
                    components.push({ cluster: c, results: compData.results });
                } else {
                    components.push({ cluster: c, results: [] });
                }
            } catch (e) {
                console.error('[BurmeseHoverDict] component lookup error', e);
                components.push({ cluster: c, results: [] });
            }
        }

        return components;
    }

    // ADDED: helper to get subsegments for a head (via /subsegments, with fallback)
    async function getSubsegmentsForHead(head) {
        const token = (head || '').trim();
        if (!token) {
            return [];
        }

        // First, try dedicated /subsegments endpoint if available
        try {
            const data = await new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: SUBSEG_API_URL + '?token=' + encodeURIComponent(token),
                    timeout: 5000,
                    onload: (resp) => {
                        try {
                            const json = JSON.parse(resp.responseText);
                            resolve(json);
                        } catch (err) {
                            console.error('[BurmeseHoverDict] subsegments parse error', err);
                            resolve(null);
                        }
                    },
                    onerror: () => {
                        resolve(null);
                    },
                    ontimeout: () => {
                        resolve(null);
                    }
                });
            });

            if (data && data.ok && Array.isArray(data.subsegments) && data.subsegments.length) {
                return data.subsegments;
            }
        } catch (e) {
            console.error('[BurmeseHoverDict] subsegments request error', e);
        }

        // Fallback: derive subsegments via component lookups
        try {
            const components = await lookupComponentsForUnknown(token);
            const subsegments = [];

            for (const comp of components) {
                const c = comp.cluster;
                const results = comp.results || [];

                if (results.length) {
                    const best = results[0];
                    subsegments.push({
                        head: best.head || c,
                        roman: best.roman || '',
                        pos: best.pos || '',
                        senses: best.senses || (best.gloss ? [best.gloss] : [])
                    });
                } else {
                    subsegments.push({
                        head: c,
                        roman: '',
                        pos: '[unknown]',
                        senses: ['[no dictionary entry found for this subsegment]'],
                        // Mark this as an irreducible unknown subsegment
                        irreducible: true
                    });
                }
            }

            return subsegments;
        } catch (e) {
            console.error('[BurmeseHoverDict] subsegment fallback error', e);
            return [];
        }
    }

    // ---- DOM walking / wrapping ----
    function walk(node) {
        let child, next;
        switch (node.nodeType) {
            case 1: // element
                // don't touch the popup itself
                if (node.id === 'burmese-hover-popup') return;

                // skip anything in editable / input areas (ChatGPT editor, forms, etc.)
                if (isInEditable(node)) return;

                // avoid re-wrapping already-processed spans
                if (node.classList && node.classList.contains('burmese-word')) return;

                child = node.firstChild;
                while (child) {
                    next = child.nextSibling;
                    walk(child);
                    child = next;
                }
                break;

            case 3: // text node
                // if this text node lives inside an editable, leave it alone
                if (isInEditable(node)) return;
                handleText(node);
                break;
        }
    }

    function handleText(textNode) {
        const text = textNode.nodeValue;
        // Only bother if there is at least one Myanmar char in this node
        if (!text || !/[\u1000-\u109F]/.test(text)) return;

        const frag = document.createDocumentFragment();
        let buffer = '';
        const len = text.length;

        function flushBuffer() {
            if (buffer) {
                frag.appendChild(document.createTextNode(buffer));
                buffer = '';
            }
        }

        let i = 0;
        while (i < len) {
            const ch = text[i];

            // Anything that is NOT a Myanmar char: keep as plain text
            if (!isMyanmarChar(ch)) {
                buffer += ch;
                i++;
                continue;
            }

            // FIXED: We hit a Myanmar char: start a Burmese run
            // Keep going while we see Myanmar chars or non-whitespace garbage
            // Stop at: spaces, Myanmar punctuation, or line breaks
            flushBuffer();

            let start = i;
            let j = i + 1;
            while (j < len) {
                const c = text[j];

                // Stop at whitespace (space, tab, etc.)
                if (/\s/.test(c)) {
                    break;
                }

                // Stop at Myanmar sentence marks (၊ ။)
                if (c === '\u104a' || c === '\u104b') {
                    break;
                }

                // Stop at dashes and common punctuation that separate text
                if (c === '–' || c === '-' || c === '—') {
                    break;
                }

                // If we hit non-Myanmar char, check if it's start of English text
                if (!isMyanmarChar(c)) {
                    // Look ahead: if next char is also non-Myanmar (esp. letters/spaces),
                    // this is probably English text starting, so stop
                    if (j + 1 < len) {
                        const next = text[j + 1];
                        if (/[a-zA-Z\s]/.test(next)) {
                            break;
                        }
                    }
                }

                // Otherwise keep going - Myanmar chars or isolated garbage like ရေ1ာက်
                j++;
            }

            const token = text.slice(start, j);
            const span = document.createElement('span');
            span.textContent = token;
            span.className = 'burmese-word';
            frag.appendChild(span);

            i = j;
        }

        flushBuffer();

        if (textNode.parentNode) {
            textNode.parentNode.replaceChild(frag, textNode);
        }
    }

    // NEW: wrap Myanmar text inside a specific element in .burmese-word spans
    function wrapMyanmarInElement(el) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
        const textNodes = [];
        let n;
        while ((n = walker.nextNode())) {
            textNodes.push(n);
        }
        for (const tn of textNodes) {
            handleText(tn);
        }
    }

    function initWrap() {
        walk(document.body);
    }

    // initial passes (for static content)
    setTimeout(initWrap, 500);
    setTimeout(initWrap, 2000);

    // observe dynamic content (e.g. chat messages)
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                // If this added node (or its parent) is inside an editable area, ignore it
                if (isInEditable(node)) continue;
                walk(node);
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // ADDED: Track current request to allow cancellation
    let currentRequest = null;
    let lastBreakdownHead = '';
    let lastSecondaryHead = '';

    // ADDED: Attach instant tooltip handlers for header tokens and POS cells
    function attachInstantTooltipHandlers(container) {
        // Header tokens (rarity)
        const headerTokens = container.querySelectorAll('.bh-header-token[data-rarity-score]');
        headerTokens.forEach(token => {
            token.addEventListener('mouseenter', (e) => {
                const score = token.getAttribute('data-rarity-score');
                if (score !== null && score !== '') {
                    instantTooltip.textContent = `Frequency: ${score}`;
                    const rect = token.getBoundingClientRect();
                    instantTooltip.style.left = (rect.left + rect.width / 2) + 'px';
                    instantTooltip.style.top = (rect.bottom + 4) + 'px';
                    instantTooltip.style.transform = 'translateX(-50%)';
                    instantTooltip.style.display = 'block';
                }
            });
            token.addEventListener('mouseleave', () => {
                instantTooltip.style.display = 'none';
            });
        });

        // POS cells (confidence)
        const posCells = container.querySelectorAll('.bh-pos-cell[data-pos-confidence]');
        posCells.forEach(cell => {
            cell.addEventListener('mouseenter', (e) => {
                const conf = cell.getAttribute('data-pos-confidence');
                if (conf !== null && conf !== '') {
                    instantTooltip.textContent = `Confidence: ${conf}%`;
                    const rect = cell.getBoundingClientRect();
                    instantTooltip.style.left = (rect.left + rect.width / 2) + 'px';
                    instantTooltip.style.top = (rect.bottom + 4) + 'px';
                    instantTooltip.style.transform = 'translateX(-50%)';
                    instantTooltip.style.display = 'block';
                }
            });
            cell.addEventListener('mouseleave', () => {
                instantTooltip.style.display = 'none';
            });
        });
    }

    async function showPopupForSpan(span, pageX, pageY) {
        const chunk = span.textContent.trim();
        if (!chunk || ![...chunk].some(isMyanmarChar)) {
            return;
        }

        // MODIFIED: Helper to build LM-aware header with rarity-based coloring
        function buildHeaderHtml(displayHead, data, segmentRarityMap) {
            const segments = Array.isArray(data.segments) ? data.segments : [];
            const lmOverlay = (data && typeof data.lm_overlay === 'object') ? data.lm_overlay : null;

            const n = segments.length;
            if (!n) {
                // No segmentation: just show the phrase once as header
                return `<div style="margin-bottom:4px;font-size:15px;font-weight:bold;text-align:center;">${displayHead}</div>`;
            }

            const edges = lmOverlay && Array.isArray(lmOverlay.edges) ? lmOverlay.edges : [];
            const phrases = lmOverlay && Array.isArray(lmOverlay.phrases) ? lmOverlay.phrases : [];

            // 1) Collocation strengths per token index (max over all edges touching that token)
            const collocStrength = new Array(n).fill(0);
            for (const e of edges) {
                if (!e) continue;
                let i = (typeof e.i === 'number') ? e.i : null;
                let j = (typeof e.j === 'number') ? e.j : null;
                const s = (typeof e.strength === 'number') ? e.strength : 0;

                if (i == null || j == null) continue;
                if (i === j) continue; // never highlight "within" the same token
                if (i < 0 || j < 0 || i >= n || j >= n) continue;
                if (s <= 0) continue;

                if (s > collocStrength[i]) collocStrength[i] = s;
                if (s > collocStrength[j]) collocStrength[j] = s;
            }

            // 2) Phrase brackets: open/close counts around token indices
            const openBrackets = new Array(n).fill(0);
            const closeBrackets = new Array(n).fill(0);

            for (const ph of phrases) {
                if (!ph) continue;

                let start = (typeof ph.start === 'number') ? ph.start : null;
                let end   = (typeof ph.end   === 'number') ? ph.end   : null;

                // Fallback if backend uses "span": [start, end)
                if ((start == null || end == null) && Array.isArray(ph.span) && ph.span.length === 2) {
                    start = ph.span[0];
                    end   = ph.span[1];
                }

                if (start == null || end == null) continue;
                if (end <= start) continue;
                if (start < 0 || start >= n) continue;
                if (end - 1 < 0 || end - 1 >= n) continue;

                const sIdx = start;
                const eIdx = end - 1;
                openBrackets[sIdx] += 1;
                closeBrackets[eIdx] += 1;
            }

            // 3) Render a *single* header line: segmented tokens with underlines + brackets + rarity coloring
            let header = `<div style="margin-bottom:4px;font-size:15px;text-align:center;">`;

            for (let i = 0; i < n; i++) {
                // opening brackets before token i
                if (openBrackets[i] > 0) {
                    header += `<span style="color:#b45309;font-weight:bold;margin-right:1px;">${'['.repeat(openBrackets[i])}</span>`;
                }

                // MODIFIED: Determine text color based on rarity
                const seg = segments[i];
                const rarityInfo = segmentRarityMap.get(seg);
                let textColor = '#000'; // default dark black
                let rarityScoreAttr = '';

                // MODIFIED: Styling based on rarity - bolder for common, thinner for rare/unknown
                let fontWeight = 500; // default
                if (rarityInfo) {
                    if (rarityInfo.isUnknown) {
                        textColor = '#ef4444'; // red for unknown to dictionary
                        fontWeight = 400; // thinner for unknown
                        rarityScoreAttr = 'data-rarity-score="unknown"';
                    } else {
                        const score = rarityInfo.commonScore;
                        rarityScoreAttr = `data-rarity-score="${score}"`;
                        // Map score 0-100 to greyscale - but keep readable
                        // 100 (common) = #000 (black), bold
                        // 0 (rare) = #555 (not too light)
                        const greyVal = Math.round(85 * (1 - score / 100)); // 0-85 range (max grey #555)
                        textColor = `rgb(${greyVal},${greyVal},${greyVal})`;
                        // Font weight: common = bolder (700), rare = normal (400)
                        fontWeight = Math.round(400 + (score / 100) * 300); // 400-700 range
                    }
                }

                // base token style
                let spanStyle = `margin-right:3px;color:${textColor};font-weight:${fontWeight};`;

                const s = collocStrength[i];
                if (s > 0) {
                    const clamped = Math.max(0, Math.min(1, s));
                    const thickness = 1 + clamped * 3;       // 1–4 px
                    const alpha = 0.15 + clamped * 0.6;      // 0.15–0.75
                    spanStyle += `border-bottom:${thickness}px solid rgba(37,99,235,${alpha});`;
                }

                header += `<span class="bh-header-token" data-idx="${i}" ${rarityScoreAttr} style="${spanStyle}">${seg}</span>`;

                // closing brackets after token i
                if (closeBrackets[i] > 0) {
                    header += `<span style="color:#b45309;font-weight:bold;margin-left:1px;">${']'.repeat(closeBrackets[i])}</span>`;
                }
            }

            header += `</div>`;
            return header;
        }

        // Cancel any in-flight request
        if (currentRequest) {
            currentRequest.cancelled = true;
        }
        const thisRequest = { cancelled: false };
        currentRequest = thisRequest;

        const totalBurChars = burmeseLength(chunk);

        try {
            const data = await lookupWord(chunk);

            // If this request was superseded, drop the result
            if (thisRequest.cancelled) {
                return;
            }

            if (!data.ok || !data.results || data.results.length === 0) {
                return;
            }

            // Normalized head from server, fallback to raw chunk
            const displayHead =
                (data && typeof data.q === 'string' && data.q.trim())
                    ? data.q.trim()
                    : chunk;

            const segments = Array.isArray(data.segments) ? data.segments : [];
            const lmOverlay = (data && typeof data.lm_overlay === 'object') ? data.lm_overlay : null;
            const lmTokens = lmOverlay && Array.isArray(lmOverlay.tokens) ? lmOverlay.tokens : [];
            const haveLmTokens = segments.length && lmTokens.length === segments.length;

            // Try to get G2P explanation for the whole query / main head
            let g2pForUi = null;
            if (data && data.g2p && Array.isArray(data.g2p.syllables)) {
                g2pForUi = data.g2p;
            } else if (Array.isArray(data.results) && data.results.length) {
                // Prefer an entry whose head matches the displayed head
                for (const r of data.results) {
                    if (r && r.g2p && r.head === displayHead) {
                        g2pForUi = r.g2p;
                        break;
                    }
                }
                // Fallback: first result with g2p
                if (!g2pForUi) {
                    const r0 = data.results[0];
                    if (r0 && r0.g2p && Array.isArray(r0.g2p.syllables)) {
                        g2pForUi = r0.g2p;
                    }
                }
            }
            currentG2P = g2pForUi;

            // ADDED: Build segment -> rarity info map for header coloring
            const segmentRarityMap = new Map();
            const tokenIndexBuckets = {};

            if (haveLmTokens) {
                for (let i = 0; i < segments.length; i++) {
                    const t = segments[i];
                    if (!tokenIndexBuckets[t]) tokenIndexBuckets[t] = [];
                    tokenIndexBuckets[t].push(i);
                }
            }

            // Also check which segments are unknown to dictionary
            const unknownSegments = new Set();
            for (const res of data.results) {
                const head = res.head || '';
                const pos = res.pos || '';
                const senses = res.senses || [];

                const isUnknown =
                    (typeof pos === 'string' && pos.toLowerCase().includes('unknown')) ||
                    (senses.length === 1 && typeof senses[0] === 'string' &&
                     senses[0].toLowerCase().includes('no dictionary entry found'));

                if (isUnknown) {
                    unknownSegments.add(head);
                }
            }

            // Populate segmentRarityMap
            for (const seg of segments) {
                if (unknownSegments.has(seg)) {
                    segmentRarityMap.set(seg, { isUnknown: true, commonScore: 0 });
                } else if (haveLmTokens && tokenIndexBuckets[seg] && tokenIndexBuckets[seg].length) {
                    const idx = tokenIndexBuckets[seg][0]; // peek, don't shift yet
                    const tInfo = lmTokens[idx] || null;

                    if (tInfo && typeof tInfo.rarity_score === 'number') {
                        let rarity = tInfo.rarity_score;
                        if (!Number.isFinite(rarity)) rarity = 0.5;
                        rarity = Math.max(0, Math.min(1, rarity));

                        let commonScore = Math.round((1 - rarity) * 100);
                        if (!Number.isFinite(commonScore)) commonScore = 50;
                        commonScore = Math.max(0, Math.min(100, commonScore));

                        segmentRarityMap.set(seg, { isUnknown: false, commonScore });
                    }
                }
            }

            // LM-aware header with rarity coloring
            let headerHtml = buildHeaderHtml(displayHead, data, segmentRarityMap);

            // Create sticky header container
            let html = `<div class="bh-sticky-header" style="position:sticky;top:0;background:white;z-index:10;padding:6px 8px;border-bottom:1px solid #ddd;display:flex;justify-content:center;align-items:center;">${headerHtml}</div>`;

            // NEW: Pronunciation / syllable layer between header and dictionary cards
            if (currentG2P) {
                html += buildG2PLayerHtml(currentG2P, segments);
            }

            // MODIFIED: SVG overlay for connecting lines - more transparent
            html += `<svg id="bh-connector-svg" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;" xmlns="http://www.w3.org/2000/svg"></svg>`;

            // MODIFIED: Horizontal scrolling container
            html += `<div class="bh-entries-container" style="display:flex;flex-wrap:nowrap;gap:12px;padding:6px 8px;overflow-x:auto;overflow-y:hidden;">`;

            // Reset tokenIndexBuckets for card iteration
            for (const key of Object.keys(tokenIndexBuckets)) {
                tokenIndexBuckets[key] = [];
            }
            if (haveLmTokens) {
                for (let i = 0; i < segments.length; i++) {
                    const t = segments[i];
                    if (!tokenIndexBuckets[t]) tokenIndexBuckets[t] = [];
                    tokenIndexBuckets[t].push(i);
                }
            }

            for (const res of data.results) {
                const head = res.head || displayHead;
                const roman = res.roman || '';
                const pos = res.pos || '';
                const senses = res.senses || (res.gloss ? [res.gloss] : []);

                const headBurLen = burmeseLength(head);

                // Detect unknown main entry
                const isUnknownMain =
                    (typeof pos === 'string' &&
                     pos.toLowerCase().includes('unknown')) ||
                    (senses.length === 1 &&
                     typeof senses[0] === 'string' &&
                     senses[0].toLowerCase().includes('no dictionary entry found'));

                // REMOVED: meta_pos badge completely removed

                // MODIFIED: Each entry card (no data-rarity attribute needed anymore)
                html += `<div class="bh-entry-card" data-head="${head}" style="flex:0 0 auto;border:1px solid #ddd;border-radius:4px;padding:8px;background:#fafafa;max-width:360px;max-height:420px;overflow-y:auto;">`;

                // FIXED: Use renderSenseLines to parse hierarchical entries
                const sensesHtml = renderSenseLines(senses);

                html += `<div class="bh-def" data-head="${head}">`;
                html += sensesHtml;

                // REMOVED: meta_pos badge section completely removed

                html += `</div>`;

                // Spelling line ONLY for unknown mains
                // Fuzzy matches as collapsible dropdown
                try {
                    const fuzzyArr = Array.isArray(res.fuzzy_matches) ? res.fuzzy_matches
                                    : Array.isArray(res.fuzzyMatches)   ? res.fuzzyMatches
                                    : Array.isArray(res.fuzzy)          ? res.fuzzy
                                    : [];

                    // Always show the unknown segment in red only (no duplication)
                    if (isUnknownMain) {
                        const unknownHead = head || displayHead || '';

                        if (unknownHead) {
                            // MODIFIED: Just show token in red, no additional text or repetition
                            html += `<div class="bh-def bh-unknown-def"
                                          data-head="${unknownHead}"
                                          style="margin-top:4px;margin-bottom:4px;font-size:13px;">
                                        <span style="color:#ef4444;font-weight:bold;">${unknownHead}</span>
                                        <span style="margin-left:8px;color:#888;font-size:11px;">[unknown]</span>
                                     </div>`;
                        }
                    }

                    // Fuzzy matches block only if we actually have candidates
                    if (isUnknownMain && fuzzyArr.length) {
                        // Always-visible fuzzy matches, no dropdown
                        html += `<div class="bh-fuzzy-container" style="margin:6px 0 0 0;font-size:12px;">`;
                        html += `<div style="font-weight:bold;color:#6b21a8;margin-bottom:2px;">Possible matches (OCR)</div>`;
                        html += `<div style="margin-top:2px;padding-top:4px;border-top:1px solid #ddd;max-height:40vh;overflow-y:auto;">`;

                        for (const fm of fuzzyArr) {
                            const fHead   = fm ? (fm.head || fm.candidate || '') : '';
                            const fRoman  = fm && fm.roman ? fm.roman : '';
                            const fPos    = fm && fm.pos ? fm.pos : '';
                            const fSenses = fm && Array.isArray(fm.senses) ? fm.senses
                                              : (fm && fm.gloss ? [fm.gloss] : []);

                            // Compute probability / similarity percentage
                            let pct = 0;
                            if (fm && typeof fm.prob_percent === 'number') {
                                pct = Math.round(fm.prob_percent);
                            } else if (fm && typeof fm.edit_similarity === 'number') {
                                pct = Math.round(fm.edit_similarity * 100);
                            } else if (fm && typeof fm.similarity_pct === 'number') {
                                pct = fm.similarity_pct;
                            } else if (fm && typeof fm.similarity === 'number') {
                                pct = Math.round(fm.similarity * 100);
                            }

                            const probChip = pct
                                ? `<span style="margin-left:6px;padding:0 6px;border-radius:9px;background:#eee;color:#333;font-size:11px;">≈${pct}%</span>`
                                : '';

                            // Does this look like the new 4-column / tabbed format?
                            const hasHierarchical = Array.isArray(fSenses) &&
                                fSenses.some(line => typeof line === 'string' && line.includes('\t'));

                            // Per-candidate container – make it clickable for breakdowns
                            html += `<div class="bh-def bh-fuzzy-def" data-head="${fHead}" style="margin:2px 0;padding-top:4px;border-top:1px solid #eee;">`;

                            if (hasHierarchical) {
                                // For hierarchical sense_lines, let renderSenseLines handle the layout
                                if (pct) {
                                    html += `<div style="margin-bottom:2px;">${probChip}</div>`;
                                }
                                html += renderSenseLines(fSenses);
                            } else {
                                // OLD behaviour for simple gloss strings
                                html += `<div>
                                            <span style="font-weight:bold">${fHead}</span>
                                            ${fRoman ? `<span style="margin-left:4px;font-style:italic;color:#555;">${fRoman}</span>` : ''}
                                            ${fPos ? `<span style="margin-left:4px;color:#888;">[${fPos}]</span>` : ''}
                                            ${probChip}
                                         </div>`;

                                if (fSenses.length) {
                                    html += `<ul style="margin:2px 0 4px 0;padding-left:16px;">`;
                                    for (const s of fSenses) {
                                        html += `<li>${s}</li>`;
                                    }
                                    html += `</ul>`;
                                }
                            }

                            html += `</div>`; // end per-candidate container
                        }

                        html += `</div>`; // fuzzy list container
                        html += `</div>`; // fuzzy block wrapper
                    }

                } catch (e) {
                    console.warn('[BurmeseHoverDict] fuzzy render skipped (error):', e);
                }

                html += `</div>`; // Close flex item
            }

            html += `</div>`; // Close flex container

            popup.innerHTML = html;

            // Apply grammar POS overlay to this popup, if available
            try {
                applyPosOverlayToPopup(popup, data);
            } catch (e) {
                console.warn('[BurmeseHoverDict] POS overlay UI error (main popup):', e);
            }

            // ADDED: Attach instant tooltip handlers
            attachInstantTooltipHandlers(popup);

            // Attach syllable-level handlers for pronunciation layer (if present)
            if (currentG2P) {
                attachG2PHandlers(popup, currentG2P);
            }

            // NEW: wrap Myanmar inside definition text so clicks see .burmese-word spans
            const senseEls = popup.querySelectorAll('.bh-sense-text');
            senseEls.forEach(el => wrapMyanmarInElement(el));

            // Dynamic width based on content: let the popup expand
            // naturally to fit the entry cards, up to maxWidth (90vw).
            popup.style.width = 'auto';

            // Add rotation animation for details arrows
            const detailsElements = popup.querySelectorAll('details');
            detailsElements.forEach(details => {
                const arrow = details.querySelector('summary span');
                if (arrow) {
                    arrow.style.transform = details.open ? 'rotate(90deg)' : 'rotate(0deg)';
                }
            });

            popup.style.display = 'flex';

            // Adjust popup width based on card content, capped at 90% viewport width
            adjustPopupToContent(popup, '.bh-entries-container', 0.9);

            // Setup connecting lines
            setupConnectingLines();

        } catch (e) {
            console.error('[BurmeseHoverDict] lookup error', e);

            if (!thisRequest.cancelled) {
                popup.innerHTML = '<div style="color:#b00020;padding:4px;">⚠️ Connection error. Is the server running?<br/><small style="color:#666;">python burmese_dict_server.py</small></div>';
                popup.style.width = '400px';
                popup.style.display = 'flex';

                setTimeout(() => {
                    if (popup.style.display === 'flex' && popup.innerHTML.includes('Connection error')) {
                        popup.style.display = 'none';
                    }
                }, 3000);
            }
        }
    }

    // MODIFIED: Function to draw connecting lines - visible but fade over pronunciation
    function setupConnectingLines() {
        const svg = popup.querySelector('#bh-connector-svg');
        const header = popup.querySelector('.bh-sticky-header');
        const g2pLayer = popup.querySelector('.bh-g2p-layer');
        const entriesContainer = popup.querySelector('.bh-entries-container');
        const entryCards = popup.querySelectorAll('.bh-entry-card');

        if (!svg || !header || !entriesContainer) return;

        const visibilityMap = new Map();

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                visibilityMap.set(entry.target, entry.isIntersecting);
            });
            updateLines();
        }, {
            root: entriesContainer,
            threshold: 0.1
        });

        entryCards.forEach(card => {
            visibilityMap.set(card, false);
            observer.observe(card);
        });

        // Create gradient definitions for fading lines
        let defsCreated = false;

        function updateLines() {
            svg.innerHTML = '';

            const headerTokens = header.querySelectorAll('.bh-header-token');
            const popupRect = popup.getBoundingClientRect();

            // Get G2P layer bounds if present
            let g2pTop = null, g2pBottom = null;
            if (g2pLayer) {
                const g2pRect = g2pLayer.getBoundingClientRect();
                g2pTop = g2pRect.top - popupRect.top;
                g2pBottom = g2pRect.bottom - popupRect.top;
            }

            // Add defs for gradients if not already
            if (!defsCreated) {
                const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                svg.appendChild(defs);
                defsCreated = true;
            }

            let gradientId = 0;

            entryCards.forEach(card => {
                const isVisible = visibilityMap.get(card);
                if (!isVisible) return;

                const headText = card.getAttribute('data-head');
                if (!headText) return;

                let matchingToken = null;
                headerTokens.forEach(token => {
                    if (token.textContent.trim() === headText.trim()) {
                        matchingToken = token;
                    }
                });

                if (!matchingToken) return;

                const tokenRect = matchingToken.getBoundingClientRect();
                const cardRect = card.getBoundingClientRect();

                const x1 = tokenRect.left + tokenRect.width / 2 - popupRect.left;
                const y1 = tokenRect.bottom - popupRect.top;
                const x2 = cardRect.left + cardRect.width / 2 - popupRect.left;
                const y2 = cardRect.top - popupRect.top;

                // If there's a G2P layer, create gradient to fade through it
                if (g2pTop !== null && g2pBottom !== null && y2 > g2pBottom) {
                    const totalHeight = y2 - y1;
                    const fadeStart = (g2pTop - y1) / totalHeight;
                    const fadeEnd = (g2pBottom - y1) / totalHeight;

                    // Create unique gradient for this line
                    const gradId = `line-grad-${gradientId++}`;
                    const defs = svg.querySelector('defs');

                    const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
                    gradient.setAttribute('id', gradId);
                    gradient.setAttribute('x1', '0%');
                    gradient.setAttribute('y1', '0%');
                    gradient.setAttribute('x2', '0%');
                    gradient.setAttribute('y2', '100%');

                    // Stops: visible -> fade -> transparent -> fade -> visible
                    const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
                    stop1.setAttribute('offset', `${Math.max(0, fadeStart - 0.05) * 100}%`);
                    stop1.setAttribute('stop-color', '#999');
                    stop1.setAttribute('stop-opacity', '0.5');

                    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
                    stop2.setAttribute('offset', `${fadeStart * 100}%`);
                    stop2.setAttribute('stop-color', '#999');
                    stop2.setAttribute('stop-opacity', '0.1');

                    const stop3 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
                    stop3.setAttribute('offset', `${fadeEnd * 100}%`);
                    stop3.setAttribute('stop-color', '#999');
                    stop3.setAttribute('stop-opacity', '0.1');

                    const stop4 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
                    stop4.setAttribute('offset', `${Math.min(1, fadeEnd + 0.05) * 100}%`);
                    stop4.setAttribute('stop-color', '#999');
                    stop4.setAttribute('stop-opacity', '0.5');

                    gradient.appendChild(stop1);
                    gradient.appendChild(stop2);
                    gradient.appendChild(stop3);
                    gradient.appendChild(stop4);
                    defs.appendChild(gradient);

                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line.setAttribute('x1', x1);
                    line.setAttribute('y1', y1);
                    line.setAttribute('x2', x2);
                    line.setAttribute('y2', y2);
                    line.setAttribute('stroke', `url(#${gradId})`);
                    line.setAttribute('stroke-width', '1.5');

                    svg.appendChild(line);
                } else {
                    // No G2P layer or line doesn't cross it - draw simple line
                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line.setAttribute('x1', x1);
                    line.setAttribute('y1', y1);
                    line.setAttribute('x2', x2);
                    line.setAttribute('y2', y2);
                    line.setAttribute('stroke', '#999');
                    line.setAttribute('stroke-width', '1.5');
                    line.setAttribute('opacity', '0.5');

                    svg.appendChild(line);
                }
            });
        }

        entriesContainer.addEventListener('scroll', updateLines);

        setTimeout(updateLines, 50);
        setTimeout(updateLines, 200);
    }

    popup.addEventListener('mousemove', (e) => {
        const target = e.target.closest('.bh-sub');
        if (!target) {
            innerPopup.style.display = 'none';
            return;
        }

        const encoded = target.getAttribute('data-sub');
        if (!encoded) {
            innerPopup.style.display = 'none';
            return;
        }

        let payload;
        try {
            payload = JSON.parse(decodeURIComponent(encoded));
        } catch (err) {
            console.warn('[BurmeseHoverDict] failed to decode component payload', err);
            innerPopup.style.display = 'none';
            return;
        }

        const head = payload.head || '';
        const roman = payload.roman || '';
        const pos = payload.pos || '';
        const senses = Array.isArray(payload.senses) ? payload.senses : [];

        let ih = `<div style="margin-bottom:2px;">
                    <span style="font-weight:bold;">${head}</span>
                    ${roman ? `<span style="margin-left:4px;font-style:italic;color:#555;">${roman}</span>` : ''}
                    ${pos ? `<span style="margin-left:4px;color:#888;">[${pos}]</span>` : ''}
                  </div>`;

        if (senses.length) {
            ih += `<ul style="margin:2px 0 0 16px;padding-left:12px;">`;
            for (const s of senses) {
                ih += `<li>${s}</li>`;
            }
            ih += `</ul>`;
        }

        innerPopup.innerHTML = ih;

        const offsetX = 10;
        const offsetY = 10;
        let x = e.pageX + offsetX;
        let y = e.pageY + offsetY;

        const approxWidth = 320;
        if (x + approxWidth > window.innerWidth + window.scrollX) {
            x = e.pageX - approxWidth - offsetX;
        }

        innerPopup.style.left = x + 'px';
        innerPopup.style.top = y + 'px';
        innerPopup.style.display = 'block';
    });

    // CHANGED: second-level dictionary popup from words inside definitions - now creates nested popups dynamically
    async function showDefinitionLookupPopup(head) {
        const token = (head || '').trim();
        if (!token || ![...token].some(isMyanmarChar)) {
            return;
        }

        // Don't open exact same nested dictionary popup twice in a row
        if (token === lastSecondaryHead) {
            return;
        }

        try {
            const data = await lookupWord(token);
            if (!data.ok || !data.results || !data.results.length) {
                return;
            }

            const displayHead =
                (data && typeof data.q === 'string' && data.q.trim())
                    ? data.q.trim()
                    : token;

            // Record last opened nested dictionary head (raw token)
            lastSecondaryHead = token;

            // CHANGED: Create new nested popup instead of reusing single element
            const nestedPopup = createNestedPopup();
            nestedPopups.push(nestedPopup);

            // Centered, no descriptive subtitle
            let ih = `<div class="bh-popup-header-secondary" style="font-weight:bold;margin-bottom:4px;text-align:center;">${displayHead}</div>`;

            // Horizontal scroller with vertically scrollable cards
            ih += `<div class="bh-entries-container-secondary" style="display:flex;flex-wrap:nowrap;gap:12px;overflow-x:auto;overflow-y:hidden;max-height:400px;padding:6px 0;">`;

            for (const res of data.results) {
                const resHead = res.head || displayHead;
                const roman   = res.roman || '';
                const pos     = res.pos || '';
                const senses  = res.senses || (res.gloss ? [res.gloss] : []);

                // Detect unknown main entry (same logic as main popup)
                const isUnknownMain =
                    (typeof pos === 'string' &&
                     pos.toLowerCase().includes('unknown')) ||
                    (senses.length === 1 &&
                     typeof senses[0] === 'string' &&
                     senses[0].toLowerCase().includes('no dictionary entry found'));

                // REMOVED: meta_pos badge

                const sensesHtml = renderSenseLines(senses);

                ih += `<div class="bh-entry-card-secondary" data-head="${resHead}" style="flex:0 0 auto;border:1px solid #ddd;border-radius:4px;padding:8px;background:#fafafa;max-width:360px;max-height:420px;overflow-y:auto;">`;

                ih += `<div class="bh-def" data-head="${resHead}">`;

                if (!isUnknownMain) {
                    // Normal known entry: render hierarchical senses as before
                    ih += sensesHtml;

                    // REMOVED: meta_pos badge
                } else {
                    // For nested dictionary popups, we do NOT show fuzzy matches.
                    // Unknown entries: show token in red only once, no duplication
                    const unknownHead = resHead || displayHead || '';

                    if (unknownHead) {
                        ih += `<div class="bh-unknown-def"
                                   data-head="${unknownHead}"
                                   style="margin-top:2px;margin-bottom:4px;font-size:12px;">`;

                        ih += `<span style="color:#ef4444;font-weight:bold;">${unknownHead}</span>`;
                        ih += `<span style="margin-left:8px;color:#888;font-size:10px;">[unknown]</span>`;

                        ih += `</div>`;
                    }

                    // REMOVED: meta_pos badge
                }

                ih += `</div>`; // .bh-def
                ih += `</div>`; // card
            }

            ih += `</div>`; // container

            nestedPopup.innerHTML = ih;

            // Wrap ONLY Myanmar text inside definition blocks, not the header line
            const defEls = nestedPopup.querySelectorAll('.bh-def');
            defEls.forEach(el => wrapMyanmarInElement(el));

            // Same scroll behaviour as component breakdown: cards scroll vertically,
            // container scrolls horizontally, popup itself doesn't scroll.
            nestedPopup.style.maxHeight = 'none';
            nestedPopup.style.height = 'auto';
            nestedPopup.style.overflowY = 'hidden';

            nestedPopup.style.display = 'block';

            // Adjust nested popup width based on card content, capped at 90% viewport width
            adjustPopupToContent(nestedPopup, '.bh-entries-container-secondary', 0.9);

            // CHANGED: Attach click handlers to this nested popup for recursive nesting
            attachPopupClickHandlers(nestedPopup);

        } catch (err) {
            console.error('[BurmeseHoverDict] definition lookup popup error', err);
        }
    }

    // CHANGED: Component breakdown now creates nested popups dynamically
    async function showComponentBreakdown(head, sourcePopup) {
        const token = (head || '').trim();
        if (!token || ![...token].some(isMyanmarChar)) {
            return;
        }

        // Don't open the exact same breakdown twice in a row
        if (token === lastBreakdownHead) {
            return;
        }

        try {
            const subsegments = await getSubsegmentsForHead(token);
            if (!subsegments || !subsegments.length) {
                return;
            }

            // Record last opened breakdown head
            lastBreakdownHead = token;

            // CHANGED: Create new nested popup instead of reusing single element
            const nestedPopup = createNestedPopup();
            nestedPopups.push(nestedPopup);

            // Centered, no descriptive subtitle
            let ih = `<div class="bh-popup-header-secondary" style="font-weight:bold;margin-bottom:4px;text-align:center;">${token}</div>`;

            ih += `<div class="bh-breakdown-container" style="display:flex;gap:12px;overflow-x:auto;overflow-y:hidden;">`;

            for (const sub of subsegments) {
                const sHead   = sub.head || '';
                const sRoman  = sub.roman || '';
                const sPos    = sub.pos || '';
                const sSenses = Array.isArray(sub.senses) ? sub.senses : [];

                if (!sHead) continue;

                const hasHierarchical = Array.isArray(sSenses) &&
                    sSenses.some(line => typeof line === 'string' && line.includes('\t'));

                // Treat unknown/no-entry subsegments as irreducible leaves
                const isUnknownPos = typeof sPos === 'string' &&
                      sPos.toLowerCase().includes('unknown');
                const hasNoEntrySense =
                      sSenses.length === 1 &&
                      typeof sSenses[0] === 'string' &&
                      sSenses[0].toLowerCase().includes('no dictionary entry found');

                const isIrreducible =
                      sub.irreducible === true || isUnknownPos || hasNoEntrySense;

                ih += `<div class="bh-def${isIrreducible ? ' bh-def-irreducible' : ''}"
                           data-head="${sHead}"
                           ${isIrreducible ? 'data-irreducible="1"' : ''}
                           style="flex:0 0 auto;border:1px solid #ddd;border-radius:4px;padding:8px;background:#fafafa;max-width:360px;max-height:420px;overflow-y:auto;">`;

                if (isIrreducible) {
                    // Unknown/irreducible: just show token in red, no duplication
                    ih += `<span style="color:#ef4444;font-weight:bold;">${sHead}</span>`;
                    ih += `<span style="margin-left:8px;color:#888;font-size:10px;">[unknown]</span>`;
                } else if (!hasHierarchical) {
                    ih += `<div style="font-weight:bold;">${sHead}</div>`;
                    if (sRoman) ih += `<div style="font-style:italic;color:#555;font-size:11px;margin-top:2px;">${sRoman}</div>`;
                    if (sPos) ih += `<div style="color:#888;font-size:10px;margin-top:2px;">[${sPos}]</div>`;
                }

                if (sSenses.length && !isIrreducible) {
                    if (hasHierarchical) {
                        ih += renderSenseLines(sSenses);
                    } else {
                        ih += `<ul style="margin:4px 0 0 0;padding-left:16px;font-size:11px;">`;
                        for (const s of sSenses) {
                            ih += `<li>${s}</li>`;
                        }
                        ih += `</ul>`;
                    }
                }

                ih += `</div>`;
            }

            ih += `</div>`;

            nestedPopup.innerHTML = ih;

            // Wrap ONLY Myanmar text in the breakdown cards so headers stay non-clickable
            const defEls = nestedPopup.querySelectorAll('.bh-def');
            defEls.forEach(el => wrapMyanmarInElement(el));

            // Remove the popup's own scrollbar - only cards should scroll
            nestedPopup.style.maxHeight = 'none';
            nestedPopup.style.height = 'auto';
            nestedPopup.style.overflowY = 'hidden';

            nestedPopup.style.display = 'block';

            // Adjust nested popup width based on card content, capped at 90% viewport width
            adjustPopupToContent(nestedPopup, '.bh-breakdown-container', 0.9);

            // CHANGED: Attach click handlers to this nested popup for recursive nesting
            attachPopupClickHandlers(nestedPopup);

        } catch (err) {
            console.error('[BurmeseHoverDict] component breakdown error', err);
        }
    }

    // CHANGED: Generic function to attach click handlers to any popup (main or nested) for recursive nesting
    function attachPopupClickHandlers(targetPopup) {
        targetPopup.addEventListener('click', async (e) => {
            // NEW: ignore clicks in the top header areas (original display text)
            // - .bh-sticky-header: main popup segmented line
            // - .bh-popup-header-secondary: nested popup title
            if (e.target.closest('.bh-sticky-header, .bh-popup-header-secondary')) {
                return;
            }

            // ADDED: Ignore clicks on pronunciation syllables (hover only)
            if (e.target.closest('.bh-g2p-syll')) {
                return;
            }

            // 1) Check for headword/unknown-def FIRST (takes priority over word lookups)
            const headClickTarget = e.target.closest('.bh-headword, .bh-unknown-def');
            if (headClickTarget) {
                const def = e.target.closest('.bh-def, .bh-def-body');
                if (def) {
                    // If this definition is marked irreducible, do nothing
                    if (def.getAttribute('data-irreducible') === '1') {
                        return;
                    }

                    const headAttr = def.getAttribute('data-head') || '';
                    const headText = headAttr || def.textContent || '';
                    const head = headText.trim();
                    if (head && [...head].some(isMyanmarChar)) {
                        await showComponentBreakdown(head, targetPopup);
                        return;
                    }
                }
            }

            // 2) Then check for ANY Burmese word (anywhere in the popup)
            const wordSpan = e.target.closest('.burmese-word');
            if (wordSpan) {
                const def = wordSpan.closest('.bh-def');

                // If this Burmese word lives inside an irreducible breakdown card, do nothing
                if (def && def.getAttribute('data-irreducible') === '1') {
                    return;
                }

                const clicked = (wordSpan.textContent || '').trim();
                if (clicked && [...clicked].some(isMyanmarChar)) {
                    await showDefinitionLookupPopup(clicked);
                    return;
                }
            }
        }, true);
    }

    // CHANGED: Attach handlers to main popup
    attachPopupClickHandlers(popup);

    document.addEventListener('scroll', () => {
        innerPopup.style.display = 'none';
        syllPopup.style.display = 'none';
        instantTooltip.style.display = 'none';
    }, true);

    document.addEventListener('click', (e) => {
        const span = e.target.closest && e.target.closest('.burmese-word');
        if (!span) {
            return;
        }

        // If the click is happening inside one of our own popups,
        // don't treat it as a new primary lookup. This lets the
        // secondary breakdown windows stack without closing the first.
        if (popup.contains(span)) {
            return;
        }

        // CHANGED: Check all nested popups
        for (const np of nestedPopups) {
            if (np.contains(span)) {
                return;
            }
        }

        showPopupForSpan(span, e.pageX, e.pageY);
    }, true);

    // CHANGED: Click-outside handler - close only topmost popup when clicking anywhere outside it
    document.addEventListener('click', (e) => {

        // Don't treat clicks on Burmese page text as "outside" – those are for opening the main popup
        const wordSpan = e.target.closest && e.target.closest('.burmese-word');
        if (wordSpan && !popup.contains(wordSpan)) {
            // Let the other click handler handle the lookup
            return;
        }

        // Check if click is inside the topmost nested popup
        if (nestedPopups.length > 0) {
            const topPopup = nestedPopups[nestedPopups.length - 1];
            if (!topPopup.contains(e.target)) {
                // Click is outside topmost nested popup - close only the topmost
                nestedPopups.pop();
                topPopup.style.display = 'none';
                topPopup.remove();

                // Reset repeat guards after closing a nested popup
                lastBreakdownHead = '';
                lastSecondaryHead = '';
                syllPopup.style.display = 'none';
                instantTooltip.style.display = 'none';
                return;
            }
        } else if (popup.style.display === 'flex' && !popup.contains(e.target)) {
            // No nested popups, click is outside main popup - close only main
            popup.style.display = 'none';
            innerPopup.style.display = 'none';
            syllPopup.style.display = 'none';
            instantTooltip.style.display = 'none';
            if (currentRequest) {
                currentRequest.cancelled = true;
                currentRequest = null;
            }

            // Reset repeat guards when the main popup closes
            lastBreakdownHead = '';
            lastSecondaryHead = '';
        }
    }, true);

    // CHANGED: ESC key handler - close ALL popups at once
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // Close all nested popups
            while (nestedPopups.length > 0) {
                const np = nestedPopups.pop();
                np.style.display = 'none';
                np.remove();
            }

            // Close main popup
            if (popup.style.display === 'flex') {
                popup.style.display = 'none';
                innerPopup.style.display = 'none';
                syllPopup.style.display = 'none';
                instantTooltip.style.display = 'none';
                if (currentRequest) {
                    currentRequest.cancelled = true;
                    currentRequest = null;
                }
            }

            // Reset repeat guards after closing everything
            lastBreakdownHead = '';
            lastSecondaryHead = '';
            currentG2P = null;
        }
    });

    // Hide syllable breakdown popup when clicking anywhere that's not a syllable or the popup itself
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.bh-g2p-syll') && !syllPopup.contains(e.target)) {
            syllPopup.style.display = 'none';
        }
    }, true);

    console.log('[BurmeseHoverDict] v0.99m-grammar loaded - Unlimited nested popups + POS grammar overlay enabled');
})();