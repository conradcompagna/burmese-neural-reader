import { ensureUdRectCache, getUiRect, invalidateUiRectFor } from './dependency-geometry.mjs';
import { dependencyGeometryState } from './dependency-geometry.state.mjs';
import { getTokenSpanList } from './dependency-state.mjs';
import { dependencyState } from './dependency-state.state.mjs';
import { readerState } from './reader-state.state.mjs';
import { settingsState } from './settings-state.state.mjs';
export function ensureNerHoverOverlay() {
  if (!readerState.renderedText) return;
  if (
    dependencyGeometryState.nerHoverOverlay &&
    dependencyGeometryState.nerHoverOverlay.parentNode !== readerState.renderedText
  ) {
    readerState.renderedText.appendChild(dependencyGeometryState.nerHoverOverlay);
  }
  if (dependencyGeometryState.nerHoverOverlay) return;
  dependencyGeometryState.nerHoverOverlay = document.createElement('div');
  dependencyGeometryState.nerHoverOverlay.id = 'ner-hover-overlay';
  readerState.renderedText.appendChild(dependencyGeometryState.nerHoverOverlay);
}
export function hideNerHover() {
  if (!dependencyGeometryState.nerHoverOverlay) return;
  dependencyGeometryState.nerHoverOverlay.innerHTML = '';
}
export function showHoverReticle(target) {
  if (!target || !readerState.renderedText) return;
  if (target === dependencyGeometryState.lastHoverReticleTarget) return;
  var segIdx = parseInt(
    target.dataset && target.dataset.index
      ? target.dataset.index
      : target.closest && target.closest('.reader-token')
        ? target.closest('.reader-token').dataset.index
        : '-1',
    10
  );
  if (
    dependencyGeometryState.lastHoverReticleTarget &&
    dependencyGeometryState.lastHoverReticleTarget !== target
  ) {
    dependencyGeometryState.lastHoverReticleTarget.classList.remove('hover-reticle-token');
  }
  target.classList.add('hover-reticle-token');
  dependencyGeometryState.lastHoverReticleSegIdx = segIdx;
  dependencyGeometryState.lastHoverReticleTarget = target;
}
export function hideHoverReticle() {
  if (dependencyGeometryState.lastHoverReticleTarget) {
    dependencyGeometryState.lastHoverReticleTarget.classList.remove('hover-reticle-token');
  }
  dependencyGeometryState.lastHoverReticleSegIdx = -1;
  dependencyGeometryState.lastHoverReticleTarget = null;
}
export function nerLabelToClass(label) {
  var lab = (label || '').toUpperCase();
  if (lab === 'PERSON' || lab === 'PER') return 'ner-label-person';
  if (lab === 'PLACE' || lab === 'LOC' || lab === 'GPE') return 'ner-label-place';
  if (lab === 'ORG' || lab === 'ORGANIZATION') return 'ner-label-org';
  if (lab === 'DATE') return 'ner-label-date';
  return 'ner-label-misc';
}
export function formatNerLabel(label) {
  var lab = (label || '').toUpperCase().trim();
  if (!lab) return 'ENT';
  if (lab === 'PERSON' || lab === 'PER' || lab === 'PNAME') return 'PERSON';
  if (lab === 'PLACE' || lab === 'LOC' || lab === 'GPE') return 'PLACE';
  if (lab === 'ORG' || lab === 'ORGANIZATION') return 'ORG';
  if (lab === 'DATE') return 'DATE';
  return lab;
}
export function getNerLabelForSeg(segIdx) {
  if (!dependencyState.latestNerSpans || !dependencyState.latestNerSpans.length) return '';
  for (var i = 0; i < dependencyState.latestNerSpans.length; i++) {
    var ent = dependencyState.latestNerSpans[i];
    if (!ent || typeof ent.start !== 'number' || typeof ent.end !== 'number') continue;
    if (segIdx >= ent.start && segIdx < ent.end) return ent.label || '';
  }
  return '';
}
export function nerLabelToUpos(label) {
  var lab = (label || '').toUpperCase();
  if (!lab) return '';
  if (lab === 'PNAME' || lab === 'PERSON' || lab === 'PER' || lab === 'NE') return 'PROPN';
  if (lab === 'LOC' || lab === 'PLACE' || lab === 'GPE') return 'PROPN';
  if (lab === 'ORG' || lab === 'ORGANIZATION') return 'PROPN';
  if (lab === 'RACE') return 'PROPN';
  if (lab === 'TIME' || lab === 'DATE') return 'NOUN';
  if (lab === 'NUM') return 'NUM';
  return '';
}
export function renderNerHoverForToken(segIdx) {
  ensureNerHoverOverlay();
  dependencyGeometryState.nerHoverOverlay.innerHTML = '';
  if (!settingsState.displaySettings.nerOverlay) return;
  if (!dependencyState.latestNerSpans || !dependencyState.latestNerSpans.length) return;
  var hits = dependencyState.latestNerSpans.filter(function (ent) {
    return (
      ent &&
      typeof ent.start === 'number' &&
      typeof ent.end === 'number' &&
      segIdx >= ent.start &&
      segIdx < ent.end
    );
  });
  if (!hits.length) return;
  ensureUdRectCache();
  var containerRect = dependencyGeometryState.udContainerRect;
  if (!containerRect) return;
  function rectFromDomRect(r) {
    return {
      left: r.left - containerRect.left,
      top: r.top - containerRect.top,
      width: r.width,
      height: r.height,
      right: r.left - containerRect.left + r.width,
      bottom: r.top - containerRect.top + r.height
    };
  }
  function getRectsForSeg(seg) {
    var rects = [];
    var spans = getTokenSpanList(seg);
    if (spans && spans.length) {
      for (var i = 0; i < spans.length; i++) {
        var el = spans[i];
        if (!el || typeof el.getBoundingClientRect !== 'function') continue;
        var r = el.getBoundingClientRect();
        if (!r || r.width <= 0 || r.height <= 0) continue;
        rects.push(rectFromDomRect(r));
      }
    }
    if (!rects.length) {
      var cached = dependencyState.udTokenRectCache.get(seg);
      if (cached) rects.push(cached);
    }
    return rects;
  }

  // Pre-compute all UD line obstacles once (avoid repeated querySelectorAll and path sampling)
  var allLineObstaclesByEdge = new Map(); // key: "fromIdx-toIdx", value: array of obstacle rects
  if (
    settingsState.displaySettings.udOverlay &&
    dependencyGeometryState.udActivePaths &&
    dependencyGeometryState.udActivePaths.length
  ) {
    try {
      var els = dependencyGeometryState.udActivePaths;
      for (var ei = 0; ei < els.length; ei++) {
        var el = els[ei];
        if (!el || !el.classList || !el.classList.contains('ud-dep-line')) continue;
        var fromIdx = parseInt(el.getAttribute('data-from-idx'), 10);
        var toIdx = parseInt(el.getAttribute('data-to-idx'), 10);
        if (!isFinite(fromIdx) || !isFinite(toIdx)) continue;
        var edgeKey = fromIdx + '-' + toIdx;
        var edgeObstacles = [];
        if (typeof el.getTotalLength === 'function' && typeof el.getPointAtLength === 'function') {
          var total = el.getTotalLength();
          if (total && isFinite(total)) {
            var samples = Math.max(6, Math.min(24, Math.ceil(total / 40)));
            var step = total / samples;
            for (var s = 0; s <= samples; s++) {
              var pt = el.getPointAtLength(s * step);
              if (!pt) continue;
              var pad = 2;
              edgeObstacles.push({
                left: pt.x - pad,
                top: pt.y - pad,
                right: pt.x + pad,
                bottom: pt.y + pad
              });
            }
          }
        } else {
          try {
            var b = el.getBBox();
            if (b && b.width > 0 && b.height > 0) {
              var pad = 2;
              edgeObstacles.push({
                left: b.x - pad,
                top: b.y - pad,
                right: b.x + b.width + pad,
                bottom: b.y + b.height + pad
              });
            }
          } catch (e2) {}
        }
        if (edgeObstacles.length) {
          allLineObstaclesByEdge.set(edgeKey, {
            fromIdx: fromIdx,
            toIdx: toIdx,
            obstacles: edgeObstacles
          });
        }
      }
    } catch (e) {}
  }

  // Collect obstacles for a specific entity span (uses pre-computed data)
  function collectLineObstaclesForEnt(ent) {
    var obstacles = [];
    if (!allLineObstaclesByEdge.size) return obstacles;
    if (!ent || typeof ent.start !== 'number' || typeof ent.end !== 'number') return obstacles;
    allLineObstaclesByEdge.forEach(function (data) {
      var touchesSpan =
        (data.fromIdx >= ent.start && data.fromIdx < ent.end) ||
        (data.toIdx >= ent.start && data.toIdx < ent.end);
      if (touchesSpan) {
        for (var oi = 0; oi < data.obstacles.length; oi++) {
          obstacles.push(data.obstacles[oi]);
        }
      }
    });
    return obstacles;
  }
  var placed = [];
  hits.forEach(function (ent) {
    var lineObstacles = collectLineObstaclesForEnt(ent);
    var startRects = getRectsForSeg(ent.start);
    var endRects = getRectsForSeg(ent.end - 1);
    var startRect = startRects && startRects.length ? startRects[0] : null;
    var endRect = endRects && endRects.length ? endRects[0] : null;
    if (!startRect || !endRect) return;
    var startLeft = startRect.left;
    var startTop = startRect.top;
    var left = startLeft;
    var right = endRect.left + endRect.width;
    var anchorCenter = (left + right) / 2;
    var center = anchorCenter;
    var anchorTop = Math.min(startRect.top, endRect.top);
    var segRects = [];
    for (var si3 = ent.start; si3 < ent.end; si3++) {
      var rectList = getRectsForSeg(si3);
      for (var ri = 0; ri < rectList.length; ri++) {
        var r = rectList[ri];
        if (!r) continue;
        segRects.push({
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom
        });
      }
    }
    segRects.sort(function (a, b) {
      if (a.top === b.top) return a.left - b.left;
      return a.top - b.top;
    });
    var lineRects = [];
    var lineTol = 4;
    for (var ri = 0; ri < segRects.length; ri++) {
      var rr = segRects[ri];
      var lastLine = lineRects.length ? lineRects[lineRects.length - 1] : null;
      if (lastLine && Math.abs(rr.top - lastLine.top) <= lineTol) {
        lastLine.left = Math.min(lastLine.left, rr.left);
        lastLine.right = Math.max(lastLine.right, rr.right);
        lastLine.top = Math.min(lastLine.top, rr.top);
        lastLine.bottom = Math.max(lastLine.bottom, rr.bottom);
      } else {
        lineRects.push({
          left: rr.left,
          right: rr.right,
          top: rr.top,
          bottom: rr.bottom
        });
      }
    }
    if (lineRects.length > 1) {
      anchorCenter = startLeft + startRect.width / 2;
      center = anchorCenter;
      anchorTop = startTop;
    }
    var chip = document.createElement('div');
    var labelText = formatNerLabel(ent.label);
    chip.className = 'ner-label ' + nerLabelToClass(ent.label);
    chip.style.left = center + 'px';
    chip.style.top = '0px';
    chip.textContent = labelText;
    chip.setAttribute('data-ner-label', labelText);
    chip.title = ent.text || '';
    dependencyGeometryState.nerHoverOverlay.appendChild(chip);
    invalidateUiRectFor(chip);
    var chipRect = getUiRect(chip);
    var chipW = chipRect.width;
    var chipH = chipRect.height;
    var chipColor = window.getComputedStyle(chip).backgroundColor;
    var halfW = chipW / 2;
    var padX = 6;
    var containerW = containerRect.width || 0;
    if (containerW > 0 && padX * 2 + chipW <= containerW) {
      var minCenter = padX + halfW;
      var maxCenter = containerW - padX - halfW;
      if (center < minCenter) center = minCenter;
      if (center > maxCenter) center = maxCenter;
    }
    chip.style.left = center + 'px';
    var leftPx = center - halfW;
    var rightPx = center + halfW;
    var tailSize = 7;
    var gap = 1;
    var top = anchorTop - chipH - tailSize;
    function overlapsHoriz(ob) {
      return !(rightPx < ob.left || leftPx > ob.right);
    }
    lineObstacles.forEach(function (ob) {
      if (!overlapsHoriz(ob)) return;
      var candidate = ob.top - chipH - tailSize - gap;
      if (candidate < top) top = candidate;
    });
    placed.forEach(function (ob) {
      if (!overlapsHoriz(ob)) return;
      var candidate = ob.top - chipH - gap;
      if (candidate < top) top = candidate;
    });
    var minTop = 2;
    if (readerState.dropZone && typeof readerState.dropZone.getBoundingClientRect === 'function') {
      var inputRect = getUiRect(readerState.dropZone);
      if (inputRect && isFinite(inputRect.bottom)) {
        var safePad = 4;
        var allowedTop = inputRect.bottom + safePad - containerRect.top;
        if (allowedTop < minTop) minTop = allowedTop;
      }
    }
    if (top < minTop) top = minTop;
    chip.style.top = top + 'px';
    var tailH = Math.max(tailSize, anchorTop - (top + chipH));
    chip.style.setProperty('--ner-tail-h', tailH + 'px');
    var tailX = anchorCenter - leftPx;
    var tailPad = 4;
    if (tailX < tailPad) tailX = tailPad;
    if (tailX > chipW - tailPad) tailX = chipW - tailPad;
    chip.style.setProperty('--ner-tail-x', tailX + 'px');

    // Add caliper bracket for any NER span
    if (ent.end > ent.start) {
      if (lineRects.length <= 1) {
        var caliper = document.createElement('div');
        caliper.className = 'ner-caliper';
        caliper.style.left = left - 1 + 'px';
        caliper.style.width = right - left + 2 + 'px';
        caliper.style.top = anchorTop - 4 + 'px';
        caliper.style.height = '3px';
        if (chipColor) {
          caliper.style.borderColor = chipColor;
        }
        dependencyGeometryState.nerHoverOverlay.appendChild(caliper);
      } else {
        for (var li = 0; li < lineRects.length; li++) {
          var lineRect = lineRects[li];
          var caliperLine = document.createElement('div');
          caliperLine.className = 'ner-caliper';
          caliperLine.style.left = lineRect.left - 1 + 'px';
          caliperLine.style.width = lineRect.right - lineRect.left + 2 + 'px';
          caliperLine.style.top = lineRect.top - 4 + 'px';
          caliperLine.style.height = '3px';
          if (chipColor) {
            caliperLine.style.borderColor = chipColor;
          }
          dependencyGeometryState.nerHoverOverlay.appendChild(caliperLine);
        }
      }
    }
    placed.push({
      left: leftPx,
      right: rightPx,
      top: top,
      bottom: top + chipH
    });
  });
}
