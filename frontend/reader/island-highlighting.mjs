import { getUdLineHighlightSet } from './context-chunks.mjs';
import { ensureUdRectCache, ensureUdSvgOverlay, hideUdLines } from './dependency-geometry.mjs';
import { dependencyGeometryState } from './dependency-geometry.state.mjs';
import { dependencyState } from './dependency-state.state.mjs';
import { getConnectedIslandGroup, getIslandSpanForSeg } from './island-groups.mjs';
export function drawUdLinesForIsland(segIdx) {
  hideUdLines();
  if (!dependencyState.latestUdOverlay || !dependencyState.latestUdOverlay.ok) return;
  var span = getIslandSpanForSeg(segIdx);
  if (!span) return;
  var svg = ensureUdSvgOverlay();
  ensureUdRectCache();
  var edges = dependencyState.latestUdOverlay.edges || [];
  var islandMembers = new Set();
  for (var i = span[0]; i < span[1]; i++) {
    islandMembers.add(i);
  }
  var highlightedTokens = getUdLineHighlightSet(segIdx);
  var edgesToDraw = [];
  var drawnPairs = new Set();
  edges.forEach(function (edge) {
    var fromInIsland = islandMembers.has(edge.from);
    var toInIsland = islandMembers.has(edge.to);
    if (!fromInIsland && !toInIsland) return;
    var pairKey = edge.from + '-' + edge.to;
    if (drawnPairs.has(pairKey)) return;
    var isChildLine;
    if (edge.from === segIdx) {
      isChildLine = true;
    } else if (edge.to === segIdx) {
      isChildLine = false;
    } else if (fromInIsland && toInIsland) {
      isChildLine = true;
    } else if (fromInIsland) {
      isChildLine = true;
    } else {
      isChildLine = false;
    }
    edgesToDraw.push({
      fromIdx: edge.from,
      toIdx: edge.to,
      isChildLine: isChildLine
    });
    drawnPairs.add(pairKey);
  });
  edgesToDraw.forEach(function (item) {
    var fromSpan = dependencyState.udTokenIndex.get(item.fromIdx);
    var toSpan = dependencyState.udTokenIndex.get(item.toIdx);
    if (!fromSpan || !toSpan) return;
    var fromRect = dependencyState.udTokenRectCache.get(Number(item.fromIdx));
    var toRect = dependencyState.udTokenRectCache.get(Number(item.toIdx));
    if (!fromRect || !toRect) return;
    var x1 = fromRect.cx;
    var y1 = fromRect.top;
    var x2 = toRect.cx;
    var y2 = toRect.top;
    var midX = (x1 + x2) / 2;
    var dist = Math.abs(x2 - x1);
    var arcHeight = Math.min(40, Math.max(20, dist * 0.3));
    var controlY = Math.min(y1, y2) - arcHeight;
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'ud-dep-line');
    path.setAttribute('d', 'M ' + x2 + ' ' + y2 + ' Q ' + midX + ' ' + controlY + ' ' + x1 + ' ' + y1);
    path.setAttribute('data-from-idx', item.fromIdx);
    path.setAttribute('data-to-idx', item.toIdx);
    var isConnected = highlightedTokens.has(item.fromIdx) || highlightedTokens.has(item.toIdx);
    var strokeColor, strokeWidth, strokeOpacity, arrowheadId;
    if (isConnected) {
      strokeColor = item.isChildLine ? '#e67e22' : '#6366f1';
      strokeWidth = 1.75;
      strokeOpacity = 0.85;
      arrowheadId = item.isChildLine ? 'ud-arrowhead-child' : 'ud-arrowhead';
    } else {
      strokeColor = '#6b7280';
      strokeWidth = 1.4;
      strokeOpacity = 0.25;
      arrowheadId = item.isChildLine ? 'ud-arrowhead-child-faded' : 'ud-arrowhead-faded';
    }
    path.setAttribute(
      'style',
      'stroke: ' +
        strokeColor +
        '; ' +
        'stroke-width: ' +
        strokeWidth +
        '; ' +
        'opacity: ' +
        strokeOpacity +
        '; ' +
        'fill: none;'
    );
    path.setAttribute('marker-end', 'url(#' + arrowheadId + ')');
    svg.appendChild(path);
    dependencyGeometryState.udActivePaths.push(path);
  });
}
export function drawUdLinesForConnectedIslands(segIdx) {
  hideUdLines();
  if (!dependencyState.latestUdOverlay || !dependencyState.latestUdOverlay.ok) return;
  var connectedSpans = getConnectedIslandGroup(segIdx);
  if (!connectedSpans || connectedSpans.length === 0) return;
  var svg = ensureUdSvgOverlay();
  ensureUdRectCache();
  var edges = dependencyState.latestUdOverlay.edges || [];

  // Build set of all tokens in connected island group
  var groupMembers = new Set();
  connectedSpans.forEach(function (span) {
    for (var i = span[0]; i < span[1]; i++) {
      groupMembers.add(i);
    }
  });
  var highlightedTokens = getUdLineHighlightSet(segIdx);
  var edgesToDraw = [];
  var drawnPairs = new Set();
  edges.forEach(function (edge) {
    var fromInGroup = groupMembers.has(edge.from);
    var toInGroup = groupMembers.has(edge.to);
    if (!fromInGroup && !toInGroup) return;
    var pairKey = edge.from + '-' + edge.to;
    if (drawnPairs.has(pairKey)) return;
    var isChildLine;
    if (edge.from === segIdx) {
      isChildLine = true;
    } else if (edge.to === segIdx) {
      isChildLine = false;
    } else if (fromInGroup && toInGroup) {
      isChildLine = true;
    } else if (fromInGroup) {
      isChildLine = true;
    } else {
      isChildLine = false;
    }
    edgesToDraw.push({
      fromIdx: edge.from,
      toIdx: edge.to,
      isChildLine: isChildLine
    });
    drawnPairs.add(pairKey);
  });
  edgesToDraw.forEach(function (item) {
    var fromSpan = dependencyState.udTokenIndex.get(item.fromIdx);
    var toSpan = dependencyState.udTokenIndex.get(item.toIdx);
    if (!fromSpan || !toSpan) return;
    var fromRect = dependencyState.udTokenRectCache.get(Number(item.fromIdx));
    var toRect = dependencyState.udTokenRectCache.get(Number(item.toIdx));
    if (!fromRect || !toRect) return;
    var x1 = fromRect.cx;
    var y1 = fromRect.top;
    var x2 = toRect.cx;
    var y2 = toRect.top;
    var midX = (x1 + x2) / 2;
    var dist = Math.abs(x2 - x1);
    var arcHeight = Math.min(40, Math.max(20, dist * 0.3));
    var controlY = Math.min(y1, y2) - arcHeight;
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'ud-dep-line');
    path.setAttribute('d', 'M ' + x2 + ' ' + y2 + ' Q ' + midX + ' ' + controlY + ' ' + x1 + ' ' + y1);
    path.setAttribute('data-from-idx', item.fromIdx);
    path.setAttribute('data-to-idx', item.toIdx);
    var isConnected = highlightedTokens.has(item.fromIdx) || highlightedTokens.has(item.toIdx);
    var strokeColor, strokeWidth, strokeOpacity, arrowheadId;
    if (isConnected) {
      strokeColor = item.isChildLine ? '#e67e22' : '#6366f1';
      strokeWidth = 1.75;
      strokeOpacity = 0.85;
      arrowheadId = item.isChildLine ? 'ud-arrowhead-child' : 'ud-arrowhead';
    } else {
      strokeColor = '#6b7280';
      strokeWidth = 1.4;
      strokeOpacity = 0.25;
      arrowheadId = item.isChildLine ? 'ud-arrowhead-child-faded' : 'ud-arrowhead-faded';
    }
    path.setAttribute(
      'style',
      'stroke: ' +
        strokeColor +
        '; ' +
        'stroke-width: ' +
        strokeWidth +
        '; ' +
        'opacity: ' +
        strokeOpacity +
        '; ' +
        'fill: none;'
    );
    path.setAttribute('marker-end', 'url(#' + arrowheadId + ')');
    svg.appendChild(path);
    dependencyGeometryState.udActivePaths.push(path);
  });
}

// Helper: get the canonical segment index (first segment if part of collapsed NER span)
