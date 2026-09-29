(function(global) {
  "use strict";

  function computeWhitespaceBoundaries(segments, originalText) {
    var boundaries = new Set();

    if (!segments || !segments.length) return boundaries;
    if (!originalText) return boundaries;

    // Map each segment to its position in original text
    var segmentPositions = [];
    var pos = 0;
    for (var i = 0; i < segments.length; i++) {
      var tokenText = String(segments[i] || "");
      if (!tokenText) continue;

      var idx = originalText.indexOf(tokenText, pos);
      if (idx === -1) continue;

      segmentPositions.push({
        segIndex: i,
        start: idx,
        end: idx + tokenText.length
      });
      pos = idx + tokenText.length;
    }

    if (segmentPositions.length === 0) return boundaries;

    // Find island boundaries: mark where whitespace separates islands
    for (var s = 0; s < segmentPositions.length - 1; s++) {
      var currEnd = segmentPositions[s].end;
      var nextStart = segmentPositions[s + 1].start;

      // If there's whitespace between current token end and next token start,
      // mark the boundary BEFORE the next segment
      if (nextStart > currEnd) {
        // Check if there's actual whitespace between them
        var between = originalText.substring(currEnd, nextStart);
        if (between.match(/\s/)) {
          boundaries.add(segmentPositions[s].segIndex);
        }
      }
    }

    return boundaries;
  }

  global.computeWhitespaceBoundaries = computeWhitespaceBoundaries;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = computeWhitespaceBoundaries;
  }
})(typeof window !== "undefined" ? window : globalThis);
