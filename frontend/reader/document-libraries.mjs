import { documentLibrariesState } from './document-libraries.state.mjs';
import { documentState } from './document-state.state.mjs';
export function ensureDocxPreviewLoaded() {
  function loadCssOnce(href, id) {
    if (id && document.getElementById(id)) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    if (id) link.id = id;
    document.head.appendChild(link);
  }
  function loadScriptOnce(src, id) {
    return new Promise(function (resolve, reject) {
      if (id && document.getElementById(id)) return resolve();
      if (src.indexOf('jszip') >= 0 && window.JSZip) return resolve();
      if (src.indexOf('docx-preview') >= 0 && window.docx && window.docx.renderAsync) return resolve();
      var s = document.createElement('script');
      s.src = src;
      if (id) s.id = id;
      s.async = true;
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        reject(new Error('Failed to load ' + src));
      };
      document.head.appendChild(s);
    });
  }
  loadCssOnce(
    'https://cdn.jsdelivr.net/npm/docx-preview@0.3.5/dist/docx-preview.min.css',
    'docx-preview-css'
  );
  return loadScriptOnce('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'jszip-lib')
    .then(function () {
      return loadScriptOnce(
        'https://cdn.jsdelivr.net/npm/docx-preview@0.3.5/dist/docx-preview.min.js',
        'docx-preview-lib'
      );
    })
    .then(function () {
      if (!window.docx || !window.docx.renderAsync) {
        throw new Error('docx-preview loaded but window.docx.renderAsync is missing');
      }
    });
}
export function ensurePdfJsLoaded() {
  function loadCssOnce(href, id) {
    if (id && document.getElementById(id)) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    if (id) link.id = id;
    document.head.appendChild(link);
  }
  function loadScriptOnce(src, id) {
    return new Promise(function (resolve, reject) {
      if (id && document.getElementById(id)) return resolve();
      if (src.indexOf('pdf.min.js') >= 0 && window.pdfjsLib) return resolve();
      var s = document.createElement('script');
      s.src = src;
      if (id) s.id = id;
      s.async = true;
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        reject(new Error('Failed to load ' + src));
      };
      document.head.appendChild(s);
    });
  }
  loadCssOnce('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/web/pdf_viewer.min.css', 'pdfjs-viewer-css');
  return loadScriptOnce(
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    'pdfjs-lib'
  ).then(function () {
    if (!window.pdfjsLib) {
      throw new Error('pdfjsLib missing after load');
    }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  });
}
export function getPdfFileToken(file) {
  if (!file) return '';
  return [file.name || '', file.size || 0, file.lastModified || 0].join(':');
}
export function getPdfJsDocument(file) {
  if (!file) return Promise.reject(new Error('no file'));
  var token = getPdfFileToken(file);
  if (documentState.pdfOriginal.doc && documentState.pdfOriginal.fileToken === token)
    return Promise.resolve(documentState.pdfOriginal.doc);
  if (documentState.pdfOriginal.docPromise && documentState.pdfOriginal.fileToken === token)
    return documentState.pdfOriginal.docPromise;
  documentState.pdfOriginal.fileToken = token;
  documentState.pdfOriginal.doc = null;
  documentState.pdfOriginal.docPromise = file
    .arrayBuffer()
    .then(function (buf) {
      return window.pdfjsLib.getDocument({
        data: buf
      }).promise;
    })
    .then(function (doc) {
      documentState.pdfOriginal.doc = doc;
      return doc;
    });
  return documentState.pdfOriginal.docPromise;
}

// ---- PDF.js full viewer embedding ----
export function initializeDocumentLibraries() {
  documentLibrariesState.pdfJsRenderedPages = {}; // pageNum -> true (tracks which pages have been rendered)
  documentLibrariesState.pdfJsObserver = null; // IntersectionObserver for lazy page rendering
  documentLibrariesState.pdfJsIframe = null; // iframe host for actual PDF.js viewer
  documentLibrariesState.pdfJsSessionId = 0; // increments on each PDF load to ignore stale iframe events
  return true;
}
