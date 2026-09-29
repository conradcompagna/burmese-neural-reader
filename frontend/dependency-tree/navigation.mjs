import { DepTreeView } from './controller.mjs';
export function initializeNavigation() {
  DepTreeView.prototype._syncSentenceNav = function () {
    if (!this._sentenceInput || !this._sentenceInfo) return;
    var total =
      this.sentenceTotal && this.sentenceTotal > 0
        ? this.sentenceTotal
        : this.sentenceBounds
          ? this.sentenceBounds.length
          : 0;
    if (!total) {
      this._sentenceInput.disabled = true;
      this._sentenceInput.value = '';
      this._sentenceInput.max = '1';
      this._sentenceInfo.textContent = '0 / 0';
      if (this._sentencePrev) this._sentencePrev.disabled = true;
      if (this._sentenceNext) this._sentenceNext.disabled = true;
      return;
    }
    if (this.currentSentenceIdx < 0 || this.currentSentenceIdx >= total) {
      this.currentSentenceIdx = 0;
    }
    this._sentenceInput.disabled = false;
    this._sentenceInput.max = String(total);
    this._sentenceInput.value = String(this.currentSentenceIdx + 1);
    this._sentenceInfo.textContent = this.currentSentenceIdx + 1 + ' / ' + total;
    if (this._sentencePrev) this._sentencePrev.disabled = this.currentSentenceIdx <= 0;
    if (this._sentenceNext) this._sentenceNext.disabled = this.currentSentenceIdx >= total - 1;
  };
  DepTreeView.prototype._jumpToSentenceIdxInternal = function (idx) {
    if (!this.treeWorld || !this.sentenceBounds || !this.sentenceBounds.length) return;
    var total = this.sentenceBounds.length;
    var target = Math.max(0, Math.min(total - 1, idx));
    var bounds = this.sentenceBounds[target];
    if (!bounds) return;
    var pad = 0.18;
    var w = bounds.w * (1 + pad);
    var h = bounds.h * (1 + pad);
    var x = bounds.x - (bounds.w * pad) / 2;
    var y = bounds.y - (bounds.h * pad) / 2;
    this.currentSentenceIdx = target;
    this.clearHighlights();
    this._hideTooltip();
    this._setTreeView({
      x: x,
      y: y,
      w: w,
      h: h
    });
    this._syncSentenceNav();
  };
  DepTreeView.prototype._focusRenderedSentence = function () {
    if (!this.treeWorld || !this.sentenceBounds || !this.sentenceBounds.length) return;
    var bounds = this.sentenceBounds[0];
    if (!bounds) return;
    var pad = 0.18;
    var w = bounds.w * (1 + pad);
    var h = bounds.h * (1 + pad);
    var x = bounds.x - (bounds.w * pad) / 2;
    var y = bounds.y - (bounds.h * pad) / 2;
    this.clearHighlights();
    this._hideTooltip();
    this._setTreeView({
      x: x,
      y: y,
      w: w,
      h: h
    });
  };
  DepTreeView.prototype._loadSentenceByIndex = function (idx) {
    if (!this.sentenceSource || typeof this.sentenceSource.load !== 'function') return;
    var total =
      this.sentenceTotal && this.sentenceTotal > 0 ? this.sentenceTotal : this.sentenceBounds.length;
    var target = Math.max(0, Math.min(total - 1, idx));
    if (this.isLoadingSentence && target === this.currentSentenceIdx) return;
    this.isLoadingSentence = true;
    this.currentSentenceIdx = target;
    this._syncSentenceNav();
    var self = this;
    this.sentenceSource
      .load(target)
      .then(function (text) {
        self.isLoadingSentence = false;
        if (!text) {
          self._renderEmpty('Empty sentence.');
          self._syncSentenceNav();
          return;
        }
        self.loadConlluFromText(text);
        self.currentSentenceIdx = target;
        self._syncSentenceNav();
      })
      .catch(function (err) {
        self.isLoadingSentence = false;
        console.error('Failed to load sentence:', err);
        self._renderEmpty('Failed to load sentence.');
        self._syncSentenceNav();
      });
  };
  DepTreeView.prototype._jumpToSentenceIdx = function (idx) {
    if (this.sentenceSource && typeof this.sentenceSource.load === 'function') {
      this._loadSentenceByIndex(idx);
      return;
    }
    this._jumpToSentenceIdxInternal(idx);
  };
  DepTreeView.prototype.jumpToSentence = function (sentenceNumber) {
    var idx = parseInt(sentenceNumber, 10);
    if (!isFinite(idx)) return;
    this._jumpToSentenceIdx(idx - 1);
  };
  DepTreeView.prototype._setTreeView = function (v) {
    if (!this.treeWorld) return;
    var W = this.treeWorld.W;
    var H = this.treeWorld.H;
    var maxW = Math.max(W * 3, this.treeDefaultView ? this.treeDefaultView.w : 0);
    var maxH = Math.max(H * 3, this.treeDefaultView ? this.treeDefaultView.h : 0);
    v.w = Math.max(100, Math.min(maxW, v.w));
    v.h = Math.max(100, Math.min(maxH, v.h));
    if (v.w >= W) {
      v.x = (W - v.w) / 2;
    } else {
      v.x = Math.max(-W, Math.min(W * 2 - v.w, v.x));
    }
    if (v.h >= H) {
      v.y = (H - v.h) / 2;
    } else {
      v.y = Math.max(-H, Math.min(H * 2 - v.h, v.y));
    }
    this.treeView = v;
    this.treeSvg.setAttribute('viewBox', v.x + ' ' + v.y + ' ' + v.w + ' ' + v.h);
    if (this.zoomLabel) {
      var baseW = this.treeDefaultView ? this.treeDefaultView.w : this.treeWorld.W;
      this.zoomLabel.textContent = (baseW / v.w).toFixed(2) + 'x';
    }
  };
  DepTreeView.prototype.refitView = function () {
    if (!this.layout || !this.treeWorld) return;
    var defView = this._computeDefaultView();
    if (!defView) return;
    this.treeDefaultView = defView;
    this._setTreeView({
      x: defView.x,
      y: defView.y,
      w: defView.w,
      h: defView.h
    });
  };
  DepTreeView.prototype._zoomAt = function (factor, cx, cy) {
    if (!this.treeWorld || !this.treeView) return;
    var rect = this.treeSvg.getBoundingClientRect();
    var mx = (cx - rect.left) / rect.width;
    var my = (cy - rect.top) / rect.height;
    var v = this.treeView;
    var px = v.x + mx * v.w;
    var py = v.y + my * v.h;
    var nw = v.w / factor;
    var nh = v.h / factor;
    this._setTreeView({
      x: px - mx * nw,
      y: py - my * nh,
      w: nw,
      h: nh
    });
  };
  return true;
}
