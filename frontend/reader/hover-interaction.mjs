import { applyChunkHighlight, clearChunkHighlight } from './chunk-highlighting.mjs';
import { chunkHighlightingState } from './chunk-highlighting.state.mjs';
import { hideUdLines } from './dependency-geometry.mjs';
import { drawUdLinesForToken } from './dependency-highlighting.mjs';
import { lookupAndDisplay } from './dictionary-panel.mjs';
import { togglePanel } from './dictionary-search.mjs';
import { documentPaginationState } from './document-pagination.state.mjs';
import { hideHoverReticle, hideNerHover, renderNerHoverForToken, showHoverReticle } from './entity-hover.mjs';
import { runSmartFuzzyMatching } from './fuzzy-search.mjs';
import { hoverInteractionState } from './hover-interaction.state.mjs';
import { buildPopupForSpan, hidePopup, positionPopup } from './popup-placement.mjs';
import { readerState } from './reader-state.state.mjs';
import { segmentRenderingState } from './segment-rendering.state.mjs';
import { settingsState } from './settings-state.state.mjs';
import { buildPopupForWord, positionSubsegmentPopups } from './word-popups.mjs';
export // Minimum ms between hover updates (~120fps max)

// Fix zero-width reader tokens by applying min-width styling
function fixZeroWidthReaderTokens() {
  if (!readerState.renderedText) return;
  // Defer until browser finishes layout
  requestAnimationFrame(function () {
    var tokens = readerState.renderedText.querySelectorAll('.reader-token');
    tokens.forEach(function (tok) {
      var r = tok.getBoundingClientRect();
      if (r.width === 0) {
        tok.style.display = 'inline-block';
        tok.style.minWidth = '0.6em';
      }
    });
  });
}

// Compute and cache row bands from rendered text (call once after rendering)
export function computeAndCacheRowBands() {
  hoverInteractionState.cachedRowBands = null;
  hoverInteractionState.cachedRowSnapPoints = null;
  hoverInteractionState.cachedRowGapRanges = null;
  if (!readerState.renderedText) return;
  try {
    var rowEls = readerState.renderedText.querySelectorAll('.reader-token');
    if (!rowEls.length) return;
    var bands = [];
    var tol = 6;
    for (var i = 0; i < rowEls.length; i++) {
      var r = rowEls[i].getBoundingClientRect();
      if (!r || r.width <= 0 || r.height <= 0) continue;
      var match = null;
      for (var j = 0; j < bands.length; j++) {
        if (Math.abs(bands[j].top - r.top) <= tol) {
          match = bands[j];
          break;
        }
      }
      if (!match) {
        bands.push({
          top: r.top,
          bottom: r.bottom
        });
      } else {
        match.top = Math.min(match.top, r.top);
        match.bottom = Math.max(match.bottom, r.bottom);
      }
    }
    bands.sort(function (a, b) {
      return a.top - b.top;
    });
    hoverInteractionState.cachedRowBands = bands;
  } catch (e) {}
}

// Invalidate row band cache (call on resize/scroll)
export function invalidateRowBandCache() {
  hoverInteractionState.cachedRowBands = null;
  hoverInteractionState.cachedRowSnapPoints = null;
  hoverInteractionState.cachedRowGapRanges = null;
}
export function attachHoverHandlers(container, resultsBySeg, gramOverlay) {
  var lastHighlightedSegIdx = -2; // Track which clause is currently highlighted for static display

  // In original PDF view, a single rendered span (one PDF "word" / island fragment) may correspond to
  // multiple Burmese segments. This resolver chooses the most plausible segIdx under the pointer.
  function resolveSegIdxForSpan(span, clientX) {
    if (!span) return -1;
    var idx = parseInt(span.dataset.index || '-1', 10);
    var segList = (span.dataset.segments || '')
      .split(',')
      .map(function (x) {
        return parseInt(x, 10);
      })
      .filter(function (n) {
        return isFinite(n) && n >= 0;
      });
    if (segList.length <= 1) return idx;

    // If we don't have offsets, fall back to the canonical earliest index.
    if (!latestSegmentOffsets || !Array.isArray(latestSegmentOffsets) || !latestSegmentOffsets.length) {
      return idx;
    }

    // Estimate a character position within the synthetic layout text based on pointer x within the span.
    var wStart = parseInt(span.dataset.wordStart || 'NaN', 10);
    var wEnd = parseInt(span.dataset.wordEnd || 'NaN', 10);
    if (!isFinite(wStart) || !isFinite(wEnd) || wEnd <= wStart) {
      // No word-span offsets - choose the smallest seg whose offsets overlap anything.
      segList.sort(function (a, b) {
        return a - b;
      });
      return segList[0];
    }
    var rect = span.getBoundingClientRect ? span.getBoundingClientRect() : null;
    var spanW = rect ? rect.width : 0;
    var t = 0.0;
    if (rect && spanW > 1) {
      t = (clientX - rect.left) / spanW;
    }
    if (t < 0) t = 0;
    if (t > 0.999) t = 0.999;
    var estChar = wStart + Math.floor(t * (wEnd - wStart));
    if (estChar < wStart) estChar = wStart;
    if (estChar >= wEnd) estChar = wEnd - 1;

    // Pick the segment whose offset range contains estChar; otherwise choose nearest.
    var best = idx;
    var bestDist = 1e18;
    for (var i = 0; i < segList.length; i++) {
      var si = segList[i];
      var off = latestSegmentOffsets[si];
      if (!off || off.length < 2) continue;
      var s0 = Number(off[0]),
        s1 = Number(off[1]);
      if (!isFinite(s0) || !isFinite(s1)) continue;
      if (estChar >= s0 && estChar < s1) {
        return si;
      }
      var dist = 0;
      if (estChar < s0) dist = s0 - estChar;
      else if (estChar >= s1) dist = estChar - (s1 - 1);
      if (dist < bestDist) {
        bestDist = dist;
        best = si;
      }
    }
    return best;
  }

  // Process deferred hover updates (called via RAF)
  function processHoverUpdate(data) {
    var segIdx = data.segIdx;
    var subtoken = data.subtoken;
    var clientX = data.clientX;
    var clientY = data.clientY;

    // Apply clause highlighting only when entering a different clause span
    // For context window mode, always recompute since the window is centered on each token
    if (segIdx >= 0) {
      var needsRecompute =
        !chunkHighlightingState.currentChunkHighlightTokens ||
        !chunkHighlightingState.currentChunkHighlightTokens.has(segIdx);
      // Context window mode: always recompute when moving to a different token
      if (settingsState.displaySettings.contextWindow && segIdx !== lastHighlightedSegIdx) {
        needsRecompute = true;
      }
      if (needsRecompute) {
        applyChunkHighlight(segIdx);
        lastHighlightedSegIdx = segIdx;
      }
    } else if (segIdx < 0) {
      hideNerHover();
      clearChunkHighlight();
      lastHighlightedSegIdx = -2;
      hideHoverReticle();
    }

    // Update UD lines and NER tags for the current token
    if (segIdx >= 0) {
      if (settingsState.displaySettings.udOverlay && segIdx !== chunkHighlightingState.lastUdSegIdx) {
        drawUdLinesForToken(segIdx);
        chunkHighlightingState.lastUdSegIdx = segIdx;
      }
      renderNerHoverForToken(segIdx);
    } else {
      chunkHighlightingState.lastUdSegIdx = -1;
      hideHoverReticle();
    }
    positionPopup(clientX, clientY);
    positionSubsegmentPopups();
  }
  container.onmousemove = function (ev) {
    var span = ev.target && ev.target.closest('.reader-token');
    if (!span) {
      segmentRenderingState.currentSpan = null;
      hidePopup();
      hideUdLines();
      hideNerHover();
      clearChunkHighlight();
      lastHighlightedSegIdx = -2;
      hideHoverReticle();
      chunkHighlightingState.lastUdSegIdx = -1;
      // Cancel any pending RAF
      if (hoverInteractionState.hoverRafId) {
        cancelAnimationFrame(hoverInteractionState.hoverRafId);
        hoverInteractionState.hoverRafId = null;
      }
      return;
    }
    if (span.classList.contains('reader-punct')) {
      segmentRenderingState.currentSpan = null;
      hidePopup();
      hideUdLines();
      hideNerHover();
      clearChunkHighlight();
      lastHighlightedSegIdx = -2;
      hideHoverReticle();
      chunkHighlightingState.lastUdSegIdx = -1;
      // Cancel any pending RAF
      if (hoverInteractionState.hoverRafId) {
        cancelAnimationFrame(hoverInteractionState.hoverRafId);
        hoverInteractionState.hoverRafId = null;
      }
      return;
    }

    // Resolve the most plausible segment index under the pointer.
    var segIdx = resolveSegIdxForSpan(span, ev.clientX);

    // Keep the span's canonical index in sync with the current pointer-resolved seg,
    // so downstream UI code that reads span.dataset.index stays consistent during hover.
    if (segIdx >= 0 && span.dataset && String(span.dataset.index) !== String(segIdx)) {
      span.dataset.index = String(segIdx);
      if (readerState.latestSegments && readerState.latestSegments[segIdx])
        span.dataset.seg = String(readerState.latestSegments[segIdx]);
    }

    // Check if we're hovering over a subtoken (dictionary word)
    var subtoken = ev.target && ev.target.closest('.reader-subtoken');

    // Immediate updates: popup content (for responsiveness)
    if (subtoken) {
      if (subtoken !== segmentRenderingState.currentSpan) {
        segmentRenderingState.currentSpan = subtoken;
        buildPopupForWord(subtoken, span, segIdx, resultsBySeg, gramOverlay);
      }
    } else {
      // Hovering over main token (no subtokens)
      if (span !== segmentRenderingState.currentSpan) {
        segmentRenderingState.currentSpan = span;
        buildPopupForSpan(span, resultsBySeg, gramOverlay);
      }
    }

    // Free-floating hover reticle (dict-fill tokens only)
    if (subtoken) {
      showHoverReticle(subtoken);
    } else if (documentPaginationState.isOriginalView && documentPaginationState.currentFileType === 'docx') {
      // DOCX original view: show reticle on main token spans as well
      showHoverReticle(span);
    } else {
      hideHoverReticle();
    }

    // Throttle expensive visual updates via RAF
    var now = performance.now();
    var timeSinceLastProcess = now - hoverInteractionState.lastHoverProcessTime;

    // Store pending data
    hoverInteractionState.pendingHoverEvent = {
      segIdx: segIdx,
      subtoken: subtoken,
      clientX: ev.clientX,
      clientY: ev.clientY
    };

    // If enough time has passed, process immediately; otherwise schedule RAF
    if (timeSinceLastProcess >= hoverInteractionState.hoverThrottleMs) {
      hoverInteractionState.lastHoverProcessTime = now;
      if (hoverInteractionState.hoverRafId) {
        cancelAnimationFrame(hoverInteractionState.hoverRafId);
        hoverInteractionState.hoverRafId = null;
      }
      processHoverUpdate(hoverInteractionState.pendingHoverEvent);
    } else if (!hoverInteractionState.hoverRafId) {
      hoverInteractionState.hoverRafId = requestAnimationFrame(function () {
        hoverInteractionState.hoverRafId = null;
        hoverInteractionState.lastHoverProcessTime = performance.now();
        if (hoverInteractionState.pendingHoverEvent) {
          processHoverUpdate(hoverInteractionState.pendingHoverEvent);
        }
      });
    }
  };
  container.onmouseleave = function () {
    segmentRenderingState.currentSpan = null;
    hidePopup();
    hideUdLines();
    hideNerHover();
    hideHoverReticle();
    clearChunkHighlight();
    lastHighlightedSegIdx = -2;
    chunkHighlightingState.lastUdSegIdx = -1;
    // Cancel any pending RAF
    if (hoverInteractionState.hoverRafId) {
      cancelAnimationFrame(hoverInteractionState.hoverRafId);
      hoverInteractionState.hoverRafId = null;
    }
    hoverInteractionState.pendingHoverEvent = null;
  };
  container.onclick = function (ev) {
    var span = ev.target && ev.target.closest('.reader-token');
    if (!span) return;
    if (span.classList.contains('reader-punct')) return;

    // Resolve the most plausible segment index for click location.
    var segIdx = resolveSegIdxForSpan(span, ev.clientX);
    if (segIdx >= 0 && span.dataset && String(span.dataset.index) !== String(segIdx)) {
      span.dataset.index = String(segIdx);
      if (readerState.latestSegments && readerState.latestSegments[segIdx])
        span.dataset.seg = String(readerState.latestSegments[segIdx]);
    }

    // Check if we clicked on a subtoken
    var subtoken = ev.target && ev.target.closest('.reader-subtoken');
    if (subtoken) {
      // Use dataset.word (clean text without dotted circle) for pipeline operations
      var word = subtoken.dataset.word || subtoken.textContent || '';
      if (!word) return;
      var isUnknownPiece = subtoken.classList && subtoken.classList.contains('unknown-subtoken');
      togglePanel(true);
      lookupAndDisplay(word, {
        raw: true,
        exact: true,
        allowFuzzy: isUnknownPiece,
        segIdx: segIdx,
        baseToken: span.dataset.seg || '',
        unknownPiece: isUnknownPiece ? word : ''
      });
      // Trigger fuzzy matching using the neural token (parent .reader-token)
      var baseToken = span.dataset.seg || '';
      if (baseToken && isUnknownPiece) {
        setTimeout(function () {
          runSmartFuzzyMatching(baseToken, {
            segIdx: segIdx,
            unknownPiece: isUnknownPiece ? word : ''
          });
        }, 100);
      }
    } else {
      // Clicked on main token
      var seg = span.dataset.seg || '';
      if (!seg) return;
      var isUnknownMain = span.classList && span.classList.contains('unknown-token');
      togglePanel(true);
      lookupAndDisplay(seg, {
        raw: true,
        exact: true,
        allowFuzzy: isUnknownMain,
        segIdx: segIdx,
        baseToken: seg,
        unknownPiece: isUnknownMain ? seg : ''
      });
      if (isUnknownMain) {
        setTimeout(function () {
          runSmartFuzzyMatching(seg, {
            segIdx: segIdx,
            unknownPiece: seg
          });
        }, 100);
      }
    }
  };
}
export function initializeHoverInteraction() {
  hoverInteractionState.panelHoverType = null;
  hoverInteractionState.lookupCache = new Map();
  hoverInteractionState.subsegCache = new Map();
  hoverInteractionState.fuzzyCache = new Map(); // Cache fuzzy matching results
  ((hoverInteractionState.lastMouseX = 0), (hoverInteractionState.lastMouseY = 0));
  /* NEW: annotation state */
  hoverInteractionState.noteCache = new Map();
  hoverInteractionState.currentPopupHead = null;

  // === PERFORMANCE CACHES ===
  hoverInteractionState.cachedRowBands = null; // Row bands for popup positioning (computed once per render)
  hoverInteractionState.cachedRowSnapPoints = null; // Snap points derived from row bands
  hoverInteractionState.cachedRowGapRanges = null; // Gap ranges between rows
  hoverInteractionState.hoverRafId = null; // requestAnimationFrame ID for debouncing
  hoverInteractionState.pendingHoverEvent = null; // Pending hover event data
  hoverInteractionState.lastHoverProcessTime = 0; // Last time hover was processed (for throttling)
  hoverInteractionState.hoverThrottleMs = 8;
  return true;
}
