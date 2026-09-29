import { readerState } from './reader-state.state.mjs';
export function initializeReaderState() {
  // DOM refs
  readerState.sourceText = document.getElementById('sourceText');
  readerState.sourcePager = document.getElementById('sourcePager');
  readerState.renderedText = document.getElementById('renderedText');
  readerState.depTreeViewEl = document.getElementById('depTreeView');
  readerState.statusText = document.getElementById('statusText');
  // statusCounts removed from UI - use dummy element to prevent errors
  readerState.statusCounts = document.getElementById('statusCounts') || document.createElement('span');
  readerState.dropZone = document.getElementById('dropZone');
  readerState.fileInput = document.getElementById('fileInput');
  readerState.fileButton = document.getElementById('fileButton');
  readerState.fileNamePill = document.getElementById('fileNamePill');
  readerState.fileNameText = document.getElementById('fileNameText');
  readerState.clearFileBtn = document.getElementById('clearFileBtn');
  readerState.rawTextPill = document.getElementById('rawTextPill');
  readerState.rawTextText = document.getElementById('rawTextText');
  readerState.clearRawTextBtn = document.getElementById('clearRawTextBtn');
  readerState.hoverPopupContainer = document.getElementById('hoverPopupContainer');
  readerState.grammarPopup = document.getElementById('grammarPopup');
  readerState.hoverPopup = document.getElementById('hoverPopup');
  readerState.udPopup = document.getElementById('udPopup');
  readerState.g2pPopup = document.getElementById('g2pPopup');
  readerState.notePopup = document.getElementById('notePopup');
  readerState.subsegmentPopupsContainer = document.getElementById('subsegmentPopupsContainer');
  readerState.sidePanel = document.getElementById('side-panel');
  readerState.panelToggle = document.getElementById('panel-toggle');
  readerState.topNav = document.getElementById('top-nav');
  readerState.mainContainer = document.getElementById('main-container');
  readerState.panelContent = document.getElementById('panel-content');
  readerState.dictSearch = document.getElementById('dict-search');
  readerState.searchBtn = document.getElementById('search-btn');
  readerState.createBtn = document.getElementById('create-btn');
  readerState.viewBtn = document.getElementById('view-btn');
  readerState.latestSeq = 0;
  readerState.segmentLookupAbort = null;
  readerState.latestData = null;
  readerState.latestSegments = null;
  readerState.latestRawWordSpans = []; // Raw PDF word spans for annotation
  readerState.latestRawPageData = null; // Page data for annotation
  readerState.latestOriginalText = '';
  readerState.latestFillsDict = null;
  readerState.panelOpen = false;
  readerState.depTreeController = null;
  readerState.depTreeUseConllu = false;
  readerState.depTreeConlluUrl = '/myudtree.sentence?i=';
  readerState.depTreeConlluMetaUrl = '/myudtree.meta';
  readerState.rawTextDocActive = false;
  readerState.embeddedFontRegistry = {};
  readerState.initialInputGuidance =
    'Paste Burmese text here or upload a PDF, DOCX, or text file. Segmented text will appear below with parts of speech, word relationships and named entities marked. Hover for dictionary definitions, grammar hints and transliteration. Click to send to side window for further information, headword breakdowns and fuzzy matching on broken tokens (marked in red).';
  readerState.initialInputGuidanceActive = false;
  readerState.initialExampleDemoActive = false;
  return true;
}
