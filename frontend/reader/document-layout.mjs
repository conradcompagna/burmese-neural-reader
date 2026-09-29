export function _blockHasOverlap(spans, debug) {
  if (!spans || spans.length < 2) return false;

  // Group spans into lines using actual line data from PyMuPDF
  var byLine = {};
  for (var i = 0; i < spans.length; i++) {
    var s = spans[i];
    var lineKey = s.dataset.line || '0';
    if (!byLine[lineKey]) byLine[lineKey] = [];
    byLine[lineKey].push(s);
  }

  // Within each line, sort by X and compute gap for each adjacent pair
  var allGaps = []; // Positive = gap, negative = overlap
  var overlaps = [];
  var lineKeys = Object.keys(byLine);
  for (var li = 0; li < lineKeys.length; li++) {
    var lineSpans = byLine[lineKeys[li]];
    if (lineSpans.length < 2) continue;
    // Get rects and sort by left edge
    var indexed = lineSpans.map(function (s) {
      return {
        r: s.getBoundingClientRect(),
        s: s
      };
    });
    indexed.sort(function (a, b) {
      return a.r.left - b.r.left;
    });
    // Check adjacent pairs
    for (var j = 0; j < indexed.length - 1; j++) {
      var curr = indexed[j];
      var next = indexed[j + 1];
      // Gap = next.left - curr.right (positive = gap, negative = overlap)
      var gap = next.r.left - curr.r.right;
      allGaps.push(gap);
      if (gap < 0) {
        overlaps.push({
          line: lineKeys[li],
          curr: {
            text: curr.s.textContent,
            left: curr.r.left,
            right: curr.r.right
          },
          next: {
            text: next.s.textContent,
            left: next.r.left,
            right: next.r.right
          },
          overlapPx: -gap
        });
      }
    }
  }

  // Calculate median gap - if median is negative, we have significant overlap
  var medianGap = 0;
  if (allGaps.length > 0) {
    allGaps.sort(function (a, b) {
      return a - b;
    });
    var mid = Math.floor(allGaps.length / 2);
    medianGap = allGaps.length % 2 ? allGaps[mid] : (allGaps[mid - 1] + allGaps[mid]) / 2;
  }
  var hasSignificantOverlap = medianGap < 0;
  if (debug) {
    return {
      hasOverlap: hasSignificantOverlap,
      overlaps: overlaps,
      lines: lineKeys.length,
      totalSpans: spans.length,
      totalPairs: allGaps.length,
      medianGap: medianGap,
      minGap: allGaps.length ? allGaps[0] : 0,
      maxGap: allGaps.length ? allGaps[allGaps.length - 1] : 0
    };
  }
  return hasSignificantOverlap;
}
export function normalizeBlockFontSizes(container, baseFontPx) {
  if (!container) return;
  var spans = container.querySelectorAll('.pdf-raw-word');
  if (!spans || !spans.length) return;
  var byBlock = {};
  spans.forEach(function (s) {
    var b = s.dataset.block || '0';
    if (!byBlock[b]) byBlock[b] = [];
    byBlock[b].push(s);
  });
  Object.keys(byBlock).forEach(function (blockKey) {
    var blockSpans = byBlock[blockKey];
    if (!blockSpans || blockSpans.length < 2) return;
    var baseSize = baseFontPx && isFinite(baseFontPx) && baseFontPx > 0 ? baseFontPx : 0;
    if (!baseSize) {
      for (var i = 0; i < blockSpans.length; i++) {
        var fs = parseFloat(blockSpans[i].style.fontSize || '0');
        if (fs > 0) {
          baseSize = fs;
          break;
        }
      }
    }
    if (!baseSize) return;
    var size = Math.floor(baseSize);
    var minSize = Math.max(6, size - 12);
    for (; size >= minSize; size -= 1) {
      for (var k = 0; k < blockSpans.length; k++) {
        blockSpans[k].style.fontSize = size + 'px';
      }
      if (!_blockHasOverlap(blockSpans)) break;
    }
  });
}
export function normalizeLinePositions(container) {
  if (!container) return;
  var spans = container.querySelectorAll('.pdf-raw-word');
  if (!spans || !spans.length) return;

  // Group spans by block and line
  var byBlockLine = {};
  spans.forEach(function (s) {
    var blockKey = s.dataset.block || '0';
    var lineKey = s.dataset.line || '0';
    var key = blockKey + ':' + lineKey;
    if (!byBlockLine[key])
      byBlockLine[key] = {
        block: blockKey,
        line: lineKey,
        spans: []
      };
    byBlockLine[key].spans.push(s);
  });

  // Convert to array and sort by original Y position
  var lines = Object.values(byBlockLine);
  lines.forEach(function (lineData) {
    var minY = Infinity;
    lineData.spans.forEach(function (s) {
      var y = parseFloat(s.dataset.bboxY) || 0;
      if (y < minY) minY = y;
    });
    lineData.origY = minY;
  });
  lines.sort(function (a, b) {
    return a.origY - b.origY;
  });

  // Calculate the rendered height of each line
  lines.forEach(function (lineData) {
    var maxH = 0;
    lineData.spans.forEach(function (s) {
      var rect = s.getBoundingClientRect();
      if (rect.height > maxH) maxH = rect.height;
    });
    lineData.renderedH = maxH;
  });

  // Keep original vertical layout. Do not globally re-stack lines, which can
  // break tables/columns. Only straighten each line so all words on that line
  // share one top value.
  var containerH = container.getBoundingClientRect().height || 0;
  lines.forEach(function (lineData) {
    var topVals = [];
    lineData.spans.forEach(function (s) {
      var t = parseFloat(s.style.top || '');
      if (isFinite(t)) topVals.push(t);
    });
    var topPct;
    if (topVals.length) {
      topVals.sort(function (a, b) {
        return a - b;
      });
      topPct = topVals[Math.floor(topVals.length / 2)];
    } else if (containerH > 0) {
      topPct = (lineData.origY / containerH) * 100;
    } else {
      topPct = 0;
    }
    lineData.spans.forEach(function (s) {
      s.style.top = topPct + '%';
    });
  });
}
export function initializeDocumentLayout() {
  window._blockHasOverlap = _blockHasOverlap;
  window.normalizeLinePositions = normalizeLinePositions;
  return true;
}
