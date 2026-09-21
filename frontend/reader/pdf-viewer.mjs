import { documentLibrariesState } from './document-libraries.state.mjs';
import { getFixedPdfPagerHeightPx, normalizePages } from './document-pagination.mjs';
import { documentPaginationState } from './document-pagination.state.mjs';
import { computeAveragePdfDimension } from './document-state.mjs';
import { documentState } from './document-state.state.mjs';
import { triggerUpdate } from './lookup.mjs';
import { readerState } from './reader-state.state.mjs';
import { applyGlobalViewportClamp } from './viewport-layout.mjs';
export // increments on each PDF load to ignore stale iframe events

function buildPdfJsIframeSrc(cacheId, sessionId) {
  var qs =
    '?cache_id=' +
    encodeURIComponent(cacheId || '') +
    '&session_id=' +
    encodeURIComponent(String(sessionId || ''));
  return '/static/pdfjs_iframe_viewer.html' + qs;
}
export function postPdfPageDimsCacheToIframe() {
  if (!documentLibrariesState.pdfJsIframe || !documentLibrariesState.pdfJsIframe.contentWindow) return;
  try {
    documentLibrariesState.pdfJsIframe.contentWindow.postMessage(
      {
        source: 'reader-parent',
        type: 'pdfjs-set-page-dims-cache',
        sessionId: String(documentLibrariesState.pdfJsSessionId),
        pageDims: Array.isArray(documentState.pdfPageDimensions)
          ? documentState.pdfPageDimensions
          : []
      },
      window.location.origin
    );
  } catch (e) {
    // ignore
  }
}
export function mountPdfJsIframe(cacheId) {
  if (!readerState.sourcePager) return;
  readerState.sourcePager.innerHTML = '';
  var iframe = document.createElement('iframe');
  iframe.className = 'pdfjs-host-iframe';
  iframe.title = 'PDF.js Viewer';
  iframe.src = buildPdfJsIframeSrc(cacheId, documentLibrariesState.pdfJsSessionId);
  iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
  iframe.addEventListener('load', function () {
    postPdfPageDimsCacheToIframe();
  });
  readerState.sourcePager.appendChild(iframe);
  documentLibrariesState.pdfJsIframe = iframe;
}
export function loadPdfIntoViewer(cacheId, pages) {
  documentPaginationState.docPages = normalizePages(pages || []);
  documentPaginationState.pdfCacheId = cacheId;
  documentPaginationState.activePageIndex = 0;
  documentPaginationState.lastLookupPageIndex = -1;
  documentPaginationState.pendingPdfLookupPageIndex = -1;
  documentPaginationState.pageLookupTextByIndex = {};
  documentPaginationState.originalLayoutCache = {};
  documentPaginationState.pdfRawTextCache = {};
  if (!documentState.pdfAveragePageDimensions) {
    documentState.pdfAveragePageDimensions = computeAveragePdfDimension(
      documentState.pdfPageDimensions
    );
  }
  documentPaginationState.inputMode = 'pdf';
  documentPaginationState.docPagerIsPaged = false;
  if (readerState.sourceText) readerState.sourceText.style.display = 'none';
  if (readerState.sourcePager) {
    readerState.sourcePager.style.display = 'block';
    readerState.sourcePager.classList.add('pdfjs-native-mode');
    readerState.sourcePager.classList.remove('orig-view-mode');
    readerState.sourcePager.scrollTop = 0;
    var fixedH = getFixedPdfPagerHeightPx();
    readerState.sourcePager.style.height = fixedH + 'px';
    readerState.sourcePager.style.maxHeight = fixedH + 'px';
    readerState.sourcePager.style.visibility = 'visible';
    readerState.sourcePager.style.pointerEvents = '';
    applyGlobalViewportClamp(true);
  }
  readerState.statusText.textContent = 'Loading PDF viewer...';
  documentLibrariesState.pdfJsSessionId += 1;
  documentPaginationState.pdfjsTextLayerCache = {};
  mountPdfJsIframe(cacheId);
  requestAnimationFrame(function () {
    applyGlobalViewportClamp(true);
    triggerUpdate();
  });
}
