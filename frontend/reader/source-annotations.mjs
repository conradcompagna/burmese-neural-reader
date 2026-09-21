import { registerTokenSpan } from './dependency-state.mjs';
import { dependencyState } from './dependency-state.state.mjs';
import { shouldInsertSpace } from './pdf-layout-text.mjs';
import { hasMyanmarChars, isMyanmarPunctToken } from './text.mjs';
import { buildTokenSpan } from './token-rendering.mjs';
export // Annotate raw PDF word spans with segment/NLP data
function annotateRawWordSpans(
  wordSpans,
  pdfWords,
  segments,
  segmentOffsets,
  resultsBySeg,
  gramOverlay,
  udTokenMap,
  pageData
) {
  if (!wordSpans || !segments || !segmentOffsets) return;

  // Build word offsets using SAME iteration order as buildLayoutTextFromWords()
  // This must match exactly for character-level mapping to work
  var wordOffsets = [];
  var charPos = 0;
  var structuredBlocks =
    pageData && Array.isArray(pageData.structured_blocks) ? pageData.structured_blocks : null;
  var words = pageData && Array.isArray(pageData.words) ? pageData.words : pdfWords;
  if (structuredBlocks && structuredBlocks.length > 0) {
    // Sort blocks by Y position - MUST match buildLayoutTextFromWords and render loop
    var sortedBlocks = structuredBlocks.slice().sort(function (a, b) {
      return (a.min_y || 0) - (b.min_y || 0);
    });
    var spanIdx = 0;
    for (var bi = 0; bi < sortedBlocks.length; bi++) {
      if (bi > 0) charPos += 2; // '\n\n' paragraph break
      var block = sortedBlocks[bi];
      var lines = block.lines || [];
      for (var li = 0; li < lines.length; li++) {
        if (li > 0) charPos += 1; // '\n' line break
        var lineWords = lines[li].words || [];
        // Sort words by X within line - MUST match buildLayoutTextFromWords
        var sortedWords = lineWords.slice().sort(function (a, b) {
          return (a.x || 0) - (b.x || 0);
        });
        for (var wi = 0; wi < sortedWords.length; wi++) {
          var w = sortedWords[wi];
          if (!w || !w.text) {
            wordOffsets.push(null);
            spanIdx++;
            continue;
          }
          if (shouldInsertSpace(w, wi)) charPos += 1; // space between words
          var wtext = String(w.text);
          wordOffsets.push([charPos, charPos + wtext.length]);
          charPos += wtext.length;
          spanIdx++;
        }
      }
    }
  } else if (words && words.length > 0) {
    // Fallback: group words by Y, sort by X within each line
    // Compute median height
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

    // Build offsets: lines separated by \n, words sorted by X and separated by space
    for (var li = 0; li < lineGroups.length; li++) {
      if (li > 0) charPos += 1; // '\n' line break
      var lineWords = lineGroups[li].words;
      // Sort words by X within line
      lineWords.sort(function (a, b) {
        return (a.x || 0) - (b.x || 0);
      });
      for (var wi = 0; wi < lineWords.length; wi++) {
        var w = lineWords[wi];
        if (shouldInsertSpace(w, wi)) charPos += 1; // space between words
        var wtext = String(w.text);
        wordOffsets.push([charPos, charPos + wtext.length]);
        charPos += wtext.length;
      }
    }
  }

  // For each segment, find which word(s) it overlaps and apply annotations
  for (var si = 0; si < segments.length; si++) {
    var off = segmentOffsets[si];
    if (!off || off.length < 2) continue;
    var segStart = Number(off[0]);
    var segEnd = Number(off[1]);
    if (!isFinite(segStart) || !isFinite(segEnd)) continue;

    // Find all words this segment overlaps
    for (var wi = 0; wi < wordOffsets.length; wi++) {
      var woff = wordOffsets[wi];
      if (!woff) continue;
      var wStart = Number(woff[0]);
      var wEnd = Number(woff[1]);

      // Check overlap
      if (segStart < wEnd && segEnd > wStart) {
        var segText = String(segments[si] || '');
        if (!hasMyanmarChars(segText) || isMyanmarPunctToken(segText)) {
          continue;
        }
        var wordSpan = wordSpans[wi];
        if (!wordSpan) continue;

        // Persist the word's character-offset span in the synthetic layout text.
        // This is critical for mapping multiple Burmese segments back onto a single PDF "word" span.
        if (wordSpan.dataset.wordStart == null) wordSpan.dataset.wordStart = String(wStart);
        if (wordSpan.dataset.wordEnd == null) wordSpan.dataset.wordEnd = String(wEnd);

        // Apply grammar overlay if present
        if (gramOverlay && Array.isArray(gramOverlay)) {
          for (var gi = 0; gi < gramOverlay.length; gi++) {
            var gramToken = gramOverlay[gi];
            if (gramToken && gramToken.seg_i === si) {
              var posTag = gramToken.pos || '';
              if (posTag) {
                wordSpan.classList.add('pos-' + posTag);
                wordSpan.dataset.pos = posTag;
              }
            }
          }
        }

        // Apply known/unknown status from dictionary results
        if (resultsBySeg && resultsBySeg[si]) {
          var res = resultsBySeg[si];
          var hasKnown = typeof res.dict_fill_has_known === 'boolean' ? res.dict_fill_has_known : false;
          var dictFill = Array.isArray(res.dict_fill) ? res.dict_fill : [];
          if (!hasKnown && dictFill.length) hasKnown = true;
          if (hasKnown) {
            wordSpan.classList.add('seg-known');
          } else {
            wordSpan.classList.add('seg-unknown');
          }
        }

        // Make raw PDF span participate in the normal token UI by giving it the same hooks
        // the hover/click/overlay code expects.
        wordSpan.classList.add('reader-token');
        wordSpan.style.cursor = 'pointer';

        // Choose a canonical segment index for this span (used as a fallback when we can't resolve
        // which sub-segment within an island the pointer is on).
        if (!wordSpan.dataset.index || Number(si) < Number(wordSpan.dataset.index)) {
          wordSpan.dataset.index = String(si);
          wordSpan.dataset.seg = String(segments[si] || '');
        }

        // Ensure UD overlay / NER / dependency line rendering can locate an element for EACH segment.
        // In original PDF view, multiple segments may map to the same DOM span; that's fine.
        if (!dependencyState.udTokenIndex.has(si)) {
          registerTokenSpan(si, wordSpan);
        }

        // Store segment reference on the word span
        if (!wordSpan.dataset.segments) {
          wordSpan.dataset.segments = '';
        }
        if (!wordSpan.dataset.segments.includes(String(si))) {
          wordSpan.dataset.segments += (wordSpan.dataset.segments ? ',' : '') + String(si);
        }
      }
    }
  }

  // Second pass: split each absolute-positioned PDF word span into multiple interactive segment spans.
  // This is the key step that makes hover popups and overlays work properly when Burmese "islands" contain
  // multiple segmentation tokens.
  for (var wi2 = 0; wi2 < wordSpans.length; wi2++) {
    var ws = wordSpans[wi2];
    if (!ws) continue;
    var segCsv = ws.dataset.segments || '';
    if (!segCsv) continue;
    var wStart2 = parseInt(ws.dataset.wordStart || 'NaN', 10);
    var wEnd2 = parseInt(ws.dataset.wordEnd || 'NaN', 10);
    if (!isFinite(wStart2) || !isFinite(wEnd2) || wEnd2 <= wStart2) continue;
    var wText = ws.textContent || '';
    if (!wText) continue;
    var segList2 = segCsv
      .split(',')
      .map(function (x) {
        return parseInt(x, 10);
      })
      .filter(function (n) {
        return isFinite(n) && n >= 0;
      });
    if (!segList2.length) continue;

    // Sort by segment start offset
    segList2.sort(function (a, b) {
      var oa = segmentOffsets[a] || [0, 0];
      var ob = segmentOffsets[b] || [0, 0];
      return Number(oa[0]) - Number(ob[0]);
    });

    // Rebuild the content as a mixture of plain text nodes and interactive token spans
    var frag2 = document.createDocumentFragment();
    var cursor2 = 0;
    for (var si3 = 0; si3 < segList2.length; si3++) {
      var sIdx = segList2[si3];
      var off3 = segmentOffsets[sIdx];
      if (!off3 || off3.length < 2) continue;
      var s0 = Number(off3[0]);
      var s1 = Number(off3[1]);
      if (!isFinite(s0) || !isFinite(s1)) continue;

      // Local indices within this word's text
      var local0 = s0 - wStart2;
      var local1 = s1 - wStart2;
      if (local1 <= 0 || local0 >= wText.length) continue;
      if (local0 < 0) local0 = 0;
      if (local1 > wText.length) local1 = wText.length;

      // Fill any gap between previous piece and this segment
      if (local0 > cursor2) {
        frag2.appendChild(document.createTextNode(wText.slice(cursor2, local0)));
      }

      // Only build a full token span when the substring matches the segment text.
      // If it doesn't match (rare, usually due to synthetic whitespace/newlines), fall back to plain text.
      var piece = wText.slice(local0, local1);
      var segText = String(segments[sIdx] || '');
      var isMyanmarSeg = hasMyanmarChars(segText) && !isMyanmarPunctToken(segText);
      if (piece && segText && piece === segText && isMyanmarSeg) {
        var built = buildTokenSpan(sIdx, segText, gramOverlay || [], resultsBySeg || [], udTokenMap || {});
        // buildTokenSpan returns {span, hasGrammar, isUnknown}.
        frag2.appendChild(built.span);
        // Ensure the UD overlay can anchor per-segment geometry to the inner span (not the outer container)
        registerTokenSpan(sIdx, built.span);
      } else if (isMyanmarSeg) {
        // Plain text fallback; keep basic click target by making it a token span with minimal metadata.
        var fallback = document.createElement('span');
        fallback.className = 'reader-token';
        fallback.dataset.index = String(sIdx);
        fallback.dataset.seg = segText || piece;
        fallback.textContent = piece;
        frag2.appendChild(fallback);
        registerTokenSpan(sIdx, fallback);
      } else {
        frag2.appendChild(document.createTextNode(piece));
      }
      cursor2 = local1;
    }
    if (cursor2 < wText.length) {
      frag2.appendChild(document.createTextNode(wText.slice(cursor2)));
    }

    // The outer span is only a positioned container now; the real interactive spans are children.
    ws.classList.remove('reader-token');
    ws.style.cursor = 'default';
    ws.textContent = '';
    ws.appendChild(frag2);
  }
}
export function annotatePdfJsTextLayerSpans(
  wordSpans,
  segments,
  segmentOffsets,
  resultsBySeg,
  gramOverlay,
  udTokenMap
) {
  if (!wordSpans || !wordSpans.length || !segments || !segmentOffsets) return;
  var spanOffsets = [];
  var charPos = 0;
  for (var wi = 0; wi < wordSpans.length; wi++) {
    var ws = wordSpans[wi];
    if (!ws) continue;
    var txt = ws.textContent || '';
    var start = charPos;
    charPos += txt.length;
    spanOffsets.push([start, charPos]);
    ws.dataset.wordStart = String(start);
    ws.dataset.wordEnd = String(charPos);
    ws.dataset.segments = '';
  }
  for (var si = 0; si < segments.length; si++) {
    var off = segmentOffsets[si];
    if (!off || off.length < 2) continue;
    var segStart = Number(off[0]);
    var segEnd = Number(off[1]);
    if (!isFinite(segStart) || !isFinite(segEnd)) continue;
    var segText = String(segments[si] || '');
    if (!hasMyanmarChars(segText) || isMyanmarPunctToken(segText)) continue;
    for (var wi2 = 0; wi2 < wordSpans.length; wi2++) {
      var spanOff = spanOffsets[wi2];
      if (!spanOff) continue;
      var wStart = spanOff[0];
      var wEnd = spanOff[1];
      if (!(segStart < wEnd && segEnd > wStart)) continue;
      var wordSpan = wordSpans[wi2];
      if (!wordSpan) continue;
      if (!wordSpan.dataset.index || Number(si) < Number(wordSpan.dataset.index)) {
        wordSpan.dataset.index = String(si);
        wordSpan.dataset.seg = segText;
      }
      if (!wordSpan.dataset.segments) wordSpan.dataset.segments = '';
      if (!wordSpan.dataset.segments.includes(String(si))) {
        wordSpan.dataset.segments += (wordSpan.dataset.segments ? ',' : '') + String(si);
      }
      wordSpan.classList.add('reader-token');
      if (!dependencyState.udTokenIndex.has(si)) registerTokenSpan(si, wordSpan);
    }
  }
  for (var wi3 = 0; wi3 < wordSpans.length; wi3++) {
    var ws2 = wordSpans[wi3];
    if (!ws2) continue;
    var segCsv = ws2.dataset.segments || '';
    if (!segCsv) continue;
    var wStart2 = parseInt(ws2.dataset.wordStart || 'NaN', 10);
    var wEnd2 = parseInt(ws2.dataset.wordEnd || 'NaN', 10);
    if (!isFinite(wStart2) || !isFinite(wEnd2) || wEnd2 <= wStart2) continue;
    var wText = ws2.textContent || '';
    if (!wText) continue;
    var segList = segCsv
      .split(',')
      .map(function (x) {
        return parseInt(x, 10);
      })
      .filter(function (n) {
        return isFinite(n) && n >= 0;
      });
    if (!segList.length) continue;
    segList.sort(function (a, b) {
      var oa = segmentOffsets[a] || [0, 0];
      var ob = segmentOffsets[b] || [0, 0];
      return Number(oa[0]) - Number(ob[0]);
    });
    var frag = document.createDocumentFragment();
    var cursor = 0;
    for (var si2 = 0; si2 < segList.length; si2++) {
      var sIdx = segList[si2];
      var off2 = segmentOffsets[sIdx];
      if (!off2 || off2.length < 2) continue;
      var s0 = Number(off2[0]);
      var s1 = Number(off2[1]);
      if (!isFinite(s0) || !isFinite(s1)) continue;
      var local0 = s0 - wStart2;
      var local1 = s1 - wStart2;
      if (local1 <= 0 || local0 >= wText.length) continue;
      if (local0 < 0) local0 = 0;
      if (local1 > wText.length) local1 = wText.length;
      if (local0 > cursor) frag.appendChild(document.createTextNode(wText.slice(cursor, local0)));
      var piece = wText.slice(local0, local1);
      var segText2 = String(segments[sIdx] || '');
      var isMyanmarSeg = hasMyanmarChars(segText2) && !isMyanmarPunctToken(segText2);
      if (piece && segText2 && piece === segText2 && isMyanmarSeg) {
        var built = buildTokenSpan(sIdx, segText2, gramOverlay || [], resultsBySeg || [], udTokenMap || {});
        frag.appendChild(built.span);
        registerTokenSpan(sIdx, built.span);
      } else if (isMyanmarSeg) {
        var fallback = document.createElement('span');
        fallback.className = 'reader-token';
        fallback.dataset.index = String(sIdx);
        fallback.dataset.seg = segText2 || piece;
        fallback.textContent = piece;
        frag.appendChild(fallback);
        registerTokenSpan(sIdx, fallback);
      } else {
        frag.appendChild(document.createTextNode(piece));
      }
      cursor = local1;
    }
    if (cursor < wText.length) frag.appendChild(document.createTextNode(wText.slice(cursor)));
    ws2.classList.remove('reader-token');
    ws2.textContent = '';
    ws2.appendChild(frag);
  }
}
