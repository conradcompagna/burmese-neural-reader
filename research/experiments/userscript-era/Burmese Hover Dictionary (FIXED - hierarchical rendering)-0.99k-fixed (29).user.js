// ==UserScript==
// @name         Burmese Hover Dictionary (FIXED - hierarchical rendering)
// @namespace    http://tampermonkey.net/
// @version      0.99k-fixed
// @description  FIXED: Blank entries and random ordering resolved
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

    // ADDED: meta_pos → inline style for color-coded tags
    const META_POS_STYLES = {
        CASE: 'background:#e8f5e9;color:#2e7d32;border-radius:3px;padding:0 4px;font-size:10px;margin-left:4px;',
        VPART: 'background:#e3f2fd;color:#1565c0;border-radius:3px;padding:0 4px;font-size:10px;margin-left:4px;',
        LINK: 'background:#fff3e0;color:#ef6c00;border-radius:3px;padding:0 4px;font-size:10px;margin-left:4px;',
        BOUND: 'background:#f3e5f5;color:#6a1b9a;border-radius:3px;padding:0 4px;font-size:10px;margin-left:4px;'
    };

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
                    html += `<div style="color:#888;font-size:11px;">[${pos || ''}]</div>`;
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
                    html += `<div style="color:#888;font-size:11px;">[${pos || ''}]</div>`;
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

    // NEW: separate popup for full breakdown on click
    const breakdownPopup = document.createElement('div');
    breakdownPopup.id = 'burmese-hover-breakdown-popup';
    Object.assign(breakdownPopup.style, {
        position: 'fixed',
        zIndex: '1000001',
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
    document.body.appendChild(breakdownPopup);

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

    // SAME for breakdown popup (secondary breakdown windows)
    breakdownPopup.addEventListener('mousedown', (e) => e.stopPropagation(), true);
    breakdownPopup.addEventListener('click', (e) => e.stopPropagation(), true);
    breakdownPopup.addEventListener('wheel', (e) => e.stopPropagation(), { capture: true, passive: true });

    // Hide inner popup when leaving the main popup
    popup.addEventListener('mouseleave', () => {
        innerPopup.style.display = 'none';
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
                        senses: ['[no dictionary entry found for this subsegment]']
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

    async function showPopupForSpan(span, pageX, pageY) {
        const chunk = span.textContent.trim();
        if (!chunk || ![...chunk].some(isMyanmarChar)) {
            return;
        }

        // Helper: build LM-aware header line (segmented + brackets + colloc underlines)
        function buildHeaderHtml(displayHead, data) {
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

            // 3) Render a *single* header line: segmented tokens with underlines + brackets
            let header = `<div style="margin-bottom:4px;font-size:15px;text-align:center;">`;

            for (let i = 0; i < n; i++) {
                // opening brackets before token i
                if (openBrackets[i] > 0) {
                    header += `<span style="color:#b45309;font-weight:bold;margin-right:1px;">${'['.repeat(openBrackets[i])}</span>`;
                }

                // base token style
                let spanStyle = 'margin-right:3px;';

                const s = collocStrength[i];
                if (s > 0) {
                    const clamped = Math.max(0, Math.min(1, s));
                    const thickness = 1 + clamped * 3;       // 1–4 px
                    const alpha = 0.15 + clamped * 0.6;      // 0.15–0.75
                    spanStyle += `border-bottom:${thickness}px solid rgba(37,99,235,${alpha});`;
                }

                header += `<span class="bh-header-token" data-idx="${i}" style="${spanStyle}">${segments[i]}</span>`;

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

            // Precompute mapping from token text → list of indices, so repeated words
            // get distinct indices when we assign rarity scores.
            const tokenIndexBuckets = {};
            if (haveLmTokens) {
                for (let i = 0; i < segments.length; i++) {
                    const t = segments[i];
                    if (!tokenIndexBuckets[t]) tokenIndexBuckets[t] = [];
                    tokenIndexBuckets[t].push(i);
                }
            }

            // LM-aware header (segmented line with colloc underlines + phrase brackets)
            let headerHtml = buildHeaderHtml(displayHead, data);

            // Create sticky header container
            let html = `<div class="bh-sticky-header" style="position:sticky;top:0;background:white;z-index:10;padding:6px 8px;border-bottom:1px solid #ddd;display:flex;justify-content:center;align-items:center;">${headerHtml}</div>`;

            // SVG overlay for connecting lines
            html += `<svg id="bh-connector-svg" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;" xmlns="http://www.w3.org/2000/svg"></svg>`;

            // MODIFIED: Horizontal scrolling container
            html += `<div class="bh-entries-container" style="display:flex;flex-wrap:nowrap;gap:12px;padding:6px 8px;overflow-x:auto;overflow-y:hidden;">`;

            for (const res of data.results) {
                const head = res.head || displayHead;
                const roman = res.roman || '';
                const pos = res.pos || '';
                const metaPos = res.meta_pos || '';
                const senses = res.senses || (res.gloss ? [res.gloss] : []);

                const headBurLen = burmeseLength(head);

                // Detect unknown main entry
                const isUnknownMain =
                    (typeof pos === 'string' &&
                     pos.toLowerCase().includes('unknown')) ||
                    (senses.length === 1 &&
                     typeof senses[0] === 'string' &&
                     senses[0].toLowerCase().includes('no dictionary entry found'));

                // meta_pos badge
                let metaTagHtml = '';
                if (metaPos && META_POS_STYLES[metaPos]) {
                    metaTagHtml =
                        '<span style="' +
                        META_POS_STYLES[metaPos] +
                        '">' +
                        metaPos.toLowerCase() +
                        '</span>';
                }

                // Tiny 0–100 commonness score (only for known LM tokens).
                let freqHtml = '';
                if (haveLmTokens && tokenIndexBuckets[head] && tokenIndexBuckets[head].length) {
                    const idx = tokenIndexBuckets[head].shift();
                    const tInfo = lmTokens[idx] || null;

                    if (tInfo && typeof tInfo.rarity_score === 'number') {
                        let rarity = tInfo.rarity_score;
                        if (!Number.isFinite(rarity)) rarity = 0.5;
                        rarity = Math.max(0, Math.min(1, rarity));

                        let commonScore = Math.round((1 - rarity) * 100);
                        if (!Number.isFinite(commonScore)) commonScore = 50;
                        if (commonScore < 0) commonScore = 0;
                        if (commonScore > 100) commonScore = 100;

                        freqHtml =
                            `<span style="margin-left:6px;padding:0 5px;border-radius:9px;background:#f3f4f6;color:#555;font-size:10px;">${commonScore}</span>`;
                    }
                }

                // MODIFIED: Each entry card with proper hierarchical rendering
                html += `<div class="bh-entry-card" data-head="${head}" style="flex:0 0 auto;border:1px solid #ddd;border-radius:4px;padding:8px;background:#fafafa;max-width:360px;max-height:420px;overflow-y:auto;">`;

                // FIXED: Use renderSenseLines to parse hierarchical entries
                const sensesHtml = renderSenseLines(senses);

                html += `<div class="bh-def" data-head="${head}">`;
                html += sensesHtml;

                // Add meta tag and frequency at bottom
                if (metaTagHtml || freqHtml) {
                    html += `<div style="margin-top:6px;display:flex;align-items:center;gap:4px;">`;
                    html += metaTagHtml;
                    html += freqHtml;
                    html += `</div>`;
                }

                html += `</div>`;

                // Spelling line ONLY for unknown mains
                // Fuzzy matches as collapsible dropdown
                try {
                    const fuzzyArr = Array.isArray(res.fuzzy_matches) ? res.fuzzy_matches
                                    : Array.isArray(res.fuzzyMatches)   ? res.fuzzyMatches
                                    : Array.isArray(res.fuzzy)          ? res.fuzzy
                                    : [];

                    // Always show the unknown segment + approx pronunciation for unknown entries,
                    // even when there are no fuzzy matches.
                    if (isUnknownMain) {
                        const unknownHead = head || displayHead || '';
                        let unknownRoman = '';

                        if (typeof res.roman_inferred === 'string' && res.roman_inferred.trim()) {
                            unknownRoman = res.roman_inferred.trim();
                        } else if (typeof roman === 'string' && roman.trim()) {
                            // Fallback, just in case
                            unknownRoman = roman.trim();
                        }

                        if (unknownHead) {
                            html += `<div class="bh-def bh-unknown-def"
                                          data-head="${unknownHead}"
                                          style="margin-top:4px;margin-bottom:4px;font-size:13px;">
                                        <span style="color:#ef4444;font-weight:bold;">${unknownHead}</span>
                                        ${unknownRoman
                                            ? `<span style="margin-left:6px;font-style:italic;color:#555;">${unknownRoman}</span>`
                                            : ''}
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

    // Function to draw connecting lines from header tokens to entry cards
    function setupConnectingLines() {
        const svg = popup.querySelector('#bh-connector-svg');
        const header = popup.querySelector('.bh-sticky-header');
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

        function updateLines() {
            svg.innerHTML = '';

            const headerTokens = header.querySelectorAll('.bh-header-token');
            const popupRect = popup.getBoundingClientRect();

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

                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', x1);
                line.setAttribute('y1', y1);
                line.setAttribute('x2', x2);
                line.setAttribute('y2', y2);
                line.setAttribute('stroke', '#555');
                line.setAttribute('stroke-width', '1.5');
                line.setAttribute('opacity', '0.6');

                svg.appendChild(line);
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

    // NEW: second-level dictionary popup from words inside definitions
    async function showDefinitionLookupPopup(head) {
        const token = (head || '').trim();
        if (!token || ![...token].some(isMyanmarChar)) {
            return;
        }

        // Toggle off if clicking the same word again
        if (breakdownPopup.style.display === 'block' && lastSecondaryHead === token) {
            breakdownPopup.style.display = 'none';
            lastSecondaryHead = '';
            return;
        }

        try {
            const data = await lookupWord(token);
            if (!data.ok || !data.results || !data.results.length) {
                breakdownPopup.style.display = 'none';
                lastSecondaryHead = '';
                return;
            }

            const displayHead =
                (data && typeof data.q === 'string' && data.q.trim())
                    ? data.q.trim()
                    : token;

            let ih = `<div style="font-weight:bold;margin-bottom:4px;">${displayHead}</div>`;
            ih += `<div style="font-size:11px;color:#555;margin-bottom:8px;">Dictionary lookup (from definition):</div>`;

            // Horizontal scroller with vertically scrollable cards
            ih += `<div class="bh-entries-container-secondary" style="display:flex;flex-wrap:nowrap;gap:12px;overflow-x:auto;overflow-y:hidden;max-height:400px;padding:6px 0;">`;

            for (const res of data.results) {
                const resHead = res.head || displayHead;
                const roman   = res.roman || '';
                const pos     = res.pos || '';
                const metaPos = res.meta_pos || '';
                const senses  = res.senses || (res.gloss ? [res.gloss] : []);

                // Detect unknown main entry (same logic as main popup)
                const isUnknownMain =
                    (typeof pos === 'string' &&
                     pos.toLowerCase().includes('unknown')) ||
                    (senses.length === 1 &&
                     typeof senses[0] === 'string' &&
                     senses[0].toLowerCase().includes('no dictionary entry found'));

                let metaTagHtml = '';
                if (metaPos && META_POS_STYLES[metaPos]) {
                    metaTagHtml =
                        '<span style="' +
                        META_POS_STYLES[metaPos] +
                        '">' +
                        metaPos.toLowerCase() +
                        '</span>';
                }

                const sensesHtml = renderSenseLines(senses);

                ih += `<div class="bh-entry-card-secondary" data-head="${resHead}" style="flex:0 0 auto;border:1px solid #ddd;border-radius:4px;padding:8px;background:#fafafa;max-width:360px;max-height:420px;overflow-y:auto;">`;

                ih += `<div class="bh-def" data-head="${resHead}">`;
                ih += sensesHtml;

                if (metaTagHtml) {
                    ih += `<div style="margin-top:6px;display:flex;align-items:center;gap:4px;">${metaTagHtml}</div>`;
                }

                // If this is an unknown main entry, render fuzzy matches exactly
                // like the primary popup does.
                try {
                    const fuzzyArr = Array.isArray(res.fuzzy_matches) ? res.fuzzy_matches
                                    : Array.isArray(res.fuzzyMatches)   ? res.fuzzyMatches
                                    : Array.isArray(res.fuzzy)          ? res.fuzzy
                                    : [];

                    // Unknown segment + approx pronunciation line for unknown entries,
                    // even when there are no fuzzy matches.
                    if (isUnknownMain) {
                        const unknownHead = resHead || displayHead || '';
                        let unknownRoman = '';

                        if (typeof res.roman_inferred === 'string' && res.roman_inferred.trim()) {
                            unknownRoman = res.roman_inferred.trim();
                        } else if (roman && roman.trim()) {
                            unknownRoman = roman.trim();
                        }

                        if (unknownHead) {
                            ih += `<div class="bh-def bh-unknown-def"
                                           data-head="${unknownHead}"
                                           style="margin-top:4px;margin-bottom:4px;font-size:13px;">
                                        <span style="color:#ef4444;font-weight:bold;">${unknownHead}</span>
                                        ${unknownRoman
                                            ? `<span style="margin-left:6px;font-style:italic;color:#555;">${unknownRoman}</span>`
                                            : ''}
                                     </div>`;
                        }
                    }

                    // Fuzzy matches block only if we actually have candidates
                    if (isUnknownMain && fuzzyArr.length) {
                        // Always-visible fuzzy matches, no dropdown
                        ih += `<div class="bh-fuzzy-container-secondary" style="margin:6px 0 0 0;font-size:12px;">`;
                        ih += `<div style="font-weight:bold;color:#6b21a8;margin-bottom:2px;">Possible matches (OCR)</div>`;
                        ih += `<div style="margin-top:2px;padding-top:4px;border-top:1px solid #ddd;max-height:40vh;overflow-y:auto;">`;

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

                            const hasHierarchical = Array.isArray(fSenses) &&
                                fSenses.some(line => typeof line === 'string' && line.includes('\t'));

                            ih += `<div class="bh-def bh-fuzzy-def" data-head="${fHead}" style="margin:2px 0;padding-top:4px;border-top:1px solid #eee;">`;

                            if (hasHierarchical) {
                                if (pct) {
                                    ih += `<div style="margin-bottom:2px;">${probChip}</div>`;
                                }
                                ih += renderSenseLines(fSenses);
                            } else {
                                ih += `<div>
                                            <span style="font-weight:bold">${fHead}</span>
                                            ${fRoman ? `<span style="margin-left:4px;font-style:italic;color:#555;">${fRoman}</span>` : ''}
                                            ${fPos ? `<span style="margin-left:4px;color:#888;">[${fPos}]</span>` : ''}
                                            ${probChip}
                                       </div>`;

                                if (fSenses.length) {
                                    ih += `<ul style="margin:2px 0 4px 0;padding-left:16px;">`;
                                    for (const s of fSenses) {
                                        ih += `<li>${s}</li>`;
                                    }
                                    ih += `</ul>`;
                                }
                            }

                            ih += `</div>`; // end one fuzzy candidate
                        }

                        ih += `</div>`; // fuzzy list container
                        ih += `</div>`; // fuzzy block wrapper
                    }

                } catch (err) {
                    console.warn('[BurmeseHoverDict] fuzzy render (secondary popup) skipped (error):', err);
                }

                ih += `</div>`; // .bh-def
                ih += `</div>`; // card
            }

            ih += `</div>`; // container

            breakdownPopup.innerHTML = ih;

            // Same scroll behaviour as component breakdown: cards scroll vertically,
            // container scrolls horizontally, popup itself doesn't scroll.
            breakdownPopup.style.maxHeight = 'none';
            breakdownPopup.style.height = 'auto';
            breakdownPopup.style.overflowY = 'hidden';

            breakdownPopup.style.display = 'block';

            // Adjust breakdown popup width based on card content, capped at 90% viewport width
            adjustPopupToContent(breakdownPopup, '.bh-entries-container-secondary', 0.9);

            lastSecondaryHead = displayHead;
            lastBreakdownHead = ''; // we're no longer showing a component breakdown

        } catch (err) {
            console.error('[BurmeseHoverDict] definition lookup popup error', err);
            breakdownPopup.style.display = 'none';
            lastSecondaryHead = '';
        }
    }


    // CLICK HANDLER: stacked dictionary + headword-only component breakdown
    popup.addEventListener('click', async (e) => {
        // 1) If we clicked on a Burmese word *inside the sense text*,
        //    open a full dictionary popup stacked on top (breakdownPopup).
        const wordSpan = e.target.closest('.burmese-word');
        if (wordSpan) {
            const senseContainer = wordSpan.closest('.bh-sense-text');
            if (senseContainer) {
                const clicked = (wordSpan.textContent || '').trim();
                if (clicked && [...clicked].some(isMyanmarChar)) {
                    await showDefinitionLookupPopup(clicked);
                    return;
                }
            }
        }

        // 2) Only trigger component breakdown when clicking the dictionary headword
        //    (or the red unknown-head line).
        const headClickTarget = e.target.closest('.bh-headword, .bh-unknown-def');
        if (!headClickTarget) {
            // Click was somewhere else on the card – do nothing.
            return;
        }

        const def = e.target.closest('.bh-def, .bh-def-body');
        if (!def) {
            return;
        }

        const headAttr = def.getAttribute('data-head') || '';
        const headText = headAttr || def.textContent || '';
        const head = headText.trim();
        if (!head || ![...head].some(isMyanmarChar)) {
            breakdownPopup.style.display = 'none';
            lastBreakdownHead = '';
            lastSecondaryHead = '';
            return;
        }

        // Toggle off if clicking the same head again (component breakdown)
        if (breakdownPopup.style.display === 'block' &&
            lastBreakdownHead === head &&
            !lastSecondaryHead) {
            breakdownPopup.style.display = 'none';
            lastBreakdownHead = '';
            return;
        }

        try {
            const subsegments = await getSubsegmentsForHead(head);
            if (!subsegments || !subsegments.length) {
                breakdownPopup.style.display = 'none';
                lastBreakdownHead = '';
                return;
            }

            // Header
            let ih = `<div style="font-weight:bold;margin-bottom:4px;">${head}</div>`;
            ih += `<div style="font-size:11px;color:#555;margin-bottom:8px;">Component breakdown:</div>`;

            // Horizontal scroller - no vertical scroll on the popup itself
            ih += `<div class="bh-breakdown-container" style="display:flex;gap:12px;overflow-x:auto;overflow-y:hidden;">`;

            for (const sub of subsegments) {
                const sHead   = sub.head || '';
                const sRoman  = sub.roman || '';
                const sPos    = sub.pos || '';
                const sSenses = Array.isArray(sub.senses) ? sub.senses : [];

                if (!sHead) continue;

                const hasHierarchical = Array.isArray(sSenses) &&
                    sSenses.some(line => typeof line === 'string' && line.includes('\t'));

                // Each card - fixed height with independent vertical scroll
                ih += `<div style="flex:0 0 auto;border:1px solid #ddd;border-radius:4px;padding:8px;background:#fafafa;max-width:360px;max-height:420px;overflow-y:auto;">`;

                // Only show headword/roman/pos if NOT hierarchical (because renderSenseLines will show them)
                if (!hasHierarchical) {
                    ih += `<div style="font-weight:bold;">${sHead}</div>`;
                    if (sRoman) ih += `<div style="font-style:italic;color:#555;font-size:11px;margin-top:2px;">${sRoman}</div>`;
                    if (sPos) ih += `<div style="color:#888;font-size:10px;margin-top:2px;">[${sPos}]</div>`;
                }

                if (sSenses.length) {
                    if (hasHierarchical) {
                        // renderSenseLines will handle headword/roman/pos
                        ih += renderSenseLines(sSenses);
                    } else {
                        // Plain list
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

            breakdownPopup.innerHTML = ih;

            // Remove the popup's own scrollbar - only cards should scroll
            breakdownPopup.style.maxHeight = 'none';
            breakdownPopup.style.height = 'auto';
            breakdownPopup.style.overflowY = 'hidden';

            breakdownPopup.style.display = 'block';

            // Adjust breakdown popup width based on card content, capped at 90% viewport width
            adjustPopupToContent(breakdownPopup, '.bh-breakdown-container', 0.9);

            lastBreakdownHead = head;
            lastSecondaryHead = ''; // we're in component breakdown mode
        } catch (err) {
            console.error('[BurmeseHoverDict] breakdown popup error', err);
            breakdownPopup.style.display = 'none';
            lastBreakdownHead = '';
            lastSecondaryHead = '';
        }
    }, true);

    document.addEventListener('scroll', () => {
        innerPopup.style.display = 'none';
    }, true);

    document.addEventListener('click', (e) => {
        const span = e.target.closest && e.target.closest('.burmese-word');
        if (!span) {
            return;
        }

        // If the click is happening inside one of our own popups,
        // don't treat it as a new primary lookup. This lets the
        // secondary breakdown windows stack without closing the first.
        if (popup.contains(span) ||
            innerPopup.contains(span) ||
            breakdownPopup.contains(span)) {
            return;
        }

        showPopupForSpan(span, e.pageX, e.pageY);
    }, true);

    // CLICK-OUTSIDE HANDLER for secondary (breakdown) popup
    document.addEventListener('click', (e) => {
        if (breakdownPopup.style.display === 'block' &&
            !breakdownPopup.contains(e.target)) {

            // If the main popup is also open AND the click is outside BOTH,
            // close ONLY the secondary and keep the main visible.
            if (popup.style.display === 'flex' && !popup.contains(e.target)) {
                breakdownPopup.style.display = 'none';
                lastBreakdownHead = '';
                lastSecondaryHead = '';

                // Prevent the generic outside-click handler below from
                // also firing and closing the main popup. We want the
                // main to close last.
                e.stopImmediatePropagation();
                return;
            }

            // Otherwise (no main, or click inside main), just close the secondary.
            breakdownPopup.style.display = 'none';
            lastBreakdownHead = '';
            lastSecondaryHead = '';
        }
    }, true);

    document.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('.burmese-word')) {
            return;
        }

        if (popup.style.display === 'flex' &&
            !popup.contains(e.target) &&
            !breakdownPopup.contains(e.target)) {
            popup.style.display = 'none';
            innerPopup.style.display = 'none';
            if (currentRequest) {
                currentRequest.cancelled = true;
                currentRequest = null;
            }
        }
    }, true);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && popup.style.display === 'flex') {
            popup.style.display = 'none';
            innerPopup.style.display = 'none';
            if (currentRequest) {
                currentRequest.cancelled = true;
                currentRequest = null;
            }
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && breakdownPopup.style.display === 'block') {
            breakdownPopup.style.display = 'none';
            lastBreakdownHead = '';
            lastSecondaryHead = '';
        }
    });

    console.log('[BurmeseHoverDict] v0.99k-fixed loaded - FIXES: blank entries + random ordering');
})();
