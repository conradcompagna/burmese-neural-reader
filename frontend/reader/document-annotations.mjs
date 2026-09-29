import { registerTokenSpan } from './dependency-state.mjs';
import { dependencyState } from './dependency-state.state.mjs';
import { documentPaginationState } from './document-pagination.state.mjs';
import { needsDottedCircle } from './text.mjs';
import { textState } from './text.state.mjs';
import { buildTokenSpan } from './token-rendering.mjs';
export function applyOffsetsAsTokenSpansOnDom(sliceRoot, data) {
  if (!sliceRoot) return;
  var segments = Array.isArray(data.segments) ? data.segments : [];
  var gramOverlay =
    data.grammar_overlay && Array.isArray(data.grammar_overlay.tokens) ? data.grammar_overlay.tokens : [];
  var resultsBySeg = Array.isArray(data.results_by_seg) ? data.results_by_seg : [];
  var udTokenMap = dependencyState.latestUdTokenMap || {};
  var offsets = data && Array.isArray(data.segment_offsets) ? data.segment_offsets : null;
  if (!offsets || offsets.length !== segments.length) return;
  function splitTokenSpanByLines(span, segIdx) {
    if (!span || !span.parentNode) return;
    if (!(documentPaginationState.isOriginalView && documentPaginationState.currentFileType === 'docx'))
      return;
    if (!span.firstChild || span.childNodes.length !== 1 || span.firstChild.nodeType !== Node.TEXT_NODE)
      return;
    var rects = span.getClientRects ? span.getClientRects() : null;
    if (!rects || rects.length <= 1) return;
    var textNode = span.firstChild;
    var text = textNode.nodeValue || '';
    if (!text || text.length < 2) return;
    var range = document.createRange();
    var lastTop = null;
    var breakIdxs = [];
    for (var i = 0; i < text.length; i++) {
      range.setStart(textNode, i);
      range.setEnd(textNode, Math.min(i + 1, text.length));
      var rlist = range.getClientRects();
      var r = rlist && rlist.length ? rlist[0] : range.getBoundingClientRect();
      if (!r || !isFinite(r.top)) continue;
      if (lastTop == null) {
        lastTop = r.top;
      } else if (Math.abs(r.top - lastTop) > 0.5) {
        breakIdxs.push(i);
        lastTop = r.top;
      }
    }
    if (!breakIdxs.length) return;
    var pieces = [];
    var start = 0;
    for (var bi = 0; bi < breakIdxs.length; bi++) {
      var idx = breakIdxs[bi];
      if (idx > start) pieces.push(text.slice(start, idx));
      start = idx;
    }
    if (start < text.length) pieces.push(text.slice(start));
    if (!pieces.length) return;
    span.textContent = pieces[0];
    registerTokenSpan(segIdx, span);
    var parent = span.parentNode;
    var ref = span;
    for (var pi = 1; pi < pieces.length; pi++) {
      var piece = pieces[pi];
      if (!piece) continue;
      var clone = span.cloneNode(false);
      clone.textContent = piece;
      parent.insertBefore(clone, ref.nextSibling);
      ref = clone;
      registerTokenSpan(segIdx, clone);
    }
  }
  function forceTokenColor(el, color) {
    if (!el || !el.style) return;
    try {
      el.style.setProperty('color', color, 'important');
    } catch (e) {}
    var kids = el.querySelectorAll ? el.querySelectorAll('*') : [];
    for (var i = 0; i < kids.length; i++) {
      try {
        kids[i].style.setProperty('color', color, 'important');
      } catch (e2) {}
    }
  }

  // Walk text nodes in DOM order and map segments sequentially (no binary search).
  var textNodes = [];
  var walker = document.createTreeWalker(sliceRoot, NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      if (!node || !node.nodeValue) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  var tn = walker.nextNode();
  while (tn) {
    textNodes.push(tn);
    tn = walker.nextNode();
  }
  var segIdx = 0;
  var segCount = segments.length;
  var globalPos = 0;
  for (var ni = 0; ni < textNodes.length; ni++) {
    var node = textNodes[ni];
    var text = node.nodeValue || '';
    var nodeStart = globalPos;
    var nodeEnd = nodeStart + text.length;
    globalPos = nodeEnd;
    if (!text.length) continue;

    // Advance past segments that end before this node.
    while (segIdx < segCount) {
      var offSkip = offsets[segIdx];
      if (!offSkip || offSkip.length < 2) {
        segIdx++;
        continue;
      }
      var endSkip = Number(offSkip[1]);
      if (!isFinite(endSkip) || endSkip <= nodeStart) {
        segIdx++;
        continue;
      }
      break;
    }
    if (segIdx >= segCount) break;
    var firstOff = offsets[segIdx];
    if (!firstOff || firstOff.length < 2) continue;
    var firstStart = Number(firstOff[0]);
    if (!isFinite(firstStart) || firstStart >= nodeEnd) {
      continue; // No segment starts in this node
    }
    var frag = document.createDocumentFragment();
    var spansToSplit = [];
    var cursor = 0;
    var localSegIdx = segIdx;
    var didChange = false;
    while (localSegIdx < segCount) {
      var off = offsets[localSegIdx];
      if (!off || off.length < 2) {
        localSegIdx++;
        segIdx = localSegIdx;
        continue;
      }
      var segStart = Number(off[0]);
      var segEnd = Number(off[1]);
      if (!isFinite(segStart) || !isFinite(segEnd) || segEnd <= segStart) {
        localSegIdx++;
        segIdx = localSegIdx;
        continue;
      }
      if (segStart >= nodeEnd) break;
      var localStart = Math.max(segStart, nodeStart) - nodeStart;
      var localEnd = Math.min(segEnd, nodeEnd) - nodeStart;
      if (localEnd <= localStart) {
        if (segEnd <= nodeStart) {
          localSegIdx++;
          segIdx = localSegIdx;
          continue;
        }
        break;
      }
      if (localStart > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, localStart)));
      }
      var piece = text.slice(localStart, localEnd);
      if (piece.length) {
        var tokInfo = buildTokenSpan(
          localSegIdx,
          segments[localSegIdx],
          gramOverlay,
          resultsBySeg,
          udTokenMap,
          {
            lightweight: true
          }
        );
        var span = tokInfo && tokInfo.span ? tokInfo.span : null;
        if (span) {
          span.innerHTML = '';
          var needsDotted = needsDottedCircle(segments[localSegIdx]);
          var isFirstPart = segStart >= nodeStart;
          span.textContent = needsDotted && isFirstPart ? textState.DOTTED_CIRCLE + piece : piece;
          if (tokInfo && tokInfo.isUnknown) {
            span.dataset.hasUnknown = '1';
            if (
              documentPaginationState.isOriginalView &&
              documentPaginationState.currentFileType === 'docx' &&
              !span.classList.contains('unknown-token')
            ) {
              span.classList.add('unknown-token');
            }
            forceTokenColor(span, '#b91c1c');
          }
          frag.appendChild(span);
          registerTokenSpan(localSegIdx, span);
          spansToSplit.push({
            span: span,
            segIdx: localSegIdx
          });
        } else {
          frag.appendChild(document.createTextNode(piece));
        }
        didChange = true;
      }
      cursor = localEnd;
      if (segEnd <= nodeEnd) {
        localSegIdx++;
        segIdx = localSegIdx;
      } else {
        // Segment continues into next text node
        segIdx = localSegIdx;
        break;
      }
    }
    if (cursor < text.length) {
      frag.appendChild(document.createTextNode(text.slice(cursor)));
    }
    if (didChange && node.parentNode) {
      node.parentNode.replaceChild(frag, node);
      if (
        spansToSplit.length &&
        documentPaginationState.isOriginalView &&
        documentPaginationState.currentFileType === 'docx'
      ) {
        spansToSplit.forEach(function (item) {
          splitTokenSpanByLines(item.span, item.segIdx);
        });
      }
    }
  }
}
export function matchTokenWithInvisibleChars(source, startIndex, token) {
  // Frontend no longer does any normalization.
  // We only wrap tokens that are exact substrings of the original text.
  if (!token || !token.length) return null;
  var tLen = token.length;
  // Require an exact match starting at this position
  if (source.substr(startIndex, tLen) !== token) {
    return null;
  }
  return {
    end: startIndex + tLen - 1
  };
}
