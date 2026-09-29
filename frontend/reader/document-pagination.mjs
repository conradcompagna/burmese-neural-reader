import { hideRawTextPill } from './bootstrap-ui.mjs';
import { documentLibrariesState } from './document-libraries.state.mjs';
import { documentPaginationState } from './document-pagination.state.mjs';
import { documentState } from './document-state.state.mjs';
import { getVisibleDocxSliceText, locateDomPos } from './docx-selection.mjs';
import { triggerUpdate } from './lookup.mjs';
import { loadPdfIntoViewer } from './pdf-viewer.mjs';
import { readerState } from './reader-state.state.mjs';
export function cancelMovementLookupTimer() {
  if (!documentPaginationState.movementLookupTimer) return;
  clearTimeout(documentPaginationState.movementLookupTimer);
  documentPaginationState.movementLookupTimer = null;
}
export function requestMovementLookup() {
  cancelMovementLookupTimer();
  documentPaginationState.movementLookupTimer = setTimeout(function () {
    documentPaginationState.movementLookupTimer = null;
    triggerUpdate();
  }, documentPaginationState.MOVEMENT_LOOKUP_IDLE_MS);
}

// Original view state
export // Per-page rendering data for output panel positioned view

function setRawMode() {
  cancelMovementLookupTimer();
  documentLibrariesState.pdfJsSessionId += 1;
  documentLibrariesState.pdfJsIframe = null;
  documentPaginationState.inputMode = 'raw';
  documentPaginationState.docText = '';
  documentPaginationState.docPagerIsPaged = false;
  documentPaginationState.docPages = [];
  documentState.pdfPageDimensions = [];
  documentState.pdfAveragePageDimensions = null;
  documentPaginationState.activePageIndex = 0;
  documentPaginationState.lastLookupPageIndex = -1;
  documentPaginationState.pendingPdfLookupPageIndex = -1;
  documentPaginationState.pageLookupTextByIndex = {};
  documentPaginationState.originalLayoutCache = {};
  documentPaginationState.pdfRawTextCache = {};
  hideRawTextPill();
  if (readerState.sourcePager) {
    readerState.sourcePager.classList.remove('orig-view-mode');
    readerState.sourcePager.style.display = 'none';
    readerState.sourcePager.innerHTML = '';
  }
  if (readerState.sourceText) {
    readerState.sourceText.style.display = 'block';
    readerState.sourceText.disabled = false;
    readerState.sourceText.readOnly = false;
  }
  documentPaginationState.pdfjsTextLayerCache = {};
  applyDocPagerHeight();
}
export function setDocMode(text) {
  documentPaginationState.inputMode = 'doc';
  documentPaginationState.docText = (text || '').replace(/\r\n/g, '\n');
  documentPaginationState.docPagerIsPaged = false;
  console.log('[setDocMode] Loaded text, chars:', documentPaginationState.docText.length);
  if (readerState.sourceText) readerState.sourceText.style.display = 'none';
  if (readerState.sourcePager) {
    readerState.sourcePager.style.display = 'block';
    renderDocTextIntoPager(documentPaginationState.docText);
    readerState.sourcePager.scrollTop = 0;
    applyDocPagerHeight();
  }
  triggerUpdate();
}
export function getFixedPdfPagerHeightPx() {
  // Prefer an A4-like viewport (height ~= width * 1.414) for PDF mode.
  var baseH = Math.ceil(documentPaginationState.DOC_LINES_CONTENT * documentPaginationState.docLineHeight);
  if (!isFinite(baseH) || baseH <= 0) baseH = 600;
  var pagerW = 0;
  if (readerState.sourcePager) {
    var rect = readerState.sourcePager.getBoundingClientRect();
    pagerW = Math.floor(readerState.sourcePager.clientWidth || rect.width || 0);
  }
  var a4H = pagerW > 0 ? Math.ceil(pagerW * 1.41421356) : 0;

  // Keep a visibly larger PDF viewport while avoiding extreme sizes.
  var h = Math.max(baseH, a4H, 760);
  return Math.min(1180, Math.max(240, h));
}
export function setPagedMode(pages) {
  // Legacy stub - redirects to PDF.js viewer for PDFs
  if (documentPaginationState.currentFileType === 'pdf' && documentPaginationState.pdfCacheId) {
    loadPdfIntoViewer(documentPaginationState.pdfCacheId, pages);
    return;
  }
  // For non-PDF paged content, fall through to doc mode
  documentPaginationState.inputMode = 'doc';
  documentPaginationState.docPages = normalizePages(pages || []);
  documentPaginationState.activePageIndex = 0;
  documentPaginationState.lastLookupPageIndex = -1;
  documentPaginationState.pendingPdfLookupPageIndex = -1;
  if (readerState.sourceText) readerState.sourceText.style.display = 'none';
  if (readerState.sourcePager) {
    readerState.sourcePager.style.display = 'block';
    readerState.sourcePager.scrollTop = 0;
  }
  triggerUpdate();
}
export function normalizePages(pages) {
  var out = [];
  if (!Array.isArray(pages) || !pages.length) return [''];
  for (var i = 0; i < pages.length; i++) {
    var p = pages[i] || '';
    p = p.replace(/\r\n/g, '\n');
    out.push(p);
  }
  return out.length ? out : [''];
}
export function renderDocTextIntoPager(text) {
  if (!readerState.sourcePager) return;
  readerState.sourcePager.innerHTML = '';
  documentPaginationState.docPagerIsPaged = false;
  var textEl = document.createElement('div');
  textEl.className = 'reader-doc-text';
  textEl.textContent = text || '';
  readerState.sourcePager.appendChild(textEl);
  // Calculate line height from rendered text
  calculateDocLineHeight();
}
export function calculateDocLineHeight() {
  if (!readerState.sourcePager) return;
  var textEl = readerState.sourcePager.querySelector('.reader-doc-text');
  if (!textEl) return;
  // Create a temporary single-line element to measure line height
  var measurer = document.createElement('div');
  measurer.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;';
  measurer.textContent = 'M';
  textEl.appendChild(measurer);
  var h = measurer.getBoundingClientRect().height;
  textEl.removeChild(measurer);
  if (h > 0) documentPaginationState.docLineHeight = h;
}
export function applyDocPagerHeight() {
  if (!readerState.sourcePager) return;
  var hasContent = documentPaginationState.docText && documentPaginationState.docText.trim().length > 0;
  var lines = hasContent
    ? documentPaginationState.DOC_LINES_CONTENT
    : documentPaginationState.DOC_LINES_EMPTY;
  var h = Math.ceil(lines * documentPaginationState.docLineHeight);
  readerState.sourcePager.style.height = h + 'px';
  readerState.sourcePager.style.maxHeight = h + 'px';
  readerState.sourcePager.style.overflowY = hasContent ? 'auto' : 'hidden';
}
export function getDocVisibleText() {
  if (!readerState.sourcePager || !documentPaginationState.docText) return '';
  var textEl = readerState.sourcePager.querySelector('.reader-doc-text');
  if (!textEl) return documentPaginationState.docText.slice(0, documentPaginationState.WINDOWED_MAX_CHARS);

  // Find the text node inside the element
  var textNode = null;
  for (var i = 0; i < textEl.childNodes.length; i++) {
    if (textEl.childNodes[i].nodeType === Node.TEXT_NODE && textEl.childNodes[i].textContent.length > 0) {
      textNode = textEl.childNodes[i];
      break;
    }
  }
  if (!textNode) return documentPaginationState.docText.slice(0, documentPaginationState.WINDOWED_MAX_CHARS);
  var textLength = textNode.textContent.length;
  if (textLength === 0) return '';

  // Get viewport bounds relative to sourcePager
  var containerRect = readerState.sourcePager.getBoundingClientRect();
  var viewTop = containerRect.top;
  var viewBottom = containerRect.bottom;
  function getCharRect(index) {
    var range = document.createRange();
    var safeIndex = Math.max(0, Math.min(index, textLength - 1));
    range.setStart(textNode, safeIndex);
    range.setEnd(textNode, Math.min(safeIndex + 1, textLength));
    var rects = range.getClientRects();
    if (rects && rects.length) return rects[0];
    return range.getBoundingClientRect();
  }
  function getCharTop(index) {
    return getCharRect(index).top;
  }
  function getCharBottom(index) {
    return getCharRect(index).bottom;
  }
  function findFirstPartiallyVisible() {
    var lo = 0,
      hi = textLength - 1;
    var result = 0;
    while (lo <= hi) {
      var mid = Math.floor((lo + hi) / 2);
      var y = getCharBottom(mid);
      if (y < viewTop) {
        lo = mid + 1;
      } else {
        result = mid;
        hi = mid - 1;
      }
    }
    return result;
  }
  function findLastPartiallyVisible() {
    var lo = 0,
      hi = textLength - 1;
    var result = textLength - 1;
    while (lo <= hi) {
      var mid = Math.floor((lo + hi) / 2);
      var y = getCharTop(mid);
      if (y > viewBottom) {
        hi = mid - 1;
      } else {
        result = mid;
        lo = mid + 1;
      }
    }
    return result;
  }
  var lineTol = Math.max(1, documentPaginationState.docLineHeight * 0.35);
  function findLineStart(idx) {
    var lineY = getCharTop(idx);
    var target = lineY - lineTol;
    var lo = 0,
      hi = idx;
    var result = idx;
    while (lo <= hi) {
      var mid = Math.floor((lo + hi) / 2);
      var y = getCharTop(mid);
      if (y < target) {
        lo = mid + 1;
      } else {
        result = mid;
        hi = mid - 1;
      }
    }
    return result;
  }
  function findLineEnd(idx) {
    var lineY = getCharTop(idx);
    var target = lineY + lineTol;
    var lo = idx,
      hi = textLength - 1;
    var result = idx;
    while (lo <= hi) {
      var mid = Math.floor((lo + hi) / 2);
      var y = getCharTop(mid);
      if (y > target) {
        hi = mid - 1;
      } else {
        result = mid;
        lo = mid + 1;
      }
    }
    return result + 1;
  }
  function getLineBounds(idx) {
    var start = findLineStart(idx);
    var end = findLineEnd(idx);
    return {
      start: start,
      end: end
    };
  }
  function getLineVisibilityRatio(bounds) {
    if (!bounds) return 0;
    var start = bounds.start;
    var end = bounds.end;
    var endIdx = Math.max(start, Math.min(textLength - 1, end - 1));
    var lineTop = getCharTop(start);
    var lineBottom = getCharBottom(endIdx);
    var visibleTop = Math.max(lineTop, viewTop);
    var visibleBottom = Math.min(lineBottom, viewBottom);
    var visible = Math.max(0, visibleBottom - visibleTop);
    var height = Math.max(1, lineBottom - lineTop);
    return visible / height;
  }
  var firstPartial = findFirstPartiallyVisible();
  var lastPartial = findLastPartiallyVisible();
  if (firstPartial > lastPartial) {
    var fallback = Math.max(0, Math.min(textLength - 1, lastPartial));
    if (!isFinite(fallback) || fallback < 0 || fallback >= textLength) {
      fallback = Math.max(0, Math.min(textLength - 1, firstPartial));
    }
    firstPartial = fallback;
    lastPartial = fallback;
  }
  var topBounds = getLineBounds(firstPartial);
  var bottomBounds = getLineBounds(lastPartial);
  var topRatio = getLineVisibilityRatio(topBounds);
  var bottomRatio = getLineVisibilityRatio(bottomBounds);
  var startIdx = topBounds.start;
  var endIdx = bottomBounds.end;
  if (topRatio < documentPaginationState.DOC_LINE_VISIBILITY_THRESHOLD) {
    startIdx = topBounds.end;
  }
  if (bottomRatio < documentPaginationState.DOC_LINE_VISIBILITY_THRESHOLD) {
    endIdx = bottomBounds.start;
  }
  if (startIdx >= endIdx) {
    if (topRatio >= bottomRatio) {
      startIdx = topBounds.start;
      endIdx = topBounds.end;
    } else {
      startIdx = bottomBounds.start;
      endIdx = bottomBounds.end;
    }
  }
  var maxChars = documentPaginationState.WINDOWED_MAX_CHARS;
  var guard = 0;
  while (endIdx - startIdx > maxChars && guard < 200) {
    var prevLineStart = findLineStart(endIdx - 1);
    if (prevLineStart <= startIdx) break;
    endIdx = prevLineStart;
    guard++;
  }
  var visibleText = textNode.textContent.slice(startIdx, endIdx);
  if (visibleText.length > maxChars) {
    visibleText = visibleText.slice(0, maxChars);
  }
  console.log(
    '[getDocVisibleText] chars',
    startIdx,
    '-',
    endIdx,
    'of',
    textLength,
    '| visible:',
    visibleText.length
  );
  return visibleText;
}
export function snapToLine() {
  if (
    !readerState.sourcePager ||
    !documentPaginationState.docText ||
    documentPaginationState.inputMode !== 'doc'
  )
    return;
  var textEl = readerState.sourcePager.querySelector('.reader-doc-text');
  if (!textEl) return false;
  var textNode = null;
  for (var i = 0; i < textEl.childNodes.length; i++) {
    if (textEl.childNodes[i].nodeType === Node.TEXT_NODE && textEl.childNodes[i].textContent.length > 0) {
      textNode = textEl.childNodes[i];
      break;
    }
  }
  if (!textNode) return false;
  var textLength = textNode.textContent.length;
  if (textLength === 0) return false;
  var containerRect = readerState.sourcePager.getBoundingClientRect();
  var viewTop = containerRect.top;
  var viewBottom = containerRect.bottom;
  function getCharRect(index) {
    var range = document.createRange();
    var safeIndex = Math.max(0, Math.min(index, textLength - 1));
    range.setStart(textNode, safeIndex);
    range.setEnd(textNode, Math.min(safeIndex + 1, textLength));
    var rects = range.getClientRects();
    if (rects && rects.length) return rects[0];
    return range.getBoundingClientRect();
  }
  function getCharTop(index) {
    return getCharRect(index).top;
  }
  function getCharBottom(index) {
    return getCharRect(index).bottom;
  }
  function findFirstPartiallyVisible() {
    var lo = 0,
      hi = textLength - 1;
    var result = 0;
    while (lo <= hi) {
      var mid = Math.floor((lo + hi) / 2);
      var y = getCharBottom(mid);
      if (y < viewTop) {
        lo = mid + 1;
      } else {
        result = mid;
        hi = mid - 1;
      }
    }
    return result;
  }
  function findLastPartiallyVisible() {
    var lo = 0,
      hi = textLength - 1;
    var result = textLength - 1;
    while (lo <= hi) {
      var mid = Math.floor((lo + hi) / 2);
      var y = getCharTop(mid);
      if (y > viewBottom) {
        hi = mid - 1;
      } else {
        result = mid;
        lo = mid + 1;
      }
    }
    return result;
  }
  var startIdx = findFirstPartiallyVisible();
  var endIdx = findLastPartiallyVisible();
  if (startIdx > endIdx) endIdx = startIdx;
  var range = document.createRange();
  range.setStart(textNode, startIdx);
  range.setEnd(textNode, Math.min(endIdx + 1, textLength));
  var rects = range.getClientRects();
  if (!rects || !rects.length) {
    var singleRect = getCharRect(startIdx);
    if (!singleRect || !isFinite(singleRect.top)) return false;
    rects = [singleRect];
  }
  var lineTops = [];
  var lastTop = null;
  for (var r = 0; r < rects.length; r++) {
    var rect = rects[r];
    if (!rect || rect.height <= 0) continue;
    var top = rect.top;
    if (lastTop === null || Math.abs(top - lastTop) > 0.5) {
      lineTops.push(top);
      lastTop = top;
    }
  }
  if (!lineTops.length) return false;
  var scrollTop = readerState.sourcePager.scrollTop;
  var bestScroll = null;
  var bestDist = Infinity;
  for (var t = 0; t < lineTops.length; t++) {
    var targetScroll = scrollTop + (lineTops[t] - containerRect.top);
    var dist = Math.abs(targetScroll - scrollTop);
    if (dist < bestDist) {
      bestDist = dist;
      bestScroll = targetScroll;
    }
  }
  if (bestScroll == null) return false;
  if (Math.abs(bestScroll - scrollTop) > 1) {
    var maxScroll = Math.max(
      0,
      readerState.sourcePager.scrollHeight - readerState.sourcePager.clientHeight
    );
    var clamped = Math.max(0, Math.min(Math.round(bestScroll), maxScroll));
    if (Math.abs(clamped - scrollTop) <= 1) return false;
    readerState.sourcePager.scrollTo({
      top: clamped,
      behavior: 'smooth'
    });
    return true;
  }
  return false;
}
export function snapDocxToLine() {
  if (
    !readerState.sourcePager ||
    documentPaginationState.inputMode !== 'doc' ||
    !documentPaginationState.isOriginalView ||
    documentPaginationState.currentFileType !== 'docx'
  )
    return false;
  var host = readerState.sourcePager.querySelector('.docx-preview-host');
  if (!host) return false;
  var sliceInfo = getVisibleDocxSliceText(readerState.sourcePager);
  if (!sliceInfo || !sliceInfo.model || !sliceInfo.model.text) return false;
  var startIdx = Math.max(0, sliceInfo.start || 0);
  var endIdx = Math.max(startIdx, sliceInfo.end || 0);
  if (endIdx <= startIdx) endIdx = Math.min(startIdx + 1, sliceInfo.model.text.length);
  var containerRect = readerState.sourcePager.getBoundingClientRect();
  var scrollTop = readerState.sourcePager.scrollTop;
  try {
    var a = locateDomPos(sliceInfo.model, startIdx);
    var b = locateDomPos(sliceInfo.model, endIdx);
    if (!a || !b) return false;
    var range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    var rects = range.getClientRects();
    if (!rects || !rects.length) {
      var a2 = locateDomPos(sliceInfo.model, startIdx);
      if (!a2 || !a2.node) return false;
      var nodeLen2 = a2.node.nodeValue ? a2.node.nodeValue.length : 0;
      if (!nodeLen2) return false;
      var range2 = document.createRange();
      range2.setStart(a2.node, a2.offset);
      range2.setEnd(a2.node, Math.min(a2.offset + 1, nodeLen2));
      var rects2 = range2.getClientRects();
      if (!rects2 || !rects2.length) return false;
      rects = rects2;
    }
    var lineTops = [];
    var lastTop = null;
    for (var r = 0; r < rects.length; r++) {
      var rect = rects[r];
      if (!rect || rect.height <= 0) continue;
      var top = rect.top;
      if (lastTop === null || Math.abs(top - lastTop) > 0.5) {
        lineTops.push(top);
        lastTop = top;
      }
    }
    if (!lineTops.length) return false;
    var bestScroll = null;
    var bestDist = Infinity;
    for (var t = 0; t < lineTops.length; t++) {
      var targetScroll = scrollTop + (lineTops[t] - containerRect.top);
      var dist = Math.abs(targetScroll - scrollTop);
      if (dist < bestDist) {
        bestDist = dist;
        bestScroll = targetScroll;
      }
    }
    if (bestScroll == null) return false;
    if (Math.abs(bestScroll - scrollTop) > 1) {
      var maxScroll = Math.max(
        0,
        readerState.sourcePager.scrollHeight - readerState.sourcePager.clientHeight
      );
      var clamped = Math.max(0, Math.min(Math.round(bestScroll), maxScroll));
      if (Math.abs(clamped - scrollTop) <= 1) return false;
      readerState.sourcePager.scrollTo({
        top: clamped,
        behavior: 'smooth'
      });
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}
export function initializeDocumentPagination() {
  // Original view toggle refs
  documentPaginationState.origViewToggle = document.getElementById('origViewToggle');
  documentPaginationState.origViewCheckbox = document.getElementById('origViewCheckbox');

  // ------------------------------
  // Document viewing (continuous text)
  // ------------------------------

  documentPaginationState.inputMode = 'raw';
  documentPaginationState.docText = ''; // Full document text (continuous, no pages)
  documentPaginationState.WINDOWED_MAX_CHARS = 5000;
  documentPaginationState.DOC_LINES_EMPTY = 5; // Height in lines when empty
  documentPaginationState.DOC_LINES_CONTENT = 30; // Height in lines when content loaded
  documentPaginationState.docLineHeight = 20; // Will be calculated from actual font
  documentPaginationState.DOC_LINE_VISIBILITY_THRESHOLD = 0.5;
  documentPaginationState.docPagerIsPaged = false; // True when sourcePager holds page elements

  // Legacy compatibility stubs (original view mode disabled)
  documentPaginationState.docPages = [];
  documentPaginationState.activePageIndex = 0;
  documentPaginationState.lastLookupPageIndex = -1;
  documentPaginationState.pendingPdfLookupPageIndex = -1;
  documentPaginationState.pageLookupTextByIndex = {};
  documentPaginationState.MOVEMENT_LOOKUP_IDLE_MS = 1000;
  documentPaginationState.movementLookupTimer = null;
  documentPaginationState.currentFile = null; // Store the File object for re-fetching
  documentPaginationState.currentFileType = null; // 'pdf', 'docx', or 'text'
  documentPaginationState.pdfCacheId = null; // Server-side cached PDF ID (avoids re-upload)
  documentPaginationState.isOriginalView = false; // Toggle state (controls layout vs raw text for segmentation)
  documentPaginationState.originalLayoutCache = {}; // Cached layout text per page index
  documentPaginationState.pdfRawTextCache = {}; // Cached raw page text per page index (from /api/pdf_page_text)
  documentPaginationState.usePdfjsTextLayer = false; // Toggle: use PDF.js text layer instead of backend extraction
  documentPaginationState.pdfjsTextLayerCache = {}; // pageIndex -> { innerHTML, plainText, layerClass, layerStyle, computedScaleFactor, computedTotalScaleFactor, viewportWidth, viewportHeight }
  documentPaginationState.renderedPageImages = {
    byIndex: {}
  };
  return true;
}
