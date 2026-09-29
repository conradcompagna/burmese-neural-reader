import { DepTreeView } from './controller.mjs';
export function initializeRootPath() {
  DepTreeView.prototype._applyPathToRootHighlight = function (segIdx) {
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
      if (node.dep && node.dep.toLowerCase() === 'root') return true;
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
        myChunk.forEach(function (token) {
          highlightedTokens.add(token);
        });
      }

      // In discontinuity mode, skip all the Roll Non-ACL logic below
      this._renderHighlightedTokens(highlightedTokens, segIdx);
      return;
    }
    if (this.branchDepthMode && branchDepthChunks.size > 0) {
      // In branch depth mode: highlight all tokens in the same chunk as the hovered token
      var myBranchChunk = branchDepthChunks.get(segIdx);
      if (myBranchChunk) {
        myBranchChunk.forEach(function (token) {
          highlightedTokens.add(token);
        });
      }

      // In branch depth mode, skip all the Roll Non-ACL logic below
      this._renderHighlightedTokens(highlightedTokens, segIdx);
      return;
    }

    // Normal mode (no discontinuity or branch depth filter): path + descendants
    var pathToRoot2 = this._getPathToRoot(segIdx);
    pathToRoot2.forEach(function (seg) {
      highlightedTokens.add(seg);
    });
    highlightedTokens.add(segIdx);

    // Add all descendants of ancestorBeforeRoot (entire subtree down to leaves)
    var descendants = self._getDescendants(ancestorBeforeRoot);
    descendants.forEach(function (seg) {
      highlightedTokens.add(seg);
    });

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
        var ancestorDep = ancestorNode.dep ? ancestorNode.dep.toLowerCase() : '';
        if (ancestorDep !== 'acl' && ancestorDep !== 'acl:relcl') {
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
              var dep = childNode && childNode.dep ? childNode.dep.toLowerCase() : '';
              shouldCountAsClause = dep === 'acl' || dep === 'acl:relcl';
            }
            if (shouldCountAsClause) {
              // Add all positions in this clause group
              var clauseDescendants = self._getDescendants(clauseChild);
              clauseDescendants.forEach(function (pos) {
                clauseGroupPositions.add(pos);
              });
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
                var branchDep = branchNode && branchNode.dep ? branchNode.dep.toLowerCase() : '';
                var branchDescendants = self._getDescendants(branchHead);
                branchMap.set(branchHead, {
                  dep: branchDep,
                  descendants: branchDescendants
                });
              }
            }

            // Expand leftward from root, stopping at first ACL VERB
            var pos = rootSeg - 1;
            while (pos >= 0) {
              if (branchMap.has(pos)) {
                var branch = branchMap.get(pos);
                var branchNode = self.nodeBySeg.get(pos);
                var branchPos = branchNode && branchNode.pos ? branchNode.pos.toUpperCase() : '';
                var isAclVerb = (branch.dep === 'acl' || branch.dep === 'acl:relcl') && branchPos === 'VERB';
                if (isAclVerb) {
                  // Stop at ACL VERB
                  break;
                }
                // Add this non-ACL branch
                branch.descendants.forEach(function (seg) {
                  highlightedTokens.add(seg);
                });
              }
              pos--;
            }

            // Expand rightward from root, stopping at first ACL VERB
            pos = rootSeg + 1;
            while (pos < self.nodeBySeg.size) {
              if (branchMap.has(pos)) {
                var branch = branchMap.get(pos);
                var branchNode = self.nodeBySeg.get(pos);
                var branchPos = branchNode && branchNode.pos ? branchNode.pos.toUpperCase() : '';
                var isAclVerb = (branch.dep === 'acl' || branch.dep === 'acl:relcl') && branchPos === 'VERB';
                if (isAclVerb) {
                  // Stop at ACL VERB
                  break;
                }
                // Add this non-ACL branch
                branch.descendants.forEach(function (seg) {
                  highlightedTokens.add(seg);
                });
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
  return true;
}
