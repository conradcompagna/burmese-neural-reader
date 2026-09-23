import { documentPaginationState } from './document-pagination.state.mjs';
import { readerState } from './reader-state.state.mjs';
export // Build layout text from PDF word list
function shouldInsertSpace(word, wi) {
  if (wi <= 0) return false;
  if (word && typeof word.space_before === 'boolean') return word.space_before;
  return true;
}
export function buildLayoutTextFromWords(pageData) {
  // If we have structured_blocks, use them for proper document structure
  var blocks = Array.isArray(pageData.structured_blocks) ? pageData.structured_blocks : null;
  var words = Array.isArray(pageData.words) ? pageData.words : [];
  if (blocks && blocks.length > 0) {
    // Sort blocks by Y position (min_y) for proper vertical ordering
    var sortedBlocks = blocks.slice().sort(function (a, b) {
      return (a.min_y || 0) - (b.min_y || 0);
    });
    var text = '';
    for (var bi = 0; bi < sortedBlocks.length; bi++) {
      if (bi > 0) text += '\n\n'; // Paragraph break between blocks
      var block = sortedBlocks[bi];
      var lines = block.lines || [];
      for (var li = 0; li < lines.length; li++) {
        if (li > 0) text += '\n'; // Line break within block
        var lineWords = lines[li].words || [];
        // Sort words by X within line
        var sortedWords = lineWords.slice().sort(function (a, b) {
          return (a.x || 0) - (b.x || 0);
        });
        for (var wi = 0; wi < sortedWords.length; wi++) {
          var w = sortedWords[wi];
          if (!w || !w.text) continue;
          if (shouldInsertSpace(w, wi)) text += ' ';
          text += w.text;
        }
      }
    }
    return text;
  }

  // Fallback: group words by Y, sort by X within each line
  if (!words.length) return '';

  // Compute median height for line detection
  var medianH = 12;
  var allHeights = [];
  for (var wi = 0; wi < words.length; wi++) {
    if (words[wi] && words[wi].h > 0) allHeights.push(words[wi].h);
  }
  if (allHeights.length) {
    allHeights.sort(function (a, b) {
      return a - b;
    });
    var mid = Math.floor(allHeights.length / 2);
    medianH = allHeights.length % 2 ? allHeights[mid] : (allHeights[mid - 1] + allHeights[mid]) / 2;
  }

  // Group words into lines by Y
  var lineGroups = [];
  var currentLineY = -999;
  var currentLineWords = [];
  for (var wi = 0; wi < words.length; wi++) {
    var w = words[wi];
    if (!w || !w.text) continue;
    var y = typeof w.y === 'number' ? w.y : 0;
    var h = typeof w.h === 'number' && w.h > 0 ? w.h : medianH;
    if (currentLineY >= 0 && Math.abs(y - currentLineY) > h * 0.5) {
      if (currentLineWords.length > 0) {
        lineGroups.push({
          y: currentLineY,
          words: currentLineWords
        });
      }
      currentLineWords = [];
    }
    currentLineWords.push(w);
    currentLineY = y;
  }
  if (currentLineWords.length > 0) {
    lineGroups.push({
      y: currentLineY,
      words: currentLineWords
    });
  }

  // Sort lines by Y
  lineGroups.sort(function (a, b) {
    return a.y - b.y;
  });

  // Build text: lines separated by \n, words sorted by X and separated by space
  var text = '';
  for (var li = 0; li < lineGroups.length; li++) {
    if (li > 0) text += '\n';
    var lineWords = lineGroups[li].words;
    // Sort words by X within line
    lineWords.sort(function (a, b) {
      return (a.x || 0) - (b.x || 0);
    });
    for (var wi = 0; wi < lineWords.length; wi++) {
      var w = lineWords[wi];
      if (!w || !w.text) continue;
      if (shouldInsertSpace(w, wi)) text += ' ';
      text += w.text;
    }
  }
  return text;
}
export function getLayoutTextForPage(pageIdx, fallbackText) {
  if (!documentPaginationState.isOriginalView) return fallbackText;
  if (documentPaginationState.originalLayoutCache[pageIdx])
    return documentPaginationState.originalLayoutCache[pageIdx];
  return fallbackText;
}
export function getLookupTextForPage(pageIdx) {
  if (
    documentPaginationState.pageLookupTextByIndex &&
    documentPaginationState.pageLookupTextByIndex[pageIdx] != null
  ) {
    return documentPaginationState.pageLookupTextByIndex[pageIdx];
  }
  if (documentPaginationState.pdfRawTextCache && documentPaginationState.pdfRawTextCache[pageIdx] != null) {
    return String(documentPaginationState.pdfRawTextCache[pageIdx] || '').trim();
  }
  var raw =
    documentPaginationState.docPages && documentPaginationState.docPages[pageIdx] != null
      ? String(documentPaginationState.docPages[pageIdx])
      : '';
  return (raw || '').trim();
}
export function buildWordOffsets(pageText, words) {
  if (!pageText || !words || !words.length) return [];
  var offsets = new Array(words.length);
  var cursor = 0;
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    var wtext = w && w.text != null ? String(w.text) : '';
    if (!wtext) {
      offsets[i] = null;
      continue;
    }
    var idx = pageText.indexOf(wtext, cursor);
    if (idx < 0 && wtext.indexOf('\u00a0') >= 0) {
      var norm = wtext.replace(/\u00a0/g, ' ');
      idx = pageText.indexOf(norm, cursor);
      if (idx >= 0) wtext = norm;
    }
    if (idx < 0) {
      offsets[i] = null;
      continue;
    }
    offsets[i] = [idx, idx + wtext.length];
    cursor = idx + wtext.length;
  }
  return offsets;
}

// Show dict panel for segment
export function showDictPanelForSegment(segIdx) {
  if (!readerState.latestSegments) return;
  var seg = readerState.latestSegments[segIdx];
  if (!seg) return;
  if (readerState.dictSearch) readerState.dictSearch.value = seg;
  if (!readerState.panelOpen && readerState.panelToggle) readerState.panelToggle.click();
  if (readerState.searchBtn) readerState.searchBtn.click();
}

// POS colors for JavaScript (mirror of Python POS_COLORS)
