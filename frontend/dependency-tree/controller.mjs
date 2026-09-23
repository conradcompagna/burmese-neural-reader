export function DepTreeView() {
  this.container = null;
  this.root = null;
  this.treeWrap = null;
  this.treeSvg = null;
  this.zoomLabel = null;
  this.settings = {
    chunkHighlight: true,
    dictPopup: true,
    linearClauseSplit: false,
    branchDepthMin: 1,
    clauseDepthDrop: 3
  };
  this.data = null;
  this.sentences = [];
  this.nodeBySeg = new Map();
  this.nodeEls = new Map();
  this.edgeEls = [];
  this.chunks = null; // Computed chunks for highlighting
  this.lastHoverSeg = null;
  this.treeWorld = null;
  this.treeView = null;
  this.treeDefaultView = null;
  this.panState = null;
  this.isPanning = false;
  this.isPointerDown = false;
  this._dragMoved = false;
  this.tooltip = null;
  this.highlightEnabled = true;
  this.debugMode = false;
  this.changedTokens = null;
  this.changeDetails = null;
  this.fills = null;
  this.sentenceBounds = [];
  this.currentSentenceIdx = 0;
  this.sentenceTotal = 0;
  this.sentenceSource = null;
  this.isLoadingSentence = false;
  this._sourceSelect = null;
  this._sentenceInput = null;
  this._sentenceInfo = null;
  this._sentencePrev = null;
  this._sentenceNext = null;
  this._pathToRootToggle = null;
  this.pathToRootMode = false;
  this._rollNonAclToggle = null;
  this.rollNonAclMode = false;
  this._discontinuityToggle = null;
  this._discontinuityThreshold = null;
  this.discontinuityMode = false;
  this.discontinuityThresholdValue = 5;
  this._branchDepthToggle = null;
  this._branchDepthThreshold = null;
  this.branchDepthMode = false;
  this.branchDepthThresholdValue = 5;
  this._ancestorDepthToggle = null;
  this._ancestorDepthInput = null;
  this.ancestorDepthMode = false;
  this.ancestorDepthValue = 5;
  this._contextWindowToggle = null;
  this._contextWindowInput = null;
  this.contextWindowMode = false;
  this.contextWindowValue = 10;
  this._bottomUpChunkToggle = null;
  this._bottomUpChunkThreshold = null;
  this.bottomUpChunkMode = false;
  this.bottomUpChunkThresholdValue = 5;
  this.bottomUpChunks = null; // Computed bottom-up chunks
}
