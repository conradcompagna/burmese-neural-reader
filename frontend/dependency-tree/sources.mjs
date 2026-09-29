import { DepTreeView } from './controller.mjs';
import { buildConlluData, parseConlluText } from './data.mjs';
export function initializeSources() {
  DepTreeView.prototype.setData = function (data) {
    this.data = data || null;
    this.lastHoverSeg = null;
    this.sentences = [];
    this.nodeBySeg = new Map();
    this.nodeEls = new Map();
    this.edgeEls = [];
    this.layout = null;
    this.treeWorld = null;
    this.treeView = null;
    this.chunks = null;
    this.bottomUpChunks = null;
    this.sentenceBounds = [];
    if (!data || !data.segments || !data.udOverlay || !data.udOverlay.ok) {
      this._renderEmpty('No dependency data.');
      this._syncSentenceNav();
      return;
    }
    if (!Array.isArray(data.udOverlay.tokens) || !data.udOverlay.tokens.length) {
      this._renderEmpty('No dependency data.');
      this._syncSentenceNav();
      return;
    }
    this._buildState(data.segments, data.udOverlay, data.originalText);
    this._renderTree();
    // Compute chunks after building state
    this._recomputeChunks();
    this._recomputeBottomUpChunks();
    this._syncSentenceNav();
  };
  DepTreeView.prototype.loadConlluFromText = function (text) {
    var sentences = parseConlluText(text);
    if (!sentences.length) {
      this._renderEmpty('No sentences in CoNLL-U.');
      this._syncSentenceNav();
      return;
    }
    var data = buildConlluData(sentences);
    this.setData(data);
    if (data.udOverlay && data.udOverlay.sentences && data.udOverlay.sentences.length) {
      if (this.sentenceSource) {
        this._focusRenderedSentence();
      } else {
        this._jumpToSentenceIdxInternal(0);
      }
    }
  };
  DepTreeView.prototype.loadConlluFromUrl = function (url) {
    var self = this;
    if (!url) return;
    fetch(url)
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.text();
      })
      .then(function (txt) {
        self.loadConlluFromText(txt);
      })
      .catch(function (err) {
        console.error('Failed to load CoNLL-U:', err);
        self._renderEmpty('Failed to load CoNLL-U.');
        self._syncSentenceNav();
      });
  };
  DepTreeView.prototype.loadConlluSentenceSource = function (metaUrl, sentenceUrl) {
    var self = this;
    if (!metaUrl || !sentenceUrl) return;
    this.sentenceSource = {
      metaUrl: metaUrl,
      sentenceUrl: sentenceUrl,
      load: function (idx) {
        var url = sentenceUrl + (idx + 1);
        return fetch(url).then(function (resp) {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return resp.text();
        });
      }
    };
    this.sentenceTotal = 0;
    this._syncSentenceNav();
    fetch(metaUrl)
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function (meta) {
        if (meta && meta.ok && typeof meta.total === 'number') {
          self.sentenceTotal = meta.total;
        }
        self._syncSentenceNav();
        if (self.sentenceTotal > 0) {
          self._loadSentenceByIndex(0);
        }
      })
      .catch(function (err) {
        console.error('Failed to load CoNLL-U meta:', err);
        self._renderEmpty('Failed to load CoNLL-U.');
        self._syncSentenceNav();
      });
  };
  DepTreeView.prototype.clearSentenceSource = function () {
    this.sentenceSource = null;
    this.sentenceTotal = 0;
    this.isLoadingSentence = false;
    this._syncSentenceNav();
  };
  DepTreeView.prototype.setSourceToggleState = function (useConllu) {
    if (!this._sourceSelect) return;
    this._sourceSelect.value = useConllu ? 'file' : 'live';
  };
  DepTreeView.prototype._renderEmpty = function (msg) {
    if (this.treeSvg) this.treeSvg.innerHTML = '';
  };
  return true;
}
