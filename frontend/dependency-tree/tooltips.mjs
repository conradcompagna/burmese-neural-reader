import { DepTreeView } from './controller.mjs';
import { escapeHtml } from './data.mjs';
import { renderSenseLinesTooltip } from './layout.mjs';
export function initializeTooltips() {
  DepTreeView.prototype._handleHover = function (segIdx, clientX, clientY) {
    if (!this.nodeBySeg.has(segIdx)) return;
    if (this.isPointerDown || this.isPanning) return;
    if (this.lastHoverSeg !== segIdx) {
      this.lastHoverSeg = segIdx;
      if (this.highlightEnabled) {
        if (this.contextWindowMode) {
          this._applyContextWindowHighlight(segIdx);
        } else if (this.pathToRootMode) {
          this._applyPathToRootHighlight(segIdx);
        } else {
          this._applyHighlight(segIdx);
        }
      } else {
        this.clearHighlights();
      }
    }
    if (typeof clientX === 'number' && typeof clientY === 'number') {
      this._showTooltip(segIdx, clientX, clientY);
    }
  };
  DepTreeView.prototype._showTooltip = function (segIdx, x, y) {
    if (!this.tooltip) return;
    var node = this.nodeBySeg.get(segIdx);
    if (!node) return;
    var sent = this.sentences[node.sentenceIdx];
    var depth = sent && sent.depth ? sent.depth[node.rowIdx] : 0;
    var sentIdx = node.sentenceIdx + 1;
    // POS and dep in bright colors at top, always next to each other
    var html = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">';
    html +=
      '<span style="font-size:14px;font-weight:bold;color:#f472b6;">' +
      escapeHtml(node.pos || '') +
      '</span>';
    html +=
      '<span style="font-size:13px;font-weight:bold;color:#38bdf8;">' +
      escapeHtml(node.dep || '') +
      '</span>';
    html += '</div>';
    html +=
      '<div class="tt-info" style="font-size:11px;color:#9ca3af;">head ' +
      escapeHtml(node.headSeg) +
      ' | depth ' +
      depth +
      ' | sent ' +
      sentIdx +
      ' | seg ' +
      escapeHtml(segIdx) +
      '</div>';
    var changeDetails = null;
    if (this.changeDetails) {
      if (typeof this.changeDetails.get === 'function') {
        changeDetails = this.changeDetails.get(segIdx);
      } else {
        changeDetails = this.changeDetails[segIdx];
      }
    }
    if (changeDetails && Array.isArray(changeDetails) && changeDetails.length) {
      html +=
        '<div class="tt-info" style="margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 6px; color:#f87171;">';
      for (var ci = 0; ci < changeDetails.length; ci++) {
        var fix = changeDetails[ci] || {};
        var oldHead = fix.old_head;
        var newHead = fix.new_head;
        var oldHeadText = fix.old_head_text || '';
        var newHeadText = fix.new_head_text || '';
        var reason = fix.reason || '';
        var iter = fix.iteration;
        if (ci > 0) {
          html += '<div style="margin:6px 0;border-top:1px solid rgba(255,255,255,0.12);"></div>';
        }
        html +=
          '<div><strong>changed:</strong> ' +
          escapeHtml(String(oldHead)) +
          ' (' +
          escapeHtml(oldHeadText) +
          ') \u2192 ' +
          escapeHtml(String(newHead)) +
          ' (' +
          escapeHtml(newHeadText) +
          ')</div>';
        if (reason) {
          html += '<div style="color:#fca5a5;">reason: ' + escapeHtml(String(reason)) + '</div>';
        }
        if (iter !== undefined && iter !== null && iter !== '') {
          html += '<div style="color:#fecaca;">iteration: ' + escapeHtml(String(iter)) + '</div>';
        }
      }
      html += '</div>';
    }

    // Show dictionary entries if enabled and available
    // Respects the dictPopup setting (synced with main page toggle)
    if (this.settings.dictPopup && this.fills && this.fills[segIdx]) {
      var entries = this.fills[segIdx];
      if (Array.isArray(entries) && entries.length > 0) {
        html +=
          '<div class="tt-info" style="margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 6px;">';
        html += '<div class="dep-tree-dict-grid">';

        // Helper function to detect unknown entries - EXACTLY matches newserver.py
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
        for (var i = 0; i < entries.length; i++) {
          var part = entries[i] || {};
          var pHead = part.head || '';
          if (!pHead) continue;
          var pSenses = Array.isArray(part.senses) ? part.senses : [];
          var pUnk = isUnknownEntry(part);
          html += '<div class="dep-tree-dict-entry">';
          if (pUnk) {
            // Unknown part: red text + romanization (adapted for dark tooltip bg)
            html +=
              '<div style="margin-top:8px;color:#f87171;font-weight:bold;">' + escapeHtml(pHead) + '</div>';
            if (part.g2p && Array.isArray(part.g2p.syllables) && part.g2p.syllables.length) {
              html += '<div style="font-size:0.85em;color:#94a3b8;">';
              for (var gi = 0; gi < part.g2p.syllables.length; gi++) {
                var gsyll = part.g2p.syllables[gi];
                if (gsyll && gsyll.roman) html += escapeHtml(gsyll.roman) + ' ';
              }
              html += '</div>';
            }
          } else {
            // Known part: heading + senses (headword shown once in header only)
            html +=
              '<div style="margin-top:8px;font-weight:bold;color:#4ade80;">' + escapeHtml(pHead) + '</div>';
            if (pSenses.length) {
              html += renderSenseLinesTooltip(pSenses);
            }
          }
          html += '</div>';
        }
        html += '</div></div>';
      }
    }
    this.tooltip.innerHTML = html;
    this.tooltip.style.display = 'block';
    this._positionTooltip(x, y);
  };
  DepTreeView.prototype._positionTooltip = function (x, y) {
    if (!this.tooltip) return;
    var pad = 12;
    // Allow dynamic expansion, no scrollbars
    this.tooltip.style.maxWidth = window.innerWidth - pad * 2 + 'px';
    this.tooltip.style.maxHeight = 'none';
    this.tooltip.style.overflowY = 'visible';
    // Position initially to measure
    this.tooltip.style.left = '0px';
    this.tooltip.style.top = '0px';
    var rect = this.tooltip.getBoundingClientRect();
    var left = x + 12;
    var top = y + 12;
    // Prevent running off right edge - flip to left of cursor
    if (left + rect.width + pad > window.innerWidth) {
      left = x - rect.width - 12;
    }
    // Prevent running off bottom edge - move up
    if (top + rect.height + pad > window.innerHeight) {
      top = window.innerHeight - rect.height - pad;
    }
    // Prevent running off left/top edges
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    this.tooltip.style.left = left + 'px';
    this.tooltip.style.top = top + 'px';
  };
  DepTreeView.prototype._moveTooltip = function (x, y) {
    if (!this.tooltip || this.tooltip.style.display === 'none') return;
    this._positionTooltip(x, y);
  };
  DepTreeView.prototype._hideTooltip = function () {
    if (!this.tooltip) return;
    this.tooltip.style.display = 'none';
  };

  // Set chunk highlight toggle (synced with main page)
  return true;
}
