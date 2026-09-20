(function(global) {
  "use strict";

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

  function computeDownDepth(children) {
    var n = children.length;
    var depth = new Array(n).fill(0);
    var visiting = new Array(n).fill(0);

    function dfs(v) {
      if (visiting[v] === 2) return depth[v];
      if (visiting[v] === 1) return depth[v];
      visiting[v] = 1;
      var best = 0;
      for (var i = 0; i < children[v].length; i++) {
        var c = children[v][i];
        var d = dfs(c);
        if (d + 1 > best) best = d + 1;
      }
      depth[v] = best;
      visiting[v] = 2;
      return best;
    }

    for (var i = 0; i < n; i++) dfs(i);
    return depth;
  }

  function canCrossGap(a, b, rows, downDepth, invisDepth, whitespaceBoundaries, onSkip) {
    var lo = Math.min(a, b);
    var hi = Math.max(a, b);
    if (hi - lo <= 1) return true;
    // Convert boundaries array to Set if needed
    var boundarySet = whitespaceBoundaries;
    if (Array.isArray(whitespaceBoundaries)) {
      boundarySet = new Set(whitespaceBoundaries);
    }
    for (var k = lo + 1; k <= hi - 1; k++) {
      if (downDepth[k] <= invisDepth) continue;
      if (!rows || !boundarySet || typeof boundarySet.has !== "function") {
        return false;
      }
      var segIdx = rows[k].segIndex;
      if (!boundarySet.has(segIdx)) {
        if (typeof onSkip === "function") {
          onSkip(k, downDepth[k], segIdx);
        }
        continue; // Skip boundary markers inside a whitespace island.
      }
      return false;
    }
    return true;
  }

  function constrainedComponent(start, rows, children, downDepth, invisDepth, whitespaceBoundaries, onSkip) {
    var seen = {};
    seen[start] = true;
    var stack = [start];
    while (stack.length) {
      var v = stack.pop();
      var h = rows[v].headIndex;
      if (h !== -1 && canCrossGap(v, h, rows, downDepth, invisDepth, whitespaceBoundaries, onSkip) && !seen[h]) {
        seen[h] = true;
        stack.push(h);
      }
      var kids = children[v];
      for (var i = 0; i < kids.length; i++) {
        var c = kids[i];
        if (!canCrossGap(v, c, rows, downDepth, invisDepth, whitespaceBoundaries, onSkip)) continue;
        if (seen[c]) continue;
        seen[c] = true;
        stack.push(c);
      }
    }
    var out = Object.keys(seen).map(function(v) { return parseInt(v, 10); });
    out.sort(function(a, b) { return a - b; });
    return out;
  }

  function buildSentenceState(segments, tokens) {
    var tokenMap = new Map();
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (!t || typeof t.i !== "number") continue;
      tokenMap.set(t.i, t);
    }
    var spans = splitSentences(segments);
    var sentences = [];
    var sentenceIndex = 0;
    for (var s = 0; s < spans.length; s++) {
      var span = spans[s];
      var rows = [];
      for (var si = span[0]; si < span[1]; si++) {
        if (!tokenMap.has(si)) continue;
        var tok = tokenMap.get(si);
        rows.push({
          segIndex: si,
          token: (segments[si] || (tok && tok.text) || ""),
          headSeg: tok.head,
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
      sentences.push({
        rows: rows,
        children: children,
        downDepth: downDepth,
        sentenceIdx: sentenceIndex
      });
      sentenceIndex += 1;
    }
    return sentences;
  }

  function computeSkipLog(payload) {
    var segments = Array.isArray(payload && payload.segments) ? payload.segments : [];
    var tokens = Array.isArray(payload && payload.tokens) ? payload.tokens : [];
    var boundaries = payload && payload.boundaries;
    var boundarySet = new Set(Array.isArray(boundaries) ? boundaries : []);
    var phraseInvis = payload && payload.phraseInvisDepth !== undefined ? parseInt(payload.phraseInvisDepth, 10) : 0;
    var clauseInvis = payload && payload.clauseInvisDepth !== undefined ? parseInt(payload.clauseInvisDepth, 10) : 3;
    if (!isFinite(phraseInvis)) phraseInvis = 0;
    if (!isFinite(clauseInvis)) clauseInvis = 3;

    var sentences = buildSentenceState(segments, tokens);
    var logs = [];
    var seen = new Set();

    function record(rule, sentenceIdx, rows, rowIndex, depthVal, invisDepth) {
      if (!rows[rowIndex]) return;
      var segIdx = rows[rowIndex].segIndex;
      if (segIdx === undefined || segIdx === null) return;
      var key = rule + ":" + segIdx + ":" + invisDepth + ":" + sentenceIdx;
      if (seen.has(key)) return;
      seen.add(key);
      logs.push({
        token_idx: segIdx,
        token: String(segments[segIdx] || rows[rowIndex].token || ""),
        rule: rule,
        down_depth: depthVal,
        invis_depth: invisDepth,
        sentence: sentenceIdx
      });
    }

    function makeLogger(rule, sentenceIdx, rows, invisDepth) {
      return function(rowIndex, depthVal) {
        record(rule, sentenceIdx, rows, rowIndex, depthVal, invisDepth);
      };
    }

    for (var s = 0; s < sentences.length; s++) {
      var sent = sentences[s];
      var rows = sent.rows;
      var children = sent.children;
      var downDepth = sent.downDepth;
      if (!rows || !rows.length) continue;
      var sentIdx = sent.sentenceIdx != null ? sent.sentenceIdx : s;
      var phraseLogger = makeLogger("phrase", sentIdx, rows, phraseInvis);
      var clauseLogger = makeLogger("clause", sentIdx, rows, clauseInvis);
      for (var r = 0; r < rows.length; r++) {
        var head = rows[r].headIndex;
        if (head !== -1) {
          canCrossGap(r, head, rows, downDepth, phraseInvis, boundarySet, phraseLogger);
          canCrossGap(r, head, rows, downDepth, clauseInvis, boundarySet, clauseLogger);
        }
        var kids = children[r] || [];
        for (var k = 0; k < kids.length; k++) {
          var child = kids[k];
          canCrossGap(r, child, rows, downDepth, phraseInvis, boundarySet, phraseLogger);
          canCrossGap(r, child, rows, downDepth, clauseInvis, boundarySet, clauseLogger);
        }
      }
    }
    return logs;
  }

  var api = {
    splitSentences: splitSentences,
    computeDownDepth: computeDownDepth,
    canCrossGap: canCrossGap,
    constrainedComponent: constrainedComponent,
    buildSentenceState: buildSentenceState,
    computeSkipLog: computeSkipLog
  };

  global.ChunkGapLogic = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
