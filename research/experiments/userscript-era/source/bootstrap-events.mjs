import { attachPopupClickHandlers } from './components.mjs';
import { showPopupForSpan } from './definitions.mjs';
import { hoverState } from './hover.state.mjs';
import { popupLifecycleState } from './popup-lifecycle.state.mjs';
import { posOverlayState } from './pos-overlay.state.mjs';
import { pronunciationState } from './pronunciation.state.mjs';
export function initializeBootstrapEvents() {
  // CHANGED: Attach handlers to main popup
  attachPopupClickHandlers(popupLifecycleState.popup);
  document.addEventListener(
    'scroll',
    () => {
      popupLifecycleState.innerPopup.style.display = 'none';
      pronunciationState.syllPopup.style.display = 'none';
      pronunciationState.instantTooltip.style.display = 'none';
    },
    true
  );
  document.addEventListener(
    'click',
    (e) => {
      const span = e.target.closest && e.target.closest('.burmese-word');
      if (!span) {
        return;
      }

      // If the click is happening inside one of our own popups,
      // don't treat it as a new primary lookup. This lets the
      // secondary breakdown windows stack without closing the first.
      if (popupLifecycleState.popup.contains(span)) {
        return;
      }

      // CHANGED: Check all nested popups
      for (const np of posOverlayState.nestedPopups) {
        if (np.contains(span)) {
          return;
        }
      }
      showPopupForSpan(span, e.pageX, e.pageY);
    },
    true
  );

  // CHANGED: Click-outside handler - close only topmost popup when clicking anywhere outside it
  document.addEventListener(
    'click',
    (e) => {
      // Don't treat clicks on Burmese page text as "outside" – those are for opening the main popup
      const wordSpan = e.target.closest && e.target.closest('.burmese-word');
      if (wordSpan && !popupLifecycleState.popup.contains(wordSpan)) {
        // Let the other click handler handle the lookup
        return;
      }

      // Check if click is inside the topmost nested popup
      if (posOverlayState.nestedPopups.length > 0) {
        const topPopup = posOverlayState.nestedPopups[posOverlayState.nestedPopups.length - 1];
        if (!topPopup.contains(e.target)) {
          // Click is outside topmost nested popup - close only the topmost
          posOverlayState.nestedPopups.pop();
          topPopup.style.display = 'none';
          topPopup.remove();

          // Reset repeat guards after closing a nested popup
          hoverState.lastBreakdownHead = '';
          hoverState.lastSecondaryHead = '';
          pronunciationState.syllPopup.style.display = 'none';
          pronunciationState.instantTooltip.style.display = 'none';
          return;
        }
      } else if (
        popupLifecycleState.popup.style.display === 'flex' &&
        !popupLifecycleState.popup.contains(e.target)
      ) {
        // No nested popups, click is outside main popup - close only main
        popupLifecycleState.popup.style.display = 'none';
        popupLifecycleState.innerPopup.style.display = 'none';
        pronunciationState.syllPopup.style.display = 'none';
        pronunciationState.instantTooltip.style.display = 'none';
        if (hoverState.currentRequest) {
          hoverState.currentRequest.cancelled = true;
          hoverState.currentRequest = null;
        }

        // Reset repeat guards when the main popup closes
        hoverState.lastBreakdownHead = '';
        hoverState.lastSecondaryHead = '';
      }
    },
    true
  );

  // CHANGED: ESC key handler - close ALL popups at once
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Close all nested popups
      while (posOverlayState.nestedPopups.length > 0) {
        const np = posOverlayState.nestedPopups.pop();
        np.style.display = 'none';
        np.remove();
      }

      // Close main popup
      if (popupLifecycleState.popup.style.display === 'flex') {
        popupLifecycleState.popup.style.display = 'none';
        popupLifecycleState.innerPopup.style.display = 'none';
        pronunciationState.syllPopup.style.display = 'none';
        pronunciationState.instantTooltip.style.display = 'none';
        if (hoverState.currentRequest) {
          hoverState.currentRequest.cancelled = true;
          hoverState.currentRequest = null;
        }
      }

      // Reset repeat guards after closing everything
      hoverState.lastBreakdownHead = '';
      hoverState.lastSecondaryHead = '';
      pronunciationState.currentG2P = null;
    }
  });

  // Hide syllable breakdown popup when clicking anywhere that's not a syllable or the popup itself
  document.addEventListener(
    'click',
    (e) => {
      if (!e.target.closest('.bh-g2p-syll') && !pronunciationState.syllPopup.contains(e.target)) {
        pronunciationState.syllPopup.style.display = 'none';
      }
    },
    true
  );
  console.log(
    '[BurmeseHoverDict] v0.99m-grammar loaded - Unlimited nested popups + POS grammar overlay enabled'
  );
  return true;
}
