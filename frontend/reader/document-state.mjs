import { documentState } from './document-state.state.mjs';
export // {width,height} from /api/extract_text

function getDocxFileToken(file) {
  if (!file) return '';
  return [file.name || '', file.size || 0, file.lastModified || 0].join(':');
}
export function sanitizePdfDimension(dim) {
  if (!dim || typeof dim !== 'object') return null;
  var w = Number(dim.width);
  var h = Number(dim.height);
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null;
  return {
    width: w,
    height: h
  };
}
export function sanitizePdfDimensionList(list) {
  if (!Array.isArray(list)) return [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var dim = sanitizePdfDimension(list[i]);
    out.push(
      dim || {
        width: 0,
        height: 0
      }
    );
  }
  return out;
}
export function computeAveragePdfDimension(list) {
  if (!Array.isArray(list) || !list.length) return null;
  var sumW = 0;
  var sumH = 0;
  var n = 0;
  for (var i = 0; i < list.length; i++) {
    var dim = sanitizePdfDimension(list[i]);
    if (!dim) continue;
    sumW += dim.width;
    sumH += dim.height;
    n++;
  }
  if (!n) return null;
  return {
    width: sumW / n,
    height: sumH / n
  };
}
export function initializeDocumentState() {
  // ------------------------------
  // DOCX Original View (docx-preview) - Frontend-only
  // ------------------------------

  documentState.docxOriginal = {
    buf: null,
    // ArrayBuffer of current DOCX
    fileToken: null,
    // cache key for current DOCX
    rendered: false,
    // rendered into sourcePager
    renderSeq: 0 // cancellation token
  };
  documentState.pdfOriginal = {
    doc: null,
    // pdfjsLib document
    docPromise: null,
    // in-flight load promise
    fileToken: null,
    // cache key for current file
    renderSeq: 0 // cancellation token
  };
  documentState.pdfPageDimensions = []; // [{width,height}] from /api/extract_text
  documentState.pdfAveragePageDimensions = null;
  return true;
}
