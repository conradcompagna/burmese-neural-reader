import { chunkModelState } from './chunk-model.state.mjs';
import { getUdLineHighlightSet } from './context-chunks.mjs';
import { ensureUdRectCache, ensureUdSvgOverlay, hideUdLines } from './dependency-geometry.mjs';
import { dependencyGeometryState } from './dependency-geometry.state.mjs';
import { dependencyState } from './dependency-state.state.mjs';
export function drawUdLinesForClause(segIdx) {
  hideUdLines();
  if (!chunkModelState.latestChunks || !chunkModelState.latestChunks.clauseGroup) return;
  var svg = ensureUdSvgOverlay();
  ensureUdRectCache();
  var edges = dependencyState.latestUdOverlay.edges || [];

  // Get the clause group for the current token (clauseGroup is a Map)
  var clauseGroupId = chunkModelState.latestChunks.clauseGroup.get(segIdx);
  if (clauseGroupId === undefined || clauseGroupId === 0) return;

  // Build set of all tokens in this clause
  var clauseMembers = new Set();
  chunkModelState.latestChunks.clauseGroup.forEach(function (grp, seg) {
    if (grp === clauseGroupId) {
      clauseMembers.add(seg);
    }
  });

  // Determine which tokens are "highlighted" (connected edges shown vivid)
  var highlightedTokens = getUdLineHighlightSet(segIdx);
  var edgesToDraw = [];
  var drawnPairs = new Set();
  edges.forEach(function (edge) {
    var fromInClause = clauseMembers.has(edge.from);
    var toInClause = clauseMembers.has(edge.to);

    // Only draw edges that touch the clause
    if (!fromInClause && !toInClause) return;
    var pairKey = edge.from + '-' + edge.to;
    if (drawnPairs.has(pairKey)) return;

    // Determine color based on edge direction and relationship to hovered token
    // edge.from is parent, edge.to is child
    var isChildLine;
    if (edge.from === segIdx) {
      // Hovered token is the parent -> orange (child line)
      isChildLine = true;
    } else if (edge.to === segIdx) {
      // Hovered token is the child -> blue (parent line)
      isChildLine = false;
    } else if (fromInClause && toInClause) {
      // Internal edge not directly involving hovered token
      // Default to parent->child direction: orange
      isChildLine = true;
    } else if (fromInClause) {
      // Edge from clause (parent) to external (child) -> orange
      isChildLine = true;
    } else {
      // Edge from external (parent) to clause (child) -> blue
      isChildLine = false;
    }
    edgesToDraw.push({
      fromIdx: edge.from,
      toIdx: edge.to,
      isChildLine: isChildLine
    });
    drawnPairs.add(pairKey);
  });

  // Draw all edges
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

    // Check if this edge is connected to highlighted tokens
    var isConnected = highlightedTokens.has(item.fromIdx) || highlightedTokens.has(item.toIdx);

    // Color scheme: orange for parent->child (isChildLine), blue for child->parent
    var strokeColor, strokeWidth, strokeOpacity, arrowheadId;
    if (isConnected) {
      // Vivid: this edge is connected to highlighted tokens - use orange/blue
      strokeColor = item.isChildLine ? '#e67e22' : '#6366f1';
      strokeWidth = 1.75;
      strokeOpacity = 0.85;
      arrowheadId = item.isChildLine ? 'ud-arrowhead-child' : 'ud-arrowhead';
    } else {
      // Faded: this edge is not connected - use grey
      strokeColor = '#6b7280';
      strokeWidth = 1.4;
      strokeOpacity = 0.25;
      arrowheadId = item.isChildLine ? 'ud-arrowhead-child-faded' : 'ud-arrowhead-faded';
    }

    // Use inline style to ensure it overrides CSS
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
