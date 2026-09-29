import { applyChunkHighlight, clearChunkHighlight } from './chunk-highlighting.mjs';
import { computeChunks } from './chunk-model.mjs';
import { chunkModelState } from './chunk-model.state.mjs';
import { clearBottomUpChunkCache } from './context-chunks.mjs';
import { hideUdLines, invalidateUdRectCache, invalidateUiRectCache } from './dependency-geometry.mjs';
import { drawUdLinesForToken } from './dependency-highlighting.mjs';
import { dependencyState } from './dependency-state.state.mjs';
import { documentPaginationState } from './document-pagination.state.mjs';
import { hideNerHover, renderNerHoverForToken } from './entity-hover.mjs';
import { computeAndCacheRowBands, invalidateRowBandCache } from './hover-interaction.mjs';
import { rebuildConnectedIslandGroups } from './island-groups.mjs';
import { triggerUpdate } from './lookup.mjs';
import { menuEventsState } from './menu-events.state.mjs';
import { applyViewMode, getCurrentHoverSegIdx, saveDisplaySettings } from './preferences.mjs';
import { readerState } from './reader-state.state.mjs';
import { renderSegments } from './segment-rendering.mjs';
import {
  closeGrammarOverlayPanel,
  closeLmWeightsPanel,
  openGrammarOverlayPanelUI,
  openLmWeightsPanelUI,
  renderGrammarTypeCheckboxes
} from './settings-panels.mjs';
import { settingsPanelsState } from './settings-panels.state.mjs';
import { settingsState } from './settings-state.state.mjs';
export // Legacy closeAllMenus - now handled by left sidebar
function closeAllMenus(except) {
  closeGrammarOverlayPanel();
  closeLmWeightsPanel();
}
// Invalidate row band cache on resize/scroll (positions change)
export function initializeMenuEvents() {
  menuEventsState.resizeDebounceTimer = null;
  window.addEventListener('resize', function () {
    invalidateUdRectCache();
    invalidateUiRectCache();
    if (menuEventsState.resizeDebounceTimer) clearTimeout(menuEventsState.resizeDebounceTimer);
    menuEventsState.resizeDebounceTimer = setTimeout(function () {
      invalidateRowBandCache();
      computeAndCacheRowBands();
    }, 100);
  });
  if (readerState.renderedText) {
    readerState.renderedText.addEventListener('scroll', function () {
      invalidateRowBandCache();
      invalidateUdRectCache();
      invalidateUiRectCache();
    });
  }
  // Grammar overlay master toggle (select/deselect all)
  if (settingsPanelsState.toggleGrammarOverlayAll) {
    settingsPanelsState.toggleGrammarOverlayAll.addEventListener('change', function () {
      var val = this.checked;
      settingsState.GRAMMAR_TYPES.forEach(function (t) {
        settingsState.displaySettings.grammarTypes[t] = val;
      });
      saveDisplaySettings();
      renderGrammarTypeCheckboxes();
      if (readerState.latestData) {
        renderSegments(readerState.latestData, readerState.sourceText.value);
      }
    });
  }
  // Open grammar overlay panel
  if (settingsPanelsState.openGrammarOverlayPanel) {
    settingsPanelsState.openGrammarOverlayPanel.addEventListener('click', function (e) {
      e.stopPropagation();
      openGrammarOverlayPanelUI();
    });
  }
  if (settingsPanelsState.openLmWeightsPanel) {
    settingsPanelsState.openLmWeightsPanel.addEventListener('click', function (e) {
      e.stopPropagation();
      openLmWeightsPanelUI();
    });
  }
  if (settingsPanelsState.toggleDepTreeView) {
    settingsPanelsState.toggleDepTreeView.addEventListener('change', function () {
      settingsState.displaySettings.depTreeView = this.checked;
      saveDisplaySettings();
      applyViewMode();
    });
  }
  // OBSOLETE: greedy/split post-passes replaced by DP resegmentation
  // if (toggleMergeGreedy) {
  //   toggleMergeGreedy.addEventListener('change', function() {
  //     displaySettings.mergeGreedy = this.checked;
  //     saveDisplaySettings();
  //     if (sourceText && sourceText.value) {
  //       triggerUpdate();
  //     }
  //   });
  // }
  // if (toggleSplitDictFill) {
  //   toggleSplitDictFill.addEventListener('change', function() {
  //     displaySettings.splitDictFill = this.checked;
  //     saveDisplaySettings();
  //     if (sourceText && sourceText.value) {
  //       triggerUpdate();
  //     }
  //   });
  // }
  // Event listeners for posOverride, stanzaNer, collapseNerUd, dpResegment removed
  // These settings are now hardcoded to true
  if (settingsPanelsState.toggleUdOverlay) {
    settingsPanelsState.toggleUdOverlay.addEventListener('change', function () {
      settingsState.displaySettings.udOverlay = this.checked;
      // DEPLOYMENT: Auto-enable bottom-up chunk when UD arrows or chunks are on
      if (settingsState.displaySettings.udOverlay || settingsState.displaySettings.chunkHighlight) {
        settingsState.displaySettings.bottomUpChunk = true;
        if (settingsPanelsState.toggleBottomUpChunk) settingsPanelsState.toggleBottomUpChunk.checked = true;
      }
      saveDisplaySettings();
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0) {
        // Re-apply UD lines
        if (settingsState.displaySettings.udOverlay) {
          drawUdLinesForToken(segIdx);
        } else {
          hideUdLines();
        }
        // Also re-apply chunk highlighting (keep in sync)
        applyChunkHighlight(segIdx);
      } else {
        hideUdLines();
      }
    });
  }
  if (settingsPanelsState.toggleChunkHighlight) {
    settingsPanelsState.toggleChunkHighlight.addEventListener('change', function () {
      settingsState.displaySettings.chunkHighlight = this.checked;
      settingsState.displaySettings.linearClauseSplit = this.checked; // UD chunks now controls linear clause split
      // DEPLOYMENT: Auto-enable bottom-up chunk when UD arrows or chunks are on
      if (settingsState.displaySettings.udOverlay || settingsState.displaySettings.chunkHighlight) {
        settingsState.displaySettings.bottomUpChunk = true;
        if (settingsPanelsState.toggleBottomUpChunk) settingsPanelsState.toggleBottomUpChunk.checked = true;
      }
      saveDisplaySettings();
      // Recompute chunks (use max depth 100 when on, 0 when off)
      if (dependencyState.latestUdOverlay) {
        chunkModelState.latestChunks = computeChunks(
          dependencyState.latestUdOverlay,
          settingsState.displaySettings.chunkHighlight ? 100 : 0,
          settingsState.displaySettings.linearClauseSplit ||
            settingsState.displaySettings.udOverlay,
          settingsState.displaySettings.branchDepthMin,
          settingsState.displaySettings.clauseDepthDrop
        );
      }
      // Sync with tree view
      if (
        readerState.depTreeController &&
        typeof readerState.depTreeController.setChunkHighlight === 'function'
      ) {
        readerState.depTreeController.setChunkHighlight(
          settingsState.displaySettings.chunkHighlight
        );
      }
      if (
        readerState.depTreeController &&
        typeof readerState.depTreeController.setLinearClauseSplit === 'function'
      ) {
        readerState.depTreeController.setLinearClauseSplit(
          settingsState.displaySettings.linearClauseSplit
        );
      }
      // Re-apply all hover highlights if applicable
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0) {
        // Re-apply UD lines (keep in sync)
        if (settingsState.displaySettings.udOverlay) {
          drawUdLinesForToken(segIdx);
        }
        // Re-apply chunk highlighting
        applyChunkHighlight(segIdx);
      } else {
        // Clear highlighting if no hover
        clearChunkHighlight();
      }
    });
  }
  if (settingsPanelsState.toggleNerOverlay) {
    settingsPanelsState.toggleNerOverlay.addEventListener('change', function () {
      settingsState.displaySettings.nerOverlay = this.checked;
      saveDisplaySettings();
      var segIdx = getCurrentHoverSegIdx();
      if (settingsState.displaySettings.nerOverlay && segIdx >= 0) {
        renderNerHoverForToken(segIdx);
      } else {
        hideNerHover();
      }
    });
  }
  if (settingsPanelsState.toggleIslandDepTree) {
    settingsPanelsState.toggleIslandDepTree.addEventListener('change', function () {
      settingsState.displaySettings.islandDepTree = this.checked;
      saveDisplaySettings();
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0) {
        if (settingsState.displaySettings.udOverlay) {
          drawUdLinesForToken(segIdx);
        }
        applyChunkHighlight(segIdx);
      } else {
        hideUdLines();
        clearChunkHighlight();
      }
    });
  }
  if (settingsPanelsState.toggleConnectedIslands) {
    settingsPanelsState.toggleConnectedIslands.addEventListener('change', function () {
      settingsState.displaySettings.connectedIslands = this.checked;
      saveDisplaySettings();
      rebuildConnectedIslandGroups();
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0) {
        if (settingsState.displaySettings.udOverlay) {
          drawUdLinesForToken(segIdx);
        }
        applyChunkHighlight(segIdx);
      } else {
        hideUdLines();
        clearChunkHighlight();
      }
    });
  }
  if (settingsPanelsState.toggleConnectedIslandsAclGate) {
    settingsPanelsState.toggleConnectedIslandsAclGate.addEventListener('change', function () {
      settingsState.displaySettings.connectedIslandsAclGate = this.checked;
      saveDisplaySettings();
      rebuildConnectedIslandGroups();
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0) {
        if (settingsState.displaySettings.udOverlay) {
          drawUdLinesForToken(segIdx);
        }
        applyChunkHighlight(segIdx);
      } else {
        hideUdLines();
        clearChunkHighlight();
      }
    });
  }
  if (settingsPanelsState.toggleContextWindow) {
    settingsPanelsState.toggleContextWindow.addEventListener('change', function () {
      settingsState.displaySettings.contextWindow = this.checked;
      saveDisplaySettings();
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0) {
        if (settingsState.displaySettings.udOverlay) {
          drawUdLinesForToken(segIdx);
        }
        applyChunkHighlight(segIdx);
      } else {
        hideUdLines();
        clearChunkHighlight();
      }
    });
  }
  if (settingsPanelsState.contextWindowSizeInput) {
    settingsPanelsState.contextWindowSizeInput.addEventListener('change', function () {
      var val = parseInt(this.value, 10);
      if (isNaN(val)) val = 10;
      if (val < 1) val = 1;
      if (val > 50) val = 50;
      this.value = val;
      settingsState.displaySettings.contextWindowSize = val;
      saveDisplaySettings();
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0 && settingsState.displaySettings.contextWindow) {
        if (settingsState.displaySettings.udOverlay) {
          drawUdLinesForToken(segIdx);
        }
        applyChunkHighlight(segIdx);
      }
    });
  }
  if (settingsPanelsState.toggleBottomUpChunk) {
    settingsPanelsState.toggleBottomUpChunk.addEventListener('change', function () {
      settingsState.displaySettings.bottomUpChunk = this.checked;
      saveDisplaySettings();
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0) {
        if (settingsState.displaySettings.udOverlay) {
          drawUdLinesForToken(segIdx);
        }
        applyChunkHighlight(segIdx);
      } else {
        hideUdLines();
        clearChunkHighlight();
      }
    });
  }
  if (settingsPanelsState.bottomUpChunkThresholdInput) {
    settingsPanelsState.bottomUpChunkThresholdInput.addEventListener('change', function () {
      var val = parseInt(this.value, 10);
      if (isNaN(val)) val = 5;
      if (val < 1) val = 1;
      if (val > 10) val = 10;
      this.value = val;
      settingsState.displaySettings.bottomUpChunkThreshold = val;
      saveDisplaySettings();
      // Sync with dep tree view
      if (
        readerState.depTreeController &&
        typeof readerState.depTreeController.setBottomUpChunkThreshold === 'function'
      ) {
        readerState.depTreeController.setBottomUpChunkThreshold(val);
      }
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0 && settingsState.displaySettings.bottomUpChunk) {
        clearBottomUpChunkCache();
        if (settingsState.displaySettings.udOverlay) {
          drawUdLinesForToken(segIdx);
        }
        applyChunkHighlight(segIdx);
      }
    });
  }
  menuEventsState.resetThresholdBtn = document.getElementById('resetThresholdBtn');
  if (menuEventsState.resetThresholdBtn && settingsPanelsState.bottomUpChunkThresholdInput) {
    menuEventsState.resetThresholdBtn.addEventListener('click', function () {
      var defaultVal = 5;
      settingsPanelsState.bottomUpChunkThresholdInput.value = defaultVal;
      settingsState.displaySettings.bottomUpChunkThreshold = defaultVal;
      saveDisplaySettings();
      if (
        readerState.depTreeController &&
        typeof readerState.depTreeController.setBottomUpChunkThreshold === 'function'
      ) {
        readerState.depTreeController.setBottomUpChunkThreshold(defaultVal);
      }
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0 && settingsState.displaySettings.bottomUpChunk) {
        clearBottomUpChunkCache();
        if (settingsState.displaySettings.udOverlay) {
          drawUdLinesForToken(segIdx);
        }
        applyChunkHighlight(segIdx);
      }
    });
  }
  if (settingsPanelsState.branchDepthMinInput) {
    settingsPanelsState.branchDepthMinInput.addEventListener('change', function () {
      var val = parseInt(this.value, 10);
      if (isNaN(val)) val = 1;
      if (val < 1) val = 1;
      if (val > 10) val = 10;
      this.value = val;
      settingsState.displaySettings.branchDepthMin = val;
      saveDisplaySettings();
      if (dependencyState.latestUdOverlay) {
        chunkModelState.latestChunks = computeChunks(
          dependencyState.latestUdOverlay,
          settingsState.displaySettings.chunkHighlight ? 100 : 0,
          settingsState.displaySettings.linearClauseSplit ||
            settingsState.displaySettings.udOverlay,
          settingsState.displaySettings.branchDepthMin,
          settingsState.displaySettings.clauseDepthDrop
        );
      }
      if (
        readerState.depTreeController &&
        typeof readerState.depTreeController.setBranchDepthMin === 'function'
      ) {
        readerState.depTreeController.setBranchDepthMin(
          settingsState.displaySettings.branchDepthMin
        );
      }
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0) {
        applyChunkHighlight(segIdx);
      } else {
        clearChunkHighlight();
      }
    });
  }
  if (settingsPanelsState.clauseDepthDropInput) {
    settingsPanelsState.clauseDepthDropInput.addEventListener('change', function () {
      var val = parseInt(this.value, 10);
      if (isNaN(val)) val = 3;
      if (val < 0) val = 0;
      if (val > 10) val = 10;
      this.value = val;
      settingsState.displaySettings.clauseDepthDrop = val;
      saveDisplaySettings();
      if (dependencyState.latestUdOverlay) {
        chunkModelState.latestChunks = computeChunks(
          dependencyState.latestUdOverlay,
          settingsState.displaySettings.chunkHighlight ? 100 : 0,
          settingsState.displaySettings.linearClauseSplit ||
            settingsState.displaySettings.udOverlay,
          settingsState.displaySettings.branchDepthMin,
          settingsState.displaySettings.clauseDepthDrop
        );
      }
      if (
        readerState.depTreeController &&
        typeof readerState.depTreeController.setClauseDepthDrop === 'function'
      ) {
        readerState.depTreeController.setClauseDepthDrop(
          settingsState.displaySettings.clauseDepthDrop
        );
      }
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0) {
        applyChunkHighlight(segIdx);
      } else {
        clearChunkHighlight();
      }
    });
  }
  // Pronunciation popup toggle
  if (settingsPanelsState.togglePronunciation) {
    settingsPanelsState.togglePronunciation.addEventListener('change', function () {
      settingsState.displaySettings.pronunciation = this.checked;
      saveDisplaySettings();
      if (!this.checked && readerState.g2pPopup) {
        readerState.g2pPopup.style.display = 'none';
      }
    });
  }
  // Grammar popup toggle
  if (settingsPanelsState.toggleGrammarPopup) {
    settingsPanelsState.toggleGrammarPopup.addEventListener('change', function () {
      settingsState.displaySettings.grammarPopup = this.checked;
      saveDisplaySettings();
      if (!this.checked && readerState.grammarPopup) {
        readerState.grammarPopup.style.display = 'none';
      }
    });
  }
  // Dictionary popup toggle
  if (settingsPanelsState.toggleDictPopup) {
    settingsPanelsState.toggleDictPopup.addEventListener('change', function () {
      settingsState.displaySettings.dictPopup = this.checked;
      saveDisplaySettings();
      if (!this.checked && readerState.hoverPopup) {
        readerState.hoverPopup.style.display = 'none';
      }
      // Sync with tree view
      if (
        readerState.depTreeController &&
        typeof readerState.depTreeController.setDictPopup === 'function'
      ) {
        readerState.depTreeController.setDictPopup(settingsState.displaySettings.dictPopup);
      }
    });
  }
  // PDF.js text layer toggle
  if (settingsPanelsState.togglePdfjsTextLayer) {
    settingsPanelsState.togglePdfjsTextLayer.addEventListener('change', function () {
      documentPaginationState.usePdfjsTextLayer = settingsPanelsState.togglePdfjsTextLayer.checked;
      documentPaginationState.pdfjsTextLayerCache = {};
      documentPaginationState.pageLookupTextByIndex = {};
      documentPaginationState.lastLookupPageIndex = -1;
      documentPaginationState.pendingPdfLookupPageIndex = -1;
      readerState.latestSeq += 1;
      triggerUpdate();
    });
  }
  if (settingsPanelsState.fuzzyMaxEditDistanceInput) {
    settingsPanelsState.fuzzyMaxEditDistanceInput.addEventListener('change', function () {
      var val = parseInt(this.value, 10);
      if (isNaN(val)) {
        this.value = settingsState.displaySettings.fuzzyMaxEditDistance;
        return;
      }
      if (val < 0) val = 0;
      if (val > 6) val = 6;
      settingsState.displaySettings.fuzzyMaxEditDistance = val;
      this.value = val;
      saveDisplaySettings();
    });
  }
  // Comments toggle
  if (settingsPanelsState.toggleComments) {
    settingsPanelsState.toggleComments.addEventListener('change', function () {
      settingsState.displaySettings.comments = this.checked;
      saveDisplaySettings();
      if (!this.checked && readerState.notePopup) {
        readerState.notePopup.style.display = 'none';
      }
    });
  }
  // Subsegment popups toggle
  if (settingsPanelsState.toggleSubsegmentPopups) {
    settingsPanelsState.toggleSubsegmentPopups.addEventListener('change', function () {
      settingsState.displaySettings.subsegmentPopups = this.checked;
      saveDisplaySettings();
    });
  }
  // Panel toggle
  return true;
}
