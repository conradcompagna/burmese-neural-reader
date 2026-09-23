import { invalidateUdRectCache, invalidateUiRectCache } from './dependency-geometry.mjs';
import { dependencyState } from './dependency-state.state.mjs';
import { documentLibrariesState } from './document-libraries.state.mjs';
import { requestMovementLookup } from './document-pagination.mjs';
import { documentPaginationState } from './document-pagination.state.mjs';
import { readerState } from './reader-state.state.mjs';
import { debounce } from './text.mjs';
import { applyGlobalViewportClamp } from './viewport-layout.mjs';
import { viewportLayoutState } from './viewport-layout.state.mjs';
export // Map from segment index to ALL token span fragments

function rebuildUdCaches(udOverlay) {
  dependencyState.latestUdTokenMap = {};
  dependencyState.latestCollapsedSpanInfo = {};
  dependencyState.latestUdStructure = null;
  if (!udOverlay || !Array.isArray(udOverlay.tokens)) return;
  var tokens = udOverlay.tokens;
  var tokenMap = {};
  var children = {};
  var parentOf = {};
  var tokenPosition = {};
  var tokenIds = [];
  for (var i = 0; i < tokens.length; i++) {
    var tok = tokens[i];
    if (!tok || typeof tok.i !== 'number') continue;
    tokenMap[tok.i] = tok;
    dependencyState.latestUdTokenMap[tok.i] = tok;
    children[tok.i] = [];
    tokenIds.push(tok.i);
    var pos = typeof tok.doc_i === 'number' && isFinite(tok.doc_i) ? tok.doc_i : i;
    tokenPosition[tok.i] = pos;
    if (tok.seg_span && Array.isArray(tok.seg_span) && tok.seg_span.length > 1) {
      var firstSeg = tok.seg_span[0];
      var lastSeg = tok.seg_span[tok.seg_span.length - 1];
      var combinedText = tok.text || '';
      for (var si = 0; si < tok.seg_span.length; si++) {
        var segIdx = tok.seg_span[si];
        dependencyState.latestCollapsedSpanInfo[segIdx] = {
          firstSeg: firstSeg,
          lastSeg: lastSeg,
          combinedText: combinedText,
          udTok: tok,
          isFirst: segIdx === firstSeg
        };
      }
    }
  }
  for (var j = 0; j < tokens.length; j++) {
    var t = tokens[j];
    if (!t || typeof t.i !== 'number') continue;
    var headIdx = t.head;
    if (headIdx !== undefined && headIdx !== t.i && tokenMap[headIdx]) {
      children[headIdx].push(t.i);
      parentOf[t.i] = headIdx;
    }
  }
  var roots = [];
  for (var k = 0; k < tokenIds.length; k++) {
    var seg = tokenIds[k];
    if (parentOf[seg] === undefined) roots.push(seg);
  }
  var tokenDepths = {};
  var maxDepth = 0;
  var queue = roots.slice();
  for (var qi = 0; qi < queue.length; qi++) {
    var cur = queue[qi];
    tokenDepths[cur] = 0;
  }
  for (var q = 0; q < queue.length; q++) {
    var cur2 = queue[q];
    var ch = children[cur2] || [];
    for (var c = 0; c < ch.length; c++) {
      var child = ch[c];
      if (tokenDepths[child] === undefined) {
        tokenDepths[child] = tokenDepths[cur2] + 1;
        if (tokenDepths[child] > maxDepth) maxDepth = tokenDepths[child];
        queue.push(child);
      }
    }
  }
  dependencyState.latestUdStructure = {
    tokenMap: tokenMap,
    children: children,
    parentOf: parentOf,
    tokenPosition: tokenPosition,
    tokenDepths: tokenDepths,
    maxDepth: maxDepth,
    tokenIds: tokenIds
  };
}
export function setLatestUdOverlay(udOverlay) {
  dependencyState.latestUdOverlay = udOverlay || null;
  dependencyState.latestNerSpans =
    dependencyState.latestUdOverlay && Array.isArray(dependencyState.latestUdOverlay.ents)
      ? dependencyState.latestUdOverlay.ents
      : [];
  rebuildUdCaches(dependencyState.latestUdOverlay);
}
export function isDocxOriginalActive() {
  return !!(documentPaginationState.isOriginalView && documentPaginationState.currentFileType === 'docx');
}
export function registerTokenSpan(segIdx, span) {
  if (segIdx == null || segIdx < 0 || !span) return;
  if (!isDocxOriginalActive()) {
    // Default behavior: last span wins (preserves PDF original view behavior)
    dependencyState.udTokenIndex.set(segIdx, span);
    return;
  }
  if (!dependencyState.udTokenIndex.has(segIdx)) {
    dependencyState.udTokenIndex.set(segIdx, span);
  }
  var list = dependencyState.udTokenFragments.get(segIdx);
  if (!list) {
    list = [];
    dependencyState.udTokenFragments.set(segIdx, list);
  }
  if (list.indexOf(span) === -1) {
    list.push(span);
  }
}
export function clearUdTokenIndex() {
  dependencyState.udTokenIndex.clear();
  dependencyState.udTokenFragments.clear();
}
export function getTokenSpanList(segIdx) {
  if (isDocxOriginalActive()) {
    var list = dependencyState.udTokenFragments.get(segIdx);
    if (list && list.length) return list;
  }
  var single = dependencyState.udTokenIndex.get(segIdx);
  return single ? [single] : [];
}
// === UD GEOMETRY / CLEANUP CACHES ===
export function initializeDependencyState() {
  if (readerState.sourcePager) {
    readerState.sourcePager.addEventListener('scroll', function () {
      if (documentPaginationState.inputMode === 'pdf') {
        // PDF scroll happens inside the iframe, not on sourcePager.
        return;
      }
      if (documentPaginationState.inputMode !== 'doc') return;
      if (viewportLayoutState.pagerPointerDown) viewportLayoutState.pagerScrollPending = true;
      requestMovementLookup();
    });
  }
  dependencyState.rerenderPdfPagesOnResizeDebounced = debounce(function () {
    if (
      documentPaginationState.inputMode !== 'pdf' ||
      !documentLibrariesState.pdfJsIframe ||
      !documentLibrariesState.pdfJsIframe.contentWindow
    )
      return;
    try {
      documentLibrariesState.pdfJsIframe.contentWindow.postMessage(
        {
          source: 'reader-parent',
          type: 'pdfjs-parent-resize',
          sessionId: String(documentLibrariesState.pdfJsSessionId)
        },
        window.location.origin
      );
    } catch (e) {
      // ignore
    }
  }, 120);
  window.addEventListener('resize', function () {
    applyGlobalViewportClamp(false);
    invalidateUdRectCache();
    invalidateUiRectCache();
    dependencyState.rerenderPdfPagesOnResizeDebounced();
  });
  applyGlobalViewportClamp(true);

  // ===================== UD DEPENDENCY VISUALIZATION =====================
  dependencyState.udSvgOverlay = null;
  dependencyState.latestUdOverlay = null;
  dependencyState.latestNerSpans = [];
  dependencyState.latestCollapsedSpanInfo = {}; // Map segIdx -> { firstSeg, lastSeg, combinedText, udTok, isFirst }
  dependencyState.latestUdTokenMap = {}; // Map segIdx -> UD token
  dependencyState.latestUdStructure = null; // Cached UD structural maps for chunking
  dependencyState.udTokenIndex = new Map(); // Map from segment index to first token span element
  dependencyState.udTokenFragments = new Map();
  dependencyState.udTokenRectCache = new Map(); // segIdx -> {left, top, width, height, right, bottom, cx, cy}
  return true;
}
