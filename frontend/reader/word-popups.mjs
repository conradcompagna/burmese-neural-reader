import { updateNotePopupForHead } from './annotations.mjs';
import { getUiRect, invalidateUiRectFor } from './dependency-geometry.mjs';
import { buildUdPopupHtml, getUdInfoForSegment } from './dependency-highlighting.mjs';
import { renderSenseLines } from './dictionary-rendering.mjs';
import { hoverInteractionState } from './hover-interaction.state.mjs';
import { hidePopup } from './popup-placement.mjs';
import { setG2PPopup } from './pronunciation-popups.mjs';
import { readerState } from './reader-state.state.mjs';
import { settingsState } from './settings-state.state.mjs';
import { escapeHtml, getGrammarColor } from './text.mjs';
import { resolveSegmentPosData } from './token-rendering.mjs';
export function buildPopupForWord(wordSpan, parentToken, segIdx, resultsBySeg, gramOverlay) {
  if (!wordSpan) return hidePopup();
  // Use dataset.word or dataset.seg (clean text without dotted circle) for pipeline operations
  var word = wordSpan.dataset.word || wordSpan.dataset.seg || wordSpan.textContent || '';
  if (!word) return hidePopup();

  // Handle grammar popup (from parent segment)
  var tInfo = segIdx >= 0 && gramOverlay ? gramOverlay[segIdx] || {} : {};
  var grammarEntries = Array.isArray(tInfo.grammar)
    ? tInfo.grammar.filter(function (g) {
        return g && g.type && g.type !== 'UNKNOWN';
      })
    : [];
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
  var dictHtml = '';
  var g2pData = null;
  var res = resultsBySeg && resultsBySeg[segIdx] ? resultsBySeg[segIdx] : null;
  var dictFill = res && Array.isArray(res.dict_fill) ? res.dict_fill : [];
  var fillIdx = wordSpan.dataset && wordSpan.dataset.fillIdx ? parseInt(wordSpan.dataset.fillIdx, 10) : -1;
  var entry = fillIdx >= 0 && dictFill[fillIdx] ? dictFill[fillIdx] : null;
  if (!entry && res) entry = res;
  if (!entry) return hidePopup();
  var udTok = getUdInfoForSegment(segIdx);
  var posData = resolveSegmentPosData(segIdx, res, udTok);
  dictHtml = '<div class="popup-headline">' + escapeHtml(word);
  // Add UPOS (coarse POS like NOUN, VERB) with colored background
  if (posData && posData.upos_label) {
    var uposStyle =
      'display:inline-block;padding:2px 6px;margin-left:6px;border-radius:3px;font-size:10px;font-weight:600;';
    if (posData.upos_color) {
      uposStyle += 'background-color:' + posData.upos_color + ';color:#000;';
    }
    dictHtml +=
      '<span class="pos-badge" title="Coarse POS (UPOS)" style="' +
      uposStyle +
      '">' +
      escapeHtml(posData.upos_label) +
      '</span>';
  }
  // Add dependency relation (mark, case, nsubj, ROOT, etc.) with gray background
  var depLabel = (posData && (posData.dep_label || posData.dep)) || '';
  if (!depLabel && udTok && udTok.dep) {
    depLabel = udTok.dep;
  }
  if (depLabel && depLabel.toLowerCase() === 'root') depLabel = 'ROOT';
  if (depLabel) {
    var depStyle =
      'display:inline-block;padding:2px 6px;margin-left:4px;border-radius:3px;font-size:10px;font-weight:500;background-color:#e5e7eb;color:#374151;';
    dictHtml +=
      '<span class="dep-badge" title="Dependency relation" style="' +
      depStyle +
      '">' +
      escapeHtml(depLabel) +
      '</span>';
  }
  dictHtml += '</div>';

  // Extract g2p from the individual word's entry
  g2pData = entry.g2p || null;
  var isUnknownEntry = function (obj) {
    if (!obj) return true;
    var p = (obj.pos || '').toLowerCase();
    var ss = obj.senses || [];
    return (
      p.indexOf('unknown') >= 0 ||
      (ss.length === 1 &&
        typeof ss[0] === 'string' &&
        ss[0].toLowerCase().indexOf('no dictionary entry') >= 0)
    );
  };
  if (!isUnknownEntry(entry)) {
    var senses = Array.isArray(entry.senses) ? entry.senses : [];
    if (senses.length) {
      dictHtml += renderSenseLines(senses, word);
    } else {
      dictHtml += '<div class="popup-empty">[no senses]</div>';
    }
  } else {
    // Unknown word - style the headline in red with romanization
    dictHtml =
      '<div class="popup-headline" style="color:#c00;font-weight:bold;">' + escapeHtml(word) + '</div>';
    if (g2pData && Array.isArray(g2pData.syllables) && g2pData.syllables.length) {
      dictHtml += '<div style="font-size:0.85em;color:#666;">';
      for (var si = 0; si < g2pData.syllables.length; si++) {
        var syll = g2pData.syllables[si];
        if (syll && syll.roman) dictHtml += escapeHtml(syll.roman) + ' ';
      }
      dictHtml += '</div>';
    }
  }
  displayWordPopup(dictHtml, word, segIdx, g2pData);
}
export function renderSubsegmentPopups(subsegments) {
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

  // Create popup elements for each subsegment (same as regular dict popup but no POS/dep tags)
  for (var i = 0; i < subsegments.length; i++) {
    var sub = subsegments[i];
    if (!sub || !sub.head) continue;
    var popupDiv = document.createElement('div');
    popupDiv.className = 'subsegment-popup';
    var html = '';

    // Headword (no POS or dep tags)
    html += '<div class="popup-headline">' + escapeHtml(sub.head) + '</div>';
    var isUnk = isUnknownEntry(sub);

    // Romanization if unknown
    if (isUnk && sub.g2p && Array.isArray(sub.g2p.syllables) && sub.g2p.syllables.length) {
      html += '<div style="font-size:0.85em;color:#666;">';
      for (var si = 0; si < sub.g2p.syllables.length; si++) {
        var syll = sub.g2p.syllables[si];
        if (syll && syll.roman) html += escapeHtml(syll.roman) + ' ';
      }
      html += '</div>';
    }

    // Senses if known
    if (!isUnk && Array.isArray(sub.senses) && sub.senses.length) {
      html += renderSenseLines(sub.senses, sub.head);
    }
    popupDiv.innerHTML = html;
    readerState.subsegmentPopupsContainer.appendChild(popupDiv);
  }

  // Show the container if we have subsegments
  if (readerState.subsegmentPopupsContainer.children.length > 0) {
    readerState.subsegmentPopupsContainer.style.display = 'flex';
    positionSubsegmentPopups();
  }
}
export function fetchAndDisplaySubsegmentPopups(word) {
  if (!word || !readerState.subsegmentPopupsContainer) return;

  // Clear existing subsegment popups
  readerState.subsegmentPopupsContainer.innerHTML = '';
  readerState.subsegmentPopupsContainer.style.display = 'none';

  // Check cache first to avoid lag
  if (hoverInteractionState.subsegCache.has(word)) {
    var cached = hoverInteractionState.subsegCache.get(word);
    if (cached && cached.length >= 1) {
      renderSubsegmentPopups(cached);
    }
    return;
  }

  // Fetch subsegments from server
  fetch('/subsegments?token=' + encodeURIComponent(word))
    .then(function (resp) {
      return resp.json();
    })
    .then(function (data) {
      if (!data.ok || !data.subsegments || data.subsegments.length < 1) {
        return;
      }
      var subsegments = data.subsegments;
      // Cache the result
      hoverInteractionState.subsegCache.set(word, subsegments);
      renderSubsegmentPopups(subsegments);
    })
    .catch(function (err) {
      console.error('Failed to fetch subsegments:', err);
    });
}
export function positionSubsegmentPopups() {
  if (!readerState.subsegmentPopupsContainer || !readerState.hoverPopupContainer) return;
  if (readerState.subsegmentPopupsContainer.style.display === 'none') return;
  if (readerState.hoverPopupContainer.style.display === 'none') return;
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  invalidateUiRectFor(readerState.hoverPopupContainer);
  var mainRect = getUiRect(readerState.hoverPopupContainer);
  var gap = 8;
  var pad = 8;

  // Start with vertical (column) layout
  readerState.subsegmentPopupsContainer.style.flexDirection = 'column';
  readerState.subsegmentPopupsContainer.style.flexWrap = 'nowrap';
  readerState.subsegmentPopupsContainer.style.left = '0px';
  readerState.subsegmentPopupsContainer.style.top = '0px';
  invalidateUiRectFor(readerState.subsegmentPopupsContainer);
  var subRect = getUiRect(readerState.subsegmentPopupsContainer);
  var subW = subRect.width;
  var subH = subRect.height;

  // If vertical layout is too tall, switch to horizontal (row)
  if (subH > vh - pad * 2) {
    readerState.subsegmentPopupsContainer.style.flexDirection = 'row';
    readerState.subsegmentPopupsContainer.style.flexWrap = 'wrap';
    invalidateUiRectFor(readerState.subsegmentPopupsContainer);
    subRect = getUiRect(readerState.subsegmentPopupsContainer);
    subW = subRect.width;
    subH = subRect.height;
  }

  // Try right of main popup first
  var x = mainRect.right + gap;
  var y = mainRect.top;

  // If goes off right edge, try left of main popup
  if (x + subW > vw - pad) {
    x = mainRect.left - gap - subW;
  }

  // If still off left edge, position at left edge
  if (x < pad) {
    x = pad;
  }

  // Vertical: keep on screen
  if (y + subH > vh - pad) {
    y = vh - pad - subH;
  }
  if (y < pad) {
    y = pad;
  }
  readerState.subsegmentPopupsContainer.style.left = x + 'px';
  readerState.subsegmentPopupsContainer.style.top = y + 'px';
}
export function displayWordPopup(dictHtml, word, segIdx, g2pData) {
  hoverInteractionState.currentPopupHead = word;
  if (settingsState.displaySettings.dictPopup) {
    readerState.hoverPopup.innerHTML = dictHtml;
    readerState.hoverPopup.style.display = 'block';
  } else {
    readerState.hoverPopup.style.display = 'none';
  }
  // Set pronunciation popup for the individual word
  setG2PPopup(g2pData);
  // UD popup for the parent segment
  if (readerState.udPopup) {
    if (settingsState.displaySettings.udPopup && segIdx >= 0) {
      var udHtml = buildUdPopupHtml(segIdx);
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
    updateNotePopupForHead(word);
  }
  // Fetch and display subsegment popups if enabled
  if (
    settingsState.displaySettings.subsegmentPopups &&
    readerState.subsegmentPopupsContainer &&
    word
  ) {
    fetchAndDisplaySubsegmentPopups(word);
  } else if (readerState.subsegmentPopupsContainer) {
    readerState.subsegmentPopupsContainer.style.display = 'none';
    readerState.subsegmentPopupsContainer.innerHTML = '';
  }
}
