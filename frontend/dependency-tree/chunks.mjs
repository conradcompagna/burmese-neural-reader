import { DepTreeView } from './controller.mjs';
export function initializeChunks() {
  // Compute chunks based on depth-based subtree logic
  // Mirrors the main view's computeChunks logic with canonical chunk assignment
  DepTreeView.prototype._recomputeChunks = function () {
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
      heads.sort(function (a, b) {
        return a - b;
      });

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
        var stack = [
          {
            seg: seg,
            d: 0
          }
        ];
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
              stack.push({
                seg: kid,
                d: d + 1
              });
            }
          }
        }
        return depth;
      }
      var minDepth = Math.max(1, Math.min(5, this.settings.branchDepthMin || 1));
      var branchHeads = heads.filter(function (seg) {
        return branchDepth(seg, minDepth) >= minDepth;
      });
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
          list.sort(function (a, b) {
            return a - b;
          });
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
      var splitMultiHeadOutClauseGroups = function () {
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
      var propagateGroupsToNonHeads = function () {
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
      orderedSegs.sort(function (a, b) {
        return a - b;
      });
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
      return {
        members: members,
        nonContiguousLeaves: nonContiguousLeaves
      };
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
    var canonicalChunk = {}; // seg -> chunk (finest-grained)

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
          headPos: 'ROOT',
          // Use special ROOT color for root phrase
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
              if (tokens[kti].i === kid) {
                kidTok = tokens[kti];
                break;
              }
            }
            var singletonChunk = {
              depth: 0,
              headIdx: kid,
              headPos: kidTok ? kidTok.upos || 'DEFAULT' : 'DEFAULT',
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
            if (clauseGroup[nonContiguousLeaves[fl]] === headGroup)
              filteredLeaves.push(nonContiguousLeaves[fl]);
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
            if (tokens[lti].i === leaf) {
              leafTok = tokens[lti];
              break;
            }
          }
          var singletonChunk = {
            depth: d,
            headIdx: leaf,
            headPos: leafTok ? leafTok.upos || 'DEFAULT' : 'DEFAULT',
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
  return true;
}
