import { escapeHtml } from './text.mjs';
export function wrapTokensInText(text) {
  if (!text) return '';
  var tokens = [];
  var currentToken = '';
  for (var i = 0; i < text.length; i++) {
    var char = text[i];
    var code = char.charCodeAt(0);
    // Myanmar: U+1000-U+109F, Myanmar Extended-A: U+AA60-U+AA7F, Myanmar Extended-B: U+A9E0-U+A9FF
    var isMyanmar =
      (code >= 0x1000 && code <= 0x109f) ||
      (code >= 0xaa60 && code <= 0xaa7f) ||
      (code >= 0xa9e0 && code <= 0xa9ff);
    if (isMyanmar) {
      currentToken += char;
    } else {
      if (currentToken) {
        tokens.push({
          type: 'token',
          value: currentToken
        });
        currentToken = '';
      }
      tokens.push({
        type: 'text',
        value: char
      });
    }
  }
  if (currentToken) {
    tokens.push({
      type: 'token',
      value: currentToken
    });
  }
  var html = '';
  for (var j = 0; j < tokens.length; j++) {
    var t = tokens[j];
    if (t.type === 'token') {
      html +=
        '<span class="panel-token" data-seg="' + escapeHtml(t.value) + '">' + escapeHtml(t.value) + '</span>';
    } else {
      html += escapeHtml(t.value);
    }
  }
  return html;
}
export function renderSenseLines(senses, skipHead) {
  if (!senses || !senses.length) return '';
  var html =
    '<div style="display:grid;grid-template-columns:auto auto auto 1fr;gap:0 12px;align-items:start;font-size:12px;line-height:1.8;">';
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
        var headword = parts[0] || '',
          roman = parts[1] || '',
          pos = parts[2] || '',
          sense = parts.slice(3).join('\t');
        if (skipHead) {
          html += '<div style="font-weight:bold;font-size:13px;"></div>';
        } else {
          html += '<div style="font-weight:bold;font-size:13px;">' + escapeHtml(headword) + '</div>';
        }
        html += '<div style="font-style:italic;color:#666;">' + escapeHtml(roman) + '</div>';
        html += '<div style="color:#888;font-size:11px;">[' + escapeHtml(pos) + ']</div>';
        html += '<div style="color:#333;">' + escapeHtml(sense) + '</div>';
      }
    } else if (tabCount === 2) {
      var parts2 = content.split('\t');
      if (parts2.length >= 2) {
        html +=
          '<div></div><div></div><div style="color:#888;font-size:11px;">[' +
          escapeHtml(parts2[0]) +
          ']</div>';
        html += '<div style="color:#333;">' + escapeHtml(parts2.slice(1).join('\t')) + '</div>';
      }
    } else {
      var sense3 = content.trim();
      if (sense3) {
        html += '<div></div><div></div><div></div><div style="color:#333;">' + escapeHtml(sense3) + '</div>';
      }
    }
  }
  html += '</div>';
  return html;
}
// Extract first sense as plain text for fuzzy preview
export function getFirstSenseText(senses) {
  if (!senses || !senses.length) return '';
  for (var i = 0; i < senses.length; i++) {
    var line = senses[i];
    if (!line || !line.trim()) continue;
    var tabCount = 0;
    for (var ci = 0; ci < line.length; ci++) {
      if (line[ci] === '\t') tabCount++;
      else break;
    }
    var content = line.substring(tabCount);
    if (tabCount === 0) {
      var parts = content.split('\t');
      if (parts.length >= 4) {
        return parts.slice(3).join(' ').substring(0, 100);
      }
    } else if (tabCount === 2) {
      var parts2 = content.split('\t');
      if (parts2.length >= 2) {
        return parts2.slice(1).join(' ').substring(0, 100);
      }
    } else {
      return content.trim().substring(0, 100);
    }
  }
  return '';
}
// Render unknown word with spelling (red) and romanization
export function renderUnknownWord(spelling, g2pData) {
  var html = '';
  if (spelling) {
    html += '<div style="color:#c00;font-weight:bold;margin-bottom:2px;">' + escapeHtml(spelling) + '</div>';
  }
  if (g2pData && Array.isArray(g2pData.syllables) && g2pData.syllables.length) {
    html += '<div style="font-size:0.85em;color:#666;">';
    for (var si = 0; si < g2pData.syllables.length; si++) {
      var syll = g2pData.syllables[si];
      if (syll && syll.roman) html += escapeHtml(syll.roman) + ' ';
    }
    html += '</div>';
  }
  return html;
}
