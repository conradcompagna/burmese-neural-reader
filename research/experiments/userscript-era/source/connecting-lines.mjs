import { popupLifecycleState } from './popup-lifecycle.state.mjs';
export // MODIFIED: Function to draw connecting lines - visible but fade over pronunciation
function setupConnectingLines() {
  const svg = popupLifecycleState.popup.querySelector('#bh-connector-svg');
  const header = popupLifecycleState.popup.querySelector('.bh-sticky-header');
  const g2pLayer = popupLifecycleState.popup.querySelector('.bh-g2p-layer');
  const entriesContainer = popupLifecycleState.popup.querySelector('.bh-entries-container');
  const entryCards = popupLifecycleState.popup.querySelectorAll('.bh-entry-card');
  if (!svg || !header || !entriesContainer) return;
  const visibilityMap = new Map();
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        visibilityMap.set(entry.target, entry.isIntersecting);
      });
      updateLines();
    },
    {
      root: entriesContainer,
      threshold: 0.1
    }
  );
  entryCards.forEach((card) => {
    visibilityMap.set(card, false);
    observer.observe(card);
  });

  // Create gradient definitions for fading lines
  let defsCreated = false;
  function updateLines() {
    svg.innerHTML = '';
    const headerTokens = header.querySelectorAll('.bh-header-token');
    const popupRect = popupLifecycleState.popup.getBoundingClientRect();

    // Get G2P layer bounds if present
    let g2pTop = null,
      g2pBottom = null;
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
    entryCards.forEach((card) => {
      const isVisible = visibilityMap.get(card);
      if (!isVisible) return;
      const headText = card.getAttribute('data-head');
      if (!headText) return;
      let matchingToken = null;
      headerTokens.forEach((token) => {
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
