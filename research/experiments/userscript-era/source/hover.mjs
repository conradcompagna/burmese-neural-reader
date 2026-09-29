import { hoverState } from './hover.state.mjs';
import { isInEditable } from './popup-lifecycle.mjs';
import { pronunciationState } from './pronunciation.state.mjs';
import { initWrap, walk } from './text-wrapping.mjs';
export // ADDED: Attach instant tooltip handlers for header tokens and POS cells
function attachInstantTooltipHandlers(container) {
  // Header tokens (rarity)
  const headerTokens = container.querySelectorAll('.bh-header-token[data-rarity-score]');
  headerTokens.forEach((token) => {
    token.addEventListener('mouseenter', (e) => {
      const score = token.getAttribute('data-rarity-score');
      if (score !== null && score !== '') {
        pronunciationState.instantTooltip.textContent = `Frequency: ${score}`;
        const rect = token.getBoundingClientRect();
        pronunciationState.instantTooltip.style.left = rect.left + rect.width / 2 + 'px';
        pronunciationState.instantTooltip.style.top = rect.bottom + 4 + 'px';
        pronunciationState.instantTooltip.style.transform = 'translateX(-50%)';
        pronunciationState.instantTooltip.style.display = 'block';
      }
    });
    token.addEventListener('mouseleave', () => {
      pronunciationState.instantTooltip.style.display = 'none';
    });
  });

  // POS cells (confidence)
  const posCells = container.querySelectorAll('.bh-pos-cell[data-pos-confidence]');
  posCells.forEach((cell) => {
    cell.addEventListener('mouseenter', (e) => {
      const conf = cell.getAttribute('data-pos-confidence');
      if (conf !== null && conf !== '') {
        pronunciationState.instantTooltip.textContent = `Confidence: ${conf}%`;
        const rect = cell.getBoundingClientRect();
        pronunciationState.instantTooltip.style.left = rect.left + rect.width / 2 + 'px';
        pronunciationState.instantTooltip.style.top = rect.bottom + 4 + 'px';
        pronunciationState.instantTooltip.style.transform = 'translateX(-50%)';
        pronunciationState.instantTooltip.style.display = 'block';
      }
    });
    cell.addEventListener('mouseleave', () => {
      pronunciationState.instantTooltip.style.display = 'none';
    });
  });
}
export function initializeHover() {
  // initial passes (for static content)
  setTimeout(initWrap, 500);
  setTimeout(initWrap, 2000);

  // observe dynamic content (e.g. chat messages)
  hoverState.observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        // If this added node (or its parent) is inside an editable area, ignore it
        if (isInEditable(node)) continue;
        walk(node);
      }
    }
  });
  hoverState.observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // ADDED: Track current request to allow cancellation
  hoverState.currentRequest = null;
  hoverState.lastBreakdownHead = '';
  hoverState.lastSecondaryHead = '';
  return true;
}
