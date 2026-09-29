import { renderSenseLines } from './dictionary-rendering.mjs';
import { runSmartFuzzyMatching } from './fuzzy-search.mjs';
import { hoverInteractionState } from './hover-interaction.state.mjs';
import { attachPanelHandlers, segmentBurmeseInElement } from './panel-interaction.mjs';
import { buildLookupUrl, buildLookupUrlRaw } from './preferences.mjs';
import { readerState } from './reader-state.state.mjs';
import { escapeHtml } from './text.mjs';
export // ===================== SIDE PANEL =====================
function lookupAndDisplay(token, options) {
  readerState.panelContent.innerHTML =
    '<div style="color:#888;text-align:center;margin-top:20px;">Loading...</div>';
  var useRaw = options && options.raw;
  var useExact = options && options.exact;
  var allowFuzzy = !(options && options.allowFuzzy === false);
  var fuzzyNoIsland = !!(options && options.noIsland);
  var fuzzySegIdx =
    options && typeof options.segIdx === 'number' && isFinite(options.segIdx) && options.segIdx >= 0
      ? options.segIdx
      : null;
  var fuzzyBaseToken = options && options.baseToken ? String(options.baseToken) : '';
  var fuzzyUnknownPiece = options && options.unknownPiece ? String(options.unknownPiece) : '';
  var fuzzyForceWholeToken = !!(options && options.forceWholeToken);
  var url = useRaw ? buildLookupUrlRaw(token, useExact) : buildLookupUrl(token);
  fetch(url)
    .then(function (resp) {
      return resp.json();
    })
    .then(function (data) {
      if (!data.ok || !data.results || !data.results.length) {
        if (useExact) {
          var unknownEntry = {
            head: token,
            pos: 'unknown',
            senses: ['[no dictionary entry found for this segment]']
          };
          var fullData = data || {};
          if (!allowFuzzy) fullData.disableFuzzy = true;
          if (allowFuzzy && !fuzzyUnknownPiece) {
            fuzzyUnknownPiece = token;
          }
          if (allowFuzzy && typeof fuzzySegIdx === 'number') {
            fullData.fuzzySegIdx = fuzzySegIdx;
          }
          if (allowFuzzy && fuzzyBaseToken) {
            fullData.fuzzyBaseToken = fuzzyBaseToken;
          }
          if (allowFuzzy && fuzzyUnknownPiece) {
            fullData.fuzzyUnknownPiece = fuzzyUnknownPiece;
          }
          if (allowFuzzy && fuzzyForceWholeToken) {
            fullData.fuzzyForceWholeToken = true;
          }
          if (allowFuzzy && fuzzyNoIsland) {
            fullData.fuzzyNoIsland = true;
          }
          displayDictEntry(unknownEntry, token, fullData);
          return;
        }
        readerState.panelContent.innerHTML =
          '<div style="color:#888;text-align:center;margin-top:20px;">No results for "' +
          escapeHtml(token) +
          '"</div>';
        return;
      }
      // Cache results
      if (data.results) {
        for (var i = 0; i < data.results.length; i++) {
          var r = data.results[i];
          if (r && r.head) hoverInteractionState.lookupCache.set(r.head, r);
        }
      }
      var fullData = data || {};
      if (!allowFuzzy) fullData.disableFuzzy = true;
      if (allowFuzzy && typeof fuzzySegIdx === 'number') {
        fullData.fuzzySegIdx = fuzzySegIdx;
      }
      if (allowFuzzy && fuzzyBaseToken) {
        fullData.fuzzyBaseToken = fuzzyBaseToken;
      }
      if (allowFuzzy && fuzzyUnknownPiece) {
        fullData.fuzzyUnknownPiece = fuzzyUnknownPiece;
      }
      if (allowFuzzy && fuzzyForceWholeToken) {
        fullData.fuzzyForceWholeToken = true;
      }
      if (allowFuzzy && fuzzyNoIsland) {
        fullData.fuzzyNoIsland = true;
      }
      displayDictEntry(data.results[0], token, fullData);
    })
    .catch(function (err) {
      console.error(err);
      readerState.panelContent.innerHTML =
        '<div style="color:#c00;text-align:center;margin-top:20px;">Error loading dictionary</div>';
    });
}
export function displayDictEntry(res, originalToken, fullData) {
  var head = res.head || originalToken;
  var senses = res.senses || [];
  var pos = (res.pos || '').toLowerCase();
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
  var dictFill = Array.isArray(res.dict_fill) ? res.dict_fill : [];
  var fillHasKnown = typeof res.dict_fill_has_known === 'boolean' ? res.dict_fill_has_known : false;
  var fillHasUnknown = typeof res.dict_fill_has_unknown === 'boolean' ? res.dict_fill_has_unknown : false;
  if (
    (typeof res.dict_fill_has_known !== 'boolean' || typeof res.dict_fill_has_unknown !== 'boolean') &&
    dictFill.length
  ) {
    for (var pi = 0; pi < dictFill.length; pi++) {
      if (isUnknownEntry(dictFill[pi])) fillHasUnknown = true;
      else fillHasKnown = true;
    }
  }
  var isUnk = fillHasUnknown || !fillHasKnown || isUnknownEntry(res);

  // Always fetch subsegments for the headword itself (for decomposability)
  // Cache server-provided dict_fill for canonical tokens
  if (dictFill.length) {
    for (var i = 0; i < dictFill.length; i++) {
      var sub = dictFill[i];
      if (sub && sub.head) hoverInteractionState.lookupCache.set(sub.head, sub);
    }
  }

  // Fetch subsegments for headword decomposition
  fetch('/subsegments?token=' + encodeURIComponent(head))
    .then(function (resp) {
      return resp.json();
    })
    .then(function (subData) {
      var headComponents = [];
      if (subData.ok && subData.subsegments && subData.subsegments.length >= 1) {
        headComponents = subData.subsegments;
        hoverInteractionState.subsegCache.set(head, headComponents);
        for (var i = 0; i < headComponents.length; i++) {
          var sub = headComponents[i];
          if (sub && sub.head) hoverInteractionState.lookupCache.set(sub.head, sub);
        }
      } else {
        headComponents = [res];
      }
      renderPanelEntry(res, head, senses, isUnk, headComponents, fullData);
    })
    .catch(function () {
      renderPanelEntry(res, head, senses, isUnk, [res], fullData);
    });
}
export function prefetchPanelComponentLookups(components) {
  if (!components || !components.length) return;
  components.forEach(function (comp) {
    var compHead = comp && comp.head ? String(comp.head) : '';
    if (!compHead || hoverInteractionState.lookupCache.has(compHead)) return;
    fetch('/lookup_dp_only?q=' + encodeURIComponent(compHead))
      .then(function (resp) {
        return resp.json();
      })
      .then(function (data) {
        if (data && data.ok && data.results && data.results.length) {
          hoverInteractionState.lookupCache.set(compHead, data.results[0]);
        }
      })
      .catch(function () {});
  });
}
// SIMPLIFIED: Render main dictionary entry in side panel
export function renderPanelEntry(res, head, senses, isUnk, headComponents, fullData) {
  // Helper to check if entry is unknown
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
  var html = '<div class="dict-entry">';

  // 1. HEADWORD: Render using subsegments (headComponents) for decomposition hover
  html += '<div class="dict-headword" style="font-weight:bold;">';

  // Always use headComponents (subsegments) for hoverable decomposition
  // Color code based on dict_fill info if available
  var dictFill = Array.isArray(res.dict_fill) ? res.dict_fill : [];
  var dictFillMap = {};
  for (var fi = 0; fi < dictFill.length; fi++) {
    var df = dictFill[fi];
    if (df && df.head) dictFillMap[df.head] = df;
  }
  for (var ci = 0; ci < headComponents.length; ci++) {
    var comp = headComponents[ci];
    var compHead = comp.head || head;
    // Main headword is RED if the entry is unknown (broken/misspelled word)
    // BLACK if it's a known word
    var headColor = isUnk ? '#c00' : '#000';
    html +=
      '<span class="headword-component" data-seg="' +
      escapeHtml(compHead) +
      '" style="color:' +
      headColor +
      ';">' +
      escapeHtml(compHead) +
      '</span>';
  }
  html += '</div>';

  // 2. ROMANIZATION: Show below headword if unknown
  if (isUnk && res.g2p && Array.isArray(res.g2p.syllables) && res.g2p.syllables.length) {
    html += '<div style="font-size:0.85em;color:#666;">';
    for (var si = 0; si < res.g2p.syllables.length; si++) {
      var syll = res.g2p.syllables[si];
      if (syll && syll.roman) html += escapeHtml(syll.roman) + ' ';
    }
    html += '</div>';
  }

  // 3. SENSES: Render definitions
  var hasContent = false;
  html += '<div class="dict-senses" id="dict-senses-container">';

  // If we have dict_fill entries, render each one
  if (dictFill.length) {
    for (var di = 0; di < dictFill.length; di++) {
      var part = dictFill[di] || {};
      var pHead = part.head || '';
      if (!pHead) continue;
      var pSenses = Array.isArray(part.senses) ? part.senses : [];
      var pUnk = isUnknownEntry(part);
      if (pUnk) {
        // Skip unknown parts that match the main headword (already shown above)
        if (pHead === head && isUnk) continue;

        // Unknown part: red text + romanization
        html += '<div style="margin-top:8px;color:#c00;font-weight:bold;">' + escapeHtml(pHead) + '</div>';
        if (part.g2p && Array.isArray(part.g2p.syllables) && part.g2p.syllables.length) {
          html += '<div style="font-size:0.85em;color:#666;">';
          for (var gi = 0; gi < part.g2p.syllables.length; gi++) {
            var gsyll = part.g2p.syllables[gi];
            if (gsyll && gsyll.roman) html += escapeHtml(gsyll.roman) + ' ';
          }
          html += '</div>';
        }
      } else {
        // Known part: heading + senses
        if (dictFill.length > 1) {
          html += '<div style="margin-top:8px;font-weight:bold;">' + escapeHtml(pHead) + '</div>';
        }
        if (pSenses.length) {
          html += renderSenseLines(pSenses, pHead);
          hasContent = true;
        }
      }
    }
  }
  // Fallback: use top-level senses if no dict_fill content
  else if (senses.length && !isUnk) {
    html += renderSenseLines(senses, head);
    hasContent = true;
  }
  html += '</div>';

  // 4. FUZZY MATCHING: Automatically run if there's unknown content
  var allowFuzzy = !(fullData && fullData.disableFuzzy);
  var hasUnknown =
    isUnk ||
    dictFill.some(function (p) {
      return isUnknownEntry(p);
    });
  var fuzzyUnknownPiece = fullData && fullData.fuzzyUnknownPiece ? fullData.fuzzyUnknownPiece : '';
  var fuzzyForceWholeToken = !!(fullData && fullData.fuzzyForceWholeToken);
  if (hasUnknown && allowFuzzy && fuzzyUnknownPiece) {
    html += '<div id="dict-fuzzy-results"></div>';
  }
  html += '</div>';
  readerState.panelContent.innerHTML = html;
  prefetchPanelComponentLookups(headComponents || []);
  // Segment Burmese text in senses
  var sensesContainer = document.getElementById('dict-senses-container');
  if (sensesContainer) {
    segmentBurmeseInElement(sensesContainer);
  }
  // Also segment fuzzy senses
  var fuzzySenses = readerState.panelContent.querySelectorAll('.dict-fuzzy-senses');
  for (var i = 0; i < fuzzySenses.length; i++) {
    segmentBurmeseInElement(fuzzySenses[i]);
  }
  attachPanelHandlers();

  // Auto-trigger fuzzy matching if there's unknown content
  if (hasUnknown && allowFuzzy && fuzzyUnknownPiece) {
    var fuzzyToken = fullData && fullData.fuzzyBaseToken ? fullData.fuzzyBaseToken : head;
    var fuzzyNoIsland = !!(fullData && fullData.fuzzyNoIsland);
    if (fullData && typeof fullData.fuzzySegIdx === 'number' && isFinite(fullData.fuzzySegIdx)) {
      runSmartFuzzyMatching(fuzzyToken, {
        segIdx: fullData.fuzzySegIdx,
        noIsland: fuzzyNoIsland,
        unknownPiece: fuzzyUnknownPiece,
        forceWholeToken: fuzzyForceWholeToken
      });
    } else if (fuzzyNoIsland) {
      runSmartFuzzyMatching(fuzzyToken, {
        noIsland: true,
        unknownPiece: fuzzyUnknownPiece,
        forceWholeToken: fuzzyForceWholeToken
      });
    } else {
      runSmartFuzzyMatching(fuzzyToken, {
        unknownPiece: fuzzyUnknownPiece,
        forceWholeToken: fuzzyForceWholeToken
      });
    }
  }
}
// Segment a fuzzy headword into hoverable component spans
