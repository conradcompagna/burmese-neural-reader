import { DepTreeView } from './controller.mjs';
export function initializeContextWindow() {
  DepTreeView.prototype._applyAncestorDepthHighlight = function (segIdx) {
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
  DepTreeView.prototype._applyContextWindowHighlight = function (segIdx) {
    if (!this.nodeBySeg.has(segIdx)) return;
    var count = parseInt(this.contextWindowValue, 10);
    if (!isFinite(count) || count < 1) count = 1;
    var baseNode = this.nodeBySeg.get(segIdx);
    var sentenceIdx = baseNode ? baseNode.sentenceIdx : null;
    if (sentenceIdx === null || sentenceIdx === undefined) return;

    // 1. Get all tokens in sentence, sorted by position
    var nodesInSentence = [];
    this.nodeBySeg.forEach(function (node, seg) {
      if (node && node.sentenceIdx === sentenceIdx) nodesInSentence.push(seg);
    });
    if (!nodesInSentence.length) return;
    nodesInSentence.sort(function (a, b) {
      return a - b;
    });
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
      highlightedTokens.forEach(function (seg) {
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
      return (
        (leftN !== null && highlightedTokens.has(leftN)) || (rightN !== null && highlightedTokens.has(rightN))
      );
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
      var hoverAllPos = posBySeg[segIdx];

      // Find contiguous run containing hover
      var runLeft = hoverAllPos;
      var runRight = hoverAllPos;
      while (runLeft > 0 && connectedSet.has(nodesInSentence[runLeft - 1])) runLeft--;
      while (runRight < nodesInSentence.length - 1 && connectedSet.has(nodesInSentence[runRight + 1]))
        runRight++;

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
  return true;
}
