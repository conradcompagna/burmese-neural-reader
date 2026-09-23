import { documentPaginationState } from './document-pagination.state.mjs';
export function buildDomTextModel(root) {
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: function (n) {
      if (!n || !n.nodeValue) return NodeFilter.FILTER_REJECT;
      var p = n.parentElement;
      if (p) {
        var tag = (p.tagName || '').toLowerCase();
        if (tag === 'script' || tag === 'style') return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  var index = [];
  var text = '';
  while (walker.nextNode()) {
    var node = walker.currentNode;
    var start = text.length;
    var s = node.nodeValue;
    text += s;
    index.push({
      node: node,
      start: start,
      len: s.length
    });
  }
  return {
    text: text,
    index: index,
    root: root
  };
}
export function locateDomPos(model, globalOffset) {
  var idx = model.index;
  var lo = 0,
    hi = idx.length - 1;
  while (lo <= hi) {
    var mid = (lo + hi) >> 1;
    var it = idx[mid];
    if (globalOffset < it.start) hi = mid - 1;
    else if (globalOffset >= it.start + it.len) lo = mid + 1;
    else
      return {
        node: it.node,
        offset: globalOffset - it.start
      };
  }
  if (globalOffset === model.text.length && idx.length) {
    var last = idx[idx.length - 1];
    return {
      node: last.node,
      offset: last.len
    };
  }
  throw new Error('Offset out of bounds: ' + globalOffset);
}
export function getVisibleDocxSliceClone(sourcePagerEl) {
  var host = sourcePagerEl ? sourcePagerEl.querySelector('.docx-preview-host') : null;
  if (!host)
    return {
      fragment: document.createDocumentFragment(),
      sliceRoot: null,
      sliceText: ''
    };
  var blocks = host.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, table');
  var pagerRect = sourcePagerEl.getBoundingClientRect();
  var overscanPx = 120;
  var topY = pagerRect.top - overscanPx;
  var botY = pagerRect.bottom + overscanPx;
  var frag = document.createDocumentFragment();
  var sliceWrap = document.createElement('div');
  sliceWrap.className = 'docx-slice-wrap';
  var kept = 0;
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    var r = b.getBoundingClientRect();
    if (r.bottom < topY) continue;
    if (r.top > botY) break;
    sliceWrap.appendChild(b.cloneNode(true));
    kept++;
  }
  if (!kept) sliceWrap.appendChild(host.cloneNode(true));
  frag.appendChild(sliceWrap);
  var model = buildDomTextModel(sliceWrap);
  return {
    fragment: frag,
    sliceRoot: sliceWrap,
    sliceText: model.text
  };
}

// Compute the visible text slice directly from the live docx-preview DOM (no clones).
export function getVisibleDocxSliceText(sourcePagerEl) {
  var host = sourcePagerEl ? sourcePagerEl.querySelector('.docx-preview-host') : null;
  if (!host)
    return {
      text: '',
      start: 0,
      end: 0,
      model: null
    };
  var model = buildDomTextModel(host);
  if (!model || !model.text)
    return {
      text: '',
      start: 0,
      end: 0,
      model: model
    };
  var textLength = model.text.length;
  if (!textLength)
    return {
      text: '',
      start: 0,
      end: 0,
      model: model
    };
  var containerRect = sourcePagerEl.getBoundingClientRect();
  var viewTop = containerRect.top;
  var viewBottom = containerRect.bottom;
  function getCharRect(globalIndex) {
    var safeIndex = Math.max(0, Math.min(globalIndex, textLength - 1));
    var pos = locateDomPos(model, safeIndex);
    if (!pos || !pos.node) return null;
    var nodeLen = pos.node.nodeValue ? pos.node.nodeValue.length : 0;
    if (!nodeLen) return null;
    var range = document.createRange();
    range.setStart(pos.node, pos.offset);
    range.setEnd(pos.node, Math.min(pos.offset + 1, nodeLen));
    var rects = range.getClientRects();
    if (rects && rects.length) return rects[0];
    return range.getBoundingClientRect();
  }
  function getCharTop(globalIndex) {
    var r = getCharRect(globalIndex);
    return r ? r.top : viewTop;
  }
  function getCharBottom(globalIndex) {
    var r = getCharRect(globalIndex);
    return r ? r.bottom : viewTop;
  }
  function findFirstPartiallyVisible() {
    var lo = 0,
      hi = textLength - 1;
    var result = 0;
    while (lo <= hi) {
      var mid = Math.floor((lo + hi) / 2);
      var y = getCharBottom(mid);
      if (y < viewTop) {
        lo = mid + 1;
      } else {
        result = mid;
        hi = mid - 1;
      }
    }
    return result;
  }
  function findLastPartiallyVisible() {
    var lo = 0,
      hi = textLength - 1;
    var result = textLength - 1;
    while (lo <= hi) {
      var mid = Math.floor((lo + hi) / 2);
      var y = getCharTop(mid);
      if (y > viewBottom) {
        hi = mid - 1;
      } else {
        result = mid;
        lo = mid + 1;
      }
    }
    return result;
  }
  function lineTolForIndex(idx) {
    var r = getCharRect(idx);
    var h = r && r.height ? r.height : 14;
    return Math.max(1, h * 0.35);
  }
  function findLineStart(idx) {
    var lineY = getCharTop(idx);
    var target = lineY - lineTolForIndex(idx);
    var lo = 0,
      hi = idx;
    var result = idx;
    while (lo <= hi) {
      var mid = Math.floor((lo + hi) / 2);
      var y = getCharTop(mid);
      if (y < target) {
        lo = mid + 1;
      } else {
        result = mid;
        hi = mid - 1;
      }
    }
    return result;
  }
  function findLineEnd(idx) {
    var lineY = getCharTop(idx);
    var target = lineY + lineTolForIndex(idx);
    var lo = idx,
      hi = textLength - 1;
    var result = idx;
    while (lo <= hi) {
      var mid = Math.floor((lo + hi) / 2);
      var y = getCharTop(mid);
      if (y > target) {
        hi = mid - 1;
      } else {
        result = mid;
        lo = mid + 1;
      }
    }
    return result + 1;
  }
  function getLineBounds(idx) {
    return {
      start: findLineStart(idx),
      end: findLineEnd(idx)
    };
  }
  function getLineVisibilityRatio(bounds) {
    if (!bounds) return 0;
    var start = bounds.start;
    var end = bounds.end;
    var endIdx = Math.max(start, Math.min(textLength - 1, end - 1));
    var lineTop = getCharTop(start);
    var lineBottom = getCharBottom(endIdx);
    var visibleTop = Math.max(lineTop, viewTop);
    var visibleBottom = Math.min(lineBottom, viewBottom);
    var visible = Math.max(0, visibleBottom - visibleTop);
    var height = Math.max(1, lineBottom - lineTop);
    return visible / height;
  }
  var firstPartial = findFirstPartiallyVisible();
  var lastPartial = findLastPartiallyVisible();
  if (firstPartial > lastPartial) {
    var fallback = Math.max(0, Math.min(textLength - 1, lastPartial));
    if (!isFinite(fallback) || fallback < 0 || fallback >= textLength) {
      fallback = Math.max(0, Math.min(textLength - 1, firstPartial));
    }
    firstPartial = fallback;
    lastPartial = fallback;
  }
  var topBounds = getLineBounds(firstPartial);
  var bottomBounds = getLineBounds(lastPartial);
  var topRatio = getLineVisibilityRatio(topBounds);
  var bottomRatio = getLineVisibilityRatio(bottomBounds);
  var startIdx = topBounds.start;
  var endIdx = bottomBounds.end;
  if (topRatio < documentPaginationState.DOC_LINE_VISIBILITY_THRESHOLD) startIdx = topBounds.end;
  if (bottomRatio < documentPaginationState.DOC_LINE_VISIBILITY_THRESHOLD) endIdx = bottomBounds.start;
  if (startIdx >= endIdx) {
    if (topRatio >= bottomRatio) {
      startIdx = topBounds.start;
      endIdx = topBounds.end;
    } else {
      startIdx = bottomBounds.start;
      endIdx = bottomBounds.end;
    }
  }
  var maxChars = documentPaginationState.WINDOWED_MAX_CHARS;
  var guard = 0;
  while (endIdx - startIdx > maxChars && guard < 200) {
    var prevLineStart = findLineStart(endIdx - 1);
    if (prevLineStart <= startIdx) break;
    endIdx = prevLineStart;
    guard++;
  }
  var visibleText = model.text.slice(startIdx, endIdx);
  if (visibleText.length > maxChars) visibleText = visibleText.slice(0, maxChars);
  return {
    text: visibleText,
    start: startIdx,
    end: endIdx,
    model: model
  };
}
export function buildVisibleDocxSliceFragment(sliceInfo) {
  if (!sliceInfo || !sliceInfo.model) {
    return {
      sliceRoot: null
    };
  }
  var model = sliceInfo.model;
  var start = Math.max(0, sliceInfo.start || 0);
  var end = Math.max(start, sliceInfo.end || 0);
  if (!model.text || !model.text.length || end <= start) {
    return {
      sliceRoot: null
    };
  }
  var wrap = document.createElement('div');
  // Preserve docx-preview styling in the lookup pane.
  wrap.className = 'docx-preview-host docx';
  try {
    var a = locateDomPos(model, start);
    var b = locateDomPos(model, end);
    var r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    var frag = r.cloneContents();
    wrap.appendChild(frag);
  } catch (e) {
    return {
      sliceRoot: null
    };
  }
  return {
    sliceRoot: wrap
  };
}
