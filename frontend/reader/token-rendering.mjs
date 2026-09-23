import { uposColorForTag } from './chunk-highlighting.mjs';
import { dependencyState } from './dependency-state.state.mjs';
import { getNerLabelForSeg, nerLabelToUpos } from './entity-hover.mjs';
import { settingsState } from './settings-state.state.mjs';
import { getGrammarColor, isMyanmarPunctToken, needsDottedCircle } from './text.mjs';
import { textState } from './text.state.mjs';
export function buildDictIndex(results) {
  var map = new Map();
  if (!Array.isArray(results)) return map;
  for (var ri = 0; ri < results.length; ri++) {
    var res = results[ri];
    if (!res) continue;
    var head = (res.head || '').trim();
    if (head && !map.has(head)) map.set(head, []);
    if (head) map.get(head).push(res);
  }
  return map;
}
export function resolveSegmentPosData(segIdx, res, udTok) {
  var collapsedInfo =
    dependencyState.latestCollapsedSpanInfo && dependencyState.latestCollapsedSpanInfo[segIdx]
      ? dependencyState.latestCollapsedSpanInfo[segIdx]
      : null;
  var resolvedUdTok = udTok;
  if (!resolvedUdTok && collapsedInfo && collapsedInfo.udTok) {
    resolvedUdTok = collapsedInfo.udTok;
  }
  var upos = resolvedUdTok && resolvedUdTok.upos ? resolvedUdTok.upos : res && res.upos ? res.upos : '';
  var uposLabel =
    resolvedUdTok && resolvedUdTok.upos
      ? resolvedUdTok.upos
      : res && res.upos_label
        ? res.upos_label
        : res && res.upos
          ? res.upos
          : '';
  var uposColor =
    resolvedUdTok && resolvedUdTok.upos
      ? uposColorForTag(resolvedUdTok.upos)
      : res && res.upos_color
        ? res.upos_color
        : '';
  var dep = resolvedUdTok && resolvedUdTok.dep ? resolvedUdTok.dep : res && res.dep ? res.dep : '';
  var depLabel =
    resolvedUdTok && resolvedUdTok.dep
      ? resolvedUdTok.dep
      : res && res.dep_label
        ? res.dep_label
        : res && res.dep
          ? res.dep
          : '';
  var tag = resolvedUdTok && resolvedUdTok.tag ? resolvedUdTok.tag : res && res.tag ? res.tag : '';
  if (collapsedInfo && collapsedInfo.isFirst === false) {
    var spanNerLabel = getNerLabelForSeg(segIdx);
    var spanNerPos = nerLabelToUpos(spanNerLabel);
    if (spanNerPos) {
      upos = spanNerPos;
      uposLabel = spanNerPos;
      uposColor = uposColorForTag(spanNerPos);
    }
  } else if (!upos || String(upos).toUpperCase() === 'DEFAULT') {
    var nerLabel = getNerLabelForSeg(segIdx);
    var nerPos = nerLabelToUpos(nerLabel);
    if (nerPos) {
      upos = nerPos;
      uposLabel = nerPos;
      uposColor = uposColorForTag(nerPos);
    }
  }
  return {
    upos: upos,
    upos_label: uposLabel,
    upos_color: uposColor,
    dep: dep,
    dep_label: depLabel,
    tag: tag
  };
}
export function buildTokenSpan(i, seg, gramOverlay, resultsBySeg, udTokenMap, opts) {
  var span = document.createElement('span');
  span.className = 'reader-token';
  span.dataset.index = String(i);
  span.dataset.seg = seg;
  var options = opts || {};
  var lightweight = options.lightweight === true;
  // Myanmar punctuation tokens (၊/။) are kept for UD sentence boundaries but are non-interactive.
  if (isMyanmarPunctToken(seg)) {
    span.textContent = seg;
    span.classList.add('reader-punct');
    span.dataset.punct = '1';
    return {
      span: span,
      hasGrammar: false,
      isUnknown: false
    };
  }
  var needsDotted = needsDottedCircle(seg);
  // Tokens without a base consonant (bare diacritics, or only stacked consonants)
  // still get a dotted circle for display, but we no longer force them unknown.
  if (needsDotted) {
    span.textContent = textState.DOTTED_CIRCLE + seg;
    span.classList.add('damaged-token');
    span.dataset.damaged = '1';
    span.dataset.originalSeg = seg;
    // Continue so dict_fill can decide known/unknown.
  }
  var hasGrammar = false,
    isUnknown = false;
  var tInfo = gramOverlay[i] || {};
  var entries = Array.isArray(tInfo.grammar) ? tInfo.grammar : [];
  if (entries.length) {
    // Prefer a non-UNKNOWN entry if available
    var chosen =
      entries.find(function (e) {
        return e && e.type && e.type !== 'UNKNOWN';
      }) || entries[0];
    var type = chosen.type || chosen.category || 'MISC_FUNC';
    if (
      settingsState.displaySettings.grammarTypes &&
      settingsState.displaySettings.grammarTypes[type]
    ) {
      var color = getGrammarColor(type);
      span.classList.add('grammar-token');
      span.dataset.grammarType = type;
      span.style.borderBottom = '2px solid ' + color;
      span.style.paddingBottom = '2px';
      hasGrammar = true;
    }
  }
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
  var res = resultsBySeg && resultsBySeg[i] ? resultsBySeg[i] : null;
  if (res) {
    var fillHasKnown = typeof res.dict_fill_has_known === 'boolean' ? res.dict_fill_has_known : false;
    var fillHasUnknown = typeof res.dict_fill_has_unknown === 'boolean' ? res.dict_fill_has_unknown : false;
    var dictFill = Array.isArray(res.dict_fill) ? res.dict_fill : [];
    // Back-compat: infer fill coverage if flags are missing
    if (
      (typeof res.dict_fill_has_known !== 'boolean' || typeof res.dict_fill_has_unknown !== 'boolean') &&
      dictFill.length
    ) {
      for (var pi = 0; pi < dictFill.length; pi++) {
        if (isUnknownEntry(dictFill[pi])) fillHasUnknown = true;
        else fillHasKnown = true;
      }
    }
    // Last-resort: old heuristic on the token itself
    if (!fillHasKnown && !fillHasUnknown) {
      var pos = (res.pos || '').toLowerCase();
      var senses = res.senses || [];
      var looksUnknown =
        pos.indexOf('unknown') >= 0 ||
        (senses.length === 1 &&
          typeof senses[0] === 'string' &&
          senses[0].toLowerCase().indexOf('no dictionary entry') >= 0);
      if (looksUnknown) fillHasUnknown = true;
      else fillHasKnown = true;
    }

    // Highlight ONLY unknown shards instead of coloring the whole token red.
    // (If the entire token is unknown, we still color the whole token.)
    if (fillHasUnknown) isUnknown = true;
    if (lightweight) {
      span.textContent = needsDotted ? textState.DOTTED_CIRCLE + seg : seg;
      if (fillHasUnknown && !fillHasKnown) {
        span.classList.add('unknown-token');
      }
      return {
        span: span,
        hasGrammar: hasGrammar,
        isUnknown: isUnknown
      };
    }

    // Always create subtokens for all dict_fill entries to enable per-word hovering
    if (dictFill.length) {
      var joined = '';
      for (var di = 0; di < dictFill.length; di++) {
        joined += dictFill[di] && dictFill[di].head ? dictFill[di].head : '';
      }
      if (joined === seg) {
        span.textContent = '';
        for (var di2 = 0; di2 < dictFill.length; di2++) {
          var part = dictFill[di2] || {};
          var pHead = part.head || '';
          if (!pHead) continue;
          var sub = document.createElement('span');
          sub.className = 'reader-subtoken';
          if (isUnknownEntry(part)) sub.classList.add('unknown-subtoken');
          var displayHead = pHead;
          if (needsDotted && di2 === 0 && needsDottedCircle(pHead)) {
            displayHead = textState.DOTTED_CIRCLE + pHead;
          }
          sub.textContent = displayHead;
          sub.dataset.word = pHead;
          sub.dataset.fillIdx = String(di2);
          span.appendChild(sub);
        }
        if (!span.childNodes || !span.childNodes.length) {
          span.textContent = needsDotted ? textState.DOTTED_CIRCLE + seg : seg;
          span.classList.add('unknown-token');
        }
      } else {
        span.textContent = needsDotted ? textState.DOTTED_CIRCLE + seg : seg;
        span.classList.add('unknown-token');
      }
    } else {
      span.textContent = needsDotted ? textState.DOTTED_CIRCLE + seg : seg;
      if (fillHasUnknown && !fillHasKnown) {
        span.classList.add('unknown-token');
      }
    }
  } else {
    span.textContent = needsDotted ? textState.DOTTED_CIRCLE + seg : seg;
    span.classList.add('unknown-token');
    isUnknown = true;
  }
  return {
    span: span,
    hasGrammar: hasGrammar,
    isUnknown: isUnknown
  };
}

// Annotate raw PDF word spans with segment/NLP data
