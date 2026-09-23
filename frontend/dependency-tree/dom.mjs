import { DepTreeView } from './controller.mjs';
import { rgba } from './data.mjs';
import { dataState } from './data.state.mjs';
export function initializeDom() {
  DepTreeView.prototype._ensureStyles = function () {
    if (document.getElementById('dep-tree-view-styles')) return;
    var style = document.createElement('style');
    style.id = 'dep-tree-view-styles';
    style.textContent =
      '' +
      '.dep-tree-view{margin-top:16px;}' +
      '.dep-tree-panel{border:1px solid #d1d5db;border-radius:12px;background:#fff;padding:12px;box-shadow:0 6px 18px rgba(15,23,42,0.06);}' +
      '.dep-tree-header{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-start;gap:10px;margin-bottom:10px;}' +
      '.dep-tree-header-controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px;width:100%;}' +
      '.dep-tree-header-spacer{flex:1;}' +
      '.dep-tree-header-right{display:flex;align-items:center;gap:10px;}' +
      '.dep-tree-source-toggle{display:flex;align-items:center;gap:6px;margin-right:auto;font-size:12px;color:#6b7280;}' +
      '.dep-tree-source-toggle select{padding:3px 6px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;background:#fff;}' +
      '.dep-tree-path-toggle{display:flex;align-items:center;gap:4px;margin-right:auto;font-size:12px;color:#6b7280;}' +
      ".dep-tree-path-toggle input[type='checkbox']{width:16px;height:16px;cursor:pointer;accent-color:#3b82f6;}" +
      '.dep-tree-sentence-nav{display:flex;align-items:center;gap:6px;margin-right:auto;}' +
      '.dep-tree-sentence-nav button{background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;}' +
      '.dep-tree-sentence-nav button:hover{background:#e5e7eb;}' +
      '.dep-tree-sentence-nav button:disabled{opacity:0.5;cursor:not-allowed;}' +
      '.dep-tree-sentence-nav input{width:72px;padding:3px 6px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;}' +
      '.dep-tree-sentence-info{min-width:64px;text-align:right;font-size:12px;color:#6b7280;}' +
      '.dep-tree-zoom{display:flex;align-items:center;gap:6px;}' +
      '.dep-tree-zoom button{background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;}' +
      '.dep-tree-zoom button:hover{background:#e5e7eb;}' +
      '.dep-tree-zoom .dep-tree-zoom-label{min-width:52px;text-align:right;font-size:12px;color:#6b7280;}' +
      '.dep-tree-canvas{border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;padding:8px;height:480px;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;-ms-user-select:none;}' +
      '.dep-tree-svg{width:100%;height:100%;display:block;user-select:none;-webkit-user-select:none;-ms-user-select:none;}' +
      '.dep-tree-svg text{user-select:none;-webkit-user-select:none;-ms-user-select:none;pointer-events:none;}' +
      '.dep-tree-tooltip{position:fixed;background:#111827;color:#f9fafb;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:8px 12px;font-size:12px;pointer-events:none;z-index:1200;max-width:92vw;box-shadow:0 8px 20px rgba(0,0,0,0.35);}' +
      '.dep-tree-tooltip .tt-id{color:' +
      rgba(dataState.PHRASE_RGB, 1) +
      ';font-weight:700;margin-right:6px;}' +
      '.dep-tree-tooltip .tt-tok{font-family:"Pyidaungsu","Noto Sans Myanmar","Myanmar Text",system-ui,sans-serif;font-size:14px;}' +
      '.dep-tree-tooltip .tt-info{color:rgba(255,255,255,0.65);margin-top:4px;line-height:1.6;}' +
      '.dep-tree-tooltip .dep-tree-dict-grid{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;}' +
      '.dep-tree-tooltip .dep-tree-dict-entry{flex:1 1 260px;min-width:240px;max-width:100%;border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:6px 8px;}';
    document.head.appendChild(style);
  };
  DepTreeView.prototype.init = function (opts) {
    if (!opts || !opts.container) return;
    this.container = opts.container;
    // Chunk highlight toggle (synced with main page)
    if (opts.chunkHighlight !== undefined) {
      this.settings.chunkHighlight = !!opts.chunkHighlight;
    }
    // Dictionary popup toggle (synced with main page)
    if (opts.dictPopup !== undefined) {
      this.settings.dictPopup = !!opts.dictPopup;
    }
    if (opts.linearClauseSplit !== undefined) {
      this.settings.linearClauseSplit = !!opts.linearClauseSplit;
    }
    if (opts.branchDepthMin !== undefined) {
      this.settings.branchDepthMin = opts.branchDepthMin;
    }
    if (opts.clauseDepthDrop !== undefined) {
      this.settings.clauseDepthDrop = opts.clauseDepthDrop;
    }
    // Debug mode options
    this.debugMode = opts.debugMode || false;
    this.changedTokens = opts.changedTokens || new Set();
    this.fills = opts.fills || {};
    this._ensureStyles();
    this._buildDom();
    this._bindEvents();
    if (opts.data) this.setData(opts.data);
  };
  DepTreeView.prototype._buildDom = function () {
    this.container.innerHTML = '';
    var panel = document.createElement('div');
    panel.className = 'dep-tree-panel';
    var header = document.createElement('div');
    header.className = 'dep-tree-header';
    var sourceWrap = document.createElement('div');
    sourceWrap.className = 'dep-tree-source-toggle';
    var sourceLabel = document.createElement('span');
    sourceLabel.textContent = 'Source';
    var sourceSelect = document.createElement('select');
    var optFile = document.createElement('option');
    optFile.value = 'file';
    optFile.textContent = 'File';
    var optLive = document.createElement('option');
    optLive.value = 'live';
    optLive.textContent = 'Live';
    sourceSelect.appendChild(optFile);
    sourceSelect.appendChild(optLive);
    sourceWrap.appendChild(sourceLabel);
    sourceWrap.appendChild(sourceSelect);
    var pathToggleWrap = document.createElement('div');
    pathToggleWrap.className = 'dep-tree-path-toggle';
    var pathLabel = document.createElement('span');
    pathLabel.textContent = 'Path to Root';
    var pathToggle = document.createElement('input');
    pathToggle.type = 'checkbox';
    pathToggle.id = 'dep-tree-path-toggle';
    pathToggleWrap.appendChild(pathLabel);
    pathToggleWrap.appendChild(pathToggle);
    var rollNonAclToggleWrap = document.createElement('div');
    rollNonAclToggleWrap.className = 'dep-tree-path-toggle';
    var rollNonAclLabel = document.createElement('span');
    rollNonAclLabel.textContent = 'Roll Non-ACL';
    var rollNonAclToggle = document.createElement('input');
    rollNonAclToggle.type = 'checkbox';
    rollNonAclToggle.id = 'dep-tree-roll-non-acl-toggle';
    rollNonAclToggleWrap.appendChild(rollNonAclLabel);
    rollNonAclToggleWrap.appendChild(rollNonAclToggle);
    var discontinuityToggleWrap = document.createElement('div');
    discontinuityToggleWrap.className = 'dep-tree-path-toggle';
    var discontinuityLabel = document.createElement('span');
    discontinuityLabel.textContent = 'Discontinuity Filter';
    var discontinuityToggle = document.createElement('input');
    discontinuityToggle.type = 'checkbox';
    discontinuityToggle.id = 'dep-tree-discontinuity-toggle';
    var discontinuityThreshold = document.createElement('input');
    discontinuityThreshold.type = 'number';
    discontinuityThreshold.id = 'dep-tree-discontinuity-threshold';
    discontinuityThreshold.min = '1';
    discontinuityThreshold.max = '20';
    discontinuityThreshold.value = '5';
    discontinuityThreshold.style.width = '50px';
    discontinuityThreshold.style.marginLeft = '4px';
    discontinuityToggleWrap.appendChild(discontinuityLabel);
    discontinuityToggleWrap.appendChild(discontinuityToggle);
    discontinuityToggleWrap.appendChild(discontinuityThreshold);
    var branchDepthToggleWrap = document.createElement('div');
    branchDepthToggleWrap.className = 'dep-tree-path-toggle';
    var branchDepthLabel = document.createElement('span');
    branchDepthLabel.textContent = 'Branch Depth';
    var branchDepthToggle = document.createElement('input');
    branchDepthToggle.type = 'checkbox';
    branchDepthToggle.id = 'dep-tree-branch-depth-toggle';
    var branchDepthThreshold = document.createElement('input');
    branchDepthThreshold.type = 'number';
    branchDepthThreshold.id = 'dep-tree-branch-depth-threshold';
    branchDepthThreshold.min = '1';
    branchDepthThreshold.max = '20';
    branchDepthThreshold.value = '5';
    branchDepthThreshold.style.width = '50px';
    branchDepthThreshold.style.marginLeft = '4px';
    branchDepthToggleWrap.appendChild(branchDepthLabel);
    branchDepthToggleWrap.appendChild(branchDepthToggle);
    branchDepthToggleWrap.appendChild(branchDepthThreshold);
    var ancestorDepthToggleWrap = document.createElement('div');
    ancestorDepthToggleWrap.className = 'dep-tree-path-toggle';
    var ancestorDepthLabel = document.createElement('span');
    ancestorDepthLabel.textContent = 'Ancestor Depth';
    var ancestorDepthToggle = document.createElement('input');
    ancestorDepthToggle.type = 'checkbox';
    ancestorDepthToggle.id = 'dep-tree-ancestor-depth-toggle';
    var ancestorDepthInput = document.createElement('input');
    ancestorDepthInput.type = 'number';
    ancestorDepthInput.id = 'dep-tree-ancestor-depth-input';
    ancestorDepthInput.min = '1';
    ancestorDepthInput.max = '20';
    ancestorDepthInput.value = '5';
    ancestorDepthInput.style.width = '50px';
    ancestorDepthInput.style.marginLeft = '4px';
    ancestorDepthToggleWrap.appendChild(ancestorDepthLabel);
    ancestorDepthToggleWrap.appendChild(ancestorDepthToggle);
    ancestorDepthToggleWrap.appendChild(ancestorDepthInput);
    var contextWindowToggleWrap = document.createElement('div');
    contextWindowToggleWrap.className = 'dep-tree-path-toggle';
    var contextWindowLabel = document.createElement('span');
    contextWindowLabel.textContent = 'Context Window';
    var contextWindowToggle = document.createElement('input');
    contextWindowToggle.type = 'checkbox';
    contextWindowToggle.id = 'dep-tree-context-window-toggle';
    var contextWindowInput = document.createElement('input');
    contextWindowInput.type = 'number';
    contextWindowInput.id = 'dep-tree-context-window-input';
    contextWindowInput.min = '1';
    contextWindowInput.max = '50';
    contextWindowInput.value = '10';
    contextWindowInput.style.width = '60px';
    contextWindowInput.style.marginLeft = '4px';
    contextWindowToggleWrap.appendChild(contextWindowLabel);
    contextWindowToggleWrap.appendChild(contextWindowToggle);
    contextWindowToggleWrap.appendChild(contextWindowInput);
    var bottomUpChunkToggleWrap = document.createElement('div');
    bottomUpChunkToggleWrap.className = 'dep-tree-path-toggle';
    var bottomUpChunkLabel = document.createElement('span');
    bottomUpChunkLabel.textContent = 'Bottom-Up Chunk';
    var bottomUpChunkToggle = document.createElement('input');
    bottomUpChunkToggle.type = 'checkbox';
    bottomUpChunkToggle.id = 'dep-tree-bottom-up-chunk-toggle';
    var bottomUpChunkThreshold = document.createElement('input');
    bottomUpChunkThreshold.type = 'number';
    bottomUpChunkThreshold.id = 'dep-tree-bottom-up-chunk-threshold';
    bottomUpChunkThreshold.min = '1';
    bottomUpChunkThreshold.max = '50';
    bottomUpChunkThreshold.value = '5';
    bottomUpChunkThreshold.style.width = '50px';
    bottomUpChunkThreshold.style.marginLeft = '4px';
    bottomUpChunkToggleWrap.appendChild(bottomUpChunkLabel);
    bottomUpChunkToggleWrap.appendChild(bottomUpChunkToggle);
    bottomUpChunkToggleWrap.appendChild(bottomUpChunkThreshold);
    var sentenceNav = document.createElement('div');
    sentenceNav.className = 'dep-tree-sentence-nav';
    var sentPrev = document.createElement('button');
    sentPrev.type = 'button';
    sentPrev.textContent = 'Prev';
    var sentNext = document.createElement('button');
    sentNext.type = 'button';
    sentNext.textContent = 'Next';
    var sentLabel = document.createElement('span');
    sentLabel.textContent = 'Sentence';
    var sentInput = document.createElement('input');
    sentInput.type = 'number';
    sentInput.min = '1';
    sentInput.step = '1';
    sentInput.value = '1';
    sentInput.disabled = true;
    var sentInfo = document.createElement('span');
    sentInfo.className = 'dep-tree-sentence-info';
    sentInfo.textContent = '0 / 0';
    sentPrev.disabled = true;
    sentNext.disabled = true;
    sentenceNav.appendChild(sentPrev);
    sentenceNav.appendChild(sentNext);
    sentenceNav.appendChild(sentLabel);
    sentenceNav.appendChild(sentInput);
    sentenceNav.appendChild(sentInfo);
    var zoom = document.createElement('div');
    zoom.className = 'dep-tree-zoom';
    var zoomOut = document.createElement('button');
    zoomOut.type = 'button';
    zoomOut.textContent = '-';
    var zoomIn = document.createElement('button');
    zoomIn.type = 'button';
    zoomIn.textContent = '+';
    var zoomReset = document.createElement('button');
    zoomReset.type = 'button';
    zoomReset.textContent = 'Reset';
    var zoomLabel = document.createElement('span');
    zoomLabel.className = 'dep-tree-zoom-label';
    zoomLabel.textContent = '1.00x';
    zoom.appendChild(zoomOut);
    zoom.appendChild(zoomIn);
    zoom.appendChild(zoomReset);
    zoom.appendChild(zoomLabel);

    // Row 1: Source + spacer + Sentence nav + Zoom
    var headerRow1 = document.createElement('div');
    headerRow1.className = 'dep-tree-header-controls';
    headerRow1.appendChild(sourceWrap);
    var spacer = document.createElement('div');
    spacer.className = 'dep-tree-header-spacer';
    headerRow1.appendChild(spacer);
    headerRow1.appendChild(sentenceNav);
    headerRow1.appendChild(zoom);

    // Row 2: Toggle controls (Path to Root, Roll Non-ACL, Discontinuity, Branch Depth)
    var headerRow2 = document.createElement('div');
    headerRow2.className = 'dep-tree-header-controls';
    headerRow2.appendChild(pathToggleWrap);
    headerRow2.appendChild(rollNonAclToggleWrap);
    headerRow2.appendChild(discontinuityToggleWrap);
    headerRow2.appendChild(branchDepthToggleWrap);
    headerRow2.appendChild(ancestorDepthToggleWrap);
    var headerRow3 = document.createElement('div');
    headerRow3.className = 'dep-tree-header-controls';
    headerRow3.appendChild(contextWindowToggleWrap);
    headerRow3.appendChild(bottomUpChunkToggleWrap);
    header.appendChild(headerRow1);
    header.appendChild(headerRow2);
    header.appendChild(headerRow3);
    panel.appendChild(header);
    var treeWrap = document.createElement('div');
    treeWrap.className = 'dep-tree-canvas';
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('dep-tree-svg');
    treeWrap.appendChild(svg);
    panel.appendChild(treeWrap);
    var tooltip = document.createElement('div');
    tooltip.className = 'dep-tree-tooltip';
    tooltip.style.display = 'none';
    this.container.appendChild(panel);
    this.container.appendChild(tooltip);
    this.root = panel;
    this.treeWrap = treeWrap;
    this.treeSvg = svg;
    this.zoomLabel = zoomLabel;
    this.tooltip = tooltip;
    this._zoomButtons = {
      zoomIn: zoomIn,
      zoomOut: zoomOut,
      zoomReset: zoomReset
    };
    this._sourceSelect = sourceSelect;
    this._pathToRootToggle = pathToggle;
    this._rollNonAclToggle = rollNonAclToggle;
    this._discontinuityToggle = discontinuityToggle;
    this._discontinuityThreshold = discontinuityThreshold;
    this._branchDepthToggle = branchDepthToggle;
    this._branchDepthThreshold = branchDepthThreshold;
    this._ancestorDepthToggle = ancestorDepthToggle;
    this._ancestorDepthInput = ancestorDepthInput;
    this._contextWindowToggle = contextWindowToggle;
    this._contextWindowInput = contextWindowInput;
    this._bottomUpChunkToggle = bottomUpChunkToggle;
    this._bottomUpChunkThreshold = bottomUpChunkThreshold;
    this._sentenceInput = sentInput;
    this._sentenceInfo = sentInfo;
    this._sentencePrev = sentPrev;
    this._sentenceNext = sentNext;
  };
  return true;
}
