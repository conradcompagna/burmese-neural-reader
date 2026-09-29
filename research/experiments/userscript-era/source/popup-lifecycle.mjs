import { graphemesState } from './graphemes.state.mjs';
import { popupLifecycleState } from './popup-lifecycle.state.mjs';
import { posOverlayState } from './pos-overlay.state.mjs';
import { pronunciationState } from './pronunciation.state.mjs';
export // ---- helper: is this node inside an editable/input area? ----
function isInEditable(node) {
  let el = node.nodeType === 1 ? node : node.parentNode;
  while (el && el !== document.body) {
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return true;
    el = el.parentNode;
  }
  return false;
}

// ---- single sticky popup ----
export // CHANGED: Function to create nested popups dynamically (replaces single breakdownPopup)
function createNestedPopup() {
  const nestedPopup = document.createElement('div');
  nestedPopup.className = 'burmese-hover-nested-popup';
  const zIndex = graphemesState.BASE_Z_INDEX + posOverlayState.nestedPopups.length;
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
  nestedPopup.addEventListener('wheel', (e) => e.stopPropagation(), {
    capture: true,
    passive: true
  });
  return nestedPopup;
}

// NEW: shared helper to fit popup width to its card container, capped at a fraction of viewport width
export function adjustPopupToContent(popupEl, containerSelector, maxVwFraction) {
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
export function initializePopupLifecycle() {
  popupLifecycleState.popup = document.createElement('div');
  popupLifecycleState.popup.id = 'burmese-hover-popup';
  Object.assign(popupLifecycleState.popup.style, {
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
    maxHeight: '80vh',
    // NEW: cap height
    height: 'auto',
    // NEW: let content determine height
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    display: 'none',
    flexDirection: 'column'
  });
  document.body.appendChild(popupLifecycleState.popup);

  // NEW: inner tooltip popup for components (popup-within-popup on hover)
  popupLifecycleState.innerPopup = document.createElement('div');
  popupLifecycleState.innerPopup.id = 'burmese-hover-inner-popup';
  Object.assign(popupLifecycleState.innerPopup.style, {
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
  document.body.appendChild(popupLifecycleState.innerPopup);
  popupLifecycleState.popup.addEventListener('mousedown', (e) => e.stopPropagation(), true);
  popupLifecycleState.popup.addEventListener('click', (e) => e.stopPropagation(), true);
  popupLifecycleState.popup.addEventListener('wheel', (e) => e.stopPropagation(), {
    capture: true,
    passive: true
  });

  // Hide inner popup (and syllable popup) when leaving the main popup
  popupLifecycleState.popup.addEventListener('mouseleave', () => {
    popupLifecycleState.innerPopup.style.display = 'none';
    pronunciationState.syllPopup.style.display = 'none';
  });

  // ADDED: Cache management
  return true;
}
