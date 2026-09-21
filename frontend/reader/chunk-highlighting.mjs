import { chunkHighlightingState } from './chunk-highlighting.state.mjs';
import { chunkModelState } from './chunk-model.state.mjs';
import {
  clearBottomUpChunkCache,
  clearContextWindowCache,
  expandHighlightSetForCollapsedSpans,
  getBottomUpChunkTokens,
  getCanonicalSegIdx,
  getContextWindowTokens
} from './context-chunks.mjs';
import { drawUdLinesForToken } from './dependency-highlighting.mjs';
import { getTokenSpanList } from './dependency-state.mjs';
import { dependencyState } from './dependency-state.state.mjs';
import { getNerLabelForSeg, nerLabelToUpos } from './entity-hover.mjs';
import { getConnectedIslandGroup, getIslandSpanForSeg } from './island-groups.mjs';
import { readerState } from './reader-state.state.mjs';
import { settingsState } from './settings-state.state.mjs';
export // Get chunk color based on POS
function getChunkColor(pos) {
  return chunkModelState.CHUNK_POS_COLORS[pos] || chunkModelState.CHUNK_POS_COLORS['DEFAULT'];
}
export function uposColorForTag(upos) {
  var key = (upos || '').toUpperCase();
  return chunkModelState.CHUNK_POS_COLORS[key] && chunkModelState.CHUNK_POS_COLORS[key].bg
    ? chunkModelState.CHUNK_POS_COLORS[key].bg
    : '#e5e7eb';
}

// Get all chunks a token belongs to (sorted by depth, shallowest first)
export function getChunksForToken(seg) {
  if (!chunkModelState.latestChunks) return [];
  var list = chunkModelState.latestChunks.tokenToChunks.get(seg) || [];
  return list.slice().sort(function (a, b) {
    return a.depth - b.depth;
  });
}

// Check if a token is a chunk head
export function isChunkHead(seg) {
  if (!chunkModelState.latestChunks) return null;
  for (var i = 0; i < chunkModelState.latestChunks.chunks.length; i++) {
    if (chunkModelState.latestChunks.chunks[i].headSeg === seg) {
      return chunkModelState.latestChunks.chunks[i];
    }
  }
  return null;
}

// Container for chunk POS tag elements
export // Clear all chunk highlighting
function clearChunkHighlight() {
  // Clear context window cache
  clearContextWindowCache();
  // Clear bottom-up chunk cache
  clearBottomUpChunkCache();
  // Remove POS tag elements
  for (var pi = 0; pi < chunkHighlightingState.chunkPosTags.length; pi++) {
    var el = chunkHighlightingState.chunkPosTags[pi];
    if (el.parentNode) el.parentNode.removeChild(el);
  }
  chunkHighlightingState.chunkPosTags = [];

  // Remove highlight styles from cached token elements (avoid querySelectorAll)
  for (var i = 0; i < chunkHighlightingState.highlightedTokenElements.length; i++) {
    var el = chunkHighlightingState.highlightedTokenElements[i];
    el.classList.remove('chunk-active', 'chunk-head-active', 'hovered-token');
    // Restore original backgroundColor if saved, otherwise clear
    if (el.dataset.originalBgColor) {
      el.style.backgroundColor = el.dataset.originalBgColor;
    } else {
      el.style.backgroundColor = '';
    }
    el.style.boxShadow = '';
    el.style.backgroundImage = '';
    el.style.backgroundSize = '';
    el.style.backgroundPosition = '';
    el.style.backgroundRepeat = '';
    el.style.borderRadius = '';
    el.style.outline = '';
    el.style.outlineOffset = '';
    el.style.position = ''; // Reset position from chunk head styling
  }
  chunkHighlightingState.highlightedTokenElements = [];

  // Clear subtoken styles from cached elements
  for (var j = 0; j < chunkHighlightingState.highlightedSubtokenElements.length; j++) {
    var sub = chunkHighlightingState.highlightedSubtokenElements[j];
    sub.classList.remove('chunk-subtoken-active');
    sub.style.outline = '';
    sub.style.outlineOffset = '';
    sub.style.boxShadow = '';
  }
  chunkHighlightingState.highlightedSubtokenElements = [];
  chunkHighlightingState.currentChunkHighlightTokens = null;
  chunkHighlightingState.cachedClauseHead = null;
  chunkHighlightingState.cachedTokenRectCache = null;
  chunkHighlightingState.cachedContainerRect = null;
}

// Apply chunk highlighting when hovering on a token
// Uses STABLE canonical colors - each token always gets the same color
export function applyChunkHighlight(segIdx) {
  clearChunkHighlight();
  if (!chunkModelState.latestChunks || !settingsState.displaySettings.chunkHighlight) return;

  // Collect ALL tokens that should light up.
  // When clause splitting is enabled, highlight by clause group; otherwise use chunk membership.
  var allTokensToHighlight = new Set();
  var canonicalSegIdx = getCanonicalSegIdx(segIdx);
  var useContextWindow = settingsState.displaySettings.contextWindow;
  var useBottomUpChunk = settingsState.displaySettings.bottomUpChunk;
  var useIslandGroup =
    settingsState.displaySettings.islandDepTree || settingsState.displaySettings.connectedIslands;
  var useClauseGroup =
    chunkModelState.latestChunks.clauseGroup && settingsState.displaySettings.linearClauseSplit;
  if (useBottomUpChunk) {
    // Use bottom-up chunk algorithm (cached for sync with drawUdLinesForBottomUpChunk)
    allTokensToHighlight = getBottomUpChunkTokens(canonicalSegIdx);
  } else if (useContextWindow) {
    // Use context window algorithm (cached for sync with drawUdLinesForContextWindow)
    allTokensToHighlight = getContextWindowTokens(canonicalSegIdx);
  } else if (useIslandGroup) {
    if (settingsState.displaySettings.connectedIslands) {
      // Use connected island group
      var connectedSpans = getConnectedIslandGroup(canonicalSegIdx);
      if (connectedSpans && connectedSpans.length > 0) {
        connectedSpans.forEach(function (span) {
          for (var i = span[0]; i < span[1]; i++) {
            allTokensToHighlight.add(i);
          }
        });
      } else {
        allTokensToHighlight.add(canonicalSegIdx);
      }
    } else {
      // Use single island
      var span = getIslandSpanForSeg(canonicalSegIdx);
      if (span) {
        for (var i = span[0]; i < span[1]; i++) {
          allTokensToHighlight.add(i);
        }
      } else {
        allTokensToHighlight.add(canonicalSegIdx);
      }
    }
  } else if (useClauseGroup) {
    var clauseGroup = chunkModelState.latestChunks.clauseGroup;
    var targetGroup = clauseGroup.get(canonicalSegIdx);
    if (targetGroup !== undefined && targetGroup !== 0) {
      chunkModelState.latestChunks.tokenMap.forEach(function (_, seg) {
        if (clauseGroup.get(seg) === targetGroup) {
          allTokensToHighlight.add(seg);
        }
      });
    } else {
      allTokensToHighlight.add(canonicalSegIdx);
    }
  } else {
    var chunks = getChunksForToken(canonicalSegIdx);
    // Always include the hovered token itself (even if it's an orphaned singleton not in any chunk)
    allTokensToHighlight.add(canonicalSegIdx);
    chunks.forEach(function (item) {
      var chunk = item.chunk;
      if (!chunk) return;
      if (chunk.members) {
        chunk.members.forEach(function (m) {
          allTokensToHighlight.add(m);
        });
      }
      if (!chunk.isRootPhrase && Array.isArray(chunk.extraMembers)) {
        chunk.extraMembers.forEach(function (m) {
          allTokensToHighlight.add(m);
        });
      }
    });
  }
  allTokensToHighlight.add(segIdx);
  allTokensToHighlight.add(canonicalSegIdx);
  allTokensToHighlight = expandHighlightSetForCollapsedSpans(allTokensToHighlight);

  // Find ALL chunk heads within the highlighted tokens (not just chunks the hovered token belongs to)
  // This ensures we show POS tags for every chunk head in the highlighted area
  var chunkHeadToChunk = new Map();
  chunkModelState.latestChunks.chunks.forEach(function (chunk) {
    // If this chunk's head is in the highlighted area, track it
    if (allTokensToHighlight.has(chunk.headSeg)) {
      chunkHeadToChunk.set(chunk.headSeg, chunk);
    }
  });
  var containerRect = readerState.renderedText.getBoundingClientRect();
  var tokenRectCache = {}; // Shared cache for phrase boundaries and UD arrows - measure each token only once

  // Apply highlighting to each token using its CANONICAL color (stable, never changes)
  allTokensToHighlight.forEach(function (tokenSeg) {
    var spans = getTokenSpanList(tokenSeg);
    if (!spans.length) return;

    // Color by the token's own POS, not the chunk head
    var tokenData =
      chunkModelState.latestChunks.tokenMap && typeof chunkModelState.latestChunks.tokenMap.get === 'function'
        ? chunkModelState.latestChunks.tokenMap.get(tokenSeg)
        : null;
    var tokenPos = tokenData && tokenData.upos ? tokenData.upos : null;
    var isRootToken = false;
    if (tokenData) {
      if (tokenData.head === tokenData.i) isRootToken = true;
      var depVal = (tokenData.dep || '').toLowerCase();
      if (depVal === 'root') isRootToken = true;
    }
    if (
      !isRootToken &&
      dependencyState.latestUdOverlay &&
      Array.isArray(dependencyState.latestUdOverlay.roots)
    ) {
      if (dependencyState.latestUdOverlay.roots.indexOf(tokenSeg) !== -1) isRootToken = true;
    }
    if (!isRootToken && (!tokenPos || tokenPos === 'DEFAULT')) {
      var nerLabel = getNerLabelForSeg(tokenSeg);
      var nerPos = nerLabelToUpos(nerLabel);
      if (nerPos) tokenPos = nerPos;
    }
    if (isRootToken) tokenPos = 'ROOT';
    if (!tokenPos) {
      var canonChunk = chunkModelState.latestChunks.canonicalChunk.get(tokenSeg);
      tokenPos = canonChunk ? canonChunk.pos : 'DEFAULT';
    }
    var color = getChunkColor(tokenPos);
    spans.forEach(function (span) {
      if (!span) return;
      // Save original backgroundColor before overwriting (for spacy POS overlay preservation)
      if (!span.dataset.originalBgColor && span.style.backgroundColor) {
        span.dataset.originalBgColor = span.style.backgroundColor;
      }

      // Apply styling to the token fragment span
      // Only use properties that don't affect box model to avoid subpixel shifts
      span.classList.add('chunk-active');
      span.style.backgroundColor = color.bg;
      span.style.outline = '1px solid rgba(0, 0, 0, 0.15)';
      span.style.outlineOffset = '-1px';

      // Track this element for fast clearing (avoid querySelectorAll)
      chunkHighlightingState.highlightedTokenElements.push(span);

      // Also apply outline to child subtokens (dictionary words within spaCy compounds)
      var subtokens = span.querySelectorAll('.reader-subtoken');
      if (subtokens.length > 1) {
        for (var si = 0; si < subtokens.length; si++) {
          subtokens[si].classList.add('chunk-subtoken-active');
          chunkHighlightingState.highlightedSubtokenElements.push(subtokens[si]);
        }
      }

      // If this is a chunk head, keep the head styling but skip the POS tag chip
      if (chunkHeadToChunk.get(tokenSeg)) {
        span.classList.add('chunk-head-active');
        span.style.position = 'relative';
      }

      // Mark the actively hovered token with a subtle glow effect via CSS class
      if (tokenSeg === segIdx) {
        span.classList.add('hovered-token');
      }
    });

    // Cache rect measurement for UD arrows using the first fragment
    if (settingsState.displaySettings.udOverlay) {
      var anchor = dependencyState.udTokenIndex.get(tokenSeg) || spans[0];
      if (anchor) tokenRectCache[tokenSeg] = anchor.getBoundingClientRect();
    }
  });
  chunkHighlightingState.currentChunkHighlightTokens = allTokensToHighlight;
  // Draw UD arrows in the same pass using cached measurements
  if (settingsState.displaySettings.udOverlay) {
    drawUdLinesForToken(segIdx);
  }
  var canonChunk = chunkModelState.latestChunks
    ? chunkModelState.latestChunks.canonicalChunk.get(segIdx)
    : null;
  chunkHighlightingState.cachedClauseHead = canonChunk ? canonChunk.headSeg : null;
  chunkHighlightingState.cachedTokenRectCache = tokenRectCache;
  chunkHighlightingState.cachedContainerRect = containerRect;

  // Note: External chunk highlighting removed - dep tree arrows are sufficient
  // to show connections to chunks outside the current clause
}
// ===================== END CHUNK HIGHLIGHTING =====================
// Load saved settings from localStorage
export function initializeChunkHighlighting() {
  chunkHighlightingState.chunkPosTags = [];
  chunkHighlightingState.currentChunkHighlightTokens = null;
  chunkHighlightingState.cachedClauseHead = null;
  chunkHighlightingState.cachedTokenRectCache = null;
  chunkHighlightingState.cachedContainerRect = null;
  chunkHighlightingState.lastUdSegIdx = -1;
  // Performance: cache references to highlighted elements to avoid querySelectorAll
  chunkHighlightingState.highlightedTokenElements = [];
  chunkHighlightingState.highlightedSubtokenElements = [];
  return true;
}
