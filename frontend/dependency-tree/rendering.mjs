import { DepTreeView } from './controller.mjs';
import { applyBaseStyle } from './layout.mjs';
export function initializeRendering() {
  DepTreeView.prototype._renderTree = function () {
    if (!this.treeSvg) return;
    var padX = 36;
    var padY = 28;
    var cellW = 72;
    var rowH = 62;
    var nodeW = 62;
    var nodeH = 28;
    var gapY = 40;
    var totalH = 0;
    var maxW = 0;
    var offsets = [];
    this.sentenceBounds = [];
    for (var s = 0; s < this.sentences.length; s++) {
      var sent = this.sentences[s];
      var n = sent.rows.length;
      if (!n) {
        offsets.push(totalH);
        this.sentenceBounds.push(null);
        continue;
      }
      var sentW = padX * 2 + (n - 1) * cellW + nodeW;
      var sentH = padY * 2 + sent.maxDepth * rowH + nodeH + 16;
      if (sentW > maxW) maxW = sentW;
      var sentOffset = totalH;
      offsets.push(sentOffset);
      this.sentenceBounds.push({
        x: 0,
        y: sentOffset,
        w: sentW,
        h: sentH
      });
      totalH += sentH + gapY;
    }
    if (!maxW || !totalH) {
      this.treeSvg.innerHTML = '';
      return;
    }
    var worldW = maxW;
    var worldH = Math.max(100, totalH - gapY);
    var maxSentH = 0;
    for (var sh = 0; sh < this.sentences.length; sh++) {
      var sent = this.sentences[sh];
      if (!sent.rows.length) continue;
      var sentH = padY * 2 + sent.maxDepth * rowH + nodeH + 16;
      if (sentH > maxSentH) maxSentH = sentH;
    }
    this.treeWorld = {
      W: worldW,
      H: worldH,
      maxSentH: maxSentH
    };
    this.layout = {
      nodeW: nodeW,
      nodeH: nodeH
    };
    var defaultView = this._computeDefaultView() || {
      x: 0,
      y: 0,
      w: worldW,
      h: worldH
    };
    this.treeDefaultView = defaultView;
    this.treeView = {
      x: defaultView.x,
      y: defaultView.y,
      w: defaultView.w,
      h: defaultView.h
    };
    this.treeSvg.innerHTML = '';
    this._setTreeView(this.treeView);
    this.nodeEls = new Map();
    this.edgeEls = [];
    for (var s2 = 0; s2 < this.sentences.length; s2++) {
      var sent2 = this.sentences[s2];
      var rows = sent2.rows;
      var n2 = rows.length;
      if (!n2) continue;
      var offsetY = offsets[s2];
      var X = new Array(n2);
      var Y = new Array(n2);
      for (var i2 = 0; i2 < n2; i2++) {
        X[i2] = padX + i2 * cellW;
        Y[i2] = offsetY + padY + sent2.depth[i2] * rowH;
      }
      for (var child = 0; child < n2; child++) {
        var head = rows[child].headIndex;
        if (head === -1) continue;
        var x1 = X[head] + nodeW / 2;
        var y1 = Y[head] + nodeH;
        var x2 = X[child] + nodeW / 2;
        var y2 = Y[child];
        var midY = (y1 + y2) / 2;
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute(
          'd',
          'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + midY + ', ' + x2 + ' ' + midY + ', ' + x2 + ' ' + y2
        );
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'rgba(17,24,39,0.12)');
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('vector-effect', 'non-scaling-stroke');
        path.classList.add('dep-tree-edge');
        path.dataset.head = String(rows[head].segIndex);
        path.dataset.child = String(rows[child].segIndex);
        this.treeSvg.appendChild(path);
        this.edgeEls.push({
          path: path,
          headSeg: rows[head].segIndex,
          childSeg: rows[child].segIndex
        });
      }

      // Draw faint vertical guide lines at whitespace boundaries
      if (this.whitespaceBoundaries) {
        var sentH = padY * 2 + sent2.maxDepth * rowH + nodeH + 16;
        for (var b = 0; b < n2; b++) {
          if (this.whitespaceBoundaries.has(rows[b].segIndex)) {
            var boundaryX = X[b] + nodeW;
            var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', boundaryX);
            line.setAttribute('y1', offsetY + padY - 8);
            line.setAttribute('x2', boundaryX);
            line.setAttribute('y2', offsetY + sentH - padY + 8);
            line.setAttribute('stroke', 'rgba(100,150,200,0.15)');
            line.setAttribute('stroke-width', '1');
            line.setAttribute('vector-effect', 'non-scaling-stroke');
            line.classList.add('boundary-guide');
            this.treeSvg.appendChild(line);
          }
        }
      }
      for (var i3 = 0; i3 < n2; i3++) {
        var r = rows[i3];
        var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('data-seg', String(r.segIndex));
        g.classList.add('dep-tree-node');
        g.style.cursor = 'pointer';
        var hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        hit.setAttribute('x', X[i3]);
        hit.setAttribute('y', Y[i3]);
        hit.setAttribute('width', nodeW);
        hit.setAttribute('height', nodeH);
        hit.setAttribute('rx', '7');
        hit.setAttribute('fill', 'transparent');
        hit.setAttribute('stroke', 'transparent');
        hit.setAttribute('stroke-width', '12');
        hit.setAttribute('vector-effect', 'non-scaling-stroke');
        hit.setAttribute('pointer-events', 'stroke');
        g.appendChild(hit);
        var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', X[i3]);
        rect.setAttribute('y', Y[i3]);
        rect.setAttribute('width', nodeW);
        rect.setAttribute('height', nodeH);
        rect.setAttribute('rx', '7');
        var isChanged = this.debugMode && this.changedTokens && this.changedTokens.has(r.segIndex);
        applyBaseStyle(rect, isChanged);
        rect.setAttribute('vector-effect', 'non-scaling-stroke');
        rect.setAttribute('pointer-events', 'all');
        g.appendChild(rect);
        var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', X[i3] + 5);
        text.setAttribute('y', Y[i3] + 18);
        text.setAttribute('fill', '#111111');
        text.setAttribute('font-size', '10');
        text.setAttribute(
          'font-family',
          '"Pyidaungsu","Noto Sans Myanmar","Myanmar Text",system-ui,sans-serif'
        );
        var label = r.segIndex + ' ' + r.token;
        text.textContent = label.length > 10 ? label.slice(0, 9) + '.' : label;
        g.appendChild(text);
        var self = this;
        g.addEventListener('mouseenter', function (e) {
          if (self.isPanning || self.isPointerDown) return;
          var seg = parseInt(this.getAttribute('data-seg'), 10);
          self._handleHover(seg, e.clientX, e.clientY);
        });
        g.addEventListener('mousemove', function (e) {
          if (self.isPanning || self.isPointerDown) return;
          self._moveTooltip(e.clientX, e.clientY);
        });
        g.addEventListener('mouseleave', function () {
          self.clearHighlights();
          self._hideTooltip();
        });
        g.addEventListener('click', function () {
          if (self.isPanning || self.isPointerDown || self._dragMoved) {
            self._dragMoved = false;
            return;
          }
          var seg = parseInt(this.getAttribute('data-seg'), 10);
          var clicked = self.nodeBySeg.get(seg);
          if (!clicked) return;
          var tokenText = clicked.token || '';
          if (!tokenText) return;
          // Open the side panel
          if (typeof window !== 'undefined' && typeof window.togglePanel === 'function') {
            window.togglePanel(true);
          }
          var used = false;
          // Try to use results_by_seg with dict_fill from our fills
          if (typeof window !== 'undefined' && typeof window.displayDictEntry === 'function') {
            var res = null;
            if (window.latestData && window.latestData.results_by_seg) {
              res = window.latestData.results_by_seg[seg];
            }
            // Ensure dict_fill is included from our fills if available
            if (res || (self.fills && self.fills[seg])) {
              res = res || {
                head: tokenText
              };
              if (self.fills && self.fills[seg]) {
                res.dict_fill = self.fills[seg];
              }
              window.displayDictEntry(res, tokenText, window.latestData);
              used = true;
            }
          }
          if (!used && typeof window !== 'undefined' && typeof window.lookupAndDisplay === 'function') {
            window.lookupAndDisplay(tokenText);
          }
        });
        this.treeSvg.appendChild(g);
        this.nodeEls.set(r.segIndex, {
          group: g,
          rect: rect,
          text: text
        });
      }
    }
  };
  return true;
}
