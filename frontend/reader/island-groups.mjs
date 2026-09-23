import { getUdInfoForSegment } from './dependency-highlighting.mjs';
import { dependencyState } from './dependency-state.state.mjs';
import { islandGroupsState } from './island-groups.state.mjs';
import { readerState } from './reader-state.state.mjs';
import { settingsState } from './settings-state.state.mjs';
export function getIslandSpanForSeg(segIdx) {
  if (!readerState.latestData || !Array.isArray(readerState.latestData.island_spans)) return null;
  for (var i = 0; i < readerState.latestData.island_spans.length; i++) {
    var span = readerState.latestData.island_spans[i];
    if (segIdx >= span[0] && segIdx < span[1]) return span;
  }
  return null;
}
export function areIslandsConnected(span1, span2) {
  // Check if any dependency edge connects tokens between two islands
  if (!dependencyState.latestUdOverlay || !dependencyState.latestUdOverlay.ok) return false;
  if (!span1 || !span2) return false;
  var edges = dependencyState.latestUdOverlay.edges || [];
  var members1 = new Set();
  var members2 = new Set();
  for (var i = span1[0]; i < span1[1]; i++) members1.add(i);
  for (var i = span2[0]; i < span2[1]; i++) members2.add(i);

  // Check if any edge connects the two islands (bidirectional)
  for (var i = 0; i < edges.length; i++) {
    var edge = edges[i];
    var fromIn1 = members1.has(edge.from);
    var fromIn2 = members2.has(edge.from);
    var toIn1 = members1.has(edge.to);
    var toIn2 = members2.has(edge.to);

    // Connection exists if edge goes from island1 to island2 or vice versa
    if ((fromIn1 && toIn2) || (fromIn2 && toIn1)) {
      return true;
    }
  }
  return false;
}
export function collectConnectedGroupMembers(allSpans, startIdx, endIdx) {
  var members = new Set();
  var maxSeg = -1;
  for (var i = startIdx; i <= endIdx; i++) {
    var span = allSpans[i];
    for (var j = span[0]; j < span[1]; j++) {
      members.add(j);
      if (j > maxSeg) maxSeg = j;
    }
  }
  return {
    members: members,
    maxSeg: maxSeg
  };
}
export function findLeadingOutEdge(members, maxSeg, sentEnd) {
  if (!dependencyState.latestUdOverlay || !dependencyState.latestUdOverlay.ok) return null;
  var tokens = dependencyState.latestUdOverlay.tokens || [];

  // Find the token in the group whose head is outside the group and to the right
  for (var i = 0; i < tokens.length; i++) {
    var tok = tokens[i];
    var tokIdx = tok.i;
    var headIdx = tok.head;

    // Token must be in the group
    if (!members.has(tokIdx)) continue;

    // Head must be outside the group
    if (members.has(headIdx)) continue;

    // Head must be to the right (leading edge goes rightward/downward)
    if (headIdx <= maxSeg) continue;

    // Head must be within sentence bounds
    if (typeof sentEnd === 'number' && headIdx >= sentEnd) continue;

    // Found the group's attachment point
    return {
      from: headIdx,
      // the external head
      to: tokIdx,
      // the token in the group
      dep: tok.dep,
      upos: tok.upos
    };
  }
  return null;
}
export function isVerbAclHead(segIdx) {
  var info = getUdInfoForSegment(segIdx);
  if (!info) return false;
  var upos = (info.upos || '').toUpperCase();
  var dep = (info.dep || '').toLowerCase();
  return upos === 'VERB' && dep === 'acl';
}
export function isRootSeg(segIdx) {
  if (!dependencyState.latestUdOverlay || !dependencyState.latestUdOverlay.ok) return false;
  if (!Array.isArray(dependencyState.latestUdOverlay.roots)) return false;
  if (dependencyState.latestUdOverlay.roots.indexOf(segIdx) !== -1) return true;
  var info = getUdInfoForSegment(segIdx);
  if (!info) return false;
  if (info.head === info.i) return true;
  var dep = (info.dep || '').toLowerCase();
  return dep === 'root';
}
export function getSentenceSpansFromSegments(segments) {
  var spans = [];
  if (!Array.isArray(segments) || !segments.length) return spans;
  var start = 0;
  for (var i = 0; i < segments.length; i++) {
    if (segments[i] === '\u104b') {
      // Myanmar period
      spans.push({
        start: start,
        end: i + 1
      });
      start = i + 1;
    }
  }
  if (start < segments.length)
    spans.push({
      start: start,
      end: segments.length
    });
  return spans;
}
export function buildConnectedIslandGroupsForSentence(allSpans, spanIndices) {
  var groups = [];
  if (!spanIndices.length) return groups;
  var startIdx = spanIndices[0];
  var prevIdx = spanIndices[0];
  for (var i = 1; i < spanIndices.length; i++) {
    var idx = spanIndices[i];
    if (!areIslandsConnected(allSpans[prevIdx], allSpans[idx])) {
      groups.push({
        startIdx: startIdx,
        endIdx: prevIdx
      });
      startIdx = idx;
    }
    prevIdx = idx;
  }
  groups.push({
    startIdx: startIdx,
    endIdx: prevIdx
  });
  return groups;
}
export function absorbStrayParticles(allSpans, groups, sentEnd) {
  // Absorb groups that are adjacent in island sequence, connect backward, and have no forward edge
  if (groups.length < 2) return groups;
  var tokens = (dependencyState.latestUdOverlay && dependencyState.latestUdOverlay.tokens) || [];
  var result = [groups[0]];
  for (var gi = 1; gi < groups.length; gi++) {
    var prevGroup = result[result.length - 1];
    var currGroup = groups[gi];
    // Check adjacency: current group's first island immediately follows prev group's last island
    if (currGroup.startIdx !== prevGroup.endIdx + 1) {
      result.push(currGroup);
      continue;
    }
    // Check if current group has no forward edges
    var currInfo = collectConnectedGroupMembers(allSpans, currGroup.startIdx, currGroup.endIdx);
    var forwardEdge = findLeadingOutEdge(currInfo.members, currInfo.maxSeg, sentEnd);
    if (forwardEdge) {
      result.push(currGroup);
      continue;
    }
    // Check if current group has backward connection to prev group
    var prevInfo = collectConnectedGroupMembers(allSpans, prevGroup.startIdx, prevGroup.endIdx);
    var hasBackwardEdge = false;
    for (var ti = 0; ti < tokens.length; ti++) {
      var tok = tokens[ti];
      if (!currInfo.members.has(tok.i)) continue;
      if (prevInfo.members.has(tok.head)) {
        hasBackwardEdge = true;
        break;
      }
    }
    if (!hasBackwardEdge) {
      result.push(currGroup);
      continue;
    }
    // Absorb: extend prev group to include curr group
    result[result.length - 1] = {
      startIdx: prevGroup.startIdx,
      endIdx: currGroup.endIdx
    };
  }
  return result;
}
export function applyAclGatePostpass(allSpans, groups, sentEnd) {
  if (!settingsState.displaySettings.connectedIslandsAclGate) return groups;
  var merged = [];
  var gi = 0;
  while (gi < groups.length) {
    var mergedStart = groups[gi].startIdx;
    var mergedEnd = groups[gi].endIdx;
    var current = gi;
    while (true) {
      // Check the CURRENT (most recently added) group's leading edge
      var currInfo = collectConnectedGroupMembers(allSpans, groups[current].startIdx, groups[current].endIdx);
      var currLeadingEdge = findLeadingOutEdge(currInfo.members, currInfo.maxSeg, sentEnd);
      if (!currLeadingEdge) {
        // No forward edge - stop merging
        break;
      }
      var headSeg = currLeadingEdge.to;
      if (isRootSeg(headSeg) || isVerbAclHead(headSeg)) {
        // Current group is a clause boundary - stop merging
        break;
      }

      // Current group is NOT a clause boundary, merge with next group
      if (current + 1 >= groups.length) break;
      current += 1;
      mergedEnd = groups[current].endIdx;
      // Loop continues - will check the newly merged group's edge
    }
    merged.push({
      startIdx: mergedStart,
      endIdx: mergedEnd
    });
    gi = current + 1;
  }
  return merged;
}
export function rebuildConnectedIslandGroups() {
  islandGroupsState.latestConnectedIslandGroups = [];
  islandGroupsState.latestConnectedIslandGroupBySeg = new Map();
  if (!readerState.latestData || !Array.isArray(readerState.latestData.island_spans)) return;
  var allSpans = readerState.latestData.island_spans;
  if (!allSpans.length) return;
  var segments = Array.isArray(readerState.latestData.segments)
    ? readerState.latestData.segments
    : [];
  var sentenceSpans = getSentenceSpansFromSegments(segments);
  if (!sentenceSpans.length) {
    sentenceSpans = [
      {
        start: 0,
        end: segments.length
      }
    ];
  }
  var spanIdx = 0;
  sentenceSpans.forEach(function (sent) {
    var spanIndices = [];
    while (spanIdx < allSpans.length && allSpans[spanIdx][0] < sent.end) {
      if (allSpans[spanIdx][0] >= sent.start) {
        spanIndices.push(spanIdx);
      }
      spanIdx++;
    }
    if (!spanIndices.length) return;
    var groups = buildConnectedIslandGroupsForSentence(allSpans, spanIndices);
    groups = absorbStrayParticles(allSpans, groups, sent.end);
    groups = applyAclGatePostpass(allSpans, groups, sent.end);
    groups.forEach(function (g) {
      var groupSpans = [];
      for (var i = g.startIdx; i <= g.endIdx; i++) {
        groupSpans.push(allSpans[i]);
      }
      var groupObj = {
        spans: groupSpans,
        startIdx: g.startIdx,
        endIdx: g.endIdx
      };
      islandGroupsState.latestConnectedIslandGroups.push(groupObj);
      var info = collectConnectedGroupMembers(allSpans, g.startIdx, g.endIdx);
      info.members.forEach(function (seg) {
        islandGroupsState.latestConnectedIslandGroupBySeg.set(seg, groupObj);
      });
    });
  });
}
export function getConnectedIslandGroup(segIdx) {
  // Returns a list of island spans that form a connected group
  if (!readerState.latestData || !Array.isArray(readerState.latestData.island_spans)) return null;
  if (!islandGroupsState.latestConnectedIslandGroupBySeg) rebuildConnectedIslandGroups();
  var group = islandGroupsState.latestConnectedIslandGroupBySeg
    ? islandGroupsState.latestConnectedIslandGroupBySeg.get(segIdx)
    : null;
  if (group && group.spans) return group.spans;
  var fallback = getIslandSpanForSeg(segIdx);
  return fallback ? [fallback] : null;
}
export function initializeIslandGroups() {
  islandGroupsState.latestConnectedIslandGroups = null;
  islandGroupsState.latestConnectedIslandGroupBySeg = null;
  return true;
}
