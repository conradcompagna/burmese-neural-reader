import { documentLibrariesState } from './document-libraries.state.mjs';
import { documentPaginationState } from './document-pagination.state.mjs';
import { sanitizePdfDimension } from './document-state.mjs';
import { documentState } from './document-state.state.mjs';
import { readerState } from './reader-state.state.mjs';
import { computePageMaxHeightPx } from './viewport-layout.mjs';
export function renderAllPdfPages(pdfDoc) {
  if (!readerState.sourcePager) return;
  documentLibrariesState.pdfJsRenderedPages = {};
  resizePagerToFitPdfPage();
  var pageSize = getPdfTargetPageSize();
  var container = document.createElement('div');
  container.className = 'pdfjs-pages-container';
  readerState.sourcePager.appendChild(container);
  var numPages = pdfDoc.numPages;
  for (var i = 1; i <= numPages; i++) {
    var pageDiv = document.createElement('div');
    pageDiv.className = 'pdfjs-page';
    pageDiv.dataset.pageNum = String(i);
    applyPdfPageShellSize(pageDiv, pageSize);
    pageDiv.style.background = '#e5e7eb';
    appendPdfPageHeader(pageDiv, i, numPages);
    container.appendChild(pageDiv);
  }

  // Clean up previous observer
  if (documentLibrariesState.pdfJsObserver) {
    documentLibrariesState.pdfJsObserver.disconnect();
    documentLibrariesState.pdfJsObserver = null;
  }

  // Use IntersectionObserver for lazy rendering
  documentLibrariesState.pdfJsObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var pageNum = parseInt(entry.target.dataset.pageNum);
          if (!documentLibrariesState.pdfJsRenderedPages[pageNum]) {
            documentLibrariesState.pdfJsRenderedPages[pageNum] = true;
            renderSinglePdfPage(pdfDoc, pageNum, entry.target);
          }
        }
      });
    },
    {
      root: readerState.sourcePager,
      rootMargin: '400px'
    }
  );
  var allPages = container.querySelectorAll('.pdfjs-page');
  for (var j = 0; j < allPages.length; j++) {
    documentLibrariesState.pdfJsObserver.observe(allPages[j]);
  }
}
export function getPdfTargetPageSize() {
  var width = 0;
  if (readerState.sourcePager) {
    var rect = readerState.sourcePager.getBoundingClientRect();
    width = Math.floor(readerState.sourcePager.clientWidth || rect.width || 0);
  }
  if (!isFinite(width) || width <= 0) width = 600;
  var height = computePageMaxHeightPx();
  if (!isFinite(height) || height <= 0) {
    height = Math.ceil(width * 1.414);
  }
  return {
    width: Math.max(1, width),
    height: Math.max(180, Math.floor(height))
  };
}
export function applyPdfPageShellSize(pageDiv, pageSize) {
  if (!pageDiv || !pageSize) return;
  pageDiv.style.width = '100%';
  pageDiv.style.height = pageSize.height + 'px';
  pageDiv.style.minHeight = pageSize.height + 'px';
}
export function appendPdfPageHeader(pageDiv, pageNum, numPages) {
  var pageHeader = document.createElement('div');
  pageHeader.className = 'pdfjs-page-header';
  pageHeader.textContent = 'Page ' + pageNum + ' / ' + numPages;
  pageDiv.appendChild(pageHeader);
}
export function getPdfPageDimensionsFor(pageNum, fallbackWidth, fallbackHeight) {
  var idx = Math.max(0, (pageNum | 0) - 1);
  var dim = sanitizePdfDimension(documentState.pdfPageDimensions[idx]);
  if (dim) return dim;
  dim = sanitizePdfDimension(documentState.pdfAveragePageDimensions);
  if (dim) return dim;
  dim = sanitizePdfDimension({
    width: fallbackWidth,
    height: fallbackHeight
  });
  if (dim) return dim;
  return {
    width: 1,
    height: 1
  };
}
export function resizePagerToFitPdfPage() {
  if (!readerState.sourcePager || documentPaginationState.inputMode !== 'pdf') return;
  var pageSize = getPdfTargetPageSize();
  readerState.sourcePager.style.height = pageSize.height + 'px';
  readerState.sourcePager.style.maxHeight = pageSize.height + 'px';
}
export function renderSinglePdfPage(pdfDoc, pageNum, pageDiv) {
  pdfDoc.getPage(pageNum).then(function (page) {
    var baseViewport = page.getViewport({
      scale: 1.0
    });
    var pageSize = getPdfTargetPageSize();
    applyPdfPageShellSize(pageDiv, pageSize);
    var pageRect = pageDiv.getBoundingClientRect();
    var targetW = Math.max(1, Math.floor(pageRect.width || pageSize.width));
    var targetH = Math.max(1, Math.floor(pageRect.height || pageSize.height));
    var inputDim = getPdfPageDimensionsFor(pageNum, baseViewport.width, baseViewport.height);
    var fitRatio = Math.min(targetW / Math.max(1, inputDim.width), targetH / Math.max(1, inputDim.height));
    if (!isFinite(fitRatio) || fitRatio <= 0) {
      fitRatio = Math.min(
        targetW / Math.max(1, baseViewport.width),
        targetH / Math.max(1, baseViewport.height)
      );
    }
    if (!isFinite(fitRatio) || fitRatio <= 0) fitRatio = 1.0;
    var desiredW = Math.max(1, Math.round(inputDim.width * fitRatio));
    var desiredH = Math.max(1, Math.round(inputDim.height * fitRatio));
    var scaleW = desiredW / Math.max(1, baseViewport.width);
    var scaleH = desiredH / Math.max(1, baseViewport.height);
    var renderScale = scaleW;
    if (!isFinite(renderScale) || renderScale <= 0) renderScale = scaleH;
    if (!isFinite(renderScale) || renderScale <= 0) renderScale = fitRatio;
    if (!isFinite(renderScale) || renderScale <= 0) renderScale = 1.0;
    var scaledViewport = page.getViewport({
      scale: renderScale
    });
    var renderW = Math.max(1, Math.floor(scaledViewport.width));
    var renderH = Math.max(1, Math.floor(scaledViewport.height));
    var offsetX = Math.max(0, Math.floor((targetW - renderW) / 2));
    var offsetY = Math.max(0, Math.floor((targetH - renderH) / 2));
    pageDiv.innerHTML = '';
    pageDiv.style.background = '';
    pageDiv.style.position = 'relative';
    applyPdfPageShellSize(pageDiv, pageSize);
    var numPages = pdfDoc.numPages;
    appendPdfPageHeader(pageDiv, pageNum, numPages);
    var canvas = document.createElement('canvas');
    canvas.className = 'pdfjs-page-canvas';
    canvas.width = renderW;
    canvas.height = renderH;
    canvas.style.position = 'absolute';
    canvas.style.left = offsetX + 'px';
    canvas.style.top = offsetY + 'px';
    canvas.style.width = renderW + 'px';
    canvas.style.height = renderH + 'px';
    pageDiv.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    page
      .render({
        canvasContext: ctx,
        viewport: scaledViewport
      })
      .promise.then(function () {
        return page.getTextContent();
      })
      .then(function (textContent) {
        if (window.pdfjsLib && window.pdfjsLib.renderTextLayer) {
          var textLayer = document.createElement('div');
          textLayer.className = 'textLayer';
          textLayer.style.position = 'absolute';
          textLayer.style.left = offsetX + 'px';
          textLayer.style.top = offsetY + 'px';
          textLayer.style.right = 'auto';
          textLayer.style.bottom = 'auto';
          textLayer.style.width = renderW + 'px';
          textLayer.style.height = renderH + 'px';
          pageDiv.appendChild(textLayer);
          window.pdfjsLib.renderTextLayer({
            textContent: textContent,
            container: textLayer,
            viewport: scaledViewport,
            textDivs: []
          });
        }
      })
      .catch(function (err) {
        console.error('PDF.js page render error:', err);
      });
  });
}

// Fetch geometrically-aware layout text for a specific page from the server
