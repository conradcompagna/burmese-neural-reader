import { triggerUpdate } from './lookup.mjs';
import { applyViewMode, initDepTreeView, saveDisplaySettings } from './preferences.mjs';
import { readerState } from './reader-state.state.mjs';
import { renderSegments } from './segment-rendering.mjs';
import { settingsPanelsState } from './settings-panels.state.mjs';
import { ensureLmWeightsInitialized } from './settings-state.mjs';
import { settingsState } from './settings-state.state.mjs';
import { debounce } from './text.mjs';
export function ensureGrammarTypesInitialized() {
  settingsState.GRAMMAR_TYPES.forEach(function (t) {
    if (settingsState.displaySettings.grammarTypes[t] === undefined) {
      settingsState.displaySettings.grammarTypes[t] = false;
    }
  });
}
export function ensureFuzzySettingsInitialized() {
  if (
    typeof settingsState.displaySettings.fuzzyMaxEditDistance !== 'number' ||
    !isFinite(settingsState.displaySettings.fuzzyMaxEditDistance)
  ) {
    settingsState.displaySettings.fuzzyMaxEditDistance = 3;
  }
  if (settingsState.displaySettings.fuzzyMaxEditDistance < 0) {
    settingsState.displaySettings.fuzzyMaxEditDistance = 0;
  }
  if (settingsState.displaySettings.fuzzyMaxEditDistance > 6) {
    settingsState.displaySettings.fuzzyMaxEditDistance = 6;
  }
}
export function syncMasterGrammarToggle() {
  if (!settingsPanelsState.toggleGrammarOverlayAll) return;
  var allOn = settingsState.GRAMMAR_TYPES.length
    ? settingsState.GRAMMAR_TYPES.every(function (t) {
        return settingsState.displaySettings.grammarTypes[t];
      })
    : false;
  settingsPanelsState.toggleGrammarOverlayAll.checked = allOn;
}
export function renderGrammarTypeCheckboxes() {
  if (!settingsPanelsState.grammarOverlayPanel) return;
  settingsPanelsState.grammarOverlayPanel.innerHTML = '';
  var header = document.createElement('h4');
  header.textContent = 'Grammar categories';
  settingsPanelsState.grammarOverlayPanel.appendChild(header);
  var list = document.createElement('div');
  list.className = 'toggle-grid';
  settingsPanelsState.grammarOverlayPanel.appendChild(list);
  settingsState.GRAMMAR_TYPES.forEach(function (t) {
    var label = document.createElement('label');
    label.className = 'toggle-label';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!settingsState.displaySettings.grammarTypes[t];
    cb.dataset.grammarType = t;
    cb.addEventListener('change', function () {
      var gt = this.dataset.grammarType;
      settingsState.displaySettings.grammarTypes[gt] = this.checked;
      syncMasterGrammarToggle();
      saveDisplaySettings();
      if (readerState.latestData) {
        renderSegments(readerState.latestData, readerState.sourceText.value);
      }
    });
    var span = document.createElement('span');
    span.textContent = t;
    label.appendChild(cb);
    label.appendChild(span);
    list.appendChild(label);
  });
}

// Sync checkboxes with loaded settings
export function openGrammarOverlayPanelUI() {
  if (!settingsPanelsState.displayDropdown) return;
  if (!settingsPanelsState.grammarOverlayPanel) {
    settingsPanelsState.grammarOverlayPanel = document.createElement('div');
    settingsPanelsState.grammarOverlayPanel.id = 'grammarOverlayPanel';
    settingsPanelsState.grammarOverlayPanel.className = 'grammar-overlay-panel';
    settingsPanelsState.displayDropdown.appendChild(settingsPanelsState.grammarOverlayPanel);
  }
  renderGrammarTypeCheckboxes();
  settingsPanelsState.grammarOverlayPanel.style.display = 'block';
}
export function closeGrammarOverlayPanel() {
  if (settingsPanelsState.grammarOverlayPanel) settingsPanelsState.grammarOverlayPanel.style.display = 'none';
}
export function renderLmWeightsPanel() {
  if (!settingsPanelsState.lmWeightsPanel) return;
  ensureLmWeightsInitialized();
  settingsPanelsState.lmWeightsPanel.innerHTML = '';
  var header = document.createElement('h4');
  header.textContent = 'LM weights';
  settingsPanelsState.lmWeightsPanel.appendChild(header);
  var list = document.createElement('div');
  list.className = 'toggle-grid';
  settingsPanelsState.lmWeightsPanel.appendChild(list);
  var updateWeights = debounce(function () {
    saveDisplaySettings();
    if (readerState.sourceText && readerState.sourceText.value) {
      triggerUpdate();
    }
  }, 300);
  var inputsByKey = {};
  settingsState.LM_WEIGHT_FIELDS.forEach(function (field) {
    var row = document.createElement('label');
    row.className = 'toggle-label';
    row.style.justifyContent = 'space-between';
    row.style.width = '100%';
    var name = document.createElement('span');
    name.textContent = field.label;
    var input = document.createElement('input');
    input.type = 'number';
    input.step = field.step || '0.1';
    input.value = String(settingsState.displaySettings.lmWeights[field.key]);
    input.style.width = '90px';
    input.dataset.lmKey = field.key;
    inputsByKey[field.key] = input;
    input.addEventListener('input', function () {
      var nextVal = parseFloat(this.value);
      if (!isFinite(nextVal)) return;
      settingsState.displaySettings.lmWeights[field.key] = nextVal;
      updateWeights();
    });
    input.addEventListener('change', function () {
      var nextVal = parseFloat(this.value);
      if (!isFinite(nextVal)) {
        this.value = String(settingsState.displaySettings.lmWeights[field.key]);
        return;
      }
      settingsState.displaySettings.lmWeights[field.key] = nextVal;
      updateWeights();
    });
    row.appendChild(name);
    row.appendChild(input);
    list.appendChild(row);
  });
  var resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'dropdown-button';
  resetBtn.textContent = 'Reset to defaults';
  resetBtn.addEventListener('click', function () {
    settingsState.displaySettings.lmWeights = Object.assign({}, settingsState.LM_WEIGHT_DEFAULTS);
    Object.keys(inputsByKey).forEach(function (key) {
      if (inputsByKey[key]) {
        inputsByKey[key].value = String(settingsState.displaySettings.lmWeights[key]);
      }
    });
    saveDisplaySettings();
    if (readerState.sourceText && readerState.sourceText.value) {
      triggerUpdate();
    }
  });
  settingsPanelsState.lmWeightsPanel.appendChild(resetBtn);
}
export function openLmWeightsPanelUI() {
  if (!settingsPanelsState.displayDropdown) return;
  if (!settingsPanelsState.lmWeightsPanel) {
    settingsPanelsState.lmWeightsPanel = document.createElement('div');
    settingsPanelsState.lmWeightsPanel.id = 'lmWeightsPanel';
    settingsPanelsState.lmWeightsPanel.className = 'grammar-overlay-panel';
    settingsPanelsState.displayDropdown.appendChild(settingsPanelsState.lmWeightsPanel);
  }
  closeGrammarOverlayPanel();
  renderLmWeightsPanel();
  settingsPanelsState.lmWeightsPanel.style.display = 'block';
}
export function closeLmWeightsPanel() {
  if (settingsPanelsState.lmWeightsPanel) settingsPanelsState.lmWeightsPanel.style.display = 'none';
}
export function initializeSettingsPanels() {
  settingsPanelsState.displayDropdown = document.getElementById('displayDropdown');
  settingsPanelsState.toggleDepTreeView = document.getElementById('toggleDepTreeView');
  settingsPanelsState.toggleGrammarOverlayAll = document.getElementById('toggleGrammarOverlayAll');
  settingsPanelsState.openGrammarOverlayPanel = document.getElementById('openGrammarOverlayPanel');
  settingsPanelsState.grammarOverlayPanel = null;
  settingsPanelsState.openLmWeightsPanel = document.getElementById('openLmWeightsPanel');
  settingsPanelsState.lmWeightsPanel = null;
  // OBSOLETE: greedy/split post-passes replaced by DP resegmentation
  // var toggleMergeGreedy = document.getElementById('toggleMergeGreedy');
  // var toggleSplitDictFill = document.getElementById('toggleSplitDictFill');
  // posOverride, stanzaNer, collapseNerUd, dpResegment toggles removed - now hardcoded
  settingsPanelsState.toggleUdOverlay = document.getElementById('toggleUdOverlay');
  settingsPanelsState.toggleChunkHighlight = document.getElementById('toggleChunkHighlight');
  settingsPanelsState.toggleNerOverlay = document.getElementById('toggleNerOverlay');
  settingsPanelsState.toggleIslandDepTree = document.getElementById('toggleIslandDepTree');
  settingsPanelsState.toggleConnectedIslands = document.getElementById('toggleConnectedIslands');
  settingsPanelsState.toggleConnectedIslandsAclGate = document.getElementById(
    'toggleConnectedIslandsAclGate'
  );
  settingsPanelsState.toggleContextWindow = document.getElementById('toggleContextWindow');
  settingsPanelsState.contextWindowSizeInput = document.getElementById('contextWindowSize');
  settingsPanelsState.toggleBottomUpChunk = document.getElementById('toggleBottomUpChunk');
  settingsPanelsState.bottomUpChunkThresholdInput = document.getElementById('bottomUpChunkThreshold');
  settingsPanelsState.branchDepthMinInput = document.getElementById('branchDepthMin');
  settingsPanelsState.clauseDepthDropInput = document.getElementById('clauseDepthDrop');
  settingsPanelsState.togglePronunciation = document.getElementById('togglePronunciation');
  settingsPanelsState.toggleGrammarPopup = document.getElementById('toggleGrammarPopup');
  settingsPanelsState.toggleDictPopup = document.getElementById('toggleDictPopup');
  settingsPanelsState.togglePdfjsTextLayer = document.getElementById('togglePdfjsTextLayer');
  settingsPanelsState.pdfTextSourceGroup = document.getElementById('pdfTextSourceGroup');
  settingsPanelsState.fuzzyMaxEditDistanceInput = document.getElementById('fuzzyMaxEditDistance');
  settingsPanelsState.toggleComments = document.getElementById('toggleComments');
  settingsPanelsState.toggleSubsegmentPopups = document.getElementById('toggleSubsegmentPopups');
  ensureGrammarTypesInitialized();
  ensureLmWeightsInitialized();
  ensureFuzzySettingsInitialized();
  syncMasterGrammarToggle();
  if (settingsPanelsState.toggleDepTreeView)
    settingsPanelsState.toggleDepTreeView.checked = settingsState.displaySettings.depTreeView;
  // OBSOLETE: greedy/split post-passes replaced by DP resegmentation
  // if (toggleMergeGreedy) toggleMergeGreedy.checked = displaySettings.mergeGreedy;
  // if (toggleSplitDictFill) toggleSplitDictFill.checked = displaySettings.splitDictFill;
  if (settingsPanelsState.toggleIslandDepTree)
    settingsPanelsState.toggleIslandDepTree.checked = settingsState.displaySettings.islandDepTree;
  if (settingsPanelsState.toggleConnectedIslands)
    settingsPanelsState.toggleConnectedIslands.checked = settingsState.displaySettings.connectedIslands;
  if (settingsPanelsState.toggleConnectedIslandsAclGate)
    settingsPanelsState.toggleConnectedIslandsAclGate.checked =
      settingsState.displaySettings.connectedIslandsAclGate;
  if (settingsPanelsState.toggleContextWindow)
    settingsPanelsState.toggleContextWindow.checked = settingsState.displaySettings.contextWindow;
  if (settingsPanelsState.contextWindowSizeInput)
    settingsPanelsState.contextWindowSizeInput.value = settingsState.displaySettings.contextWindowSize;
  if (settingsPanelsState.toggleBottomUpChunk)
    settingsPanelsState.toggleBottomUpChunk.checked = settingsState.displaySettings.bottomUpChunk;
  if (settingsPanelsState.bottomUpChunkThresholdInput)
    settingsPanelsState.bottomUpChunkThresholdInput.value =
      settingsState.displaySettings.bottomUpChunkThreshold;
  // posOverride, stanzaNer, collapseNerUd, dpResegment checkboxes removed - now hardcoded
  if (settingsPanelsState.branchDepthMinInput)
    settingsPanelsState.branchDepthMinInput.value = settingsState.displaySettings.branchDepthMin;
  if (settingsPanelsState.clauseDepthDropInput)
    settingsPanelsState.clauseDepthDropInput.value = settingsState.displaySettings.clauseDepthDrop;
  if (settingsPanelsState.toggleUdOverlay)
    settingsPanelsState.toggleUdOverlay.checked = settingsState.displaySettings.udOverlay;
  if (settingsPanelsState.toggleChunkHighlight)
    settingsPanelsState.toggleChunkHighlight.checked = settingsState.displaySettings.chunkHighlight;
  if (settingsPanelsState.toggleNerOverlay)
    settingsPanelsState.toggleNerOverlay.checked = settingsState.displaySettings.nerOverlay;
  if (settingsPanelsState.togglePronunciation)
    settingsPanelsState.togglePronunciation.checked = settingsState.displaySettings.pronunciation;
  if (settingsPanelsState.toggleGrammarPopup)
    settingsPanelsState.toggleGrammarPopup.checked = settingsState.displaySettings.grammarPopup;
  if (settingsPanelsState.toggleDictPopup)
    settingsPanelsState.toggleDictPopup.checked = settingsState.displaySettings.dictPopup;
  if (settingsPanelsState.fuzzyMaxEditDistanceInput)
    settingsPanelsState.fuzzyMaxEditDistanceInput.value =
      settingsState.displaySettings.fuzzyMaxEditDistance;
  if (settingsPanelsState.toggleComments)
    settingsPanelsState.toggleComments.checked = settingsState.displaySettings.comments;
  renderGrammarTypeCheckboxes();
  initDepTreeView();
  applyViewMode();

  // Legacy closeAllMenus - now handled by left sidebar
  return true;
}
