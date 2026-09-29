import { settingsState } from './settings-state.state.mjs';
import { textState } from './text.state.mjs';
export function ensureLmWeightsInitialized() {
  if (
    !settingsState.displaySettings.lmWeights ||
    typeof settingsState.displaySettings.lmWeights !== 'object'
  ) {
    settingsState.displaySettings.lmWeights = {};
  }
  Object.keys(settingsState.LM_WEIGHT_DEFAULTS).forEach(function (key) {
    var val = settingsState.displaySettings.lmWeights[key];
    if (typeof val === 'string') {
      var parsed = parseFloat(val);
      if (isFinite(parsed)) {
        settingsState.displaySettings.lmWeights[key] = parsed;
        return;
      }
    }
    if (typeof val !== 'number' || !isFinite(val)) {
      settingsState.displaySettings.lmWeights[key] = settingsState.LM_WEIGHT_DEFAULTS[key];
    }
  });
}

// ===================== CHUNK HIGHLIGHTING =====================
// POS-based colors for chunk highlighting - matches SPACY_UPOS_COLORS
export function initializeSettingsState() {
  // ===================== END UD VISUALIZATION =====================

  // Display toggle state - load from localStorage or use defaults
  settingsState.GRAMMAR_TYPES = Object.keys(textState.GRAMMAR_TYPE_COLORS || {});
  settingsState.displaySettings = {
    grammarTypes: {},
    udOverlay: true,
    // On/off toggle for clause-based UD arrows
    chunkHighlight: true,
    // On/off toggle for phrase/clause span highlighting
    nerOverlay: true,
    // On/off toggle for NER label overlay
    islandDepTree: false,
    // DISABLED FOR DEPLOYMENT - island-based hover overlay
    connectedIslands: false,
    // DISABLED FOR DEPLOYMENT - Group and highlight connected islands
    connectedIslandsAclGate: false,
    // DISABLED FOR DEPLOYMENT - Merge connected islands unless head is VERB+acl
    contextWindow: false,
    // DISABLED FOR DEPLOYMENT - context window chunking algorithm
    contextWindowSize: 10,
    // Token count for context window size
    bottomUpChunk: true,
    // DEPLOYMENT: Always on when UD arrows/chunks enabled
    bottomUpChunkThreshold: 5,
    // Distance threshold for bottom-up chunking
    linearClauseSplit: false,
    // Optional linear clause splitting (left-to-right)
    branchDepthMin: 1,
    // Minimum head-chain depth to count as a branch
    clauseDepthDrop: 3,
    // Depth discontinuity threshold for postpass clause splits
    depTreeView: false,
    udPopup: false,
    pronunciation: true,
    grammarPopup: true,
    dictPopup: true,
    comments: false,
    // DISABLED FOR DEPLOYMENT
    subsegmentPopups: false,
    // DISABLED FOR DEPLOYMENT - subsegment popups
    fuzzyMaxEditDistance: 3,
    mergeGreedy: true,
    splitDictFill: false,
    posOverride: true,
    stanzaNer: true,
    collapseNerUd: true,
    dpResegment: true,
    lmWeights: {
      oovPenalty: 10.0,
      dictNoLmDiscount: 1.0,
      unigramWeight: 0.2,
      knownWordBaseCost: 1.0,
      unknownWordBaseCost: 5.0,
      bigramWeight: 0.1
    }
  };
  settingsState.LM_WEIGHT_DEFAULTS = {
    oovPenalty: 10.0,
    dictNoLmDiscount: 1.0,
    unigramWeight: 0.2,
    knownWordBaseCost: 1.0,
    unknownWordBaseCost: 5.0,
    bigramWeight: 0.1
  };
  settingsState.LM_WEIGHT_FIELDS = [
    {
      key: 'oovPenalty',
      label: 'OOV syllable penalty',
      param: 'lm_oov_penalty',
      step: '0.1'
    },
    {
      key: 'dictNoLmDiscount',
      label: 'Dict no-LM discount',
      param: 'lm_dict_no_lm_discount',
      step: '0.05'
    },
    {
      key: 'unigramWeight',
      label: 'Unigram weight',
      param: 'lm_unigram_weight',
      step: '0.05'
    },
    {
      key: 'knownWordBaseCost',
      label: 'Known word base cost',
      param: 'lm_known_base_cost',
      step: '0.1'
    },
    {
      key: 'unknownWordBaseCost',
      label: 'Unknown word base cost',
      param: 'lm_unknown_base_cost',
      step: '0.1'
    },
    {
      key: 'bigramWeight',
      label: 'Bigram weight',
      param: 'lm_bigram_weight',
      step: '0.05'
    }
  ];
  return true;
}
