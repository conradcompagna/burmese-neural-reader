import { attachPopupClickHandlers } from './components.mjs';
import { renderSenseLines } from './dictionary-rendering.mjs';
import { isMyanmarChar } from './graphemes.mjs';
import { hoverState } from './hover.state.mjs';
import { adjustPopupToContent, createNestedPopup } from './popup-lifecycle.mjs';
import { posOverlayState } from './pos-overlay.state.mjs';
import { wrapMyanmarInElement } from './text-wrapping.mjs';
import { lookupWord } from './transport.mjs';
export // CHANGED: second-level dictionary popup from words inside definitions - now creates nested popups dynamically
async function showDefinitionLookupPopup(head) {
  const token = (head || '').trim();
  if (!token || ![...token].some(isMyanmarChar)) {
    return;
  }

  // Don't open exact same nested dictionary popup twice in a row
  if (token === hoverState.lastSecondaryHead) {
    return;
  }
  try {
    const data = await lookupWord(token);
    if (!data.ok || !data.results || !data.results.length) {
      return;
    }
    const displayHead = data && typeof data.q === 'string' && data.q.trim() ? data.q.trim() : token;

    // Record last opened nested dictionary head (raw token)
    hoverState.lastSecondaryHead = token;

    // CHANGED: Create new nested popup instead of reusing single element
    const nestedPopup = createNestedPopup();
    posOverlayState.nestedPopups.push(nestedPopup);

    // Centered, no descriptive subtitle
    let ih = `<div class="bh-popup-header-secondary" style="font-weight:bold;margin-bottom:4px;text-align:center;">${displayHead}</div>`;

    // Horizontal scroller with vertically scrollable cards
    ih += `<div class="bh-entries-container-secondary" style="display:flex;flex-wrap:nowrap;gap:12px;overflow-x:auto;overflow-y:hidden;max-height:400px;padding:6px 0;">`;
    for (const res of data.results) {
      const resHead = res.head || displayHead;
      const roman = res.roman || '';
      const pos = res.pos || '';
      const senses = res.senses || (res.gloss ? [res.gloss] : []);

      // Detect unknown main entry (same logic as main popup)
      const isUnknownMain =
        (typeof pos === 'string' && pos.toLowerCase().includes('unknown')) ||
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
    defEls.forEach((el) => wrapMyanmarInElement(el));

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
