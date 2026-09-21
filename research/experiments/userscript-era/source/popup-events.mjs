import { popupLifecycleState } from './popup-lifecycle.state.mjs';
export function initializePopupEvents() {
  popupLifecycleState.popup.addEventListener('mousemove', (e) => {
    const target = e.target.closest('.bh-sub');
    if (!target) {
      popupLifecycleState.innerPopup.style.display = 'none';
      return;
    }
    const encoded = target.getAttribute('data-sub');
    if (!encoded) {
      popupLifecycleState.innerPopup.style.display = 'none';
      return;
    }
    let payload;
    try {
      payload = JSON.parse(decodeURIComponent(encoded));
    } catch (err) {
      console.warn('[BurmeseHoverDict] failed to decode component payload', err);
      popupLifecycleState.innerPopup.style.display = 'none';
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
    popupLifecycleState.innerPopup.innerHTML = ih;
    const offsetX = 10;
    const offsetY = 10;
    let x = e.pageX + offsetX;
    let y = e.pageY + offsetY;
    const approxWidth = 320;
    if (x + approxWidth > window.innerWidth + window.scrollX) {
      x = e.pageX - approxWidth - offsetX;
    }
    popupLifecycleState.innerPopup.style.left = x + 'px';
    popupLifecycleState.innerPopup.style.top = y + 'px';
    popupLifecycleState.innerPopup.style.display = 'block';
  });

  // CHANGED: second-level dictionary popup from words inside definitions - now creates nested popups dynamically
  return true;
}
