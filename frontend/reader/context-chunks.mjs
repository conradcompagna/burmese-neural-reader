import { chunkHighlightingState } from './chunk-highlighting.state.mjs';
import { contextChunksState } from './context-chunks.state.mjs';
import { dependencyState } from './dependency-state.state.mjs';
import { getSentenceSpansFromSegments } from './island-groups.mjs';
import { readerState } from './reader-state.state.mjs';
import { settingsState } from './settings-state.state.mjs';
export // Helper: get the canonical segment index (first segment if part of collapsed NER span)
function getCanonicalSegIdx(segIdx) {
  var info = dependencyState.latestCollapsedSpanInfo[segIdx];
  return info ? info.firstSeg : segIdx;
}

// Helper: expand a set of segment indices to include all segments in any collapsed spans
export function expandHighlightSetForCollapsedSpans(segSet) {
  var expanded = new Set(segSet);
  segSet.forEach(function (segIdx) {
    var info = dependencyState.latestCollapsedSpanInfo[segIdx];
    if (info && info.udTok && info.udTok.seg_span) {
      info.udTok.seg_span.forEach(function (si) {
        expanded.add(si);
      });
    }
  });
  return expanded;
}
export function getUdLineHighlightSet(segIdx) {
  // Use canonical segment index for lookup (first segment if part of collapsed span)
  var canonicalIdx = getCanonicalSegIdx(segIdx);
  var base =
    chunkHighlightingState.currentChunkHighlightTokens &&
    chunkHighlightingState.currentChunkHighlightTokens.has(canonicalIdx)
      ? new Set(chunkHighlightingState.currentChunkHighlightTokens)
      : new Set([canonicalIdx]);
  // Expand to include all segments in collapsed spans
  return expandHighlightSetForCollapsedSpans(base);
}

// Context Window algorithm - computes tokens to highlight based on tree-contiguous spans
// Highlight the dependency context around the selected token.
export function computeContextWindowTokens(segIdx) {
  // Use canonical segment index (first segment if part of collapsed NER span)
  var canonicalIdx = getCanonicalSegIdx(segIdx);
  if (!dependencyState.latestUdOverlay || !dependencyState.latestUdOverlay.ok)
    return expandHighlightSetForCollapsedSpans(new Set([canonicalIdx]));
  var count = parseInt(settingsState.displaySettings.contextWindowSize, 10);
  if (!isFinite(count) || count < 1) count = 1;
  var tokens = dependencyState.latestUdOverlay.tokens || [];
  var edges = dependencyState.latestUdOverlay.edges || [];
  function normalizeSentences(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    for (var i = 0; i < raw.length; i++) {
      var s = raw[i];
      if (Array.isArray(s) && s.length >= 2 && isFinite(s[0]) && isFinite(s[1])) {
        out.push([s[0], s[1]]);
        continue;
      }
      if (s && typeof s === 'object') {
        var start =
          typeof s.seg_start === 'number' ? s.seg_start : typeof s.start === 'number' ? s.start : null;
        var end = typeof s.seg_end === 'number' ? s.seg_end : typeof s.end === 'number' ? s.end : null;
        if (start !== null && end !== null) {
          out.push([start, end]);
        }
      }
    }
    return out;
  }
  var sentences = normalizeSentences(dependencyState.latestUdOverlay.sentences || []);
  if (!sentences.length) {
    if (Array.isArray(readerState.latestSegments) && readerState.latestSegments.length) {
      var fallbackSpans = getSentenceSpansFromSegments(readerState.latestSegments);
      for (var fs = 0; fs < fallbackSpans.length; fs++) {
        sentences.push([fallbackSpans[fs].start, fallbackSpans[fs].end]);
      }
    } else if (tokens.length) {
      var maxSeg = -1;
      for (var tm = 0; tm < tokens.length; tm++) {
        var ti = tokens[tm] && typeof tokens[tm].i === 'number' ? tokens[tm].i : -1;
        if (ti > maxSeg) maxSeg = ti;
      }
      if (maxSeg >= 0) sentences.push([0, maxSeg + 1]);
    }
  }

  // Find which sentence this token belongs to
  var sentenceIdx = null;
  for (var si = 0; si < sentences.length; si++) {
    var sentSpan = sentences[si];
    if (canonicalIdx >= sentSpan[0] && canonicalIdx < sentSpan[1]) {
      sentenceIdx = si;
      break;
    }
  }
  if (sentenceIdx === null) return expandHighlightSetForCollapsedSpans(new Set([canonicalIdx]));

  // 1. Get all tokens in sentence, sorted by position
  var sentSpan = sentences[sentenceIdx];
  var nodesInSentence = [];
  for (var ti2 = 0; ti2 < tokens.length; ti2++) {
    var tok = tokens[ti2];
    if (!tok || typeof tok.i !== 'number') continue;
    if (tok.i >= sentSpan[0] && tok.i < sentSpan[1]) {
      nodesInSentence.push(tok.i);
    }
  }
  if (!nodesInSentence.length) return expandHighlightSetForCollapsedSpans(new Set([canonicalIdx]));
  nodesInSentence.sort(function (a, b) {
    return a - b;
  });
  var centerPos = nodesInSentence.indexOf(canonicalIdx);
  if (centerPos === -1) return expandHighlightSetForCollapsedSpans(new Set([canonicalIdx]));

  // Position lookup
  var posBySeg = {};
  for (var pi = 0; pi < nodesInSentence.length; pi++) {
    posBySeg[nodesInSentence[pi]] = pi;
  }

  // 2. Build tree adjacency map (bidirectional)
  var treeAdj = new Map();
  for (var ei = 0; ei < edges.length; ei++) {
    var edge = edges[ei];
    var head = edge.from;
    var child = edge.to;
    // Only include edges within this sentence
    if (posBySeg[head] === undefined || posBySeg[child] === undefined) continue;
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
  while (right - left + 1 < targetCandidates) {
    var expandedAny = false;
    if (left > 0) {
      left--;
      expandedAny = true;
    }
    if (right - left + 1 < targetCandidates && right < nodesInSentence.length - 1) {
      right++;
      expandedAny = true;
    }
    if (!expandedAny) break;
  }
  var candidates = nodesInSentence.slice(left, right + 1);
  var hoverIdxInCandidates = candidates.indexOf(canonicalIdx);

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
        neighbors.forEach(function (n) {
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
  // Priorities: 1) larger size, 2) more centered on hover, 3) slight rightward bias
  var bestSpan = [canonicalIdx];
  var bestSize = 1;
  var bestImbalance = 0;
  var bestRight = hoverIdxInCandidates;
  for (var L = 0; L <= hoverIdxInCandidates; L++) {
    for (var R = hoverIdxInCandidates; R < candidates.length; R++) {
      var spanSize = R - L + 1;
      if (spanSize > count) break;
      if (spanSize < bestSize) continue;
      var leftExtent = hoverIdxInCandidates - L;
      var rightExtent = R - hoverIdxInCandidates;
      var imbalance = Math.abs(leftExtent - rightExtent);
      var dominated = false;
      if (spanSize === bestSize) {
        if (imbalance > bestImbalance) {
          dominated = true;
        } else if (imbalance === bestImbalance && R <= bestRight) {
          dominated = true;
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

  // 6. Expand for whitespace islands (if latestData has island_spans)
  if (readerState.latestData && Array.isArray(readerState.latestData.island_spans)) {
    var islands = readerState.latestData.island_spans;
    var islandBySeg = {};
    for (var ii = 0; ii < islands.length; ii++) {
      var island = islands[ii];
      for (var ij = island[0]; ij < island[1]; ij++) {
        islandBySeg[ij] = island;
      }
    }
    var toAdd = [];
    highlightedTokens.forEach(function (seg) {
      var island = islandBySeg[seg];
      if (island) {
        for (var ik = island[0]; ik < island[1]; ik++) {
          toAdd.push(ik);
        }
      }
    });
    for (var ti = 0; ti < toAdd.length; ti++) {
      highlightedTokens.add(toAdd[ti]);
    }
  }

  // 7. Roll in contiguous singleton leaf children
  var hasChild = {};
  for (var e = 0; e < edges.length; e++) {
    var edge2 = edges[e];
    if (posBySeg[edge2.from] !== undefined) {
      hasChild[edge2.from] = true;
    }
  }
  function isContiguousToHighlighted(seg) {
    var pos = posBySeg[seg];
    if (pos === undefined) return false;
    var leftN = pos > 0 ? nodesInSentence[pos - 1] : null;
    var rightN = pos < nodesInSentence.length - 1 ? nodesInSentence[pos + 1] : null;
    return (
      (leftN !== null && highlightedTokens.has(leftN)) || (rightN !== null && highlightedTokens.has(rightN))
    );
  }
  var added = true;
  while (added) {
    added = false;
    for (var le = 0; le < edges.length; le++) {
      var leafEdge = edges[le];
      var head3 = leafEdge.from;
      var child3 = leafEdge.to;
      if (!highlightedTokens.has(head3) || highlightedTokens.has(child3)) continue;
      if (hasChild[child3]) continue;
      if (posBySeg[child3] === undefined) continue;
      if (isContiguousToHighlighted(child3)) {
        highlightedTokens.add(child3);
        added = true;
      }
    }
  }

  // 8. Final validation: ensure tree-contiguous (BFS from hover, keep only reachable)
  var connected = new Set();
  var stack = [canonicalIdx];
  while (stack.length) {
    var cur = stack.pop();
    if (connected.has(cur)) continue;
    connected.add(cur);
    var neighbors = treeAdj.get(cur);
    if (neighbors) {
      neighbors.forEach(function (n) {
        if (highlightedTokens.has(n) && !connected.has(n)) {
          stack.push(n);
        }
      });
    }
  }

  // 9. Ensure positionally contiguous (find largest contiguous run containing hover)
  var connectedArray = Array.from(connected).sort(function (a, b) {
    return a - b;
  });
  if (connectedArray.length > 1) {
    var connectedSet = new Set(connectedArray);
    var hoverAllPos = posBySeg[canonicalIdx];
    var runLeft = hoverAllPos;
    var runRight = hoverAllPos;
    while (runLeft > 0 && connectedSet.has(nodesInSentence[runLeft - 1])) runLeft--;
    while (runRight < nodesInSentence.length - 1 && connectedSet.has(nodesInSentence[runRight + 1]))
      runRight++;
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

  // Expand result to include all segments in collapsed NER spans
  return expandHighlightSetForCollapsedSpans(highlightedTokens);
}

// Cache for context window tokens to ensure sync between highlighting and lines
export function getContextWindowTokens(segIdx) {
  // Return cached result if we already computed for this segIdx
  var canonicalIdx = getCanonicalSegIdx(segIdx);
  if (
    contextChunksState.cachedContextWindowSegIdx === canonicalIdx &&
    contextChunksState.cachedContextWindowTokens !== null
  ) {
    return contextChunksState.cachedContextWindowTokens;
  }
  contextChunksState.cachedContextWindowTokens = computeContextWindowTokens(canonicalIdx);
  contextChunksState.cachedContextWindowSegIdx = canonicalIdx;
  return contextChunksState.cachedContextWindowTokens;
}
export function clearContextWindowCache() {
  contextChunksState.cachedContextWindowTokens = null;
  contextChunksState.cachedContextWindowSegIdx = -1;
}

// Bottom-Up Chunk algorithm - computes tokens by working from lowest depth up to root
// Tokens within threshold distance of their parent get merged into parent's chunk
export function computeBottomUpChunkTokens(segIdx) {
  var canonicalIdx = getCanonicalSegIdx(segIdx);
  if (!dependencyState.latestUdOverlay || !dependencyState.latestUdOverlay.ok)
    return expandHighlightSetForCollapsedSpans(new Set([canonicalIdx]));
  var threshold = parseInt(settingsState.displaySettings.bottomUpChunkThreshold, 10);
  if (!isFinite(threshold) || threshold < 1) threshold = 5;
  if (threshold > 10) threshold = 10;
  var struct = dependencyState.latestUdStructure;
  if (!struct || !struct.tokenMap) return expandHighlightSetForCollapsedSpans(new Set([canonicalIdx]));
  var tokenMap = struct.tokenMap;
  var children = struct.children;
  var parentOf = struct.parentOf;
  var tokenPosition = struct.tokenPosition;
  var tokenDepths = struct.tokenDepths || {};
  var maxDepth = struct.maxDepth || 0;
  var tokenIds = struct.tokenIds || [];
  if (!tokenIds.length || tokenMap[canonicalIdx] === undefined) {
    return expandHighlightSetForCollapsedSpans(new Set([canonicalIdx]));
  }

  // Initialize: each token starts in its own chunk
  // chunkOf[seg] = chunk head segment index
  var chunkOf = {};
  for (var sIdx = 0; sIdx < tokenIds.length; sIdx++) {
    var s = tokenIds[sIdx];
    chunkOf[s] = s;
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
    for (var tIdx = 0; tIdx < tokenIds.length; tIdx++) {
      var tokenSeg = tokenIds[tIdx];
      if (tokenDepths[tokenSeg] !== d) continue;
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

  // Find all tokens in the same chunk as segIdx
  var targetChunkHead = getChunkHead(canonicalIdx);
  var highlightedTokens = new Set();
  for (var hIdx = 0; hIdx < tokenIds.length; hIdx++) {
    var s4 = tokenIds[hIdx];
    if (getChunkHead(s4) === targetChunkHead) {
      highlightedTokens.add(s4);
    }
  }
  return expandHighlightSetForCollapsedSpans(highlightedTokens);
}

// Cache for bottom-up chunk tokens
export function getBottomUpChunkTokens(segIdx) {
  var canonicalIdx = getCanonicalSegIdx(segIdx);
  if (
    contextChunksState.cachedBottomUpChunkSegIdx === canonicalIdx &&
    contextChunksState.cachedBottomUpChunkTokens !== null
  ) {
    return contextChunksState.cachedBottomUpChunkTokens;
  }
  contextChunksState.cachedBottomUpChunkTokens = computeBottomUpChunkTokens(canonicalIdx);
  contextChunksState.cachedBottomUpChunkSegIdx = canonicalIdx;
  return contextChunksState.cachedBottomUpChunkTokens;
}
export function clearBottomUpChunkCache() {
  contextChunksState.cachedBottomUpChunkTokens = null;
  contextChunksState.cachedBottomUpChunkSegIdx = -1;
}

// Draw UD lines for bottom-up chunk - reuses the context window rendering logic
export function initializeContextChunks() {
  contextChunksState.cachedContextWindowTokens = null;
  contextChunksState.cachedContextWindowSegIdx = -1;
  contextChunksState.cachedBottomUpChunkTokens = null;
  contextChunksState.cachedBottomUpChunkSegIdx = -1;
  return true;
}
