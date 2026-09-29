import { DepTreeView } from './controller.mjs';
import { dataState } from './data.state.mjs';
import { applyBaseStyle } from './layout.mjs';
export function initializePublicApi() {
  DepTreeView.prototype.clearHighlights = function () {
    this.lastHoverSeg = null;
    var self = this;
    this.nodeEls.forEach(function (entry, seg) {
      var isChanged = self.debugMode && self.changedTokens && self.changedTokens.has(seg);
      applyBaseStyle(entry.rect, isChanged);
    });
    for (var i = 0; i < this.edgeEls.length; i++) {
      var edge = this.edgeEls[i];
      edge.path.setAttribute('stroke', 'rgba(17,24,39,0.12)');
      edge.path.setAttribute('stroke-width', '1.5');
    }
  };
  DepTreeView.prototype.setVisible = function (isVisible) {
    if (!this.container) return;
    this.container.style.display = isVisible ? 'block' : 'none';
  };
  dataState.global.DepTreeView = new DepTreeView();
  return true;
}
