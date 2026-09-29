import { dependencyState } from './dependency-state.state.mjs';
import { hidePopup } from './popup-placement.mjs';
import { preferencesState } from './preferences.state.mjs';
import { readerState } from './reader-state.state.mjs';
import { segmentRenderingState } from './segment-rendering.state.mjs';
import { ensureFuzzySettingsInitialized } from './settings-panels.mjs';
import { ensureLmWeightsInitialized } from './settings-state.mjs';
import { settingsState } from './settings-state.state.mjs';
export // ===================== END CHUNK HIGHLIGHTING =====================
// Load saved settings from localStorage
function loadDisplaySettings() {
  try {
    var saved = localStorage.getItem('burmeseReaderDisplaySettings');
    if (saved) {
      var parsed = JSON.parse(saved);
      // Backward compat: legacy grammarOverlay bool turns everything on/off
      var legacyGrammarAll = parsed.hasOwnProperty('grammarOverlay') ? !!parsed.grammarOverlay : false;
      settingsState.displaySettings.grammarTypes = parsed.grammarTypes || {};
      settingsState.GRAMMAR_TYPES.forEach(function (t) {
        if (settingsState.displaySettings.grammarTypes[t] === undefined) {
          settingsState.displaySettings.grammarTypes[t] = legacyGrammarAll;
        }
      });
      settingsState.displaySettings.udOverlay =
        parsed.udOverlay !== undefined ? parsed.udOverlay : settingsState.displaySettings.udOverlay;
      settingsState.displaySettings.chunkHighlight =
        parsed.chunkHighlight !== undefined
          ? parsed.chunkHighlight
          : settingsState.displaySettings.chunkHighlight;
      settingsState.displaySettings.nerOverlay =
        parsed.nerOverlay !== undefined ? parsed.nerOverlay : settingsState.displaySettings.nerOverlay;
      settingsState.displaySettings.islandDepTree =
        parsed.islandDepTree !== undefined
          ? parsed.islandDepTree
          : settingsState.displaySettings.islandDepTree;
      settingsState.displaySettings.connectedIslands =
        parsed.connectedIslands !== undefined
          ? parsed.connectedIslands
          : settingsState.displaySettings.connectedIslands;
      settingsState.displaySettings.connectedIslandsAclGate =
        parsed.connectedIslandsAclGate !== undefined
          ? parsed.connectedIslandsAclGate
          : settingsState.displaySettings.connectedIslandsAclGate;
      settingsState.displaySettings.contextWindow =
        parsed.contextWindow !== undefined
          ? parsed.contextWindow
          : settingsState.displaySettings.contextWindow;
      if (parsed.contextWindowSize !== undefined) {
        settingsState.displaySettings.contextWindowSize = parsed.contextWindowSize;
      }
      settingsState.displaySettings.bottomUpChunk =
        parsed.bottomUpChunk !== undefined
          ? parsed.bottomUpChunk
          : settingsState.displaySettings.bottomUpChunk;
      if (parsed.bottomUpChunkThreshold !== undefined) {
        var chunkThreshold = parseInt(parsed.bottomUpChunkThreshold, 10);
        if (isNaN(chunkThreshold)) chunkThreshold = 5;
        if (chunkThreshold < 1) chunkThreshold = 1;
        if (chunkThreshold > 10) chunkThreshold = 10;
        settingsState.displaySettings.bottomUpChunkThreshold = chunkThreshold;
      }
      settingsState.displaySettings.linearClauseSplit =
        parsed.linearClauseSplit !== undefined
          ? parsed.linearClauseSplit
          : settingsState.displaySettings.linearClauseSplit;
      if (parsed.branchDepthMin !== undefined) {
        settingsState.displaySettings.branchDepthMin = parsed.branchDepthMin;
      }
      if (parsed.clauseDepthDrop !== undefined) {
        settingsState.displaySettings.clauseDepthDrop = parsed.clauseDepthDrop;
      }
      settingsState.displaySettings.depTreeView =
        parsed.depTreeView !== undefined
          ? parsed.depTreeView
          : settingsState.displaySettings.depTreeView;
      settingsState.displaySettings.udPopup =
        parsed.udPopup !== undefined ? parsed.udPopup : settingsState.displaySettings.udPopup;
      settingsState.displaySettings.pronunciation =
        parsed.pronunciation !== undefined
          ? parsed.pronunciation
          : settingsState.displaySettings.pronunciation;
      settingsState.displaySettings.grammarPopup =
        parsed.grammarPopup !== undefined
          ? parsed.grammarPopup
          : settingsState.displaySettings.grammarPopup;
      settingsState.displaySettings.dictPopup =
        parsed.dictPopup !== undefined ? parsed.dictPopup : settingsState.displaySettings.dictPopup;
      settingsState.displaySettings.comments =
        parsed.comments !== undefined ? parsed.comments : settingsState.displaySettings.comments;
      if (parsed.fuzzyMaxEditDistance !== undefined) {
        var fuzzyVal = parseInt(parsed.fuzzyMaxEditDistance, 10);
        if (!isNaN(fuzzyVal)) {
          settingsState.displaySettings.fuzzyMaxEditDistance = fuzzyVal;
        }
      }
      settingsState.displaySettings.mergeGreedy =
        parsed.mergeGreedy !== undefined
          ? parsed.mergeGreedy
          : settingsState.displaySettings.mergeGreedy;
      settingsState.displaySettings.splitDictFill =
        parsed.splitDictFill !== undefined
          ? parsed.splitDictFill
          : settingsState.displaySettings.splitDictFill;
      // posOverride, stanzaNer, collapseNerUd, dpResegment are now hardcoded to true
      if (parsed.lmWeights !== undefined) {
        settingsState.displaySettings.lmWeights = parsed.lmWeights;
      }
      ensureLmWeightsInitialized();
      ensureFuzzySettingsInitialized();
    }
  } catch (e) {
    console.error('Failed to load display settings:', e);
  }
  ensureLmWeightsInitialized();
  ensureFuzzySettingsInitialized();
}
// Save settings to localStorage
export function saveDisplaySettings() {
  try {
    localStorage.setItem('burmeseReaderDisplaySettings', JSON.stringify(settingsState.displaySettings));
  } catch (e) {
    console.error('Failed to save display settings:', e);
  }
}
// Load settings on startup
export function applyViewMode() {
  var showDep = !!settingsState.displaySettings.depTreeView;
  if (readerState.renderedText) readerState.renderedText.style.display = showDep ? 'none' : 'block';
  if (readerState.depTreeViewEl)
    readerState.depTreeViewEl.style.display = showDep ? 'block' : 'none';
  if (window.DepTreeView && typeof window.DepTreeView.setVisible === 'function') {
    window.DepTreeView.setVisible(showDep);
  }
  if (showDep) {
    if (window.DepTreeView && typeof window.DepTreeView.refitView === 'function') {
      window.DepTreeView.refitView();
    }
    hidePopup();
  }
}
export function initDepTreeView() {
  if (!readerState.depTreeViewEl || !window.DepTreeView || typeof window.DepTreeView.init !== 'function')
    return;
  readerState.depTreeController = window.DepTreeView;
  readerState.depTreeController.init({
    container: readerState.depTreeViewEl,
    chunkHighlight: settingsState.displaySettings.chunkHighlight,
    dictPopup: settingsState.displaySettings.dictPopup,
    linearClauseSplit: settingsState.displaySettings.linearClauseSplit,
    branchDepthMin: settingsState.displaySettings.branchDepthMin,
    clauseDepthDrop: settingsState.displaySettings.clauseDepthDrop,
    bottomUpChunkThreshold: settingsState.displaySettings.bottomUpChunkThreshold
  });
  if (typeof readerState.depTreeController.setSourceToggleState === 'function') {
    readerState.depTreeController.setSourceToggleState(readerState.depTreeUseConllu);
  }
  if (
    readerState.depTreeUseConllu &&
    readerState.depTreeConlluMetaUrl &&
    readerState.depTreeConlluUrl &&
    typeof readerState.depTreeController.loadConlluSentenceSource === 'function'
  ) {
    readerState.depTreeController.loadConlluSentenceSource(
      readerState.depTreeConlluMetaUrl,
      readerState.depTreeConlluUrl
    );
  } else if (
    readerState.depTreeUseConllu &&
    readerState.depTreeConlluUrl &&
    typeof readerState.depTreeController.loadConlluFromUrl === 'function'
  ) {
    readerState.depTreeController.loadConlluFromUrl(readerState.depTreeConlluUrl);
  }
  readerState.depTreeController.setVisible(settingsState.displaySettings.depTreeView);
}
export function updateDepTreeFromLatestData() {
  if (!readerState.depTreeController || typeof readerState.depTreeController.setData !== 'function')
    return;
  if (!readerState.latestSegments || !dependencyState.latestUdOverlay) {
    readerState.depTreeController.setData({
      segments: [],
      udOverlay: null
    });
    return;
  }
  readerState.depTreeController.debugMode = false;
  readerState.depTreeController.changedTokens = null;
  readerState.depTreeController.changeDetails = null;
  readerState.depTreeController.fills = readerState.latestFillsDict || {};
  readerState.depTreeController.setData({
    segments: readerState.latestSegments,
    udOverlay: dependencyState.latestUdOverlay,
    originalText: readerState.latestOriginalText
  });
}
export function setDepTreeSourceMode(useConllu) {
  readerState.depTreeUseConllu = !!useConllu;
  if (
    readerState.depTreeController &&
    typeof readerState.depTreeController.setSourceToggleState === 'function'
  ) {
    readerState.depTreeController.setSourceToggleState(readerState.depTreeUseConllu);
  }
  if (readerState.depTreeUseConllu) {
    if (
      readerState.depTreeController &&
      typeof readerState.depTreeController.loadConlluSentenceSource === 'function'
    ) {
      readerState.depTreeController.loadConlluSentenceSource(
        readerState.depTreeConlluMetaUrl,
        readerState.depTreeConlluUrl
      );
    }
  } else {
    if (
      readerState.depTreeController &&
      typeof readerState.depTreeController.clearSentenceSource === 'function'
    ) {
      readerState.depTreeController.clearSentenceSource();
    }
    updateDepTreeFromLatestData();
  }
}
export function getCurrentHoverSegIdx() {
  if (!segmentRenderingState.currentSpan) return -1;
  var base = segmentRenderingState.currentSpan;
  if (base.classList && base.classList.contains('reader-subtoken')) {
    base = base.closest('.reader-token');
  }
  if (!base || !base.dataset) return -1;
  return parseInt(base.dataset.index || '-1', 10);
}
export function appendLmWeightsToUrl(url) {
  if (!settingsState.displaySettings.lmWeights) return url;
  settingsState.LM_WEIGHT_FIELDS.forEach(function (field) {
    var val = settingsState.displaySettings.lmWeights[field.key];
    if (typeof val === 'number' && isFinite(val)) {
      url += '&' + field.param + '=' + encodeURIComponent(val);
    }
  });
  return url;
}
export function buildLookupUrl(q) {
  var url = '/lookup?q=' + encodeURIComponent(q || '');
  url += '&merge_greedy=' + (settingsState.displaySettings.mergeGreedy ? '1' : '0');
  url += '&split_fill=' + (settingsState.displaySettings.splitDictFill ? '1' : '0');
  url += '&pos_override=' + (settingsState.displaySettings.posOverride ? '1' : '0');
  url += '&stanza_ner=' + (settingsState.displaySettings.stanzaNer ? '1' : '0');
  url += '&collapse_ner_spans=' + (settingsState.displaySettings.collapseNerUd ? '1' : '0');
  url += '&dp_resegment=' + (settingsState.displaySettings.dpResegment ? '1' : '0');
  return appendLmWeightsToUrl(url);
}
export function buildLookupUrlLite(q) {
  var url = '/lookup?q=' + encodeURIComponent(q || '');
  url += '&merge_greedy=' + (settingsState.displaySettings.mergeGreedy ? '1' : '0');
  url += '&split_fill=' + (settingsState.displaySettings.splitDictFill ? '1' : '0');
  url += '&collapse_ner_spans=' + (settingsState.displaySettings.collapseNerUd ? '1' : '0');
  url += '&lite=1';
  return appendLmWeightsToUrl(url);
}
export function buildLookupUrlRaw(q, exact) {
  var url = '/lookup?q=' + encodeURIComponent(q || '');
  url += '&raw=1';
  if (exact) url += '&exact=1';
  url += '&stanza_ner=' + (settingsState.displaySettings.stanzaNer ? '1' : '0');
  url += '&collapse_ner_spans=' + (settingsState.displaySettings.collapseNerUd ? '1' : '0');
  url += '&dp_resegment=' + (settingsState.displaySettings.dpResegment ? '1' : '0');
  return appendLmWeightsToUrl(url);
}
// Display controls dropdown
export function initializePreferences() {
  loadDisplaySettings();
  preferencesState.displayToggleBtn = document.getElementById('displayToggleBtn');
  return true;
}
