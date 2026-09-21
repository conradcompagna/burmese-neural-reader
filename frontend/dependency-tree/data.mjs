import { dataState } from './data.state.mjs';
export function getChunkColor(pos) {
  return dataState.CHUNK_POS_COLORS[pos] || dataState.CHUNK_POS_COLORS['DEFAULT'];
}
export function rgba(rgb, a) {
  return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')';
}
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c];
  });
}
export function splitSentences(segments) {
  var spans = [];
  if (!Array.isArray(segments) || !segments.length) return spans;
  var start = 0;
  var endToken = '\u104b';
  for (var i = 0; i < segments.length; i++) {
    if (segments[i] === endToken) {
      spans.push([start, i + 1]);
      start = i + 1;
    }
  }
  if (start < segments.length) spans.push([start, segments.length]);
  return spans;
}
export function parseConlluText(text) {
  if (!text) return [];
  var lines = String(text).split(/\r?\n/);
  var sentences = [];
  var current = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) {
      if (current.length) {
        sentences.push(current);
        current = [];
      }
      continue;
    }
    if (line[0] === '#') continue;
    var fields = line.split('\t');
    if (fields.length < 8) continue;
    var id = fields[0];
    if (id.indexOf('-') !== -1 || id.indexOf('.') !== -1) continue;
    var idNum = parseInt(id, 10);
    if (!isFinite(idNum)) continue;
    var headNum = parseInt(fields[6], 10);
    if (!isFinite(headNum)) headNum = 0;
    current.push({
      id: idNum,
      form: fields[1] || '',
      upos: fields[3] || '',
      head: headNum,
      dep: fields[7] || ''
    });
  }
  if (current.length) sentences.push(current);
  return sentences;
}
export function buildConlluData(sentences) {
  var segments = [];
  var tokens = [];
  var edges = [];
  var roots = [];
  var doc2seg = [];
  var seg2doc = [];
  var sentenceSpans = [];
  var docIndex = 0;
  var segIndex = 0;
  for (var s = 0; s < sentences.length; s++) {
    var sent = sentences[s];
    if (!sent || !sent.length) continue;
    var start = segIndex;
    var idToSeg = {};
    for (var i = 0; i < sent.length; i++) {
      var tok = sent[i];
      idToSeg[tok.id] = segIndex;
      segments.push(tok.form);
      segIndex += 1;
    }
    for (var j = 0; j < sent.length; j++) {
      var tok2 = sent[j];
      var seg = idToSeg[tok2.id];
      var headSeg = idToSeg[tok2.head];
      if (tok2.head === 0 || headSeg === undefined || tok2.head === tok2.id) {
        headSeg = seg;
        roots.push(seg);
      }
      tokens.push({
        i: seg,
        doc_i: docIndex,
        text: tok2.form,
        upos: tok2.upos,
        tag: '',
        dep: tok2.dep,
        head: headSeg
      });
      if (headSeg !== seg) {
        edges.push({
          from: headSeg,
          to: seg,
          dep: tok2.dep,
          upos: tok2.upos
        });
      }
      doc2seg.push(seg);
      seg2doc[seg] = docIndex;
      docIndex += 1;
    }
    sentenceSpans.push([start, segIndex]);
  }
  return {
    segments: segments,
    udOverlay: {
      ok: true,
      tokens: tokens,
      edges: edges,
      roots: roots,
      ents: [],
      doc2seg: doc2seg,
      seg2doc: seg2doc,
      sentences: sentenceSpans
    },
    originalText: segments.join('')
  };
}
export function initializeData() {
  dataState.global = window;
  dataState.PHRASE_RGB = [122, 162, 247];
  dataState.PAN_SPEED = 1.5;

  // POS-based colors for chunk highlighting in tree view - matches SPACY_UPOS_COLORS
  dataState.CHUNK_POS_COLORS = {
    ADJ: {
      stroke: '#eab308',
      fill: 'rgba(253, 230, 138, 0.7)'
    },
    ADP: {
      stroke: '#0ea5e9',
      fill: 'rgba(224, 242, 254, 0.7)'
    },
    ADV: {
      stroke: '#ef4444',
      fill: 'rgba(254, 226, 226, 0.7)'
    },
    AUX: {
      stroke: '#6366f1',
      fill: 'rgba(224, 231, 255, 0.7)'
    },
    CCONJ: {
      stroke: '#06b6d4',
      fill: 'rgba(207, 250, 254, 0.7)'
    },
    DET: {
      stroke: '#94a3b8',
      fill: 'rgba(241, 245, 249, 0.7)'
    },
    INTJ: {
      stroke: '#f59e0b',
      fill: 'rgba(252, 211, 77, 0.7)'
    },
    NOUN: {
      stroke: '#22c55e',
      fill: 'rgba(187, 247, 208, 0.7)'
    },
    NUM: {
      stroke: '#d946ef',
      fill: 'rgba(245, 208, 254, 0.7)'
    },
    PART: {
      stroke: '#a1a1aa',
      fill: 'rgba(244, 244, 245, 0.7)'
    },
    PRON: {
      stroke: '#64748b',
      fill: 'rgba(226, 232, 240, 0.7)'
    },
    PROPN: {
      stroke: '#818cf8',
      fill: 'rgba(199, 210, 254, 0.7)'
    },
    PUNCT: {
      stroke: '#9ca3af',
      fill: 'rgba(229, 231, 235, 0.7)'
    },
    SCONJ: {
      stroke: '#38bdf8',
      fill: 'rgba(186, 230, 253, 0.7)'
    },
    SYM: {
      stroke: '#a855f7',
      fill: 'rgba(243, 232, 255, 0.7)'
    },
    VERB: {
      stroke: '#f43f5e',
      fill: 'rgba(253, 164, 175, 0.7)'
    },
    X: {
      stroke: '#6b7280',
      fill: 'rgba(209, 213, 219, 0.7)'
    },
    ROOT: {
      stroke: '#d97706',
      fill: 'rgba(251, 191, 36, 0.7)'
    },
    DEFAULT: {
      stroke: '#9ca3af',
      fill: 'rgba(229, 231, 235, 0.7)'
    }
  };
  dataState.gapLogic =
    dataState.global && dataState.global.ChunkGapLogic ? dataState.global.ChunkGapLogic : null;
  dataState.computeDownDepth =
    dataState.gapLogic && typeof dataState.gapLogic.computeDownDepth === 'function'
      ? dataState.gapLogic.computeDownDepth
      : function (children) {
          return new Array(children.length).fill(0);
        };
  return true;
}
