import { documentLibrariesState } from './document-libraries.state.mjs';
import { documentPaginationState } from './document-pagination.state.mjs';
import { triggerUpdate } from './lookup.mjs';
import { buildLayoutTextFromWords } from './pdf-layout-text.mjs';
export // Fetch geometrically-aware layout text for a specific page from the server
function fetchPageLayoutText(pageIdx) {
  if (!documentPaginationState.pdfCacheId) return;
  fetch('/api/pdf_page_text', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      cache_id: documentPaginationState.pdfCacheId,
      page: pageIdx
    })
  })
    .then(function (resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.json();
    })
    .then(function (data) {
      if (!data || !data.ok) {
        console.error('pdf_page_text error:', data);
        return;
      }
      // Build layout text from words/structured_blocks
      var layoutText = buildLayoutTextFromWords(data);
      if (layoutText) {
        documentPaginationState.originalLayoutCache[pageIdx] = layoutText;
      } else {
        // Fallback to raw text from the response
        documentPaginationState.originalLayoutCache[pageIdx] = data.raw_text || '';
      }
      documentPaginationState.pdfRawTextCache[pageIdx] = (data.raw_text || '').toString();
      // Populate renderedPageImages so the output panel's positioned word rendering works
      if (data.words && data.words.length > 0) {
        if (!documentPaginationState.renderedPageImages)
          documentPaginationState.renderedPageImages = {
            byIndex: {}
          };
        if (!documentPaginationState.renderedPageImages.byIndex)
          documentPaginationState.renderedPageImages.byIndex = {};
        documentPaginationState.renderedPageImages.byIndex[pageIdx] = {
          words: data.words,
          structured_blocks: data.structured_blocks || [],
          width: data.width || 612,
          height: data.height || 792
        };
      }
      // Now re-trigger update with cached layout text
      triggerUpdate();
    })
    .catch(function (err) {
      console.error('fetchPageLayoutText error:', err);
      // Fallback to raw text
      documentPaginationState.originalLayoutCache[pageIdx] =
        documentPaginationState.docPages && documentPaginationState.docPages[pageIdx] != null
          ? String(documentPaginationState.docPages[pageIdx])
          : '';
      documentPaginationState.pdfRawTextCache[pageIdx] =
        documentPaginationState.docPages && documentPaginationState.docPages[pageIdx] != null
          ? String(documentPaginationState.docPages[pageIdx])
          : '';
      triggerUpdate();
    });
}
export function fetchPdfjsTextLayer(pageIdx) {
  if (!documentLibrariesState.pdfJsIframe || !documentLibrariesState.pdfJsIframe.contentWindow) return;
  documentLibrariesState.pdfJsIframe.contentWindow.postMessage(
    {
      source: 'reader-parent',
      type: 'pdfjs-get-text-layer',
      sessionId: String(documentLibrariesState.pdfJsSessionId),
      pageNumber: pageIdx + 1
    },
    window.location.origin
  );
}
export function renderDocxPreviewInto(containerEl, arrayBuffer) {
  if (!containerEl) return Promise.resolve();
  containerEl.innerHTML = '';
  var wrap = document.createElement('div');
  wrap.className = 'docx-preview-host';
  containerEl.appendChild(wrap);
  return window.docx.renderAsync(arrayBuffer, wrap, null, {
    className: 'docx',
    ignoreWidth: false,
    ignoreHeight: false,
    ignoreFonts: false,
    breakPages: false,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true
  });
}
