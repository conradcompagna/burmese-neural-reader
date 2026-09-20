
(function(global) {
  "use strict";

  var PHRASE_RGB = [122, 162, 247];
  var PAN_SPEED = 1.5;

  // POS-based colors for chunk highlighting in tree view - matches SPACY_UPOS_COLORS
  var CHUNK_POS_COLORS = {
    'ADJ': { stroke: '#eab308', fill: 'rgba(253, 230, 138, 0.7)' },
    'ADP': { stroke: '#0ea5e9', fill: 'rgba(224, 242, 254, 0.7)' },
    'ADV': { stroke: '#ef4444', fill: 'rgba(254, 226, 226, 0.7)' },
    'AUX': { stroke: '#6366f1', fill: 'rgba(224, 231, 255, 0.7)' },
    'CCONJ': { stroke: '#06b6d4', fill: 'rgba(207, 250, 254, 0.7)' },
    'DET': { stroke: '#94a3b8', fill: 'rgba(241, 245, 249, 0.7)' },
    'INTJ': { stroke: '#f59e0b', fill: 'rgba(252, 211, 77, 0.7)' },
    'NOUN': { stroke: '#22c55e', fill: 'rgba(187, 247, 208, 0.7)' },
    'NUM': { stroke: '#d946ef', fill: 'rgba(245, 208, 254, 0.7)' },
    'PART': { stroke: '#a1a1aa', fill: 'rgba(244, 244, 245, 0.7)' },
    'PRON': { stroke: '#64748b', fill: 'rgba(226, 232, 240, 0.7)' },
    'PROPN': { stroke: '#818cf8', fill: 'rgba(199, 210, 254, 0.7)' },
    'PUNCT': { stroke: '#9ca3af', fill: 'rgba(229, 231, 235, 0.7)' },
    'SCONJ': { stroke: '#38bdf8', fill: 'rgba(186, 230, 253, 0.7)' },
    'SYM': { stroke: '#a855f7', fill: 'rgba(243, 232, 255, 0.7)' },
    'VERB': { stroke: '#f43f5e', fill: 'rgba(253, 164, 175, 0.7)' },
    'X': { stroke: '#6b7280', fill: 'rgba(209, 213, 219, 0.7)' },
    'ROOT': { stroke: '#d97706', fill: 'rgba(251, 191, 36, 0.7)' },
    'DEFAULT': { stroke: '#9ca3af', fill: 'rgba(229, 231, 235, 0.7)' }
  };

  function getChunkColor(pos) {
    return CHUNK_POS_COLORS[pos] || CHUNK_POS_COLORS['DEFAULT'];
  }

  function rgba(rgb, a) {
    return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + a + ")";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
    });
  }

  function splitSentences(segments) {
    var spans = [];
    if (!Array.isArray(segments) || !segments.length) return spans;
    var start = 0;
    var endToken = "\u104b";
    for (var i = 0; i < segments.length; i++) {
      if (segments[i] === endToken) {
        spans.push([start, i + 1]);
        start = i + 1;
      }
    }
    if (start < segments.length) spans.push([start, segments.length]);
    return spans;
  }

  function parseConlluText(text) {
    if (!text) return [];
    var lines = String(text).split(/\r?\n/);
    var sentences = [];
    var current = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) {
        if (current.length) {
          sentences.push(current);
          current = [];
        }
        continue;
      }
      if (line[0] === "#") continue;
      var fields = line.split("\t");
      if (fields.length < 8) continue;
      var id = fields[0];
      if (id.indexOf("-") !== -1 || id.indexOf(".") !== -1) continue;
      var idNum = parseInt(id, 10);
      if (!isFinite(idNum)) continue;
      var headNum = parseInt(fields[6], 10);
      if (!isFinite(headNum)) headNum = 0;
      current.push({
        id: idNum,
        form: fields[1] || "",
        upos: fields[3] || "",
        head: headNum,
        dep: fields[7] || ""
      });
    }
    if (current.length) sentences.push(current);
    return sentences;
  }

  function buildConlluData(sentences) {
    var segments = [];
    var tokens = [];
    var edges = [];
    var roots = [];
    var doc2seg = [];
    var seg2doc = [];
    var sentenceSpans = [];
    var docIndex = 0;
    var segIndex = 0;
    for (var s = 0; s < sentences.length; s++) {
      var sent = sentences[s];
      if (!sent || !sent.length) continue;
      var start = segIndex;
      var idToSeg = {};
      for (var i = 0; i < sent.length; i++) {
        var tok = sent[i];
        idToSeg[tok.id] = segIndex;
        segments.push(tok.form);
        segIndex += 1;
      }
      for (var j = 0; j < sent.length; j++) {
        var tok2 = sent[j];
        var seg = idToSeg[tok2.id];
        var headSeg = idToSeg[tok2.head];
        if (tok2.head === 0 || headSeg === undefined || tok2.head === tok2.id) {
          headSeg = seg;
          roots.push(seg);
        }
        tokens.push({
          i: seg,
          doc_i: docIndex,
          text: tok2.form,
          upos: tok2.upos,
          tag: "",
          dep: tok2.dep,
          head: headSeg
        });
        if (headSeg !== seg) {
          edges.push({ from: headSeg, to: seg, dep: tok2.dep, upos: tok2.upos });
        }
        doc2seg.push(seg);
        seg2doc[seg] = docIndex;
        docIndex += 1;
      }
      sentenceSpans.push([start, segIndex]);
    }
    return {
      segments: segments,
      udOverlay: {
        ok: true,
        tokens: tokens,
        edges: edges,
        roots: roots,
        ents: [],
        doc2seg: doc2seg,
        seg2doc: seg2doc,
        sentences: sentenceSpans
      },
      originalText: segments.join("")
    };
  }

  var gapLogic = global && global.ChunkGapLogic ? global.ChunkGapLogic : null;
  var computeDownDepth = gapLogic && typeof gapLogic.computeDownDepth === "function"
    ? gapLogic.computeDownDepth
    : function(children) { return new Array(children.length).fill(0); };

  function applyBaseStyle(rect, isChanged) {
    if (isChanged) {
      rect.setAttribute("fill", "rgba(239,68,68,0.20)");
      rect.setAttribute("stroke", "rgba(239,68,68,0.85)");
      rect.setAttribute("stroke-width", "1.8");
      return;
    }
    rect.setAttribute("fill", "rgba(17,24,39,0.04)");
    rect.setAttribute("stroke", "rgba(17,24,39,0.12)");
    rect.setAttribute("stroke-width", "1.4");
  }

  function computeDepths(children, roots) {
    var n = children.length;
    var depth = new Array(n).fill(0);
    if (!roots.length) roots = [0];
    var queue = roots.slice();
    var visited = new Array(n).fill(false);
    for (var i = 0; i < roots.length; i++) visited[roots[i]] = true;
    for (var qi = 0; qi < queue.length; qi++) {
      var v = queue[qi];
      for (var ci = 0; ci < children[v].length; ci++) {
        var ch = children[v][ci];
        if (!visited[ch]) {
          visited[ch] = true;
          depth[ch] = depth[v] + 1;
          queue.push(ch);
        }
      }
    }
    return depth;
  }

  // Render sense lines for tooltip - simplified version that skips headword column
  // since headword is shown separately in the entry header
  function renderSenseLinesTooltip(senses) {
    if (!senses || !senses.length) return "";
    // 3-column grid: roman, pos, sense (no headword column since it's in header)
    var html = "<div style=\"display:grid;grid-template-columns:auto auto 1fr;gap:0 10px;align-items:start;font-size:12px;line-height:1.7;\">";
    for (var li = 0; li < senses.length; li++) {
      var line = senses[li];
      if (!line || !line.trim()) continue;
      var tabCount = 0;
      for (var ci = 0; ci < line.length; ci++) { if (line[ci] === "\t") tabCount++; else break; }
      var content = line.substring(tabCount);
      if (!content || !content.trim()) continue;
      if (tabCount === 0) {
        var parts = content.split("\t");
        if (parts.length >= 4) {
          var roman = parts[1] || "", pos = parts[2] || "", sense = parts.slice(3).join("\t");
          // roman: italic, adapted color for dark bg
          html += "<div style=\"font-style:italic;color:#a5b4fc;\">" + escapeHtml(roman) + "</div>";
          // pos: smaller, adapted color for dark bg
          html += "<div style=\"color:#94a3b8;font-size:11px;\">[" + escapeHtml(pos) + "]</div>";
          // sense: main text color for dark bg
          html += "<div style=\"color:#e5e7eb;\">" + escapeHtml(sense) + "</div>";
        }
      } else if (tabCount === 2) {
        var parts2 = content.split("\t");
        if (parts2.length >= 2) {
          html += "<div></div><div style=\"color:#94a3b8;font-size:11px;\">[" + escapeHtml(parts2[0]) + "]</div>";
          html += "<div style=\"color:#e5e7eb;\">" + escapeHtml(parts2.slice(1).join("\t")) + "</div>";
        }
      } else {
        var sense3 = content.trim();
        if (sense3) {
          html += "<div></div><div></div><div style=\"color:#e5e7eb;\">" + escapeHtml(sense3) + "</div>";
        }
      }
    }
    html += "</div>";
    return html;
  }

  function DepTreeView() {
    this.container = null;
    this.root = null;
    this.treeWrap = null;
    this.treeSvg = null;
    this.zoomLabel = null;
    this.settings = { chunkHighlight: true, dictPopup: true, linearClauseSplit: false, branchDepthMin: 1, clauseDepthDrop: 3 };
    this.data = null;
    this.sentences = [];
    this.nodeBySeg = new Map();
    this.nodeEls = new Map();
    this.edgeEls = [];
    this.chunks = null;  // Computed chunks for highlighting
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
    this.bottomUpChunks = null;  // Computed bottom-up chunks
  }

  DepTreeView.prototype._ensureStyles = function() {
    if (document.getElementById("dep-tree-view-styles")) return;
    var style = document.createElement("style");
    style.id = "dep-tree-view-styles";
    style.textContent = ""
      + ".dep-tree-view{margin-top:16px;}"
      + ".dep-tree-panel{border:1px solid #d1d5db;border-radius:12px;background:#fff;padding:12px;box-shadow:0 6px 18px rgba(15,23,42,0.06);}"
      + ".dep-tree-header{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-start;gap:10px;margin-bottom:10px;}"
      + ".dep-tree-header-controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px;width:100%;}"
      + ".dep-tree-header-spacer{flex:1;}"
      + ".dep-tree-header-right{display:flex;align-items:center;gap:10px;}"
      + ".dep-tree-source-toggle{display:flex;align-items:center;gap:6px;margin-right:auto;font-size:12px;color:#6b7280;}"
      + ".dep-tree-source-toggle select{padding:3px 6px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;background:#fff;}"
      + ".dep-tree-path-toggle{display:flex;align-items:center;gap:4px;margin-right:auto;font-size:12px;color:#6b7280;}"
      + ".dep-tree-path-toggle input[type='checkbox']{width:16px;height:16px;cursor:pointer;accent-color:#3b82f6;}"
      + ".dep-tree-sentence-nav{display:flex;align-items:center;gap:6px;margin-right:auto;}"
      + ".dep-tree-sentence-nav button{background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;}"
      + ".dep-tree-sentence-nav button:hover{background:#e5e7eb;}"
      + ".dep-tree-sentence-nav button:disabled{opacity:0.5;cursor:not-allowed;}"
      + ".dep-tree-sentence-nav input{width:72px;padding:3px 6px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;}"
      + ".dep-tree-sentence-info{min-width:64px;text-align:right;font-size:12px;color:#6b7280;}"
      + ".dep-tree-zoom{display:flex;align-items:center;gap:6px;}"
      + ".dep-tree-zoom button{background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;}"
      + ".dep-tree-zoom button:hover{background:#e5e7eb;}"
      + ".dep-tree-zoom .dep-tree-zoom-label{min-width:52px;text-align:right;font-size:12px;color:#6b7280;}"
      + ".dep-tree-canvas{border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;padding:8px;height:480px;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;-ms-user-select:none;}"
      + ".dep-tree-svg{width:100%;height:100%;display:block;user-select:none;-webkit-user-select:none;-ms-user-select:none;}"
      + ".dep-tree-svg text{user-select:none;-webkit-user-select:none;-ms-user-select:none;pointer-events:none;}"
      + ".dep-tree-tooltip{position:fixed;background:#111827;color:#f9fafb;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:8px 12px;font-size:12px;pointer-events:none;z-index:1200;max-width:92vw;box-shadow:0 8px 20px rgba(0,0,0,0.35);}"
      + ".dep-tree-tooltip .tt-id{color:" + rgba(PHRASE_RGB, 1) + ";font-weight:700;margin-right:6px;}"
      + ".dep-tree-tooltip .tt-tok{font-family:\"Pyidaungsu\",\"Noto Sans Myanmar\",\"Myanmar Text\",system-ui,sans-serif;font-size:14px;}"
      + ".dep-tree-tooltip .tt-info{color:rgba(255,255,255,0.65);margin-top:4px;line-height:1.6;}"
      + ".dep-tree-tooltip .dep-tree-dict-grid{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;}"
      + ".dep-tree-tooltip .dep-tree-dict-entry{flex:1 1 260px;min-width:240px;max-width:100%;border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:6px 8px;}";
    document.head.appendChild(style);
  };

  DepTreeView.prototype.init = function(opts) {
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

  DepTreeView.prototype._buildDom = function() {
    this.container.innerHTML = "";
    var panel = document.createElement("div");
    panel.className = "dep-tree-panel";

    var header = document.createElement("div");
    header.className = "dep-tree-header";
    var sourceWrap = document.createElement("div");
    sourceWrap.className = "dep-tree-source-toggle";
    var sourceLabel = document.createElement("span");
    sourceLabel.textContent = "Source";
    var sourceSelect = document.createElement("select");
    var optFile = document.createElement("option");
    optFile.value = "file";
    optFile.textContent = "File";
    var optLive = document.createElement("option");
    optLive.value = "live";
    optLive.textContent = "Live";
    sourceSelect.appendChild(optFile);
    sourceSelect.appendChild(optLive);
    sourceWrap.appendChild(sourceLabel);
    sourceWrap.appendChild(sourceSelect);

    var pathToggleWrap = document.createElement("div");
    pathToggleWrap.className = "dep-tree-path-toggle";
    var pathLabel = document.createElement("span");
    pathLabel.textContent = "Path to Root";
    var pathToggle = document.createElement("input");
    pathToggle.type = "checkbox";
    pathToggle.id = "dep-tree-path-toggle";
    pathToggleWrap.appendChild(pathLabel);
    pathToggleWrap.appendChild(pathToggle);

    var rollNonAclToggleWrap = document.createElement("div");
    rollNonAclToggleWrap.className = "dep-tree-path-toggle";
    var rollNonAclLabel = document.createElement("span");
    rollNonAclLabel.textContent = "Roll Non-ACL";
    var rollNonAclToggle = document.createElement("input");
    rollNonAclToggle.type = "checkbox";
    rollNonAclToggle.id = "dep-tree-roll-non-acl-toggle";
    rollNonAclToggleWrap.appendChild(rollNonAclLabel);
    rollNonAclToggleWrap.appendChild(rollNonAclToggle);

    var discontinuityToggleWrap = document.createElement("div");
    discontinuityToggleWrap.className = "dep-tree-path-toggle";
    var discontinuityLabel = document.createElement("span");
    discontinuityLabel.textContent = "Discontinuity Filter";
    var discontinuityToggle = document.createElement("input");
    discontinuityToggle.type = "checkbox";
    discontinuityToggle.id = "dep-tree-discontinuity-toggle";
    var discontinuityThreshold = document.createElement("input");
    discontinuityThreshold.type = "number";
    discontinuityThreshold.id = "dep-tree-discontinuity-threshold";
    discontinuityThreshold.min = "1";
    discontinuityThreshold.max = "20";
    discontinuityThreshold.value = "5";
    discontinuityThreshold.style.width = "50px";
    discontinuityThreshold.style.marginLeft = "4px";
    discontinuityToggleWrap.appendChild(discontinuityLabel);
    discontinuityToggleWrap.appendChild(discontinuityToggle);
    discontinuityToggleWrap.appendChild(discontinuityThreshold);

    var branchDepthToggleWrap = document.createElement("div");
    branchDepthToggleWrap.className = "dep-tree-path-toggle";
    var branchDepthLabel = document.createElement("span");
    branchDepthLabel.textContent = "Branch Depth";
    var branchDepthToggle = document.createElement("input");
    branchDepthToggle.type = "checkbox";
    branchDepthToggle.id = "dep-tree-branch-depth-toggle";
    var branchDepthThreshold = document.createElement("input");
    branchDepthThreshold.type = "number";
    branchDepthThreshold.id = "dep-tree-branch-depth-threshold";
    branchDepthThreshold.min = "1";
    branchDepthThreshold.max = "20";
    branchDepthThreshold.value = "5";
    branchDepthThreshold.style.width = "50px";
    branchDepthThreshold.style.marginLeft = "4px";
    branchDepthToggleWrap.appendChild(branchDepthLabel);
    branchDepthToggleWrap.appendChild(branchDepthToggle);
    branchDepthToggleWrap.appendChild(branchDepthThreshold);

    var ancestorDepthToggleWrap = document.createElement("div");
    ancestorDepthToggleWrap.className = "dep-tree-path-toggle";
    var ancestorDepthLabel = document.createElement("span");
    ancestorDepthLabel.textContent = "Ancestor Depth";
    var ancestorDepthToggle = document.createElement("input");
    ancestorDepthToggle.type = "checkbox";
    ancestorDepthToggle.id = "dep-tree-ancestor-depth-toggle";
    var ancestorDepthInput = document.createElement("input");
    ancestorDepthInput.type = "number";
    ancestorDepthInput.id = "dep-tree-ancestor-depth-input";
    ancestorDepthInput.min = "1";
    ancestorDepthInput.max = "20";
    ancestorDepthInput.value = "5";
    ancestorDepthInput.style.width = "50px";
    ancestorDepthInput.style.marginLeft = "4px";
    ancestorDepthToggleWrap.appendChild(ancestorDepthLabel);
    ancestorDepthToggleWrap.appendChild(ancestorDepthToggle);
    ancestorDepthToggleWrap.appendChild(ancestorDepthInput);

    var contextWindowToggleWrap = document.createElement("div");
    contextWindowToggleWrap.className = "dep-tree-path-toggle";
    var contextWindowLabel = document.createElement("span");
    contextWindowLabel.textContent = "Context Window";
    var contextWindowToggle = document.createElement("input");
    contextWindowToggle.type = "checkbox";
    contextWindowToggle.id = "dep-tree-context-window-toggle";
    var contextWindowInput = document.createElement("input");
    contextWindowInput.type = "number";
    contextWindowInput.id = "dep-tree-context-window-input";
    contextWindowInput.min = "1";
    contextWindowInput.max = "50";
    contextWindowInput.value = "10";
    contextWindowInput.style.width = "60px";
    contextWindowInput.style.marginLeft = "4px";
    contextWindowToggleWrap.appendChild(contextWindowLabel);
    contextWindowToggleWrap.appendChild(contextWindowToggle);
    contextWindowToggleWrap.appendChild(contextWindowInput);

    var bottomUpChunkToggleWrap = document.createElement("div");
    bottomUpChunkToggleWrap.className = "dep-tree-path-toggle";
    var bottomUpChunkLabel = document.createElement("span");
    bottomUpChunkLabel.textContent = "Bottom-Up Chunk";
    var bottomUpChunkToggle = document.createElement("input");
    bottomUpChunkToggle.type = "checkbox";
    bottomUpChunkToggle.id = "dep-tree-bottom-up-chunk-toggle";
    var bottomUpChunkThreshold = document.createElement("input");
    bottomUpChunkThreshold.type = "number";
    bottomUpChunkThreshold.id = "dep-tree-bottom-up-chunk-threshold";
    bottomUpChunkThreshold.min = "1";
    bottomUpChunkThreshold.max = "50";
    bottomUpChunkThreshold.value = "5";
    bottomUpChunkThreshold.style.width = "50px";
    bottomUpChunkThreshold.style.marginLeft = "4px";
    bottomUpChunkToggleWrap.appendChild(bottomUpChunkLabel);
    bottomUpChunkToggleWrap.appendChild(bottomUpChunkToggle);
    bottomUpChunkToggleWrap.appendChild(bottomUpChunkThreshold);

    var sentenceNav = document.createElement("div");
    sentenceNav.className = "dep-tree-sentence-nav";
    var sentPrev = document.createElement("button");
    sentPrev.type = "button";
    sentPrev.textContent = "Prev";
    var sentNext = document.createElement("button");
    sentNext.type = "button";
    sentNext.textContent = "Next";
    var sentLabel = document.createElement("span");
    sentLabel.textContent = "Sentence";
    var sentInput = document.createElement("input");
    sentInput.type = "number";
    sentInput.min = "1";
    sentInput.step = "1";
    sentInput.value = "1";
    sentInput.disabled = true;
    var sentInfo = document.createElement("span");
    sentInfo.className = "dep-tree-sentence-info";
    sentInfo.textContent = "0 / 0";
    sentPrev.disabled = true;
    sentNext.disabled = true;
    sentenceNav.appendChild(sentPrev);
    sentenceNav.appendChild(sentNext);
    sentenceNav.appendChild(sentLabel);
    sentenceNav.appendChild(sentInput);
    sentenceNav.appendChild(sentInfo);
    var zoom = document.createElement("div");
    zoom.className = "dep-tree-zoom";
    var zoomOut = document.createElement("button");
    zoomOut.type = "button";
    zoomOut.textContent = "-";
    var zoomIn = document.createElement("button");
    zoomIn.type = "button";
    zoomIn.textContent = "+";
    var zoomReset = document.createElement("button");
    zoomReset.type = "button";
    zoomReset.textContent = "Reset";
    var zoomLabel = document.createElement("span");
    zoomLabel.className = "dep-tree-zoom-label";
    zoomLabel.textContent = "1.00x";
    zoom.appendChild(zoomOut);
    zoom.appendChild(zoomIn);
    zoom.appendChild(zoomReset);
    zoom.appendChild(zoomLabel);

    // Row 1: Source + spacer + Sentence nav + Zoom
    var headerRow1 = document.createElement("div");
    headerRow1.className = "dep-tree-header-controls";
    headerRow1.appendChild(sourceWrap);
    var spacer = document.createElement("div");
    spacer.className = "dep-tree-header-spacer";
    headerRow1.appendChild(spacer);
    headerRow1.appendChild(sentenceNav);
    headerRow1.appendChild(zoom);

    // Row 2: Toggle controls (Path to Root, Roll Non-ACL, Discontinuity, Branch Depth)
    var headerRow2 = document.createElement("div");
    headerRow2.className = "dep-tree-header-controls";
    headerRow2.appendChild(pathToggleWrap);
    headerRow2.appendChild(rollNonAclToggleWrap);
    headerRow2.appendChild(discontinuityToggleWrap);
    headerRow2.appendChild(branchDepthToggleWrap);
    headerRow2.appendChild(ancestorDepthToggleWrap);

    var headerRow3 = document.createElement("div");
    headerRow3.className = "dep-tree-header-controls";
    headerRow3.appendChild(contextWindowToggleWrap);
    headerRow3.appendChild(bottomUpChunkToggleWrap);

    header.appendChild(headerRow1);
    header.appendChild(headerRow2);
    header.appendChild(headerRow3);
    panel.appendChild(header);

    var treeWrap = document.createElement("div");
    treeWrap.className = "dep-tree-canvas";
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("dep-tree-svg");
    treeWrap.appendChild(svg);
    panel.appendChild(treeWrap);

    var tooltip = document.createElement("div");
    tooltip.className = "dep-tree-tooltip";
    tooltip.style.display = "none";

    this.container.appendChild(panel);
    this.container.appendChild(tooltip);

    this.root = panel;
    this.treeWrap = treeWrap;
    this.treeSvg = svg;
    this.zoomLabel = zoomLabel;
    this.tooltip = tooltip;

    this._zoomButtons = { zoomIn: zoomIn, zoomOut: zoomOut, zoomReset: zoomReset };
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

  DepTreeView.prototype._bindEvents = function() {
    var self = this;
    var wrap = this.treeWrap;
    if (!wrap) return;
    // Check if event target is within a token node
    function isTokenClick(e) {
      var el = e.target;
      while (el && el !== wrap) {
        // SVG tagName is uppercase
        if ((el.tagName === "g" || el.tagName === "G") && el.hasAttribute("data-seg")) return true;
        el = el.parentNode;
      }
      return false;
    }
    wrap.addEventListener("mousedown", function(e) {
      if (!isTokenClick(e)) e.preventDefault();
    });
    wrap.addEventListener("selectstart", function(e) { e.preventDefault(); });
    wrap.addEventListener("pointerdown", function(e) {
      if (!self.treeWorld) return;
      // Allow clicks on tokens to go through
      if (isTokenClick(e)) {
        self.isPointerDown = false;
        self.isPanning = false;
        self._dragMoved = false;
        return;
      }
      e.preventDefault();
      self.panState = { sx: e.clientX, sy: e.clientY, v: { x: self.treeView.x, y: self.treeView.y, w: self.treeView.w, h: self.treeView.h } };
      self.isPanning = false;
      self.isPointerDown = true;
      self._dragMoved = false;
      self.clearHighlights();
      self._hideTooltip();
      try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
    });
    wrap.addEventListener("pointermove", function(e) {
      if (!self.panState || !self.treeWorld) return;
      var rect = self.treeSvg.getBoundingClientRect();
      var dx = e.clientX - self.panState.sx;
      var dy = e.clientY - self.panState.sy;
      if (!self.isPanning) {
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        self.isPanning = true;
        self._dragMoved = true;
        self.clearHighlights();
        self._hideTooltip();
      }
      // Natural panning that scales with zoom level
      // When zoomed in (small viewport), moves less world space
      // When zoomed out (large viewport), moves more world space
      self._setTreeView({
        x: self.panState.v.x - (dx * PAN_SPEED) / rect.width * self.panState.v.w,
        y: self.panState.v.y - (dy * PAN_SPEED) / rect.height * self.panState.v.h,
        w: self.panState.v.w,
        h: self.panState.v.h
      });
    });
    wrap.addEventListener("pointerup", function(e) {
      self.panState = null;
      self.isPanning = false;
      self.isPointerDown = false;
      try { wrap.releasePointerCapture(e.pointerId); } catch (err) {}
    });
    wrap.addEventListener("pointercancel", function() { self.panState = null; self.isPanning = false; self.isPointerDown = false; self._dragMoved = false; });
    wrap.addEventListener("wheel", function(e) {
      if (!self.treeWorld) return;
      e.preventDefault();
      var factor = (e.deltaY < 0) ? 1.15 : (1 / 1.15);
      self._zoomAt(factor, e.clientX, e.clientY);
    }, { passive: false });
    wrap.addEventListener("dblclick", function(e) {
      if (!self.treeWorld) return;
      // Don't zoom on double-click of tokens
      if (isTokenClick(e)) return;
      e.preventDefault();
      self._zoomAt(1.35, e.clientX, e.clientY);
    });

    if (this._zoomButtons) {
      this._zoomButtons.zoomIn.addEventListener("click", function() {
        var r = self.treeSvg.getBoundingClientRect();
        self._zoomAt(1.15, r.left + r.width / 2, r.top + r.height / 2);
      });
      this._zoomButtons.zoomOut.addEventListener("click", function() {
        var r = self.treeSvg.getBoundingClientRect();
        self._zoomAt(1 / 1.15, r.left + r.width / 2, r.top + r.height / 2);
      });
      this._zoomButtons.zoomReset.addEventListener("click", function() {
        if (self.treeDefaultView) {
          self._setTreeView({ x: self.treeDefaultView.x, y: self.treeDefaultView.y, w: self.treeDefaultView.w, h: self.treeDefaultView.h });
        } else if (self.treeWorld) {
          self._setTreeView({ x: 0, y: 0, w: self.treeWorld.W, h: self.treeWorld.H });
        }
      });
    }
    if (this._sourceSelect) {
      this._sourceSelect.addEventListener("change", function() {
        var useConllu = this.value === "file";
        if (typeof window !== "undefined" && typeof window.setDepTreeSourceMode === "function") {
          window.setDepTreeSourceMode(useConllu);
        }
      });
    }
    if (this._sentenceInput) {
      var goToSentence = function() {
        self.jumpToSentence(self._sentenceInput.value);
      };
      this._sentenceInput.addEventListener("keydown", function(e) {
        if (e.key === "Enter") goToSentence();
      });
      this._sentenceInput.addEventListener("change", function() {
        goToSentence();
      });
    }
    if (this._sentencePrev) {
      this._sentencePrev.addEventListener("click", function() {
        self._jumpToSentenceIdx(self.currentSentenceIdx - 1);
      });
    }
    if (this._sentenceNext) {
      this._sentenceNext.addEventListener("click", function() {
        self._jumpToSentenceIdx(self.currentSentenceIdx + 1);
      });
    }
    if (this._pathToRootToggle) {
      this._pathToRootToggle.addEventListener("change", function() {
        self.pathToRootMode = this.checked;
        if (self.lastHoverSeg !== null && self.highlightEnabled) {
          if (self.contextWindowMode) {
            self._applyContextWindowHighlight(self.lastHoverSeg);
          } else if (self.pathToRootMode) {
            self._applyPathToRootHighlight(self.lastHoverSeg);
          } else {
            self._applyHighlight(self.lastHoverSeg);
          }
        }
      });
    }
    if (this._rollNonAclToggle) {
      this._rollNonAclToggle.addEventListener("change", function() {
        self.rollNonAclMode = this.checked;
        if (self.lastHoverSeg !== null && self.highlightEnabled && self.pathToRootMode) {
          self._applyPathToRootHighlight(self.lastHoverSeg);
        }
      });
    }
    if (this._discontinuityToggle) {
      this._discontinuityToggle.addEventListener("change", function() {
        self.discontinuityMode = this.checked;
        if (self.lastHoverSeg !== null && self.highlightEnabled && self.pathToRootMode) {
          self._applyPathToRootHighlight(self.lastHoverSeg);
        }
      });
    }
    if (this._discontinuityThreshold) {
      this._discontinuityThreshold.addEventListener("change", function() {
        self.discontinuityThresholdValue = parseInt(this.value, 10) || 5;
        if (self.lastHoverSeg !== null && self.highlightEnabled && self.pathToRootMode && self.discontinuityMode) {
          self._applyPathToRootHighlight(self.lastHoverSeg);
        }
      });
    }
    if (this._branchDepthToggle) {
      this._branchDepthToggle.addEventListener("change", function() {
        self.branchDepthMode = this.checked;
        if (self.lastHoverSeg !== null && self.highlightEnabled && self.pathToRootMode) {
          self._applyPathToRootHighlight(self.lastHoverSeg);
        }
      });
    }
    if (this._branchDepthThreshold) {
      this._branchDepthThreshold.addEventListener("change", function() {
        self.branchDepthThresholdValue = parseInt(this.value, 10) || 5;
        if (self.lastHoverSeg !== null && self.highlightEnabled && self.pathToRootMode && self.branchDepthMode) {
          self._applyPathToRootHighlight(self.lastHoverSeg);
        }
      });
    }
    if (this._ancestorDepthToggle) {
      this._ancestorDepthToggle.addEventListener("change", function() {
        self.ancestorDepthMode = this.checked;
        if (self.lastHoverSeg !== null && self.highlightEnabled) {
          self._applyHighlight(self.lastHoverSeg);
        }
      });
    }
    if (this._ancestorDepthInput) {
      this._ancestorDepthInput.addEventListener("change", function() {
        self.ancestorDepthValue = parseInt(this.value, 10) || 1;
        if (self.lastHoverSeg !== null && self.highlightEnabled && self.ancestorDepthMode) {
          self._applyHighlight(self.lastHoverSeg);
        }
      });
    }
    if (this._contextWindowToggle) {
      this._contextWindowToggle.addEventListener("change", function() {
        self.contextWindowMode = this.checked;
        if (self.lastHoverSeg !== null && self.highlightEnabled) {
          if (self.contextWindowMode) {
            self._applyContextWindowHighlight(self.lastHoverSeg);
          } else if (self.pathToRootMode) {
            self._applyPathToRootHighlight(self.lastHoverSeg);
          } else {
            self._applyHighlight(self.lastHoverSeg);
          }
        }
      });
    }
    if (this._contextWindowInput) {
      this._contextWindowInput.addEventListener("change", function() {
        self.contextWindowValue = parseInt(this.value, 10) || 1;
        if (self.lastHoverSeg !== null && self.highlightEnabled && self.contextWindowMode) {
          self._applyContextWindowHighlight(self.lastHoverSeg);
        }
      });
    }
    if (this._bottomUpChunkToggle) {
      this._bottomUpChunkToggle.addEventListener("change", function() {
        self.bottomUpChunkMode = this.checked;
        self._recomputeBottomUpChunks();
        if (self.lastHoverSeg !== null && self.highlightEnabled) {
          self._applyHighlight(self.lastHoverSeg);
        }
      });
    }
    if (this._bottomUpChunkThreshold) {
      this._bottomUpChunkThreshold.addEventListener("change", function() {
        self.bottomUpChunkThresholdValue = parseInt(this.value, 10) || 5;
        if (self.bottomUpChunkMode) {
          self._recomputeBottomUpChunks();
          if (self.lastHoverSeg !== null && self.highlightEnabled) {
            self._applyHighlight(self.lastHoverSeg);
          }
        }
      });
    }
  };

  DepTreeView.prototype.setData = function(data) {
    this.data = data || null;
    this.lastHoverSeg = null;
    this.sentences = [];
    this.nodeBySeg = new Map();
    this.nodeEls = new Map();
    this.edgeEls = [];
    this.layout = null;
    this.treeWorld = null;
    this.treeView = null;
    this.chunks = null;
    this.bottomUpChunks = null;
    this.sentenceBounds = [];
    if (!data || !data.segments || !data.udOverlay || !data.udOverlay.ok) {
      this._renderEmpty("No dependency data.");
      this._syncSentenceNav();
      return;
    }
    if (!Array.isArray(data.udOverlay.tokens) || !data.udOverlay.tokens.length) {
      this._renderEmpty("No dependency data.");
      this._syncSentenceNav();
      return;
    }
    this._buildState(data.segments, data.udOverlay, data.originalText);
    this._renderTree();
    // Compute chunks after building state
    this._recomputeChunks();
    this._recomputeBottomUpChunks();
    this._syncSentenceNav();
  };

  DepTreeView.prototype.loadConlluFromText = function(text) {
    var sentences = parseConlluText(text);
    if (!sentences.length) {
      this._renderEmpty("No sentences in CoNLL-U.");
      this._syncSentenceNav();
      return;
    }
    var data = buildConlluData(sentences);
    this.setData(data);
    if (data.udOverlay && data.udOverlay.sentences && data.udOverlay.sentences.length) {
      if (this.sentenceSource) {
        this._focusRenderedSentence();
      } else {
        this._jumpToSentenceIdxInternal(0);
      }
    }
  };

  DepTreeView.prototype.loadConlluFromUrl = function(url) {
    var self = this;
    if (!url) return;
    fetch(url)
      .then(function(resp) {
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        return resp.text();
      })
      .then(function(txt) {
        self.loadConlluFromText(txt);
      })
      .catch(function(err) {
        console.error("Failed to load CoNLL-U:", err);
        self._renderEmpty("Failed to load CoNLL-U.");
        self._syncSentenceNav();
      });
  };

  DepTreeView.prototype.loadConlluSentenceSource = function(metaUrl, sentenceUrl) {
    var self = this;
    if (!metaUrl || !sentenceUrl) return;
    this.sentenceSource = {
      metaUrl: metaUrl,
      sentenceUrl: sentenceUrl,
      load: function(idx) {
        var url = sentenceUrl + (idx + 1);
        return fetch(url).then(function(resp) {
          if (!resp.ok) throw new Error("HTTP " + resp.status);
          return resp.text();
        });
      }
    };
    this.sentenceTotal = 0;
    this._syncSentenceNav();
    fetch(metaUrl)
      .then(function(resp) {
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        return resp.json();
      })
      .then(function(meta) {
        if (meta && meta.ok && typeof meta.total === "number") {
          self.sentenceTotal = meta.total;
        }
        self._syncSentenceNav();
        if (self.sentenceTotal > 0) {
          self._loadSentenceByIndex(0);
        }
      })
      .catch(function(err) {
        console.error("Failed to load CoNLL-U meta:", err);
        self._renderEmpty("Failed to load CoNLL-U.");
        self._syncSentenceNav();
      });
  };

  DepTreeView.prototype.clearSentenceSource = function() {
    this.sentenceSource = null;
    this.sentenceTotal = 0;
    this.isLoadingSentence = false;
    this._syncSentenceNav();
  };

  DepTreeView.prototype.setSourceToggleState = function(useConllu) {
    if (!this._sourceSelect) return;
    this._sourceSelect.value = useConllu ? "file" : "live";
  };

  DepTreeView.prototype._renderEmpty = function(msg) {
    if (this.treeSvg) this.treeSvg.innerHTML = "";
  };

  DepTreeView.prototype._findWhitespaceBoundaries = function(segments, originalText) {
    if (typeof window !== "undefined" && typeof window.computeWhitespaceBoundaries === "function") {
      return window.computeWhitespaceBoundaries(segments, originalText);
    }
    return new Set();
  };

  DepTreeView.prototype._buildState = function(segments, udOverlay, originalText) {
    // Detect whitespace boundaries (Myanmar text "islands")
    var whitespaceBoundaries = this._findWhitespaceBoundaries(segments, originalText);
    this.whitespaceBoundaries = whitespaceBoundaries;
    var tokenMap = new Map();
    for (var i = 0; i < udOverlay.tokens.length; i++) {
      var t = udOverlay.tokens[i];
      tokenMap.set(t.i, t);
    }
    var spans = (udOverlay && Array.isArray(udOverlay.sentences) && udOverlay.sentences.length)
      ? udOverlay.sentences
      : splitSentences(segments);
    var sentenceIndex = 0;
    for (var s = 0; s < spans.length; s++) {
      var span = spans[s];
      var rows = [];
      for (var si = span[0]; si < span[1]; si++) {
        if (!tokenMap.has(si)) continue;
        var tok = tokenMap.get(si);
        rows.push({
          segIndex: si,
          token: (segments[si] || tok.text || ""),
          pos: tok.upos || "",
          dep: tok.dep || "",
          headSeg: tok.head,
          docIndex: tok.doc_i,
          headIndex: -1,
          rowIdx: rows.length,
          sentenceIdx: sentenceIndex
        });
      }
      if (!rows.length) continue;
      var indexBySeg = new Map();
      for (var r = 0; r < rows.length; r++) indexBySeg.set(rows[r].segIndex, r);
      for (var r2 = 0; r2 < rows.length; r2++) {
        var headSeg = rows[r2].headSeg;
        var hi = indexBySeg.has(headSeg) ? indexBySeg.get(headSeg) : -1;
        rows[r2].headIndex = (hi === r2 || hi === -1) ? -1 : hi;
      }
      var children = new Array(rows.length);
      for (var c = 0; c < rows.length; c++) children[c] = [];
      for (var r3 = 0; r3 < rows.length; r3++) {
        if (rows[r3].headIndex !== -1) children[rows[r3].headIndex].push(r3);
      }
      var downDepth = computeDownDepth(children);
      var roots = [];
      for (var r4 = 0; r4 < rows.length; r4++) {
        if (rows[r4].headIndex === -1) roots.push(r4);
      }
      var depth = computeDepths(children, roots);
      var maxDepth = 0;
      for (var d = 0; d < depth.length; d++) if (depth[d] > maxDepth) maxDepth = depth[d];
      this.sentences.push({
        rows: rows,
        indexBySeg: indexBySeg,
        children: children,
        downDepth: downDepth,
        depth: depth,
        maxDepth: maxDepth
      });
      for (var r5 = 0; r5 < rows.length; r5++) {
        this.nodeBySeg.set(rows[r5].segIndex, rows[r5]);
      }
      sentenceIndex += 1;
    }
  };

  DepTreeView.prototype._computeDefaultView = function() {
    if (!this.treeWorld) return null;
    var worldW = this.treeWorld.W;
    var maxSentH = this.treeWorld.maxSentH || this.treeWorld.H;

    // Fit to the largest sentence (not all sentences stacked)
    // Add 20% padding for comfortable viewing
    var paddingFactor = 0.20;
    var viewW = worldW * (1 + paddingFactor);
    var viewH = maxSentH * (1 + paddingFactor);

    // Center horizontally, start from top vertically
    var x = -worldW * paddingFactor / 2;
    var y = -maxSentH * paddingFactor / 2;

    return { x: x, y: y, w: viewW, h: viewH };
  };

  DepTreeView.prototype._renderTree = function() {
    if (!this.treeSvg) return;
    var padX = 36;
    var padY = 28;
    var cellW = 72;
    var rowH = 62;
    var nodeW = 62;
    var nodeH = 28;
    var gapY = 40;
    var totalH = 0;
    var maxW = 0;
    var offsets = [];
    this.sentenceBounds = [];
    for (var s = 0; s < this.sentences.length; s++) {
      var sent = this.sentences[s];
      var n = sent.rows.length;
      if (!n) {
        offsets.push(totalH);
        this.sentenceBounds.push(null);
        continue;
      }
      var sentW = padX * 2 + (n - 1) * cellW + nodeW;
      var sentH = padY * 2 + sent.maxDepth * rowH + nodeH + 16;
      if (sentW > maxW) maxW = sentW;
      var sentOffset = totalH;
      offsets.push(sentOffset);
      this.sentenceBounds.push({ x: 0, y: sentOffset, w: sentW, h: sentH });
      totalH += sentH + gapY;
    }
    if (!maxW || !totalH) {
      this.treeSvg.innerHTML = "";
      return;
    }
    var worldW = maxW;
    var worldH = Math.max(100, totalH - gapY);
    var maxSentH = 0;
    for (var sh = 0; sh < this.sentences.length; sh++) {
      var sent = this.sentences[sh];
      if (!sent.rows.length) continue;
      var sentH = padY * 2 + sent.maxDepth * rowH + nodeH + 16;
      if (sentH > maxSentH) maxSentH = sentH;
    }
    this.treeWorld = { W: worldW, H: worldH, maxSentH: maxSentH };
    this.layout = { nodeW: nodeW, nodeH: nodeH };

    var defaultView = this._computeDefaultView() || { x: 0, y: 0, w: worldW, h: worldH };
    this.treeDefaultView = defaultView;
    this.treeView = { x: defaultView.x, y: defaultView.y, w: defaultView.w, h: defaultView.h };

    this.treeSvg.innerHTML = "";
    this._setTreeView(this.treeView);

    this.nodeEls = new Map();
    this.edgeEls = [];

    for (var s2 = 0; s2 < this.sentences.length; s2++) {
      var sent2 = this.sentences[s2];
      var rows = sent2.rows;
      var n2 = rows.length;
      if (!n2) continue;
      var offsetY = offsets[s2];
      var X = new Array(n2);
      var Y = new Array(n2);
      for (var i2 = 0; i2 < n2; i2++) {
        X[i2] = padX + i2 * cellW;
        Y[i2] = offsetY + padY + sent2.depth[i2] * rowH;
      }

      for (var child = 0; child < n2; child++) {
        var head = rows[child].headIndex;
        if (head === -1) continue;
        var x1 = X[head] + nodeW / 2;
        var y1 = Y[head] + nodeH;
        var x2 = X[child] + nodeW / 2;
        var y2 = Y[child];
        var midY = (y1 + y2) / 2;
        var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M " + x1 + " " + y1 + " C " + x1 + " " + midY + ", " + x2 + " " + midY + ", " + x2 + " " + y2);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "rgba(17,24,39,0.12)");
        path.setAttribute("stroke-width", "1.5");
        path.setAttribute("vector-effect", "non-scaling-stroke");
        path.classList.add("dep-tree-edge");
        path.dataset.head = String(rows[head].segIndex);
        path.dataset.child = String(rows[child].segIndex);
        this.treeSvg.appendChild(path);
        this.edgeEls.push({ path: path, headSeg: rows[head].segIndex, childSeg: rows[child].segIndex });
      }

      // Draw faint vertical guide lines at whitespace boundaries
      if (this.whitespaceBoundaries) {
        var sentH = padY * 2 + sent2.maxDepth * rowH + nodeH + 16;
        for (var b = 0; b < n2; b++) {
          if (this.whitespaceBoundaries.has(rows[b].segIndex)) {
            var boundaryX = X[b] + nodeW;
            var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", boundaryX);
            line.setAttribute("y1", offsetY + padY - 8);
            line.setAttribute("x2", boundaryX);
            line.setAttribute("y2", offsetY + sentH - padY + 8);
            line.setAttribute("stroke", "rgba(100,150,200,0.15)");
            line.setAttribute("stroke-width", "1");
            line.setAttribute("vector-effect", "non-scaling-stroke");
            line.classList.add("boundary-guide");
            this.treeSvg.appendChild(line);
          }
        }
      }

      for (var i3 = 0; i3 < n2; i3++) {
        var r = rows[i3];
        var g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("data-seg", String(r.segIndex));
        g.classList.add("dep-tree-node");
        g.style.cursor = "pointer";

        var hit = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        hit.setAttribute("x", X[i3]);
        hit.setAttribute("y", Y[i3]);
        hit.setAttribute("width", nodeW);
        hit.setAttribute("height", nodeH);
        hit.setAttribute("rx", "7");
        hit.setAttribute("fill", "transparent");
        hit.setAttribute("stroke", "transparent");
        hit.setAttribute("stroke-width", "12");
        hit.setAttribute("vector-effect", "non-scaling-stroke");
        hit.setAttribute("pointer-events", "stroke");
        g.appendChild(hit);

        var rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", X[i3]);
        rect.setAttribute("y", Y[i3]);
        rect.setAttribute("width", nodeW);
        rect.setAttribute("height", nodeH);
        rect.setAttribute("rx", "7");
        var isChanged = this.debugMode && this.changedTokens && this.changedTokens.has(r.segIndex);
        applyBaseStyle(rect, isChanged);
        rect.setAttribute("vector-effect", "non-scaling-stroke");
        rect.setAttribute("pointer-events", "all");
        g.appendChild(rect);

        var text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", X[i3] + 5);
        text.setAttribute("y", Y[i3] + 18);
        text.setAttribute("fill", "#111111");
        text.setAttribute("font-size", "10");
        text.setAttribute("font-family", "\"Pyidaungsu\",\"Noto Sans Myanmar\",\"Myanmar Text\",system-ui,sans-serif");
        var label = r.segIndex + " " + r.token;
        text.textContent = label.length > 10 ? label.slice(0, 9) + "." : label;
        g.appendChild(text);

        var self = this;
        g.addEventListener("mouseenter", function(e) {
          if (self.isPanning || self.isPointerDown) return;
          var seg = parseInt(this.getAttribute("data-seg"), 10);
          self._handleHover(seg, e.clientX, e.clientY);
        });
        g.addEventListener("mousemove", function(e) {
          if (self.isPanning || self.isPointerDown) return;
          self._moveTooltip(e.clientX, e.clientY);
        });
        g.addEventListener("mouseleave", function() {
          self.clearHighlights();
          self._hideTooltip();
        });
        g.addEventListener("click", function() {
          if (self.isPanning || self.isPointerDown || self._dragMoved) {
            self._dragMoved = false;
            return;
          }
          var seg = parseInt(this.getAttribute("data-seg"), 10);
          var clicked = self.nodeBySeg.get(seg);
          if (!clicked) return;
          var tokenText = clicked.token || "";
          if (!tokenText) return;
          // Open the side panel
          if (typeof window !== "undefined" && typeof window.togglePanel === "function") {
            window.togglePanel(true);
          }
          var used = false;
          // Try to use results_by_seg with dict_fill from our fills
          if (typeof window !== "undefined" && typeof window.displayDictEntry === "function") {
            var res = null;
            if (window.latestData && window.latestData.results_by_seg) {
              res = window.latestData.results_by_seg[seg];
            }
            // Ensure dict_fill is included from our fills if available
            if (res || self.fills && self.fills[seg]) {
              res = res || { head: tokenText };
              if (self.fills && self.fills[seg]) {
                res.dict_fill = self.fills[seg];
              }
              window.displayDictEntry(res, tokenText, window.latestData);
              used = true;
            }
          }
          if (!used && typeof window !== "undefined" && typeof window.lookupAndDisplay === "function") {
            window.lookupAndDisplay(tokenText);
          }
        });

        this.treeSvg.appendChild(g);
        this.nodeEls.set(r.segIndex, { group: g, rect: rect, text: text });
      }
    }
  };

  DepTreeView.prototype._syncSentenceNav = function() {
    if (!this._sentenceInput || !this._sentenceInfo) return;
    var total = (this.sentenceTotal && this.sentenceTotal > 0)
      ? this.sentenceTotal
      : (this.sentenceBounds ? this.sentenceBounds.length : 0);
    if (!total) {
      this._sentenceInput.disabled = true;
      this._sentenceInput.value = "";
      this._sentenceInput.max = "1";
      this._sentenceInfo.textContent = "0 / 0";
      if (this._sentencePrev) this._sentencePrev.disabled = true;
      if (this._sentenceNext) this._sentenceNext.disabled = true;
      return;
    }
    if (this.currentSentenceIdx < 0 || this.currentSentenceIdx >= total) {
      this.currentSentenceIdx = 0;
    }
    this._sentenceInput.disabled = false;
    this._sentenceInput.max = String(total);
    this._sentenceInput.value = String(this.currentSentenceIdx + 1);
    this._sentenceInfo.textContent = (this.currentSentenceIdx + 1) + " / " + total;
    if (this._sentencePrev) this._sentencePrev.disabled = this.currentSentenceIdx <= 0;
    if (this._sentenceNext) this._sentenceNext.disabled = this.currentSentenceIdx >= total - 1;
  };

  DepTreeView.prototype._jumpToSentenceIdxInternal = function(idx) {
    if (!this.treeWorld || !this.sentenceBounds || !this.sentenceBounds.length) return;
    var total = this.sentenceBounds.length;
    var target = Math.max(0, Math.min(total - 1, idx));
    var bounds = this.sentenceBounds[target];
    if (!bounds) return;
    var pad = 0.18;
    var w = bounds.w * (1 + pad);
    var h = bounds.h * (1 + pad);
    var x = bounds.x - bounds.w * pad / 2;
    var y = bounds.y - bounds.h * pad / 2;
    this.currentSentenceIdx = target;
    this.clearHighlights();
    this._hideTooltip();
    this._setTreeView({ x: x, y: y, w: w, h: h });
    this._syncSentenceNav();
  };

  DepTreeView.prototype._focusRenderedSentence = function() {
    if (!this.treeWorld || !this.sentenceBounds || !this.sentenceBounds.length) return;
    var bounds = this.sentenceBounds[0];
    if (!bounds) return;
    var pad = 0.18;
    var w = bounds.w * (1 + pad);
    var h = bounds.h * (1 + pad);
    var x = bounds.x - bounds.w * pad / 2;
    var y = bounds.y - bounds.h * pad / 2;
    this.clearHighlights();
    this._hideTooltip();
    this._setTreeView({ x: x, y: y, w: w, h: h });
  };

  DepTreeView.prototype._loadSentenceByIndex = function(idx) {
    if (!this.sentenceSource || typeof this.sentenceSource.load !== "function") return;
    var total = (this.sentenceTotal && this.sentenceTotal > 0) ? this.sentenceTotal : this.sentenceBounds.length;
    var target = Math.max(0, Math.min(total - 1, idx));
    if (this.isLoadingSentence && target === this.currentSentenceIdx) return;
    this.isLoadingSentence = true;
    this.currentSentenceIdx = target;
    this._syncSentenceNav();
    var self = this;
    this.sentenceSource.load(target)
      .then(function(text) {
        self.isLoadingSentence = false;
        if (!text) {
          self._renderEmpty("Empty sentence.");
          self._syncSentenceNav();
          return;
        }
        self.loadConlluFromText(text);
        self.currentSentenceIdx = target;
        self._syncSentenceNav();
      })
      .catch(function(err) {
        self.isLoadingSentence = false;
        console.error("Failed to load sentence:", err);
        self._renderEmpty("Failed to load sentence.");
        self._syncSentenceNav();
      });
  };

  DepTreeView.prototype._jumpToSentenceIdx = function(idx) {
    if (this.sentenceSource && typeof this.sentenceSource.load === "function") {
      this._loadSentenceByIndex(idx);
      return;
    }
    this._jumpToSentenceIdxInternal(idx);
  };

  DepTreeView.prototype.jumpToSentence = function(sentenceNumber) {
    var idx = parseInt(sentenceNumber, 10);
    if (!isFinite(idx)) return;
    this._jumpToSentenceIdx(idx - 1);
  };

  DepTreeView.prototype._setTreeView = function(v) {
    if (!this.treeWorld) return;
    var W = this.treeWorld.W;
    var H = this.treeWorld.H;
    var maxW = Math.max(W * 3, this.treeDefaultView ? this.treeDefaultView.w : 0);
    var maxH = Math.max(H * 3, this.treeDefaultView ? this.treeDefaultView.h : 0);
    v.w = Math.max(100, Math.min(maxW, v.w));
    v.h = Math.max(100, Math.min(maxH, v.h));
    if (v.w >= W) {
      v.x = (W - v.w) / 2;
    } else {
      v.x = Math.max(-W, Math.min(W * 2 - v.w, v.x));
    }
    if (v.h >= H) {
      v.y = (H - v.h) / 2;
    } else {
      v.y = Math.max(-H, Math.min(H * 2 - v.h, v.y));
    }
    this.treeView = v;
    this.treeSvg.setAttribute("viewBox", v.x + " " + v.y + " " + v.w + " " + v.h);
    if (this.zoomLabel) {
      var baseW = this.treeDefaultView ? this.treeDefaultView.w : this.treeWorld.W;
      this.zoomLabel.textContent = (baseW / v.w).toFixed(2) + "x";
    }
  };

  DepTreeView.prototype.refitView = function() {
    if (!this.layout || !this.treeWorld) return;
    var defView = this._computeDefaultView();
    if (!defView) return;
    this.treeDefaultView = defView;
    this._setTreeView({ x: defView.x, y: defView.y, w: defView.w, h: defView.h });
  };

  DepTreeView.prototype._zoomAt = function(factor, cx, cy) {
    if (!this.treeWorld || !this.treeView) return;
    var rect = this.treeSvg.getBoundingClientRect();
    var mx = (cx - rect.left) / rect.width;
    var my = (cy - rect.top) / rect.height;
    var v = this.treeView;
    var px = v.x + mx * v.w;
    var py = v.y + my * v.h;
    var nw = v.w / factor;
    var nh = v.h / factor;
    this._setTreeView({ x: px - mx * nw, y: py - my * nh, w: nw, h: nh });
  };

  DepTreeView.prototype._handleHover = function(segIdx, clientX, clientY) {
    if (!this.nodeBySeg.has(segIdx)) return;
    if (this.isPointerDown || this.isPanning) return;
    if (this.lastHoverSeg !== segIdx) {
      this.lastHoverSeg = segIdx;
      if (this.highlightEnabled) {
        if (this.contextWindowMode) {
          this._applyContextWindowHighlight(segIdx);
        } else if (this.pathToRootMode) {
          this._applyPathToRootHighlight(segIdx);
        } else {
          this._applyHighlight(segIdx);
        }
      } else {
        this.clearHighlights();
      }
    }
    if (typeof clientX === "number" && typeof clientY === "number") {
      this._showTooltip(segIdx, clientX, clientY);
    }
  };

  DepTreeView.prototype._showTooltip = function(segIdx, x, y) {
    if (!this.tooltip) return;
    var node = this.nodeBySeg.get(segIdx);
    if (!node) return;
    var sent = this.sentences[node.sentenceIdx];
    var depth = sent && sent.depth ? sent.depth[node.rowIdx] : 0;
    var sentIdx = node.sentenceIdx + 1;
    // POS and dep in bright colors at top, always next to each other
    var html = "<div style=\"display:flex;align-items:center;gap:10px;margin-bottom:6px;\">";
    html += "<span style=\"font-size:14px;font-weight:bold;color:#f472b6;\">" + escapeHtml(node.pos || "") + "</span>";
    html += "<span style=\"font-size:13px;font-weight:bold;color:#38bdf8;\">" + escapeHtml(node.dep || "") + "</span>";
    html += "</div>";
    html += "<div class=\"tt-info\" style=\"font-size:11px;color:#9ca3af;\">head " + escapeHtml(node.headSeg) + " | depth " + depth
      + " | sent " + sentIdx + " | seg " + escapeHtml(segIdx) + "</div>";

    var changeDetails = null;
    if (this.changeDetails) {
      if (typeof this.changeDetails.get === "function") {
        changeDetails = this.changeDetails.get(segIdx);
      } else {
        changeDetails = this.changeDetails[segIdx];
      }
    }
    if (changeDetails && Array.isArray(changeDetails) && changeDetails.length) {
      html += "<div class=\"tt-info\" style=\"margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 6px; color:#f87171;\">";
      for (var ci = 0; ci < changeDetails.length; ci++) {
        var fix = changeDetails[ci] || {};
        var oldHead = fix.old_head;
        var newHead = fix.new_head;
        var oldHeadText = fix.old_head_text || "";
        var newHeadText = fix.new_head_text || "";
        var reason = fix.reason || "";
        var iter = fix.iteration;
        if (ci > 0) {
          html += "<div style=\"margin:6px 0;border-top:1px solid rgba(255,255,255,0.12);\"></div>";
        }
        html += "<div><strong>changed:</strong> " + escapeHtml(String(oldHead)) + " (" + escapeHtml(oldHeadText) + ") \u2192 "
          + escapeHtml(String(newHead)) + " (" + escapeHtml(newHeadText) + ")</div>";
        if (reason) {
          html += "<div style=\"color:#fca5a5;\">reason: " + escapeHtml(String(reason)) + "</div>";
        }
        if (iter !== undefined && iter !== null && iter !== "") {
          html += "<div style=\"color:#fecaca;\">iteration: " + escapeHtml(String(iter)) + "</div>";
        }
      }
      html += "</div>";
    }

    // Show dictionary entries if enabled and available
    // Respects the dictPopup setting (synced with main page toggle)
    if (this.settings.dictPopup && this.fills && this.fills[segIdx]) {
      var entries = this.fills[segIdx];
      if (Array.isArray(entries) && entries.length > 0) {
        html += "<div class=\"tt-info\" style=\"margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 6px;\">";
        html += "<div class=\"dep-tree-dict-grid\">";

        // Helper function to detect unknown entries - EXACTLY matches newserver.py
        function isUnknownEntry(obj) {
          if (!obj) return true;
          var p = (obj.pos || "").toLowerCase();
          var ss = obj.senses || [];
          return p.indexOf("unknown") >= 0 || (ss.length === 1 && typeof ss[0] === "string" && ss[0].toLowerCase().indexOf("no dictionary entry") >= 0);
        }

        for (var i = 0; i < entries.length; i++) {
          var part = entries[i] || {};
          var pHead = part.head || "";
          if (!pHead) continue;
          var pSenses = Array.isArray(part.senses) ? part.senses : [];
          var pUnk = isUnknownEntry(part);

          html += "<div class=\"dep-tree-dict-entry\">";

          if (pUnk) {
            // Unknown part: red text + romanization (adapted for dark tooltip bg)
            html += "<div style=\"margin-top:8px;color:#f87171;font-weight:bold;\">" + escapeHtml(pHead) + "</div>";
            if (part.g2p && Array.isArray(part.g2p.syllables) && part.g2p.syllables.length) {
              html += "<div style=\"font-size:0.85em;color:#94a3b8;\">";
              for (var gi = 0; gi < part.g2p.syllables.length; gi++) {
                var gsyll = part.g2p.syllables[gi];
                if (gsyll && gsyll.roman) html += escapeHtml(gsyll.roman) + " ";
              }
              html += "</div>";
            }
          } else {
            // Known part: heading + senses (headword shown once in header only)
            html += "<div style=\"margin-top:8px;font-weight:bold;color:#4ade80;\">" + escapeHtml(pHead) + "</div>";
            if (pSenses.length) {
              html += renderSenseLinesTooltip(pSenses);
            }
          }
          html += "</div>";
        }
        html += "</div></div>";
      }
    }
    this.tooltip.innerHTML = html;
    this.tooltip.style.display = "block";
    this._positionTooltip(x, y);
  };

  DepTreeView.prototype._positionTooltip = function(x, y) {
    if (!this.tooltip) return;
    var pad = 12;
    // Allow dynamic expansion, no scrollbars
    this.tooltip.style.maxWidth = (window.innerWidth - pad * 2) + "px";
    this.tooltip.style.maxHeight = "none";
    this.tooltip.style.overflowY = "visible";
    // Position initially to measure
    this.tooltip.style.left = "0px";
    this.tooltip.style.top = "0px";
    var rect = this.tooltip.getBoundingClientRect();
    var left = x + 12;
    var top = y + 12;
    // Prevent running off right edge - flip to left of cursor
    if (left + rect.width + pad > window.innerWidth) {
      left = x - rect.width - 12;
    }
    // Prevent running off bottom edge - move up
    if (top + rect.height + pad > window.innerHeight) {
      top = window.innerHeight - rect.height - pad;
    }
    // Prevent running off left/top edges
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    this.tooltip.style.left = left + "px";
    this.tooltip.style.top = top + "px";
  };

  DepTreeView.prototype._moveTooltip = function(x, y) {
    if (!this.tooltip || this.tooltip.style.display === "none") return;
    this._positionTooltip(x, y);
  };

  DepTreeView.prototype._hideTooltip = function() {
    if (!this.tooltip) return;
    this.tooltip.style.display = "none";
  };

  // Set chunk highlight toggle (synced with main page)
  DepTreeView.prototype.setChunkHighlight = function(enabled) {
    this.settings.chunkHighlight = !!enabled;
    // Recompute chunks
    this._recomputeChunks();
    // Re-apply highlight if we have a hovered token
    if (this.lastHoverSeg !== null && this.highlightEnabled) {
      this._applyHighlight(this.lastHoverSeg);
    }
  };

  // Set dictionary popup toggle (synced with main page)
  DepTreeView.prototype.setDictPopup = function(enabled) {
    this.settings.dictPopup = !!enabled;
  };

  DepTreeView.prototype.setLinearClauseSplit = function(enabled) {
    this.settings.linearClauseSplit = !!enabled;
    this._recomputeChunks();
    if (this.lastHoverSeg !== null && this.highlightEnabled) {
      this._applyHighlight(this.lastHoverSeg);
    }
  };
  DepTreeView.prototype.setBranchDepthMin = function(depth) {
    this.settings.branchDepthMin = depth;
    this._recomputeChunks();
    if (this.lastHoverSeg !== null && this.highlightEnabled) {
      this._applyHighlight(this.lastHoverSeg);
    }
  };
  DepTreeView.prototype.setClauseDepthDrop = function(depthDrop) {
    this.settings.clauseDepthDrop = depthDrop;
    this._recomputeChunks();
    if (this.lastHoverSeg !== null && this.highlightEnabled) {
      this._applyHighlight(this.lastHoverSeg);
    }
  };
  // Compute chunks based on depth-based subtree logic
  // Mirrors the main view's computeChunks logic with canonical chunk assignment
  DepTreeView.prototype._recomputeChunks = function() {
    if (!this.data || !this.data.udOverlay || !this.data.udOverlay.ok) {
      this.chunks = null;
      return;
    }

    if (!this.settings.chunkHighlight) {
      this.chunks = null;
      return;
    }

    // Use max depth 100 to cover entire tree when enabled
    var maxDepth = 100;

    var tokens = this.data.udOverlay.tokens;
    if (!tokens || !tokens.length) {
      this.chunks = null;
      return;
    }

    // Build token map and children adjacency
    var tokenMap = {};
    var children = {};
    var parentOf = {};
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      tokenMap[t.i] = t;
      children[t.i] = [];
    }
    for (var j = 0; j < tokens.length; j++) {
      var tok = tokens[j];
      var headIdx = tok.head;
      if (headIdx !== undefined && headIdx !== tok.i && children[headIdx]) {
        children[headIdx].push(tok.i);
        parentOf[tok.i] = headIdx;
      }
    }

    // Find roots and compute depths via BFS
    var roots = [];
    for (var k = 0; k < tokens.length; k++) {
      var t2 = tokens[k];
      if (t2.head === undefined || t2.head === t2.i || !tokenMap[t2.head]) {
        roots.push(t2.i);
      }
    }

    var tokenDepths = {};
    var queue = [];
    for (var r = 0; r < roots.length; r++) {
      tokenDepths[roots[r]] = 0;
      queue.push(roots[r]);
    }
    while (queue.length) {
      var cur = queue.shift();
      var ch = children[cur] || [];
      for (var c = 0; c < ch.length; c++) {
        if (tokenDepths[ch[c]] === undefined) {
          tokenDepths[ch[c]] = tokenDepths[cur] + 1;
          queue.push(ch[c]);
        }
      }
    }

    // Optional clause splitting: linear left-to-right (strict ancestor chain).
    var clauseGroup = null;
    if (this.settings.linearClauseSplit) {
      clauseGroup = {};

      // Get all heads (tokens with children)
      var heads = [];
      for (var hi0 = 0; hi0 < tokens.length; hi0++) {
        var seg0 = tokens[hi0].i;
        if ((children[seg0] || []).length > 0) {
          heads.push(seg0);
        }
      }

      // Sort by position (segment index)
      heads.sort(function(a, b) { return a - b; });

      // Get ancestor chain for a token (walking up the actual dependency tree)
      function getAncestorChain(seg) {
        var chain = [];
        var cur = seg;
        var visited = {};
        while (cur !== undefined && !visited[cur]) {
          visited[cur] = true;
          chain.push(cur);
          cur = parentOf[cur];
        }
        return chain; // [seg, parent, grandparent, ..., root]
      }

      function branchDepth(seg, maxDepth) {
        var depth = 0;
        var stack = [{ seg: seg, d: 0 }];
        var seen = {};
        while (stack.length) {
          var item = stack.pop();
          var cur = item.seg;
          var d = item.d;
          if (seen[cur]) continue;
          seen[cur] = true;
          if (d > depth) depth = d;
          if (d >= maxDepth) continue;
          var kids = children[cur] || [];
          for (var ki = 0; ki < kids.length; ki++) {
            var kid = kids[ki];
            if ((children[kid] || []).length > 0) {
              stack.push({ seg: kid, d: d + 1 });
            }
          }
        }
        return depth;
      }

      var minDepth = Math.max(1, Math.min(5, this.settings.branchDepthMin || 1));
      var branchHeads = heads.filter(function(seg) { return branchDepth(seg, minDepth) >= minDepth; });

      if (heads.length === 0 || branchHeads.length === 0) {
        // No heads - all tokens in one group
        for (var ti0 = 0; ti0 < tokens.length; ti0++) {
          clauseGroup[tokens[ti0].i] = 1;
        }
      } else {
        function isStrictBranch(seg1, seg2) {
          var chain1 = getAncestorChain(seg1);
          var chain2 = getAncestorChain(seg2);
          var set1 = {};
          var set2 = {};
          for (var i = 0; i < chain1.length; i++) set1[chain1[i]] = true;
          for (var j = 0; j < chain2.length; j++) set2[chain2[j]] = true;
          return set1[seg2] || set2[seg1];
        }
        // Use only branch heads to define clauses.
        var groupId = 1;
        var prevHead = branchHeads[0];
        clauseGroup[prevHead] = groupId;
        for (var i1 = 1; i1 < branchHeads.length; i1++) {
          var curHead = branchHeads[i1];
          if (!isStrictBranch(curHead, prevHead)) {
            groupId++;
          }
          clauseGroup[curHead] = groupId;
          prevHead = curHead;
        }

        // Assign groups to all heads so the postpass can evaluate full head sequences.
        for (var hi = 0; hi < heads.length; hi++) {
          var h = heads[hi];
          if (clauseGroup[h] !== undefined) continue;
          var curH = h;
          var seenH = {};
          while (curH !== undefined && !seenH[curH]) {
            seenH[curH] = true;
            if (clauseGroup[curH] !== undefined) {
              clauseGroup[h] = clauseGroup[curH];
              break;
            }
            curH = parentOf[curH];
          }
          if (clauseGroup[h] === undefined) clauseGroup[h] = 0;
        }

        // Include singleton leaf tokens in the postpass.
        var standaloneLeaves = [];
        for (var tiLeaf = 0; tiLeaf < tokens.length; tiLeaf++) {
          var segLeaf = tokens[tiLeaf].i;
          var kidsLeaf = children[segLeaf] || [];
          if (kidsLeaf.length > 0) continue;
          standaloneLeaves.push(segLeaf);
          if (clauseGroup[segLeaf] !== undefined) continue;
          var curLeaf = segLeaf;
          var seenLeaf = {};
          while (curLeaf !== undefined && !seenLeaf[curLeaf]) {
            seenLeaf[curLeaf] = true;
            if (clauseGroup[curLeaf] !== undefined) {
              clauseGroup[segLeaf] = clauseGroup[curLeaf];
              break;
            }
            curLeaf = parentOf[curLeaf];
          }
          if (clauseGroup[segLeaf] === undefined) clauseGroup[segLeaf] = 0;
        }

        // Postpass: split on large depth drops within each clause head sequence.
        var headsByGroup = {};
        var postpassNodes = heads.concat(standaloneLeaves);
        for (var hi2 = 0; hi2 < postpassNodes.length; hi2++) {
          var head = postpassNodes[hi2];
          var grp = clauseGroup[head];
          if (!grp) continue;
          if (!headsByGroup[grp]) headsByGroup[grp] = [];
          headsByGroup[grp].push(head);
        }
        var nextGroupId = groupId + 1;
        for (var grpKey in headsByGroup) {
          if (!headsByGroup.hasOwnProperty(grpKey)) continue;
          var list = headsByGroup[grpKey];
          list.sort(function(a, b) { return a - b; });
          var currentGroup = clauseGroup[list[0]];
          var prevDepth = tokenDepths[list[0]] || 0;
          var depthDrop = this.settings.clauseDepthDrop;
          var depthDropMin = Math.max(0, Math.min(10, depthDrop !== undefined ? depthDrop : 3));
          clauseGroup[list[0]] = currentGroup;
          for (var li = 1; li < list.length; li++) {
            var curHead = list[li];
            var curDepth = tokenDepths[curHead] || 0;
            if (curDepth - prevDepth >= depthDropMin) {
              currentGroup = nextGroupId++;
            }
            clauseGroup[curHead] = currentGroup;
            prevDepth = curDepth;
          }
        }

      }

      // Propagate groups to non-head tokens (each gets its nearest head ancestor's group)

      for (var ti = 0; ti < tokens.length; ti++) {
        var seg2 = tokens[ti].i;
        if (clauseGroup[seg2] !== undefined) continue;

        // Walk up to find nearest head ancestor with a group
        var cur3 = seg2;
        var seen2 = {};
        while (cur3 !== undefined && !seen2[cur3]) {
          seen2[cur3] = true;
          if (clauseGroup[cur3] !== undefined) {
            clauseGroup[seg2] = clauseGroup[cur3];
            break;
          }
          cur3 = parentOf[cur3];
        }

        // If no ancestor found, assign to group 0
        if (clauseGroup[seg2] === undefined) clauseGroup[seg2] = 0;
      }

      function isHeadSeg(seg) {
        var kids = children[seg] || [];
        return kids.length > 0;
      }
      var headSegs = [];
      var headSet = {};
      for (var hi0 = 0; hi0 < tokens.length; hi0++) {
        var segH = tokens[hi0].i;
        if (isHeadSeg(segH)) {
          headSegs.push(segH);
          headSet[segH] = true;
        }
      }
      if (headSegs.length === 0) {
        for (var hi1 = 0; hi1 < tokens.length; hi1++) {
          var segH2 = tokens[hi1].i;
          headSegs.push(segH2);
          headSet[segH2] = true;
        }
      }

        var splitMultiHeadOutClauseGroups = function() {
          var groupMembers = {};
          var groupMembersAll = {};
          var maxGroupId = 0;
        for (var gi = 0; gi < tokens.length; gi++) {
          var seg = tokens[gi].i;
          var grpVal = clauseGroup[seg];
          if (grpVal === undefined || grpVal === 0) continue;
          if (!groupMembersAll[grpVal]) groupMembersAll[grpVal] = [];
          groupMembersAll[grpVal].push(seg);
          if (headSet[seg]) {
            if (!groupMembers[grpVal]) groupMembers[grpVal] = [];
            groupMembers[grpVal].push(seg);
          }
          if (grpVal > maxGroupId) maxGroupId = grpVal;
        }
          var nextSplitGroupId = maxGroupId + 1;
          for (var grpKey in groupMembersAll) {
            if (!groupMembersAll.hasOwnProperty(grpKey)) continue;
            var members = groupMembers[grpKey] || [];
            var allMembers = groupMembersAll[grpKey] || [];
            var memberSetAll = {};
            for (var mi = 0; mi < allMembers.length; mi++) memberSetAll[allMembers[mi]] = true;

            // Find all members (not just heads) whose parent is outside the group
            var topLevel = [];
            var topParent = null;
            var allSameParent = true;
            for (var ti = 0; ti < allMembers.length; ti++) {
              var segTop = allMembers[ti];
              var parentTop = parentOf[segTop];
              if (parentTop === undefined || !memberSetAll[parentTop]) {
                topLevel.push(segTop);
                if (topParent === null) topParent = parentTop;
                else if (topParent !== parentTop) allSameParent = false;
              }
            }

            // Key guard: if multiple members point to the same external parent
            // (meaning the apex is outside the clause), split them into separate clauses
            var splitAnchors;
            var assignMembers;
            if (topLevel.length > 1 && allSameParent && (topParent === undefined || !memberSetAll[topParent])) {
              // Multiple members converge to the same external parent - split each into its own clause
              splitAnchors = topLevel;
              assignMembers = allMembers;
            } else {
              // Fall back to original head-out logic
              var headOuts = [];
              for (var hi = 0; hi < members.length; hi++) {
                var segHead = members[hi];
                var parent = parentOf[segHead];
                if (parent === undefined || !memberSetAll[parent]) {
                  headOuts.push(segHead);
                }
              }
              splitAnchors = headOuts;
              assignMembers = members;
            }

          if (splitAnchors.length <= 1) continue;
          var headToGroup = {};
          var baseGroup = parseInt(grpKey, 10);
          headToGroup[splitAnchors[0]] = baseGroup;
          for (var ho = 1; ho < splitAnchors.length; ho++) {
            headToGroup[splitAnchors[ho]] = nextSplitGroupId++;
          }
          for (var mi2 = 0; mi2 < assignMembers.length; mi2++) {
            var segAssign = assignMembers[mi2];
            var cur = segAssign;
            var seen3 = {};
            while (cur !== undefined && !seen3[cur]) {
              seen3[cur] = true;
              if (headToGroup[cur] !== undefined) {
                clauseGroup[segAssign] = headToGroup[cur];
                break;
              }
              var p = parentOf[cur];
              if (p === undefined || !memberSetAll[p]) {
                if (headToGroup[cur] === undefined) {
                  headToGroup[cur] = nextSplitGroupId++;
                }
                clauseGroup[segAssign] = headToGroup[cur];
                break;
              }
              cur = p;
            }
            if (clauseGroup[segAssign] === undefined) {
              clauseGroup[segAssign] = baseGroup;
            }
          }
        }
      };

      var propagateGroupsToNonHeads = function() {
        for (var ti2 = 0; ti2 < tokens.length; ti2++) {
          var seg = tokens[ti2].i;
          if (headSet[seg]) continue;
          var cur = seg;
          var seen4 = {};
          while (cur !== undefined && !seen4[cur]) {
            seen4[cur] = true;
            if (headSet[cur] && clauseGroup[cur] !== undefined) {
              clauseGroup[seg] = clauseGroup[cur];
              break;
            }
            cur = parentOf[cur];
          }
          if (clauseGroup[seg] === undefined) clauseGroup[seg] = 0;
        }
      };

      // Postpass: split clause groups that have multiple heads pointing outside the group.
      splitMultiHeadOutClauseGroups();

      // Sync non-head tokens to their nearest head before contiguity.
      propagateGroupsToNonHeads();

      // Postpass guard: enforce contiguous clause spans by token order.
      var orderedSegs = [];
      for (var osi = 0; osi < tokens.length; osi++) {
        orderedSegs.push(tokens[osi].i);
      }
      orderedSegs.sort(function(a, b) { return a - b; });
      var remapGroupId = 0;
      var prevGroup = null;
      for (var oi = 0; oi < orderedSegs.length; oi++) {
        var seg = orderedSegs[oi];
        var grp = clauseGroup[seg];
        if (grp === 0) continue;
        if (grp !== prevGroup) {
          remapGroupId++;
          prevGroup = grp;
        }
        clauseGroup[seg] = remapGroupId;
      }

      // Final postpass: split orphaned clauses whose head is outside the group (after contiguity split them off)
      splitMultiHeadOutClauseGroups();

    }

    // Get root phrase: root + only CONTIGUOUS leaf children
    // Non-contiguous leaf children become their own singleton chunks
    function getRootPhrase(rootIdx) {
      var kids = children[rootIdx] || [];

      // Find all leaf children (no grandchildren)
      var leafKids = [];
      for (var x = 0; x < kids.length; x++) {
        var grandkids = children[kids[x]] || [];
        if (grandkids.length === 0) {
          leafKids.push(kids[x]);
        }
      }

      if (leafKids.length === 0) {
        return [rootIdx]; // Just the root itself
      }

      // Build set of candidates (root + leaf kids)
      var candidateSet = {};
      candidateSet[rootIdx] = true;
      for (var i = 0; i < leafKids.length; i++) {
        candidateSet[leafKids[i]] = true;
      }

      // Start from root and expand to adjacent candidates only (contiguous)
      var members = [];
      var toCheck = [rootIdx];
      var checked = {};

      while (toCheck.length > 0) {
        var current = toCheck.pop();
        if (checked[current]) continue;
        checked[current] = true;

        // Only add if it's a valid candidate
        if (candidateSet[current]) {
          members.push(current);

          // Check adjacent token indices
          if (candidateSet[current - 1] && !checked[current - 1]) {
            toCheck.push(current - 1);
          }
          if (candidateSet[current + 1] && !checked[current + 1]) {
            toCheck.push(current + 1);
          }
        }
      }

      return members;
    }

    // Helper to get subtree with contiguity check for leaf children
    // Returns { members: Array, nonContiguousLeaves: Array }
    function getSubtreeContiguous(idx) {
      var members = [idx];
      var nonContiguousLeaves = [];

      // First pass: recursively add all non-leaf children and their subtrees
      var stack = [idx];
      while (stack.length) {
        var n = stack.pop();
        var ch = children[n] || [];
        for (var x = 0; x < ch.length; x++) {
          var grandkids = children[ch[x]] || [];
          if (grandkids.length > 0) {
            // Non-leaf child: add it and continue recursion
            if (members.indexOf(ch[x]) === -1) {
              members.push(ch[x]);
              stack.push(ch[x]);
            }
          }
        }
      }

      // Second pass: for each token in members, keep only leaf kids contiguous to that parent
      var membersSnapshot = members.slice();
      for (var mi = 0; mi < membersSnapshot.length; mi++) {
        var m = membersSnapshot[mi];
        var ch = children[m] || [];
        var leafKids = [];
        for (var ci = 0; ci < ch.length; ci++) {
          var grandkids = children[ch[ci]] || [];
          if (grandkids.length === 0) {
            leafKids.push(ch[ci]);
          }
        }
        if (!leafKids.length) continue;

        var candidate = {};
        candidate[m] = true;
        for (var li = 0; li < leafKids.length; li++) {
          candidate[leafKids[li]] = true;
        }

        var local = {};
        var stack2 = [m];
        while (stack2.length) {
          var cur = stack2.pop();
          if (local[cur]) continue;
          if (!candidate[cur]) continue;
          local[cur] = true;
          if (candidate[cur - 1] && !local[cur - 1]) stack2.push(cur - 1);
          if (candidate[cur + 1] && !local[cur + 1]) stack2.push(cur + 1);
        }

        for (var li2 = 0; li2 < leafKids.length; li2++) {
          var leaf = leafKids[li2];
          if (local[leaf]) {
            if (members.indexOf(leaf) === -1) {
              members.push(leaf);
            }
          } else {
            nonContiguousLeaves.push(leaf);
          }
        }
      }

      return { members: members, nonContiguousLeaves: nonContiguousLeaves };
    }

    // Helper to get entire subtree (backward compatibility)
    function getSubtree(idx) {
      var result = [idx];
      var stack = [idx];
      while (stack.length) {
        var n = stack.pop();
        var ch = children[n] || [];
        for (var x = 0; x < ch.length; x++) {
          result.push(ch[x]);
          stack.push(ch[x]);
        }
      }
      return result;
    }

    // Check if token has children
    function hasChildren(idx) {
      var kids = children[idx] || [];
      return kids.length > 0;
    }

    // Build chunks: depth 0 (roots) + depth 1 to maxDepth
    var chunks = [];
    var tokenToChunks = {};
    var canonicalChunk = {};  // seg -> chunk (finest-grained)

    // Initialize tokenToChunks
    for (var ti = 0; ti < tokens.length; ti++) {
      tokenToChunks[tokens[ti].i] = [];
    }

    // Process depth 0 (roots with children) - root + CONTIGUOUS leaf children only
    // Non-contiguous leaf children become explicit singleton chunks
    for (var ri = 0; ri < tokens.length; ri++) {
      var tok = tokens[ri];
      if (tokenDepths[tok.i] === 0 && hasChildren(tok.i)) {
        var members = getRootPhrase(tok.i);
        var rootExtras = [];
        var chunk = {
          depth: 0,
          headIdx: tok.i,
          headPos: 'ROOT',  // Use special ROOT color for root phrase
          members: members,
          isRootPhrase: true
        };
        chunks.push(chunk);

        for (var mi = 0; mi < members.length; mi++) {
          if (tokenToChunks[members[mi]]) {
            tokenToChunks[members[mi]].push(chunk);
          }
        }

        // Create explicit singleton chunks for non-contiguous leaf children of root
        var rootKids = children[tok.i] || [];
        for (var rki = 0; rki < rootKids.length; rki++) {
          var kid = rootKids[rki];
          var grandkids = children[kid] || [];
          // Only leaf children (no grandkids) that aren't in root phrase
          if (grandkids.length === 0 && members.indexOf(kid) === -1) {
            rootExtras.push(kid);
            var kidTok = null;
            for (var kti = 0; kti < tokens.length; kti++) {
              if (tokens[kti].i === kid) { kidTok = tokens[kti]; break; }
            }
            var singletonChunk = {
              depth: 0,
              headIdx: kid,
              headPos: kidTok ? (kidTok.upos || 'DEFAULT') : 'DEFAULT',
              members: [kid],
              isSingleton: true,
              isNonContiguousLeaf: true
            };
            chunks.push(singletonChunk);
            if (tokenToChunks[kid]) {
              tokenToChunks[kid].push(singletonChunk);
            }
          }
        }
        if (rootExtras.length) {
          chunk.extraMembers = rootExtras;
        }
      }
    }

    // Process depth 1 to maxDepth (contiguous subtrees only)
    for (var d = 1; d <= maxDepth; d++) {
      for (var ti2 = 0; ti2 < tokens.length; ti2++) {
        var tok2 = tokens[ti2];
        var idx = tok2.i;
        if (tokenDepths[idx] !== d) continue;
        if (!hasChildren(idx)) continue;

        // Use contiguous version to exclude non-contiguous leaf children
        var result = getSubtreeContiguous(idx);
        var subtree = result.members;
        var nonContiguousLeaves = result.nonContiguousLeaves;

        if (clauseGroup && clauseGroup[idx] !== undefined) {
          var headGroup = clauseGroup[idx];
          var filtered = [];
          for (var fm = 0; fm < subtree.length; fm++) {
            if (clauseGroup[subtree[fm]] === headGroup) filtered.push(subtree[fm]);
          }
          subtree = filtered;
          var filteredLeaves = [];
          for (var fl = 0; fl < nonContiguousLeaves.length; fl++) {
            if (clauseGroup[nonContiguousLeaves[fl]] === headGroup) filteredLeaves.push(nonContiguousLeaves[fl]);
          }
          nonContiguousLeaves = filteredLeaves;
        }

        var chunk2 = {
          depth: d,
          headIdx: idx,
          headPos: tok2.upos || 'DEFAULT',
          members: subtree,
          extraMembers: nonContiguousLeaves
        };
        chunks.push(chunk2);

        for (var m2 = 0; m2 < subtree.length; m2++) {
          var memberIdx = subtree[m2];
          if (tokenToChunks[memberIdx]) {
            tokenToChunks[memberIdx].push(chunk2);
          }
        }

        // Create singleton chunks for non-contiguous leaf children
        for (var nci = 0; nci < nonContiguousLeaves.length; nci++) {
          var leaf = nonContiguousLeaves[nci];
          var leafTok = null;
          for (var lti = 0; lti < tokens.length; lti++) {
            if (tokens[lti].i === leaf) { leafTok = tokens[lti]; break; }
          }
          var singletonChunk = {
            depth: d,
            headIdx: leaf,
            headPos: leafTok ? (leafTok.upos || 'DEFAULT') : 'DEFAULT',
            members: [leaf],
            isSingleton: true,
            isNonContiguousLeaf: true
          };
          chunks.push(singletonChunk);
          if (tokenToChunks[leaf]) {
            tokenToChunks[leaf].push(singletonChunk);
          }
        }
      }
    }

    // Compute canonical chunk for each token (deepest/finest-grained)
    for (var ti3 = 0; ti3 < tokens.length; ti3++) {
      var segIdx = tokens[ti3].i;
      var chunkList = tokenToChunks[segIdx] || [];
      if (chunkList.length === 0) {
        // Token not in any chunk - use its own POS
        canonicalChunk[segIdx] = {
          headIdx: segIdx,
          members: [segIdx],
          depth: -1,
          headPos: tokens[ti3].upos || 'DEFAULT',
          isSingleton: true
        };
      } else {
        // Find deepest chunk
        var deepest = chunkList[0];
        for (var ci = 1; ci < chunkList.length; ci++) {
          if (chunkList[ci].depth > deepest.depth) {
            deepest = chunkList[ci];
          }
        }
        canonicalChunk[segIdx] = deepest;
      }
    }

    this.chunks = {
      chunks: chunks,
      tokenToChunks: tokenToChunks,
      canonicalChunk: canonicalChunk,
      clauseGroup: clauseGroup
    };
  };

  // Bottom-up chunking: works from lowest depth to root
  // At each depth level, tokens within threshold distance of their parent get rolled into parent's chunk
  DepTreeView.prototype._recomputeBottomUpChunks = function() {
    if (!this.data || !this.data.udOverlay || !this.data.udOverlay.ok) {
      this.bottomUpChunks = null;
      return;
    }

    if (!this.bottomUpChunkMode) {
      this.bottomUpChunks = null;
      return;
    }

    var tokens = this.data.udOverlay.tokens;
    if (!tokens || !tokens.length) {
      this.bottomUpChunks = null;
      return;
    }

    var threshold = this.bottomUpChunkThresholdValue || 5;

    // Build token map and parent/children relationships
    var tokenMap = {};
    var children = {};
    var parentOf = {};
    var tokenPosition = {}; // left-to-right position (segment index)

    var compressedPositions = null;
    var segCount = this.data && Array.isArray(this.data.segments) ? this.data.segments.length : 0;
    if (segCount && tokens && tokens.length) {
      var nerSpanRanges = [];
      for (var si = 0; si < tokens.length; si++) {
        var segSpan = tokens[si].seg_span;
        if (!Array.isArray(segSpan) || segSpan.length <= 1) continue;
        var spanStart = segSpan[0];
        var spanEnd = segSpan[0];
        for (var ss = 1; ss < segSpan.length; ss++) {
          var segVal = segSpan[ss];
          if (segVal < spanStart) spanStart = segVal;
          if (segVal > spanEnd) spanEnd = segVal;
        }
        spanEnd += 1;
        if (!isFinite(spanStart) || !isFinite(spanEnd) || spanEnd <= spanStart) continue;
        if (spanStart < 0) spanStart = 0;
        if (spanEnd > segCount) spanEnd = segCount;
        nerSpanRanges.push({ start: spanStart, end: spanEnd });
      }

      if (nerSpanRanges.length) {
        // Compress NER-collapsed spans so distance counts them as one step.
        nerSpanRanges.sort(function(a, b) {
          if (a.start !== b.start) return a.start - b.start;
          return a.end - b.end;
        });
        var mergedSpans = [];
        for (var ms = 0; ms < nerSpanRanges.length; ms++) {
          var span = nerSpanRanges[ms];
          if (!mergedSpans.length || span.start >= mergedSpans[mergedSpans.length - 1].end) {
            mergedSpans.push({ start: span.start, end: span.end });
          } else {
            var last = mergedSpans[mergedSpans.length - 1];
            if (span.end > last.end) last.end = span.end;
          }
        }

        compressedPositions = new Array(segCount);
        var posIdx = 0;
        var segIdx = 0;
        var spanIdx = 0;
        while (segIdx < segCount) {
          if (spanIdx < mergedSpans.length && segIdx === mergedSpans[spanIdx].start) {
            var spanEndIdx = mergedSpans[spanIdx].end;
            for (var fillIdx = segIdx; fillIdx < spanEndIdx; fillIdx++) {
              compressedPositions[fillIdx] = posIdx;
            }
            posIdx += 1;
            segIdx = spanEndIdx;
            spanIdx += 1;
          } else {
            compressedPositions[segIdx] = posIdx;
            posIdx += 1;
            segIdx += 1;
          }
        }
      }
    }

    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      tokenMap[t.i] = t;
      children[t.i] = [];
      var pos = t.i;
      if (compressedPositions && typeof compressedPositions[t.i] === "number") {
        pos = compressedPositions[t.i];
      }
      tokenPosition[t.i] = pos;
    }

    for (var j = 0; j < tokens.length; j++) {
      var tok = tokens[j];
      var headIdx = tok.head;
      if (headIdx !== undefined && headIdx !== tok.i && tokenMap[headIdx]) {
        children[headIdx].push(tok.i);
        parentOf[tok.i] = headIdx;
      }
    }

    // Find roots and compute depths via BFS
    var roots = [];
    for (var k = 0; k < tokens.length; k++) {
      var t2 = tokens[k];
      if (t2.head === undefined || t2.head === t2.i || !tokenMap[t2.head]) {
        roots.push(t2.i);
      }
    }

    var tokenDepths = {};
    var maxDepth = 0;
    var queue = [];
    for (var r = 0; r < roots.length; r++) {
      tokenDepths[roots[r]] = 0;
      queue.push(roots[r]);
    }
    while (queue.length) {
      var cur = queue.shift();
      var ch = children[cur] || [];
      for (var c = 0; c < ch.length; c++) {
        if (tokenDepths[ch[c]] === undefined) {
          tokenDepths[ch[c]] = tokenDepths[cur] + 1;
          if (tokenDepths[ch[c]] > maxDepth) maxDepth = tokenDepths[ch[c]];
          queue.push(ch[c]);
        }
      }
    }

    // Initialize: each token starts in its own chunk
    // chunkOf[seg] = chunk head segment index
    var chunkOf = {};
    for (var ti = 0; ti < tokens.length; ti++) {
      chunkOf[tokens[ti].i] = tokens[ti].i;
    }

    // Helper: get the current chunk head for a token (with path compression)
    function getChunkHead(seg) {
      if (chunkOf[seg] === seg) return seg;
      chunkOf[seg] = getChunkHead(chunkOf[seg]);
      return chunkOf[seg];
    }

    // Process from lowest depth up to root (depth 0)
    for (var d = maxDepth; d >= 1; d--) {
      // Collect all tokens at this depth
      var tokensAtDepth = [];
      for (var ti2 = 0; ti2 < tokens.length; ti2++) {
        var seg = tokens[ti2].i;
        if (tokenDepths[seg] === d) {
          tokensAtDepth.push(seg);
        }
      }

      // For each token at this depth, check distance to parent
      for (var tdi = 0; tdi < tokensAtDepth.length; tdi++) {
        var tokenSeg = tokensAtDepth[tdi];
        var parentSeg = parentOf[tokenSeg];

        if (parentSeg === undefined) continue;

        // Calculate left-to-right distance between token and parent
        var tokenPos = tokenPosition[tokenSeg];
        var parentPos = tokenPosition[parentSeg];
        var distance = Math.abs(tokenPos - parentPos);

        // If within threshold, merge token's chunk into parent's chunk
        if (distance <= threshold) {
          var tokenChunkHead = getChunkHead(tokenSeg);
          var parentChunkHead = getChunkHead(parentSeg);

          // Merge: point token's chunk head to parent's chunk head
          if (tokenChunkHead !== parentChunkHead) {
            chunkOf[tokenChunkHead] = parentChunkHead;
          }
        }
      }
    }

    // Build final chunks from the union-find structure
    var chunkMembers = {}; // chunkHead -> [members]
    for (var ti3 = 0; ti3 < tokens.length; ti3++) {
      var seg3 = tokens[ti3].i;
      var head = getChunkHead(seg3);
      if (!chunkMembers[head]) chunkMembers[head] = [];
      chunkMembers[head].push(seg3);
    }

    // Build chunk objects
    var chunks = [];
    var canonicalChunk = {};

    for (var chunkHead in chunkMembers) {
      if (!chunkMembers.hasOwnProperty(chunkHead)) continue;
      var members = chunkMembers[chunkHead];
      members.sort(function(a, b) { return a - b; });

      var headTok = tokenMap[chunkHead];
      var chunk = {
        headIdx: parseInt(chunkHead, 10),
        headPos: headTok ? (headTok.upos || 'DEFAULT') : 'DEFAULT',
        members: members,
        depth: tokenDepths[chunkHead] || 0
      };
      chunks.push(chunk);

      // Each member points to this chunk
      for (var mi = 0; mi < members.length; mi++) {
        canonicalChunk[members[mi]] = chunk;
      }
    }

    this.bottomUpChunks = {
      chunks: chunks,
      canonicalChunk: canonicalChunk,
      chunkOf: chunkOf
    };
  };

  // Get tokens within N hops using BFS over dependency edges
  DepTreeView.prototype._getTokensWithinDistance = function(segIdx, maxDist) {
    if (maxDist <= 0) return { nodes: new Set(), edges: [] };

    // Build adjacency from edgeEls (each edge has headSeg and childSeg)
    var adj = new Map();
    for (var i = 0; i < this.edgeEls.length; i++) {
      var e = this.edgeEls[i];
      if (!adj.has(e.headSeg)) adj.set(e.headSeg, []);
      if (!adj.has(e.childSeg)) adj.set(e.childSeg, []);
      adj.get(e.headSeg).push({ seg: e.childSeg, edge: e, isParent: true });
      adj.get(e.childSeg).push({ seg: e.headSeg, edge: e, isParent: false });
    }

    // BFS to find all nodes within maxDist
    var depth = new Map();
    var queue = [{ node: segIdx, dist: 0 }];
    depth.set(segIdx, 0);
    while (queue.length) {
      var cur = queue.shift();
      if (cur.dist >= maxDist) continue;
      var neighbors = adj.get(cur.node) || [];
      for (var j = 0; j < neighbors.length; j++) {
        var neighbor = neighbors[j];
        if (!depth.has(neighbor.seg)) {
          depth.set(neighbor.seg, cur.dist + 1);
          queue.push({ node: neighbor.seg, dist: cur.dist + 1 });
        }
      }
    }

    // Collect edges where both endpoints are within distance
    var relatedEdges = [];
    for (var k = 0; k < this.edgeEls.length; k++) {
      var edge = this.edgeEls[k];
      if (depth.has(edge.headSeg) && depth.has(edge.childSeg)) {
        relatedEdges.push({
          edge: edge,
          headDist: depth.get(edge.headSeg),
          childDist: depth.get(edge.childSeg)
        });
      }
    }

    return { nodes: depth, edges: relatedEdges };
  };

  DepTreeView.prototype._getPathToRoot = function(segIdx) {
    // Get path from token to root, excluding the root
    var path = new Set();
    var current = segIdx;
    var visited = new Set();
    var maxIterations = 1000;
    var iterations = 0;

    while (current !== undefined && current !== null && iterations < maxIterations) {
      iterations++;
      if (visited.has(current)) break;
      visited.add(current);

      var node = this.nodeBySeg.get(current);
      if (!node) break;

      // Check if this is root
      var isRoot = node.headSeg === node.segIndex;
      if (!isRoot && node.dep && node.dep.toLowerCase() === "root") {
        isRoot = true;
      }
      if (!isRoot && this.data && this.data.udOverlay && Array.isArray(this.data.udOverlay.roots)) {
        if (this.data.udOverlay.roots.indexOf(current) !== -1) {
          isRoot = true;
        }
      }

      if (isRoot) {
        // Don't include root, stop here
        break;
      }

      path.add(current);
      current = node.headSeg;
    }

    return path;
  };

  DepTreeView.prototype._getDescendants = function(segIdx) {
    // Get all tokens in the subtree rooted at segIdx (including segIdx)
    var descendants = new Set();
    var stack = [segIdx];
    var visited = new Set();

    while (stack.length) {
      var current = stack.pop();
      if (visited.has(current)) continue;
      visited.add(current);
      descendants.add(current);

      // Find all children of current
      for (var i = 0; i < this.edgeEls.length; i++) {
        var edge = this.edgeEls[i];
        if (edge.headSeg === current && !visited.has(edge.childSeg)) {
          stack.push(edge.childSeg);
        }
      }
    }

    return descendants;
  };

  DepTreeView.prototype._applyAncestorDepthHighlight = function(segIdx) {
    if (!this.nodeBySeg.has(segIdx)) return;
    var depth = parseInt(this.ancestorDepthValue, 10);
    if (!isFinite(depth) || depth < 1) depth = 1;
    var current = segIdx;
    for (var i = 0; i < depth; i++) {
      var node = this.nodeBySeg.get(current);
      if (!node) break;
      var head = node.headSeg;
      if (head === undefined || head === null) break;
      if (head === current || !this.nodeBySeg.has(head)) break;
      current = head;
    }
    var highlightedTokens = this._getDescendants(current);
    this._renderHighlightedTokens(highlightedTokens, segIdx);
  };

  DepTreeView.prototype._applyContextWindowHighlight = function(segIdx) {
    if (!this.nodeBySeg.has(segIdx)) return;
    var count = parseInt(this.contextWindowValue, 10);
    if (!isFinite(count) || count < 1) count = 1;

    var baseNode = this.nodeBySeg.get(segIdx);
    var sentenceIdx = baseNode ? baseNode.sentenceIdx : null;
    if (sentenceIdx === null || sentenceIdx === undefined) return;

    // 1. Get all tokens in sentence, sorted by position
    var nodesInSentence = [];
    this.nodeBySeg.forEach(function(node, seg) {
      if (node && node.sentenceIdx === sentenceIdx) nodesInSentence.push(seg);
    });
    if (!nodesInSentence.length) return;
    nodesInSentence.sort(function(a, b) { return a - b; });
    var centerPos = nodesInSentence.indexOf(segIdx);
    if (centerPos === -1) return;

    // Position lookup
    var posBySeg = {};
    for (var pi = 0; pi < nodesInSentence.length; pi++) {
      posBySeg[nodesInSentence[pi]] = pi;
    }

    // 2. Build tree adjacency map (bidirectional)
    var treeAdj = new Map();
    for (var i = 0; i < this.edgeEls.length; i++) {
      var edge = this.edgeEls[i];
      var head = edge.headSeg;
      var child = edge.childSeg;
      var headNode = this.nodeBySeg.get(head);
      var childNode = this.nodeBySeg.get(child);
      if (!headNode || !childNode) continue;
      if (headNode.sentenceIdx !== sentenceIdx || childNode.sentenceIdx !== sentenceIdx) continue;
      if (!treeAdj.has(head)) treeAdj.set(head, new Set());
      if (!treeAdj.has(child)) treeAdj.set(child, new Set());
      treeAdj.get(head).add(child);
      treeAdj.get(child).add(head);
    }

    // 3. Collect candidates: expand purely positionally (centered on hover)
    var left = centerPos;
    var right = centerPos;
    // Collect up to 2x count to have room for finding best span
    var targetCandidates = Math.min(nodesInSentence.length, count * 2);
    while ((right - left + 1) < targetCandidates) {
      var expandedAny = false;
      if (left > 0) { left--; expandedAny = true; }
      if ((right - left + 1) < targetCandidates && right < nodesInSentence.length - 1) { right++; expandedAny = true; }
      if (!expandedAny) break;
    }
    var candidates = nodesInSentence.slice(left, right + 1);
    var hoverIdxInCandidates = candidates.indexOf(segIdx);

    // 4. Helper: check if a span is tree-contiguous (all tokens connected via tree edges within the span)
    function isTreeContiguous(spanTokens) {
      if (spanTokens.length <= 1) return true;
      var spanSet = new Set(spanTokens);
      var visited = new Set();
      var queue = [spanTokens[0]];
      visited.add(spanTokens[0]);
      while (queue.length > 0) {
        var curr = queue.shift();
        var neighbors = treeAdj.get(curr);
        if (neighbors) {
          neighbors.forEach(function(n) {
            if (spanSet.has(n) && !visited.has(n)) {
              visited.add(n);
              queue.push(n);
            }
          });
        }
      }
      return visited.size === spanTokens.length;
    }

    // 5. Find largest tree-contiguous span containing hover token
    // Try all spans [L, R] that include the hover position, find largest valid one
    // Priorities: 1) larger size, 2) more centered on hover, 3) slight rightward bias as tie-breaker
    var bestSpan = [segIdx];
    var bestSize = 1;
    var bestImbalance = 0; // |leftExtent - rightExtent|, lower is more centered
    var bestRight = hoverIdxInCandidates;

    for (var L = 0; L <= hoverIdxInCandidates; L++) {
      for (var R = hoverIdxInCandidates; R < candidates.length; R++) {
        var spanSize = R - L + 1;
        if (spanSize > count) break; // No point checking larger spans (break inner loop)
        if (spanSize < bestSize) continue; // Smaller size, skip

        var leftExtent = hoverIdxInCandidates - L;
        var rightExtent = R - hoverIdxInCandidates;
        var imbalance = Math.abs(leftExtent - rightExtent);

        // Check if this span is better:
        // - Larger size always wins
        // - Same size: prefer more centered (lower imbalance)
        // - Same size & imbalance: slight rightward bias (prefer higher R)
        var dominated = false;
        if (spanSize === bestSize) {
          if (imbalance > bestImbalance) {
            dominated = true; // Less centered, skip
          } else if (imbalance === bestImbalance && R <= bestRight) {
            dominated = true; // Equally centered but not more rightward, skip
          }
        }
        if (dominated) continue;

        var span = candidates.slice(L, R + 1);
        if (isTreeContiguous(span)) {
          bestSpan = span;
          bestSize = spanSize;
          bestImbalance = imbalance;
          bestRight = R;
        }
      }
    }

    var highlightedTokens = new Set(bestSpan);

    // 6. Expand for whitespace islands
    if (this.whitespaceBoundaries && this.whitespaceBoundaries.size) {
      var islands = [];
      var currentIsland = [];
      for (var si = 0; si < nodesInSentence.length; si++) {
        var seg = nodesInSentence[si];
        currentIsland.push(seg);
        if (this.whitespaceBoundaries.has(seg)) {
          islands.push(currentIsland);
          currentIsland = [];
        }
      }
      if (currentIsland.length) islands.push(currentIsland);

      var islandBySeg = {};
      for (var ii = 0; ii < islands.length; ii++) {
        for (var ij = 0; ij < islands[ii].length; ij++) {
          islandBySeg[islands[ii][ij]] = islands[ii];
        }
      }

      // Add full islands for any highlighted token
      var toAdd = [];
      highlightedTokens.forEach(function(seg) {
        var island = islandBySeg[seg];
        if (island) {
          for (var ik = 0; ik < island.length; ik++) {
            toAdd.push(island[ik]);
          }
        }
      });
      for (var ti = 0; ti < toAdd.length; ti++) {
        highlightedTokens.add(toAdd[ti]);
      }
    }

    // 7. Roll in contiguous singleton leaf children
    var hasChild = {};
    for (var e = 0; e < this.edgeEls.length; e++) {
      var edge2 = this.edgeEls[e];
      var headNode2 = this.nodeBySeg.get(edge2.headSeg);
      if (headNode2 && headNode2.sentenceIdx === sentenceIdx) {
        hasChild[edge2.headSeg] = true;
      }
    }

    function isContiguousToHighlighted(seg) {
      var pos = posBySeg[seg];
      if (pos === undefined) return false;
      var leftN = pos > 0 ? nodesInSentence[pos - 1] : null;
      var rightN = pos < nodesInSentence.length - 1 ? nodesInSentence[pos + 1] : null;
      return (leftN !== null && highlightedTokens.has(leftN)) ||
             (rightN !== null && highlightedTokens.has(rightN));
    }

    var added = true;
    while (added) {
      added = false;
      for (var le = 0; le < this.edgeEls.length; le++) {
        var leafEdge = this.edgeEls[le];
        var head3 = leafEdge.headSeg;
        var child3 = leafEdge.childSeg;
        if (!highlightedTokens.has(head3) || highlightedTokens.has(child3)) continue;
        if (hasChild[child3]) continue; // not a leaf
        var childNode3 = this.nodeBySeg.get(child3);
        if (!childNode3 || childNode3.sentenceIdx !== sentenceIdx) continue;
        if (isContiguousToHighlighted(child3)) {
          highlightedTokens.add(child3);
          added = true;
        }
      }
    }

    // 8. Final validation: ensure tree-contiguous (BFS from hover, keep only reachable)
    var connected = new Set();
    var stack = [segIdx];
    while (stack.length) {
      var cur = stack.pop();
      if (connected.has(cur)) continue;
      connected.add(cur);
      var neighbors = treeAdj.get(cur);
      if (neighbors) {
        neighbors.forEach(function(n) {
          if (highlightedTokens.has(n) && !connected.has(n)) {
            stack.push(n);
          }
        });
      }
    }

    // 9. Ensure positionally contiguous (find largest contiguous run containing hover)
    var connectedArray = Array.from(connected).sort(function(a, b) { return a - b; });
    if (connectedArray.length > 1) {
      var connectedSet = new Set(connectedArray);
      var hoverAllPos = posBySeg[segIdx];

      // Find contiguous run containing hover
      var runLeft = hoverAllPos;
      var runRight = hoverAllPos;
      while (runLeft > 0 && connectedSet.has(nodesInSentence[runLeft - 1])) runLeft--;
      while (runRight < nodesInSentence.length - 1 && connectedSet.has(nodesInSentence[runRight + 1])) runRight++;

      // Build final set from contiguous run
      var finalHighlighted = new Set();
      for (var ri = runLeft; ri <= runRight; ri++) {
        var seg = nodesInSentence[ri];
        if (connectedSet.has(seg)) {
          finalHighlighted.add(seg);
        }
      }
      highlightedTokens = finalHighlighted;
    } else {
      highlightedTokens = connected;
    }

    this._renderHighlightedTokens(highlightedTokens, segIdx);
  };

  DepTreeView.prototype._computeDiscontinuityChunks = function() {
    // Pre-compute chunks based on discontinuity filter
    // Returns a map: token -> Set of all tokens in the same chunk
    // This ensures uniform highlighting - any token in a chunk highlights the entire chunk
    var self = this;
    var tokenToChunk = new Map();

    if (!this.discontinuityMode) {
      return tokenToChunk;
    }

    // Step 1: For each token, find its chunk root (highest ancestor before discontinuity or root)
    var tokenToChunkRoot = new Map();
    var foundDiscontinuity = false;

    this.nodeBySeg.forEach(function(node, segIdx) {
      var current = segIdx;
      var visited = new Set();
      var chunkRoot = segIdx;
      var maxIterations = 1000;
      var iterations = 0;

      while (current !== undefined && current !== null && iterations < maxIterations) {
        iterations++;
        if (visited.has(current)) break;
        visited.add(current);

        var currentNode = self.nodeBySeg.get(current);
        if (!currentNode) break;

        // Check if root
        var isRoot = currentNode.headSeg === currentNode.segIndex;
        if (!isRoot && currentNode.dep && currentNode.dep.toLowerCase() === "root") {
          isRoot = true;
        }
        if (!isRoot && self.data && self.data.udOverlay && Array.isArray(self.data.udOverlay.roots)) {
          if (self.data.udOverlay.roots.indexOf(current) !== -1) {
            isRoot = true;
          }
        }

        if (isRoot) {
          // Hit the root - stop short of it, chunk root is the current token (not the root)
          break;
        }

        // Check for discontinuity (forward jump > threshold)
        var jump = currentNode.headSeg - current;
        if (jump > self.discontinuityThresholdValue) {
          // Discontinuity detected - current is the chunk root
          foundDiscontinuity = true;
          chunkRoot = current;
          break;
        }

        // Continue up
        chunkRoot = current;
        current = currentNode.headSeg;
      }

      tokenToChunkRoot.set(segIdx, chunkRoot);
    });

    // If no discontinuities were found, return empty map (fall through to normal logic)
    if (!foundDiscontinuity) {
      return tokenToChunk;
    }

    // Step 2: Build the inverse map - chunk_root -> Set of tokens in that chunk
    var chunkRootToTokens = new Map();
    tokenToChunkRoot.forEach(function(chunkRoot, token) {
      if (!chunkRootToTokens.has(chunkRoot)) {
        chunkRootToTokens.set(chunkRoot, new Set());
      }
      chunkRootToTokens.get(chunkRoot).add(token);
    });

    // Step 3: For each token, store the full set of tokens in its chunk
    tokenToChunkRoot.forEach(function(chunkRoot, token) {
      var tokensInChunk = chunkRootToTokens.get(chunkRoot);
      tokenToChunk.set(token, tokensInChunk);
    });

    return tokenToChunk;
  };

  DepTreeView.prototype._computeBranchDepthChunks = function() {
    // Pre-compute chunks based on branch depth
    // Walks down from root, splits branches where max descendant depth > threshold
    // Returns a map: token -> Set of all tokens in the same chunk
    var self = this;
    var tokenToChunk = new Map();

    if (!this.branchDepthMode) {
      return tokenToChunk;
    }

    // Helper to count max depth in a subtree (how many levels deep)
    function getMaxDepthInSubtree(rootSeg) {
      var maxDepth = 0;
      var stack = [{seg: rootSeg, depth: 0}];
      var visited = new Set();

      while (stack.length > 0) {
        var item = stack.pop();
        var seg = item.seg;
        var depth = item.depth;

        if (visited.has(seg)) continue;
        visited.add(seg);

        if (depth > maxDepth) maxDepth = depth;

        // Find all children
        for (var c = 0; c < self.edgeEls.length; c++) {
          if (self.edgeEls[c].headSeg === seg) {
            stack.push({seg: self.edgeEls[c].childSeg, depth: depth + 1});
          }
        }
      }

      return maxDepth;
    }

    // Recursively chunk starting from root
    function chunkFromRoot(rootSeg, targetChunks) {
      // Find all direct children
      var children = [];
      for (var c = 0; c < self.edgeEls.length; c++) {
        if (self.edgeEls[c].headSeg === rootSeg) {
          children.push(self.edgeEls[c].childSeg);
        }
      }

      // Process each child branch
      for (var ch = 0; ch < children.length; ch++) {
        var child = children[ch];
        var maxDepth = getMaxDepthInSubtree(child);

        // If branch is deep, it gets its own chunk
        if (maxDepth > self.branchDepthThresholdValue) {
          var descendants = self._getDescendants(child);
          if (!targetChunks.has(child)) {
            targetChunks.set(child, new Set());
          }
          descendants.forEach(function(d) { targetChunks.get(child).add(d); });
          // Recursively chunk this branch's children
          chunkFromRoot(child, targetChunks);
        } else {
          // Shallow branch stays with root
          var descendants = self._getDescendants(child);
          if (!targetChunks.has(rootSeg)) {
            targetChunks.set(rootSeg, new Set());
          }
          descendants.forEach(function(d) { targetChunks.get(rootSeg).add(d); });
        }
      }
    }

    // Find actual root(s)
    var roots = [];
    this.nodeBySeg.forEach(function(node, seg) {
      var isRoot = node.headSeg === node.segIndex;
      if (!isRoot && node.dep && node.dep.toLowerCase() === "root") {
        isRoot = true;
      }
      if (!isRoot && self.data && self.data.udOverlay && Array.isArray(self.data.udOverlay.roots)) {
        if (self.data.udOverlay.roots.indexOf(seg) !== -1) {
          isRoot = true;
        }
      }
      if (isRoot) roots.push(seg);
    });

    // Build chunks from each root
    var chunkRootToTokens = new Map();
    for (var r = 0; r < roots.length; r++) {
      chunkFromRoot(roots[r], chunkRootToTokens);
      // Root itself is a chunk
      if (!chunkRootToTokens.has(roots[r])) {
        chunkRootToTokens.set(roots[r], new Set());
      }
      chunkRootToTokens.get(roots[r]).add(roots[r]);
    }

    // Build token -> chunk map
    chunkRootToTokens.forEach(function(tokenSet) {
      tokenSet.forEach(function(token) {
        tokenToChunk.set(token, tokenSet);
      });
    });

    return tokenToChunk;
  };

  DepTreeView.prototype._applyPathToRootHighlight = function(segIdx) {
    if (!this.nodeBySeg.has(segIdx)) return;

    var self = this;

    // Pre-compute chunks if in chunking modes
    var discontinuityChunks = this._computeDiscontinuityChunks();
    var branchDepthChunks = this._computeBranchDepthChunks();

    // Helper to check if token is root
    function isRootToken(seg) {
      var node = self.nodeBySeg.get(seg);
      if (!node) return false;
      if (node.headSeg === node.segIndex) return true;
      if (node.dep && node.dep.toLowerCase() === "root") return true;
      if (self.data && self.data.udOverlay && Array.isArray(self.data.udOverlay.roots)) {
        if (self.data.udOverlay.roots.indexOf(seg) !== -1) return true;
      }
      return false;
    }

    // Check if hovering root
    if (isRootToken(segIdx)) {
      // Hovering root: highlight root + contiguous singleton children
      var highlightedTokens = new Set();
      highlightedTokens.add(segIdx);

      // Find all direct children of root
      var directChildren = [];
      for (var i = 0; i < this.edgeEls.length; i++) {
        var edge = this.edgeEls[i];
        if (edge.headSeg === segIdx) {
          directChildren.push(edge.childSeg);
        }
      }

      // Filter to singleton children only (no descendants)
      var singletonChildren = new Set();
      for (var j = 0; j < directChildren.length; j++) {
        var child = directChildren[j];
        var hasChildren = false;
        for (var k = 0; k < this.edgeEls.length; k++) {
          if (this.edgeEls[k].headSeg === child) {
            hasChildren = true;
            break;
          }
        }
        if (!hasChildren) {
          singletonChildren.add(child);
        }
      }

      // Floodfill: start from root, expand to adjacent singleton children
      var toCheck = [segIdx];
      var checked = new Set();
      checked.add(segIdx);

      while (toCheck.length > 0) {
        var current = toCheck.shift();

        // Check immediately adjacent positions
        var prev = current - 1;
        var next = current + 1;

        if (singletonChildren.has(prev) && !checked.has(prev)) {
          highlightedTokens.add(prev);
          checked.add(prev);
          toCheck.push(prev);
        }
        if (singletonChildren.has(next) && !checked.has(next)) {
          highlightedTokens.add(next);
          checked.add(next);
          toCheck.push(next);
        }
      }

      this._renderHighlightedTokens(highlightedTokens, segIdx);
      return;
    }

    // If discontinuity mode is on, use pre-computed chunks
    var ancestorBeforeRoot;
    if (this.discontinuityMode && discontinuityChunks.size > 0) {
      // Find the chunk root for this token
      var chunkRoot = discontinuityChunks.get(segIdx);
      if (chunkRoot !== undefined) {
        ancestorBeforeRoot = chunkRoot;
      } else {
        ancestorBeforeRoot = segIdx;
      }
    } else {
      // Normal mode: build path from clicked token to its immediate ancestor before root
      var pathToRoot = [];
      var current = segIdx;
      var visited = new Set();
      var maxIterations = 1000;
      var iterations = 0;

      while (current !== undefined && current !== null && iterations < maxIterations) {
        iterations++;
        if (visited.has(current)) break;
        visited.add(current);

        var node = this.nodeBySeg.get(current);
        if (!node) break;

        // Stop at root
        if (isRootToken(current)) {
          break;
        }

        // Add to path
        pathToRoot.push(current);

        // Move to parent
        current = node.headSeg;
      }

      // Find the immediate ancestor before root (last item in path)
      ancestorBeforeRoot = pathToRoot.length > 0 ? pathToRoot[pathToRoot.length - 1] : segIdx;
    }

    // Highlight: all tokens that belong to the same chunk
    var highlightedTokens = new Set();

    if (this.discontinuityMode && discontinuityChunks.size > 0) {
      // In discontinuity mode: highlight all tokens in the same chunk as the hovered token
      var myChunk = discontinuityChunks.get(segIdx);
      if (myChunk) {
        myChunk.forEach(function(token) { highlightedTokens.add(token); });
      }

      // In discontinuity mode, skip all the Roll Non-ACL logic below
      this._renderHighlightedTokens(highlightedTokens, segIdx);
      return;
    }

    if (this.branchDepthMode && branchDepthChunks.size > 0) {
      // In branch depth mode: highlight all tokens in the same chunk as the hovered token
      var myBranchChunk = branchDepthChunks.get(segIdx);
      if (myBranchChunk) {
        myBranchChunk.forEach(function(token) { highlightedTokens.add(token); });
      }

      // In branch depth mode, skip all the Roll Non-ACL logic below
      this._renderHighlightedTokens(highlightedTokens, segIdx);
      return;
    }

    // Normal mode (no discontinuity or branch depth filter): path + descendants
    var pathToRoot2 = this._getPathToRoot(segIdx);
    pathToRoot2.forEach(function(seg) { highlightedTokens.add(seg); });
    highlightedTokens.add(segIdx);

    // Add all descendants of ancestorBeforeRoot (entire subtree down to leaves)
    var descendants = self._getDescendants(ancestorBeforeRoot);
    descendants.forEach(function(seg) { highlightedTokens.add(seg); });

    // Check if we should roll this branch into root
    var ancestorNode = this.nodeBySeg.get(ancestorBeforeRoot);
    if (ancestorNode && isRootToken(ancestorNode.headSeg)) {
      var rootSeg = ancestorNode.headSeg;

      // Check if ancestorBeforeRoot is a leaf (singleton)
      var ancestorIsLeaf = true;
      for (var e = 0; e < this.edgeEls.length; e++) {
        if (this.edgeEls[e].headSeg === ancestorBeforeRoot) {
          ancestorIsLeaf = false;
          break;
        }
      }

      // Check if we should roll this branch into root
      var shouldRollIn = false;
      if (ancestorIsLeaf) {
        // Always roll in singletons if no clause groups in between
        shouldRollIn = true;
      } else if (self.rollNonAclMode) {
        // If Roll Non-ACL is enabled and this branch is not ACL, roll it in
        var ancestorDep = ancestorNode.dep ? ancestorNode.dep.toLowerCase() : "";
        if (ancestorDep !== "acl" && ancestorDep !== "acl:relcl") {
          shouldRollIn = true;
        }
      }

      if (shouldRollIn) {
        // Find all singleton children of root
        var rootChildren = [];
        for (var rc = 0; rc < this.edgeEls.length; rc++) {
          if (this.edgeEls[rc].headSeg === rootSeg) {
            rootChildren.push(this.edgeEls[rc].childSeg);
          }
        }

        var singletonChildren = [];
        for (var si = 0; si < rootChildren.length; si++) {
          var child = rootChildren[si];
          var hasChildren = false;
          for (var hc = 0; hc < this.edgeEls.length; hc++) {
            if (this.edgeEls[hc].headSeg === child) {
              hasChildren = true;
              break;
            }
          }
          if (!hasChildren) {
            singletonChildren.push(child);
          }
        }

        // Find other clause groups (non-singleton children of root with their subtrees)
        // If rollNonAclMode is enabled, only count ACL branches as clause groups
        var clauseGroupPositions = new Set();
        for (var cg = 0; cg < rootChildren.length; cg++) {
          var clauseChild = rootChildren[cg];
          var isClauseHead = false;
          for (var ch = 0; ch < this.edgeEls.length; ch++) {
            if (this.edgeEls[ch].headSeg === clauseChild) {
              isClauseHead = true;
              break;
            }
          }
          if (isClauseHead) {
            // Check if this should be considered a clause group
            var shouldCountAsClause = true;
            if (self.rollNonAclMode) {
              // Only count as clause if it's an ACL dependency
              var childNode = self.nodeBySeg.get(clauseChild);
              var dep = childNode && childNode.dep ? childNode.dep.toLowerCase() : "";
              shouldCountAsClause = (dep === "acl" || dep === "acl:relcl");
            }
            if (shouldCountAsClause) {
              // Add all positions in this clause group
              var clauseDescendants = self._getDescendants(clauseChild);
              clauseDescendants.forEach(function(pos) { clauseGroupPositions.add(pos); });
            }
          }
        }

        // Check if there's a clause group between ancestorBeforeRoot and root
        var minPos = Math.min(ancestorBeforeRoot, rootSeg);
        var maxPos = Math.max(ancestorBeforeRoot, rootSeg);
        var hasClauseInBetween = false;
        for (var pos = minPos + 1; pos < maxPos; pos++) {
          if (clauseGroupPositions.has(pos)) {
            hasClauseInBetween = true;
            break;
          }
        }

        // If no clause groups in between, roll in root + contiguous singletons + non-ACL branches
        if (!hasClauseInBetween) {
          highlightedTokens.add(rootSeg);

          // Floodfill contiguous singletons from root
          var toCheck = [rootSeg];
          var checked = new Set();
          checked.add(rootSeg);

          while (toCheck.length > 0) {
            var curr = toCheck.shift();
            var prev = curr - 1;
            var next = curr + 1;

            if (singletonChildren.indexOf(prev) !== -1 && !checked.has(prev)) {
              highlightedTokens.add(prev);
              checked.add(prev);
              toCheck.push(prev);
            }
            if (singletonChildren.indexOf(next) !== -1 && !checked.has(next)) {
              highlightedTokens.add(next);
              checked.add(next);
              toCheck.push(next);
            }
          }

          // If Roll Non-ACL mode is enabled, expand contiguously from root including non-ACL branches
          if (self.rollNonAclMode) {
            // Build map of branch head positions to their info
            var branchMap = new Map(); // position -> {dep: string, descendants: Set}
            for (var nac = 0; nac < rootChildren.length; nac++) {
              var branchHead = rootChildren[nac];

              // Check if this branch has children
              var branchHasChildren = false;
              for (var bhc = 0; bhc < this.edgeEls.length; bhc++) {
                if (this.edgeEls[bhc].headSeg === branchHead) {
                  branchHasChildren = true;
                  break;
                }
              }

              if (branchHasChildren) {
                var branchNode = self.nodeBySeg.get(branchHead);
                var branchDep = branchNode && branchNode.dep ? branchNode.dep.toLowerCase() : "";
                var branchDescendants = self._getDescendants(branchHead);
                branchMap.set(branchHead, {dep: branchDep, descendants: branchDescendants});
              }
            }

            // Expand leftward from root, stopping at first ACL VERB
            var pos = rootSeg - 1;
            while (pos >= 0) {
              if (branchMap.has(pos)) {
                var branch = branchMap.get(pos);
                var branchNode = self.nodeBySeg.get(pos);
                var branchPos = branchNode && branchNode.pos ? branchNode.pos.toUpperCase() : "";
                var isAclVerb = (branch.dep === "acl" || branch.dep === "acl:relcl") && branchPos === "VERB";
                if (isAclVerb) {
                  // Stop at ACL VERB
                  break;
                }
                // Add this non-ACL branch
                branch.descendants.forEach(function(seg) { highlightedTokens.add(seg); });
              }
              pos--;
            }

            // Expand rightward from root, stopping at first ACL VERB
            pos = rootSeg + 1;
            while (pos < self.nodeBySeg.size) {
              if (branchMap.has(pos)) {
                var branch = branchMap.get(pos);
                var branchNode = self.nodeBySeg.get(pos);
                var branchPos = branchNode && branchNode.pos ? branchNode.pos.toUpperCase() : "";
                var isAclVerb = (branch.dep === "acl" || branch.dep === "acl:relcl") && branchPos === "VERB";
                if (isAclVerb) {
                  // Stop at ACL VERB
                  break;
                }
                // Add this non-ACL branch
                branch.descendants.forEach(function(seg) { highlightedTokens.add(seg); });
              }
              pos++;
            }
          }
        }
      }
    }

    // Keep only tokens connected to the hovered token within the tree.
    var connected = new Set();
    var stack = [segIdx];
    while (stack.length) {
      var cur = stack.pop();
      if (connected.has(cur)) continue;
      connected.add(cur);
      var neigh = neighbors.get(cur) || [];
      for (var ni = 0; ni < neigh.length; ni++) {
        var nxt = neigh[ni];
        if (highlightedTokens.has(nxt) && !connected.has(nxt)) {
          stack.push(nxt);
        }
      }
    }
    highlightedTokens = connected;
    this._renderHighlightedTokens(highlightedTokens, segIdx);
  };

  DepTreeView.prototype._renderHighlightedTokens = function(highlightedTokens, segIdx) {
    var self = this;
    // Highlight nodes - each token uses its own POS color
    this.nodeEls.forEach(function(entry, seg) {
      var rect = entry.rect;
      var isChanged = self.debugMode && self.changedTokens && self.changedTokens.has(seg);
      var isHighlighted = highlightedTokens.has(seg);
      var isHovered = seg === segIdx;

      if (!isHighlighted) {
        // Not highlighted - dim it
        applyBaseStyle(rect, isChanged);
        return;
      }

      // Use this token's own POS color
      var tokenNode = self.nodeBySeg.get(seg);
      var tokenPos = tokenNode && tokenNode.pos ? tokenNode.pos : null;
      var isTokenRoot = false;
      if (tokenNode) {
        if (tokenNode.headSeg === tokenNode.segIndex) isTokenRoot = true;
        var depVal = (tokenNode.dep || '').toLowerCase();
        if (depVal === 'root') isTokenRoot = true;
      }
      if (isTokenRoot) {
        tokenPos = 'ROOT';
      }
      var tokenColor = getChunkColor(tokenPos || 'DEFAULT');

      var fillColor = tokenColor.fill;
      var strokeColor = tokenColor.stroke;
      var strokeWidth = isHovered ? "3.0" : "2.0";

      rect.setAttribute("fill", fillColor);
      rect.setAttribute("stroke", strokeColor);
      rect.setAttribute("stroke-width", strokeWidth);

      if (isChanged) {
        rect.setAttribute("stroke", "rgba(239,68,68,0.90)");
        rect.setAttribute("stroke-width", isHovered ? "3.0" : "2.6");
      }
    });

    // Highlight edges: show edges that connect highlighted tokens
    for (var j = 0; j < this.edgeEls.length; j++) {
      var edge = this.edgeEls[j];
      var isHighlightedEdge = highlightedTokens.has(edge.headSeg) && highlightedTokens.has(edge.childSeg);

      if (isHighlightedEdge) {
        // Edge color from child token
        var childNode = self.nodeBySeg.get(edge.childSeg);
        var childPos = childNode && childNode.pos ? childNode.pos : null;
        var isChildRoot = false;
        if (childNode) {
          if (childNode.headSeg === childNode.segIndex) isChildRoot = true;
          var depVal2 = (childNode.dep || '').toLowerCase();
          if (depVal2 === 'root') isChildRoot = true;
        }
        if (isChildRoot) {
          childPos = 'ROOT';
        }
        var edgeColor = getChunkColor(childPos || 'DEFAULT');
        edge.path.setAttribute("stroke", edgeColor.stroke);
        edge.path.setAttribute("stroke-width", "2.5");
      } else {
        edge.path.setAttribute("stroke", "rgba(17,24,39,0.12)");
        edge.path.setAttribute("stroke-width", "1.5");
      }
    }
  };

  DepTreeView.prototype._applyHighlight = function(segIdx) {
    if (!this.nodeBySeg.has(segIdx)) return;

    var self = this;

    if (this.contextWindowMode) {
      this._applyContextWindowHighlight(segIdx);
      return;
    }

    if (this.ancestorDepthMode) {
      this._applyAncestorDepthHighlight(segIdx);
      return;
    }

    // Clause-level members: use clause groups when enabled, otherwise union of chunks.
    var allChunkMembers = new Set();

    // Bottom-up chunk mode: use bottom-up chunks for highlighting
    if (this.bottomUpChunkMode && this.bottomUpChunks && this.bottomUpChunks.canonicalChunk) {
      var buChunk = this.bottomUpChunks.canonicalChunk[segIdx];
      if (buChunk && buChunk.members) {
        for (var bmi = 0; bmi < buChunk.members.length; bmi++) {
          allChunkMembers.add(buChunk.members[bmi]);
        }
      } else {
        allChunkMembers.add(segIdx);
      }
    } else {
      // Standard chunk logic
      var useClauseGroup = this.chunks && this.chunks.clauseGroup && this.settings.linearClauseSplit;
      if (useClauseGroup) {
        var targetGroup = this.chunks.clauseGroup[segIdx];
        if (targetGroup !== undefined && targetGroup !== 0) {
          for (var key in this.chunks.clauseGroup) {
            if (!Object.prototype.hasOwnProperty.call(this.chunks.clauseGroup, key)) continue;
            if (this.chunks.clauseGroup[key] === targetGroup) {
              allChunkMembers.add(parseInt(key, 10));
            }
          }
        } else {
          allChunkMembers.add(segIdx);
        }
      } else if (this.chunks && this.chunks.tokenToChunks && this.chunks.tokenToChunks[segIdx]) {
        var tokenChunks = this.chunks.tokenToChunks[segIdx];
        for (var ci = 0; ci < tokenChunks.length; ci++) {
          var chunk = tokenChunks[ci];
          var members = chunk.members || [];
          for (var mi = 0; mi < members.length; mi++) {
            allChunkMembers.add(members[mi]);
          }
          if (!chunk.isRootPhrase && Array.isArray(chunk.extraMembers)) {
            for (var emi = 0; emi < chunk.extraMembers.length; emi++) {
              allChunkMembers.add(chunk.extraMembers[emi]);
            }
          }
        }
      }
    }
    allChunkMembers.add(segIdx);

    // Build phrase groups for the whole clause (heads + contiguous leaf dependents).
    var roots = (this.data && this.data.udOverlay && Array.isArray(this.data.udOverlay.roots))
      ? this.data.udOverlay.roots
      : null;
    var headColorCache = new Map();
    function isRootSeg(seg) {
      var node = self.nodeBySeg.get(seg);
      if (!node) return false;
      if (node.headSeg === node.segIndex) return true;
      if (node.headSeg === -1 || node.headSeg === undefined) return true;
      if (!self.nodeBySeg.has(node.headSeg)) return true;
      var depVal = (node.dep || "").toLowerCase();
      if (depVal === "root") return true;
      if (roots && roots.indexOf(seg) !== -1) return true;
      return false;
    }
    function headColorFor(seg) {
      if (headColorCache.has(seg)) return headColorCache.get(seg);
      var node = self.nodeBySeg.get(seg);
      var pos = node && node.pos ? node.pos : null;
      if (isRootSeg(seg)) pos = "ROOT";
      var color = getChunkColor(pos || "DEFAULT");
      headColorCache.set(seg, color);
      return color;
    }
    function canStep(fromSeg, toSeg) {
      if (toSeg === fromSeg - 1) {
        return true;
      }
      if (toSeg === fromSeg + 1) {
        return true;
      }
      return false;
    }
    // Build child map within the hovered clause.
    var childMap = new Map();
    for (var em = 0; em < this.edgeEls.length; em++) {
      var edge = this.edgeEls[em];
      if (!allChunkMembers.has(edge.headSeg) || !allChunkMembers.has(edge.childSeg)) continue;
      if (!childMap.has(edge.headSeg)) childMap.set(edge.headSeg, []);
      childMap.get(edge.headSeg).push(edge.childSeg);
    }
    var hasChildren = new Set();
    childMap.forEach(function(_, headSeg) { hasChildren.add(headSeg); });
    var phraseForSeg = new Map(); // seg -> head seg (phrase owner)
    var headToLeafs = new Map();  // head seg -> Set(leaf segs)
    function getContiguousLeafs(headSeg, leafKids) {
      if (!leafKids.length) return [];
      var candidate = {};
      candidate[headSeg] = true;
      for (var i = 0; i < leafKids.length; i++) candidate[leafKids[i]] = true;
      var connected = {};
      var stack = [headSeg];
      while (stack.length) {
        var cur = stack.pop();
        if (connected[cur]) continue;
        connected[cur] = true;
        var prev = cur - 1;
        var next = cur + 1;
        if (candidate[prev] && !connected[prev] && canStep(cur, prev)) stack.push(prev);
        if (candidate[next] && !connected[next] && canStep(cur, next)) stack.push(next);
      }
      var out = [];
      for (var j = 0; j < leafKids.length; j++) {
        if (connected[leafKids[j]]) out.push(leafKids[j]);
      }
      return out;
    }
    childMap.forEach(function(kids, headSeg) {
      var leafKids = [];
      for (var i = 0; i < kids.length; i++) {
        var kid = kids[i];
        if (!hasChildren.has(kid)) leafKids.push(kid);
      }
      var contiguousLeafs = getContiguousLeafs(headSeg, leafKids);
      phraseForSeg.set(headSeg, headSeg);
      if (contiguousLeafs.length) {
        headToLeafs.set(headSeg, new Set(contiguousLeafs));
        for (var c = 0; c < contiguousLeafs.length; c++) {
          phraseForSeg.set(contiguousLeafs[c], headSeg);
        }
      }
    });
    // Singleton leaves: visible on their own when non-contiguous with their head.
    allChunkMembers.forEach(function(seg) {
      if (!phraseForSeg.has(seg) && !hasChildren.has(seg)) {
        phraseForSeg.set(seg, seg);
      }
    });
    // Find a single external clause link (rightward parent preferred).
    var externalClauseEdge = null;
    var externalClauseEdgeFallback = null;
    for (var ex = 0; ex < this.edgeEls.length; ex++) {
      var e = this.edgeEls[ex];
      if (!allChunkMembers.has(e.childSeg)) continue;
      if (allChunkMembers.has(e.headSeg)) continue;
      if (phraseForSeg.get(e.childSeg) !== e.childSeg) continue; // only clause heads
      if (e.headSeg > e.childSeg) {
        if (!externalClauseEdge || e.childSeg > externalClauseEdge.childSeg) {
          externalClauseEdge = e;
        }
      } else {
        if (!externalClauseEdgeFallback || e.childSeg > externalClauseEdgeFallback.childSeg) {
          externalClauseEdgeFallback = e;
        }
      }
    }
    if (!externalClauseEdge && externalClauseEdgeFallback) {
      externalClauseEdge = externalClauseEdgeFallback;
    }
    // Highlight nodes using CANONICAL colors (stable, never changes)
    this.nodeEls.forEach(function(entry, seg) {
      var rect = entry.rect;
      var isChanged = self.debugMode && self.changedTokens && self.changedTokens.has(seg);
      var isHovered = seg === segIdx;
      var isInClause = allChunkMembers.has(seg);

      if (!isInClause && !isHovered) {
        // Not in clause and not hovered - dim it
        applyBaseStyle(rect, isChanged);
        return;
      }

      // Get this token's CANONICAL color (stable, based on its finest-grained chunk)
      var node = self.nodeBySeg.get(seg);
      var pos = node && node.pos ? node.pos : null;
      var isRootToken = false;
      if (node) {
        if (node.headSeg === node.segIndex) isRootToken = true;
        var depVal = (node.dep || '').toLowerCase();
        if (depVal === 'root') isRootToken = true;
      }
      if (isRootToken) {
        pos = 'ROOT';
      }
      // Use token's own POS for border color (no chunk-based fallback)
      var color = getChunkColor(pos || 'DEFAULT');

      var fillColor, strokeColor, strokeWidth;

      fillColor = color.fill;
      strokeColor = color.stroke;
      strokeWidth = "1.6";
      if (isHovered) {
        strokeWidth = "3.0";
      }

      rect.setAttribute("fill", fillColor);
      rect.setAttribute("stroke", strokeColor);
      rect.setAttribute("stroke-width", strokeWidth);

      // Override with red if changed in debug mode
      if (isChanged) {
        rect.setAttribute("stroke", "rgba(239,68,68,0.90)");
        rect.setAttribute("stroke-width", isHovered ? "3.0" : "2.6");
      }
    });

    // Highlight edges: color comes from CHILD token (moving up to parent)
    for (var j = 0; j < this.edgeEls.length; j++) {
      var edge = this.edgeEls[j];
      var leafs = headToLeafs.get(edge.headSeg);
      if (leafs && leafs.has(edge.childSeg)) {
        // Edge color from child token
        var edgeColor = headColorFor(edge.childSeg);
        edge.path.setAttribute("stroke", edgeColor.stroke);
        edge.path.setAttribute("stroke-width", "3.0");
      } else if (externalClauseEdge && edge === externalClauseEdge) {
        var outColor = headColorFor(edge.childSeg);
        edge.path.setAttribute("stroke", outColor.stroke);
        edge.path.setAttribute("stroke-width", "2.1");
      } else if (allChunkMembers.has(edge.headSeg) && allChunkMembers.has(edge.childSeg)) {
        var cascadeColor = headColorFor(edge.childSeg);
        edge.path.setAttribute("stroke", cascadeColor.stroke);
        edge.path.setAttribute("stroke-width", "2.0");
      } else {
        edge.path.setAttribute("stroke", "rgba(17,24,39,0.12)");
        edge.path.setAttribute("stroke-width", "1.5");
      }
    }
  };

  DepTreeView.prototype.clearHighlights = function() {
    this.lastHoverSeg = null;
    var self = this;
    this.nodeEls.forEach(function(entry, seg) {
      var isChanged = self.debugMode && self.changedTokens && self.changedTokens.has(seg);
      applyBaseStyle(entry.rect, isChanged);
    });
    for (var i = 0; i < this.edgeEls.length; i++) {
      var edge = this.edgeEls[i];
      edge.path.setAttribute("stroke", "rgba(17,24,39,0.12)");
      edge.path.setAttribute("stroke-width", "1.5");
    }
  };

  DepTreeView.prototype.setVisible = function(isVisible) {
    if (!this.container) return;
    this.container.style.display = isVisible ? "block" : "none";
  };

  global.DepTreeView = new DepTreeView();
})(window);
