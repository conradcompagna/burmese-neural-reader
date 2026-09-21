import { getBottomUpChunkTokens, getCanonicalSegIdx, getContextWindowTokens } from './context-chunks.mjs';
import { ensureUdRectCache, ensureUdSvgOverlay, hideUdLines } from './dependency-geometry.mjs';
import { dependencyGeometryState } from './dependency-geometry.state.mjs';
import { drawUdLinesForClause } from './dependency-lines.mjs';
import { dependencyState } from './dependency-state.state.mjs';
import { drawUdLinesForConnectedIslands, drawUdLinesForIsland } from './island-highlighting.mjs';
import { settingsState } from './settings-state.state.mjs';
export // Draw UD lines for bottom-up chunk - reuses the context window rendering logic
function drawUdLinesForBottomUpChunk(segIdx) {
  hideUdLines();
  if (!dependencyState.latestUdOverlay || !dependencyState.latestUdOverlay.ok) return;
  var highlightedTokens = getBottomUpChunkTokens(segIdx);
  if (!highlightedTokens || highlightedTokens.size === 0) return;
  var svg = ensureUdSvgOverlay();
  ensureUdRectCache();
  var edges = dependencyState.latestUdOverlay.edges || [];
  var edgesToDraw = [];
  var drawnPairs = new Set();
  edges.forEach(function (edge) {
    var fromInChunk = highlightedTokens.has(edge.from);
    var toInChunk = highlightedTokens.has(edge.to);
    // Draw edges that are internal to chunk OR edges in/out of chunk (external connections)
    if (!fromInChunk && !toInChunk) return;
    var pairKey = edge.from + '-' + edge.to;
    if (drawnPairs.has(pairKey)) return;

    // Determine if this is a child line (arrow pointing to child)
    var isChildLine = edge.to !== segIdx;
    edgesToDraw.push({
      fromIdx: edge.from,
      toIdx: edge.to,
      isChildLine: isChildLine,
      isInternal: fromInChunk && toInChunk
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

    // ONLY color edges directly connected to the hovered token
    // All other edges (internal or external) are grey
    var isHoveredEdge = item.fromIdx === segIdx || item.toIdx === segIdx;
    var strokeColor, strokeWidth, strokeOpacity, arrowheadId;
    if (isHoveredEdge) {
      // Edges directly connected to hovered token - bright colors
      strokeColor = item.isChildLine ? '#e67e22' : '#6366f1';
      strokeWidth = 1.75;
      strokeOpacity = 0.85;
      arrowheadId = item.isChildLine ? 'ud-arrowhead-child' : 'ud-arrowhead';
    } else {
      // All other edges (internal to chunk or external) - grey/faded
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
export function drawUdLinesForContextWindow(segIdx) {
  hideUdLines();
  if (!dependencyState.latestUdOverlay || !dependencyState.latestUdOverlay.ok) return;

  // Use cached tokens to stay in sync with applyChunkHighlight
  var highlightedTokens = getContextWindowTokens(segIdx);
  if (!highlightedTokens || highlightedTokens.size === 0) return;
  var svg = ensureUdSvgOverlay();
  ensureUdRectCache();
  var edges = dependencyState.latestUdOverlay.edges || [];
  var edgesToDraw = [];
  var drawnPairs = new Set();
  edges.forEach(function (edge) {
    var fromInChunk = highlightedTokens.has(edge.from);
    var toInChunk = highlightedTokens.has(edge.to);
    // Draw edges that are internal to chunk OR edges in/out of chunk (external connections)
    if (!fromInChunk && !toInChunk) return;
    var pairKey = edge.from + '-' + edge.to;
    if (drawnPairs.has(pairKey)) return;

    // Determine if this is a child line (arrow pointing to child)
    var isChildLine = edge.to !== segIdx;
    edgesToDraw.push({
      fromIdx: edge.from,
      toIdx: edge.to,
      isChildLine: isChildLine,
      isInternal: fromInChunk && toInChunk
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

    // ONLY color edges directly connected to the hovered token
    // All other edges (internal or external) are grey
    var isHoveredEdge = item.fromIdx === segIdx || item.toIdx === segIdx;
    var strokeColor, strokeWidth, strokeOpacity, arrowheadId;
    if (isHoveredEdge) {
      // Edges directly connected to hovered token - bright colors
      strokeColor = item.isChildLine ? '#e67e22' : '#6366f1';
      strokeWidth = 1.75;
      strokeOpacity = 0.85;
      arrowheadId = item.isChildLine ? 'ud-arrowhead-child' : 'ud-arrowhead';
    } else {
      // All other edges (internal to chunk or external) - grey/faded
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
export function drawUdLinesForToken(segIdx) {
  if (
    !settingsState.displaySettings.udOverlay ||
    !dependencyState.latestUdOverlay ||
    !dependencyState.latestUdOverlay.ok
  ) {
    hideUdLines();
    return;
  }
  var canonicalIdx = getCanonicalSegIdx(segIdx);
  if (settingsState.displaySettings.bottomUpChunk) {
    drawUdLinesForBottomUpChunk(canonicalIdx);
  } else if (settingsState.displaySettings.contextWindow) {
    drawUdLinesForContextWindow(canonicalIdx);
  } else if (settingsState.displaySettings.connectedIslands) {
    drawUdLinesForConnectedIslands(canonicalIdx);
  } else if (settingsState.displaySettings.islandDepTree) {
    drawUdLinesForIsland(canonicalIdx);
  } else {
    drawUdLinesForClause(canonicalIdx);
  }
}
export function getUdInfoForSegment(segIdx) {
  if (!dependencyState.latestUdOverlay || !dependencyState.latestUdOverlay.ok) return null;
  var canonicalIdx = getCanonicalSegIdx(segIdx);
  if (dependencyState.latestUdTokenMap && dependencyState.latestUdTokenMap[canonicalIdx])
    return dependencyState.latestUdTokenMap[canonicalIdx];
  return null;
}
export function getUdEdgesForSegment(segIdx) {
  if (!dependencyState.latestUdOverlay || !dependencyState.latestUdOverlay.ok) return [];
  var edges = dependencyState.latestUdOverlay.edges || [];
  return edges.filter(function (e) {
    return e.from === segIdx || e.to === segIdx;
  });
}
export function buildUdPopupHtml(segIdx) {
  // UD popup disabled - tags moved to dictionary headline
  return '';
}

// NEW: Build tag badges for dictionary headline (moved from UD popup)
// This function is now deprecated as POS tags are rendered directly from the entry.
export function buildUdTagsForHeadline(segIdx) {
  return '';
}
// ===================== END UD VISUALIZATION =====================

// Display toggle state - load from localStorage or use defaults
