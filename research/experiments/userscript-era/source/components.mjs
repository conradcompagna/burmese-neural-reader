import { renderSenseLines } from './dictionary-rendering.mjs';
import { isMyanmarChar } from './graphemes.mjs';
import { hoverState } from './hover.state.mjs';
import { showDefinitionLookupPopup } from './lookup-popups.mjs';
import { adjustPopupToContent, createNestedPopup } from './popup-lifecycle.mjs';
import { posOverlayState } from './pos-overlay.state.mjs';
import { wrapMyanmarInElement } from './text-wrapping.mjs';
import { getSubsegmentsForHead } from './transport.mjs';
export // CHANGED: Component breakdown now creates nested popups dynamically
async function showComponentBreakdown(head, sourcePopup) {
  const token = (head || '').trim();
  if (!token || ![...token].some(isMyanmarChar)) {
    return;
  }

  // Don't open the exact same breakdown twice in a row
  if (token === hoverState.lastBreakdownHead) {
    return;
  }
  try {
    const subsegments = await getSubsegmentsForHead(token);
    if (!subsegments || !subsegments.length) {
      return;
    }

    // Record last opened breakdown head
    hoverState.lastBreakdownHead = token;

    // CHANGED: Create new nested popup instead of reusing single element
    const nestedPopup = createNestedPopup();
    posOverlayState.nestedPopups.push(nestedPopup);

    // Centered, no descriptive subtitle
    let ih = `<div class="bh-popup-header-secondary" style="font-weight:bold;margin-bottom:4px;text-align:center;">${token}</div>`;
    ih += `<div class="bh-breakdown-container" style="display:flex;gap:12px;overflow-x:auto;overflow-y:hidden;">`;
    for (const sub of subsegments) {
      const sHead = sub.head || '';
      const sRoman = sub.roman || '';
      const sPos = sub.pos || '';
      const sSenses = Array.isArray(sub.senses) ? sub.senses : [];
      if (!sHead) continue;
      const hasHierarchical =
        Array.isArray(sSenses) && sSenses.some((line) => typeof line === 'string' && line.includes('\t'));

      // Treat unknown/no-entry subsegments as irreducible leaves
      const isUnknownPos = typeof sPos === 'string' && sPos.toLowerCase().includes('unknown');
      const hasNoEntrySense =
        sSenses.length === 1 &&
        typeof sSenses[0] === 'string' &&
        sSenses[0].toLowerCase().includes('no dictionary entry found');
      const isIrreducible = sub.irreducible === true || isUnknownPos || hasNoEntrySense;
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
        if (sRoman)
          ih += `<div style="font-style:italic;color:#555;font-size:11px;margin-top:2px;">${sRoman}</div>`;
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
    defEls.forEach((el) => wrapMyanmarInElement(el));

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
export function attachPopupClickHandlers(targetPopup) {
  targetPopup.addEventListener(
    'click',
    async (e) => {
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
    },
    true
  );
}

// CHANGED: Attach handlers to main popup
