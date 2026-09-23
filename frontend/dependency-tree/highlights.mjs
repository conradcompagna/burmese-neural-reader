import { DepTreeView } from './controller.mjs';
import { getChunkColor } from './data.mjs';
import { applyBaseStyle } from './layout.mjs';
export function initializeHighlights() {
  DepTreeView.prototype._renderHighlightedTokens = function (highlightedTokens, segIdx) {
    var self = this;
    // Highlight nodes - each token uses its own POS color
    this.nodeEls.forEach(function (entry, seg) {
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
      var strokeWidth = isHovered ? '3.0' : '2.0';
      rect.setAttribute('fill', fillColor);
      rect.setAttribute('stroke', strokeColor);
      rect.setAttribute('stroke-width', strokeWidth);
      if (isChanged) {
        rect.setAttribute('stroke', 'rgba(239,68,68,0.90)');
        rect.setAttribute('stroke-width', isHovered ? '3.0' : '2.6');
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
        edge.path.setAttribute('stroke', edgeColor.stroke);
        edge.path.setAttribute('stroke-width', '2.5');
      } else {
        edge.path.setAttribute('stroke', 'rgba(17,24,39,0.12)');
        edge.path.setAttribute('stroke-width', '1.5');
      }
    }
  };
  DepTreeView.prototype._applyHighlight = function (segIdx) {
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
    var roots =
      this.data && this.data.udOverlay && Array.isArray(this.data.udOverlay.roots)
        ? this.data.udOverlay.roots
        : null;
    var headColorCache = new Map();
    function isRootSeg(seg) {
      var node = self.nodeBySeg.get(seg);
      if (!node) return false;
      if (node.headSeg === node.segIndex) return true;
      if (node.headSeg === -1 || node.headSeg === undefined) return true;
      if (!self.nodeBySeg.has(node.headSeg)) return true;
      var depVal = (node.dep || '').toLowerCase();
      if (depVal === 'root') return true;
      if (roots && roots.indexOf(seg) !== -1) return true;
      return false;
    }
    function headColorFor(seg) {
      if (headColorCache.has(seg)) return headColorCache.get(seg);
      var node = self.nodeBySeg.get(seg);
      var pos = node && node.pos ? node.pos : null;
      if (isRootSeg(seg)) pos = 'ROOT';
      var color = getChunkColor(pos || 'DEFAULT');
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
    childMap.forEach(function (_, headSeg) {
      hasChildren.add(headSeg);
    });
    var phraseForSeg = new Map(); // seg -> head seg (phrase owner)
    var headToLeafs = new Map(); // head seg -> Set(leaf segs)
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
    childMap.forEach(function (kids, headSeg) {
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
    allChunkMembers.forEach(function (seg) {
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
    this.nodeEls.forEach(function (entry, seg) {
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
      strokeWidth = '1.6';
      if (isHovered) {
        strokeWidth = '3.0';
      }
      rect.setAttribute('fill', fillColor);
      rect.setAttribute('stroke', strokeColor);
      rect.setAttribute('stroke-width', strokeWidth);

      // Override with red if changed in debug mode
      if (isChanged) {
        rect.setAttribute('stroke', 'rgba(239,68,68,0.90)');
        rect.setAttribute('stroke-width', isHovered ? '3.0' : '2.6');
      }
    });

    // Highlight edges: color comes from CHILD token (moving up to parent)
    for (var j = 0; j < this.edgeEls.length; j++) {
      var edge = this.edgeEls[j];
      var leafs = headToLeafs.get(edge.headSeg);
      if (leafs && leafs.has(edge.childSeg)) {
        // Edge color from child token
        var edgeColor = headColorFor(edge.childSeg);
        edge.path.setAttribute('stroke', edgeColor.stroke);
        edge.path.setAttribute('stroke-width', '3.0');
      } else if (externalClauseEdge && edge === externalClauseEdge) {
        var outColor = headColorFor(edge.childSeg);
        edge.path.setAttribute('stroke', outColor.stroke);
        edge.path.setAttribute('stroke-width', '2.1');
      } else if (allChunkMembers.has(edge.headSeg) && allChunkMembers.has(edge.childSeg)) {
        var cascadeColor = headColorFor(edge.childSeg);
        edge.path.setAttribute('stroke', cascadeColor.stroke);
        edge.path.setAttribute('stroke-width', '2.0');
      } else {
        edge.path.setAttribute('stroke', 'rgba(17,24,39,0.12)');
        edge.path.setAttribute('stroke-width', '1.5');
      }
    }
  };
  return true;
}
