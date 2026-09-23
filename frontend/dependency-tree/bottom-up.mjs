import { DepTreeView } from './controller.mjs';
export function initializeBottomUp() {
  // Bottom-up chunking: works from lowest depth to root
  // At each depth level, tokens within threshold distance of their parent get rolled into parent's chunk
  DepTreeView.prototype._recomputeBottomUpChunks = function () {
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
        nerSpanRanges.push({
          start: spanStart,
          end: spanEnd
        });
      }
      if (nerSpanRanges.length) {
        // Compress NER-collapsed spans so distance counts them as one step.
        nerSpanRanges.sort(function (a, b) {
          if (a.start !== b.start) return a.start - b.start;
          return a.end - b.end;
        });
        var mergedSpans = [];
        for (var ms = 0; ms < nerSpanRanges.length; ms++) {
          var span = nerSpanRanges[ms];
          if (!mergedSpans.length || span.start >= mergedSpans[mergedSpans.length - 1].end) {
            mergedSpans.push({
              start: span.start,
              end: span.end
            });
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
      if (compressedPositions && typeof compressedPositions[t.i] === 'number') {
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
      members.sort(function (a, b) {
        return a - b;
      });
      var headTok = tokenMap[chunkHead];
      var chunk = {
        headIdx: parseInt(chunkHead, 10),
        headPos: headTok ? headTok.upos || 'DEFAULT' : 'DEFAULT',
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
  return true;
}
