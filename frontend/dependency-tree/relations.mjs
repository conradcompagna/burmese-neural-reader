import { DepTreeView } from './controller.mjs';
export function initializeRelations() {
  // Get tokens within N hops using BFS over dependency edges
  DepTreeView.prototype._getTokensWithinDistance = function (segIdx, maxDist) {
    if (maxDist <= 0)
      return {
        nodes: new Set(),
        edges: []
      };

    // Build adjacency from edgeEls (each edge has headSeg and childSeg)
    var adj = new Map();
    for (var i = 0; i < this.edgeEls.length; i++) {
      var e = this.edgeEls[i];
      if (!adj.has(e.headSeg)) adj.set(e.headSeg, []);
      if (!adj.has(e.childSeg)) adj.set(e.childSeg, []);
      adj.get(e.headSeg).push({
        seg: e.childSeg,
        edge: e,
        isParent: true
      });
      adj.get(e.childSeg).push({
        seg: e.headSeg,
        edge: e,
        isParent: false
      });
    }

    // BFS to find all nodes within maxDist
    var depth = new Map();
    var queue = [
      {
        node: segIdx,
        dist: 0
      }
    ];
    depth.set(segIdx, 0);
    while (queue.length) {
      var cur = queue.shift();
      if (cur.dist >= maxDist) continue;
      var neighbors = adj.get(cur.node) || [];
      for (var j = 0; j < neighbors.length; j++) {
        var neighbor = neighbors[j];
        if (!depth.has(neighbor.seg)) {
          depth.set(neighbor.seg, cur.dist + 1);
          queue.push({
            node: neighbor.seg,
            dist: cur.dist + 1
          });
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
    return {
      nodes: depth,
      edges: relatedEdges
    };
  };
  DepTreeView.prototype._getPathToRoot = function (segIdx) {
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
      if (!isRoot && node.dep && node.dep.toLowerCase() === 'root') {
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
  DepTreeView.prototype._getDescendants = function (segIdx) {
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
  return true;
}
