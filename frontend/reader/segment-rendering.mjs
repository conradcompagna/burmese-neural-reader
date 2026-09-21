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
import { matchTokenWithInvisibleChars } from './document-annotations.mjs';
import { normalizeBlockFontSizes, normalizeLinePositions } from './document-layout.mjs';
import { documentPaginationState } from './document-pagination.state.mjs';
import { hideNerHover } from './entity-hover.mjs';
import { attachHoverHandlers, computeAndCacheRowBands } from './hover-interaction.mjs';
import { hoverInteractionState } from './hover-interaction.state.mjs';
import { rebuildConnectedIslandGroups } from './island-groups.mjs';
import { readerState } from './reader-state.state.mjs';
import { segmentRenderingState } from './segment-rendering.state.mjs';
import { settingsState } from './settings-state.state.mjs';
import { annotatePdfJsTextLayerSpans, annotateRawWordSpans } from './source-annotations.mjs';
import { isMyanmarChar } from './text.mjs';
import { buildTokenSpan } from './token-rendering.mjs';
export function renderSegments(data, rawText) {
  if (readerState.renderedText) {
    readerState.renderedText.classList.remove('plain-text-mode', 'docx-original-view');
  }
  var segments = Array.isArray(data.segments) ? data.segments : [];
  var gramOverlay =
    data.grammar_overlay && Array.isArray(data.grammar_overlay.tokens) ? data.grammar_overlay.tokens : [];
  var resultsBySeg = Array.isArray(data.results_by_seg) ? data.results_by_seg : [];
  // Store UD overlay for dependency visualization
  setLatestUdOverlay(data.ud_overlay);
  var udTokenMap = dependencyState.latestUdTokenMap || {};
  function shouldPreventTokenWrap() {
    return (
      !documentPaginationState.isOriginalView &&
      (readerState.rawTextDocActive ||
        documentPaginationState.inputMode === 'raw' ||
        documentPaginationState.currentFileType === 'text' ||
        documentPaginationState.currentFileType === 'docx' ||
        documentPaginationState.currentFileType === 'pdf')
    );
  }
  function applyPlainTextNoWrap(span) {
    if (!span || !shouldPreventTokenWrap()) return;
    span.style.whiteSpace = 'nowrap';
    span.style.overflowWrap = 'normal';
    span.style.wordBreak = 'normal';
  }
  // Collapsed span info + UD token map already rebuilt via setLatestUdOverlay()
  // Compute chunks from UD overlay (use max depth 100 when enabled)
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
  dependencyGeometryState.hoverReticle = null; // Reset hover reticle overlay
  dependencyState.udSvgOverlay = null; // Reset SVG overlay
  var n = segments.length;
  if (!n) {
    readerState.renderedText.innerHTML =
      '<div class="reader-output-placeholder">No Burmese segments found.</div>';
    readerState.statusText.textContent = 'No segments.';
    readerState.statusCounts.textContent = '';
    return;
  }
  var text =
    data && data.display_text
      ? data.display_text
      : data && data.q
        ? data.q
        : rawText != null
          ? rawText
          : readerState.sourceText.value || '';
  if (
    documentPaginationState.usePdfjsTextLayer &&
    documentPaginationState.isOriginalView &&
    rawText != null
  ) {
    text = String(rawText);
  }
  // Build fills dict for dictionary popups (dict_fill contains the entries)
  var fillsDict = {};
  if (resultsBySeg && resultsBySeg.length) {
    resultsBySeg.forEach(function (res, idx) {
      if (res && res.dict_fill && res.dict_fill.length) {
        fillsDict[idx] = res.dict_fill;
      }
    });
  }
  readerState.latestSegments = segments;
  readerState.latestOriginalText = text;
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
      originalText: text
    });
  }
  var frag = document.createDocumentFragment();
  var segmentOffsets = data && Array.isArray(data.segment_offsets) ? data.segment_offsets : null;
  var grammarCount = 0,
    unknownCount = 0;
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
  if (offsetsAreValid(segmentOffsets, text, n)) {
    latestSegmentOffsets = segmentOffsets;

    // ---- PDF.js text layer rendering path ----
    var tlCacheEntry =
      documentPaginationState.usePdfjsTextLayer && documentPaginationState.isOriginalView
        ? documentPaginationState.pdfjsTextLayerCache[documentPaginationState.lastLookupPageIndex]
        : null;
    if (
      documentPaginationState.usePdfjsTextLayer &&
      documentPaginationState.isOriginalView &&
      tlCacheEntry &&
      tlCacheEntry.innerHTML
    ) {
      var tlOuter = document.createElement('div');
      tlOuter.className = 'pdfjs-textlayer-container';
      var tlHost = document.createElement('div');
      tlHost.className = 'pdfjs-textlayer-host';
      var vpW = Number(tlCacheEntry.viewportWidth) || 0;
      var vpH = Number(tlCacheEntry.viewportHeight) || 0;
      var panelW =
        readerState.renderedText.clientWidth || readerState.renderedText.offsetWidth || 0;
      var fitScale = 1;
      if (vpW > 0 && panelW > 0) {
        fitScale = panelW / vpW;
        tlHost.style.width = panelW + 'px';
        if (vpH > 0) tlHost.style.height = Math.max(1, Math.round(panelW * (vpH / vpW))) + 'px';
      } else {
        if (vpW > 0) tlHost.style.width = vpW + 'px';
        if (vpH > 0) tlHost.style.height = vpH + 'px';
      }
      var tlLayer = document.createElement('div');
      tlLayer.className = (tlCacheEntry.layerClass || 'textLayer') + ' pdfjs-textlayer-clone';
      if (tlCacheEntry.layerStyle) {
        tlLayer.setAttribute('style', String(tlCacheEntry.layerStyle));
      }
      var baseScale =
        Number(tlCacheEntry.computedScaleFactor) ||
        parseFloat(tlLayer.style.getPropertyValue('--scale-factor')) ||
        1;
      var baseTotalScale =
        Number(tlCacheEntry.computedTotalScaleFactor) ||
        parseFloat(tlLayer.style.getPropertyValue('--total-scale-factor')) ||
        baseScale;
      tlLayer.style.setProperty('--scale-factor', String(baseScale * fitScale));
      tlLayer.style.setProperty('--total-scale-factor', String(baseTotalScale * fitScale));
      tlLayer.innerHTML = String(tlCacheEntry.innerHTML || '');
      tlHost.appendChild(tlLayer);
      tlOuter.appendChild(tlHost);
      frag.appendChild(tlOuter);
      var tlWordSpans = tlLayer.querySelectorAll('span');
      annotatePdfJsTextLayerSpans(
        tlWordSpans,
        segments,
        segmentOffsets,
        resultsBySeg,
        gramOverlay,
        udTokenMap
      );
      readerState.renderedText.innerHTML = '';
      readerState.renderedText.appendChild(frag);
      hideNerHover();
      attachHoverHandlers(readerState.renderedText, resultsBySeg, gramOverlay);
      readerState.statusText.textContent = 'Segmented ' + n + ' tokens (PDF.js text layer).';
      readerState.statusCounts.textContent = documentPaginationState.docPages.length
        ? 'Page ' +
          (documentPaginationState.lastLookupPageIndex + 1) +
          ' / ' +
          documentPaginationState.docPages.length
        : '';
      requestAnimationFrame(function () {
        computeAndCacheRowBands();
      });
      requestAnimationFrame(function () {
        buildUdRectCache();
      });
      return;
    }

    // Check if in original view with PDF positioning data
    var pageData =
      documentPaginationState.isOriginalView &&
      documentPaginationState.renderedPageImages &&
      documentPaginationState.renderedPageImages.byIndex
        ? documentPaginationState.renderedPageImages.byIndex[documentPaginationState.lastLookupPageIndex]
        : null;
    if (documentPaginationState.isOriginalView && pageData && pageData.words && pageData.words.length > 0) {
      // Render structured flowing text layout - each word positioned by its actual X coordinate
      var structuredBlocks = pageData.structured_blocks || [];
      var words = pageData.words || [];

      // Create container
      var container = document.createElement('div');
      container.className = 'structured-text-container';
      container.style.cssText =
        'position:relative;background:#fff;border:1px solid #e5e7eb;border-radius:4px;box-sizing:border-box;overflow:hidden;';
      var containerWidth =
        readerState.renderedText.clientWidth || readerState.renderedText.offsetWidth || 0;
      var scaleFactor = containerWidth > 0 && pageData.width > 0 ? containerWidth / pageData.width : 1;
      if (containerWidth > 0 && pageData.width > 0) {
        var containerHeight = containerWidth * (pageData.height / pageData.width);
        container.style.height = containerHeight + 'px';
      }

      // Global word spans array for annotation mapping
      var allWordSpans = [];
      var pageFontSizes = [];
      var fontCounts = {};
      if (structuredBlocks.length > 0) {
        for (var bi = 0; bi < structuredBlocks.length; bi++) {
          var bl = structuredBlocks[bi].lines || [];
          for (var li = 0; li < bl.length; li++) {
            var bw = bl[li].words || [];
            for (var wi = 0; wi < bw.length; wi++) {
              var pfs = bw[wi] && Number(bw[wi].fontSize);
              if (pfs && isFinite(pfs) && pfs > 0) pageFontSizes.push(pfs);
              var fontName = bw[wi] && bw[wi].font;
              if (fontName) {
                fontCounts[fontName] = (fontCounts[fontName] || 0) + 1;
              }
            }
          }
        }
      } else {
        for (var wi = 0; wi < words.length; wi++) {
          var pfs2 = words[wi] && Number(words[wi].fontSize);
          if (pfs2 && isFinite(pfs2) && pfs2 > 0) pageFontSizes.push(pfs2);
          var fontName2 = words[wi] && words[wi].font;
          if (fontName2) {
            fontCounts[fontName2] = (fontCounts[fontName2] || 0) + 1;
          }
        }
      }
      var pageFontMedian = 0;
      if (pageFontSizes.length) {
        pageFontSizes.sort(function (a, b) {
          return a - b;
        });
        var midAll = Math.floor(pageFontSizes.length / 2);
        pageFontMedian =
          pageFontSizes.length % 2
            ? pageFontSizes[midAll]
            : (pageFontSizes[midAll - 1] + pageFontSizes[midAll]) / 2;
      }
      // Find most common font
      var mostCommonFont = null;
      var maxFontCount = 0;
      for (var fn in fontCounts) {
        if (fontCounts[fn] > maxFontCount) {
          maxFontCount = fontCounts[fn];
          mostCommonFont = fn;
        }
      }
      if (structuredBlocks.length > 0) {
        // Sort blocks by Y position (min_y) for proper vertical ordering
        var sortedBlocks = structuredBlocks.slice().sort(function (a, b) {
          return (a.min_y || 0) - (b.min_y || 0);
        });

        // Render using structured blocks - absolute-position each run by X/Y
        for (var bi = 0; bi < sortedBlocks.length; bi++) {
          var block = sortedBlocks[bi];
          var lines = block.lines || [];
          for (var li = 0; li < lines.length; li++) {
            var lineWords = lines[li].words || [];
            for (var wi = 0; wi < lineWords.length; wi++) {
              var w = lineWords[wi];
              if (!w || !w.text) continue;
              var wordSpan = document.createElement('span');
              wordSpan.className = 'pdf-raw-word';
              wordSpan.textContent = w.text;
              wordSpan.dataset.wordIdx = String(w.word_idx != null ? w.word_idx : allWordSpans.length);
              wordSpan.dataset.block = String(bi);
              wordSpan.dataset.line = String(li);
              wordSpan.dataset.bboxX = String(w.x || 0);
              wordSpan.dataset.bboxY = String(w.y || 0);
              wordSpan.dataset.bboxW = String(w.w || 0);
              wordSpan.dataset.bboxH = String(w.h || 0);
              var leftPct = ((w.x || 0) / pageData.width) * 100;
              var topPct = ((w.y || 0) / pageData.height) * 100;
              wordSpan.style.cssText =
                'position:absolute;left:' + leftPct + '%;top:' + topPct + '%;white-space:nowrap;';
              if (mostCommonFont) {
                var cleanedFont = String(mostCommonFont).replace(/"/g, '');
                if (cleanedFont) wordSpan.style.fontFamily = '"' + cleanedFont + '", inherit';
              }
              var useFontSize = pageFontMedian || w.fontSize;
              if (useFontSize && scaleFactor > 0) {
                wordSpan.style.fontSize = Number(useFontSize) * scaleFactor + 'px';
              }
              container.appendChild(wordSpan);
              allWordSpans.push(wordSpan);
            }
          }
        }
      } else {
        // Fallback: render flat word list grouped by Y, each word positioned individually
        // First, group words by Y coordinate (lines)
        var lineGroups = [];
        var currentLineY = -999;
        var currentLineWords = [];
        var medianH = 12;

        // Compute median height
        var allHeights = [];
        for (var wi = 0; wi < words.length; wi++) {
          if (words[wi] && words[wi].h > 0) allHeights.push(words[wi].h);
        }
        if (allHeights.length) {
          allHeights.sort(function (a, b) {
            return a - b;
          });
          var mid = Math.floor(allHeights.length / 2);
          medianH = allHeights.length % 2 ? allHeights[mid] : (allHeights[mid - 1] + allHeights[mid]) / 2;
        }
        for (var wi = 0; wi < words.length; wi++) {
          var w = words[wi];
          if (!w || !w.text) continue;
          var y = typeof w.y === 'number' ? w.y : 0;
          var h = typeof w.h === 'number' && w.h > 0 ? w.h : medianH;

          // Check for new line
          if (currentLineY >= 0 && Math.abs(y - currentLineY) > h * 0.5) {
            if (currentLineWords.length > 0) {
              lineGroups.push({
                y: currentLineY,
                words: currentLineWords
              });
            }
            currentLineWords = [];
          }
          currentLineWords.push(w);
          currentLineY = y;
        }
        if (currentLineWords.length > 0) {
          lineGroups.push({
            y: currentLineY,
            words: currentLineWords
          });
        }

        // Sort lines by Y
        lineGroups.sort(function (a, b) {
          return a.y - b.y;
        });

        // Render each line with individually positioned words
        var fallbackFontMedian = pageFontMedian;
        for (var li = 0; li < lineGroups.length; li++) {
          var lineWords = lineGroups[li].words;
          for (var wi = 0; wi < lineWords.length; wi++) {
            var w = lineWords[wi];
            var wordSpan = document.createElement('span');
            wordSpan.className = 'pdf-raw-word';
            wordSpan.textContent = w.text;
            wordSpan.dataset.wordIdx = String(w.word_idx != null ? w.word_idx : allWordSpans.length);
            wordSpan.dataset.block = '0';
            wordSpan.dataset.line = String(li);
            wordSpan.dataset.bboxX = String(w.x || 0);
            wordSpan.dataset.bboxY = String(w.y || 0);
            wordSpan.dataset.bboxW = String(w.w || 0);
            wordSpan.dataset.bboxH = String(w.h || 0);

            // Position each word by its actual X coordinate
            var leftPct = ((w.x || 0) / pageData.width) * 100;
            var topPct = ((w.y || 0) / pageData.height) * 100;
            wordSpan.style.cssText =
              'position:absolute;left:' + leftPct + '%;top:' + topPct + '%;white-space:nowrap;';
            if (mostCommonFont) {
              var cleanedFont2 = String(mostCommonFont).replace(/"/g, '');
              if (cleanedFont2) wordSpan.style.fontFamily = '"' + cleanedFont2 + '", inherit';
            }
            var useFontSize2 = fallbackFontMedian || w.fontSize;
            if (useFontSize2 && scaleFactor > 0) {
              wordSpan.style.fontSize = Number(useFontSize2) * scaleFactor + 'px';
            }
            container.appendChild(wordSpan);
            allWordSpans.push(wordSpan);
          }
        }
      }

      // Store reference to raw word spans for later annotation
      readerState.latestRawWordSpans = allWordSpans;
      readerState.latestRawPageData = pageData; // Store page data for annotation
      window.latestRawPageData = pageData;
      frag.appendChild(container);
      readerState.renderedText.classList.add('orig-view-structured');

      // Now render the raw layout and annotate it from the existing lookup payload.
      readerState.renderedText.innerHTML = '';
      readerState.renderedText.appendChild(frag);
      hideNerHover();
      (function () {
        var basePx = pageFontMedian && scaleFactor > 0 ? pageFontMedian * scaleFactor : 0;
        var runNormalize = function () {
          normalizeBlockFontSizes(container, basePx);
          normalizeLinePositions(container);
        };
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(function () {
            requestAnimationFrame(runNormalize);
          });
        } else {
          requestAnimationFrame(runNormalize);
        }
      })();

      // Reuse the single lookup payload for this page; do not trigger a second /lookup.
      if (segments.length && segmentOffsets.length) {
        clearUdTokenIndex();
        invalidateUdRectCache();
        invalidateUiRectCache();

        // Annotate positioned word spans using the already-fetched segment payload.
        annotateRawWordSpans(
          readerState.latestRawWordSpans,
          pageData.words,
          segments,
          segmentOffsets,
          resultsBySeg,
          gramOverlay,
          udTokenMap,
          pageData
        );
        attachHoverHandlers(readerState.renderedText, resultsBySeg, gramOverlay);
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            computeAndCacheRowBands();
            buildUdRectCache();
          });
        });
        readerState.statusText.textContent = 'Segmented ' + segments.length + ' tokens.';
        readerState.statusCounts.textContent = documentPaginationState.docPages.length
          ? 'Page ' +
            (documentPaginationState.lastLookupPageIndex + 1) +
            ' / ' +
            documentPaginationState.docPages.length
          : '';
      } else {
        readerState.statusText.textContent = 'Segmented ' + n + ' tokens.';
        readerState.statusCounts.textContent = '';
      }
      return;
    } else {
      // Standard text rendering (not original view)
      var cursor = 0;
      for (var oi = 0; oi < n; oi++) {
        var start = Number(segmentOffsets[oi][0]);
        var end = Number(segmentOffsets[oi][1]);
        if (start > cursor) {
          frag.appendChild(document.createTextNode(text.slice(cursor, start)));
        }
        // Render each token individually for dictionary inspection
        var built = buildTokenSpan(oi, segments[oi], gramOverlay, resultsBySeg, udTokenMap);
        applyPlainTextNoWrap(built.span);
        frag.appendChild(built.span);
        if (built.hasGrammar) grammarCount++;
        if (built.isUnknown) unknownCount++;
        cursor = end;
        // Map each segment to its own element (NER spans are expanded later for highlighting).
        registerTokenSpan(oi, built.span);
      }
      if (cursor < text.length) {
        frag.appendChild(document.createTextNode(text.slice(cursor)));
      }
    }
    readerState.renderedText.innerHTML = '';
    readerState.renderedText.appendChild(frag);
    hideNerHover();
    readerState.statusText.textContent = 'Segmented ' + n + ' tokens.';
    attachHoverHandlers(readerState.renderedText, resultsBySeg, gramOverlay);
    // Defer row band caching to avoid blocking render
    requestAnimationFrame(function () {
      computeAndCacheRowBands();
    });
    requestAnimationFrame(function () {
      buildUdRectCache();
    });
    return;
  }
  var buffer = '';
  function flushBuffer() {
    if (buffer) {
      frag.appendChild(document.createTextNode(buffer));
      buffer = '';
    }
  }
  var segIndex = 0,
    len = text.length;
  for (var i = 0; i < len; i++) {
    var ch = text[i];
    if (isMyanmarChar(ch) && segIndex < n) {
      var token = segments[segIndex];
      if (token) {
        var match = matchTokenWithInvisibleChars(text, i, token);
        if (match) {
          flushBuffer();
          // Render each token individually for dictionary inspection
          var built = buildTokenSpan(segIndex, token, gramOverlay, resultsBySeg, udTokenMap);
          applyPlainTextNoWrap(built.span);
          frag.appendChild(built.span);
          if (built.hasGrammar) grammarCount++;
          if (built.isUnknown) unknownCount++;
          // Map each segment to its own element (NER spans are expanded later for highlighting).
          registerTokenSpan(segIndex, built.span);
          i = match.end;
          segIndex++;
          continue;
        }
      }
    }
    buffer += ch;
  }
  flushBuffer();
  readerState.renderedText.innerHTML = '';
  readerState.renderedText.appendChild(frag);
  hideNerHover();
  readerState.statusText.textContent = 'Segmented ' + n + ' tokens.';
  attachHoverHandlers(readerState.renderedText, resultsBySeg, gramOverlay);
  // Defer row band caching to avoid blocking render
  requestAnimationFrame(function () {
    computeAndCacheRowBands();
  });
  requestAnimationFrame(function () {
    buildUdRectCache();
  });
}
export function initializeSegmentRendering() {
  segmentRenderingState.currentSpan = null;
  segmentRenderingState.panelHoverToken = null;
  return true;
}
