import {
  isAbortError,
  isShowingInitialInputGuidance,
  showRawTextPill,
  startSegmentLookupFetch
} from './bootstrap-ui.mjs';
import { clearChunkHighlight } from './chunk-highlighting.mjs';
import { computeChunks } from './chunk-model.mjs';
import { chunkModelState } from './chunk-model.state.mjs';
import {
  buildUdRectCache,
  hideUdLines,
  invalidateUdRectCache,
  invalidateUiRectCache
} from './dependency-geometry.mjs';
import { dependencyGeometryState } from './dependency-geometry.state.mjs';
import { clearUdTokenIndex, registerTokenSpan, setLatestUdOverlay } from './dependency-state.mjs';
import { dependencyState } from './dependency-state.state.mjs';
import { applyOffsetsAsTokenSpansOnDom } from './document-annotations.mjs';
import { cancelMovementLookupTimer, getDocVisibleText } from './document-pagination.mjs';
import { documentPaginationState } from './document-pagination.state.mjs';
import { documentState } from './document-state.state.mjs';
import { fetchPageLayoutText, fetchPdfjsTextLayer } from './document-text.mjs';
import { buildVisibleDocxSliceFragment, getVisibleDocxSliceText } from './docx-selection.mjs';
import { hideNerHover } from './entity-hover.mjs';
import { loadTextAsDoc } from './file-import.mjs';
import { attachHoverHandlers, computeAndCacheRowBands } from './hover-interaction.mjs';
import { hoverInteractionState } from './hover-interaction.state.mjs';
import { rebuildConnectedIslandGroups } from './island-groups.mjs';
import { buildLookupUrl } from './preferences.mjs';
import { findRawOverflowIndex, updateRenderedOutputBackground } from './raw-text-sizing.mjs';
import { readerState } from './reader-state.state.mjs';
import { renderSegments } from './segment-rendering.mjs';
import { settingsState } from './settings-state.state.mjs';
import { escapeHtml } from './text.mjs';
export function docxOriginalLookupNow() {
  if (!documentState.docxOriginal.rendered) {
    readerState.statusText.textContent = 'Loading DOCX layout...';
    readerState.statusCounts.textContent = '';
    return;
  }
  var sliceInfo = getVisibleDocxSliceText(readerState.sourcePager);
  var sliceText = sliceInfo && sliceInfo.text ? sliceInfo.text : '';
  var sliceFragInfo = buildVisibleDocxSliceFragment(sliceInfo);
  var sliceRoot = sliceFragInfo ? sliceFragInfo.sliceRoot : null;
  if (!sliceText || !sliceRoot) {
    readerState.renderedText.innerHTML = '';
    readerState.statusText.textContent = 'Ready.';
    readerState.statusCounts.textContent = '';
    if (
      !readerState.depTreeUseConllu &&
      readerState.depTreeController &&
      typeof readerState.depTreeController.setData === 'function'
    ) {
      readerState.depTreeController.setData({
        segments: [],
        udOverlay: null
      });
    }
    return;
  }
  var seqDocx = ++readerState.latestSeq;
  readerState.statusText.textContent = 'Segmenting...';
  readerState.statusCounts.textContent = '';
  if (readerState.renderedText) {
    readerState.renderedText.classList.remove(
      'plain-text-mode',
      'docx-original-view',
      'orig-view-structured'
    );
  }
  readerState.renderedText.innerHTML = '';
  readerState.renderedText.appendChild(sliceRoot);
  startSegmentLookupFetch(buildLookupUrl(sliceText))
    .then(function (resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.json();
    })
    .then(function (data) {
      if (seqDocx !== readerState.latestSeq) return;
      if (!data || !data.ok) {
        readerState.statusText.textContent = 'Error from server.';
        readerState.renderedText.innerHTML =
          '<div class="reader-output-placeholder">Error: ' +
          escapeHtml(data && data.error ? data.error : 'unknown') +
          '</div>';
        return;
      }

      // Adopt lookup payload and map offsets onto the cloned visible slice DOM.
      readerState.latestData = data;
      var segments = Array.isArray(data.segments) ? data.segments : [];
      var gramOverlay =
        data.grammar_overlay && Array.isArray(data.grammar_overlay.tokens) ? data.grammar_overlay.tokens : [];
      var resultsBySeg = Array.isArray(data.results_by_seg) ? data.results_by_seg : [];
      setLatestUdOverlay(data.ud_overlay);
      var udTokenMap = dependencyState.latestUdTokenMap || {};
      chunkModelState.latestChunks = computeChunks(
        dependencyState.latestUdOverlay,
        settingsState.displaySettings.chunkHighlight ? 100 : 0,
        settingsState.displaySettings.linearClauseSplit || settingsState.displaySettings.udOverlay,
        settingsState.displaySettings.branchDepthMin,
        settingsState.displaySettings.clauseDepthDrop
      );
      rebuildConnectedIslandGroups();
      clearUdTokenIndex();
      invalidateUdRectCache();
      invalidateUiRectCache();
      if (hoverInteractionState.fuzzyCache && typeof hoverInteractionState.fuzzyCache.clear === 'function') {
        hoverInteractionState.fuzzyCache.clear();
      }
      hideUdLines();
      hideNerHover();
      clearChunkHighlight();
      dependencyGeometryState.hoverReticle = null;
      dependencyState.udSvgOverlay = null;
      var fillsDict = {};
      if (resultsBySeg && resultsBySeg.length) {
        resultsBySeg.forEach(function (res, idx) {
          if (res && res.dict_fill && res.dict_fill.length) {
            fillsDict[idx] = res.dict_fill;
          }
        });
      }
      readerState.latestSegments = segments;
      readerState.latestOriginalText = sliceText;
      readerState.latestFillsDict = fillsDict;
      if (
        !readerState.depTreeUseConllu &&
        readerState.depTreeController &&
        typeof readerState.depTreeController.setData === 'function'
      ) {
        readerState.depTreeController.debugMode = false;
        readerState.depTreeController.changedTokens = null;
        readerState.depTreeController.changeDetails = null;
        readerState.depTreeController.fills = fillsDict;
        readerState.depTreeController.setData({
          segments: segments,
          udOverlay: dependencyState.latestUdOverlay,
          originalText: sliceText
        });
      }
      var segmentOffsets = data && Array.isArray(data.segment_offsets) ? data.segment_offsets : null;
      function offsetsAreValid(offsets, text, count) {
        if (!offsets || offsets.length !== count) return false;
        var lastEnd = 0;
        for (var oi = 0; oi < offsets.length; oi++) {
          var off = offsets[oi];
          if (!off || off.length < 2) return false;
          var start = Number(off[0]);
          var end = Number(off[1]);
          if (!isFinite(start) || !isFinite(end)) return false;
          if (start < lastEnd || end < start || end > text.length) return false;
          lastEnd = end;
        }
        return true;
      }
      latestSegmentOffsets = offsetsAreValid(segmentOffsets, sliceText, segments.length)
        ? segmentOffsets
        : [];
      applyOffsetsAsTokenSpansOnDom(sliceRoot, data);

      // Rebuild segment->DOM mapping for hover logic.
      var tokenSpans = sliceRoot.querySelectorAll('.reader-token');
      for (var ti = 0; ti < tokenSpans.length; ti++) {
        var span = tokenSpans[ti];
        if (!span || !span.dataset) continue;
        var idxVal = parseInt(span.dataset.index || '-1', 10);
        if (idxVal >= 0) registerTokenSpan(idxVal, span);
      }
      attachHoverHandlers(readerState.renderedText, resultsBySeg, gramOverlay);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          computeAndCacheRowBands();
          buildUdRectCache();
        });
      });
      readerState.statusText.textContent = 'Ready.';
      readerState.statusCounts.textContent = 'Segmented ' + segments.length + ' tokens.';
    })
    .catch(function (err) {
      if (seqDocx !== readerState.latestSeq) return;
      console.error(err);
      readerState.statusText.textContent = 'Lookup failed.';
      readerState.renderedText.innerHTML =
        '<div class="reader-output-placeholder">Lookup request failed.</div>';
    });
}
export function triggerUpdate() {
  cancelMovementLookupTimer();
  // PDF.js viewer mode - text extraction driven by current page
  if (documentPaginationState.inputMode === 'pdf') {
    var idx = Math.max(
      0,
      Math.min(
        (documentPaginationState.docPages.length || 1) - 1,
        documentPaginationState.activePageIndex || 0
      )
    );
    if (
      idx === documentPaginationState.lastLookupPageIndex ||
      idx === documentPaginationState.pendingPdfLookupPageIndex
    ) {
      return;
    }
    var textForLookup;
    if (documentPaginationState.usePdfjsTextLayer && documentPaginationState.isOriginalView) {
      // PDF.js text layer mode: use iframe-provided plain text directly.
      if (documentPaginationState.pdfjsTextLayerCache[idx]) {
        textForLookup = String(documentPaginationState.pdfjsTextLayerCache[idx].plainText || '');
      } else {
        readerState.statusText.textContent = 'Fetching text layer...';
        readerState.statusCounts.textContent = documentPaginationState.docPages.length
          ? 'Page ' + (idx + 1) + ' / ' + documentPaginationState.docPages.length
          : '';
        fetchPdfjsTextLayer(idx);
        return;
      }
    } else if (documentPaginationState.isOriginalView) {
      // Use geometrically-aware layout text
      if (documentPaginationState.originalLayoutCache[idx]) {
        textForLookup = documentPaginationState.originalLayoutCache[idx];
      } else {
        // Fetch layout text from server
        readerState.statusText.textContent = 'Loading layout text...';
        readerState.statusCounts.textContent = documentPaginationState.docPages.length
          ? 'Page ' + (idx + 1) + ' / ' + documentPaginationState.docPages.length
          : '';
        fetchPageLayoutText(idx);
        return;
      }
    } else {
      // Use per-page raw text extracted on demand.
      if (documentPaginationState.pdfRawTextCache[idx] != null) {
        textForLookup = String(documentPaginationState.pdfRawTextCache[idx] || '').trim();
      } else {
        readerState.statusText.textContent = 'Loading page text...';
        readerState.statusCounts.textContent = documentPaginationState.docPages.length
          ? 'Page ' + (idx + 1) + ' / ' + documentPaginationState.docPages.length
          : '';
        fetchPageLayoutText(idx);
        return;
      }
    }
    documentPaginationState.pageLookupTextByIndex[idx] = textForLookup;
    if (!textForLookup) {
      readerState.renderedText.innerHTML = '';
      readerState.statusText.textContent = 'Ready.';
      readerState.statusCounts.textContent = '';
      if (
        !readerState.depTreeUseConllu &&
        readerState.depTreeController &&
        typeof readerState.depTreeController.setData === 'function'
      ) {
        readerState.depTreeController.setData({
          segments: [],
          udOverlay: null
        });
      }
      return;
    }
    var seqPdf = ++readerState.latestSeq;
    documentPaginationState.pendingPdfLookupPageIndex = idx;
    readerState.statusText.textContent = 'Segmenting...';
    readerState.statusCounts.textContent = documentPaginationState.docPages.length
      ? 'Page ' + (idx + 1) + ' / ' + documentPaginationState.docPages.length
      : '';
    startSegmentLookupFetch(buildLookupUrl(textForLookup))
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function (data) {
        if (seqPdf !== readerState.latestSeq) return;
        if (documentPaginationState.pendingPdfLookupPageIndex === idx)
          documentPaginationState.pendingPdfLookupPageIndex = -1;
        if (!data || !data.ok) {
          readerState.statusText.textContent = 'Error from server.';
          readerState.renderedText.innerHTML =
            '<div class="reader-output-placeholder">Error: ' +
            escapeHtml(data && data.error ? data.error : 'unknown') +
            '</div>';
          return;
        }
        documentPaginationState.lastLookupPageIndex = idx;
        var finalLookupText = textForLookup;
        if (
          !(documentPaginationState.usePdfjsTextLayer && documentPaginationState.isOriginalView) &&
          data &&
          typeof data.q === 'string'
        ) {
          finalLookupText = data.q;
        }
        documentPaginationState.pageLookupTextByIndex[idx] = finalLookupText;
        readerState.latestData = data;
        readerState.latestSegments = Array.isArray(data.segments) ? data.segments : [];
        renderSegments(data, finalLookupText || textForLookup);
      })
      .catch(function (err) {
        if (documentPaginationState.pendingPdfLookupPageIndex === idx)
          documentPaginationState.pendingPdfLookupPageIndex = -1;
        if (seqPdf !== readerState.latestSeq) return;
        if (isAbortError(err)) return;
        console.error(err);
        readerState.statusText.textContent = 'Request failed.';
        readerState.renderedText.innerHTML =
          '<div class="reader-output-placeholder">Could not contact /lookup endpoint.</div>';
        updateRenderedOutputBackground();
      });
    return;
  }

  // Document mode - use visible text from scrollable container
  if (documentPaginationState.inputMode === 'doc') {
    // DOCX Original view (docx-preview): lookup is based on the visible slice of the live
    // docx-preview DOM, and output is rendered via the standard segmentation pipeline.
    if (documentPaginationState.isOriginalView && documentPaginationState.currentFileType === 'docx') {
      docxOriginalLookupNow();
      return;
    }
    var textForLookup = getDocVisibleText().trim();
    if (!textForLookup) {
      readerState.renderedText.innerHTML = '';
      readerState.statusText.textContent = 'Ready.';
      readerState.statusCounts.textContent = '';
      if (
        !readerState.depTreeUseConllu &&
        readerState.depTreeController &&
        typeof readerState.depTreeController.setData === 'function'
      ) {
        readerState.depTreeController.setData({
          segments: [],
          udOverlay: null
        });
      }
      return;
    }
    var seqDoc = ++readerState.latestSeq;
    readerState.statusText.textContent = 'Segmenting...';
    readerState.statusCounts.textContent = '';
    startSegmentLookupFetch(buildLookupUrl(textForLookup))
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function (data) {
        if (seqDoc !== readerState.latestSeq) return;
        if (!data || !data.ok) {
          readerState.statusText.textContent = 'Error from server.';
          readerState.renderedText.innerHTML =
            '<div class="reader-output-placeholder">Error: ' +
            escapeHtml(data && data.error ? data.error : 'unknown') +
            '</div>';
          return;
        }
        readerState.latestData = data;
        readerState.latestSegments = Array.isArray(data.segments) ? data.segments : [];
        renderSegments(data, textForLookup);
      })
      .catch(function (err) {
        if (seqDoc !== readerState.latestSeq) return;
        if (isAbortError(err)) return;
        console.error(err);
        readerState.statusText.textContent = 'Request failed.';
        readerState.renderedText.innerHTML =
          '<div class="reader-output-placeholder">Could not contact /lookup endpoint.</div>';
        updateRenderedOutputBackground();
      });
    return;
  }

  // Raw mode - use textarea content
  if (isShowingInitialInputGuidance()) {
    readerState.renderedText.innerHTML = '';
    readerState.statusText.textContent = 'Ready.';
    readerState.statusCounts.textContent = '';
    if (
      !readerState.depTreeUseConllu &&
      readerState.depTreeController &&
      typeof readerState.depTreeController.setData === 'function'
    ) {
      readerState.depTreeController.setData({
        segments: [],
        udOverlay: null
      });
    }
    return;
  }
  var fullText = readerState.sourceText.value || '';
  var trimmed = fullText.trim();
  if (!trimmed) {
    readerState.renderedText.innerHTML = '';
    readerState.statusText.textContent = 'Ready.';
    readerState.statusCounts.textContent = '';
    if (
      !readerState.depTreeUseConllu &&
      readerState.depTreeController &&
      typeof readerState.depTreeController.setData === 'function'
    ) {
      readerState.depTreeController.setData({
        segments: [],
        udOverlay: null
      });
    }
    return;
  }

  // If raw text exceeds the 30-line viewport, switch to doc mode
  var overflowIdx = findRawOverflowIndex(fullText);
  if (overflowIdx >= 0) {
    if (!documentPaginationState.currentFile) showRawTextPill('Clear text');
    loadTextAsDoc(fullText);
    return;
  }

  // Small text - segment directly
  var seq = ++readerState.latestSeq;
  readerState.statusText.textContent = 'Segmenting...';
  readerState.statusCounts.textContent = '';
  startSegmentLookupFetch(buildLookupUrl(trimmed))
    .then(function (resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.json();
    })
    .then(function (data) {
      if (seq !== readerState.latestSeq) return;
      if (!data || !data.ok) {
        readerState.statusText.textContent = 'Error from server.';
        readerState.renderedText.innerHTML =
          '<div class="reader-output-placeholder">Error: ' +
          escapeHtml(data && data.error ? data.error : 'unknown') +
          '</div>';
        return;
      }
      readerState.latestData = data;
      renderSegments(data, fullText);
      updateRenderedOutputBackground();
    })
    .catch(function (err) {
      if (seq !== readerState.latestSeq) return;
      if (isAbortError(err)) return;
      console.error(err);
      readerState.statusText.textContent = 'Request failed.';
      readerState.renderedText.innerHTML =
        '<div class="reader-output-placeholder">Could not contact /lookup endpoint.</div>';
      updateRenderedOutputBackground();
    });
}
