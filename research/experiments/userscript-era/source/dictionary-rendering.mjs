import { isMyanmarChar } from './graphemes.mjs';
export // Count Burmese chars in a string (for "weak match" heuristic)
function burmeseLength(s) {
  let n = 0;
  for (const ch of s) {
    if (isMyanmarChar(ch)) n++;
  }
  return n;
}

// FIXED: More robust hierarchical tab-delimited sense parser
export function renderSenseLines(senses) {
  if (!senses || !senses.length) return '';

  // CSS Grid with 4 columns: headword | roman | POS | sense
  let html =
    '<div style="display:grid;grid-template-columns:auto auto auto 1fr;gap:0 12px;align-items:start;font-size:12px;line-height:1.8;">';
  for (const line of senses) {
    // ADDED: Skip empty lines
    if (!line || !line.trim()) continue;

    // Count leading tabs
    let tabCount = 0;
    for (const ch of line) {
      if (ch === '\t') tabCount++;
      else break;
    }
    const content = line.substring(tabCount);

    // ADDED: Skip if content is empty
    if (!content || !content.trim()) continue;
    if (tabCount === 0) {
      // headword\troman\tpos\tsense
      const parts = content.split('\t');
      if (parts.length >= 4) {
        const [headword, roman, pos, ...senseParts] = parts;
        const sense = senseParts.join('\t');
        html += `<div class="bh-headword" style="font-weight:bold;font-size:13px;">${headword || ''}</div>`;
        html += `<div style="font-style:italic;color:#666;">${roman || ''}</div>`;
        html += `<div class="bh-pos-cell"
                                  data-pos-raw="${pos || ''}"
                                  style="color:#888;font-size:11px;">[${pos || ''}]</div>`;
        html += `<div class="bh-sense-text" style="color:#333;">${sense || ''}</div>`;
      } else {
        // ADDED: Handle malformed lines with < 4 parts
        console.warn('[BurmeseDict] Malformed line (tabCount=0):', line);
      }
    } else if (tabCount === 2) {
      // \t\tpos\tsense (new POS under same roman)
      const parts = content.split('\t');
      if (parts.length >= 2) {
        const [pos, ...senseParts] = parts;
        const sense = senseParts.join('\t');
        html += `<div></div><div></div>`; // Empty cols 1 & 2
        html += `<div class="bh-pos-cell"
                                  data-pos-raw="${pos || ''}"
                                  style="color:#888;font-size:11px;">[${pos || ''}]</div>`;
        html += `<div class="bh-sense-text" style="color:#333;">${sense || ''}</div>`;
      } else {
        // ADDED: Handle malformed lines
        console.warn('[BurmeseDict] Malformed line (tabCount=2):', line);
      }
    } else if (tabCount === 3) {
      // \t\t\tsense (continuation)
      const sense = content.trim();
      html += `<div></div><div></div><div></div>`; // Empty cols 1, 2, 3
      html += `<div class="bh-sense-text" style="color:#333;">${sense || ''}</div>`;
    } else {
      // ADDED: Handle unexpected tab counts
      console.warn('[BurmeseDict] Unexpected tab count:', tabCount, 'in line:', line);
      // Try to render it anyway as a continuation sense
      const sense = content.trim();
      if (sense) {
        html += `<div></div><div></div><div></div>`;
        html += `<div class="bh-sense-text" style="color:#333;">${sense}</div>`;
      }
    }
  }
  html += '</div>';
  return html;
}

// ---- helper: is this node inside an editable/input area? ----
