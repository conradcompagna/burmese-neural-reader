import { setupConnectingLines } from './connecting-lines.mjs';
import { burmeseLength, renderSenseLines } from './dictionary-rendering.mjs';
import { isMyanmarChar } from './graphemes.mjs';
import { attachInstantTooltipHandlers } from './hover.mjs';
import { hoverState } from './hover.state.mjs';
import { adjustPopupToContent } from './popup-lifecycle.mjs';
import { popupLifecycleState } from './popup-lifecycle.state.mjs';
import { applyPosOverlayToPopup } from './pos-overlay.mjs';
import { attachG2PHandlers, buildG2PLayerHtml } from './pronunciation.mjs';
import { pronunciationState } from './pronunciation.state.mjs';
import { wrapMyanmarInElement } from './text-wrapping.mjs';
import { lookupWord } from './transport.mjs';
export async function showPopupForSpan(span, pageX, pageY) {
  const chunk = span.textContent.trim();
  if (!chunk || ![...chunk].some(isMyanmarChar)) {
    return;
  }

  // MODIFIED: Helper to build LM-aware header with rarity-based coloring
  function buildHeaderHtml(displayHead, data, segmentRarityMap) {
    const segments = Array.isArray(data.segments) ? data.segments : [];
    const lmOverlay = data && typeof data.lm_overlay === 'object' ? data.lm_overlay : null;
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
      let i = typeof e.i === 'number' ? e.i : null;
      let j = typeof e.j === 'number' ? e.j : null;
      const s = typeof e.strength === 'number' ? e.strength : 0;
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
      let start = typeof ph.start === 'number' ? ph.start : null;
      let end = typeof ph.end === 'number' ? ph.end : null;

      // Fallback if backend uses "span": [start, end)
      if ((start == null || end == null) && Array.isArray(ph.span) && ph.span.length === 2) {
        start = ph.span[0];
        end = ph.span[1];
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
        const thickness = 1 + clamped * 3; // 1–4 px
        const alpha = 0.15 + clamped * 0.6; // 0.15–0.75
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
  if (hoverState.currentRequest) {
    hoverState.currentRequest.cancelled = true;
  }
  const thisRequest = {
    cancelled: false
  };
  hoverState.currentRequest = thisRequest;
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
    const displayHead = data && typeof data.q === 'string' && data.q.trim() ? data.q.trim() : chunk;
    const segments = Array.isArray(data.segments) ? data.segments : [];
    const lmOverlay = data && typeof data.lm_overlay === 'object' ? data.lm_overlay : null;
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
    pronunciationState.currentG2P = g2pForUi;

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
        (senses.length === 1 &&
          typeof senses[0] === 'string' &&
          senses[0].toLowerCase().includes('no dictionary entry found'));
      if (isUnknown) {
        unknownSegments.add(head);
      }
    }

    // Populate segmentRarityMap
    for (const seg of segments) {
      if (unknownSegments.has(seg)) {
        segmentRarityMap.set(seg, {
          isUnknown: true,
          commonScore: 0
        });
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
          segmentRarityMap.set(seg, {
            isUnknown: false,
            commonScore
          });
        }
      }
    }

    // LM-aware header with rarity coloring
    let headerHtml = buildHeaderHtml(displayHead, data, segmentRarityMap);

    // Create sticky header container
    let html = `<div class="bh-sticky-header" style="position:sticky;top:0;background:white;z-index:10;padding:6px 8px;border-bottom:1px solid #ddd;display:flex;justify-content:center;align-items:center;">${headerHtml}</div>`;

    // NEW: Pronunciation / syllable layer between header and dictionary cards
    if (pronunciationState.currentG2P) {
      html += buildG2PLayerHtml(pronunciationState.currentG2P, segments);
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
        (typeof pos === 'string' && pos.toLowerCase().includes('unknown')) ||
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
        const fuzzyArr = Array.isArray(res.fuzzy_matches)
          ? res.fuzzy_matches
          : Array.isArray(res.fuzzyMatches)
            ? res.fuzzyMatches
            : Array.isArray(res.fuzzy)
              ? res.fuzzy
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
            const fHead = fm ? fm.head || fm.candidate || '' : '';
            const fRoman = fm && fm.roman ? fm.roman : '';
            const fPos = fm && fm.pos ? fm.pos : '';
            const fSenses = fm && Array.isArray(fm.senses) ? fm.senses : fm && fm.gloss ? [fm.gloss] : [];

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
            const hasHierarchical =
              Array.isArray(fSenses) &&
              fSenses.some((line) => typeof line === 'string' && line.includes('\t'));

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

    popupLifecycleState.popup.innerHTML = html;

    // Apply grammar POS overlay to this popup, if available
    try {
      applyPosOverlayToPopup(popupLifecycleState.popup, data);
    } catch (e) {
      console.warn('[BurmeseHoverDict] POS overlay UI error (main popup):', e);
    }

    // ADDED: Attach instant tooltip handlers
    attachInstantTooltipHandlers(popupLifecycleState.popup);

    // Attach syllable-level handlers for pronunciation layer (if present)
    if (pronunciationState.currentG2P) {
      attachG2PHandlers(popupLifecycleState.popup, pronunciationState.currentG2P);
    }

    // NEW: wrap Myanmar inside definition text so clicks see .burmese-word spans
    const senseEls = popupLifecycleState.popup.querySelectorAll('.bh-sense-text');
    senseEls.forEach((el) => wrapMyanmarInElement(el));

    // Dynamic width based on content: let the popup expand
    // naturally to fit the entry cards, up to maxWidth (90vw).
    popupLifecycleState.popup.style.width = 'auto';

    // Add rotation animation for details arrows
    const detailsElements = popupLifecycleState.popup.querySelectorAll('details');
    detailsElements.forEach((details) => {
      const arrow = details.querySelector('summary span');
      if (arrow) {
        arrow.style.transform = details.open ? 'rotate(90deg)' : 'rotate(0deg)';
      }
    });
    popupLifecycleState.popup.style.display = 'flex';

    // Adjust popup width based on card content, capped at 90% viewport width
    adjustPopupToContent(popupLifecycleState.popup, '.bh-entries-container', 0.9);

    // Setup connecting lines
    setupConnectingLines();
  } catch (e) {
    console.error('[BurmeseHoverDict] lookup error', e);
    if (!thisRequest.cancelled) {
      popupLifecycleState.popup.innerHTML =
        '<div style="color:#b00020;padding:4px;">⚠️ Connection error. Is the server running?<br/><small style="color:#666;">python burmese_dict_server.py</small></div>';
      popupLifecycleState.popup.style.width = '400px';
      popupLifecycleState.popup.style.display = 'flex';
      setTimeout(() => {
        if (
          popupLifecycleState.popup.style.display === 'flex' &&
          popupLifecycleState.popup.innerHTML.includes('Connection error')
        ) {
          popupLifecycleState.popup.style.display = 'none';
        }
      }, 3000);
    }
  }
}

// MODIFIED: Function to draw connecting lines - visible but fade over pronunciation
