import { documentPaginationState } from './document-pagination.state.mjs';
import { autoResizeTextarea } from './raw-text-sizing.mjs';
import { readerState } from './reader-state.state.mjs';
import { renderSegments } from './segment-rendering.mjs';
export function showInitialInputGuidanceIfEmpty() {
  if (!readerState.sourceText) return;
  if ((readerState.sourceText.value || '').trim()) return;
  readerState.sourceText.value = readerState.initialInputGuidance;
  readerState.initialInputGuidanceActive = true;
  autoResizeTextarea();
}
export function clearInitialInputGuidanceIfNeeded() {
  if (!readerState.sourceText || !readerState.initialInputGuidanceActive) return;
  if ((readerState.sourceText.value || '') === readerState.initialInputGuidance) {
    readerState.sourceText.value = '';
  }
  readerState.initialInputGuidanceActive = false;
}
export function isShowingInitialInputGuidance() {
  return (
    !!readerState.sourceText &&
    readerState.initialInputGuidanceActive &&
    (readerState.sourceText.value || '') === readerState.initialInputGuidance
  );
}
export function dismissInitialExampleDemo() {
  if (!readerState.initialExampleDemoActive) return;
  readerState.initialExampleDemoActive = false;
  readerState.latestData = null;
  readerState.latestSegments = [];
  readerState.latestOriginalText = '';
  if (readerState.renderedText) readerState.renderedText.innerHTML = '';
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
}
export function renderInitialExampleDemoIfAvailable() {
  if (!readerState.renderedText) return;
  if (documentPaginationState.currentFile) return;
  if (documentPaginationState.inputMode !== 'raw') return;
  if ((readerState.renderedText.textContent || '').trim()) return;
  if (typeof INITIAL_EXAMPLE_CACHE === 'undefined' || !INITIAL_EXAMPLE_CACHE || !INITIAL_EXAMPLE_CACHE.ok)
    return;
  var cachedData = INITIAL_EXAMPLE_CACHE;
  var exampleText = cachedData.display_text || cachedData.q || '';
  readerState.latestData = cachedData;
  readerState.latestSegments = Array.isArray(cachedData.segments) ? cachedData.segments : [];
  readerState.initialExampleDemoActive = true;
  renderSegments(cachedData, exampleText);
}
export function startSegmentLookupFetch(url) {
  dismissInitialExampleDemo();
  if (readerState.segmentLookupAbort) readerState.segmentLookupAbort.abort();
  readerState.segmentLookupAbort = new AbortController();
  return fetch(url, {
    signal: readerState.segmentLookupAbort.signal
  });
}
export function isAbortError(err) {
  return err && err.name === 'AbortError';
}
export function showRawTextPill(label) {
  readerState.rawTextDocActive = true;
  if (readerState.rawTextText) readerState.rawTextText.textContent = label || 'Clear text';
  if (readerState.rawTextPill) readerState.rawTextPill.style.display = 'inline-flex';
}
export function hideRawTextPill() {
  readerState.rawTextDocActive = false;
  if (readerState.rawTextPill) readerState.rawTextPill.style.display = 'none';
  if (readerState.rawTextText) readerState.rawTextText.textContent = '';
}

// Original view toggle refs
