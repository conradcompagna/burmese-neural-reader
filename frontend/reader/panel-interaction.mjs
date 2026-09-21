import { hoverInteractionState } from './hover-interaction.state.mjs';
import { hidePopup, positionSidePanelPopup } from './popup-placement.mjs';
import { popupPlacementState } from './popup-placement.state.mjs';
import { buildLookupUrl } from './preferences.mjs';
import { renderDictPopupSimple, renderUnknownPopup } from './pronunciation-popups.mjs';
import { readerState } from './reader-state.state.mjs';
import { segmentRenderingState } from './segment-rendering.state.mjs';
import { escapeHtml, isMyanmarChar, isMyanmarPunctToken } from './text.mjs';
export function segmentBurmeseInElement(el) {
  // Find all text nodes with Myanmar
  var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
  var textNodes = [];
  var n;
  while ((n = walker.nextNode())) {
    if (n.nodeValue && /[\u1000-\u109F]/.test(n.nodeValue)) {
      textNodes.push(n);
    }
  }
  textNodes.forEach(function (textNode) {
    var text = textNode.nodeValue;
    if (!text) return;
    // Extract Myanmar spans
    var parts = [];
    var i = 0;
    while (i < text.length) {
      if (isMyanmarChar(text[i])) {
        var start = i;
        while (i < text.length && (isMyanmarChar(text[i]) || /[\u104A\u104B]/.test(text[i]))) {
          i++;
        }
        parts.push({
          type: 'myanmar',
          text: text.slice(start, i)
        });
      } else {
        var start = i;
        while (i < text.length && !isMyanmarChar(text[i])) {
          i++;
        }
        parts.push({
          type: 'other',
          text: text.slice(start, i)
        });
      }
    }
    // For Myanmar parts, segment via API
    var myanmarParts = parts.filter(function (p) {
      return p.type === 'myanmar' && p.text.trim();
    });
    if (!myanmarParts.length) return;
    var promises = myanmarParts.map(function (p) {
      var url = '/lookup_dp_only?q=' + encodeURIComponent(p.text || '');
      return fetch(url)
        .then(function (resp) {
          return resp.json();
        })
        .then(function (data) {
          p.segments = data.segments || [];
          p.results = data.results || [];
          p.results_by_seg = data.results_by_seg || {};
          // Cache results
          if (data.results) {
            for (var ri = 0; ri < data.results.length; ri++) {
              var r = data.results[ri];
              if (r && r.head) hoverInteractionState.lookupCache.set(r.head, r);
            }
          }
        })
        .catch(function () {
          p.segments = [];
          p.results = [];
          p.results_by_seg = {};
        });
    });
    Promise.all(promises).then(function () {
      var frag = document.createDocumentFragment();
      for (var pi = 0; pi < parts.length; pi++) {
        var part = parts[pi];
        if (part.type === 'other') {
          frag.appendChild(document.createTextNode(part.text));
        } else {
          // Wrap segmented tokens
          var segs = part.segments || [];
          var resultsBySeg = part.results_by_seg || {};
          var txt = part.text;
          if (segs.length) {
            var idx = 0;
            for (var si = 0; si < segs.length; si++) {
              var seg = segs[si];
              var pos = txt.indexOf(seg, idx);
              if (pos > idx) {
                frag.appendChild(document.createTextNode(txt.slice(idx, pos)));
              }
              if (pos >= 0) {
                // Skip Myanmar punctuation - don't wrap it
                if (isMyanmarPunctToken(seg)) {
                  frag.appendChild(document.createTextNode(seg));
                  idx = pos + seg.length;
                  continue;
                }

                // Check if this segment has dict_fill (multiword token)
                var res = resultsBySeg[si] || null;
                var dictFill = res && Array.isArray(res.dict_fill) ? res.dict_fill : [];
                if (dictFill.length > 0) {
                  // MULTIWORD TOKEN: Create sub-spans for each dict entry
                  for (var di = 0; di < dictFill.length; di++) {
                    var fillEntry = dictFill[di];
                    var fillHead = fillEntry.head || '';
                    if (!fillHead) continue;
                    var subspan = document.createElement('span');
                    subspan.className = 'panel-token';
                    subspan.textContent = fillHead;
                    subspan.dataset.seg = fillHead;
                    frag.appendChild(subspan);

                    // Cache the fill entry for hover lookup
                    if (fillEntry) hoverInteractionState.lookupCache.set(fillHead, fillEntry);
                  }
                } else {
                  // SINGLE-WORD TOKEN: One span for the whole segment
                  var span = document.createElement('span');
                  span.className = 'panel-token';
                  span.textContent = seg;
                  span.dataset.seg = seg;
                  frag.appendChild(span);
                }
                idx = pos + seg.length;
              }
            }
            if (idx < txt.length) {
              frag.appendChild(document.createTextNode(txt.slice(idx)));
            }
          } else {
            frag.appendChild(document.createTextNode(txt));
          }
        }
      }
      if (textNode.parentNode) {
        textNode.parentNode.replaceChild(frag, textNode);
      }
    });
  });
}
export function attachPanelHandlers() {
  readerState.panelContent.onmousemove = function (ev) {
    hoverInteractionState.lastMouseX = ev.clientX;
    hoverInteractionState.lastMouseY = ev.clientY;
    // Check if hovering a headword component (main or fuzzy)
    var componentEl = ev.target && ev.target.closest('.headword-component');
    if (componentEl) {
      var seg = componentEl.dataset.seg;
      popupPlacementState.lastHoveredElement = componentEl; // Track the actual element
      if (seg && seg !== segmentRenderingState.panelHoverToken) {
        segmentRenderingState.panelHoverToken = seg;
        hoverInteractionState.panelHoverType = 'headword-component';
        showDictPopupSimple(seg);
      }
      positionSidePanelPopup(
        readerState.hoverPopupContainer,
        hoverInteractionState.lastMouseX,
        hoverInteractionState.lastMouseY
      );
      return;
    }
    // Check if hovering panel token (definition body words)
    var tokenEl = ev.target && ev.target.closest('.panel-token');
    if (tokenEl) {
      var seg = tokenEl.dataset.seg;
      popupPlacementState.lastHoveredElement = tokenEl; // Track the actual element
      if (seg && seg !== segmentRenderingState.panelHoverToken) {
        segmentRenderingState.panelHoverToken = seg;
        hoverInteractionState.panelHoverType = 'token';
        showDictPopupSimple(seg);
      }
      positionSidePanelPopup(
        readerState.hoverPopupContainer,
        hoverInteractionState.lastMouseX,
        hoverInteractionState.lastMouseY
      );
      return;
    }
    segmentRenderingState.panelHoverToken = null;
    hoverInteractionState.panelHoverType = null;
    popupPlacementState.lastHoveredElement = null;
    hidePopup();
  };
  readerState.panelContent.onmouseleave = function () {
    segmentRenderingState.panelHoverToken = null;
    hoverInteractionState.panelHoverType = null;
    popupPlacementState.lastHoveredElement = null;
    hidePopup();
  };
}
// Show simple dict popup (NO fuzzy matches)
export function showDictPopupSimple(seg) {
  var cached = hoverInteractionState.lookupCache.get(seg);
  if (cached) {
    // If unknown and no g2p, fetch to get g2p
    var isUnk =
      !cached.senses ||
      !cached.senses.length ||
      (cached.pos && cached.pos.toLowerCase().indexOf('unknown') >= 0) ||
      (cached.senses.length === 1 &&
        typeof cached.senses[0] === 'string' &&
        cached.senses[0].toLowerCase().indexOf('no dictionary entry') >= 0);
    if (isUnk && !cached.g2p) {
      fetch(buildLookupUrl(seg))
        .then(function (resp) {
          return resp.json();
        })
        .then(function (data) {
          if (data.ok && data.results && data.results.length) {
            var res = data.results[0];
            hoverInteractionState.lookupCache.set(seg, res);
            renderDictPopupSimple(res, seg);
          } else {
            renderDictPopupSimple(cached, seg);
          }
        })
        .catch(function () {
          renderDictPopupSimple(cached, seg);
        });
      return;
    }
    renderDictPopupSimple(cached, seg);
    return;
  }
  fetch(buildLookupUrl(seg))
    .then(function (resp) {
      return resp.json();
    })
    .then(function (data) {
      if (data.ok && data.results && data.results.length) {
        var res = data.results[0];
        hoverInteractionState.lookupCache.set(seg, res);
        renderDictPopupSimple(res, seg);
      } else {
        renderUnknownPopup(seg);
      }
    })
    .catch(function () {
      renderUnknownPopup(seg);
    });
}
// Wrap component words in an element with hoverable spans
export function wrapComponentWords(seg, components) {
  var html = '';
  for (var i = 0; i < components.length; i++) {
    var comp = components[i];
    var compHead = comp.head || '';
    if (compHead) {
      html +=
        '<span class="panel-token" data-seg="' +
        escapeHtml(compHead) +
        '">' +
        escapeHtml(compHead) +
        '</span>';
    }
  }
  return html;
}
// SIMPLIFIED: Render dictionary popup for side panel hover
