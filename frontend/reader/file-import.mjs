import { hideRawTextPill } from './bootstrap-ui.mjs';
import { ensureDocxPreviewLoaded } from './document-libraries.mjs';
import { documentLibrariesState } from './document-libraries.state.mjs';
import { cancelMovementLookupTimer, setDocMode, setPagedMode } from './document-pagination.mjs';
import { documentPaginationState } from './document-pagination.state.mjs';
import {
  computeAveragePdfDimension,
  getDocxFileToken,
  sanitizePdfDimension,
  sanitizePdfDimensionList
} from './document-state.mjs';
import { documentState } from './document-state.state.mjs';
import { renderDocxPreviewInto } from './document-text.mjs';
import { triggerUpdate } from './lookup.mjs';
import { updateRenderedOutputBackground } from './raw-text-sizing.mjs';
import { readerState } from './reader-state.state.mjs';
import { escapeHtml } from './text.mjs';
import { applyGlobalViewportClamp } from './viewport-layout.mjs';
export // File handling
function setLoadedFileName(name) {
  if (!readerState.fileNamePill || !readerState.fileNameText) return;
  var label = (name || '').toString();
  if (!label) {
    readerState.fileNamePill.style.display = 'none';
    readerState.fileNameText.textContent = '';
    return;
  }
  readerState.fileNameText.textContent = label;
  readerState.fileNamePill.style.display = 'inline-flex';
}
export function clearLoadedFile() {
  cancelMovementLookupTimer();
  documentLibrariesState.pdfJsSessionId += 1;
  documentLibrariesState.pdfJsIframe = null;
  // Evict server-side PDF cache
  if (documentPaginationState.pdfCacheId) {
    fetch('/api/close_pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cache_id: documentPaginationState.pdfCacheId
      })
    }).catch(function () {});
  }
  // Destroy PDF.js document
  if (documentState.pdfOriginal.doc) {
    documentState.pdfOriginal.doc.destroy();
    documentState.pdfOriginal.doc = null;
  }
  documentState.pdfOriginal.fileToken = null;
  documentState.pdfOriginal.docPromise = null;
  // Reset DOCX original-view cache/cancellation state.
  documentState.docxOriginal.renderSeq += 1;
  documentState.docxOriginal.buf = null;
  documentState.docxOriginal.fileToken = null;
  documentState.docxOriginal.rendered = false;
  // Clean up observer
  if (documentLibrariesState.pdfJsObserver) {
    documentLibrariesState.pdfJsObserver.disconnect();
    documentLibrariesState.pdfJsObserver = null;
  }
  documentLibrariesState.pdfJsRenderedPages = {};
  documentPaginationState.inputMode = 'raw';
  documentPaginationState.docText = '';
  documentPaginationState.docPagerIsPaged = false;
  documentPaginationState.docPages = [];
  documentPaginationState.activePageIndex = 0;
  documentPaginationState.lastLookupPageIndex = -1;
  documentPaginationState.pendingPdfLookupPageIndex = -1;
  documentPaginationState.pageLookupTextByIndex = {};
  hideRawTextPill();
  // Reset original view state
  documentPaginationState.currentFile = null;
  documentPaginationState.currentFileType = null;
  documentPaginationState.pdfCacheId = null;
  documentState.pdfPageDimensions = [];
  documentState.pdfAveragePageDimensions = null;
  documentPaginationState.isOriginalView = false;
  documentPaginationState.originalLayoutCache = {};
  documentPaginationState.pdfRawTextCache = {};
  if (documentPaginationState.origViewToggle) documentPaginationState.origViewToggle.style.display = 'none';
  if (documentPaginationState.origViewCheckbox) documentPaginationState.origViewCheckbox.checked = false;
  if (readerState.sourcePager) {
    readerState.sourcePager.classList.remove('orig-view-mode');
    readerState.sourcePager.classList.remove('pdfjs-native-mode');
    readerState.sourcePager.style.display = 'none';
    readerState.sourcePager.innerHTML = '';
  }
  if (readerState.sourceText) {
    readerState.sourceText.style.display = '';
    readerState.sourceText.value = '';
  }
  if (readerState.fileNamePill) readerState.fileNamePill.style.display = 'none';
  if (readerState.fileNameText) readerState.fileNameText.textContent = '';
  if (readerState.rawTextPill) readerState.rawTextPill.style.display = 'none';
  if (readerState.rawTextText) readerState.rawTextText.textContent = '';
  if (readerState.fileInput) readerState.fileInput.value = '';
  if (readerState.renderedText) {
    readerState.renderedText.innerHTML = '';
  }
  if (readerState.statusText) readerState.statusText.textContent = 'Ready.';
  if (readerState.statusCounts) readerState.statusCounts.textContent = '';
  applyGlobalViewportClamp(true);
  updateRenderedOutputBackground();
}
export function loadFile(file) {
  if (!file) return;
  cancelMovementLookupTimer();
  documentLibrariesState.pdfJsSessionId += 1;
  documentLibrariesState.pdfJsIframe = null;
  setLoadedFileName(file.name || 'document');
  var name = (file.name || '').toLowerCase();

  // Clean up previous PDF.js state
  hideRawTextPill();
  if (documentPaginationState.pdfCacheId) {
    fetch('/api/close_pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cache_id: documentPaginationState.pdfCacheId
      })
    }).catch(function () {});
  }
  if (documentState.pdfOriginal.doc) {
    documentState.pdfOriginal.doc.destroy();
    documentState.pdfOriginal.doc = null;
  }
  if (documentLibrariesState.pdfJsObserver) {
    documentLibrariesState.pdfJsObserver.disconnect();
    documentLibrariesState.pdfJsObserver = null;
  }
  // Invalidate DOCX original-view state from the previous file.
  documentState.docxOriginal.renderSeq += 1;
  documentState.docxOriginal.buf = null;
  documentState.docxOriginal.fileToken = null;
  documentState.docxOriginal.rendered = false;
  documentLibrariesState.pdfJsRenderedPages = {};
  documentPaginationState.currentFile = file;
  documentPaginationState.pdfCacheId = null;
  documentState.pdfPageDimensions = [];
  documentState.pdfAveragePageDimensions = null;
  documentPaginationState.isOriginalView = false;
  documentPaginationState.originalLayoutCache = {};
  documentPaginationState.pdfRawTextCache = {};
  documentPaginationState.activePageIndex = 0;
  documentPaginationState.lastLookupPageIndex = -1;
  documentPaginationState.pendingPdfLookupPageIndex = -1;
  documentPaginationState.pageLookupTextByIndex = {};
  if (documentPaginationState.origViewCheckbox) documentPaginationState.origViewCheckbox.checked = false;
  if (readerState.sourcePager) {
    readerState.sourcePager.classList.remove('orig-view-mode');
    readerState.sourcePager.classList.remove('pdfjs-native-mode');
  }
  if (name.endsWith('.pdf')) {
    documentPaginationState.currentFileType = 'pdf';
    if (documentPaginationState.origViewToggle)
      documentPaginationState.origViewToggle.style.display = 'inline-flex';
    loadBinaryDocument(file);
    return;
  }
  if (name.endsWith('.docx')) {
    documentPaginationState.currentFileType = 'docx';
    // DOCX original view now supported - show toggle
    if (documentPaginationState.origViewToggle)
      documentPaginationState.origViewToggle.style.display = 'inline-flex';
    loadBinaryDocumentSimplified(file); // Use simplified extraction
    return;
  }

  // Text file - no original view
  documentPaginationState.currentFileType = 'text';
  if (documentPaginationState.origViewToggle) documentPaginationState.origViewToggle.style.display = 'none';

  // Text file - load directly into doc mode
  var reader = new FileReader();
  reader.onload = function (e) {
    var text = e && e.target && e.target.result ? e.target.result : '';
    text = text || '';
    if (readerState.sourceText) readerState.sourceText.value = text;
    loadTextAsDoc(text);
  };
  reader.readAsText(file, 'utf-8');
}

// Simplified extraction for .txt and .docx (500-word pagination)
export function loadBinaryDocumentSimplified(file) {
  readerState.statusText.textContent = 'Extracting text...';
  readerState.statusCounts.textContent = '';
  var fd = new FormData();
  fd.append('file', file, file.name || 'document');
  fetch('/api/extract_text_simple', {
    method: 'POST',
    body: fd
  })
    .then(function (resp) {
      if (!resp.ok) {
        // Try to get error details from response
        return resp
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            var errMsg = data && data.error ? data.error : 'HTTP ' + resp.status;
            if (resp.status === 413) {
              errMsg = 'File too large (max 25MB). Try a smaller file.';
            } else if (resp.status === 500) {
              errMsg = 'Extraction failed: ' + errMsg + '. Make sure pypdf or PyMuPDF is installed.';
            }
            throw new Error(errMsg);
          });
      }
      return resp.json();
    })
    .then(function (data) {
      if (!data || !data.ok) {
        readerState.statusText.textContent = 'Extraction failed.';
        var errDetail = data && data.error ? data.error : 'unknown';
        if (errDetail.indexOf('not installed') >= 0) {
          errDetail += ' - Install with: pip install pypdf python-docx';
        }
        readerState.renderedText.innerHTML =
          '<div class="reader-output-placeholder">Error: ' + escapeHtml(errDetail) + '</div>';
        return;
      }
      var fullText = (data.text || '').toString();
      // Keep DOCX preview page-blind (continuous flow, no page metadata usage).
      if (documentPaginationState.currentFileType === 'docx') {
        documentPaginationState.docPages = [];
      } else {
        documentPaginationState.docPages = Array.isArray(data.pages) ? data.pages : [];
      }
      if (readerState.sourceText) readerState.sourceText.value = fullText;
      setDocMode(fullText);
      if (documentPaginationState.currentFileType === 'docx') {
        readerState.statusText.textContent = 'Ready.';
        // Auto-enable original view for DOCX
        if (documentPaginationState.origViewCheckbox && !documentPaginationState.origViewCheckbox.checked) {
          documentPaginationState.origViewCheckbox.checked = true;
          documentPaginationState.origViewCheckbox.dispatchEvent(new Event('change'));
        }
      } else if (documentPaginationState.docPages.length) {
        readerState.statusText.textContent =
          'Ready (' + documentPaginationState.docPages.length + ' pages).';
      }
    })
    .catch(function (err) {
      console.error(err);
      readerState.statusText.textContent = 'Extraction failed.';
      readerState.renderedText.innerHTML =
        '<div class="reader-output-placeholder">Could not extract text from file.</div>';
    });
}

// PDF extraction - use full extract_text endpoint
export function loadBinaryDocument(file) {
  readerState.statusText.textContent = 'Extracting text...';
  readerState.statusCounts.textContent = '';
  var fd = new FormData();
  fd.append('file', file, file.name || 'document.pdf');
  fetch('/api/extract_text', {
    method: 'POST',
    body: fd
  })
    .then(function (resp) {
      if (!resp.ok) {
        return resp
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            var errMsg = data && data.error ? data.error : 'HTTP ' + resp.status;
            if (resp.status === 413) {
              errMsg = 'File too large (max 25MB). Try a smaller file.';
            } else if (resp.status === 500) {
              errMsg = 'Extraction failed: ' + errMsg + '. Make sure pypdf or PyMuPDF is installed.';
            }
            throw new Error(errMsg);
          });
      }
      return resp.json();
    })
    .then(function (data) {
      if (!data || !data.ok) {
        readerState.statusText.textContent = 'Extraction failed.';
        var errDetail = data && data.error ? data.error : 'unknown';
        if (errDetail.indexOf('not installed') >= 0) {
          errDetail += ' - Install with: pip install pypdf';
        }
        readerState.renderedText.innerHTML =
          '<div class="reader-output-placeholder">Error: ' + escapeHtml(errDetail) + '</div>';
        return;
      }
      var meta = data.meta || {};
      var pages = Array.isArray(data.pages) ? data.pages : [];
      if (!pages.length) {
        var pageCount = parseInt(meta.pages || meta.page_count || 0, 10);
        if (!isFinite(pageCount) || pageCount < 1) pageCount = 1;
        pages = new Array(pageCount).fill('');
      }
      var fullText = (data.text || '').toString();
      documentPaginationState.currentFile = file;
      // Capture server-side PDF cache ID (avoids re-uploading for page rendering)
      documentPaginationState.pdfCacheId = meta.pdf_cache_id || null;
      documentState.pdfPageDimensions = sanitizePdfDimensionList(meta.pdf_page_dimensions);
      documentState.pdfAveragePageDimensions =
        sanitizePdfDimension(meta.pdf_average_page_dimensions) ||
        computeAveragePdfDimension(documentState.pdfPageDimensions);
      if (readerState.sourceText) readerState.sourceText.value = fullText;
      // Default PDFs to original-view lookup mode before the first triggerUpdate call.
      if (documentPaginationState.origViewCheckbox) documentPaginationState.origViewCheckbox.checked = true;
      documentPaginationState.isOriginalView = !!(
        documentPaginationState.origViewCheckbox && documentPaginationState.origViewCheckbox.checked
      );
      setPagedMode(pages);
      readerState.statusText.textContent = 'Ready (' + pages.length + ' pages).';
    })
    .catch(function (err) {
      console.error(err);
      readerState.statusText.textContent = 'Extraction failed.';
      readerState.renderedText.innerHTML =
        '<div class="reader-output-placeholder">Could not extract PDF: ' +
        escapeHtml(err.message || 'unknown error') +
        '</div>';
    });
}

// Load text into document mode (no server call needed)
export function loadTextAsDoc(text) {
  if (documentPaginationState.origViewToggle) documentPaginationState.origViewToggle.style.display = 'none';
  if (documentPaginationState.origViewCheckbox) documentPaginationState.origViewCheckbox.checked = false;
  documentPaginationState.currentFile = null;
  documentPaginationState.currentFileType = 'text';
  documentPaginationState.pdfCacheId = null;
  documentState.pdfPageDimensions = [];
  documentState.pdfAveragePageDimensions = null;
  documentPaginationState.isOriginalView = false;
  documentPaginationState.originalLayoutCache = {};
  documentPaginationState.pdfRawTextCache = {};
  if (readerState.sourceText) readerState.sourceText.value = text || '';
  setDocMode(text || '');
}
export function initializeFileImport() {
  if (readerState.clearFileBtn) {
    readerState.clearFileBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      clearLoadedFile();
    });
  }
  if (readerState.clearRawTextBtn) {
    readerState.clearRawTextBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      clearLoadedFile();
    });
  }
  readerState.fileButton.addEventListener('click', function () {
    readerState.fileInput.click();
  });
  readerState.fileInput.addEventListener('change', function (ev) {
    var file = ev.target.files && ev.target.files[0];
    if (file) loadFile(file);
  });
  readerState.dropZone.addEventListener('dragover', function (ev) {
    ev.preventDefault();
    readerState.dropZone.classList.add('drag-over');
  });
  readerState.dropZone.addEventListener('dragleave', function (ev) {
    if (ev.target === readerState.dropZone || !readerState.dropZone.contains(ev.relatedTarget))
      readerState.dropZone.classList.remove('drag-over');
  });
  readerState.dropZone.addEventListener('drop', function (ev) {
    ev.preventDefault();
    readerState.dropZone.classList.remove('drag-over');
    var dt = ev.dataTransfer;
    if (dt && dt.files && dt.files.length) loadFile(dt.files[0]);
  });
  // ===================== ORIGINAL VIEW MODE =====================

  // Toggle between layout-aware and raw text for segmentation
  if (documentPaginationState.origViewCheckbox) {
    documentPaginationState.origViewCheckbox.addEventListener('change', function () {
      documentPaginationState.isOriginalView = documentPaginationState.origViewCheckbox.checked;
      if (documentPaginationState.inputMode === 'pdf') {
        // PDF mode: toggle only changes which text is sent for segmentation
        // PDF.js viewer stays visible regardless
        documentPaginationState.pageLookupTextByIndex = {};
        documentPaginationState.originalLayoutCache = {};
        documentPaginationState.pdfRawTextCache = {};
        documentPaginationState.lastLookupPageIndex = -1;
        documentPaginationState.pendingPdfLookupPageIndex = -1;
        readerState.latestSeq += 1;
        triggerUpdate();
      } else if (documentPaginationState.currentFileType === 'docx') {
        // DOCX original view handling
        if (readerState.sourcePager) {
          if (documentPaginationState.isOriginalView) {
            readerState.sourcePager.classList.add('orig-view-mode');
          } else {
            readerState.sourcePager.classList.remove('orig-view-mode');
          }
        }
        if (documentPaginationState.isOriginalView && documentPaginationState.currentFile) {
          readerState.latestSeq += 1;
          readerState.statusText.textContent = 'Loading DOCX layout...';
          readerState.statusCounts.textContent = '';
          var mySeq = ++documentState.docxOriginal.renderSeq;
          var fileForRender = documentPaginationState.currentFile;
          var fileToken = getDocxFileToken(fileForRender);
          Promise.resolve()
            .then(function () {
              if (!fileForRender) return;
              if (
                documentState.docxOriginal.buf &&
                documentState.docxOriginal.fileToken === fileToken
              )
                return;
              return fileForRender.arrayBuffer().then(function (buf) {
                if (mySeq !== documentState.docxOriginal.renderSeq) return;
                documentState.docxOriginal.buf = buf;
                documentState.docxOriginal.fileToken = fileToken;
              });
            })
            .then(function () {
              return ensureDocxPreviewLoaded();
            })
            .then(function () {
              if (mySeq !== documentState.docxOriginal.renderSeq) return;
              documentPaginationState.inputMode = 'doc';
              if (readerState.sourceText) readerState.sourceText.style.display = 'none';
              if (readerState.sourcePager) {
                readerState.sourcePager.style.display = 'block';
                readerState.sourcePager.classList.add('orig-view-mode');
              }
              return renderDocxPreviewInto(readerState.sourcePager, documentState.docxOriginal.buf);
            })
            .then(function () {
              if (mySeq !== documentState.docxOriginal.renderSeq) return;
              documentState.docxOriginal.rendered = true;
              readerState.statusText.textContent = 'Ready.';
              triggerUpdate();
            })
            .catch(function (err) {
              console.error(err);
              readerState.statusText.textContent = 'DOCX layout failed.';
              readerState.renderedText.innerHTML =
                '<div class="reader-output-placeholder">DOCX preview failed to load.</div>';
            });
        } else {
          // Leaving DOCX original view
          documentPaginationState.pageLookupTextByIndex = {};
          documentState.docxOriginal.renderSeq += 1;
          documentState.docxOriginal.rendered = false;
          if (readerState.sourcePager) readerState.sourcePager.innerHTML = '';
          setDocMode(
            documentPaginationState.docText ||
              (readerState.sourceText ? readerState.sourceText.value || '' : '')
          );
          return;
        }
      } else {
        // Other modes
        documentPaginationState.pageLookupTextByIndex = {};
        updateRenderedOutputBackground();
        triggerUpdate();
      }
    });
  }

  // Build layout text from PDF word list
  return true;
}
