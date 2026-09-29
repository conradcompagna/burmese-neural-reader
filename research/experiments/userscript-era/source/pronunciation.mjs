import { isMyanmarChar } from './graphemes.mjs';
import { pronunciationState } from './pronunciation.state.mjs';
export // ADDED: Helper to check if G2P syllable is valid (not garbage)
function isValidG2PSyllable(syl) {
  if (!syl) return false;
  const orth = syl.orth || '';
  const roman = syl.roman || '';

  // If no roman, it's not useful
  if (!roman || !roman.trim()) return false;

  // If roman is just the orth repeated (G2P failed), skip it
  if (roman.trim() === orth.trim()) return false;

  // If orth contains no Myanmar chars, it's garbage
  if (![...orth].some(isMyanmarChar)) return false;
  return true;
}

// ADDED: Group G2P syllables by segments
export function groupSyllablesBySegments(syllables, segments) {
  if (!syllables || !syllables.length) return [];
  if (!segments || !segments.length) {
    // No segments, return all syllables as one group
    return [syllables.filter(isValidG2PSyllable)];
  }
  const groups = [];
  let syllIdx = 0;
  for (const seg of segments) {
    const group = [];
    let accum = '';
    const segNorm = seg.replace(/\s/g, '');
    while (syllIdx < syllables.length) {
      const syl = syllables[syllIdx];
      const orth = (syl.orth || '').replace(/\s/g, '');

      // Check if adding this syllable would exceed segment length
      if (accum.length >= segNorm.length) break;
      if (isValidG2PSyllable(syl)) {
        group.push(syl);
      }
      accum += orth;
      syllIdx++;

      // If we've matched the segment, move on
      if (accum.length >= segNorm.length) break;
    }
    if (group.length > 0) {
      groups.push(group);
    }
  }

  // Any remaining valid syllables
  const remaining = syllables.slice(syllIdx).filter(isValidG2PSyllable);
  if (remaining.length > 0) {
    groups.push(remaining);
  }
  return groups;
}

// MODIFIED: Build G2P layer with syllables grouped by segments, handling unknown pronunciations
export function buildG2PLayerHtml(g2p, segments) {
  if (!g2p || !Array.isArray(g2p.syllables)) {
    return '';
  }

  // Build mapping of which segments have valid G2P
  const segmentG2PMap = new Map(); // segment -> array of valid syllables

  if (segments && segments.length) {
    let syllIdx = 0;
    for (const seg of segments) {
      const group = [];
      let accum = '';
      const segNorm = seg.replace(/\s/g, '');
      while (syllIdx < g2p.syllables.length) {
        const syl = g2p.syllables[syllIdx];
        const orth = (syl.orth || '').replace(/\s/g, '');
        if (accum.length >= segNorm.length) break;
        if (isValidG2PSyllable(syl)) {
          group.push(syl);
        }
        accum += orth;
        syllIdx++;
        if (accum.length >= segNorm.length) break;
      }
      segmentG2PMap.set(seg, group);
    }
  }
  const overall = g2p.overall_roman || '';
  let h =
    '<div class="bh-g2p-layer" ' +
    'style="padding:4px 8px 6px 8px;border-bottom:1px solid #eee;' +
    'background:#fafafa;font-size:12px;line-height:1.5;text-align:center;">';
  if (overall) {
    h +=
      '<div class="bh-g2p-overall" style="text-align:center;">' +
      '<span style="font-weight:600;margin-right:4px;">Pronunciation:</span>' +
      '<span class="bh-g2p-roman" style="font-style:italic;color:#444;">' +
      overall +
      '</span></div>';
  }

  // Render syllables grouped by segment with spacing between groups
  h +=
    '<div class="bh-g2p-syllables" ' +
    'style="margin-top:3px;display:flex;flex-wrap:wrap;gap:0;justify-content:center;align-items:center;">';
  let globalIdx = 0;
  let groupIdx = 0;
  if (segments && segments.length) {
    for (const seg of segments) {
      // Add spacing between groups (word boundaries)
      if (groupIdx > 0) {
        h += '<span style="width:10px;display:inline-block;"></span>';
      }
      const group = segmentG2PMap.get(seg) || [];
      if (group.length === 0) {
        // No valid G2P for this segment - show token in red only
        h +=
          '<span class="bh-g2p-syll bh-g2p-unknown" ' +
          'style="padding:2px 4px;border-radius:3px;border:1px solid #fca5a5;' +
          'cursor:default;background:#fef2f2;margin:0;color:#ef4444;font-weight:600;">' +
          seg +
          '</span>';
      } else {
        // Render syllables within group flush (no margin)
        group.forEach((syl, sylIdx) => {
          const orth = syl.orth || '';
          const roman = syl.roman || '';
          // MODIFIED: margin:0 for flush rendering, border-radius only on edges
          const isFirst = sylIdx === 0;
          const isLast = sylIdx === group.length - 1;
          const borderRadius =
            isFirst && isLast ? '3px' : isFirst ? '3px 0 0 3px' : isLast ? '0 3px 3px 0' : '0';
          const borderRight = isLast ? '1px solid #ddd' : 'none';
          h +=
            '<span class="bh-g2p-syll" data-syll-idx="' +
            globalIdx +
            '" ' +
            'style="padding:2px 4px;border-radius:' +
            borderRadius +
            ';' +
            'border:1px solid #ddd;border-right:' +
            borderRight +
            ';' +
            'cursor:default;background:white;margin:0;">' +
            '<span class="bh-g2p-syll-orth" style="font-weight:600;">' +
            orth +
            '</span>';
          if (roman) {
            h +=
              '<span class="bh-g2p-syll-roman" ' +
              'style="margin-left:3px;font-style:italic;color:#666;">' +
              roman +
              '</span>';
          }
          h += '</span>';
          globalIdx++;
        });
      }
      groupIdx++;
    }
  } else {
    // No segments, render all valid syllables as one group
    const validSylls = g2p.syllables.filter(isValidG2PSyllable);
    validSylls.forEach((syl, sylIdx) => {
      const orth = syl.orth || '';
      const roman = syl.roman || '';
      const isFirst = sylIdx === 0;
      const isLast = sylIdx === validSylls.length - 1;
      const borderRadius = isFirst && isLast ? '3px' : isFirst ? '3px 0 0 3px' : isLast ? '0 3px 3px 0' : '0';
      const borderRight = isLast ? '1px solid #ddd' : 'none';
      h +=
        '<span class="bh-g2p-syll" data-syll-idx="' +
        globalIdx +
        '" ' +
        'style="padding:2px 4px;border-radius:' +
        borderRadius +
        ';' +
        'border:1px solid #ddd;border-right:' +
        borderRight +
        ';' +
        'cursor:default;background:white;margin:0;">' +
        '<span class="bh-g2p-syll-orth" style="font-weight:600;">' +
        orth +
        '</span>';
      if (roman) {
        h +=
          '<span class="bh-g2p-syll-roman" ' +
          'style="margin-left:3px;font-style:italic;color:#666;">' +
          roman +
          '</span>';
      }
      h += '</span>';
      globalIdx++;
    });
  }
  h += '</div></div>';
  return h;
}
export function showSyllablePopup(info, anchorEl) {
  if (!info) return;
  let ih =
    '<div class="bh-syll-title" style="margin-bottom:4px;">' +
    '<span style="font-weight:bold;font-size:13px;">' +
    (info.orth || '') +
    '</span>';
  if (info.roman) {
    ih += ' <span style="margin-left:4px;font-style:italic;color:#555;">' + info.roman + '</span>';
  }
  ih += '</div><ul class="bh-syll-parts" style="margin:0;padding-left:16px;">';
  function addPart(label, item) {
    if (!item) return;
    const ch = item.ch || '';
    const rom = item.roman || '';
    const lab = item.label || '';
    ih += '<li><b>' + label + ':</b> ' + ch;
    if (rom) ih += ' (' + rom + ')';
    if (lab) ih += ' — ' + lab;
    ih += '</li>';
  }
  addPart('Base consonant', info.base);
  if (Array.isArray(info.medials)) {
    info.medials.forEach((m) => addPart('Medial', m));
  }
  if (Array.isArray(info.vowels)) {
    info.vowels.forEach((v) => addPart('Vowel sign', v));
  }
  if (Array.isArray(info.finals)) {
    info.finals.forEach((f) => addPart('Final', f));
  }
  if (Array.isArray(info.marks)) {
    info.marks.forEach((mk) => addPart('Mark', mk));
  }
  ih += '</ul>';
  pronunciationState.syllPopup.innerHTML = ih;
  const rect = anchorEl.getBoundingClientRect();
  const x = rect.left + window.scrollX;
  const y = rect.bottom + 4 + window.scrollY;
  pronunciationState.syllPopup.style.left = x + 'px';
  pronunciationState.syllPopup.style.top = y + 'px';
  pronunciationState.syllPopup.style.display = 'block';
}
export function attachG2PHandlers(container, g2pData) {
  if (!g2pData || !Array.isArray(g2pData.syllables) || !g2pData.syllables.length) {
    return;
  }

  // Build flat array of valid syllables for index lookup
  const validSyllables = g2pData.syllables.filter(isValidG2PSyllable);
  const spans = container.querySelectorAll('.bh-g2p-syll');
  spans.forEach((span, idx) => {
    // CHANGED: Use hover only (mouseenter/mouseleave), no click
    span.addEventListener('mouseenter', (e) => {
      const info = validSyllables[idx];
      if (info) {
        showSyllablePopup(info, span);
      }
    });
    span.addEventListener('mouseleave', () => {
      pronunciationState.syllPopup.style.display = 'none';
    });
  });
}

// Count Burmese chars in a string (for "weak match" heuristic)
export function initializePronunciation() {
  // --- G2P (pronunciation) UI layer ------------------------------------
  pronunciationState.currentG2P = null;

  // Small popup for per-syllable breakdown
  pronunciationState.syllPopup = document.createElement('div');
  pronunciationState.syllPopup.id = 'burmese-hover-syll-popup';
  Object.assign(pronunciationState.syllPopup.style, {
    position: 'absolute',
    zIndex: '1000002',
    background: 'white',
    border: '1px solid #aaa',
    borderRadius: '4px',
    padding: '6px 8px',
    boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    fontSize: '12px',
    fontFamily: 'Segoe UI, system-ui, sans-serif',
    maxWidth: '260px',
    maxHeight: '60vh',
    overflowY: 'auto',
    display: 'none'
  });
  document.body.appendChild(pronunciationState.syllPopup);

  // ADDED: Custom instant tooltip for POS confidence and rarity
  pronunciationState.instantTooltip = document.createElement('div');
  pronunciationState.instantTooltip.id = 'burmese-hover-instant-tooltip';
  Object.assign(pronunciationState.instantTooltip.style, {
    position: 'absolute',
    zIndex: '1000003',
    background: 'rgba(0,0,0,0.8)',
    color: 'white',
    borderRadius: '4px',
    padding: '4px 8px',
    fontSize: '11px',
    fontFamily: 'Segoe UI, system-ui, sans-serif',
    pointerEvents: 'none',
    display: 'none',
    whiteSpace: 'nowrap'
  });
  document.body.appendChild(pronunciationState.instantTooltip);
  return true;
}
