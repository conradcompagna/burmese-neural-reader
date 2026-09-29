import { posOverlayState } from './pos-overlay.state.mjs';
export // JS clone of _coarse_pos_tag from the server
function coarsePosTag(raw) {
  let p = (raw || '').trim().toLowerCase();
  if (!p) return '';
  if (p.startsWith('adj')) return 'adj';
  if (p.startsWith('adv')) return 'adv';
  if (p.startsWith('pron')) return 'pron';
  if (p.startsWith('conj')) return 'conj';
  if (p.startsWith('exp')) return 'exp';
  if (p.startsWith('int') || p.startsWith('interj')) return 'int';
  if (p.startsWith('pos')) return 'pos';
  if (p.startsWith('kjano') || p.startsWith('num') || p === 'm' || p === 'nm') return 'kjano';
  if (p.startsWith('ppm') || p.startsWith('postp') || p.startsWith('prep')) return 'ppm';
  if (p.startsWith('part') || p.startsWith('particle')) return 'part';
  if (p.startsWith('n')) return 'n';
  if (p.startsWith('v') || p.startsWith('aux')) return 'v';
  return posOverlayState.COARSE_POS_TAGS.has(p) ? p : '';
}

// MODIFIED: Apply colour to POS text (not background blob) with intensity based on confidence
export function applyPosCellStyle(el, tag, confidence) {
  const rgb = posOverlayState.POS_COLOUR_RGB[tag];
  if (!rgb) return;

  // Clamp confidence
  const c = Math.max(0, Math.min(1, Number(confidence) || 0));
  const pct = Math.round(c * 100);
  const [r, g, b] = rgb;

  // CHANGED: Color intensity based on confidence (0.35 min to 1.0 max)
  const colorAlpha = 0.35 + 0.65 * c;

  // CHANGED: Style the text itself, not background
  el.style.color = `rgba(${r},${g},${b},${colorAlpha})`;
  el.style.fontSize = '13px'; // Larger than default 11px
  el.style.fontWeight = '600'; // Bold to make it stand out
  el.style.backgroundColor = 'transparent';
  el.style.border = 'none';
  el.style.borderRadius = '0';
  el.style.padding = '0';
  el.style.display = 'inline-block';

  // ADDED: Store confidence for custom instant tooltip
  el.setAttribute('data-pos-confidence', pct);
}

// Use segments + pos_overlay to colour POS cells in a given popup/container
export function applyPosOverlayToPopup(container, data) {
  if (!data || !data.pos_overlay || !Array.isArray(data.pos_overlay.tokens)) return;
  if (!Array.isArray(data.segments) || !data.segments.length) return;
  const tokens = data.pos_overlay.tokens;
  const segs = data.segments;
  const n = Math.min(tokens.length, segs.length);
  if (!n) return;

  // Build map: surface token text -> best tag + confidence (keep strongest if dup)
  const map = new Map();
  for (let i = 0; i < n; i++) {
    const surf = (segs[i] || '').trim();
    const info = tokens[i] || {};
    const tag = info.best_pos || '';
    const conf = Number(info.confidence) || 0;
    if (!surf || !tag) continue;
    const existing = map.get(surf);
    if (!existing || conf > existing.confidence) {
      map.set(surf, {
        tag,
        confidence: conf
      });
    }
  }
  if (!map.size) return;

  // For each card: look up the headword in the map, then colour matching POS cells
  const cards = container.querySelectorAll('.bh-entry-card, .bh-entry-card-secondary');
  cards.forEach((card) => {
    const head = (card.getAttribute('data-head') || '').trim();
    if (!head) return;
    const info = map.get(head);
    if (!info || !info.tag) return;
    const coarseBest = info.tag;
    const cells = card.querySelectorAll('.bh-pos-cell');
    cells.forEach((cell) => {
      const rawPos = cell.getAttribute('data-pos-raw') || '';
      const coarse = coarsePosTag(rawPos);
      if (!coarse) return;
      if (coarse === coarseBest) {
        applyPosCellStyle(cell, coarseBest, info.confidence);
      } else {
        // MODIFIED: Non-selected POS: gray out instead of just opacity
        cell.style.color = '#aaa';
        cell.style.opacity = '0.6';
      }
    });
  });
}

// ADDED: Track all nested popups for unlimited nesting
export function initializePosOverlay() {
  // 1 hour

  // ------------------------------------------------------------------
  // POS COLOURING / GRAMMAR OVERLAY (UI SIDE)
  // ------------------------------------------------------------------

  // Coarse tag set – must match server-side tags
  posOverlayState.COARSE_POS_TAGS = new Set([
    'adj',
    'adv',
    'conj',
    'exp',
    'int',
    'kjano',
    'n',
    'part',
    'pos',
    'ppm',
    'pron',
    'v'
  ]);

  // Base RGB colours per coarse POS (tweak to taste)
  posOverlayState.POS_COLOUR_RGB = {
    n: [56, 142, 60],
    // green
    v: [25, 118, 210],
    // blue
    adj: [156, 39, 176],
    // purple
    adv: [255, 143, 0],
    // orange
    pron: [0, 121, 107],
    // teal
    conj: [121, 85, 72],
    // brown
    part: [233, 30, 99],
    // pink
    ppm: [63, 81, 181],
    // indigo
    pos: [0, 150, 136],
    // cyan-ish
    exp: [120, 120, 120],
    // grey
    int: [244, 81, 30],
    // red
    kjano: [255, 193, 7] // yellow
  };
  posOverlayState.nestedPopups = [];
  return true;
}
