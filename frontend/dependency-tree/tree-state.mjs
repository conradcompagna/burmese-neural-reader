import { DepTreeView } from './controller.mjs';
import { splitSentences } from './data.mjs';
import { dataState } from './data.state.mjs';
import { computeDepths } from './layout.mjs';
export function initializeTreeState() {
  DepTreeView.prototype._findWhitespaceBoundaries = function (segments, originalText) {
    if (typeof window !== 'undefined' && typeof window.computeWhitespaceBoundaries === 'function') {
      return window.computeWhitespaceBoundaries(segments, originalText);
    }
    return new Set();
  };
  DepTreeView.prototype._buildState = function (segments, udOverlay, originalText) {
    // Detect whitespace boundaries (Myanmar text "islands")
    var whitespaceBoundaries = this._findWhitespaceBoundaries(segments, originalText);
    this.whitespaceBoundaries = whitespaceBoundaries;
    var tokenMap = new Map();
    for (var i = 0; i < udOverlay.tokens.length; i++) {
      var t = udOverlay.tokens[i];
      tokenMap.set(t.i, t);
    }
    var spans =
      udOverlay && Array.isArray(udOverlay.sentences) && udOverlay.sentences.length
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
          token: segments[si] || tok.text || '',
          pos: tok.upos || '',
          dep: tok.dep || '',
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
        rows[r2].headIndex = hi === r2 || hi === -1 ? -1 : hi;
      }
      var children = new Array(rows.length);
      for (var c = 0; c < rows.length; c++) children[c] = [];
      for (var r3 = 0; r3 < rows.length; r3++) {
        if (rows[r3].headIndex !== -1) children[rows[r3].headIndex].push(r3);
      }
      var downDepth = dataState.computeDownDepth(children);
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
  DepTreeView.prototype._computeDefaultView = function () {
    if (!this.treeWorld) return null;
    var worldW = this.treeWorld.W;
    var maxSentH = this.treeWorld.maxSentH || this.treeWorld.H;

    // Fit to the largest sentence (not all sentences stacked)
    // Add 20% padding for comfortable viewing
    var paddingFactor = 0.2;
    var viewW = worldW * (1 + paddingFactor);
    var viewH = maxSentH * (1 + paddingFactor);

    // Center horizontally, start from top vertically
    var x = (-worldW * paddingFactor) / 2;
    var y = (-maxSentH * paddingFactor) / 2;
    return {
      x: x,
      y: y,
      w: viewW,
      h: viewH
    };
  };
  return true;
}
