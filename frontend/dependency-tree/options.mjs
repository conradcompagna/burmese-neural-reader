import { DepTreeView } from './controller.mjs';
export function initializeOptions() {
  // Set chunk highlight toggle (synced with main page)
  DepTreeView.prototype.setChunkHighlight = function (enabled) {
    this.settings.chunkHighlight = !!enabled;
    // Recompute chunks
    this._recomputeChunks();
    // Re-apply highlight if we have a hovered token
    if (this.lastHoverSeg !== null && this.highlightEnabled) {
      this._applyHighlight(this.lastHoverSeg);
    }
  };

  // Set dictionary popup toggle (synced with main page)
  DepTreeView.prototype.setDictPopup = function (enabled) {
    this.settings.dictPopup = !!enabled;
  };
  DepTreeView.prototype.setLinearClauseSplit = function (enabled) {
    this.settings.linearClauseSplit = !!enabled;
    this._recomputeChunks();
    if (this.lastHoverSeg !== null && this.highlightEnabled) {
      this._applyHighlight(this.lastHoverSeg);
    }
  };
  DepTreeView.prototype.setBranchDepthMin = function (depth) {
    this.settings.branchDepthMin = depth;
    this._recomputeChunks();
    if (this.lastHoverSeg !== null && this.highlightEnabled) {
      this._applyHighlight(this.lastHoverSeg);
    }
  };
  DepTreeView.prototype.setClauseDepthDrop = function (depthDrop) {
    this.settings.clauseDepthDrop = depthDrop;
    this._recomputeChunks();
    if (this.lastHoverSeg !== null && this.highlightEnabled) {
      this._applyHighlight(this.lastHoverSeg);
    }
  };
  // Compute chunks based on depth-based subtree logic
  // Mirrors the main view's computeChunks logic with canonical chunk assignment
  return true;
}
