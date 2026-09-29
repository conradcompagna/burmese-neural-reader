import { updateNotePopupForHead } from './annotations.mjs';
import { invalidateUiRectFor } from './dependency-geometry.mjs';
import { dependencyGeometryState } from './dependency-geometry.state.mjs';
import { buildUdPopupHtml, buildUdTagsForHeadline, getUdInfoForSegment } from './dependency-highlighting.mjs';
import { renderSenseLines } from './dictionary-rendering.mjs';
import { hoverInteractionState } from './hover-interaction.state.mjs';
import { popupPlacementState } from './popup-placement.state.mjs';
import { setG2PPopup } from './pronunciation-popups.mjs';
import { readerState } from './reader-state.state.mjs';
import { segmentRenderingState } from './segment-rendering.state.mjs';
import { settingsState } from './settings-state.state.mjs';
import { escapeHtml, getGrammarColor } from './text.mjs';
import { resolveSegmentPosData } from './token-rendering.mjs';
export function buildPopupForSpan(span, resultsBySeg, gramOverlay) {
  if (!span) return;
  var idx = parseInt(span.dataset.index || '-1', 10);
  var seg = span.dataset.seg || '';
  if (!seg || isNaN(idx)) {
    hidePopup();
    return;
  }
  var res = resultsBySeg && idx >= 0 ? resultsBySeg[idx] : null;
  var tInfo = gramOverlay[idx] || {};
  var grammarEntries = Array.isArray(tInfo.grammar)
    ? tInfo.grammar.filter(function (g) {
        return g && g.type && g.type !== 'UNKNOWN';
      })
    : [];
  var head = seg,
    g2pData = null;
  if (res) {
    head = res.head || seg;
    g2pData = res.g2p || null;
  }
  if (grammarEntries.length && settingsState.displaySettings.grammarPopup) {
    var grammarHtml = '';
    for (var gei = 0; gei < grammarEntries.length; gei++) {
      var ge = grammarEntries[gei];
      if (!ge) continue;
      var gType = ge.type || ge.category || '';
      var gColor = getGrammarColor(gType);
      grammarHtml += '<div class="popup-grammar-entry">';
      if (gType)
        grammarHtml +=
          '<span class="type" style="background:' +
          gColor +
          ';color:white;">' +
          escapeHtml(gType) +
          '</span>';
      grammarHtml += '<span>' + escapeHtml(ge.gloss || '') + '</span></div>';
    }
    readerState.grammarPopup.innerHTML = grammarHtml;
    readerState.grammarPopup.style.display = 'block';
    readerState.hoverPopup.classList.add('has-grammar');
  } else {
    readerState.grammarPopup.style.display = 'none';
    readerState.hoverPopup.classList.remove('has-grammar');
  }
  setG2PPopup(g2pData);

  // Determine if entry is unknown BEFORE building the headline
  var dictHtml = '';
  var mainIsUnknown = false;
  if (res && settingsState.displaySettings.dictPopup) {
    var firstD = res;
    function isUnknownEntry(obj) {
      if (!obj) return true;
      var p = (obj.pos || '').toLowerCase();
      var ss = obj.senses || [];
      return (
        p.indexOf('unknown') >= 0 ||
        (ss.length === 1 &&
          typeof ss[0] === 'string' &&
          ss[0].toLowerCase().indexOf('no dictionary entry') >= 0)
      );
    }
    var fill = Array.isArray(firstD.dict_fill) ? firstD.dict_fill : [];
    var fillHasKnown = typeof firstD.dict_fill_has_known === 'boolean' ? firstD.dict_fill_has_known : false;
    var fillHasUnknown =
      typeof firstD.dict_fill_has_unknown === 'boolean' ? firstD.dict_fill_has_unknown : false;
    if (
      (typeof firstD.dict_fill_has_known !== 'boolean' ||
        typeof firstD.dict_fill_has_unknown !== 'boolean') &&
      fill.length
    ) {
      for (var pi = 0; pi < fill.length; pi++) {
        if (isUnknownEntry(fill[pi])) fillHasUnknown = true;
        else fillHasKnown = true;
      }
    }

    // Check if main entry is unknown
    var hasKnownFill = fillHasKnown && fill.length > 0;
    var hasAnyContent = (Array.isArray(firstD.senses) ? firstD.senses.length : 0) || hasKnownFill;
    mainIsUnknown =
      (firstD.pos || '').toLowerCase().indexOf('unknown') >= 0 ||
      !hasAnyContent ||
      (fill.length && !fillHasKnown);
  }

  // Build headline with proper color for unknowns
  var udTok = getUdInfoForSegment(idx);
  var posData = resolveSegmentPosData(idx, res, udTok);
  if (mainIsUnknown && settingsState.displaySettings.dictPopup) {
    // Unknown entry - red headline + romanization (no POS/dep badges)
    dictHtml = '<div class="popup-headline" style="color:#c00;font-weight:bold;">' + escapeHtml(head);
    // Add UD tags (compound, noun, etc.) next to headword
    var udTags = buildUdTagsForHeadline(idx);
    if (udTags) dictHtml += udTags;
    dictHtml += '</div>';
    if (g2pData && Array.isArray(g2pData.syllables) && g2pData.syllables.length) {
      dictHtml += '<div style="font-size:0.85em;color:#666;">';
      for (var si = 0; si < g2pData.syllables.length; si++) {
        var syll = g2pData.syllables[si];
        if (syll && syll.roman) dictHtml += escapeHtml(syll.roman) + ' ';
      }
      dictHtml += '</div>';
    }
  } else {
    // Known entry - black headline with POS badge
    dictHtml = '<div class="popup-headline">' + escapeHtml(head);
    if (posData && posData.upos_label) {
      var uposStyleK =
        'display:inline-block;padding:2px 6px;margin-left:6px;border-radius:3px;font-size:10px;font-weight:600;';
      if (posData.upos_color) uposStyleK += 'background-color:' + posData.upos_color + ';color:#000;';
      dictHtml +=
        '<span class="pos-badge" title="Coarse POS (UPOS)" style="' +
        uposStyleK +
        '">' +
        escapeHtml(posData.upos_label) +
        '</span>';
    }
    var depLabelK = (posData && (posData.dep_label || posData.dep)) || '';
    if (depLabelK && depLabelK.toLowerCase() === 'root') depLabelK = 'ROOT';
    if (depLabelK) {
      var depStyleK =
        'display:inline-block;padding:2px 6px;margin-left:4px;border-radius:3px;font-size:10px;font-weight:500;background-color:#e5e7eb;color:#374151;';
      dictHtml +=
        '<span class="dep-badge" title="Dependency relation" style="' +
        depStyleK +
        '">' +
        escapeHtml(depLabelK) +
        '</span>';
    }
    // Add UD tags (compound, noun, etc.) next to headword
    var udTags = buildUdTagsForHeadline(idx);
    if (udTags) dictHtml += udTags;
    dictHtml += '</div>';

    // Add content for known entries
    if (res && settingsState.displaySettings.dictPopup) {
      var firstD = res;
      function isUnknownEntry(obj) {
        if (!obj) return true;
        var p = (obj.pos || '').toLowerCase();
        var ss = obj.senses || [];
        return (
          p.indexOf('unknown') >= 0 ||
          (ss.length === 1 &&
            typeof ss[0] === 'string' &&
            ss[0].toLowerCase().indexOf('no dictionary entry') >= 0)
        );
      }
      var fill = Array.isArray(firstD.dict_fill) ? firstD.dict_fill : [];
      var fillHasKnown = typeof firstD.dict_fill_has_known === 'boolean' ? firstD.dict_fill_has_known : false;
      var fillHasUnknown =
        typeof firstD.dict_fill_has_unknown === 'boolean' ? firstD.dict_fill_has_unknown : false;
      if (
        (typeof firstD.dict_fill_has_known !== 'boolean' ||
          typeof firstD.dict_fill_has_unknown !== 'boolean') &&
        fill.length
      ) {
        for (var pi = 0; pi < fill.length; pi++) {
          if (isUnknownEntry(fill[pi])) fillHasUnknown = true;
          else fillHasKnown = true;
        }
      }
      if (fill.length && fillHasKnown) {
        // Find the first known entry
        var firstKnownEntry = null;
        for (var di = 0; di < fill.length; di++) {
          if (!isUnknownEntry(fill[di])) {
            firstKnownEntry = fill[di];
            break;
          }
        }

        // Render only the first known entry
        if (firstKnownEntry) {
          var pHead = firstKnownEntry.head || '';
          var pSenses = Array.isArray(firstKnownEntry.senses) ? firstKnownEntry.senses : [];
          if (pHead && pHead !== head) {
            dictHtml += '<div style="font-weight:bold;margin-top:6px;">' + escapeHtml(pHead) + '</div>';
          }
          if (pSenses.length) {
            dictHtml += renderSenseLines(pSenses, head);
          }
        }

        // If ANY unknown content exists within the token, show fuzzy guesses for the whole token.
        if (fillHasUnknown) {
          dictHtml +=
            '<div class="popup-empty" style="margin-top:6px;">[contains unknown — click to run fuzzy]</div>';
        }
      } else {
        // Back-compat: old single-entry render path
        var senses = Array.isArray(firstD.senses) ? firstD.senses : [];
        if (senses.length) {
          dictHtml += renderSenseLines(senses, head);
        }
      }
    }
  }
  // Pronunciation stays in the dedicated G2P popup only
  hoverInteractionState.currentPopupHead = head;
  if (readerState.notePopup) {
    readerState.notePopup.textContent = '';
    readerState.notePopup.style.display = 'none';
  }
  if (readerState.udPopup) {
    if (settingsState.displaySettings.udPopup) {
      var udHtml = buildUdPopupHtml(idx);
      if (udHtml) {
        readerState.udPopup.innerHTML = udHtml;
        readerState.udPopup.style.display = 'block';
      } else {
        readerState.udPopup.style.display = 'none';
        readerState.udPopup.innerHTML = '';
      }
    } else {
      readerState.udPopup.style.display = 'none';
      readerState.udPopup.innerHTML = '';
    }
  }
  if (settingsState.displaySettings.dictPopup) {
    readerState.hoverPopup.innerHTML = dictHtml;
    readerState.hoverPopup.style.display = 'block';
  } else {
    readerState.hoverPopup.style.display = 'none';
  }
  // Show container if any popup is enabled
  var anyPopupVisible =
    (settingsState.displaySettings.pronunciation &&
      readerState.g2pPopup &&
      readerState.g2pPopup.style.display !== 'none') ||
    (settingsState.displaySettings.udPopup &&
      readerState.udPopup &&
      readerState.udPopup.style.display !== 'none') ||
    (settingsState.displaySettings.grammarPopup &&
      readerState.grammarPopup &&
      readerState.grammarPopup.style.display !== 'none') ||
    (settingsState.displaySettings.dictPopup &&
      readerState.hoverPopup &&
      readerState.hoverPopup.style.display !== 'none') ||
    settingsState.displaySettings.comments;
  readerState.hoverPopupContainer.style.display = anyPopupVisible ? 'flex' : 'none';
  if (settingsState.displaySettings.comments) {
    updateNotePopupForHead(head);
  }
}
export function positionPopup(clientX, clientY) {
  if (readerState.hoverPopupContainer.style.display !== 'flex') return;
  var vw = window.innerWidth,
    vh = window.innerHeight;

  // Refresh container rect to account for scrolling/layout changes
  // This is critical: udContainerRect is used for coordinate conversions,
  // and if stale, all positions will be offset by the scroll amount
  if (readerState.renderedText) {
    dependencyGeometryState.udContainerRect = readerState.renderedText.getBoundingClientRect();
  }
  readerState.hoverPopupContainer.style.left = '0px';
  readerState.hoverPopupContainer.style.top = '0px';
  invalidateUiRectFor(readerState.hoverPopupContainer);

  // Measure each visible popup individually (store relative positions) - DIRECT DOM
  var popups = [
    readerState.hoverPopup,
    readerState.grammarPopup,
    readerState.udPopup,
    readerState.g2pPopup,
    readerState.notePopup
  ];
  var popupRects = []; // Array of {left, top, width, height} relative to container origin
  var minLeft = Infinity,
    minTop = Infinity,
    maxRight = 0,
    maxBottom = 0;
  var hasVisiblePopup = false;
  for (var pi = 0; pi < popups.length; pi++) {
    var p = popups[pi];
    if (!p || p.style.display === 'none') continue;
    var pr = p.getBoundingClientRect();
    if (!pr || pr.width <= 0 || pr.height <= 0) continue;
    hasVisiblePopup = true;
    popupRects.push({
      left: pr.left,
      top: pr.top,
      width: pr.width,
      height: pr.height,
      right: pr.right,
      bottom: pr.bottom
    });
    if (pr.left < minLeft) minLeft = pr.left;
    if (pr.top < minTop) minTop = pr.top;
    if (pr.right > maxRight) maxRight = pr.right;
    if (pr.bottom > maxBottom) maxBottom = pr.bottom;
  }
  // If no visible popups, exit early
  if (!hasVisiblePopup) return;
  var w = maxRight - minLeft;
  var h = maxBottom - minTop;
  // Convert popup rects to be relative to the combined bounding box origin
  for (var pri = 0; pri < popupRects.length; pri++) {
    popupRects[pri].left -= minLeft;
    popupRects[pri].top -= minTop;
  }
  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }
  function rectsOverlap(a, b) {
    return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  }

  // no screen-bounds gating

  // Get hovered token rect - DIRECT DOM measurement for accuracy
  var anchorRect = null;
  try {
    var anchorTokenSpan = null;
    if (
      segmentRenderingState.currentSpan &&
      readerState.renderedText &&
      readerState.renderedText.contains(segmentRenderingState.currentSpan)
    ) {
      anchorTokenSpan = segmentRenderingState.currentSpan.classList.contains('reader-subtoken')
        ? segmentRenderingState.currentSpan.closest('.reader-token')
        : segmentRenderingState.currentSpan;
    }
    if (anchorTokenSpan) {
      var r = anchorTokenSpan.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) {
        anchorRect = {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom
        };
      }
    }
  } catch (e) {}

  // === COLLECT FORBIDDEN REGIONS (DOM-based for reliability) ===
  var forbiddenRegions = [];

  // 1. UD lines - query DOM directly for all visible .ud-dep-line paths
  var udLinePoints = [];
  var udLineThickness = 2;
  var udPaths = document.querySelectorAll('.ud-dep-line');
  for (var ei = 0; ei < udPaths.length; ei++) {
    var el = udPaths[ei];
    var lineKey = el.getAttribute('data-from-idx') + '-' + el.getAttribute('data-to-idx');
    try {
      var pathLen = el.getTotalLength();
      var sampleStep = 50;
      for (var t = 0; t <= pathLen; t += sampleStep) {
        var pt = el.getPointAtLength(t);
        var svgEl = el.ownerSVGElement;
        if (svgEl && svgEl.createSVGPoint) {
          var svgPoint = svgEl.createSVGPoint();
          svgPoint.x = pt.x;
          svgPoint.y = pt.y;
          var ctm = el.getScreenCTM();
          if (ctm) {
            var screenPoint = svgPoint.matrixTransform(ctm);
            udLinePoints.push({
              x: screenPoint.x,
              y: screenPoint.y,
              line: lineKey
            });
          }
        }
      }
    } catch (e) {}
  }

  // 2. Highlighted POS chunk tokens - query DOM for .chunk-active elements
  var chunkActiveEls = document.querySelectorAll('.chunk-active');
  var pad = 4;
  for (var hti = 0; hti < chunkActiveEls.length; hti++) {
    var r = chunkActiveEls[hti].getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) {
      forbiddenRegions.push({
        left: r.left - pad,
        top: r.top - pad,
        right: r.right + pad,
        bottom: r.bottom + pad
      });
    }
  }

  // 3. NER label chips - query DOM for .ner-label elements
  var nerLabels = document.querySelectorAll('.ner-label');
  var chipPad = 2;
  for (var ci = 0; ci < nerLabels.length; ci++) {
    var cr = nerLabels[ci].getBoundingClientRect();
    if (cr && cr.width > 0 && cr.height > 0) {
      forbiddenRegions.push({
        left: cr.left - chipPad,
        top: cr.top - chipPad,
        right: cr.right + chipPad,
        bottom: cr.bottom + chipPad
      });
    }
  }

  // 4. Hovered token + radius - HARD GUARD: popup can NEVER cover this area
  var tokenForbidden = null;
  if (anchorRect) {
    var rad = 10;
    tokenForbidden = {
      left: anchorRect.left - rad,
      top: anchorRect.top - rad,
      right: anchorRect.right + rad,
      bottom: anchorRect.bottom + rad
    };
  }

  // === HELPER: Check if any individual popup rect overlaps a region ===
  function anyPopupOverlapsRect(x, y, region) {
    for (var pi = 0; pi < popupRects.length; pi++) {
      var pr = popupRects[pi];
      var absRect = {
        left: x + pr.left,
        top: y + pr.top,
        right: x + pr.left + pr.width,
        bottom: y + pr.top + pr.height
      };
      if (rectsOverlap(absRect, region)) return true;
    }
    return false;
  }

  // === HELPER: Check if any popup rect overlaps a line point ===
  function anyPopupOverlapsLinePoint(x, y, pt) {
    for (var pi = 0; pi < popupRects.length; pi++) {
      var pr = popupRects[pi];
      var left = x + pr.left - udLineThickness;
      var right = x + pr.left + pr.width + udLineThickness;
      var top = y + pr.top - udLineThickness;
      var bottom = y + pr.top + pr.height + udLineThickness;
      if (pt.x >= left && pt.x <= right && pt.y >= top && pt.y <= bottom) return true;
    }
    return false;
  }

  // === HELPER: Check if any popup rect overflows viewport ===
  function anyPopupOverflowsViewport(x, y, margin) {
    for (var pi = 0; pi < popupRects.length; pi++) {
      var pr = popupRects[pi];
      if (x + pr.left < margin) return true;
      if (y + pr.top < margin) return true;
      if (x + pr.left + pr.width > vw - margin) return true;
      if (y + pr.top + pr.height > vh - margin) return true;
    }
    return false;
  }

  // === HELPER: Count how many things a position overlaps ===
  function countOverlaps(x, y) {
    var count = 0;

    // Count overlapping POS/NER regions (using individual popup rects)
    for (var i = 0; i < forbiddenRegions.length; i++) {
      if (anyPopupOverlapsRect(x, y, forbiddenRegions[i])) count++;
    }

    // Count overlapping UD line points (count per line)
    var hitLines = null;
    for (var i = 0; i < udLinePoints.length; i++) {
      var pt = udLinePoints[i];
      if (anyPopupOverlapsLinePoint(x, y, pt)) {
        if (!hitLines) hitLines = {};
        var key = pt.line || pt.x + ',' + pt.y;
        hitLines[key] = true;
      }
    }
    if (hitLines) count += Object.keys(hitLines).length;
    return count;
  }

  // === GENERATE GRID OF CANDIDATE POSITIONS ===
  var gridStep = 50;
  var margin = 4;

  // Token center for distance calculation
  var tokenCenterX = anchorRect ? (anchorRect.left + anchorRect.right) / 2 : clientX;
  var tokenCenterY = anchorRect ? (anchorRect.top + anchorRect.bottom) / 2 : clientY;

  // Two-pass selection:
  // Pass 1: Find closest non-overlapping position within viewport
  // Pass 2: If none found, find closest to token that doesn't overlap token, with least obstacle overlaps
  var bestX = null,
    bestY = null;
  var bestDistance = Infinity;
  var bestOverlaps = Infinity;
  var foundPerfect = false;

  // Iterate over grid positions
  for (var gx = margin; gx + w <= vw - margin; gx += gridStep) {
    for (var gy = margin; gy + h <= vh - margin; gy += gridStep) {
      // Check if any popup overflows viewport
      if (anyPopupOverflowsViewport(gx, gy, margin)) continue;

      // HARD GUARD: Skip positions where any popup would cover hovered token + 10px buffer
      if (tokenForbidden && anyPopupOverlapsRect(gx, gy, tokenForbidden)) continue;
      var overlaps = countOverlaps(gx, gy);

      // Calculate distance from popup center to token center
      var popupCenterX = gx + w / 2;
      var popupCenterY = gy + h / 2;
      var dx = popupCenterX - tokenCenterX;
      var dy = popupCenterY - tokenCenterY;
      var distance = Math.sqrt(dx * dx + dy * dy);
      if (overlaps === 0) {
        // Pass 1: Perfect position (no overlaps) - pick closest
        if (!foundPerfect || distance < bestDistance) {
          foundPerfect = true;
          bestDistance = distance;
          bestX = gx;
          bestY = gy;
        }
      } else if (!foundPerfect) {
        // Pass 2: No perfect position yet - pick by (least overlaps, then closest distance)
        if (overlaps < bestOverlaps || (overlaps === bestOverlaps && distance < bestDistance)) {
          bestDistance = distance;
          bestOverlaps = overlaps;
          bestX = gx;
          bestY = gy;
        }
      }
    }
  }
  if (bestX !== null && bestY !== null) {
    readerState.hoverPopupContainer.style.left = bestX + 'px';
    readerState.hoverPopupContainer.style.top = bestY + 'px';
  }
}
export // Track the actual hovered element
function positionSidePanelPopup(popupEl, clientX, clientY) {
  // Position popup to LEFT of hovered word - never cover the hovered word
  // No max distance constraint - popup can be anywhere as long as it doesn't cover the word
  if (!popupEl || popupEl.style.display === 'none') return;
  var vw = window.innerWidth,
    vh = window.innerHeight;
  var margin = 10;
  popupEl.style.left = '0px';
  popupEl.style.top = '0px';
  // DIRECT DOM measurement for accuracy
  var rect = popupEl.getBoundingClientRect();
  var w = rect ? rect.width : popupEl.offsetWidth || 0;
  var h = rect ? rect.height : popupEl.offsetHeight || 0;

  // Use the actual hovered element if we have it, otherwise search - DIRECT DOM
  var hoveredRect = null;
  try {
    if (popupPlacementState.lastHoveredElement) {
      var r = popupPlacementState.lastHoveredElement.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) {
        hoveredRect = {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height
        };
      }
    } else if (segmentRenderingState.panelHoverToken && readerState.panelContent) {
      var els = readerState.panelContent.querySelectorAll('.headword-component, .panel-token');
      for (var i = 0; i < els.length; i++) {
        if (els[i].dataset.seg === segmentRenderingState.panelHoverToken) {
          var r = els[i].getBoundingClientRect();
          if (r && r.width > 0 && r.height > 0) {
            hoveredRect = {
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height
            };
          }
          break;
        }
      }
    }
  } catch (e) {}
  var x, y;
  if (hoveredRect && hoveredRect.width > 0) {
    // Position to the LEFT of the hovered word (toward the main window)
    x = hoveredRect.left - w - margin;
    y = hoveredRect.top;

    // If left placement would go off screen, try below the word
    if (x < 8) {
      x = Math.max(8, hoveredRect.left);
      y = hoveredRect.bottom + margin;
      // If below also goes off screen, position above
      if (y + h > vh - 8) {
        y = Math.max(8, hoveredRect.top - h - margin);
      }
    } else {
      // Left placement worked, but check if y needs adjustment
      if (y + h > vh - 8) {
        y = vh - h - 8;
      }
      if (y < 8) {
        y = 8;
      }
    }
  } else {
    // Fallback: position near cursor, preferring left side
    x = clientX - w - margin;
    y = clientY;
    // Clamp to viewport
    if (x < 8) {
      x = clientX + margin; // Try right of cursor if left doesn't work
    }
    x = Math.max(8, Math.min(x, vw - w - 8));
    y = Math.max(8, Math.min(y, vh - h - 8));
  }
  popupEl.style.left = x + 'px';
  popupEl.style.top = y + 'px';
}
export function hidePopup() {
  readerState.hoverPopupContainer.style.display = 'none';
  readerState.grammarPopup.style.display = 'none';
  if (readerState.udPopup) {
    readerState.udPopup.style.display = 'none';
    readerState.udPopup.innerHTML = '';
  }
  if (readerState.g2pPopup) {
    readerState.g2pPopup.style.display = 'none';
    readerState.g2pPopup.innerHTML = '';
  }
  if (readerState.notePopup) {
    readerState.notePopup.style.display = 'none';
    readerState.notePopup.textContent = '';
  }
  if (readerState.subsegmentPopupsContainer) {
    readerState.subsegmentPopupsContainer.style.display = 'none';
    readerState.subsegmentPopupsContainer.innerHTML = '';
  }
}
// ===================== SIDE PANEL =====================
export function initializePopupPlacement() {
  popupPlacementState.lastHoveredElement = null;
  return true;
}
