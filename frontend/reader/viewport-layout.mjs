import { documentLibrariesState } from './document-libraries.state.mjs';
import {
  getFixedPdfPagerHeightPx,
  requestMovementLookup,
  snapDocxToLine,
  snapToLine
} from './document-pagination.mjs';
import { documentPaginationState } from './document-pagination.state.mjs';
import { triggerUpdate } from './lookup.mjs';
import { postPdfPageDimsCacheToIframe } from './pdf-viewer.mjs';
import { getRawMaxHeightPx, getRawMinHeightPx } from './raw-text-sizing.mjs';
import { readerState } from './reader-state.state.mjs';
import { escapeHtml } from './text.mjs';
import { viewportLayoutState } from './viewport-layout.state.mjs';
export function computePageMaxHeightPx() {
  var baseEl = readerState.sourcePager || readerState.sourceText;
  var w = baseEl ? baseEl.getBoundingClientRect().width || 0 : 0;

  // Default: A4-ish aspect ratio (1.414)
  var aspect = 1.414;
  if (w > 0) {
    return Math.ceil(w * aspect);
  }
  return Math.ceil(window.innerHeight * 0.5);
}
export function applyGlobalViewportClamp(forceCollapse) {
  var h = computePageMaxHeightPx();
  if (isFinite(h) && h > 0) viewportLayoutState.lastPageHeightPx = h;
  var pagerMin = 180;
  var textMin = 180;
  var textMax = h;
  if (readerState.sourcePager) {
    readerState.sourcePager.style.setProperty('--pageMaxH', h + 'px');
    readerState.sourcePager.style.setProperty('--pageH', h + 'px');
    if (documentPaginationState.inputMode === 'pdf') {
      // Keep PDF viewport fixed to the doc-mode content window height.
      var fixedPdfH = getFixedPdfPagerHeightPx();
      readerState.sourcePager.style.height = fixedPdfH + 'px';
      readerState.sourcePager.style.maxHeight = fixedPdfH + 'px';
    } else if (documentPaginationState.inputMode === 'paged') {
      // In paged mode, set to exact page height
      readerState.sourcePager.style.height = h + 'px';
      readerState.sourcePager.style.maxHeight = h + 'px';
    } else {
      readerState.sourcePager.style.maxHeight = h + 'px';
      if (forceCollapse) {
        readerState.sourcePager.style.height = pagerMin + 'px';
      }
    }
  }
  if (readerState.sourceText) {
    if (documentPaginationState.inputMode === 'raw') {
      var rawMax = getRawMaxHeightPx();
      if (rawMax > 0) {
        textMax = Math.max(h, rawMax);
        var rawMin = getRawMinHeightPx();
        if (rawMin > 0) textMin = Math.max(textMin, rawMin);
        if (textMin > textMax) textMin = textMax;
      }
    }
    readerState.sourceText.style.setProperty('--pageMaxH', textMax + 'px');
    readerState.sourceText.style.setProperty('--pageH', textMax + 'px');
    readerState.sourceText.style.maxHeight = textMax + 'px';
    if (forceCollapse) {
      readerState.sourceText.style.height = textMin + 'px';
    }
  }
}

// ---- PDF.js iframe bridge (movement/page events -> active page) ----
export function handlePagerScrollStop() {
  if (documentPaginationState.inputMode === 'pdf') {
    // PDF.js mode: page tracking comes from iframe postMessage events.
    return;
  }
  if (documentPaginationState.inputMode !== 'doc') return;
  if (documentPaginationState.isOriginalView && documentPaginationState.currentFileType === 'docx') {
    snapDocxToLine();
  } else {
    snapToLine();
  }
}
export function initializeViewportLayout() {
  viewportLayoutState.lastPageHeightPx = 0;
  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin) return;
    var data = event.data || {};
    if (!data || data.source !== 'pdfjs-iframe') return;
    if (String(data.sessionId || '') !== String(documentLibrariesState.pdfJsSessionId)) return;
    if (documentPaginationState.inputMode !== 'pdf') return;
    if (data.type === 'pdfjs-error') {
      readerState.statusText.textContent = 'Failed to load PDF viewer.';
      if (readerState.renderedText) {
        readerState.renderedText.innerHTML =
          '<div class="reader-output-placeholder">PDF.js iframe error: ' +
          escapeHtml(String(data.error || 'unknown')) +
          '</div>';
      }
      return;
    }
    if (data.type === 'pdfjs-ready') {
      postPdfPageDimsCacheToIframe();
      readerState.statusText.textContent =
        'Ready (' + (documentPaginationState.docPages.length || 0) + ' pages).';
      return;
    }
    if (data.type === 'pdfjs-dimensions') {
      if (readerState.sourcePager) {
        // Fixed-viewport mode: do not adjust container height from page dimensions.
        readerState.sourcePager.style.visibility = 'visible';
        readerState.sourcePager.style.pointerEvents = '';
      }
      return;
    }
    if (data.type === 'pdfjs-scroll') {
      var scrollIdx = Number(data.pageIndex);
      if (isFinite(scrollIdx)) {
        scrollIdx = Math.floor(scrollIdx);
        if (scrollIdx >= 0) {
          var maxScrollIdx = Math.max(0, (documentPaginationState.docPages.length || 1) - 1);
          if (scrollIdx > maxScrollIdx) scrollIdx = maxScrollIdx;
          if (scrollIdx !== documentPaginationState.activePageIndex) {
            documentPaginationState.activePageIndex = scrollIdx;
          }
        }
      }
      requestMovementLookup();
      return;
    }
    if (data.type === 'pdfjs-text-layer') {
      if (data.error) {
        console.warn('PDF.js text layer error:', data.error);
        return;
      }
      var tlIdx = Number(data.pageIndex);
      if (isFinite(tlIdx) && tlIdx >= 0) {
        documentPaginationState.pdfjsTextLayerCache[tlIdx] = {
          innerHTML: typeof data.innerHTML === 'string' ? data.innerHTML : '',
          plainText: typeof data.plainText === 'string' ? data.plainText : '',
          layerClass: typeof data.layerClass === 'string' ? data.layerClass : 'textLayer',
          layerStyle: typeof data.layerStyle === 'string' ? data.layerStyle : '',
          computedScaleFactor: Number(data.computedScaleFactor) || 1,
          computedTotalScaleFactor:
            Number(data.computedTotalScaleFactor) || Number(data.computedScaleFactor) || 1,
          viewportWidth: Number(data.viewportWidth) || 0,
          viewportHeight: Number(data.viewportHeight) || 0
        };
        if (documentPaginationState.usePdfjsTextLayer) triggerUpdate();
      }
      return;
    }
    if (data.type !== 'pdfjs-pagechange') return;
    var idx = Number(data.pageIndex);
    if (!isFinite(idx)) return;
    idx = Math.floor(idx);
    if (idx < 0) return;
    var maxIdx = Math.max(0, (documentPaginationState.docPages.length || 1) - 1);
    if (idx > maxIdx) idx = maxIdx;
    if (idx === documentPaginationState.activePageIndex) return;
    documentPaginationState.activePageIndex = idx;
    requestMovementLookup();
  });
  viewportLayoutState.pagerPointerDown = false;
  viewportLayoutState.pagerScrollPending = false;
  if (readerState.sourcePager) {
    readerState.sourcePager.addEventListener('mousedown', function (ev) {
      if (ev && ev.button === 0) viewportLayoutState.pagerPointerDown = true;
    });
    readerState.sourcePager.addEventListener(
      'touchstart',
      function () {
        viewportLayoutState.pagerPointerDown = true;
      },
      {
        passive: true
      }
    );
  }
  window.addEventListener('mouseup', function () {
    if (!viewportLayoutState.pagerPointerDown) return;
    viewportLayoutState.pagerPointerDown = false;
    if (viewportLayoutState.pagerScrollPending) {
      viewportLayoutState.pagerScrollPending = false;
      handlePagerScrollStop();
    }
  });
  window.addEventListener('touchend', function () {
    if (!viewportLayoutState.pagerPointerDown) return;
    viewportLayoutState.pagerPointerDown = false;
    if (viewportLayoutState.pagerScrollPending) {
      viewportLayoutState.pagerScrollPending = false;
      handlePagerScrollStop();
    }
  });
  return true;
}
