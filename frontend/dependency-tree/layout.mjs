import { escapeHtml } from './data.mjs';
export function applyBaseStyle(rect, isChanged) {
  if (isChanged) {
    rect.setAttribute('fill', 'rgba(239,68,68,0.20)');
    rect.setAttribute('stroke', 'rgba(239,68,68,0.85)');
    rect.setAttribute('stroke-width', '1.8');
    return;
  }
  rect.setAttribute('fill', 'rgba(17,24,39,0.04)');
  rect.setAttribute('stroke', 'rgba(17,24,39,0.12)');
  rect.setAttribute('stroke-width', '1.4');
}
export function computeDepths(children, roots) {
  var n = children.length;
  var depth = new Array(n).fill(0);
  if (!roots.length) roots = [0];
  var queue = roots.slice();
  var visited = new Array(n).fill(false);
  for (var i = 0; i < roots.length; i++) visited[roots[i]] = true;
  for (var qi = 0; qi < queue.length; qi++) {
    var v = queue[qi];
    for (var ci = 0; ci < children[v].length; ci++) {
      var ch = children[v][ci];
      if (!visited[ch]) {
        visited[ch] = true;
        depth[ch] = depth[v] + 1;
        queue.push(ch);
      }
    }
  }
  return depth;
}

// Render sense lines for tooltip - simplified version that skips headword column
// since headword is shown separately in the entry header
export function renderSenseLinesTooltip(senses) {
  if (!senses || !senses.length) return '';
  // 3-column grid: roman, pos, sense (no headword column since it's in header)
  var html =
    '<div style="display:grid;grid-template-columns:auto auto 1fr;gap:0 10px;align-items:start;font-size:12px;line-height:1.7;">';
  for (var li = 0; li < senses.length; li++) {
    var line = senses[li];
    if (!line || !line.trim()) continue;
    var tabCount = 0;
    for (var ci = 0; ci < line.length; ci++) {
      if (line[ci] === '\t') tabCount++;
      else break;
    }
    var content = line.substring(tabCount);
    if (!content || !content.trim()) continue;
    if (tabCount === 0) {
      var parts = content.split('\t');
      if (parts.length >= 4) {
        var roman = parts[1] || '',
          pos = parts[2] || '',
          sense = parts.slice(3).join('\t');
        // roman: italic, adapted color for dark bg
        html += '<div style="font-style:italic;color:#a5b4fc;">' + escapeHtml(roman) + '</div>';
        // pos: smaller, adapted color for dark bg
        html += '<div style="color:#94a3b8;font-size:11px;">[' + escapeHtml(pos) + ']</div>';
        // sense: main text color for dark bg
        html += '<div style="color:#e5e7eb;">' + escapeHtml(sense) + '</div>';
      }
    } else if (tabCount === 2) {
      var parts2 = content.split('\t');
      if (parts2.length >= 2) {
        html += '<div></div><div style="color:#94a3b8;font-size:11px;">[' + escapeHtml(parts2[0]) + ']</div>';
        html += '<div style="color:#e5e7eb;">' + escapeHtml(parts2.slice(1).join('\t')) + '</div>';
      }
    } else {
      var sense3 = content.trim();
      if (sense3) {
        html += '<div></div><div></div><div style="color:#e5e7eb;">' + escapeHtml(sense3) + '</div>';
      }
    }
  }
  html += '</div>';
  return html;
}
