import { renderSenseLines } from './dictionary-rendering.mjs';
import { hoverInteractionState } from './hover-interaction.state.mjs';
import { positionSidePanelPopup } from './popup-placement.mjs';
import { buildLookupUrl } from './preferences.mjs';
import { readerState } from './reader-state.state.mjs';
import { settingsState } from './settings-state.state.mjs';
import { escapeHtml } from './text.mjs';
export // SIMPLIFIED: Render dictionary popup for side panel hover
function renderDictPopupSimple(res, seg) {
  readerState.grammarPopup.style.display = 'none';
  readerState.hoverPopup.classList.remove('has-grammar');
  var head = res.head || seg;
  var senses = res.senses || [];

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
  var isUnk = isUnknownEntry(res);

  // Disable G2P pronunciation popup in side panel (pronunciation only in main window)
  if (readerState.g2pPopup) {
    readerState.g2pPopup.style.display = 'none';
    readerState.g2pPopup.innerHTML = '';
  }
  if (!settingsState.displaySettings.dictPopup) {
    readerState.hoverPopup.style.display = 'none';
    readerState.hoverPopupContainer.style.display = 'none';
    return;
  }
  var html = '';

  // Always black text for headword components
  html += '<div class="popup-headline">' + escapeHtml(head) + '</div>';

  // Show romanization if unknown
  if (isUnk && res.g2p && Array.isArray(res.g2p.syllables) && res.g2p.syllables.length) {
    html += '<div style="font-size:0.85em;color:#666;">';
    for (var si = 0; si < res.g2p.syllables.length; si++) {
      var syll = res.g2p.syllables[si];
      if (syll && syll.roman) html += escapeHtml(syll.roman) + ' ';
    }
    html += '</div>';
  }

  // Show senses if known
  if (!isUnk && senses.length) {
    html += renderSenseLines(senses, head);
  }
  readerState.hoverPopup.innerHTML = html;
  readerState.hoverPopup.style.display = 'block';

  // Show only dict popup (pronunciation disabled in side panel)
  readerState.hoverPopupContainer.style.display = settingsState.displaySettings.dictPopup
    ? 'flex'
    : 'none';
  positionSidePanelPopup(
    readerState.hoverPopupContainer,
    hoverInteractionState.lastMouseX,
    hoverInteractionState.lastMouseY
  );
}
export function setG2PPopup(g2pData) {
  if (!readerState.g2pPopup) return;
  if (g2pData && Array.isArray(g2pData.syllables) && settingsState.displaySettings.pronunciation) {
    readerState.g2pPopup.innerHTML = renderG2PBlock(g2pData, false);
    readerState.g2pPopup.style.display = 'block';
  } else {
    readerState.g2pPopup.style.display = 'none';
    readerState.g2pPopup.innerHTML = '';
  }
}
export function renderG2PBlock(g2pData, showTitle) {
  if (!g2pData || !Array.isArray(g2pData.syllables)) return '';
  var syllablesHtml = '';
  for (var i = 0; i < g2pData.syllables.length; i++) {
    var s = g2pData.syllables[i] || {};
    // Use the new components array for phonetic breakdown
    var parts = Array.isArray(s.components) ? s.components : [];
    // Build horizontal component boxes
    var compsHtml = '';
    parts.forEach(function (p) {
      if (!p || !p.ch) return;
      var label = p.label || '';
      compsHtml += '<div class="g2p-comp">';
      compsHtml += '<span class="g2p-comp-ch">' + escapeHtml(p.ch) + '</span>';
      if (label) compsHtml += '<span class="g2p-comp-label">' + escapeHtml(label) + '</span>';
      compsHtml += '</div>';
    });
    syllablesHtml += '<div class="g2p-syll">';
    syllablesHtml += '<div class="g2p-syll-head">';
    syllablesHtml += '<span class="g2p-syll-orth">' + escapeHtml(s.orth || '') + '</span>';
    if (s.roman) syllablesHtml += '<span class="g2p-syll-roman">' + escapeHtml(s.roman) + '</span>';
    syllablesHtml += '</div>';
    if (compsHtml) {
      syllablesHtml += '<div class="g2p-components">' + compsHtml + '</div>';
    }
    syllablesHtml += '</div>';
  }
  var titleHtml = showTitle === false ? '' : '<div class="g2p-title">Pronunciation</div>';
  return (
    '<div class="g2p-block">' + titleHtml + '<div class="g2p-syllables">' + syllablesHtml + '</div></div>'
  );
}
export function renderUnknownPopup(seg) {
  readerState.grammarPopup.style.display = 'none';
  readerState.hoverPopup.classList.remove('has-grammar');
  // Disable G2P pronunciation popup in side panel (pronunciation only in main window)
  if (readerState.g2pPopup) {
    readerState.g2pPopup.style.display = 'none';
    readerState.g2pPopup.innerHTML = '';
  }
  // Always black text, show romanization for unknown
  if (hoverInteractionState.lookupCache.has(seg)) {
    var cached = hoverInteractionState.lookupCache.get(seg);
    var html = '<div class="popup-headline">' + escapeHtml(seg) + '</div>';
    if (cached.g2p && Array.isArray(cached.g2p.syllables) && cached.g2p.syllables.length) {
      html += '<div style="font-size:0.85em;color:#666;">';
      for (var si = 0; si < cached.g2p.syllables.length; si++) {
        var syll = cached.g2p.syllables[si];
        if (syll && syll.roman) html += escapeHtml(syll.roman) + ' ';
      }
      html += '</div>';
    }
    readerState.hoverPopup.innerHTML = html;
  } else {
    var html = '<div class="popup-headline">' + escapeHtml(seg) + '</div>';
    readerState.hoverPopup.innerHTML = html;
    fetch(buildLookupUrl(seg))
      .then(function (resp) {
        return resp.json();
      })
      .then(function (data) {
        if (data.ok && data.results && data.results.length) {
          var res = data.results[0];
          var fullHtml = '<div class="popup-headline">' + escapeHtml(seg) + '</div>';
          if (res.g2p && Array.isArray(res.g2p.syllables) && res.g2p.syllables.length) {
            fullHtml += '<div style="font-size:0.85em;color:#666;">';
            for (var si = 0; si < res.g2p.syllables.length; si++) {
              var syll = res.g2p.syllables[si];
              if (syll && syll.roman) fullHtml += escapeHtml(syll.roman) + ' ';
            }
            fullHtml += '</div>';
          }
          readerState.hoverPopup.innerHTML = fullHtml;
        }
      })
      .catch(function () {
        // Keep initial html with just the heading
      });
  }
  readerState.hoverPopupContainer.style.display = 'flex';
  positionSidePanelPopup(
    readerState.hoverPopupContainer,
    hoverInteractionState.lastMouseX,
    hoverInteractionState.lastMouseY
  );
}
// ---------------- Flashcard UI (reading SRS) ----------------
