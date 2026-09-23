import { DepTreeView } from './controller.mjs';
export function initializeBranchDepth() {
  DepTreeView.prototype._computeDiscontinuityChunks = function () {
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
    this.nodeBySeg.forEach(function (node, segIdx) {
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
        if (!isRoot && currentNode.dep && currentNode.dep.toLowerCase() === 'root') {
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
    tokenToChunkRoot.forEach(function (chunkRoot, token) {
      if (!chunkRootToTokens.has(chunkRoot)) {
        chunkRootToTokens.set(chunkRoot, new Set());
      }
      chunkRootToTokens.get(chunkRoot).add(token);
    });

    // Step 3: For each token, store the full set of tokens in its chunk
    tokenToChunkRoot.forEach(function (chunkRoot, token) {
      var tokensInChunk = chunkRootToTokens.get(chunkRoot);
      tokenToChunk.set(token, tokensInChunk);
    });
    return tokenToChunk;
  };
  DepTreeView.prototype._computeBranchDepthChunks = function () {
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
      var stack = [
        {
          seg: rootSeg,
          depth: 0
        }
      ];
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
            stack.push({
              seg: self.edgeEls[c].childSeg,
              depth: depth + 1
            });
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
          descendants.forEach(function (d) {
            targetChunks.get(child).add(d);
          });
          // Recursively chunk this branch's children
          chunkFromRoot(child, targetChunks);
        } else {
          // Shallow branch stays with root
          var descendants = self._getDescendants(child);
          if (!targetChunks.has(rootSeg)) {
            targetChunks.set(rootSeg, new Set());
          }
          descendants.forEach(function (d) {
            targetChunks.get(rootSeg).add(d);
          });
        }
      }
    }

    // Find actual root(s)
    var roots = [];
    this.nodeBySeg.forEach(function (node, seg) {
      var isRoot = node.headSeg === node.segIndex;
      if (!isRoot && node.dep && node.dep.toLowerCase() === 'root') {
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
    chunkRootToTokens.forEach(function (tokenSet) {
      tokenSet.forEach(function (token) {
        tokenToChunk.set(token, tokenSet);
      });
    });
    return tokenToChunk;
  };
  return true;
}
