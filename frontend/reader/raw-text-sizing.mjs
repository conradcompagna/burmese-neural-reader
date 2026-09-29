import { clearInitialInputGuidanceIfNeeded, isShowingInitialInputGuidance } from './bootstrap-ui.mjs';
import { setRawMode } from './document-pagination.mjs';
import { documentPaginationState } from './document-pagination.state.mjs';
import { triggerUpdate } from './lookup.mjs';
import { rawTextSizingState } from './raw-text-sizing.state.mjs';
import { readerState } from './reader-state.state.mjs';
import { applyGlobalViewportClamp } from './viewport-layout.mjs';
export // Update rendered output area with PDF page background when in original mode
function updateRenderedOutputBackground() {
  if (!readerState.renderedText) return;
  readerState.renderedText.classList.remove('orig-view-bg');
  readerState.renderedText.style.backgroundImage = '';
}
export function ensureRawMeasureEl() {
  if (rawTextSizingState.rawMeasureEl) return rawTextSizingState.rawMeasureEl;
  rawTextSizingState.rawMeasureEl = document.createElement('div');
  rawTextSizingState.rawMeasureEl.style.position = 'absolute';
  rawTextSizingState.rawMeasureEl.style.visibility = 'hidden';
  rawTextSizingState.rawMeasureEl.style.left = '-9999px';
  rawTextSizingState.rawMeasureEl.style.top = '0';
  rawTextSizingState.rawMeasureEl.style.whiteSpace = 'pre-wrap';
  rawTextSizingState.rawMeasureEl.style.wordWrap = 'break-word';
  rawTextSizingState.rawMeasureEl.style.overflowWrap = 'break-word';
  rawTextSizingState.rawMeasureEl.style.boxSizing = 'border-box';
  rawTextSizingState.rawMeasureEl.style.border = '0';
  rawTextSizingState.rawMeasureEl.style.margin = '0';
  rawTextSizingState.rawMeasureEl.style.padding = '0';
  rawTextSizingState.rawMeasureEl.style.height = 'auto';
  rawTextSizingState.rawMeasureEl.style.minHeight = '0';
  rawTextSizingState.rawMeasureEl.style.maxHeight = 'none';
  document.body.appendChild(rawTextSizingState.rawMeasureEl);
  return rawTextSizingState.rawMeasureEl;
}
export function getRawTextMetrics() {
  if (!readerState.sourceText) return null;
  var cs = window.getComputedStyle(readerState.sourceText);
  var fontSize = parseFloat(cs.fontSize) || 16;
  var lineHeight = parseFloat(cs.lineHeight);
  if (!isFinite(lineHeight)) lineHeight = fontSize * 1.6;
  return {
    font: cs.font,
    lineHeight: lineHeight,
    paddingTop: parseFloat(cs.paddingTop) || 0,
    paddingBottom: parseFloat(cs.paddingBottom) || 0,
    paddingLeft: parseFloat(cs.paddingLeft) || 0,
    paddingRight: parseFloat(cs.paddingRight) || 0,
    width:
      readerState.sourceText.clientWidth ||
      readerState.sourceText.getBoundingClientRect().width ||
      0,
    letterSpacing: cs.letterSpacing,
    wordSpacing: cs.wordSpacing
  };
}
export function getRawMaxHeightPx() {
  var metrics = getRawTextMetrics();
  if (!metrics) return 0;
  return Math.ceil(documentPaginationState.DOC_LINES_CONTENT * metrics.lineHeight);
}
export function getRawMinHeightPx() {
  var metrics = getRawTextMetrics();
  if (!metrics) return 0;
  return Math.ceil(documentPaginationState.DOC_LINES_EMPTY * metrics.lineHeight);
}
export function measureRawTextHeight(text, metrics) {
  if (!readerState.sourceText) return 0;
  var info = metrics || getRawTextMetrics();
  if (!info || !info.width) return 0;
  var measurer = ensureRawMeasureEl();
  measurer.style.width = Math.max(0, info.width) + 'px';
  measurer.style.font = info.font;
  measurer.style.lineHeight = info.lineHeight + 'px';
  measurer.style.letterSpacing = info.letterSpacing || 'normal';
  measurer.style.wordSpacing = info.wordSpacing || 'normal';
  measurer.style.paddingTop = info.paddingTop + 'px';
  measurer.style.paddingBottom = info.paddingBottom + 'px';
  measurer.style.paddingLeft = info.paddingLeft + 'px';
  measurer.style.paddingRight = info.paddingRight + 'px';
  var normalized = (text || '').replace(/\r\n/g, '\n');
  if (normalized && normalized.charAt(normalized.length - 1) === '\n') {
    normalized += ' ';
  }
  measurer.textContent = normalized;
  return measurer.scrollHeight || measurer.getBoundingClientRect().height || 0;
}
export function findRawOverflowIndex(text) {
  var normalized = (text || '').replace(/\r\n/g, '\n');
  if (!normalized) return -1;
  var metrics = getRawTextMetrics();
  if (!metrics || !metrics.width) return -1;
  var maxHeight = Math.ceil(documentPaginationState.DOC_LINES_CONTENT * metrics.lineHeight);
  if (!maxHeight) return -1;
  var fullHeight = measureRawTextHeight(normalized, metrics);
  if (fullHeight <= maxHeight) return -1;
  var lo = 0;
  var hi = normalized.length;
  var result = hi;
  while (lo < hi) {
    var mid = Math.floor((lo + hi) / 2);
    var sample = normalized.slice(0, mid);
    var h = measureRawTextHeight(sample, metrics);
    if (h > maxHeight) {
      result = mid;
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return result;
}
export function autoResizeTextarea() {
  if (!readerState.sourceText || documentPaginationState.inputMode !== 'raw') return;
  var maxHeight = getRawMaxHeightPx();
  var minHeight = Math.max(180, getRawMinHeightPx());
  if (maxHeight > 0) minHeight = Math.min(minHeight, maxHeight);
  // Collapse to 1px to get true content height
  readerState.sourceText.style.height = '1px';
  var scrollH = readerState.sourceText.scrollHeight;
  // Set height between min and max
  var newHeight = Math.max(minHeight, Math.min(scrollH, maxHeight));
  readerState.sourceText.style.height = newHeight + 'px';
  if (maxHeight > 0 && scrollH > maxHeight + 1) {
    readerState.sourceText.style.overflowY = 'auto';
  } else {
    readerState.sourceText.style.overflowY = 'hidden';
  }
}

// Keep guidance visible on click/focus; clear only when user starts editing.
export function initializeRawTextSizing() {
  // POS colors for JavaScript (mirror of Python POS_COLORS)
  rawTextSizingState.POS_COLORS_JS = {
    n: '#bbf7d0',
    v: '#fda4af',
    adj: '#fde68a',
    adv: '#fee2e2',
    part: '#e0e7ff',
    conj: '#cffafe',
    pron: '#e2e8f0',
    num: '#f5d0fe',
    int: '#fcd34d',
    post: '#bae6fd',
    punct: '#e5e7eb',
    fw: '#d1d5db',
    afx: '#fef3c7',
    ono: '#ddd6fe',
    unk: '#f3f4f6'
  };
  rawTextSizingState.rawMeasureEl = null;
  readerState.sourceText.addEventListener('beforeinput', function () {
    if (!isShowingInitialInputGuidance()) return;
    clearInitialInputGuidanceIfNeeded();
    autoResizeTextarea();
  });
  readerState.sourceText.addEventListener('input', function () {
    if (readerState.initialInputGuidanceActive) readerState.initialInputGuidanceActive = false;
    if (documentPaginationState.inputMode !== 'raw') setRawMode();
    autoResizeTextarea();
    applyGlobalViewportClamp(false);
    triggerUpdate();
  });
  return true;
}
