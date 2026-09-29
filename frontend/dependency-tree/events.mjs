import { DepTreeView } from './controller.mjs';
import { dataState } from './data.state.mjs';
export function initializeEvents() {
  DepTreeView.prototype._bindEvents = function () {
    var self = this;
    var wrap = this.treeWrap;
    if (!wrap) return;
    // Check if event target is within a token node
    function isTokenClick(e) {
      var el = e.target;
      while (el && el !== wrap) {
        // SVG tagName is uppercase
        if ((el.tagName === 'g' || el.tagName === 'G') && el.hasAttribute('data-seg')) return true;
        el = el.parentNode;
      }
      return false;
    }
    wrap.addEventListener('mousedown', function (e) {
      if (!isTokenClick(e)) e.preventDefault();
    });
    wrap.addEventListener('selectstart', function (e) {
      e.preventDefault();
    });
    wrap.addEventListener('pointerdown', function (e) {
      if (!self.treeWorld) return;
      // Allow clicks on tokens to go through
      if (isTokenClick(e)) {
        self.isPointerDown = false;
        self.isPanning = false;
        self._dragMoved = false;
        return;
      }
      e.preventDefault();
      self.panState = {
        sx: e.clientX,
        sy: e.clientY,
        v: {
          x: self.treeView.x,
          y: self.treeView.y,
          w: self.treeView.w,
          h: self.treeView.h
        }
      };
      self.isPanning = false;
      self.isPointerDown = true;
      self._dragMoved = false;
      self.clearHighlights();
      self._hideTooltip();
      try {
        wrap.setPointerCapture(e.pointerId);
      } catch (err) {}
    });
    wrap.addEventListener('pointermove', function (e) {
      if (!self.panState || !self.treeWorld) return;
      var rect = self.treeSvg.getBoundingClientRect();
      var dx = e.clientX - self.panState.sx;
      var dy = e.clientY - self.panState.sy;
      if (!self.isPanning) {
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        self.isPanning = true;
        self._dragMoved = true;
        self.clearHighlights();
        self._hideTooltip();
      }
      // Natural panning that scales with zoom level
      // When zoomed in (small viewport), moves less world space
      // When zoomed out (large viewport), moves more world space
      self._setTreeView({
        x: self.panState.v.x - ((dx * dataState.PAN_SPEED) / rect.width) * self.panState.v.w,
        y: self.panState.v.y - ((dy * dataState.PAN_SPEED) / rect.height) * self.panState.v.h,
        w: self.panState.v.w,
        h: self.panState.v.h
      });
    });
    wrap.addEventListener('pointerup', function (e) {
      self.panState = null;
      self.isPanning = false;
      self.isPointerDown = false;
      try {
        wrap.releasePointerCapture(e.pointerId);
      } catch (err) {}
    });
    wrap.addEventListener('pointercancel', function () {
      self.panState = null;
      self.isPanning = false;
      self.isPointerDown = false;
      self._dragMoved = false;
    });
    wrap.addEventListener(
      'wheel',
      function (e) {
        if (!self.treeWorld) return;
        e.preventDefault();
        var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        self._zoomAt(factor, e.clientX, e.clientY);
      },
      {
        passive: false
      }
    );
    wrap.addEventListener('dblclick', function (e) {
      if (!self.treeWorld) return;
      // Don't zoom on double-click of tokens
      if (isTokenClick(e)) return;
      e.preventDefault();
      self._zoomAt(1.35, e.clientX, e.clientY);
    });
    if (this._zoomButtons) {
      this._zoomButtons.zoomIn.addEventListener('click', function () {
        var r = self.treeSvg.getBoundingClientRect();
        self._zoomAt(1.15, r.left + r.width / 2, r.top + r.height / 2);
      });
      this._zoomButtons.zoomOut.addEventListener('click', function () {
        var r = self.treeSvg.getBoundingClientRect();
        self._zoomAt(1 / 1.15, r.left + r.width / 2, r.top + r.height / 2);
      });
      this._zoomButtons.zoomReset.addEventListener('click', function () {
        if (self.treeDefaultView) {
          self._setTreeView({
            x: self.treeDefaultView.x,
            y: self.treeDefaultView.y,
            w: self.treeDefaultView.w,
            h: self.treeDefaultView.h
          });
        } else if (self.treeWorld) {
          self._setTreeView({
            x: 0,
            y: 0,
            w: self.treeWorld.W,
            h: self.treeWorld.H
          });
        }
      });
    }
    if (this._sourceSelect) {
      this._sourceSelect.addEventListener('change', function () {
        var useConllu = this.value === 'file';
        if (typeof window !== 'undefined' && typeof window.setDepTreeSourceMode === 'function') {
          window.setDepTreeSourceMode(useConllu);
        }
      });
    }
    if (this._sentenceInput) {
      var goToSentence = function () {
        self.jumpToSentence(self._sentenceInput.value);
      };
      this._sentenceInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') goToSentence();
      });
      this._sentenceInput.addEventListener('change', function () {
        goToSentence();
      });
    }
    if (this._sentencePrev) {
      this._sentencePrev.addEventListener('click', function () {
        self._jumpToSentenceIdx(self.currentSentenceIdx - 1);
      });
    }
    if (this._sentenceNext) {
      this._sentenceNext.addEventListener('click', function () {
        self._jumpToSentenceIdx(self.currentSentenceIdx + 1);
      });
    }
    if (this._pathToRootToggle) {
      this._pathToRootToggle.addEventListener('change', function () {
        self.pathToRootMode = this.checked;
        if (self.lastHoverSeg !== null && self.highlightEnabled) {
          if (self.contextWindowMode) {
            self._applyContextWindowHighlight(self.lastHoverSeg);
          } else if (self.pathToRootMode) {
            self._applyPathToRootHighlight(self.lastHoverSeg);
          } else {
            self._applyHighlight(self.lastHoverSeg);
          }
        }
      });
    }
    if (this._rollNonAclToggle) {
      this._rollNonAclToggle.addEventListener('change', function () {
        self.rollNonAclMode = this.checked;
        if (self.lastHoverSeg !== null && self.highlightEnabled && self.pathToRootMode) {
          self._applyPathToRootHighlight(self.lastHoverSeg);
        }
      });
    }
    if (this._discontinuityToggle) {
      this._discontinuityToggle.addEventListener('change', function () {
        self.discontinuityMode = this.checked;
        if (self.lastHoverSeg !== null && self.highlightEnabled && self.pathToRootMode) {
          self._applyPathToRootHighlight(self.lastHoverSeg);
        }
      });
    }
    if (this._discontinuityThreshold) {
      this._discontinuityThreshold.addEventListener('change', function () {
        self.discontinuityThresholdValue = parseInt(this.value, 10) || 5;
        if (
          self.lastHoverSeg !== null &&
          self.highlightEnabled &&
          self.pathToRootMode &&
          self.discontinuityMode
        ) {
          self._applyPathToRootHighlight(self.lastHoverSeg);
        }
      });
    }
    if (this._branchDepthToggle) {
      this._branchDepthToggle.addEventListener('change', function () {
        self.branchDepthMode = this.checked;
        if (self.lastHoverSeg !== null && self.highlightEnabled && self.pathToRootMode) {
          self._applyPathToRootHighlight(self.lastHoverSeg);
        }
      });
    }
    if (this._branchDepthThreshold) {
      this._branchDepthThreshold.addEventListener('change', function () {
        self.branchDepthThresholdValue = parseInt(this.value, 10) || 5;
        if (
          self.lastHoverSeg !== null &&
          self.highlightEnabled &&
          self.pathToRootMode &&
          self.branchDepthMode
        ) {
          self._applyPathToRootHighlight(self.lastHoverSeg);
        }
      });
    }
    if (this._ancestorDepthToggle) {
      this._ancestorDepthToggle.addEventListener('change', function () {
        self.ancestorDepthMode = this.checked;
        if (self.lastHoverSeg !== null && self.highlightEnabled) {
          self._applyHighlight(self.lastHoverSeg);
        }
      });
    }
    if (this._ancestorDepthInput) {
      this._ancestorDepthInput.addEventListener('change', function () {
        self.ancestorDepthValue = parseInt(this.value, 10) || 1;
        if (self.lastHoverSeg !== null && self.highlightEnabled && self.ancestorDepthMode) {
          self._applyHighlight(self.lastHoverSeg);
        }
      });
    }
    if (this._contextWindowToggle) {
      this._contextWindowToggle.addEventListener('change', function () {
        self.contextWindowMode = this.checked;
        if (self.lastHoverSeg !== null && self.highlightEnabled) {
          if (self.contextWindowMode) {
            self._applyContextWindowHighlight(self.lastHoverSeg);
          } else if (self.pathToRootMode) {
            self._applyPathToRootHighlight(self.lastHoverSeg);
          } else {
            self._applyHighlight(self.lastHoverSeg);
          }
        }
      });
    }
    if (this._contextWindowInput) {
      this._contextWindowInput.addEventListener('change', function () {
        self.contextWindowValue = parseInt(this.value, 10) || 1;
        if (self.lastHoverSeg !== null && self.highlightEnabled && self.contextWindowMode) {
          self._applyContextWindowHighlight(self.lastHoverSeg);
        }
      });
    }
    if (this._bottomUpChunkToggle) {
      this._bottomUpChunkToggle.addEventListener('change', function () {
        self.bottomUpChunkMode = this.checked;
        self._recomputeBottomUpChunks();
        if (self.lastHoverSeg !== null && self.highlightEnabled) {
          self._applyHighlight(self.lastHoverSeg);
        }
      });
    }
    if (this._bottomUpChunkThreshold) {
      this._bottomUpChunkThreshold.addEventListener('change', function () {
        self.bottomUpChunkThresholdValue = parseInt(this.value, 10) || 5;
        if (self.bottomUpChunkMode) {
          self._recomputeBottomUpChunks();
          if (self.lastHoverSeg !== null && self.highlightEnabled) {
            self._applyHighlight(self.lastHoverSeg);
          }
        }
      });
    }
  };
  return true;
}
