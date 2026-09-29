import { renderSenseLines } from './dictionary-rendering.mjs';
import { hoverInteractionState } from './hover-interaction.state.mjs';
import { segmentBurmeseInElement } from './panel-interaction.mjs';
import { readerState } from './reader-state.state.mjs';
import { escapeHtml } from './text.mjs';
export // Segment a fuzzy headword into hoverable component spans
function segmentFuzzyHeadword(el) {
  var fHead = el.getAttribute('data-fuzzy-head');
  if (!fHead) return;
  fetch('/subsegments?token=' + encodeURIComponent(fHead))
    .then(function (resp) {
      return resp.json();
    })
    .then(function (data) {
      var components = [];
      if (data.ok && data.subsegments && data.subsegments.length >= 1) {
        components = data.subsegments;
        hoverInteractionState.subsegCache.set(fHead, components);
        for (var i = 0; i < components.length; i++) {
          var sub = components[i];
          if (sub && sub.head) hoverInteractionState.lookupCache.set(sub.head, sub);
        }
      } else {
        // Can't break down - use the word itself
        components = [
          {
            head: fHead
          }
        ];
      }
      // Replace content with hoverable spans
      var frag = document.createDocumentFragment();
      for (var ci = 0; ci < components.length; ci++) {
        var comp = components[ci];
        var compHead = comp.head || fHead;
        var span = document.createElement('span');
        span.className = 'headword-component';
        span.textContent = compHead;
        span.dataset.seg = compHead;
        frag.appendChild(span);
      }
      el.innerHTML = '';
      el.appendChild(frag);

      // Prefetch dict entries for fuzzy components so side-panel hover is not lazy.
      components.forEach(function (comp) {
        var compHead = comp && comp.head ? String(comp.head) : '';
        if (!compHead || hoverInteractionState.lookupCache.has(compHead)) return;
        fetch('/lookup_dp_only?q=' + encodeURIComponent(compHead))
          .then(function (resp) {
            return resp.json();
          })
          .then(function (d) {
            if (d && d.ok && d.results && d.results.length) {
              hoverInteractionState.lookupCache.set(compHead, d.results[0]);
            }
          })
          .catch(function () {});
      });
    })
    .catch(function () {
      // On error, make the whole word hoverable
      var span = document.createElement('span');
      span.className = 'headword-component';
      span.textContent = fHead;
      span.dataset.seg = fHead;
      el.innerHTML = '';
      el.appendChild(span);
    });
}
export function runSmartFuzzyMatching(baseToken, options) {
  // Distance-first fuzzy matching with unigram LM as tie-breaker.
  // Runs on the clicked token, then checks for larger island matches.
  var container = document.getElementById('dict-fuzzy-results');
  if (!container || !baseToken) return;
  var tokenIdx = -1;
  var cacheKey = null;
  var noIsland = !!(options && options.noIsland);
  var forceWholeToken = !!(options && options.forceWholeToken);
  if (forceWholeToken) {
    noIsland = true;
  }
  var unknownPiece = options && options.unknownPiece ? String(options.unknownPiece) : '';
  if (!unknownPiece) return;
  if (options && typeof options.segIdx === 'number' && isFinite(options.segIdx) && options.segIdx >= 0) {
    tokenIdx = options.segIdx;
    cacheKey =
      'seg:' + tokenIdx + (unknownPiece ? '|unk:' + unknownPiece : '') + (forceWholeToken ? '|force:1' : '');
  }
  if (cacheKey && hoverInteractionState.fuzzyCache.has(cacheKey)) {
    renderFuzzyResults(container, hoverInteractionState.fuzzyCache.get(cacheKey), baseToken);
    return;
  }
  function isMyanmarWordToken(tok) {
    if (!tok) return false;
    if (tok.indexOf('။') >= 0 || tok.indexOf('၊') >= 0) return false;
    for (var i = 0; i < tok.length; i++) {
      var cp = tok.charCodeAt(i);
      var isCore = cp >= 0x1000 && cp <= 0x109f;
      var isExtA = cp >= 0xa9e0 && cp <= 0xa9ff;
      var isExtB = cp >= 0xaa60 && cp <= 0xaa7f;
      if (!(isCore || isExtA || isExtB)) return false;
    }
    return true;
  }
  function buildIslandSpansFromOffsets(segments, offsets) {
    if (!segments || !offsets || segments.length !== offsets.length) return null;
    var spans = [];
    var islandStart = null;
    var prevEnd = null;
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var off = offsets[i];
      if (!off || off.length < 2 || !isMyanmarWordToken(seg)) {
        if (islandStart !== null) {
          spans.push([islandStart, i]);
          islandStart = null;
        }
        prevEnd = null;
        continue;
      }
      var s = Number(off[0]);
      var e = Number(off[1]);
      if (islandStart === null) {
        islandStart = i;
      } else if (prevEnd !== null && s !== prevEnd) {
        spans.push([islandStart, i]);
        islandStart = i;
      }
      prevEnd = e;
    }
    if (islandStart !== null) spans.push([islandStart, segments.length]);
    return spans;
  }

  // Extract island tokens from latestData
  var islandTokens = [];
  var tokenIdxInIsland = -1;
  if (!noIsland && readerState.latestData && Array.isArray(readerState.latestData.segments)) {
    var segments = readerState.latestData.segments;
    var islandSpans = null;
    if (
      Array.isArray(readerState.latestData.segment_offsets) &&
      readerState.latestData.segment_offsets.length === segments.length
    ) {
      islandSpans = buildIslandSpansFromOffsets(segments, readerState.latestData.segment_offsets);
    }
    if (!islandSpans || !islandSpans.length) {
      islandSpans = readerState.latestData.island_spans || [];
    }
    if (tokenIdx < 0 || tokenIdx >= segments.length) {
      // Find the index of this token (fallback by text match)
      for (var i = 0; i < segments.length; i++) {
        if (segments[i] === baseToken) {
          tokenIdx = i;
          break;
        }
      }
    }
    if (tokenIdx >= 0 && tokenIdx < segments.length) {
      // Find which island this token belongs to and extract all island tokens
      for (var si = 0; si < islandSpans.length; si++) {
        var span = islandSpans[si];
        var start = span[0],
          end = span[1];
        if (tokenIdx >= start && tokenIdx < end) {
          islandTokens = segments.slice(start, end);
          tokenIdxInIsland = tokenIdx - start;
          break;
        }
      }
    }
  }
  if (!cacheKey) {
    // Create cache key from base token + island
    cacheKey =
      baseToken +
      '|' +
      islandTokens.join(',') +
      '|' +
      tokenIdxInIsland +
      (unknownPiece ? '|unk:' + unknownPiece : '') +
      (forceWholeToken ? '|force:1' : '');
    if (hoverInteractionState.fuzzyCache.has(cacheKey)) {
      renderFuzzyResults(container, hoverInteractionState.fuzzyCache.get(cacheKey), baseToken);
      return;
    }
  }
  container.innerHTML = '<div class="dict-unknown">Finding spelling suggestions...</div>';
  fetch('/api/fuzzy_smart', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      base_token: baseToken,
      max_edit_distance: 2,
      max_suggestions: 10,
      island_tokens: islandTokens,
      token_idx_in_island: tokenIdxInIsland,
      unknown_piece: unknownPiece,
      force_whole_token: forceWholeToken
    })
  })
    .then(function (resp) {
      return resp.json();
    })
    .then(function (data) {
      if (!data || !data.ok) {
        container.innerHTML = '<div class="dict-unknown">[fuzzy unavailable]</div>';
        return;
      }

      // Cache the results
      hoverInteractionState.fuzzyCache.set(cacheKey, data);

      // Render the results
      renderFuzzyResults(container, data, baseToken);
    })
    .catch(function (err) {
      console.error('Fuzzy matching error:', err);
      container.innerHTML = '<div class="dict-unknown">[fuzzy request failed]</div>';
    });
}
export function renderFuzzyResults(container, data, baseToken) {
  var final = data.final || {};
  var groups = Array.isArray(data.groups) ? data.groups : [];
  var sugg = final.suggestions || [];
  var fuzziedStr = final.fuzzied_string || baseToken;
  var html = '<div class="dict-fuzzy-section"><div class="dict-fuzzy-header">FUZZY SUGGESTIONS</div>';
  if (data && typeof data.distance_used === 'number') {
    html +=
      '<div class="dict-unknown" style="margin-top:2px;font-size:0.85em;color:#666;">Edit distance: ' +
      escapeHtml(String(data.distance_used)) +
      '</div>';
  }
  if (final.removed_known && final.removed_known.length) {
    html +=
      '<div class="dict-unknown" style="margin-top:2px;font-size:0.85em;color:#666;">Subtracted known words: ' +
      final.removed_known.map(escapeHtml).join(', ') +
      '</div>';
  }
  if (final.kept_pieces && final.kept_pieces.length > 1) {
    html +=
      '<div class="dict-unknown" style="margin-top:2px;font-size:0.85em;color:#666;">Final word components: ' +
      final.kept_pieces.map(escapeHtml).join(' + ') +
      '</div>';
  }
  function buildEntryListHtml(list, label) {
    if (!list || !list.length) return '';
    var out = '';
    if (label) {
      out +=
        '<div class="dict-unknown" style="margin-top:6px;font-size:0.85em;color:#666;">' +
        escapeHtml(label) +
        '</div>';
    }
    var ordered = list.slice ? list.slice() : list;
    for (var si = 0; si < ordered.length; si++) {
      var fm = ordered[si] || {};
      var fHead = fm.head || fm.candidate || '';
      if (!fHead) continue;
      out += '<div class="dict-fuzzy-entry">';
      out +=
        '<span class="dict-fuzzy-head" data-fuzzy-head="' +
        escapeHtml(fHead) +
        '">' +
        escapeHtml(fHead) +
        '</span>';
      var fSenses = fm.senses || (fm.gloss ? [fm.gloss] : []);
      if (fSenses.length) {
        out += '<div class="dict-fuzzy-senses">' + renderSenseLines(fSenses, fHead) + '</div>';
      }
      out += '</div>';
    }
    return out;
  }
  if (groups.length) {
    for (var gi = 0; gi < groups.length; gi++) {
      var g = groups[gi] || {};
      var gTokens = Array.isArray(g.span_tokens) ? g.span_tokens : [];
      var gLabel = gTokens.length ? gTokens.join(' + ') : g.span_text || '';
      if (gLabel) {
        html += '<div class="dict-unknown" style="margin-top:6px;font-size:0.85em;color:#666;">';
        html += 'Tokens: ' + escapeHtml(gLabel);
        html += '</div>';
      }
      var gEntries = Array.isArray(g.entries) ? g.entries : [];
      html += buildEntryListHtml(gEntries, '');
    }
  } else if (sugg.length) {
    html += buildEntryListHtml(sugg, '');
  } else {
    html +=
      '<div class="dict-unknown">[no spelling suggestions found for "' + escapeHtml(fuzziedStr) + '"]</div>';
  }
  html += '</div>';
  container.innerHTML = html;
  var fuzzyHeadEls = container.querySelectorAll('.dict-fuzzy-head[data-fuzzy-head]');
  for (var fi = 0; fi < fuzzyHeadEls.length; fi++) {
    segmentFuzzyHeadword(fuzzyHeadEls[fi]);
  }
  var fuzzySenses = container.querySelectorAll('.dict-fuzzy-senses');
  for (var i = 0; i < fuzzySenses.length; i++) {
    segmentBurmeseInElement(fuzzySenses[i]);
  }
}
