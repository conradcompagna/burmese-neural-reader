
(function() {
  var GRAMMAR_TYPE_COLORS = {
    CLAUSE_ATTR: '#f59e0b', COMPOUND_NOUN_ELEM: '#16a34a', COMPOUND_VERB_ELEM: '#22c55e',
    CLASSIFIER: '#15803d', PREVERB: '#f97316', COORDINATOR: '#0ea5e9', LOCATION_NOUN: '#0891b2',
    MISC_FUNC: '#6b7280', NOUN_ATTR_MARKER: '#38bdf8', NOUN_MARKER: '#2563eb',
    NOUN_MODIFIER: '#1d4ed8', NEGATION_MARKER: '#dc2626', SELECTIVE: '#0d9488', SENTENCE_MARKER: '#4b5563',
    SENTENCE_MEDIAL_PART: '#6366f1', SENTENCE_FINAL_PART: '#a855f7', HEAD_NOUN: '#65a30d',
    SUBORDINATE_CLAUSE_MARKER: '#7c3aed', SUBORDINATE_SENTENCE_MARKER: '#7c3aed',
    VERB_ATTR_MARKER: '#84cc16', VERB_MODIFIER: '#d97706'
  };
  function getGrammarColor(type) { return GRAMMAR_TYPE_COLORS[type] || '#6b7280'; }
  function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function isMyanmarChar(ch) {
    if (!ch) return false;
    var cp = ch.codePointAt(0);
    if (!cp) return false;
    if (cp >= 0x1000 && cp <= 0x109F) return true;
    if (cp >= 0xAA60 && cp <= 0xAA7F) return true;
    if (cp >= 0xA9E0 && cp <= 0xA9FF) return true;
    return false;
  }
  function isMyanmarCombiningMark(ch) {
    if (!ch) return false;
    var cp = ch.codePointAt(0);
    if (!cp) return false;
    if (cp >= 0x102B && cp <= 0x103E) return true;
    if (cp >= 0x1056 && cp <= 0x1059) return true;
    if (cp >= 0x105E && cp <= 0x1060) return true;
    if (cp >= 0x1062 && cp <= 0x1064) return true;
    if (cp >= 0x1067 && cp <= 0x106D) return true;
    if (cp >= 0x1071 && cp <= 0x1074) return true;
    if (cp >= 0x1082 && cp <= 0x108D) return true;
    if (cp === 0x108F) return true;
    if (cp === 0x1094) return true;
    if (cp >= 0x109A && cp <= 0x109D) return true;
    if (cp === 0x1036 || cp === 0x1038 || cp === 0x1039 || cp === 0x103A) return true;
    return false;
  }
  // Characters that can serve as syllable bases (consonants and independent vowels)
  var MYANMAR_BASE_CONSONANTS = 'ကခဂဃငစဆဇဈဉညဋဌဍဎဏတထဒဓနပဖဗဘမယရလဝသဟဠအ';
  var MYANMAR_INDEPENDENT_VOWELS = 'ဣဤဥဦဧဩဪ';
  var MYANMAR_BASE_CHARS = MYANMAR_BASE_CONSONANTS + MYANMAR_INDEPENDENT_VOWELS;
  var MYANMAR_NUMERALS = '၀၁၂၃၄၅၆၇၈၉';
  var MYANMAR_ABBREVIATIONS = '၌၍၎၏';
  var VIRAMA = '\u1039'; // ္ - stacker that makes following consonant a modifier

  // Check if a character is a base consonant or independent vowel
  function isMyanmarBaseChar(ch) {
    return ch && MYANMAR_BASE_CHARS.indexOf(ch) >= 0;
  }

  // Check if token has at least one BASE consonant (not preceded by virama)
  // Stacked consonants (after virama) are modifiers, not bases
  function hasBaseConsonant(tok) {
    if (!tok) return false;
    for (var i = 0; i < tok.length; i++) {
      var ch = tok[i];
      if (isMyanmarBaseChar(ch)) {
        // Check if preceded by virama (making it a stacked consonant)
        if (i > 0 && tok[i - 1] === VIRAMA) {
          continue; // Stacked consonant, not a base
        }
        return true; // Found a base consonant
      }
    }
    return false;
  }

  // Check if token has any combining marks (diacritics that need a base)
  function hasCombiningMarks(tok) {
    if (!tok) return false;
    for (var i = 0; i < tok.length; i++) {
      if (isMyanmarCombiningMark(tok[i])) return true;
    }
    return false;
  }

  // Check if a token needs a dotted circle prefix
  // Only applies to tokens that have combining marks but no base consonant
  // Numerals, abbreviations, etc. don't need dotted circles
  function needsDottedCircle(tok) {
    if (!tok) return false;
    // Must have combining marks to need a dotted circle
    if (!hasCombiningMarks(tok)) return false;
    // Needs dotted circle if it has combining marks but no base consonant
    return !hasBaseConsonant(tok);
  }

  // Unicode dotted circle character for displaying combining marks in isolation
  var DOTTED_CIRCLE = '\u25CC';
  function isMyanmarPunctToken(tok) {
    return tok === '\u104a' || tok === '\u104b'; // ၊  ။
  }
  function hasMyanmarChars(str) {
    if (!str) return false;
    for (var i = 0; i < str.length; i++) {
      if (isMyanmarChar(str[i])) return true;
    }
    return false;
  }
  function debounce(fn, delay) {
    var t = null;
    return function() {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function() { fn.apply(ctx, args); }, delay);
    };
  }



// ------------------------------
// DOCX Original View (docx-preview) - Frontend-only
// ------------------------------

var docxOriginal = {
  buf: null,              // ArrayBuffer of current DOCX
  fileToken: null,        // cache key for current DOCX
  rendered: false,        // rendered into sourcePager
  renderSeq: 0            // cancellation token
};

var pdfOriginal = {
  doc: null,              // pdfjsLib document
  docPromise: null,       // in-flight load promise
  fileToken: null,        // cache key for current file
  renderSeq: 0            // cancellation token
};

var pdfPageDimensions = [];        // [{width,height}] from /api/extract_text
var pdfAveragePageDimensions = null; // {width,height} from /api/extract_text

function getDocxFileToken(file) {
  if (!file) return '';
  return [file.name || '', file.size || 0, file.lastModified || 0].join(':');
}

function sanitizePdfDimension(dim) {
  if (!dim || typeof dim !== 'object') return null;
  var w = Number(dim.width);
  var h = Number(dim.height);
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null;
  return { width: w, height: h };
}

function sanitizePdfDimensionList(list) {
  if (!Array.isArray(list)) return [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var dim = sanitizePdfDimension(list[i]);
    out.push(dim || { width: 0, height: 0 });
  }
  return out;
}

function computeAveragePdfDimension(list) {
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
  return { width: sumW / n, height: sumH / n };
}

function ensureDocxPreviewLoaded() {
  function loadCssOnce(href, id) {
    if (id && document.getElementById(id)) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    if (id) link.id = id;
    document.head.appendChild(link);
  }

  function loadScriptOnce(src, id) {
    return new Promise(function(resolve, reject) {
      if (id && document.getElementById(id)) return resolve();
      if (src.indexOf('jszip') >= 0 && window.JSZip) return resolve();
      if (src.indexOf('docx-preview') >= 0 && window.docx && window.docx.renderAsync) return resolve();
      var s = document.createElement('script');
      s.src = src;
      if (id) s.id = id;
      s.async = true;
      s.onload = function() { resolve(); };
      s.onerror = function() { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  loadCssOnce('https://cdn.jsdelivr.net/npm/docx-preview@0.3.5/dist/docx-preview.min.css', 'docx-preview-css');

  return loadScriptOnce('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'jszip-lib')
    .then(function() {
      return loadScriptOnce('https://cdn.jsdelivr.net/npm/docx-preview@0.3.5/dist/docx-preview.min.js', 'docx-preview-lib');
    })
    .then(function() {
      if (!window.docx || !window.docx.renderAsync) {
        throw new Error('docx-preview loaded but window.docx.renderAsync is missing');
      }
    });
}

function ensurePdfJsLoaded() {
  function loadCssOnce(href, id) {
    if (id && document.getElementById(id)) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    if (id) link.id = id;
    document.head.appendChild(link);
  }

  function loadScriptOnce(src, id) {
    return new Promise(function(resolve, reject) {
      if (id && document.getElementById(id)) return resolve();
      if (src.indexOf('pdf.min.js') >= 0 && window.pdfjsLib) return resolve();
      var s = document.createElement('script');
      s.src = src;
      if (id) s.id = id;
      s.async = true;
      s.onload = function() { resolve(); };
      s.onerror = function() { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  loadCssOnce('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/web/pdf_viewer.min.css', 'pdfjs-viewer-css');

  return loadScriptOnce('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js', 'pdfjs-lib')
    .then(function() {
      if (!window.pdfjsLib) {
        throw new Error('pdfjsLib missing after load');
      }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    });
}

function getPdfFileToken(file) {
  if (!file) return '';
  return [file.name || '', file.size || 0, file.lastModified || 0].join(':');
}

function getPdfJsDocument(file) {
  if (!file) return Promise.reject(new Error('no file'));
  var token = getPdfFileToken(file);
  if (pdfOriginal.doc && pdfOriginal.fileToken === token) return Promise.resolve(pdfOriginal.doc);
  if (pdfOriginal.docPromise && pdfOriginal.fileToken === token) return pdfOriginal.docPromise;
  pdfOriginal.fileToken = token;
  pdfOriginal.doc = null;
  pdfOriginal.docPromise = file.arrayBuffer().then(function(buf) {
    return window.pdfjsLib.getDocument({ data: buf }).promise;
  }).then(function(doc) {
    pdfOriginal.doc = doc;
    return doc;
  });
  return pdfOriginal.docPromise;
}

// ---- PDF.js full viewer embedding ----
var pdfJsRenderedPages = {};  // pageNum -> true (tracks which pages have been rendered)
var pdfJsObserver = null;     // IntersectionObserver for lazy page rendering
var pdfJsIframe = null;       // iframe host for actual PDF.js viewer
var pdfJsSessionId = 0;       // increments on each PDF load to ignore stale iframe events

function buildPdfJsIframeSrc(cacheId, sessionId) {
  var qs = '?cache_id=' + encodeURIComponent(cacheId || '') + '&session_id=' + encodeURIComponent(String(sessionId || ''));
  return '/static/pdfjs_iframe_viewer.html' + qs;
}

function postPdfPageDimsCacheToIframe() {
  if (!pdfJsIframe || !pdfJsIframe.contentWindow) return;
  try {
    pdfJsIframe.contentWindow.postMessage({
      source: 'reader-parent',
      type: 'pdfjs-set-page-dims-cache',
      sessionId: String(pdfJsSessionId),
      pageDims: Array.isArray(pdfPageDimensions) ? pdfPageDimensions : []
    }, window.location.origin);
  } catch (e) {
    // ignore
  }
}

function mountPdfJsIframe(cacheId) {
  if (!sourcePager) return;
  sourcePager.innerHTML = '';
  var iframe = document.createElement('iframe');
  iframe.className = 'pdfjs-host-iframe';
  iframe.title = 'PDF.js Viewer';
  iframe.src = buildPdfJsIframeSrc(cacheId, pdfJsSessionId);
  iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
  iframe.addEventListener('load', function() {
    postPdfPageDimsCacheToIframe();
  });
  sourcePager.appendChild(iframe);
  pdfJsIframe = iframe;
}

function loadPdfIntoViewer(cacheId, pages) {
  docPages = normalizePages(pages || []);
  pdfCacheId = cacheId;
  activePageIndex = 0;
  lastLookupPageIndex = -1;
  pendingPdfLookupPageIndex = -1;
  pageLookupTextByIndex = {};
  originalLayoutCache = {};
  pdfRawTextCache = {};
  if (!pdfAveragePageDimensions) {
    pdfAveragePageDimensions = computeAveragePdfDimension(pdfPageDimensions);
  }

  inputMode = 'pdf';
  docPagerIsPaged = false;
  if (sourceText) sourceText.style.display = 'none';
  if (sourcePager) {
    sourcePager.style.display = 'block';
    sourcePager.classList.add('pdfjs-native-mode');
    sourcePager.classList.remove('orig-view-mode');
    sourcePager.scrollTop = 0;
    var fixedH = getFixedPdfPagerHeightPx();
    sourcePager.style.height = fixedH + 'px';
    sourcePager.style.maxHeight = fixedH + 'px';
    sourcePager.style.visibility = 'visible';
    sourcePager.style.pointerEvents = '';
    applyGlobalViewportClamp(true);
  }

  statusText.textContent = 'Loading PDF viewer...';
  pdfJsSessionId += 1;
  pdfjsTextLayerCache = {};
  mountPdfJsIframe(cacheId);
  requestAnimationFrame(function() {
    applyGlobalViewportClamp(true);
    triggerUpdate();
  });
}

function renderAllPdfPages(pdfDoc) {
  if (!sourcePager) return;
  pdfJsRenderedPages = {};
  resizePagerToFitPdfPage();
  var pageSize = getPdfTargetPageSize();

  var container = document.createElement('div');
  container.className = 'pdfjs-pages-container';
  sourcePager.appendChild(container);

  var numPages = pdfDoc.numPages;
  for (var i = 1; i <= numPages; i++) {
    var pageDiv = document.createElement('div');
    pageDiv.className = 'pdfjs-page';
    pageDiv.dataset.pageNum = String(i);
    applyPdfPageShellSize(pageDiv, pageSize);
    pageDiv.style.background = '#e5e7eb';
    appendPdfPageHeader(pageDiv, i, numPages);

    container.appendChild(pageDiv);
  }

  // Clean up previous observer
  if (pdfJsObserver) {
    pdfJsObserver.disconnect();
    pdfJsObserver = null;
  }

  // Use IntersectionObserver for lazy rendering
  pdfJsObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        var pageNum = parseInt(entry.target.dataset.pageNum);
        if (!pdfJsRenderedPages[pageNum]) {
          pdfJsRenderedPages[pageNum] = true;
          renderSinglePdfPage(pdfDoc, pageNum, entry.target);
        }
      }
    });
  }, { root: sourcePager, rootMargin: '400px' });

  var allPages = container.querySelectorAll('.pdfjs-page');
  for (var j = 0; j < allPages.length; j++) {
    pdfJsObserver.observe(allPages[j]);
  }
}

function getPdfTargetPageSize() {
  var width = 0;
  if (sourcePager) {
    var rect = sourcePager.getBoundingClientRect();
    width = Math.floor(sourcePager.clientWidth || rect.width || 0);
  }
  if (!isFinite(width) || width <= 0) width = 600;
  var height = computePageMaxHeightPx();
  if (!isFinite(height) || height <= 0) {
    height = Math.ceil(width * 1.414);
  }
  return {
    width: Math.max(1, width),
    height: Math.max(180, Math.floor(height))
  };
}

function applyPdfPageShellSize(pageDiv, pageSize) {
  if (!pageDiv || !pageSize) return;
  pageDiv.style.width = '100%';
  pageDiv.style.height = pageSize.height + 'px';
  pageDiv.style.minHeight = pageSize.height + 'px';
}

function appendPdfPageHeader(pageDiv, pageNum, numPages) {
  var pageHeader = document.createElement('div');
  pageHeader.className = 'pdfjs-page-header';
  pageHeader.textContent = 'Page ' + pageNum + ' / ' + numPages;
  pageDiv.appendChild(pageHeader);
}

function getPdfPageDimensionsFor(pageNum, fallbackWidth, fallbackHeight) {
  var idx = Math.max(0, (pageNum | 0) - 1);
  var dim = sanitizePdfDimension(pdfPageDimensions[idx]);
  if (dim) return dim;
  dim = sanitizePdfDimension(pdfAveragePageDimensions);
  if (dim) return dim;
  dim = sanitizePdfDimension({ width: fallbackWidth, height: fallbackHeight });
  if (dim) return dim;
  return { width: 1, height: 1 };
}

function resizePagerToFitPdfPage() {
  if (!sourcePager || inputMode !== 'pdf') return;
  var pageSize = getPdfTargetPageSize();
  sourcePager.style.height = pageSize.height + 'px';
  sourcePager.style.maxHeight = pageSize.height + 'px';
}

function renderSinglePdfPage(pdfDoc, pageNum, pageDiv) {
  pdfDoc.getPage(pageNum).then(function(page) {
    var baseViewport = page.getViewport({ scale: 1.0 });
    var pageSize = getPdfTargetPageSize();
    applyPdfPageShellSize(pageDiv, pageSize);

    var pageRect = pageDiv.getBoundingClientRect();
    var targetW = Math.max(1, Math.floor(pageRect.width || pageSize.width));
    var targetH = Math.max(1, Math.floor(pageRect.height || pageSize.height));
    var inputDim = getPdfPageDimensionsFor(pageNum, baseViewport.width, baseViewport.height);

    var fitRatio = Math.min(targetW / Math.max(1, inputDim.width), targetH / Math.max(1, inputDim.height));
    if (!isFinite(fitRatio) || fitRatio <= 0) {
      fitRatio = Math.min(
        targetW / Math.max(1, baseViewport.width),
        targetH / Math.max(1, baseViewport.height)
      );
    }
    if (!isFinite(fitRatio) || fitRatio <= 0) fitRatio = 1.0;

    var desiredW = Math.max(1, Math.round(inputDim.width * fitRatio));
    var desiredH = Math.max(1, Math.round(inputDim.height * fitRatio));
    var scaleW = desiredW / Math.max(1, baseViewport.width);
    var scaleH = desiredH / Math.max(1, baseViewport.height);
    var renderScale = scaleW;
    if (!isFinite(renderScale) || renderScale <= 0) renderScale = scaleH;
    if (!isFinite(renderScale) || renderScale <= 0) renderScale = fitRatio;
    if (!isFinite(renderScale) || renderScale <= 0) renderScale = 1.0;

    var scaledViewport = page.getViewport({ scale: renderScale });
    var renderW = Math.max(1, Math.floor(scaledViewport.width));
    var renderH = Math.max(1, Math.floor(scaledViewport.height));
    var offsetX = Math.max(0, Math.floor((targetW - renderW) / 2));
    var offsetY = Math.max(0, Math.floor((targetH - renderH) / 2));

    pageDiv.innerHTML = '';
    pageDiv.style.background = '';
    pageDiv.style.position = 'relative';
    applyPdfPageShellSize(pageDiv, pageSize);

    var numPages = pdfDoc.numPages;
    appendPdfPageHeader(pageDiv, pageNum, numPages);

    var canvas = document.createElement('canvas');
    canvas.className = 'pdfjs-page-canvas';
    canvas.width = renderW;
    canvas.height = renderH;
    canvas.style.position = 'absolute';
    canvas.style.left = offsetX + 'px';
    canvas.style.top = offsetY + 'px';
    canvas.style.width = renderW + 'px';
    canvas.style.height = renderH + 'px';
    pageDiv.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    page.render({ canvasContext: ctx, viewport: scaledViewport }).promise
      .then(function() {
        return page.getTextContent();
      })
      .then(function(textContent) {
        if (window.pdfjsLib && window.pdfjsLib.renderTextLayer) {
          var textLayer = document.createElement('div');
          textLayer.className = 'textLayer';
          textLayer.style.position = 'absolute';
          textLayer.style.left = offsetX + 'px';
          textLayer.style.top = offsetY + 'px';
          textLayer.style.right = 'auto';
          textLayer.style.bottom = 'auto';
          textLayer.style.width = renderW + 'px';
          textLayer.style.height = renderH + 'px';
          pageDiv.appendChild(textLayer);
          window.pdfjsLib.renderTextLayer({
            textContent: textContent,
            container: textLayer,
            viewport: scaledViewport,
            textDivs: []
          });
        }
      })
      .catch(function(err) {
        console.error('PDF.js page render error:', err);
      });
  });
}

// Fetch geometrically-aware layout text for a specific page from the server
function fetchPageLayoutText(pageIdx) {
  if (!pdfCacheId) return;
  fetch('/api/pdf_page_text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cache_id: pdfCacheId, page: pageIdx })
  })
    .then(function(resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.json(); })
    .then(function(data) {
      if (!data || !data.ok) {
        console.error('pdf_page_text error:', data);
        return;
      }
      // Build layout text from words/structured_blocks
      var layoutText = buildLayoutTextFromWords(data);
      if (layoutText) {
        originalLayoutCache[pageIdx] = layoutText;
      } else {
        // Fallback to raw text from the response
        originalLayoutCache[pageIdx] = data.raw_text || '';
      }
      pdfRawTextCache[pageIdx] = (data.raw_text || '').toString();
      // Populate renderedPageImages so the output panel's positioned word rendering works
      if (data.words && data.words.length > 0) {
        if (!renderedPageImages) renderedPageImages = { byIndex: {} };
        if (!renderedPageImages.byIndex) renderedPageImages.byIndex = {};
        renderedPageImages.byIndex[pageIdx] = {
          words: data.words,
          structured_blocks: data.structured_blocks || [],
          width: data.width || 612,
          height: data.height || 792
        };
      }
      // Now re-trigger update with cached layout text
      triggerUpdate();
    })
    .catch(function(err) {
      console.error('fetchPageLayoutText error:', err);
      // Fallback to raw text
      originalLayoutCache[pageIdx] = (docPages && docPages[pageIdx] != null) ? String(docPages[pageIdx]) : '';
      pdfRawTextCache[pageIdx] = (docPages && docPages[pageIdx] != null) ? String(docPages[pageIdx]) : '';
      triggerUpdate();
    });
}

function fetchPdfjsTextLayer(pageIdx) {
  if (!pdfJsIframe || !pdfJsIframe.contentWindow) return;
  pdfJsIframe.contentWindow.postMessage({
    source: 'reader-parent',
    type: 'pdfjs-get-text-layer',
    sessionId: String(pdfJsSessionId),
    pageNumber: pageIdx + 1
  }, window.location.origin);
}

function renderDocxPreviewInto(containerEl, arrayBuffer) {
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

function buildDomTextModel(root) {
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: function(n) {
      if (!n || !n.nodeValue) return NodeFilter.FILTER_REJECT;
      var p = n.parentElement;
      if (p) {
        var tag = (p.tagName || '').toLowerCase();
        if (tag === 'script' || tag === 'style') return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  var index = [];
  var text = '';
  while (walker.nextNode()) {
    var node = walker.currentNode;
    var start = text.length;
    var s = node.nodeValue;
    text += s;
    index.push({ node: node, start: start, len: s.length });
  }
  return { text: text, index: index, root: root };
}

function locateDomPos(model, globalOffset) {
  var idx = model.index;
  var lo = 0, hi = idx.length - 1;
  while (lo <= hi) {
    var mid = (lo + hi) >> 1;
    var it = idx[mid];
    if (globalOffset < it.start) hi = mid - 1;
    else if (globalOffset >= it.start + it.len) lo = mid + 1;
    else return { node: it.node, offset: globalOffset - it.start };
  }
  if (globalOffset === model.text.length && idx.length) {
    var last = idx[idx.length - 1];
    return { node: last.node, offset: last.len };
  }
  throw new Error('Offset out of bounds: ' + globalOffset);
}

function getVisibleDocxSliceClone(sourcePagerEl) {
  var host = sourcePagerEl ? sourcePagerEl.querySelector('.docx-preview-host') : null;
  if (!host) return { fragment: document.createDocumentFragment(), sliceRoot: null, sliceText: '' };

  var blocks = host.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, table');
  var pagerRect = sourcePagerEl.getBoundingClientRect();
  var overscanPx = 120;
  var topY = pagerRect.top - overscanPx;
  var botY = pagerRect.bottom + overscanPx;

  var frag = document.createDocumentFragment();
  var sliceWrap = document.createElement('div');
  sliceWrap.className = 'docx-slice-wrap';

  var kept = 0;
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    var r = b.getBoundingClientRect();
    if (r.bottom < topY) continue;
    if (r.top > botY) break;
    sliceWrap.appendChild(b.cloneNode(true));
    kept++;
  }

  if (!kept) sliceWrap.appendChild(host.cloneNode(true));

  frag.appendChild(sliceWrap);

  var model = buildDomTextModel(sliceWrap);
  return { fragment: frag, sliceRoot: sliceWrap, sliceText: model.text };
}

// Compute the visible text slice directly from the live docx-preview DOM (no clones).
function getVisibleDocxSliceText(sourcePagerEl) {
  var host = sourcePagerEl ? sourcePagerEl.querySelector('.docx-preview-host') : null;
  if (!host) return { text: '', start: 0, end: 0, model: null };

  var model = buildDomTextModel(host);
  if (!model || !model.text) return { text: '', start: 0, end: 0, model: model };
  var textLength = model.text.length;
  if (!textLength) return { text: '', start: 0, end: 0, model: model };

  var containerRect = sourcePagerEl.getBoundingClientRect();
  var viewTop = containerRect.top;
  var viewBottom = containerRect.bottom;

  function getCharRect(globalIndex) {
    var safeIndex = Math.max(0, Math.min(globalIndex, textLength - 1));
    var pos = locateDomPos(model, safeIndex);
    if (!pos || !pos.node) return null;
    var nodeLen = pos.node.nodeValue ? pos.node.nodeValue.length : 0;
    if (!nodeLen) return null;
    var range = document.createRange();
    range.setStart(pos.node, pos.offset);
    range.setEnd(pos.node, Math.min(pos.offset + 1, nodeLen));
    var rects = range.getClientRects();
    if (rects && rects.length) return rects[0];
    return range.getBoundingClientRect();
  }

  function getCharTop(globalIndex) {
    var r = getCharRect(globalIndex);
    return r ? r.top : viewTop;
  }

  function getCharBottom(globalIndex) {
    var r = getCharRect(globalIndex);
    return r ? r.bottom : viewTop;
  }

  function findFirstPartiallyVisible() {
    var lo = 0, hi = textLength - 1;
    var result = 0;
    while (lo <= hi) {
      var mid = Math.floor((lo + hi) / 2);
      var y = getCharBottom(mid);
      if (y < viewTop) {
        lo = mid + 1;
      } else {
        result = mid;
        hi = mid - 1;
      }
    }
    return result;
  }

  function findLastPartiallyVisible() {
    var lo = 0, hi = textLength - 1;
    var result = textLength - 1;
    while (lo <= hi) {
      var mid = Math.floor((lo + hi) / 2);
      var y = getCharTop(mid);
      if (y > viewBottom) {
        hi = mid - 1;
      } else {
        result = mid;
        lo = mid + 1;
      }
    }
    return result;
  }

  function lineTolForIndex(idx) {
    var r = getCharRect(idx);
    var h = (r && r.height) ? r.height : 14;
    return Math.max(1, h * 0.35);
  }

  function findLineStart(idx) {
    var lineY = getCharTop(idx);
    var target = lineY - lineTolForIndex(idx);
    var lo = 0, hi = idx;
    var result = idx;
    while (lo <= hi) {
      var mid = Math.floor((lo + hi) / 2);
      var y = getCharTop(mid);
      if (y < target) {
        lo = mid + 1;
      } else {
        result = mid;
        hi = mid - 1;
      }
    }
    return result;
  }

  function findLineEnd(idx) {
    var lineY = getCharTop(idx);
    var target = lineY + lineTolForIndex(idx);
    var lo = idx, hi = textLength - 1;
    var result = idx;
    while (lo <= hi) {
      var mid = Math.floor((lo + hi) / 2);
      var y = getCharTop(mid);
      if (y > target) {
        hi = mid - 1;
      } else {
        result = mid;
        lo = mid + 1;
      }
    }
    return result + 1;
  }

  function getLineBounds(idx) {
    return { start: findLineStart(idx), end: findLineEnd(idx) };
  }

  function getLineVisibilityRatio(bounds) {
    if (!bounds) return 0;
    var start = bounds.start;
    var end = bounds.end;
    var endIdx = Math.max(start, Math.min(textLength - 1, end - 1));
    var lineTop = getCharTop(start);
    var lineBottom = getCharBottom(endIdx);
    var visibleTop = Math.max(lineTop, viewTop);
    var visibleBottom = Math.min(lineBottom, viewBottom);
    var visible = Math.max(0, visibleBottom - visibleTop);
    var height = Math.max(1, lineBottom - lineTop);
    return visible / height;
  }

  var firstPartial = findFirstPartiallyVisible();
  var lastPartial = findLastPartiallyVisible();
  if (firstPartial > lastPartial) {
    var fallback = Math.max(0, Math.min(textLength - 1, lastPartial));
    if (!isFinite(fallback) || fallback < 0 || fallback >= textLength) {
      fallback = Math.max(0, Math.min(textLength - 1, firstPartial));
    }
    firstPartial = fallback;
    lastPartial = fallback;
  }

  var topBounds = getLineBounds(firstPartial);
  var bottomBounds = getLineBounds(lastPartial);
  var topRatio = getLineVisibilityRatio(topBounds);
  var bottomRatio = getLineVisibilityRatio(bottomBounds);

  var startIdx = topBounds.start;
  var endIdx = bottomBounds.end;
  if (topRatio < DOC_LINE_VISIBILITY_THRESHOLD) startIdx = topBounds.end;
  if (bottomRatio < DOC_LINE_VISIBILITY_THRESHOLD) endIdx = bottomBounds.start;

  if (startIdx >= endIdx) {
    if (topRatio >= bottomRatio) {
      startIdx = topBounds.start;
      endIdx = topBounds.end;
    } else {
      startIdx = bottomBounds.start;
      endIdx = bottomBounds.end;
    }
  }

  var maxChars = WINDOWED_MAX_CHARS;
  var guard = 0;
  while (endIdx - startIdx > maxChars && guard < 200) {
    var prevLineStart = findLineStart(endIdx - 1);
    if (prevLineStart <= startIdx) break;
    endIdx = prevLineStart;
    guard++;
  }

  var visibleText = model.text.slice(startIdx, endIdx);
  if (visibleText.length > maxChars) visibleText = visibleText.slice(0, maxChars);

  return { text: visibleText, start: startIdx, end: endIdx, model: model };
}

function buildVisibleDocxSliceFragment(sliceInfo) {
  if (!sliceInfo || !sliceInfo.model) {
    return { sliceRoot: null };
  }
  var model = sliceInfo.model;
  var start = Math.max(0, sliceInfo.start || 0);
  var end = Math.max(start, sliceInfo.end || 0);
  if (!model.text || !model.text.length || end <= start) {
    return { sliceRoot: null };
  }
  var wrap = document.createElement('div');
  // Preserve docx-preview styling in the lookup pane.
  wrap.className = 'docx-preview-host docx';
  try {
    var a = locateDomPos(model, start);
    var b = locateDomPos(model, end);
    var r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    var frag = r.cloneContents();
    wrap.appendChild(frag);
  } catch (e) {
    return { sliceRoot: null };
  }
  return { sliceRoot: wrap };
}

function applyOffsetsAsTokenSpansOnDom(sliceRoot, data) {
  if (!sliceRoot) return;

  var segments = Array.isArray(data.segments) ? data.segments : [];
  var gramOverlay = (data.grammar_overlay && Array.isArray(data.grammar_overlay.tokens)) ? data.grammar_overlay.tokens : [];
  var resultsBySeg = Array.isArray(data.results_by_seg) ? data.results_by_seg : [];
  var udTokenMap = latestUdTokenMap || {};

  var offsets = (data && Array.isArray(data.segment_offsets)) ? data.segment_offsets : null;
  if (!offsets || offsets.length !== segments.length) return;

  function splitTokenSpanByLines(span, segIdx) {
    if (!span || !span.parentNode) return;
    if (!(isOriginalView && currentFileType === 'docx')) return;
    if (!span.firstChild || span.childNodes.length !== 1 || span.firstChild.nodeType !== Node.TEXT_NODE) return;
    var rects = span.getClientRects ? span.getClientRects() : null;
    if (!rects || rects.length <= 1) return;
    var textNode = span.firstChild;
    var text = textNode.nodeValue || '';
    if (!text || text.length < 2) return;

    var range = document.createRange();
    var lastTop = null;
    var breakIdxs = [];
    for (var i = 0; i < text.length; i++) {
      range.setStart(textNode, i);
      range.setEnd(textNode, Math.min(i + 1, text.length));
      var rlist = range.getClientRects();
      var r = (rlist && rlist.length) ? rlist[0] : range.getBoundingClientRect();
      if (!r || !isFinite(r.top)) continue;
      if (lastTop == null) {
        lastTop = r.top;
      } else if (Math.abs(r.top - lastTop) > 0.5) {
        breakIdxs.push(i);
        lastTop = r.top;
      }
    }
    if (!breakIdxs.length) return;

    var pieces = [];
    var start = 0;
    for (var bi = 0; bi < breakIdxs.length; bi++) {
      var idx = breakIdxs[bi];
      if (idx > start) pieces.push(text.slice(start, idx));
      start = idx;
    }
    if (start < text.length) pieces.push(text.slice(start));
    if (!pieces.length) return;

    span.textContent = pieces[0];
    registerTokenSpan(segIdx, span);

    var parent = span.parentNode;
    var ref = span;
    for (var pi = 1; pi < pieces.length; pi++) {
      var piece = pieces[pi];
      if (!piece) continue;
      var clone = span.cloneNode(false);
      clone.textContent = piece;
      parent.insertBefore(clone, ref.nextSibling);
      ref = clone;
      registerTokenSpan(segIdx, clone);
    }
  }

  function forceTokenColor(el, color) {
    if (!el || !el.style) return;
    try {
      el.style.setProperty('color', color, 'important');
    } catch (e) {}
    var kids = el.querySelectorAll ? el.querySelectorAll('*') : [];
    for (var i = 0; i < kids.length; i++) {
      try {
        kids[i].style.setProperty('color', color, 'important');
      } catch (e2) {}
    }
  }

  // Walk text nodes in DOM order and map segments sequentially (no binary search).
  var textNodes = [];
  var walker = document.createTreeWalker(
    sliceRoot,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        if (!node || !node.nodeValue) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  var tn = walker.nextNode();
  while (tn) {
    textNodes.push(tn);
    tn = walker.nextNode();
  }

  var segIdx = 0;
  var segCount = segments.length;
  var globalPos = 0;

  for (var ni = 0; ni < textNodes.length; ni++) {
    var node = textNodes[ni];
    var text = node.nodeValue || '';
    var nodeStart = globalPos;
    var nodeEnd = nodeStart + text.length;
    globalPos = nodeEnd;
    if (!text.length) continue;

    // Advance past segments that end before this node.
    while (segIdx < segCount) {
      var offSkip = offsets[segIdx];
      if (!offSkip || offSkip.length < 2) { segIdx++; continue; }
      var endSkip = Number(offSkip[1]);
      if (!isFinite(endSkip) || endSkip <= nodeStart) {
        segIdx++;
        continue;
      }
      break;
    }
    if (segIdx >= segCount) break;

    var firstOff = offsets[segIdx];
    if (!firstOff || firstOff.length < 2) continue;
    var firstStart = Number(firstOff[0]);
    if (!isFinite(firstStart) || firstStart >= nodeEnd) {
      continue; // No segment starts in this node
    }

    var frag = document.createDocumentFragment();
    var spansToSplit = [];
    var cursor = 0;
    var localSegIdx = segIdx;
    var didChange = false;

    while (localSegIdx < segCount) {
      var off = offsets[localSegIdx];
      if (!off || off.length < 2) { localSegIdx++; segIdx = localSegIdx; continue; }
      var segStart = Number(off[0]);
      var segEnd = Number(off[1]);
      if (!isFinite(segStart) || !isFinite(segEnd) || segEnd <= segStart) { localSegIdx++; segIdx = localSegIdx; continue; }
      if (segStart >= nodeEnd) break;

      var localStart = Math.max(segStart, nodeStart) - nodeStart;
      var localEnd = Math.min(segEnd, nodeEnd) - nodeStart;
      if (localEnd <= localStart) {
        if (segEnd <= nodeStart) {
          localSegIdx++;
          segIdx = localSegIdx;
          continue;
        }
        break;
      }

      if (localStart > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, localStart)));
      }

      var piece = text.slice(localStart, localEnd);
      if (piece.length) {
        var tokInfo = buildTokenSpan(localSegIdx, segments[localSegIdx], gramOverlay, resultsBySeg, udTokenMap, { lightweight: true });
        var span = tokInfo && tokInfo.span ? tokInfo.span : null;
        if (span) {
          span.innerHTML = '';
          var needsDotted = needsDottedCircle(segments[localSegIdx]);
          var isFirstPart = segStart >= nodeStart;
          span.textContent = (needsDotted && isFirstPart) ? (DOTTED_CIRCLE + piece) : piece;
          if (tokInfo && tokInfo.isUnknown) {
            span.dataset.hasUnknown = '1';
            if (isOriginalView && currentFileType === 'docx' && !span.classList.contains('unknown-token')) {
              span.classList.add('unknown-token');
            }
            forceTokenColor(span, '#b91c1c');
          }
          frag.appendChild(span);
          registerTokenSpan(localSegIdx, span);
          spansToSplit.push({ span: span, segIdx: localSegIdx });
        } else {
          frag.appendChild(document.createTextNode(piece));
        }
        didChange = true;
      }

      cursor = localEnd;

      if (segEnd <= nodeEnd) {
        localSegIdx++;
        segIdx = localSegIdx;
      } else {
        // Segment continues into next text node
        segIdx = localSegIdx;
        break;
      }
    }

    if (cursor < text.length) {
      frag.appendChild(document.createTextNode(text.slice(cursor)));
    }
    if (didChange && node.parentNode) {
      node.parentNode.replaceChild(frag, node);
      if (spansToSplit.length && isOriginalView && currentFileType === 'docx') {
        spansToSplit.forEach(function(item) {
          splitTokenSpanByLines(item.span, item.segIdx);
        });
      }
    }
  }
}
  function matchTokenWithInvisibleChars(source, startIndex, token) {
    // Frontend no longer does any normalization.
    // We only wrap tokens that are exact substrings of the original text.
    if (!token || !token.length) return null;
    var tLen = token.length;
    // Require an exact match starting at this position
    if (source.substr(startIndex, tLen) !== token) {
      return null;
    }
    return { end: startIndex + tLen - 1 };
  }

  function _blockHasOverlap(spans, debug) {
    if (!spans || spans.length < 2) return false;

    // Group spans into lines using actual line data from PyMuPDF
    var byLine = {};
    for (var i = 0; i < spans.length; i++) {
      var s = spans[i];
      var lineKey = s.dataset.line || '0';
      if (!byLine[lineKey]) byLine[lineKey] = [];
      byLine[lineKey].push(s);
    }

    // Within each line, sort by X and compute gap for each adjacent pair
    var allGaps = []; // Positive = gap, negative = overlap
    var overlaps = [];
    var lineKeys = Object.keys(byLine);
    for (var li = 0; li < lineKeys.length; li++) {
      var lineSpans = byLine[lineKeys[li]];
      if (lineSpans.length < 2) continue;
      // Get rects and sort by left edge
      var indexed = lineSpans.map(function(s) {
        return { r: s.getBoundingClientRect(), s: s };
      });
      indexed.sort(function(a, b) { return a.r.left - b.r.left; });
      // Check adjacent pairs
      for (var j = 0; j < indexed.length - 1; j++) {
        var curr = indexed[j];
        var next = indexed[j + 1];
        // Gap = next.left - curr.right (positive = gap, negative = overlap)
        var gap = next.r.left - curr.r.right;
        allGaps.push(gap);
        if (gap < 0) {
          overlaps.push({
            line: lineKeys[li],
            curr: { text: curr.s.textContent, left: curr.r.left, right: curr.r.right },
            next: { text: next.s.textContent, left: next.r.left, right: next.r.right },
            overlapPx: -gap
          });
        }
      }
    }

    // Calculate median gap - if median is negative, we have significant overlap
    var medianGap = 0;
    if (allGaps.length > 0) {
      allGaps.sort(function(a, b) { return a - b; });
      var mid = Math.floor(allGaps.length / 2);
      medianGap = (allGaps.length % 2) ? allGaps[mid] : (allGaps[mid - 1] + allGaps[mid]) / 2;
    }
    var hasSignificantOverlap = medianGap < 0;

    if (debug) {
      return {
        hasOverlap: hasSignificantOverlap,
        overlaps: overlaps,
        lines: lineKeys.length,
        totalSpans: spans.length,
        totalPairs: allGaps.length,
        medianGap: medianGap,
        minGap: allGaps.length ? allGaps[0] : 0,
        maxGap: allGaps.length ? allGaps[allGaps.length - 1] : 0
      };
    }
    return hasSignificantOverlap;
  }
  window._blockHasOverlap = _blockHasOverlap;

  function normalizeBlockFontSizes(container, baseFontPx) {
    if (!container) return;
    var spans = container.querySelectorAll('.pdf-raw-word');
    if (!spans || !spans.length) return;
    var byBlock = {};
    spans.forEach(function(s) {
      var b = s.dataset.block || '0';
      if (!byBlock[b]) byBlock[b] = [];
      byBlock[b].push(s);
    });
    Object.keys(byBlock).forEach(function(blockKey) {
      var blockSpans = byBlock[blockKey];
      if (!blockSpans || blockSpans.length < 2) return;
      var baseSize = (baseFontPx && isFinite(baseFontPx) && baseFontPx > 0) ? baseFontPx : 0;
      if (!baseSize) {
        for (var i = 0; i < blockSpans.length; i++) {
          var fs = parseFloat(blockSpans[i].style.fontSize || '0');
          if (fs > 0) { baseSize = fs; break; }
        }
      }
      if (!baseSize) return;
      var size = Math.floor(baseSize);
      var minSize = Math.max(6, size - 12);
      for (; size >= minSize; size -= 1) {
        for (var k = 0; k < blockSpans.length; k++) {
          blockSpans[k].style.fontSize = size + 'px';
        }
        if (!_blockHasOverlap(blockSpans)) break;
      }
    });
  }

  function normalizeLinePositions(container) {
    if (!container) return;
    var spans = container.querySelectorAll('.pdf-raw-word');
    if (!spans || !spans.length) return;

    // Group spans by block and line
    var byBlockLine = {};
    spans.forEach(function(s) {
      var blockKey = s.dataset.block || '0';
      var lineKey = s.dataset.line || '0';
      var key = blockKey + ':' + lineKey;
      if (!byBlockLine[key]) byBlockLine[key] = { block: blockKey, line: lineKey, spans: [] };
      byBlockLine[key].spans.push(s);
    });

    // Convert to array and sort by original Y position
    var lines = Object.values(byBlockLine);
    lines.forEach(function(lineData) {
      var minY = Infinity;
      lineData.spans.forEach(function(s) {
        var y = parseFloat(s.dataset.bboxY) || 0;
        if (y < minY) minY = y;
      });
      lineData.origY = minY;
    });
    lines.sort(function(a, b) { return a.origY - b.origY; });

    // Calculate the rendered height of each line
    lines.forEach(function(lineData) {
      var maxH = 0;
      lineData.spans.forEach(function(s) {
        var rect = s.getBoundingClientRect();
        if (rect.height > maxH) maxH = rect.height;
      });
      lineData.renderedH = maxH;
    });

    // Keep original vertical layout. Do not globally re-stack lines, which can
    // break tables/columns. Only straighten each line so all words on that line
    // share one top value.
    var containerH = container.getBoundingClientRect().height || 0;
    lines.forEach(function(lineData) {
      var topVals = [];
      lineData.spans.forEach(function(s) {
        var t = parseFloat(s.style.top || '');
        if (isFinite(t)) topVals.push(t);
      });
      var topPct;
      if (topVals.length) {
        topVals.sort(function(a, b) { return a - b; });
        topPct = topVals[Math.floor(topVals.length / 2)];
      } else if (containerH > 0) {
        topPct = (lineData.origY / containerH) * 100;
      } else {
        topPct = 0;
      }
      lineData.spans.forEach(function(s) {
        s.style.top = topPct + '%';
      });
    });
  }
  window.normalizeLinePositions = normalizeLinePositions;

  function wrapTokensInText(text) {
    if (!text) return '';
    var tokens = [];
    var currentToken = '';
    for (var i = 0; i < text.length; i++) {
      var char = text[i];
      var code = char.charCodeAt(0);
      // Myanmar: U+1000-U+109F, Myanmar Extended-A: U+AA60-U+AA7F, Myanmar Extended-B: U+A9E0-U+A9FF
      var isMyanmar = (code >= 0x1000 && code <= 0x109F) || (code >= 0xAA60 && code <= 0xAA7F) || (code >= 0xA9E0 && code <= 0xA9FF);
      if (isMyanmar) {
        currentToken += char;
      } else {
        if (currentToken) {
          tokens.push({ type: 'token', value: currentToken });
          currentToken = '';
        }
        tokens.push({ type: 'text', value: char });
      }
    }
    if (currentToken) {
      tokens.push({ type: 'token', value: currentToken });
    }
    var html = '';
    for (var j = 0; j < tokens.length; j++) {
      var t = tokens[j];
      if (t.type === 'token') {
        html += '<span class="panel-token" data-seg="' + escapeHtml(t.value) + '">' + escapeHtml(t.value) + '</span>';
      } else {
        html += escapeHtml(t.value);
      }
    }
    return html;
  }
  function renderSenseLines(senses, skipHead) {
    if (!senses || !senses.length) return '';
    var html = '<div style="display:grid;grid-template-columns:auto auto auto 1fr;gap:0 12px;align-items:start;font-size:12px;line-height:1.8;">';
    for (var li = 0; li < senses.length; li++) {
      var line = senses[li];
      if (!line || !line.trim()) continue;
      var tabCount = 0;
      for (var ci = 0; ci < line.length; ci++) { if (line[ci] === '\t') tabCount++; else break; }
      var content = line.substring(tabCount);
      if (!content || !content.trim()) continue;
      if (tabCount === 0) {
        var parts = content.split('\t');
        if (parts.length >= 4) {
          var headword = parts[0] || '', roman = parts[1] || '', pos = parts[2] || '', sense = parts.slice(3).join('\t');
          if (skipHead) {
            html += '<div style="font-weight:bold;font-size:13px;"></div>';
          } else {
            html += '<div style="font-weight:bold;font-size:13px;">' + escapeHtml(headword) + '</div>';
          }
          html += '<div style="font-style:italic;color:#666;">' + escapeHtml(roman) + '</div>';
          html += '<div style="color:#888;font-size:11px;">[' + escapeHtml(pos) + ']</div>';
          html += '<div style="color:#333;">' + escapeHtml(sense) + '</div>';
        }
      } else if (tabCount === 2) {
        var parts2 = content.split('\t');
        if (parts2.length >= 2) {
          html += '<div></div><div></div><div style="color:#888;font-size:11px;">[' + escapeHtml(parts2[0]) + ']</div>';
          html += '<div style="color:#333;">' + escapeHtml(parts2.slice(1).join('\t')) + '</div>';
        }
      } else {
        var sense3 = content.trim();
        if (sense3) { html += '<div></div><div></div><div></div><div style="color:#333;">' + escapeHtml(sense3) + '</div>'; }
      }
    }
    html += '</div>';
    return html;
  }
  // Extract first sense as plain text for fuzzy preview
  function getFirstSenseText(senses) {
    if (!senses || !senses.length) return '';
    for (var i = 0; i < senses.length; i++) {
      var line = senses[i];
      if (!line || !line.trim()) continue;
      var tabCount = 0;
      for (var ci = 0; ci < line.length; ci++) { if (line[ci] === '\t') tabCount++; else break; }
      var content = line.substring(tabCount);
      if (tabCount === 0) {
        var parts = content.split('\t');
        if (parts.length >= 4) {
          return parts.slice(3).join(' ').substring(0, 100);
        }
      } else if (tabCount === 2) {
        var parts2 = content.split('\t');
        if (parts2.length >= 2) {
          return parts2.slice(1).join(' ').substring(0, 100);
        }
      } else {
        return content.trim().substring(0, 100);
      }
    }
    return '';
  }
  // Render unknown word with spelling (red) and romanization
  function renderUnknownWord(spelling, g2pData) {
    var html = '';
    if (spelling) {
      html += '<div style="color:#c00;font-weight:bold;margin-bottom:2px;">' + escapeHtml(spelling) + '</div>';
    }
    if (g2pData && Array.isArray(g2pData.syllables) && g2pData.syllables.length) {
      html += '<div style="font-size:0.85em;color:#666;">';
      for (var si = 0; si < g2pData.syllables.length; si++) {
        var syll = g2pData.syllables[si];
        if (syll && syll.roman) html += escapeHtml(syll.roman) + ' ';
      }
      html += '</div>';
    }
    return html;
  }
  function applyNoteToPopup(head, note) {
    if (!notePopup) return;
    if (head !== currentPopupHead) return;
    note = note || '';
    if (note.trim()) {
      notePopup.textContent = note;
      notePopup.style.display = 'block';
      hoverPopupContainer.style.display = 'flex';
    } else {
      notePopup.textContent = '';
      notePopup.style.display = 'none';
    }
  }
  function updateNotePopupForHead(head) {
    if (!notePopup) return;
    currentPopupHead = head || null;
    if (!head) {
      notePopup.textContent = '';
      notePopup.style.display = 'none';
      return;
    }
    if (noteCache.has(head)) {
      applyNoteToPopup(head, noteCache.get(head));
      return;
    }
    fetch('/annotation?head=' + encodeURIComponent(head))
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        if (head !== currentPopupHead) return;
        var note = (data && data.ok && typeof data.note === 'string') ? data.note : '';
        noteCache.set(head, note);
        applyNoteToPopup(head, note);
      })
      .catch(function() {
        if (head !== currentPopupHead) return;
        noteCache.set(head, '');
        applyNoteToPopup(head, '');
      });
  }
  function setupAnnotationBox(head) {
    var area = document.getElementById('dict-annotation');
    var statusEl = document.getElementById('dict-annotation-status');
    if (!area) return;
    fetch('/annotation?head=' + encodeURIComponent(head))
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        var note = (data && data.ok && typeof data.note === 'string') ? data.note : '';
        area.value = note;
        noteCache.set(head, note);
        if (statusEl) statusEl.textContent = note ? 'Saved' : '';
      })
      .catch(function() {
        if (statusEl) statusEl.textContent = 'Could not load note';
      });
    var saveNote = debounce(function() {
      var value = area.value || '';
      fetch('/annotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ head: head, note: value })
      })
        .then(function(resp) { return resp.json(); })
        .then(function(data) {
          if (!data || !data.ok) {
            if (statusEl) statusEl.textContent = 'Error saving';
            return;
          }
          noteCache.set(head, value);
          if (statusEl) {
            statusEl.textContent = value.trim() ? 'Saved' : 'Note cleared';
          }
          if (currentPopupHead === head) {
            applyNoteToPopup(head, value);
          }
        })
        .catch(function() {
          if (statusEl) statusEl.textContent = 'Error saving';
        });
    }, 500);
    area.oninput = function() {
      if (statusEl) statusEl.textContent = 'Saving...';
      saveNote();
    };
  }
  // DOM refs
  var sourceText = document.getElementById('sourceText');
  var sourcePager = document.getElementById('sourcePager');
  var renderedText = document.getElementById('renderedText');
  var depTreeViewEl = document.getElementById('depTreeView');
  var statusText = document.getElementById('statusText');
  // statusCounts removed from UI - use dummy element to prevent errors
  var statusCounts = document.getElementById('statusCounts') || document.createElement('span');
  var dropZone = document.getElementById('dropZone');
  var fileInput = document.getElementById('fileInput');
  var fileButton = document.getElementById('fileButton');
  var fileNamePill = document.getElementById('fileNamePill');
  var fileNameText = document.getElementById('fileNameText');
  var clearFileBtn = document.getElementById('clearFileBtn');
  var rawTextPill = document.getElementById('rawTextPill');
  var rawTextText = document.getElementById('rawTextText');
  var clearRawTextBtn = document.getElementById('clearRawTextBtn');
  var hoverPopupContainer = document.getElementById('hoverPopupContainer');
  var grammarPopup = document.getElementById('grammarPopup');
  var hoverPopup = document.getElementById('hoverPopup');
  var udPopup = document.getElementById('udPopup');
  var g2pPopup = document.getElementById('g2pPopup');
  var notePopup = document.getElementById('notePopup');
  var subsegmentPopupsContainer = document.getElementById('subsegmentPopupsContainer');
  var sidePanel = document.getElementById('side-panel');
  var panelToggle = document.getElementById('panel-toggle');
  var topNav = document.getElementById('top-nav');
  var mainContainer = document.getElementById('main-container');
  var panelContent = document.getElementById('panel-content');
  var dictSearch = document.getElementById('dict-search');
  var searchBtn = document.getElementById('search-btn');
  var createBtn = document.getElementById('create-btn');
  var viewBtn = document.getElementById('view-btn');
  var latestSeq = 0;
  var segmentLookupAbort = null;
  var latestData = null;
  var latestSegments = null;
  var latestRawWordSpans = [];  // Raw PDF word spans for annotation
  var latestRawPageData = null;  // Page data for annotation
  var latestOriginalText = '';
  var latestFillsDict = null;
  var panelOpen = false;
  var depTreeController = null;
  var depTreeUseConllu = false;
  var depTreeConlluUrl = "/myudtree.sentence?i=";
  var depTreeConlluMetaUrl = "/myudtree.meta";
  var rawTextDocActive = false;
  var embeddedFontRegistry = {};
  var initialInputGuidance = 'Paste Burmese text here or upload a PDF, DOCX, or text file. Segmented text will appear below with parts of speech, word relationships and named entities marked. Hover for dictionary definitions, grammar hints and transliteration. Click to send to side window for further information, headword breakdowns and fuzzy matching on broken tokens (marked in red).';
  var initialInputGuidanceActive = false;
  var initialExampleDemoActive = false;

  function showInitialInputGuidanceIfEmpty() {
    if (!sourceText) return;
    if ((sourceText.value || '').trim()) return;
    sourceText.value = initialInputGuidance;
    initialInputGuidanceActive = true;
    autoResizeTextarea();
  }

  function clearInitialInputGuidanceIfNeeded() {
    if (!sourceText || !initialInputGuidanceActive) return;
    if ((sourceText.value || '') === initialInputGuidance) {
      sourceText.value = '';
    }
    initialInputGuidanceActive = false;
  }

  function isShowingInitialInputGuidance() {
    return !!sourceText && initialInputGuidanceActive && (sourceText.value || '') === initialInputGuidance;
  }

  function dismissInitialExampleDemo() {
    if (!initialExampleDemoActive) return;
    initialExampleDemoActive = false;
    latestData = null;
    latestSegments = [];
    latestOriginalText = '';
    if (renderedText) renderedText.innerHTML = '';
    if (!depTreeUseConllu && depTreeController && typeof depTreeController.setData === 'function') {
      depTreeController.setData({ segments: [], udOverlay: null });
    }
  }

  function renderInitialExampleDemoIfAvailable() {
    if (!renderedText) return;
    if (currentFile) return;
    if (inputMode !== 'raw') return;
    if ((renderedText.textContent || '').trim()) return;
    if (typeof INITIAL_EXAMPLE_CACHE === 'undefined' || !INITIAL_EXAMPLE_CACHE || !INITIAL_EXAMPLE_CACHE.ok) return;
    var cachedData = INITIAL_EXAMPLE_CACHE;
    var exampleText = cachedData.display_text || cachedData.q || '';
    latestData = cachedData;
    latestSegments = Array.isArray(cachedData.segments) ? cachedData.segments : [];
    initialExampleDemoActive = true;
    renderSegments(cachedData, exampleText);
  }

  function startSegmentLookupFetch(url) {
    dismissInitialExampleDemo();
    if (segmentLookupAbort) segmentLookupAbort.abort();
    segmentLookupAbort = new AbortController();
    return fetch(url, { signal: segmentLookupAbort.signal });
  }


  function isAbortError(err) {
    return err && err.name === 'AbortError';
  }

  function showRawTextPill(label) {
    rawTextDocActive = true;
    if (rawTextText) rawTextText.textContent = label || 'Clear text';
    if (rawTextPill) rawTextPill.style.display = 'inline-flex';
  }

  function hideRawTextPill() {
    rawTextDocActive = false;
    if (rawTextPill) rawTextPill.style.display = 'none';
    if (rawTextText) rawTextText.textContent = '';
  }

  // Original view toggle refs
  var origViewToggle = document.getElementById('origViewToggle');
  var origViewCheckbox = document.getElementById('origViewCheckbox');

  // ------------------------------
  // Document viewing (continuous text)
  // ------------------------------

  var inputMode = 'raw';
  var docText = '';              // Full document text (continuous, no pages)
  var WINDOWED_MAX_CHARS = 5000;
  var DOC_LINES_EMPTY = 5;       // Height in lines when empty
  var DOC_LINES_CONTENT = 30;    // Height in lines when content loaded
  var docLineHeight = 20;        // Will be calculated from actual font
  var DOC_LINE_VISIBILITY_THRESHOLD = 0.5;
  var docPagerIsPaged = false;   // True when sourcePager holds page elements

  // Legacy compatibility stubs (original view mode disabled)
  var docPages = [];
  var activePageIndex = 0;
  var lastLookupPageIndex = -1;
  var pendingPdfLookupPageIndex = -1;
  var pageLookupTextByIndex = {};
  var MOVEMENT_LOOKUP_IDLE_MS = 1000;
  var movementLookupTimer = null;

  function cancelMovementLookupTimer() {
    if (!movementLookupTimer) return;
    clearTimeout(movementLookupTimer);
    movementLookupTimer = null;
  }

  function requestMovementLookup() {
    cancelMovementLookupTimer();
    movementLookupTimer = setTimeout(function() {
      movementLookupTimer = null;
      triggerUpdate();
    }, MOVEMENT_LOOKUP_IDLE_MS);
  }

  // Original view state
  var currentFile = null;         // Store the File object for re-fetching
  var currentFileType = null;     // 'pdf', 'docx', or 'text'
  var pdfCacheId = null;          // Server-side cached PDF ID (avoids re-upload)
  var isOriginalView = false;     // Toggle state (controls layout vs raw text for segmentation)
  var originalLayoutCache = {};   // Cached layout text per page index
  var pdfRawTextCache = {};       // Cached raw page text per page index (from /api/pdf_page_text)
  var usePdfjsTextLayer = false;  // Toggle: use PDF.js text layer instead of backend extraction
  var pdfjsTextLayerCache = {};   // pageIndex -> { innerHTML, plainText, layerClass, layerStyle, computedScaleFactor, computedTotalScaleFactor, viewportWidth, viewportHeight }
  var renderedPageImages = { byIndex: {} };  // Per-page rendering data for output panel positioned view

  function setRawMode() {
    cancelMovementLookupTimer();
    pdfJsSessionId += 1;
    pdfJsIframe = null;
    inputMode = 'raw';
    docText = '';
    docPagerIsPaged = false;
    docPages = [];
    pdfPageDimensions = [];
    pdfAveragePageDimensions = null;
    activePageIndex = 0;
    lastLookupPageIndex = -1;
    pendingPdfLookupPageIndex = -1;
    pageLookupTextByIndex = {};
    originalLayoutCache = {};
    pdfRawTextCache = {};
    hideRawTextPill();
    if (sourcePager) {
      sourcePager.classList.remove('orig-view-mode');
      sourcePager.style.display = 'none';
      sourcePager.innerHTML = '';
    }
    if (sourceText) {
      sourceText.style.display = 'block';
      sourceText.disabled = false;
      sourceText.readOnly = false;
    }
    pdfjsTextLayerCache = {};
    applyDocPagerHeight();
  }

  function setDocMode(text) {
    inputMode = 'doc';
    docText = (text || '').replace(/\r\n/g, '\n');
    docPagerIsPaged = false;
    console.log('[setDocMode] Loaded text, chars:', docText.length);
    if (sourceText) sourceText.style.display = 'none';
    if (sourcePager) {
      sourcePager.style.display = 'block';
      renderDocTextIntoPager(docText);
      sourcePager.scrollTop = 0;
      applyDocPagerHeight();
    }
    triggerUpdate();
  }

  function getFixedPdfPagerHeightPx() {
    // Prefer an A4-like viewport (height ~= width * 1.414) for PDF mode.
    var baseH = Math.ceil(DOC_LINES_CONTENT * docLineHeight);
    if (!isFinite(baseH) || baseH <= 0) baseH = 600;

    var pagerW = 0;
    if (sourcePager) {
      var rect = sourcePager.getBoundingClientRect();
      pagerW = Math.floor(sourcePager.clientWidth || rect.width || 0);
    }
    var a4H = pagerW > 0 ? Math.ceil(pagerW * 1.41421356) : 0;

    // Keep a visibly larger PDF viewport while avoiding extreme sizes.
    var h = Math.max(baseH, a4H, 760);
    return Math.min(1180, Math.max(240, h));
  }

  function setPagedMode(pages) {
    // Legacy stub - redirects to PDF.js viewer for PDFs
    if (currentFileType === 'pdf' && pdfCacheId) {
      loadPdfIntoViewer(pdfCacheId, pages);
      return;
    }
    // For non-PDF paged content, fall through to doc mode
    inputMode = 'doc';
    docPages = normalizePages(pages || []);
    activePageIndex = 0;
    lastLookupPageIndex = -1;
    pendingPdfLookupPageIndex = -1;
    if (sourceText) sourceText.style.display = 'none';
    if (sourcePager) {
      sourcePager.style.display = 'block';
      sourcePager.scrollTop = 0;
    }
    triggerUpdate();
  }

  function normalizePages(pages) {
    var out = [];
    if (!Array.isArray(pages) || !pages.length) return [''];
    for (var i = 0; i < pages.length; i++) {
      var p = (pages[i] || '');
      p = p.replace(/\r\n/g, '\n');
      out.push(p);
    }
    return out.length ? out : [''];
  }

  function renderDocTextIntoPager(text) {
    if (!sourcePager) return;
    sourcePager.innerHTML = '';
    docPagerIsPaged = false;
    var textEl = document.createElement('div');
    textEl.className = 'reader-doc-text';
    textEl.textContent = text || '';
    sourcePager.appendChild(textEl);
    // Calculate line height from rendered text
    calculateDocLineHeight();
  }


  function calculateDocLineHeight() {
    if (!sourcePager) return;
    var textEl = sourcePager.querySelector('.reader-doc-text');
    if (!textEl) return;
    // Create a temporary single-line element to measure line height
    var measurer = document.createElement('div');
    measurer.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;';
    measurer.textContent = 'M';
    textEl.appendChild(measurer);
    var h = measurer.getBoundingClientRect().height;
    textEl.removeChild(measurer);
    if (h > 0) docLineHeight = h;
  }

  function applyDocPagerHeight() {
    if (!sourcePager) return;
    var hasContent = docText && docText.trim().length > 0;
    var lines = hasContent ? DOC_LINES_CONTENT : DOC_LINES_EMPTY;
    var h = Math.ceil(lines * docLineHeight);
    sourcePager.style.height = h + 'px';
    sourcePager.style.maxHeight = h + 'px';
    sourcePager.style.overflowY = hasContent ? 'auto' : 'hidden';
  }

  function getDocVisibleText() {
    if (!sourcePager || !docText) return '';
    var textEl = sourcePager.querySelector('.reader-doc-text');
    if (!textEl) return docText.slice(0, WINDOWED_MAX_CHARS);

    // Find the text node inside the element
    var textNode = null;
    for (var i = 0; i < textEl.childNodes.length; i++) {
      if (textEl.childNodes[i].nodeType === Node.TEXT_NODE && textEl.childNodes[i].textContent.length > 0) {
        textNode = textEl.childNodes[i];
        break;
      }
    }
    if (!textNode) return docText.slice(0, WINDOWED_MAX_CHARS);

    var textLength = textNode.textContent.length;
    if (textLength === 0) return '';

    // Get viewport bounds relative to sourcePager
    var containerRect = sourcePager.getBoundingClientRect();
    var viewTop = containerRect.top;
    var viewBottom = containerRect.bottom;

    function getCharRect(index) {
      var range = document.createRange();
      var safeIndex = Math.max(0, Math.min(index, textLength - 1));
      range.setStart(textNode, safeIndex);
      range.setEnd(textNode, Math.min(safeIndex + 1, textLength));
      var rects = range.getClientRects();
      if (rects && rects.length) return rects[0];
      return range.getBoundingClientRect();
    }

    function getCharTop(index) {
      return getCharRect(index).top;
    }

    function getCharBottom(index) {
      return getCharRect(index).bottom;
    }

    function findFirstPartiallyVisible() {
      var lo = 0, hi = textLength - 1;
      var result = 0;
      while (lo <= hi) {
        var mid = Math.floor((lo + hi) / 2);
        var y = getCharBottom(mid);
        if (y < viewTop) {
          lo = mid + 1;
        } else {
          result = mid;
          hi = mid - 1;
        }
      }
      return result;
    }

    function findLastPartiallyVisible() {
      var lo = 0, hi = textLength - 1;
      var result = textLength - 1;
      while (lo <= hi) {
        var mid = Math.floor((lo + hi) / 2);
        var y = getCharTop(mid);
        if (y > viewBottom) {
          hi = mid - 1;
        } else {
          result = mid;
          lo = mid + 1;
        }
      }
      return result;
    }

    var lineTol = Math.max(1, docLineHeight * 0.35);

    function findLineStart(idx) {
      var lineY = getCharTop(idx);
      var target = lineY - lineTol;
      var lo = 0, hi = idx;
      var result = idx;
      while (lo <= hi) {
        var mid = Math.floor((lo + hi) / 2);
        var y = getCharTop(mid);
        if (y < target) {
          lo = mid + 1;
        } else {
          result = mid;
          hi = mid - 1;
        }
      }
      return result;
    }

    function findLineEnd(idx) {
      var lineY = getCharTop(idx);
      var target = lineY + lineTol;
      var lo = idx, hi = textLength - 1;
      var result = idx;
      while (lo <= hi) {
        var mid = Math.floor((lo + hi) / 2);
        var y = getCharTop(mid);
        if (y > target) {
          hi = mid - 1;
        } else {
          result = mid;
          lo = mid + 1;
        }
      }
      return result + 1;
    }

    function getLineBounds(idx) {
      var start = findLineStart(idx);
      var end = findLineEnd(idx);
      return { start: start, end: end };
    }

    function getLineVisibilityRatio(bounds) {
      if (!bounds) return 0;
      var start = bounds.start;
      var end = bounds.end;
      var endIdx = Math.max(start, Math.min(textLength - 1, end - 1));
      var lineTop = getCharTop(start);
      var lineBottom = getCharBottom(endIdx);
      var visibleTop = Math.max(lineTop, viewTop);
      var visibleBottom = Math.min(lineBottom, viewBottom);
      var visible = Math.max(0, visibleBottom - visibleTop);
      var height = Math.max(1, lineBottom - lineTop);
      return visible / height;
    }

    var firstPartial = findFirstPartiallyVisible();
    var lastPartial = findLastPartiallyVisible();
    if (firstPartial > lastPartial) {
      var fallback = Math.max(0, Math.min(textLength - 1, lastPartial));
      if (!isFinite(fallback) || fallback < 0 || fallback >= textLength) {
        fallback = Math.max(0, Math.min(textLength - 1, firstPartial));
      }
      firstPartial = fallback;
      lastPartial = fallback;
    }

    var topBounds = getLineBounds(firstPartial);
    var bottomBounds = getLineBounds(lastPartial);
    var topRatio = getLineVisibilityRatio(topBounds);
    var bottomRatio = getLineVisibilityRatio(bottomBounds);

    var startIdx = topBounds.start;
    var endIdx = bottomBounds.end;
    if (topRatio < DOC_LINE_VISIBILITY_THRESHOLD) {
      startIdx = topBounds.end;
    }
    if (bottomRatio < DOC_LINE_VISIBILITY_THRESHOLD) {
      endIdx = bottomBounds.start;
    }
    if (startIdx >= endIdx) {
      if (topRatio >= bottomRatio) {
        startIdx = topBounds.start;
        endIdx = topBounds.end;
      } else {
        startIdx = bottomBounds.start;
        endIdx = bottomBounds.end;
      }
    }

    var maxChars = WINDOWED_MAX_CHARS;
    var guard = 0;
    while (endIdx - startIdx > maxChars && guard < 200) {
      var prevLineStart = findLineStart(endIdx - 1);
      if (prevLineStart <= startIdx) break;
      endIdx = prevLineStart;
      guard++;
    }

    var visibleText = textNode.textContent.slice(startIdx, endIdx);
    if (visibleText.length > maxChars) {
      visibleText = visibleText.slice(0, maxChars);
    }

    console.log('[getDocVisibleText] chars', startIdx, '-', endIdx, 'of', textLength, '| visible:', visibleText.length);

    return visibleText;
  }

function snapToLine() {
  if (!sourcePager || !docText || inputMode !== 'doc') return;
  var textEl = sourcePager.querySelector('.reader-doc-text');
  if (!textEl) return false;

    var textNode = null;
    for (var i = 0; i < textEl.childNodes.length; i++) {
      if (textEl.childNodes[i].nodeType === Node.TEXT_NODE && textEl.childNodes[i].textContent.length > 0) {
        textNode = textEl.childNodes[i];
        break;
      }
    }
    if (!textNode) return false;

    var textLength = textNode.textContent.length;
    if (textLength === 0) return false;

    var containerRect = sourcePager.getBoundingClientRect();
    var viewTop = containerRect.top;
    var viewBottom = containerRect.bottom;

    function getCharRect(index) {
      var range = document.createRange();
      var safeIndex = Math.max(0, Math.min(index, textLength - 1));
      range.setStart(textNode, safeIndex);
      range.setEnd(textNode, Math.min(safeIndex + 1, textLength));
      var rects = range.getClientRects();
      if (rects && rects.length) return rects[0];
      return range.getBoundingClientRect();
    }

    function getCharTop(index) {
      return getCharRect(index).top;
    }

    function getCharBottom(index) {
      return getCharRect(index).bottom;
    }

    function findFirstPartiallyVisible() {
      var lo = 0, hi = textLength - 1;
      var result = 0;
      while (lo <= hi) {
        var mid = Math.floor((lo + hi) / 2);
        var y = getCharBottom(mid);
        if (y < viewTop) {
          lo = mid + 1;
        } else {
          result = mid;
          hi = mid - 1;
        }
      }
      return result;
    }

    function findLastPartiallyVisible() {
      var lo = 0, hi = textLength - 1;
      var result = textLength - 1;
      while (lo <= hi) {
        var mid = Math.floor((lo + hi) / 2);
        var y = getCharTop(mid);
        if (y > viewBottom) {
          hi = mid - 1;
        } else {
          result = mid;
          lo = mid + 1;
        }
      }
      return result;
    }

    var startIdx = findFirstPartiallyVisible();
    var endIdx = findLastPartiallyVisible();
    if (startIdx > endIdx) endIdx = startIdx;

    var range = document.createRange();
    range.setStart(textNode, startIdx);
    range.setEnd(textNode, Math.min(endIdx + 1, textLength));
    var rects = range.getClientRects();
    if (!rects || !rects.length) {
      var singleRect = getCharRect(startIdx);
      if (!singleRect || !isFinite(singleRect.top)) return false;
      rects = [singleRect];
    }

    var lineTops = [];
    var lastTop = null;
    for (var r = 0; r < rects.length; r++) {
      var rect = rects[r];
      if (!rect || rect.height <= 0) continue;
      var top = rect.top;
      if (lastTop === null || Math.abs(top - lastTop) > 0.5) {
        lineTops.push(top);
        lastTop = top;
      }
    }
    if (!lineTops.length) return false;

    var scrollTop = sourcePager.scrollTop;
    var bestScroll = null;
    var bestDist = Infinity;
    for (var t = 0; t < lineTops.length; t++) {
      var targetScroll = scrollTop + (lineTops[t] - containerRect.top);
      var dist = Math.abs(targetScroll - scrollTop);
      if (dist < bestDist) {
        bestDist = dist;
        bestScroll = targetScroll;
      }
    }
    if (bestScroll == null) return false;
    if (Math.abs(bestScroll - scrollTop) > 1) {
      var maxScroll = Math.max(0, sourcePager.scrollHeight - sourcePager.clientHeight);
      var clamped = Math.max(0, Math.min(Math.round(bestScroll), maxScroll));
      if (Math.abs(clamped - scrollTop) <= 1) return false;
      sourcePager.scrollTo({ top: clamped, behavior: 'smooth' });
      return true;
    }
  return false;
}

function snapDocxToLine() {
  if (!sourcePager || inputMode !== 'doc' || !isOriginalView || currentFileType !== 'docx') return false;
  var host = sourcePager.querySelector('.docx-preview-host');
  if (!host) return false;
  var sliceInfo = getVisibleDocxSliceText(sourcePager);
  if (!sliceInfo || !sliceInfo.model || !sliceInfo.model.text) return false;
  var startIdx = Math.max(0, sliceInfo.start || 0);
  var endIdx = Math.max(startIdx, sliceInfo.end || 0);
  if (endIdx <= startIdx) endIdx = Math.min(startIdx + 1, sliceInfo.model.text.length);

  var containerRect = sourcePager.getBoundingClientRect();
  var scrollTop = sourcePager.scrollTop;

  try {
    var a = locateDomPos(sliceInfo.model, startIdx);
    var b = locateDomPos(sliceInfo.model, endIdx);
    if (!a || !b) return false;
    var range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    var rects = range.getClientRects();
    if (!rects || !rects.length) {
      var a2 = locateDomPos(sliceInfo.model, startIdx);
      if (!a2 || !a2.node) return false;
      var nodeLen2 = a2.node.nodeValue ? a2.node.nodeValue.length : 0;
      if (!nodeLen2) return false;
      var range2 = document.createRange();
      range2.setStart(a2.node, a2.offset);
      range2.setEnd(a2.node, Math.min(a2.offset + 1, nodeLen2));
      var rects2 = range2.getClientRects();
      if (!rects2 || !rects2.length) return false;
      rects = rects2;
    }

    var lineTops = [];
    var lastTop = null;
    for (var r = 0; r < rects.length; r++) {
      var rect = rects[r];
      if (!rect || rect.height <= 0) continue;
      var top = rect.top;
      if (lastTop === null || Math.abs(top - lastTop) > 0.5) {
        lineTops.push(top);
        lastTop = top;
      }
    }
    if (!lineTops.length) return false;

    var bestScroll = null;
    var bestDist = Infinity;
    for (var t = 0; t < lineTops.length; t++) {
      var targetScroll = scrollTop + (lineTops[t] - containerRect.top);
      var dist = Math.abs(targetScroll - scrollTop);
      if (dist < bestDist) {
        bestDist = dist;
        bestScroll = targetScroll;
      }
    }
    if (bestScroll == null) return false;
    if (Math.abs(bestScroll - scrollTop) > 1) {
      var maxScroll = Math.max(0, sourcePager.scrollHeight - sourcePager.clientHeight);
      var clamped = Math.max(0, Math.min(Math.round(bestScroll), maxScroll));
      if (Math.abs(clamped - scrollTop) <= 1) return false;
      sourcePager.scrollTo({ top: clamped, behavior: 'smooth' });
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

  function computePageMaxHeightPx() {
    var baseEl = sourcePager || sourceText;
    var w = baseEl ? (baseEl.getBoundingClientRect().width || 0) : 0;

    // Default: A4-ish aspect ratio (1.414)
    var aspect = 1.414;
    if (w > 0) {
      return Math.ceil(w * aspect);
    }
    return Math.ceil(window.innerHeight * 0.5);
  }

  var lastPageHeightPx = 0;

  function applyGlobalViewportClamp(forceCollapse) {
    var h = computePageMaxHeightPx();
    if (isFinite(h) && h > 0) lastPageHeightPx = h;
    var pagerMin = 180;
    var textMin = 180;
    var textMax = h;

    if (sourcePager) {
      sourcePager.style.setProperty('--pageMaxH', h + 'px');
      sourcePager.style.setProperty('--pageH', h + 'px');
      if (inputMode === 'pdf') {
        // Keep PDF viewport fixed to the doc-mode content window height.
        var fixedPdfH = getFixedPdfPagerHeightPx();
        sourcePager.style.height = fixedPdfH + 'px';
        sourcePager.style.maxHeight = fixedPdfH + 'px';
      } else if (inputMode === 'paged') {
        // In paged mode, set to exact page height
        sourcePager.style.height = h + 'px';
        sourcePager.style.maxHeight = h + 'px';
      } else {
        sourcePager.style.maxHeight = h + 'px';
        if (forceCollapse) {
          sourcePager.style.height = pagerMin + 'px';
        }
      }
    }
    if (sourceText) {
      if (inputMode === 'raw') {
        var rawMax = getRawMaxHeightPx();
        if (rawMax > 0) {
          textMax = Math.max(h, rawMax);
          var rawMin = getRawMinHeightPx();
          if (rawMin > 0) textMin = Math.max(textMin, rawMin);
          if (textMin > textMax) textMin = textMax;
        }
      }
      sourceText.style.setProperty('--pageMaxH', textMax + 'px');
      sourceText.style.setProperty('--pageH', textMax + 'px');
      sourceText.style.maxHeight = textMax + 'px';
      if (forceCollapse) {
        sourceText.style.height = textMin + 'px';
      }
    }
  }

  // ---- PDF.js iframe bridge (movement/page events -> active page) ----
  window.addEventListener('message', function(event) {
    if (event.origin !== window.location.origin) return;
    var data = event.data || {};
    if (!data || data.source !== 'pdfjs-iframe') return;
    if (String(data.sessionId || '') !== String(pdfJsSessionId)) return;
    if (inputMode !== 'pdf') return;

    if (data.type === 'pdfjs-error') {
      statusText.textContent = 'Failed to load PDF viewer.';
      if (renderedText) {
        renderedText.innerHTML = '<div class="reader-output-placeholder">PDF.js iframe error: ' + escapeHtml(String(data.error || 'unknown')) + '</div>';
      }
      return;
    }

    if (data.type === 'pdfjs-ready') {
      postPdfPageDimsCacheToIframe();
      statusText.textContent = 'Ready (' + (docPages.length || 0) + ' pages).';
      return;
    }

    if (data.type === 'pdfjs-dimensions') {
      if (sourcePager) {
        // Fixed-viewport mode: do not adjust container height from page dimensions.
        sourcePager.style.visibility = 'visible';
        sourcePager.style.pointerEvents = '';
      }
      return;
    }

    if (data.type === 'pdfjs-scroll') {
      var scrollIdx = Number(data.pageIndex);
      if (isFinite(scrollIdx)) {
        scrollIdx = Math.floor(scrollIdx);
        if (scrollIdx >= 0) {
          var maxScrollIdx = Math.max(0, (docPages.length || 1) - 1);
          if (scrollIdx > maxScrollIdx) scrollIdx = maxScrollIdx;
          if (scrollIdx !== activePageIndex) {
            activePageIndex = scrollIdx;
          }
        }
      }
      requestMovementLookup();
      return;
    }

    if (data.type === 'pdfjs-text-layer') {
      if (data.error) {
        console.warn('PDF.js text layer error:', data.error);
        return;
      }
      var tlIdx = Number(data.pageIndex);
      if (isFinite(tlIdx) && tlIdx >= 0) {
        pdfjsTextLayerCache[tlIdx] = {
          innerHTML: (typeof data.innerHTML === 'string') ? data.innerHTML : '',
          plainText: (typeof data.plainText === 'string') ? data.plainText : '',
          layerClass: (typeof data.layerClass === 'string') ? data.layerClass : 'textLayer',
          layerStyle: (typeof data.layerStyle === 'string') ? data.layerStyle : '',
          computedScaleFactor: Number(data.computedScaleFactor) || 1,
          computedTotalScaleFactor: Number(data.computedTotalScaleFactor) || (Number(data.computedScaleFactor) || 1),
          viewportWidth: Number(data.viewportWidth) || 0,
          viewportHeight: Number(data.viewportHeight) || 0
        };
        if (usePdfjsTextLayer) triggerUpdate();
      }
      return;
    }

    if (data.type !== 'pdfjs-pagechange') return;
    var idx = Number(data.pageIndex);
    if (!isFinite(idx)) return;
    idx = Math.floor(idx);
    if (idx < 0) return;
    var maxIdx = Math.max(0, (docPages.length || 1) - 1);
    if (idx > maxIdx) idx = maxIdx;
    if (idx === activePageIndex) return;
    activePageIndex = idx;
    requestMovementLookup();
  });

  var pagerPointerDown = false;
  var pagerScrollPending = false;

function handlePagerScrollStop() {
  if (inputMode === 'pdf') {
    // PDF.js mode: page tracking comes from iframe postMessage events.
    return;
  }
  if (inputMode !== 'doc') return;
  if (isOriginalView && currentFileType === 'docx') {
    snapDocxToLine();
  } else {
    snapToLine();
  }
}

  if (sourcePager) {
    sourcePager.addEventListener('mousedown', function(ev) {
      if (ev && ev.button === 0) pagerPointerDown = true;
    });
    sourcePager.addEventListener('touchstart', function() {
      pagerPointerDown = true;
    }, { passive: true });
  }
  window.addEventListener('mouseup', function() {
    if (!pagerPointerDown) return;
    pagerPointerDown = false;
    if (pagerScrollPending) {
      pagerScrollPending = false;
      handlePagerScrollStop();
    }
  });
  window.addEventListener('touchend', function() {
    if (!pagerPointerDown) return;
    pagerPointerDown = false;
    if (pagerScrollPending) {
      pagerScrollPending = false;
      handlePagerScrollStop();
    }
  });

  if (sourcePager) {
    sourcePager.addEventListener('scroll', function() {
      if (inputMode === 'pdf') {
        // PDF scroll happens inside the iframe, not on sourcePager.
        return;
      }
      if (inputMode !== 'doc') return;
      if (pagerPointerDown) pagerScrollPending = true;
      requestMovementLookup();
    });
  }

  var rerenderPdfPagesOnResizeDebounced = debounce(function() {
    if (inputMode !== 'pdf' || !pdfJsIframe || !pdfJsIframe.contentWindow) return;
    try {
      pdfJsIframe.contentWindow.postMessage({
        source: 'reader-parent',
        type: 'pdfjs-parent-resize',
        sessionId: String(pdfJsSessionId)
      }, window.location.origin);
    } catch (e) {
      // ignore
    }
  }, 120);

  window.addEventListener('resize', function() {
    applyGlobalViewportClamp(false);
    invalidateUdRectCache();
    invalidateUiRectCache();
    rerenderPdfPagesOnResizeDebounced();
  });
  applyGlobalViewportClamp(true);

  // ===================== UD DEPENDENCY VISUALIZATION =====================
  var udSvgOverlay = null;
  var latestUdOverlay = null;
  var latestNerSpans = [];
  var latestCollapsedSpanInfo = {}; // Map segIdx -> { firstSeg, lastSeg, combinedText, udTok, isFirst }
  var latestUdTokenMap = {}; // Map segIdx -> UD token
  var latestUdStructure = null; // Cached UD structural maps for chunking
  var udTokenIndex = new Map(); // Map from segment index to first token span element
  var udTokenFragments = new Map(); // Map from segment index to ALL token span fragments

  function rebuildUdCaches(udOverlay) {
    latestUdTokenMap = {};
    latestCollapsedSpanInfo = {};
    latestUdStructure = null;
    if (!udOverlay || !Array.isArray(udOverlay.tokens)) return;
    var tokens = udOverlay.tokens;
    var tokenMap = {};
    var children = {};
    var parentOf = {};
    var tokenPosition = {};
    var tokenIds = [];

    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      if (!tok || typeof tok.i !== 'number') continue;
      tokenMap[tok.i] = tok;
      latestUdTokenMap[tok.i] = tok;
      children[tok.i] = [];
      tokenIds.push(tok.i);
      var pos = (typeof tok.doc_i === "number" && isFinite(tok.doc_i)) ? tok.doc_i : i;
      tokenPosition[tok.i] = pos;

      if (tok.seg_span && Array.isArray(tok.seg_span) && tok.seg_span.length > 1) {
        var firstSeg = tok.seg_span[0];
        var lastSeg = tok.seg_span[tok.seg_span.length - 1];
        var combinedText = tok.text || '';
        for (var si = 0; si < tok.seg_span.length; si++) {
          var segIdx = tok.seg_span[si];
          latestCollapsedSpanInfo[segIdx] = {
            firstSeg: firstSeg,
            lastSeg: lastSeg,
            combinedText: combinedText,
            udTok: tok,
            isFirst: (segIdx === firstSeg)
          };
        }
      }
    }

    for (var j = 0; j < tokens.length; j++) {
      var t = tokens[j];
      if (!t || typeof t.i !== 'number') continue;
      var headIdx = t.head;
      if (headIdx !== undefined && headIdx !== t.i && tokenMap[headIdx]) {
        children[headIdx].push(t.i);
        parentOf[t.i] = headIdx;
      }
    }

    var roots = [];
    for (var k = 0; k < tokenIds.length; k++) {
      var seg = tokenIds[k];
      if (parentOf[seg] === undefined) roots.push(seg);
    }

    var tokenDepths = {};
    var maxDepth = 0;
    var queue = roots.slice();
    for (var qi = 0; qi < queue.length; qi++) {
      var cur = queue[qi];
      tokenDepths[cur] = 0;
    }
    for (var q = 0; q < queue.length; q++) {
      var cur2 = queue[q];
      var ch = children[cur2] || [];
      for (var c = 0; c < ch.length; c++) {
        var child = ch[c];
        if (tokenDepths[child] === undefined) {
          tokenDepths[child] = tokenDepths[cur2] + 1;
          if (tokenDepths[child] > maxDepth) maxDepth = tokenDepths[child];
          queue.push(child);
        }
      }
    }

    latestUdStructure = {
      tokenMap: tokenMap,
      children: children,
      parentOf: parentOf,
      tokenPosition: tokenPosition,
      tokenDepths: tokenDepths,
      maxDepth: maxDepth,
      tokenIds: tokenIds
    };
  }

  function setLatestUdOverlay(udOverlay) {
    latestUdOverlay = udOverlay || null;
    latestNerSpans = (latestUdOverlay && Array.isArray(latestUdOverlay.ents)) ? latestUdOverlay.ents : [];
    rebuildUdCaches(latestUdOverlay);
  }

  function isDocxOriginalActive() {
    return !!(isOriginalView && currentFileType === 'docx');
  }

  function registerTokenSpan(segIdx, span) {
    if (segIdx == null || segIdx < 0 || !span) return;
    if (!isDocxOriginalActive()) {
      // Default behavior: last span wins (preserves PDF original view behavior)
      udTokenIndex.set(segIdx, span);
      return;
    }
    if (!udTokenIndex.has(segIdx)) {
      udTokenIndex.set(segIdx, span);
    }
    var list = udTokenFragments.get(segIdx);
    if (!list) {
      list = [];
      udTokenFragments.set(segIdx, list);
    }
    if (list.indexOf(span) === -1) {
      list.push(span);
    }
  }

  function clearUdTokenIndex() {
    udTokenIndex.clear();
    udTokenFragments.clear();
  }

  function getTokenSpanList(segIdx) {
    if (isDocxOriginalActive()) {
      var list = udTokenFragments.get(segIdx);
      if (list && list.length) return list;
    }
    var single = udTokenIndex.get(segIdx);
    return single ? [single] : [];
  }
  // === UD GEOMETRY / CLEANUP CACHES ===
  var udTokenRectCache = new Map();  // segIdx -> {left, top, width, height, right, bottom, cx, cy}
  var udContainerRect = null;        // Cached renderedText bounding rect at cache build time
  var udActivePaths = [];            // Track SVG elements created for fast cleanup
  var udActiveHighlights = [];       // Track highlighted elements for fast cleanup
  var nerHoverOverlay = null;
  var hoverReticle = null;
  var lastHoverReticleSegIdx = -1;
  var lastHoverReticleTarget = null;

  function ensureUdSvgOverlay() {
    if (udSvgOverlay) return udSvgOverlay;
    udSvgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    udSvgOverlay.id = 'ud-svg-overlay';
    udSvgOverlay.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    // Add arrow marker definition
    var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    var marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'ud-arrowhead');
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('refX', '7');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    var polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', '0 0, 8 3, 0 6');
    polygon.setAttribute('class', 'ud-dep-arrow');
    marker.appendChild(polygon);
    defs.appendChild(marker);
    // Root arrow marker
    var rootMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    rootMarker.setAttribute('id', 'ud-arrowhead-root');
    rootMarker.setAttribute('markerWidth', '8');
    rootMarker.setAttribute('markerHeight', '6');
    rootMarker.setAttribute('refX', '7');
    rootMarker.setAttribute('refY', '3');
    rootMarker.setAttribute('orient', 'auto');
    var rootPolygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    rootPolygon.setAttribute('points', '0 0, 8 3, 0 6');
    rootPolygon.setAttribute('class', 'ud-dep-arrow root-arrow');
    rootMarker.appendChild(rootPolygon);
    defs.appendChild(rootMarker);
    // Child arrow marker (same direction as blue, just orange color)
    var childMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    childMarker.setAttribute('id', 'ud-arrowhead-child');
    childMarker.setAttribute('markerWidth', '8');
    childMarker.setAttribute('markerHeight', '6');
    childMarker.setAttribute('refX', '7');
    childMarker.setAttribute('refY', '3');
    childMarker.setAttribute('orient', 'auto');
    var childPolygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    childPolygon.setAttribute('points', '0 0, 8 3, 0 6');
    childPolygon.setAttribute('class', 'ud-dep-arrow child-arrow');
    childMarker.appendChild(childPolygon);
    defs.appendChild(childMarker);
    // Context-stroke arrow marker (matches line color)
    var contextMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    contextMarker.setAttribute('id', 'ud-arrowhead-context');
    contextMarker.setAttribute('markerWidth', '8');
    contextMarker.setAttribute('markerHeight', '6');
    contextMarker.setAttribute('refX', '7');
    contextMarker.setAttribute('refY', '3');
    contextMarker.setAttribute('orient', 'auto');
    var contextPolygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    contextPolygon.setAttribute('points', '0 0, 8 3, 0 6');
    contextPolygon.setAttribute('fill', 'context-stroke');
    contextPolygon.setAttribute('stroke', 'context-stroke');
    contextMarker.appendChild(contextPolygon);
    defs.appendChild(contextMarker);
    // Faded arrow markers for clause mode (same colors, reduced opacity)
    var fadedMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    fadedMarker.setAttribute('id', 'ud-arrowhead-faded');
    fadedMarker.setAttribute('markerWidth', '8');
    fadedMarker.setAttribute('markerHeight', '6');
    fadedMarker.setAttribute('refX', '7');
    fadedMarker.setAttribute('refY', '3');
    fadedMarker.setAttribute('orient', 'auto');
    var fadedPolygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    fadedPolygon.setAttribute('points', '0 0, 8 3, 0 6');
    fadedPolygon.setAttribute('fill', '#6366f1');
    fadedPolygon.setAttribute('opacity', '0.25');
    fadedMarker.appendChild(fadedPolygon);
    defs.appendChild(fadedMarker);
    var fadedChildMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    fadedChildMarker.setAttribute('id', 'ud-arrowhead-child-faded');
    fadedChildMarker.setAttribute('markerWidth', '8');
    fadedChildMarker.setAttribute('markerHeight', '6');
    fadedChildMarker.setAttribute('refX', '7');
    fadedChildMarker.setAttribute('refY', '3');
    fadedChildMarker.setAttribute('orient', 'auto');
    var fadedChildPolygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    fadedChildPolygon.setAttribute('points', '0 0, 8 3, 0 6');
    fadedChildPolygon.setAttribute('fill', '#e67e22');
    fadedChildPolygon.setAttribute('opacity', '0.25');
    fadedChildMarker.appendChild(fadedChildPolygon);
    defs.appendChild(fadedChildMarker);
    udSvgOverlay.appendChild(defs);
    renderedText.appendChild(udSvgOverlay);
    return udSvgOverlay;
  }

  // --- UD rect caching (avoid per-hover layout queries) ---
  function invalidateUdRectCache() {
    udTokenRectCache.clear();
    udContainerRect = null;
  }

  function buildUdRectCache() {
    udTokenRectCache.clear();
    if (!renderedText) { udContainerRect = null; return; }
    udContainerRect = renderedText.getBoundingClientRect();
    if (!udContainerRect) return;
    udTokenIndex.forEach(function(spanEl, segIdx) {
      if (!spanEl || typeof spanEl.getBoundingClientRect !== 'function') return;
      var r = spanEl.getBoundingClientRect();
      if (!r) return;
      var left = r.left - udContainerRect.left;
      var top = r.top - udContainerRect.top;
      udTokenRectCache.set(Number(segIdx), {
        left: left,
        top: top,
        width: r.width,
        height: r.height,
        right: left + r.width,
        bottom: top + r.height,
        cx: left + (r.width / 2),
        cy: top + (r.height / 2)
      });
    });
  }

  function ensureUdRectCache() {
    if (!udContainerRect || udTokenRectCache.size === 0) buildUdRectCache();
  }


  // === UI RECT CACHE (POPUPS / CHIPS / NON-TOKEN ELEMENTS) ===
  // These caches are separate from the token geometry cache (udTokenRectCache).
  // They primarily exist to avoid repeated layout reads (getBoundingClientRect) across hot paths like
  // hover popups and NER chips, while being conservatively invalidated on layout changes.
  var uiRectCache = new WeakMap();   // element -> { epoch, rect:{left,top,right,bottom,width,height} }
  var uiRectCacheEpoch = 1;

  function invalidateUiRectCache() {
    uiRectCache = new WeakMap();
    uiRectCacheEpoch++;
  }

  function invalidateUiRectFor(el) {
    try { if (uiRectCache && el) uiRectCache.delete(el); } catch (e) {}
  }

  function _rectObjFromDomRect(r) {
    if (!r) return null;
    return {
      left: r.left, top: r.top, right: r.right, bottom: r.bottom,
      width: r.width, height: r.height
    };
  }

  function getUiRect(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    var rec = null;
    try { rec = uiRectCache.get(el); } catch (e) { rec = null; }
    if (rec && rec.epoch === uiRectCacheEpoch && rec.rect) return rec.rect;

    var r = null;
    try { r = el.getBoundingClientRect(); } catch (e2) { r = null; }
    if (!r) return null;

    var obj = _rectObjFromDomRect(r);
    try { uiRectCache.set(el, { epoch: uiRectCacheEpoch, rect: obj }); } catch (e3) {}
    return obj;
  }

  // Prefer UD token geometry cache for .reader-token spans (fast + stable). Falls back to UI rect cache.
  function getViewportRectForTokenSpan(spanEl) {
    if (!spanEl) return null;
    var segIdx = parseInt((spanEl.dataset && spanEl.dataset.index) ? spanEl.dataset.index : '-1', 10);
    if (isFinite(segIdx) && segIdx >= 0) {
      ensureUdRectCache();
      var t = udTokenRectCache.get(segIdx);
      if (t && udContainerRect && isFinite(udContainerRect.left) && isFinite(udContainerRect.top)) {
        var L = udContainerRect.left + t.left;
        var T = udContainerRect.top + t.top;
        var R = udContainerRect.left + t.right;
        var B = udContainerRect.top + t.bottom;
        return { left: L, top: T, right: R, bottom: B, width: (R - L), height: (B - T) };
      }
    }
    return getUiRect(spanEl);
  }

  function hideUdLines() {
    // Remove active SVG elements without DOM-wide queries
    if (udActivePaths && udActivePaths.length) {
      for (var i = 0; i < udActivePaths.length; i++) {
        var p = udActivePaths[i];
        if (p && p.parentNode) p.remove();
      }
      udActivePaths.length = 0;
    }

    // Clear any tracked highlighted elements
    if (udActiveHighlights && udActiveHighlights.length) {
      for (var j = 0; j < udActiveHighlights.length; j++) {
        var el = udActiveHighlights[j];
        if (!el || !el.classList) continue;
        el.classList.remove('ud-highlight', 'ud-highlight-parent', 'ud-highlight-child', 'ud-root-highlight');
      }
      udActiveHighlights.length = 0;
    }

    clearPosTagHighlights();
  }

  function clearPosTagHighlights() {
    chunkPosTags.forEach(function(tag) {
      // Reset to default styling
      tag.style.backgroundColor = '';
      tag.style.color = '';
      tag.style.fontWeight = '';
      tag.style.boxShadow = '';
      tag.style.transform = '';
    });
  }

  function ensureNerHoverOverlay() {
    if (!renderedText) return;
    if (nerHoverOverlay && nerHoverOverlay.parentNode !== renderedText) {
      renderedText.appendChild(nerHoverOverlay);
    }
    if (nerHoverOverlay) return;
    nerHoverOverlay = document.createElement('div');
    nerHoverOverlay.id = 'ner-hover-overlay';
    renderedText.appendChild(nerHoverOverlay);
  }

  function hideNerHover() {
    if (!nerHoverOverlay) return;
    nerHoverOverlay.innerHTML = '';
  }
  function showHoverReticle(target) {
    if (!target || !renderedText) return;
    if (target === lastHoverReticleTarget) return;
    var segIdx = parseInt((target.dataset && target.dataset.index) ? target.dataset.index : (target.closest && target.closest('.reader-token') ? target.closest('.reader-token').dataset.index : '-1'), 10);
    if (lastHoverReticleTarget && lastHoverReticleTarget !== target) {
      lastHoverReticleTarget.classList.remove('hover-reticle-token');
    }
    target.classList.add('hover-reticle-token');
    lastHoverReticleSegIdx = segIdx;
    lastHoverReticleTarget = target;
  }
  function hideHoverReticle() {
    if (lastHoverReticleTarget) {
      lastHoverReticleTarget.classList.remove('hover-reticle-token');
    }
    lastHoverReticleSegIdx = -1;
    lastHoverReticleTarget = null;
  }

  function nerLabelToClass(label) {
    var lab = (label || '').toUpperCase();
    if (lab === 'PERSON' || lab === 'PER') return 'ner-label-person';
    if (lab === 'PLACE' || lab === 'LOC' || lab === 'GPE') return 'ner-label-place';
    if (lab === 'ORG' || lab === 'ORGANIZATION') return 'ner-label-org';
    if (lab === 'DATE') return 'ner-label-date';
    return 'ner-label-misc';
  }
  function formatNerLabel(label) {
    var lab = (label || '').toUpperCase().trim();
    if (!lab) return 'ENT';
    if (lab === 'PERSON' || lab === 'PER' || lab === 'PNAME') return 'PERSON';
    if (lab === 'PLACE' || lab === 'LOC' || lab === 'GPE') return 'PLACE';
    if (lab === 'ORG' || lab === 'ORGANIZATION') return 'ORG';
    if (lab === 'DATE') return 'DATE';
    return lab;
  }
  function getNerLabelForSeg(segIdx) {
    if (!latestNerSpans || !latestNerSpans.length) return '';
    for (var i = 0; i < latestNerSpans.length; i++) {
      var ent = latestNerSpans[i];
      if (!ent || typeof ent.start !== 'number' || typeof ent.end !== 'number') continue;
      if (segIdx >= ent.start && segIdx < ent.end) return ent.label || '';
    }
    return '';
  }
  function nerLabelToUpos(label) {
    var lab = (label || '').toUpperCase();
    if (!lab) return '';
    if (lab === 'PNAME' || lab === 'PERSON' || lab === 'PER' || lab === 'NE') return 'PROPN';
    if (lab === 'LOC' || lab === 'PLACE' || lab === 'GPE') return 'PROPN';
    if (lab === 'ORG' || lab === 'ORGANIZATION') return 'PROPN';
    if (lab === 'RACE') return 'PROPN';
    if (lab === 'TIME' || lab === 'DATE') return 'NOUN';
    if (lab === 'NUM') return 'NUM';
    return '';
  }

  function renderNerHoverForToken(segIdx) {
    ensureNerHoverOverlay();
    nerHoverOverlay.innerHTML = '';
    if (!displaySettings.nerOverlay) return;
    if (!latestNerSpans || !latestNerSpans.length) return;
    var hits = latestNerSpans.filter(function(ent) {
      return ent && typeof ent.start === 'number' && typeof ent.end === 'number' &&
             segIdx >= ent.start && segIdx < ent.end;
    });
    if (!hits.length) return;
    ensureUdRectCache();
    var containerRect = udContainerRect;
    if (!containerRect) return;

    function rectFromDomRect(r) {
      return {
        left: r.left - containerRect.left,
        top: r.top - containerRect.top,
        width: r.width,
        height: r.height,
        right: (r.left - containerRect.left) + r.width,
        bottom: (r.top - containerRect.top) + r.height
      };
    }

    function getRectsForSeg(seg) {
      var rects = [];
      var spans = getTokenSpanList(seg);
      if (spans && spans.length) {
        for (var i = 0; i < spans.length; i++) {
          var el = spans[i];
          if (!el || typeof el.getBoundingClientRect !== 'function') continue;
          var r = el.getBoundingClientRect();
          if (!r || r.width <= 0 || r.height <= 0) continue;
          rects.push(rectFromDomRect(r));
        }
      }
      if (!rects.length) {
        var cached = udTokenRectCache.get(seg);
        if (cached) rects.push(cached);
      }
      return rects;
    }

    // Pre-compute all UD line obstacles once (avoid repeated querySelectorAll and path sampling)
    var allLineObstaclesByEdge = new Map(); // key: "fromIdx-toIdx", value: array of obstacle rects
    if (displaySettings.udOverlay && udActivePaths && udActivePaths.length) {
      try {
        var els = udActivePaths;
        for (var ei = 0; ei < els.length; ei++) {
          var el = els[ei];
          if (!el || !el.classList || !el.classList.contains('ud-dep-line')) continue;
          var fromIdx = parseInt(el.getAttribute('data-from-idx'), 10);
          var toIdx = parseInt(el.getAttribute('data-to-idx'), 10);
          if (!isFinite(fromIdx) || !isFinite(toIdx)) continue;
          var edgeKey = fromIdx + '-' + toIdx;
          var edgeObstacles = [];
          if (typeof el.getTotalLength === 'function' && typeof el.getPointAtLength === 'function') {
            var total = el.getTotalLength();
            if (total && isFinite(total)) {
              var samples = Math.max(6, Math.min(24, Math.ceil(total / 40)));
              var step = total / samples;
              for (var s = 0; s <= samples; s++) {
                var pt = el.getPointAtLength(s * step);
                if (!pt) continue;
                var pad = 2;
                edgeObstacles.push({ left: pt.x - pad, top: pt.y - pad, right: pt.x + pad, bottom: pt.y + pad });
              }
            }
          } else {
            try {
              var b = el.getBBox();
              if (b && b.width > 0 && b.height > 0) {
                var pad = 2;
                edgeObstacles.push({
                  left: b.x - pad,
                  top: b.y - pad,
                  right: b.x + b.width + pad,
                  bottom: b.y + b.height + pad
                });
              }
            } catch (e2) {}
          }
          if (edgeObstacles.length) {
            allLineObstaclesByEdge.set(edgeKey, { fromIdx: fromIdx, toIdx: toIdx, obstacles: edgeObstacles });
          }
        }
      } catch (e) {}
    }

    // Collect obstacles for a specific entity span (uses pre-computed data)
    function collectLineObstaclesForEnt(ent) {
      var obstacles = [];
      if (!allLineObstaclesByEdge.size) return obstacles;
      if (!ent || typeof ent.start !== 'number' || typeof ent.end !== 'number') return obstacles;
      allLineObstaclesByEdge.forEach(function(data) {
        var touchesSpan = (data.fromIdx >= ent.start && data.fromIdx < ent.end) ||
                          (data.toIdx >= ent.start && data.toIdx < ent.end);
        if (touchesSpan) {
          for (var oi = 0; oi < data.obstacles.length; oi++) {
            obstacles.push(data.obstacles[oi]);
          }
        }
      });
      return obstacles;
    }
    var placed = [];
    hits.forEach(function(ent) {
      var lineObstacles = collectLineObstaclesForEnt(ent);
      var startRects = getRectsForSeg(ent.start);
      var endRects = getRectsForSeg(ent.end - 1);
      var startRect = startRects && startRects.length ? startRects[0] : null;
      var endRect = endRects && endRects.length ? endRects[0] : null;
      if (!startRect || !endRect) return;
      var startLeft = startRect.left;
      var startTop = startRect.top;
      var left = startLeft;
      var right = endRect.left + endRect.width;
      var anchorCenter = (left + right) / 2;
      var center = anchorCenter;
      var anchorTop = Math.min(startRect.top, endRect.top);

      var segRects = [];
      for (var si3 = ent.start; si3 < ent.end; si3++) {
        var rectList = getRectsForSeg(si3);
        for (var ri = 0; ri < rectList.length; ri++) {
          var r = rectList[ri];
          if (!r) continue;
          segRects.push({
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom
          });
        }
      }
      segRects.sort(function(a, b) {
        if (a.top === b.top) return a.left - b.left;
        return a.top - b.top;
      });

      var lineRects = [];
      var lineTol = 4;
      for (var ri = 0; ri < segRects.length; ri++) {
        var rr = segRects[ri];
        var lastLine = lineRects.length ? lineRects[lineRects.length - 1] : null;
        if (lastLine && Math.abs(rr.top - lastLine.top) <= lineTol) {
          lastLine.left = Math.min(lastLine.left, rr.left);
          lastLine.right = Math.max(lastLine.right, rr.right);
          lastLine.top = Math.min(lastLine.top, rr.top);
          lastLine.bottom = Math.max(lastLine.bottom, rr.bottom);
        } else {
          lineRects.push({
            left: rr.left,
            right: rr.right,
            top: rr.top,
            bottom: rr.bottom
          });
        }
      }

      if (lineRects.length > 1) {
        anchorCenter = startLeft + (startRect.width / 2);
        center = anchorCenter;
        anchorTop = startTop;
      }
      var chip = document.createElement('div');
      var labelText = formatNerLabel(ent.label);
      chip.className = 'ner-label ' + nerLabelToClass(ent.label);
      chip.style.left = center + 'px';
      chip.style.top = '0px';
      chip.textContent = labelText;
      chip.setAttribute('data-ner-label', labelText);
      chip.title = ent.text || '';
      nerHoverOverlay.appendChild(chip);
      invalidateUiRectFor(chip);
      var chipRect = getUiRect(chip);
      var chipW = chipRect.width;
      var chipH = chipRect.height;
      var chipColor = window.getComputedStyle(chip).backgroundColor;
      var halfW = chipW / 2;
      var padX = 6;
      var containerW = containerRect.width || 0;
      if (containerW > 0 && padX * 2 + chipW <= containerW) {
        var minCenter = padX + halfW;
        var maxCenter = containerW - padX - halfW;
        if (center < minCenter) center = minCenter;
        if (center > maxCenter) center = maxCenter;
      }
      chip.style.left = center + 'px';
      var leftPx = center - halfW;
      var rightPx = center + halfW;
      var tailSize = 7;
      var gap = 1;
      var top = anchorTop - chipH - tailSize;
      function overlapsHoriz(ob) {
        return !(rightPx < ob.left || leftPx > ob.right);
      }
      lineObstacles.forEach(function(ob) {
        if (!overlapsHoriz(ob)) return;
        var candidate = ob.top - chipH - tailSize - gap;
        if (candidate < top) top = candidate;
      });
      placed.forEach(function(ob) {
        if (!overlapsHoriz(ob)) return;
        var candidate = ob.top - chipH - gap;
        if (candidate < top) top = candidate;
      });
      var minTop = 2;
      if (dropZone && typeof dropZone.getBoundingClientRect === 'function') {
        var inputRect = getUiRect(dropZone);
        if (inputRect && isFinite(inputRect.bottom)) {
          var safePad = 4;
          var allowedTop = inputRect.bottom + safePad - containerRect.top;
          if (allowedTop < minTop) minTop = allowedTop;
        }
      }
      if (top < minTop) top = minTop;
      chip.style.top = top + 'px';
      var tailH = Math.max(tailSize, anchorTop - (top + chipH));
      chip.style.setProperty('--ner-tail-h', tailH + 'px');
      var tailX = anchorCenter - leftPx;
      var tailPad = 4;
      if (tailX < tailPad) tailX = tailPad;
      if (tailX > chipW - tailPad) tailX = chipW - tailPad;
      chip.style.setProperty('--ner-tail-x', tailX + 'px');

      // Add caliper bracket for any NER span
      if (ent.end > ent.start) {
        if (lineRects.length <= 1) {
          var caliper = document.createElement('div');
          caliper.className = 'ner-caliper';
          caliper.style.left = (left - 1) + 'px';
          caliper.style.width = (right - left + 2) + 'px';
          caliper.style.top = (anchorTop - 4) + 'px';
          caliper.style.height = '3px';
          if (chipColor) {
            caliper.style.borderColor = chipColor;
          }
          nerHoverOverlay.appendChild(caliper);
        } else {
          for (var li = 0; li < lineRects.length; li++) {
            var lineRect = lineRects[li];
            var caliperLine = document.createElement('div');
            caliperLine.className = 'ner-caliper';
            caliperLine.style.left = (lineRect.left - 1) + 'px';
            caliperLine.style.width = (lineRect.right - lineRect.left + 2) + 'px';
            caliperLine.style.top = (lineRect.top - 4) + 'px';
            caliperLine.style.height = '3px';
            if (chipColor) {
              caliperLine.style.borderColor = chipColor;
            }
            nerHoverOverlay.appendChild(caliperLine);
          }
        }
      }

      placed.push({ left: leftPx, right: rightPx, top: top, bottom: top + chipH });
    });
  }

  function drawUdLinesForClause(segIdx) {
    hideUdLines();
    if (!latestChunks || !latestChunks.clauseGroup) return;

    var svg = ensureUdSvgOverlay();
    ensureUdRectCache();
    var edges = latestUdOverlay.edges || [];

    // Get the clause group for the current token (clauseGroup is a Map)
    var clauseGroupId = latestChunks.clauseGroup.get(segIdx);
    if (clauseGroupId === undefined || clauseGroupId === 0) return;

    // Build set of all tokens in this clause
    var clauseMembers = new Set();
    latestChunks.clauseGroup.forEach(function(grp, seg) {
      if (grp === clauseGroupId) {
        clauseMembers.add(seg);
      }
    });

    // Determine which tokens are "highlighted" (connected edges shown vivid)
    var highlightedTokens = getUdLineHighlightSet(segIdx);

    var edgesToDraw = [];
    var drawnPairs = new Set();

    edges.forEach(function(edge) {
      var fromInClause = clauseMembers.has(edge.from);
      var toInClause = clauseMembers.has(edge.to);

      // Only draw edges that touch the clause
      if (!fromInClause && !toInClause) return;

      var pairKey = edge.from + '-' + edge.to;
      if (drawnPairs.has(pairKey)) return;

      // Determine color based on edge direction and relationship to hovered token
      // edge.from is parent, edge.to is child
      var isChildLine;

      if (edge.from === segIdx) {
        // Hovered token is the parent -> orange (child line)
        isChildLine = true;
      } else if (edge.to === segIdx) {
        // Hovered token is the child -> blue (parent line)
        isChildLine = false;
      } else if (fromInClause && toInClause) {
        // Internal edge not directly involving hovered token
        // Default to parent->child direction: orange
        isChildLine = true;
      } else if (fromInClause) {
        // Edge from clause (parent) to external (child) -> orange
        isChildLine = true;
      } else {
        // Edge from external (parent) to clause (child) -> blue
        isChildLine = false;
      }

      edgesToDraw.push({
        fromIdx: edge.from,
        toIdx: edge.to,
        isChildLine: isChildLine
      });
      drawnPairs.add(pairKey);
    });

    // Draw all edges
    edgesToDraw.forEach(function(item) {
      var fromSpan = udTokenIndex.get(item.fromIdx);
      var toSpan = udTokenIndex.get(item.toIdx);
      if (!fromSpan || !toSpan) return;

      var fromRect = udTokenRectCache.get(Number(item.fromIdx));
      var toRect = udTokenRectCache.get(Number(item.toIdx));
      if (!fromRect || !toRect) return;

      var x1 = fromRect.cx;
      var y1 = fromRect.top;
      var x2 = toRect.cx;
      var y2 = toRect.top;

      var midX = (x1 + x2) / 2;
      var dist = Math.abs(x2 - x1);
      var arcHeight = Math.min(40, Math.max(20, dist * 0.3));
      var controlY = Math.min(y1, y2) - arcHeight;

      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'ud-dep-line');
      path.setAttribute('d', 'M ' + x2 + ' ' + y2 + ' Q ' + midX + ' ' + controlY + ' ' + x1 + ' ' + y1);
      path.setAttribute('data-from-idx', item.fromIdx);
      path.setAttribute('data-to-idx', item.toIdx);

      // Check if this edge is connected to highlighted tokens
      var isConnected = highlightedTokens.has(item.fromIdx) || highlightedTokens.has(item.toIdx);

      // Color scheme: orange for parent->child (isChildLine), blue for child->parent
      var strokeColor, strokeWidth, strokeOpacity, arrowheadId;

      if (isConnected) {
        // Vivid: this edge is connected to highlighted tokens - use orange/blue
        strokeColor = item.isChildLine ? '#e67e22' : '#6366f1';
        strokeWidth = 1.75;
        strokeOpacity = 0.85;
        arrowheadId = item.isChildLine ? 'ud-arrowhead-child' : 'ud-arrowhead';
      } else {
        // Faded: this edge is not connected - use grey
        strokeColor = '#6b7280';
        strokeWidth = 1.4;
        strokeOpacity = 0.25;
        arrowheadId = item.isChildLine ? 'ud-arrowhead-child-faded' : 'ud-arrowhead-faded';
      }

      // Use inline style to ensure it overrides CSS
      path.setAttribute('style',
        'stroke: ' + strokeColor + '; ' +
        'stroke-width: ' + strokeWidth + '; ' +
        'opacity: ' + strokeOpacity + '; ' +
        'fill: none;'
      );
      path.setAttribute('marker-end', 'url(#' + arrowheadId + ')');

      svg.appendChild(path);
      udActivePaths.push(path);
    });
  }

  function getIslandSpanForSeg(segIdx) {
    if (!latestData || !Array.isArray(latestData.island_spans)) return null;
    for (var i = 0; i < latestData.island_spans.length; i++) {
      var span = latestData.island_spans[i];
      if (segIdx >= span[0] && segIdx < span[1]) return span;
    }
    return null;
  }

  function areIslandsConnected(span1, span2) {
    // Check if any dependency edge connects tokens between two islands
    if (!latestUdOverlay || !latestUdOverlay.ok) return false;
    if (!span1 || !span2) return false;

    var edges = latestUdOverlay.edges || [];
    var members1 = new Set();
    var members2 = new Set();

    for (var i = span1[0]; i < span1[1]; i++) members1.add(i);
    for (var i = span2[0]; i < span2[1]; i++) members2.add(i);

    // Check if any edge connects the two islands (bidirectional)
    for (var i = 0; i < edges.length; i++) {
      var edge = edges[i];
      var fromIn1 = members1.has(edge.from);
      var fromIn2 = members2.has(edge.from);
      var toIn1 = members1.has(edge.to);
      var toIn2 = members2.has(edge.to);

      // Connection exists if edge goes from island1 to island2 or vice versa
      if ((fromIn1 && toIn2) || (fromIn2 && toIn1)) {
        return true;
      }
    }
    return false;
  }

  function collectConnectedGroupMembers(allSpans, startIdx, endIdx) {
    var members = new Set();
    var maxSeg = -1;
    for (var i = startIdx; i <= endIdx; i++) {
      var span = allSpans[i];
      for (var j = span[0]; j < span[1]; j++) {
        members.add(j);
        if (j > maxSeg) maxSeg = j;
      }
    }
    return { members: members, maxSeg: maxSeg };
  }

  function findLeadingOutEdge(members, maxSeg, sentEnd) {
    if (!latestUdOverlay || !latestUdOverlay.ok) return null;
    var tokens = latestUdOverlay.tokens || [];

    // Find the token in the group whose head is outside the group and to the right
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      var tokIdx = tok.i;
      var headIdx = tok.head;

      // Token must be in the group
      if (!members.has(tokIdx)) continue;

      // Head must be outside the group
      if (members.has(headIdx)) continue;

      // Head must be to the right (leading edge goes rightward/downward)
      if (headIdx <= maxSeg) continue;

      // Head must be within sentence bounds
      if (typeof sentEnd === 'number' && headIdx >= sentEnd) continue;

      // Found the group's attachment point
      return {
        from: headIdx,    // the external head
        to: tokIdx,       // the token in the group
        dep: tok.dep,
        upos: tok.upos
      };
    }
    return null;
  }

  function isVerbAclHead(segIdx) {
    var info = getUdInfoForSegment(segIdx);
    if (!info) return false;
    var upos = (info.upos || '').toUpperCase();
    var dep = (info.dep || '').toLowerCase();
    return upos === 'VERB' && dep === 'acl';
  }

  function isRootSeg(segIdx) {
    if (!latestUdOverlay || !latestUdOverlay.ok) return false;
    if (!Array.isArray(latestUdOverlay.roots)) return false;
    if (latestUdOverlay.roots.indexOf(segIdx) !== -1) return true;
    var info = getUdInfoForSegment(segIdx);
    if (!info) return false;
    if (info.head === info.i) return true;
    var dep = (info.dep || '').toLowerCase();
    return dep === 'root';
  }

  function getSentenceSpansFromSegments(segments) {
    var spans = [];
    if (!Array.isArray(segments) || !segments.length) return spans;
    var start = 0;
    for (var i = 0; i < segments.length; i++) {
      if (segments[i] === '\u104b') { // Myanmar period
        spans.push({ start: start, end: i + 1 });
        start = i + 1;
      }
    }
    if (start < segments.length) spans.push({ start: start, end: segments.length });
    return spans;
  }

  function buildConnectedIslandGroupsForSentence(allSpans, spanIndices) {
    var groups = [];
    if (!spanIndices.length) return groups;
    var startIdx = spanIndices[0];
    var prevIdx = spanIndices[0];
    for (var i = 1; i < spanIndices.length; i++) {
      var idx = spanIndices[i];
      if (!areIslandsConnected(allSpans[prevIdx], allSpans[idx])) {
        groups.push({ startIdx: startIdx, endIdx: prevIdx });
        startIdx = idx;
      }
      prevIdx = idx;
    }
    groups.push({ startIdx: startIdx, endIdx: prevIdx });
    return groups;
  }

  function absorbStrayParticles(allSpans, groups, sentEnd) {
    // Absorb groups that are adjacent in island sequence, connect backward, and have no forward edge
    if (groups.length < 2) return groups;
    var tokens = (latestUdOverlay && latestUdOverlay.tokens) || [];
    var result = [groups[0]];
    for (var gi = 1; gi < groups.length; gi++) {
      var prevGroup = result[result.length - 1];
      var currGroup = groups[gi];
      // Check adjacency: current group's first island immediately follows prev group's last island
      if (currGroup.startIdx !== prevGroup.endIdx + 1) {
        result.push(currGroup);
        continue;
      }
      // Check if current group has no forward edges
      var currInfo = collectConnectedGroupMembers(allSpans, currGroup.startIdx, currGroup.endIdx);
      var forwardEdge = findLeadingOutEdge(currInfo.members, currInfo.maxSeg, sentEnd);
      if (forwardEdge) {
        result.push(currGroup);
        continue;
      }
      // Check if current group has backward connection to prev group
      var prevInfo = collectConnectedGroupMembers(allSpans, prevGroup.startIdx, prevGroup.endIdx);
      var hasBackwardEdge = false;
      for (var ti = 0; ti < tokens.length; ti++) {
        var tok = tokens[ti];
        if (!currInfo.members.has(tok.i)) continue;
        if (prevInfo.members.has(tok.head)) {
          hasBackwardEdge = true;
          break;
        }
      }
      if (!hasBackwardEdge) {
        result.push(currGroup);
        continue;
      }
      // Absorb: extend prev group to include curr group
      result[result.length - 1] = { startIdx: prevGroup.startIdx, endIdx: currGroup.endIdx };
    }
    return result;
  }

  function applyAclGatePostpass(allSpans, groups, sentEnd) {
    if (!displaySettings.connectedIslandsAclGate) return groups;
    var merged = [];
    var gi = 0;
    while (gi < groups.length) {
      var mergedStart = groups[gi].startIdx;
      var mergedEnd = groups[gi].endIdx;
      var current = gi;

      while (true) {
        // Check the CURRENT (most recently added) group's leading edge
        var currInfo = collectConnectedGroupMembers(allSpans, groups[current].startIdx, groups[current].endIdx);
        var currLeadingEdge = findLeadingOutEdge(currInfo.members, currInfo.maxSeg, sentEnd);

        if (!currLeadingEdge) {
          // No forward edge - stop merging
          break;
        }

        var headSeg = currLeadingEdge.to;
        if (isRootSeg(headSeg) || isVerbAclHead(headSeg)) {
          // Current group is a clause boundary - stop merging
          break;
        }

        // Current group is NOT a clause boundary, merge with next group
        if (current + 1 >= groups.length) break;

        current += 1;
        mergedEnd = groups[current].endIdx;
        // Loop continues - will check the newly merged group's edge
      }

      merged.push({ startIdx: mergedStart, endIdx: mergedEnd });
      gi = current + 1;
    }
    return merged;
  }

  var latestConnectedIslandGroups = null;
  var latestConnectedIslandGroupBySeg = null;

  function rebuildConnectedIslandGroups() {
    latestConnectedIslandGroups = [];
    latestConnectedIslandGroupBySeg = new Map();
    if (!latestData || !Array.isArray(latestData.island_spans)) return;
    var allSpans = latestData.island_spans;
    if (!allSpans.length) return;
    var segments = Array.isArray(latestData.segments) ? latestData.segments : [];
    var sentenceSpans = getSentenceSpansFromSegments(segments);
    if (!sentenceSpans.length) {
      sentenceSpans = [{ start: 0, end: segments.length }];
    }
    var spanIdx = 0;
    sentenceSpans.forEach(function(sent) {
      var spanIndices = [];
      while (spanIdx < allSpans.length && allSpans[spanIdx][0] < sent.end) {
        if (allSpans[spanIdx][0] >= sent.start) {
          spanIndices.push(spanIdx);
        }
        spanIdx++;
      }
      if (!spanIndices.length) return;
      var groups = buildConnectedIslandGroupsForSentence(allSpans, spanIndices);
      groups = absorbStrayParticles(allSpans, groups, sent.end);
      groups = applyAclGatePostpass(allSpans, groups, sent.end);
      groups.forEach(function(g) {
        var groupSpans = [];
        for (var i = g.startIdx; i <= g.endIdx; i++) {
          groupSpans.push(allSpans[i]);
        }
        var groupObj = { spans: groupSpans, startIdx: g.startIdx, endIdx: g.endIdx };
        latestConnectedIslandGroups.push(groupObj);
        var info = collectConnectedGroupMembers(allSpans, g.startIdx, g.endIdx);
        info.members.forEach(function(seg) {
          latestConnectedIslandGroupBySeg.set(seg, groupObj);
        });
      });
    });
  }

  function getConnectedIslandGroup(segIdx) {
    // Returns a list of island spans that form a connected group
    if (!latestData || !Array.isArray(latestData.island_spans)) return null;
    if (!latestConnectedIslandGroupBySeg) rebuildConnectedIslandGroups();
    var group = latestConnectedIslandGroupBySeg ? latestConnectedIslandGroupBySeg.get(segIdx) : null;
    if (group && group.spans) return group.spans;
    var fallback = getIslandSpanForSeg(segIdx);
    return fallback ? [fallback] : null;
  }

  function drawUdLinesForIsland(segIdx) {
    hideUdLines();
    if (!latestUdOverlay || !latestUdOverlay.ok) return;

    var span = getIslandSpanForSeg(segIdx);
    if (!span) return;

    var svg = ensureUdSvgOverlay();
    ensureUdRectCache();
    var edges = latestUdOverlay.edges || [];

    var islandMembers = new Set();
    for (var i = span[0]; i < span[1]; i++) {
      islandMembers.add(i);
    }

    var highlightedTokens = getUdLineHighlightSet(segIdx);
    var edgesToDraw = [];
    var drawnPairs = new Set();

    edges.forEach(function(edge) {
      var fromInIsland = islandMembers.has(edge.from);
      var toInIsland = islandMembers.has(edge.to);
      if (!fromInIsland && !toInIsland) return;

      var pairKey = edge.from + '-' + edge.to;
      if (drawnPairs.has(pairKey)) return;

      var isChildLine;
      if (edge.from === segIdx) {
        isChildLine = true;
      } else if (edge.to === segIdx) {
        isChildLine = false;
      } else if (fromInIsland && toInIsland) {
        isChildLine = true;
      } else if (fromInIsland) {
        isChildLine = true;
      } else {
        isChildLine = false;
      }

      edgesToDraw.push({
        fromIdx: edge.from,
        toIdx: edge.to,
        isChildLine: isChildLine
      });
      drawnPairs.add(pairKey);
    });

    edgesToDraw.forEach(function(item) {
      var fromSpan = udTokenIndex.get(item.fromIdx);
      var toSpan = udTokenIndex.get(item.toIdx);
      if (!fromSpan || !toSpan) return;

      var fromRect = udTokenRectCache.get(Number(item.fromIdx));
      var toRect = udTokenRectCache.get(Number(item.toIdx));
      if (!fromRect || !toRect) return;

      var x1 = fromRect.cx;
      var y1 = fromRect.top;
      var x2 = toRect.cx;
      var y2 = toRect.top;

      var midX = (x1 + x2) / 2;
      var dist = Math.abs(x2 - x1);
      var arcHeight = Math.min(40, Math.max(20, dist * 0.3));
      var controlY = Math.min(y1, y2) - arcHeight;

      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'ud-dep-line');
      path.setAttribute('d', 'M ' + x2 + ' ' + y2 + ' Q ' + midX + ' ' + controlY + ' ' + x1 + ' ' + y1);
      path.setAttribute('data-from-idx', item.fromIdx);
      path.setAttribute('data-to-idx', item.toIdx);

      var isConnected = highlightedTokens.has(item.fromIdx) || highlightedTokens.has(item.toIdx);

      var strokeColor, strokeWidth, strokeOpacity, arrowheadId;
      if (isConnected) {
        strokeColor = item.isChildLine ? '#e67e22' : '#6366f1';
        strokeWidth = 1.75;
        strokeOpacity = 0.85;
        arrowheadId = item.isChildLine ? 'ud-arrowhead-child' : 'ud-arrowhead';
      } else {
        strokeColor = '#6b7280';
        strokeWidth = 1.4;
        strokeOpacity = 0.25;
        arrowheadId = item.isChildLine ? 'ud-arrowhead-child-faded' : 'ud-arrowhead-faded';
      }

      path.setAttribute('style',
        'stroke: ' + strokeColor + '; ' +
        'stroke-width: ' + strokeWidth + '; ' +
        'opacity: ' + strokeOpacity + '; ' +
        'fill: none;'
      );
      path.setAttribute('marker-end', 'url(#' + arrowheadId + ')');

      svg.appendChild(path);
      udActivePaths.push(path);
    });
  }

  function drawUdLinesForConnectedIslands(segIdx) {
    hideUdLines();
    if (!latestUdOverlay || !latestUdOverlay.ok) return;

    var connectedSpans = getConnectedIslandGroup(segIdx);
    if (!connectedSpans || connectedSpans.length === 0) return;

    var svg = ensureUdSvgOverlay();
    ensureUdRectCache();
    var edges = latestUdOverlay.edges || [];

    // Build set of all tokens in connected island group
    var groupMembers = new Set();
    connectedSpans.forEach(function(span) {
      for (var i = span[0]; i < span[1]; i++) {
        groupMembers.add(i);
      }
    });

    var highlightedTokens = getUdLineHighlightSet(segIdx);
    var edgesToDraw = [];
    var drawnPairs = new Set();

    edges.forEach(function(edge) {
      var fromInGroup = groupMembers.has(edge.from);
      var toInGroup = groupMembers.has(edge.to);
      if (!fromInGroup && !toInGroup) return;

      var pairKey = edge.from + '-' + edge.to;
      if (drawnPairs.has(pairKey)) return;

      var isChildLine;
      if (edge.from === segIdx) {
        isChildLine = true;
      } else if (edge.to === segIdx) {
        isChildLine = false;
      } else if (fromInGroup && toInGroup) {
        isChildLine = true;
      } else if (fromInGroup) {
        isChildLine = true;
      } else {
        isChildLine = false;
      }

      edgesToDraw.push({
        fromIdx: edge.from,
        toIdx: edge.to,
        isChildLine: isChildLine
      });
      drawnPairs.add(pairKey);
    });

    edgesToDraw.forEach(function(item) {
      var fromSpan = udTokenIndex.get(item.fromIdx);
      var toSpan = udTokenIndex.get(item.toIdx);
      if (!fromSpan || !toSpan) return;

      var fromRect = udTokenRectCache.get(Number(item.fromIdx));
      var toRect = udTokenRectCache.get(Number(item.toIdx));
      if (!fromRect || !toRect) return;

      var x1 = fromRect.cx;
      var y1 = fromRect.top;
      var x2 = toRect.cx;
      var y2 = toRect.top;

      var midX = (x1 + x2) / 2;
      var dist = Math.abs(x2 - x1);
      var arcHeight = Math.min(40, Math.max(20, dist * 0.3));
      var controlY = Math.min(y1, y2) - arcHeight;

      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'ud-dep-line');
      path.setAttribute('d', 'M ' + x2 + ' ' + y2 + ' Q ' + midX + ' ' + controlY + ' ' + x1 + ' ' + y1);
      path.setAttribute('data-from-idx', item.fromIdx);
      path.setAttribute('data-to-idx', item.toIdx);

      var isConnected = highlightedTokens.has(item.fromIdx) || highlightedTokens.has(item.toIdx);

      var strokeColor, strokeWidth, strokeOpacity, arrowheadId;
      if (isConnected) {
        strokeColor = item.isChildLine ? '#e67e22' : '#6366f1';
        strokeWidth = 1.75;
        strokeOpacity = 0.85;
        arrowheadId = item.isChildLine ? 'ud-arrowhead-child' : 'ud-arrowhead';
      } else {
        strokeColor = '#6b7280';
        strokeWidth = 1.4;
        strokeOpacity = 0.25;
        arrowheadId = item.isChildLine ? 'ud-arrowhead-child-faded' : 'ud-arrowhead-faded';
      }

      path.setAttribute('style',
        'stroke: ' + strokeColor + '; ' +
        'stroke-width: ' + strokeWidth + '; ' +
        'opacity: ' + strokeOpacity + '; ' +
        'fill: none;'
      );
      path.setAttribute('marker-end', 'url(#' + arrowheadId + ')');

      svg.appendChild(path);
      udActivePaths.push(path);
    });
  }

  // Helper: get the canonical segment index (first segment if part of collapsed NER span)
  function getCanonicalSegIdx(segIdx) {
    var info = latestCollapsedSpanInfo[segIdx];
    return info ? info.firstSeg : segIdx;
  }

  // Helper: expand a set of segment indices to include all segments in any collapsed spans
  function expandHighlightSetForCollapsedSpans(segSet) {
    var expanded = new Set(segSet);
    segSet.forEach(function(segIdx) {
      var info = latestCollapsedSpanInfo[segIdx];
      if (info && info.udTok && info.udTok.seg_span) {
        info.udTok.seg_span.forEach(function(si) { expanded.add(si); });
      }
    });
    return expanded;
  }

  function getUdLineHighlightSet(segIdx) {
    // Use canonical segment index for lookup (first segment if part of collapsed span)
    var canonicalIdx = getCanonicalSegIdx(segIdx);
    var base = (currentChunkHighlightTokens && currentChunkHighlightTokens.has(canonicalIdx))
      ? new Set(currentChunkHighlightTokens)
      : new Set([canonicalIdx]);
    // Expand to include all segments in collapsed spans
    return expandHighlightSetForCollapsedSpans(base);
  }

  // Context Window algorithm - computes tokens to highlight based on tree-contiguous spans
  // Highlight the dependency context around the selected token.
  function computeContextWindowTokens(segIdx) {
    // Use canonical segment index (first segment if part of collapsed NER span)
    var canonicalIdx = getCanonicalSegIdx(segIdx);
    if (!latestUdOverlay || !latestUdOverlay.ok) return expandHighlightSetForCollapsedSpans(new Set([canonicalIdx]));
    var count = parseInt(displaySettings.contextWindowSize, 10);
    if (!isFinite(count) || count < 1) count = 1;

    var tokens = latestUdOverlay.tokens || [];
    var edges = latestUdOverlay.edges || [];
    function normalizeSentences(raw) {
      var out = [];
      if (!Array.isArray(raw)) return out;
      for (var i = 0; i < raw.length; i++) {
        var s = raw[i];
        if (Array.isArray(s) && s.length >= 2 && isFinite(s[0]) && isFinite(s[1])) {
          out.push([s[0], s[1]]);
          continue;
        }
        if (s && typeof s === "object") {
          var start = (typeof s.seg_start === "number") ? s.seg_start : (typeof s.start === "number" ? s.start : null);
          var end = (typeof s.seg_end === "number") ? s.seg_end : (typeof s.end === "number" ? s.end : null);
          if (start !== null && end !== null) {
            out.push([start, end]);
          }
        }
      }
      return out;
    }

    var sentences = normalizeSentences(latestUdOverlay.sentences || []);
    if (!sentences.length) {
      if (Array.isArray(latestSegments) && latestSegments.length) {
        var fallbackSpans = getSentenceSpansFromSegments(latestSegments);
        for (var fs = 0; fs < fallbackSpans.length; fs++) {
          sentences.push([fallbackSpans[fs].start, fallbackSpans[fs].end]);
        }
      } else if (tokens.length) {
        var maxSeg = -1;
        for (var tm = 0; tm < tokens.length; tm++) {
          var ti = tokens[tm] && typeof tokens[tm].i === "number" ? tokens[tm].i : -1;
          if (ti > maxSeg) maxSeg = ti;
        }
        if (maxSeg >= 0) sentences.push([0, maxSeg + 1]);
      }
    }

    // Find which sentence this token belongs to
    var sentenceIdx = null;
    for (var si = 0; si < sentences.length; si++) {
      var sentSpan = sentences[si];
      if (canonicalIdx >= sentSpan[0] && canonicalIdx < sentSpan[1]) {
        sentenceIdx = si;
        break;
      }
    }
    if (sentenceIdx === null) return expandHighlightSetForCollapsedSpans(new Set([canonicalIdx]));

    // 1. Get all tokens in sentence, sorted by position
    var sentSpan = sentences[sentenceIdx];
    var nodesInSentence = [];
    for (var ti2 = 0; ti2 < tokens.length; ti2++) {
      var tok = tokens[ti2];
      if (!tok || typeof tok.i !== "number") continue;
      if (tok.i >= sentSpan[0] && tok.i < sentSpan[1]) {
        nodesInSentence.push(tok.i);
      }
    }
    if (!nodesInSentence.length) return expandHighlightSetForCollapsedSpans(new Set([canonicalIdx]));
    nodesInSentence.sort(function(a, b) { return a - b; });
    var centerPos = nodesInSentence.indexOf(canonicalIdx);
    if (centerPos === -1) return expandHighlightSetForCollapsedSpans(new Set([canonicalIdx]));

    // Position lookup
    var posBySeg = {};
    for (var pi = 0; pi < nodesInSentence.length; pi++) {
      posBySeg[nodesInSentence[pi]] = pi;
    }

    // 2. Build tree adjacency map (bidirectional)
    var treeAdj = new Map();
    for (var ei = 0; ei < edges.length; ei++) {
      var edge = edges[ei];
      var head = edge.from;
      var child = edge.to;
      // Only include edges within this sentence
      if (posBySeg[head] === undefined || posBySeg[child] === undefined) continue;
      if (!treeAdj.has(head)) treeAdj.set(head, new Set());
      if (!treeAdj.has(child)) treeAdj.set(child, new Set());
      treeAdj.get(head).add(child);
      treeAdj.get(child).add(head);
    }

    // 3. Collect candidates: expand purely positionally (centered on hover)
    var left = centerPos;
    var right = centerPos;
    // Collect up to 2x count to have room for finding best span
    var targetCandidates = Math.min(nodesInSentence.length, count * 2);
    while ((right - left + 1) < targetCandidates) {
      var expandedAny = false;
      if (left > 0) { left--; expandedAny = true; }
      if ((right - left + 1) < targetCandidates && right < nodesInSentence.length - 1) { right++; expandedAny = true; }
      if (!expandedAny) break;
    }
    var candidates = nodesInSentence.slice(left, right + 1);
    var hoverIdxInCandidates = candidates.indexOf(canonicalIdx);

    // 4. Helper: check if a span is tree-contiguous (all tokens connected via tree edges within the span)
    function isTreeContiguous(spanTokens) {
      if (spanTokens.length <= 1) return true;
      var spanSet = new Set(spanTokens);
      var visited = new Set();
      var queue = [spanTokens[0]];
      visited.add(spanTokens[0]);
      while (queue.length > 0) {
        var curr = queue.shift();
        var neighbors = treeAdj.get(curr);
        if (neighbors) {
          neighbors.forEach(function(n) {
            if (spanSet.has(n) && !visited.has(n)) {
              visited.add(n);
              queue.push(n);
            }
          });
        }
      }
      return visited.size === spanTokens.length;
    }

    // 5. Find largest tree-contiguous span containing hover token
    // Priorities: 1) larger size, 2) more centered on hover, 3) slight rightward bias
    var bestSpan = [canonicalIdx];
    var bestSize = 1;
    var bestImbalance = 0;
    var bestRight = hoverIdxInCandidates;

    for (var L = 0; L <= hoverIdxInCandidates; L++) {
      for (var R = hoverIdxInCandidates; R < candidates.length; R++) {
        var spanSize = R - L + 1;
        if (spanSize > count) break;
        if (spanSize < bestSize) continue;

        var leftExtent = hoverIdxInCandidates - L;
        var rightExtent = R - hoverIdxInCandidates;
        var imbalance = Math.abs(leftExtent - rightExtent);

        var dominated = false;
        if (spanSize === bestSize) {
          if (imbalance > bestImbalance) {
            dominated = true;
          } else if (imbalance === bestImbalance && R <= bestRight) {
            dominated = true;
          }
        }
        if (dominated) continue;

        var span = candidates.slice(L, R + 1);
        if (isTreeContiguous(span)) {
          bestSpan = span;
          bestSize = spanSize;
          bestImbalance = imbalance;
          bestRight = R;
        }
      }
    }

    var highlightedTokens = new Set(bestSpan);

    // 6. Expand for whitespace islands (if latestData has island_spans)
    if (latestData && Array.isArray(latestData.island_spans)) {
      var islands = latestData.island_spans;
      var islandBySeg = {};
      for (var ii = 0; ii < islands.length; ii++) {
        var island = islands[ii];
        for (var ij = island[0]; ij < island[1]; ij++) {
          islandBySeg[ij] = island;
        }
      }
      var toAdd = [];
      highlightedTokens.forEach(function(seg) {
        var island = islandBySeg[seg];
        if (island) {
          for (var ik = island[0]; ik < island[1]; ik++) {
            toAdd.push(ik);
          }
        }
      });
      for (var ti = 0; ti < toAdd.length; ti++) {
        highlightedTokens.add(toAdd[ti]);
      }
    }


    // 7. Roll in contiguous singleton leaf children
    var hasChild = {};
    for (var e = 0; e < edges.length; e++) {
      var edge2 = edges[e];
      if (posBySeg[edge2.from] !== undefined) {
        hasChild[edge2.from] = true;
      }
    }

    function isContiguousToHighlighted(seg) {
      var pos = posBySeg[seg];
      if (pos === undefined) return false;
      var leftN = pos > 0 ? nodesInSentence[pos - 1] : null;
      var rightN = pos < nodesInSentence.length - 1 ? nodesInSentence[pos + 1] : null;
      return (leftN !== null && highlightedTokens.has(leftN)) ||
             (rightN !== null && highlightedTokens.has(rightN));
    }

    var added = true;
    while (added) {
      added = false;
      for (var le = 0; le < edges.length; le++) {
        var leafEdge = edges[le];
        var head3 = leafEdge.from;
        var child3 = leafEdge.to;
        if (!highlightedTokens.has(head3) || highlightedTokens.has(child3)) continue;
        if (hasChild[child3]) continue;
        if (posBySeg[child3] === undefined) continue;
        if (isContiguousToHighlighted(child3)) {
          highlightedTokens.add(child3);
          added = true;
        }
      }
    }

    // 8. Final validation: ensure tree-contiguous (BFS from hover, keep only reachable)
    var connected = new Set();
    var stack = [canonicalIdx];
    while (stack.length) {
      var cur = stack.pop();
      if (connected.has(cur)) continue;
      connected.add(cur);
      var neighbors = treeAdj.get(cur);
      if (neighbors) {
        neighbors.forEach(function(n) {
          if (highlightedTokens.has(n) && !connected.has(n)) {
            stack.push(n);
          }
        });
      }
    }

    // 9. Ensure positionally contiguous (find largest contiguous run containing hover)
    var connectedArray = Array.from(connected).sort(function(a, b) { return a - b; });
    if (connectedArray.length > 1) {
      var connectedSet = new Set(connectedArray);
      var hoverAllPos = posBySeg[canonicalIdx];

      var runLeft = hoverAllPos;
      var runRight = hoverAllPos;
      while (runLeft > 0 && connectedSet.has(nodesInSentence[runLeft - 1])) runLeft--;
      while (runRight < nodesInSentence.length - 1 && connectedSet.has(nodesInSentence[runRight + 1])) runRight++;

      var finalHighlighted = new Set();
      for (var ri = runLeft; ri <= runRight; ri++) {
        var seg = nodesInSentence[ri];
        if (connectedSet.has(seg)) {
          finalHighlighted.add(seg);
        }
      }
      highlightedTokens = finalHighlighted;
    } else {
      highlightedTokens = connected;
    }

    // Expand result to include all segments in collapsed NER spans
    return expandHighlightSetForCollapsedSpans(highlightedTokens);
  }

  // Cache for context window tokens to ensure sync between highlighting and lines
  var cachedContextWindowTokens = null;
  var cachedContextWindowSegIdx = -1;

  function getContextWindowTokens(segIdx) {
    // Return cached result if we already computed for this segIdx
    var canonicalIdx = getCanonicalSegIdx(segIdx);
    if (cachedContextWindowSegIdx === canonicalIdx && cachedContextWindowTokens !== null) {
      return cachedContextWindowTokens;
    }
    cachedContextWindowTokens = computeContextWindowTokens(canonicalIdx);
    cachedContextWindowSegIdx = canonicalIdx;
    return cachedContextWindowTokens;
  }

  function clearContextWindowCache() {
    cachedContextWindowTokens = null;
    cachedContextWindowSegIdx = -1;
  }

  // Bottom-Up Chunk algorithm - computes tokens by working from lowest depth up to root
  // Tokens within threshold distance of their parent get merged into parent's chunk
  function computeBottomUpChunkTokens(segIdx) {
    var canonicalIdx = getCanonicalSegIdx(segIdx);
    if (!latestUdOverlay || !latestUdOverlay.ok) return expandHighlightSetForCollapsedSpans(new Set([canonicalIdx]));
    var threshold = parseInt(displaySettings.bottomUpChunkThreshold, 10);
    if (!isFinite(threshold) || threshold < 1) threshold = 5;
    if (threshold > 10) threshold = 10;

    var struct = latestUdStructure;
    if (!struct || !struct.tokenMap) return expandHighlightSetForCollapsedSpans(new Set([canonicalIdx]));
    var tokenMap = struct.tokenMap;
    var children = struct.children;
    var parentOf = struct.parentOf;
    var tokenPosition = struct.tokenPosition;
    var tokenDepths = struct.tokenDepths || {};
    var maxDepth = struct.maxDepth || 0;
    var tokenIds = struct.tokenIds || [];
    if (!tokenIds.length || tokenMap[canonicalIdx] === undefined) {
      return expandHighlightSetForCollapsedSpans(new Set([canonicalIdx]));
    }

    // Initialize: each token starts in its own chunk
    // chunkOf[seg] = chunk head segment index
    var chunkOf = {};
    for (var sIdx = 0; sIdx < tokenIds.length; sIdx++) {
      var s = tokenIds[sIdx];
      chunkOf[s] = s;
    }

    // Helper: get the current chunk head for a token (with path compression)
    function getChunkHead(seg) {
      if (chunkOf[seg] === seg) return seg;
      chunkOf[seg] = getChunkHead(chunkOf[seg]);
      return chunkOf[seg];
    }

    // Process from lowest depth up to root (depth 0)
    for (var d = maxDepth; d >= 1; d--) {
      // Collect all tokens at this depth
      for (var tIdx = 0; tIdx < tokenIds.length; tIdx++) {
        var tokenSeg = tokenIds[tIdx];
        if (tokenDepths[tokenSeg] !== d) continue;

        var parentSeg = parentOf[tokenSeg];
        if (parentSeg === undefined) continue;

        // Calculate left-to-right distance between token and parent
        var tokenPos = tokenPosition[tokenSeg];
        var parentPos = tokenPosition[parentSeg];
        var distance = Math.abs(tokenPos - parentPos);

        // If within threshold, merge token's chunk into parent's chunk
        if (distance <= threshold) {
          var tokenChunkHead = getChunkHead(tokenSeg);
          var parentChunkHead = getChunkHead(parentSeg);

          // Merge: point token's chunk head to parent's chunk head
          if (tokenChunkHead !== parentChunkHead) {
            chunkOf[tokenChunkHead] = parentChunkHead;
          }
        }
      }
    }

    // Find all tokens in the same chunk as segIdx
    var targetChunkHead = getChunkHead(canonicalIdx);
    var highlightedTokens = new Set();
    for (var hIdx = 0; hIdx < tokenIds.length; hIdx++) {
      var s4 = tokenIds[hIdx];
      if (getChunkHead(s4) === targetChunkHead) {
        highlightedTokens.add(s4);
      }
    }

    return expandHighlightSetForCollapsedSpans(highlightedTokens);
  }

  // Cache for bottom-up chunk tokens
  var cachedBottomUpChunkTokens = null;
  var cachedBottomUpChunkSegIdx = -1;

  function getBottomUpChunkTokens(segIdx) {
    var canonicalIdx = getCanonicalSegIdx(segIdx);
    if (cachedBottomUpChunkSegIdx === canonicalIdx && cachedBottomUpChunkTokens !== null) {
      return cachedBottomUpChunkTokens;
    }
    cachedBottomUpChunkTokens = computeBottomUpChunkTokens(canonicalIdx);
    cachedBottomUpChunkSegIdx = canonicalIdx;
    return cachedBottomUpChunkTokens;
  }

  function clearBottomUpChunkCache() {
    cachedBottomUpChunkTokens = null;
    cachedBottomUpChunkSegIdx = -1;
  }

  // Draw UD lines for bottom-up chunk - reuses the context window rendering logic
  function drawUdLinesForBottomUpChunk(segIdx) {
    hideUdLines();
    if (!latestUdOverlay || !latestUdOverlay.ok) return;

    var highlightedTokens = getBottomUpChunkTokens(segIdx);
    if (!highlightedTokens || highlightedTokens.size === 0) return;

    var svg = ensureUdSvgOverlay();
    ensureUdRectCache();
    var edges = latestUdOverlay.edges || [];

    var edgesToDraw = [];
    var drawnPairs = new Set();

    edges.forEach(function(edge) {
      var fromInChunk = highlightedTokens.has(edge.from);
      var toInChunk = highlightedTokens.has(edge.to);
      // Draw edges that are internal to chunk OR edges in/out of chunk (external connections)
      if (!fromInChunk && !toInChunk) return;

      var pairKey = edge.from + '-' + edge.to;
      if (drawnPairs.has(pairKey)) return;

      // Determine if this is a child line (arrow pointing to child)
      var isChildLine = (edge.to !== segIdx);

      edgesToDraw.push({
        fromIdx: edge.from,
        toIdx: edge.to,
        isChildLine: isChildLine,
        isInternal: fromInChunk && toInChunk
      });
      drawnPairs.add(pairKey);
    });

    edgesToDraw.forEach(function(item) {
      var fromSpan = udTokenIndex.get(item.fromIdx);
      var toSpan = udTokenIndex.get(item.toIdx);
      if (!fromSpan || !toSpan) return;

      var fromRect = udTokenRectCache.get(Number(item.fromIdx));
      var toRect = udTokenRectCache.get(Number(item.toIdx));
      if (!fromRect || !toRect) return;

      var x1 = fromRect.cx;
      var y1 = fromRect.top;
      var x2 = toRect.cx;
      var y2 = toRect.top;

      var midX = (x1 + x2) / 2;
      var dist = Math.abs(x2 - x1);
      var arcHeight = Math.min(40, Math.max(20, dist * 0.3));
      var controlY = Math.min(y1, y2) - arcHeight;

      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'ud-dep-line');
      path.setAttribute('d', 'M ' + x2 + ' ' + y2 + ' Q ' + midX + ' ' + controlY + ' ' + x1 + ' ' + y1);
      path.setAttribute('data-from-idx', item.fromIdx);
      path.setAttribute('data-to-idx', item.toIdx);

      // ONLY color edges directly connected to the hovered token
      // All other edges (internal or external) are grey
      var isHoveredEdge = (item.fromIdx === segIdx || item.toIdx === segIdx);

      var strokeColor, strokeWidth, strokeOpacity, arrowheadId;
      if (isHoveredEdge) {
        // Edges directly connected to hovered token - bright colors
        strokeColor = item.isChildLine ? '#e67e22' : '#6366f1';
        strokeWidth = 1.75;
        strokeOpacity = 0.85;
        arrowheadId = item.isChildLine ? 'ud-arrowhead-child' : 'ud-arrowhead';
      } else {
        // All other edges (internal to chunk or external) - grey/faded
        strokeColor = '#6b7280';
        strokeWidth = 1.4;
        strokeOpacity = 0.25;
        arrowheadId = item.isChildLine ? 'ud-arrowhead-child-faded' : 'ud-arrowhead-faded';
      }

      path.setAttribute('style',
        'stroke: ' + strokeColor + '; ' +
        'stroke-width: ' + strokeWidth + '; ' +
        'opacity: ' + strokeOpacity + '; ' +
        'fill: none;'
      );
      path.setAttribute('marker-end', 'url(#' + arrowheadId + ')');

      svg.appendChild(path);
      udActivePaths.push(path);
    });
  }

  function drawUdLinesForContextWindow(segIdx) {
    hideUdLines();
    if (!latestUdOverlay || !latestUdOverlay.ok) return;

    // Use cached tokens to stay in sync with applyChunkHighlight
    var highlightedTokens = getContextWindowTokens(segIdx);
    if (!highlightedTokens || highlightedTokens.size === 0) return;

    var svg = ensureUdSvgOverlay();
    ensureUdRectCache();
    var edges = latestUdOverlay.edges || [];

    var edgesToDraw = [];
    var drawnPairs = new Set();

    edges.forEach(function(edge) {
      var fromInChunk = highlightedTokens.has(edge.from);
      var toInChunk = highlightedTokens.has(edge.to);
      // Draw edges that are internal to chunk OR edges in/out of chunk (external connections)
      if (!fromInChunk && !toInChunk) return;

      var pairKey = edge.from + '-' + edge.to;
      if (drawnPairs.has(pairKey)) return;

      // Determine if this is a child line (arrow pointing to child)
      var isChildLine = (edge.to !== segIdx);

      edgesToDraw.push({
        fromIdx: edge.from,
        toIdx: edge.to,
        isChildLine: isChildLine,
        isInternal: fromInChunk && toInChunk
      });
      drawnPairs.add(pairKey);
    });

    edgesToDraw.forEach(function(item) {
      var fromSpan = udTokenIndex.get(item.fromIdx);
      var toSpan = udTokenIndex.get(item.toIdx);
      if (!fromSpan || !toSpan) return;

      var fromRect = udTokenRectCache.get(Number(item.fromIdx));
      var toRect = udTokenRectCache.get(Number(item.toIdx));
      if (!fromRect || !toRect) return;

      var x1 = fromRect.cx;
      var y1 = fromRect.top;
      var x2 = toRect.cx;
      var y2 = toRect.top;

      var midX = (x1 + x2) / 2;
      var dist = Math.abs(x2 - x1);
      var arcHeight = Math.min(40, Math.max(20, dist * 0.3));
      var controlY = Math.min(y1, y2) - arcHeight;

      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'ud-dep-line');
      path.setAttribute('d', 'M ' + x2 + ' ' + y2 + ' Q ' + midX + ' ' + controlY + ' ' + x1 + ' ' + y1);
      path.setAttribute('data-from-idx', item.fromIdx);
      path.setAttribute('data-to-idx', item.toIdx);

      // ONLY color edges directly connected to the hovered token
      // All other edges (internal or external) are grey
      var isHoveredEdge = (item.fromIdx === segIdx || item.toIdx === segIdx);

      var strokeColor, strokeWidth, strokeOpacity, arrowheadId;
      if (isHoveredEdge) {
        // Edges directly connected to hovered token - bright colors
        strokeColor = item.isChildLine ? '#e67e22' : '#6366f1';
        strokeWidth = 1.75;
        strokeOpacity = 0.85;
        arrowheadId = item.isChildLine ? 'ud-arrowhead-child' : 'ud-arrowhead';
      } else {
        // All other edges (internal to chunk or external) - grey/faded
        strokeColor = '#6b7280';
        strokeWidth = 1.4;
        strokeOpacity = 0.25;
        arrowheadId = item.isChildLine ? 'ud-arrowhead-child-faded' : 'ud-arrowhead-faded';
      }

      path.setAttribute('style',
        'stroke: ' + strokeColor + '; ' +
        'stroke-width: ' + strokeWidth + '; ' +
        'opacity: ' + strokeOpacity + '; ' +
        'fill: none;'
      );
      path.setAttribute('marker-end', 'url(#' + arrowheadId + ')');

      svg.appendChild(path);
      udActivePaths.push(path);
    });
  }

  function drawUdLinesForToken(segIdx) {
    if (!displaySettings.udOverlay || !latestUdOverlay || !latestUdOverlay.ok) {
      hideUdLines();
      return;
    }
    var canonicalIdx = getCanonicalSegIdx(segIdx);
    if (displaySettings.bottomUpChunk) {
      drawUdLinesForBottomUpChunk(canonicalIdx);
    } else if (displaySettings.contextWindow) {
      drawUdLinesForContextWindow(canonicalIdx);
    } else if (displaySettings.connectedIslands) {
      drawUdLinesForConnectedIslands(canonicalIdx);
    } else if (displaySettings.islandDepTree) {
      drawUdLinesForIsland(canonicalIdx);
    } else {
      drawUdLinesForClause(canonicalIdx);
    }
  }

  function getUdInfoForSegment(segIdx) {
    if (!latestUdOverlay || !latestUdOverlay.ok) return null;
    var canonicalIdx = getCanonicalSegIdx(segIdx);
    if (latestUdTokenMap && latestUdTokenMap[canonicalIdx]) return latestUdTokenMap[canonicalIdx];
    return null;
  }

  function getUdEdgesForSegment(segIdx) {
    if (!latestUdOverlay || !latestUdOverlay.ok) return [];
    var edges = latestUdOverlay.edges || [];
    return edges.filter(function(e) {
      return e.from === segIdx || e.to === segIdx;
    });
  }

  function buildUdPopupHtml(segIdx) {
    // UD popup disabled - tags moved to dictionary headline
    return '';
  }

  // NEW: Build tag badges for dictionary headline (moved from UD popup)
  // This function is now deprecated as POS tags are rendered directly from the entry.
  function buildUdTagsForHeadline(segIdx) {
    return '';
  }
  // ===================== END UD VISUALIZATION =====================

  // Display toggle state - load from localStorage or use defaults
  var GRAMMAR_TYPES = Object.keys(GRAMMAR_TYPE_COLORS || {});
  var displaySettings = {
    grammarTypes: {},
    udOverlay: true,  // On/off toggle for clause-based UD arrows
    chunkHighlight: true,  // On/off toggle for phrase/clause span highlighting
    nerOverlay: true,  // On/off toggle for NER label overlay
    islandDepTree: false,  // DISABLED FOR DEPLOYMENT - island-based hover overlay
    connectedIslands: false,  // DISABLED FOR DEPLOYMENT - Group and highlight connected islands
    connectedIslandsAclGate: false,  // DISABLED FOR DEPLOYMENT - Merge connected islands unless head is VERB+acl
    contextWindow: false,  // DISABLED FOR DEPLOYMENT - context window chunking algorithm
    contextWindowSize: 10,  // Token count for context window size
    bottomUpChunk: true,  // DEPLOYMENT: Always on when UD arrows/chunks enabled
    bottomUpChunkThreshold: 5,  // Distance threshold for bottom-up chunking
    linearClauseSplit: false,  // Optional linear clause splitting (left-to-right)
    branchDepthMin: 1,  // Minimum head-chain depth to count as a branch
    clauseDepthDrop: 3,  // Depth discontinuity threshold for postpass clause splits
    depTreeView: false,
    udPopup: false,
    pronunciation: true,
    grammarPopup: true,
    dictPopup: true,
    comments: false,  // DISABLED FOR DEPLOYMENT
    subsegmentPopups: false,  // DISABLED FOR DEPLOYMENT - subsegment popups
    fuzzyMaxEditDistance: 3,
    mergeGreedy: true,
    splitDictFill: false,
    posOverride: true,
    stanzaNer: true,
    collapseNerUd: true,
    dpResegment: true,
    lmWeights: {
      oovPenalty: 10.0,
      dictNoLmDiscount: 1.0,
      unigramWeight: 0.2,
      knownWordBaseCost: 1.0,
      unknownWordBaseCost: 5.0,
      bigramWeight: 0.1
    }
  };

  var LM_WEIGHT_DEFAULTS = {
    oovPenalty: 10.0,
    dictNoLmDiscount: 1.0,
    unigramWeight: 0.2,
    knownWordBaseCost: 1.0,
    unknownWordBaseCost: 5.0,
    bigramWeight: 0.1
  };

  var LM_WEIGHT_FIELDS = [
    { key: 'oovPenalty', label: 'OOV syllable penalty', param: 'lm_oov_penalty', step: '0.1' },
    { key: 'dictNoLmDiscount', label: 'Dict no-LM discount', param: 'lm_dict_no_lm_discount', step: '0.05' },
    { key: 'unigramWeight', label: 'Unigram weight', param: 'lm_unigram_weight', step: '0.05' },
    { key: 'knownWordBaseCost', label: 'Known word base cost', param: 'lm_known_base_cost', step: '0.1' },
    { key: 'unknownWordBaseCost', label: 'Unknown word base cost', param: 'lm_unknown_base_cost', step: '0.1' },
    { key: 'bigramWeight', label: 'Bigram weight', param: 'lm_bigram_weight', step: '0.05' }
  ];

  function ensureLmWeightsInitialized() {
    if (!displaySettings.lmWeights || typeof displaySettings.lmWeights !== 'object') {
      displaySettings.lmWeights = {};
    }
    Object.keys(LM_WEIGHT_DEFAULTS).forEach(function(key) {
      var val = displaySettings.lmWeights[key];
      if (typeof val === 'string') {
        var parsed = parseFloat(val);
        if (isFinite(parsed)) {
          displaySettings.lmWeights[key] = parsed;
          return;
        }
      }
      if (typeof val !== 'number' || !isFinite(val)) {
        displaySettings.lmWeights[key] = LM_WEIGHT_DEFAULTS[key];
      }
    });
  }

  // ===================== CHUNK HIGHLIGHTING =====================
  // POS-based colors for chunk highlighting - matches SPACY_UPOS_COLORS
  var CHUNK_POS_COLORS = {
    'ADJ': { bg: '#fde68a', border: 'rgba(251, 191, 36, 0.5)' },
    'ADP': { bg: '#e0f2fe', border: 'rgba(125, 211, 252, 0.5)' },
    'ADV': { bg: '#fee2e2', border: 'rgba(252, 165, 165, 0.5)' },
    'AUX': { bg: '#e0e7ff', border: 'rgba(165, 180, 252, 0.5)' },
    'CCONJ': { bg: '#cffafe', border: 'rgba(103, 232, 249, 0.5)' },
    'DET': { bg: '#f1f5f9', border: 'rgba(203, 213, 225, 0.5)' },
    'INTJ': { bg: '#fcd34d', border: 'rgba(251, 191, 36, 0.5)' },
    'NOUN': { bg: '#bbf7d0', border: 'rgba(74, 222, 128, 0.5)' },
    'NUM': { bg: '#f5d0fe', border: 'rgba(240, 171, 252, 0.5)' },
    'PART': { bg: '#f4f4f5', border: 'rgba(212, 212, 216, 0.5)' },
    'PRON': { bg: '#e2e8f0', border: 'rgba(148, 163, 184, 0.5)' },
    'PROPN': { bg: '#c7d2fe', border: 'rgba(165, 180, 252, 0.5)' },
    'PUNCT': { bg: '#e5e7eb', border: 'rgba(156, 163, 175, 0.5)' },
    'SCONJ': { bg: '#bae6fd', border: 'rgba(125, 211, 252, 0.5)' },
    'SYM': { bg: '#f3e8ff', border: 'rgba(216, 180, 254, 0.5)' },
    'VERB': { bg: '#fda4af', border: 'rgba(251, 113, 133, 0.5)' },
    'X': { bg: '#d1d5db', border: 'rgba(156, 163, 175, 0.5)' },
    'ROOT': { bg: '#fbbf24', border: 'rgba(217, 119, 6, 0.6)' },
    'DEFAULT': { bg: '#e5e7eb', border: 'rgba(156, 163, 175, 0.5)' }
  };

  // Cache for computed chunks
  var latestChunks = null;

  // Build chunk structure from UD overlay
  // Returns: {
  //   chunks: [{headSeg, members: Set, depth, pos}],
  //   tokenToChunks: Map<seg, [{chunk, depth}]>,
  //   canonicalChunk: Map<seg, chunk>,  // The finest-grained chunk for each token
  //   children: Map<seg, [seg]>,         // Parent->children adjacency
  //   tokenMap: Map<seg, token>
  // }
  function computeChunks(udOverlay, maxDepth, useLinearClauseSplit, branchDepthMin, clauseDepthDrop) {
    if (!udOverlay || !udOverlay.ok || maxDepth <= 0) {
      return { chunks: [], tokenToChunks: new Map(), canonicalChunk: new Map(), children: new Map(), tokenMap: new Map() };
    }

    var tokens = udOverlay.tokens || [];
    var roots = udOverlay.roots || [];

    // Build token map and children adjacency
    var tokenMap = new Map();
    var children = new Map();  // parent seg -> [child segs]
    var parentOf = new Map();  // child seg -> parent seg

    tokens.forEach(function(t) {
      tokenMap.set(t.i, t);
      if (!children.has(t.i)) children.set(t.i, []);
    });

    tokens.forEach(function(t) {
      if (t.head !== undefined && t.head !== t.i && tokenMap.has(t.head)) {
        if (!children.has(t.head)) children.set(t.head, []);
        children.get(t.head).push(t.i);
        parentOf.set(t.i, t.head);
      }
    });

    // Compute depth from roots using BFS
    var depthOf = new Map();
    var queue = [];
    roots.forEach(function(r) {
      depthOf.set(r, 0);
      queue.push(r);
    });
    // Also add any tokens not reachable from roots (treat as depth 0)
    tokens.forEach(function(t) {
      if (!depthOf.has(t.i) && !parentOf.has(t.i)) {
        depthOf.set(t.i, 0);
        queue.push(t.i);
      }
    });

    while (queue.length) {
      var cur = queue.shift();
      var curDepth = depthOf.get(cur);
      var kids = children.get(cur) || [];
      kids.forEach(function(kid) {
        if (!depthOf.has(kid)) {
          depthOf.set(kid, curDepth + 1);
          queue.push(kid);
        }
      });
    }

    // Optional clause splitting: linear left-to-right (strict ancestor chain).
    var clauseGroup = null;
    if (useLinearClauseSplit) {
      clauseGroup = new Map();

      // Get all heads (tokens with children)
      var heads = [];
      tokens.forEach(function(t) {
        var kids = children.get(t.i) || [];
        if (kids.length > 0) {
          heads.push(t.i);
        }
      });

      // Sort by position (segment index)
      heads.sort(function(a, b) { return a - b; });

      // Get ancestor chain for a token (walking up the actual dependency tree)
      function getAncestorChain(seg) {
        var chain = [];
        var cur = seg;
        var visited = new Set();
        while (cur !== undefined && !visited.has(cur)) {
          visited.add(cur);
          chain.push(cur);
          cur = parentOf.get(cur);
        }
        return chain; // [seg, parent, grandparent, ..., root]
      }

      function branchDepth(seg, maxDepth) {
        var depth = 0;
        var stack = [{ seg: seg, d: 0 }];
        var seen = new Set();
        while (stack.length) {
          var item = stack.pop();
          var cur = item.seg;
          var d = item.d;
          if (seen.has(cur)) continue;
          seen.add(cur);
          if (d > depth) depth = d;
          if (d >= maxDepth) continue;
          var kids = children.get(cur) || [];
          kids.forEach(function(kid) {
            if ((children.get(kid) || []).length > 0) {
              stack.push({ seg: kid, d: d + 1 });
            }
          });
        }
        return depth;
      }

      var minDepth = Math.max(1, Math.min(5, branchDepthMin || 1));
      var branchHeads = heads.filter(function(seg) { return branchDepth(seg, minDepth) >= minDepth; });

      if (heads.length === 0 || branchHeads.length === 0) {
        // No heads - all tokens in one group
        tokens.forEach(function(t) {
          clauseGroup.set(t.i, 1);
        });
      } else {
        // Linear left-to-right clause grouping: heads must stay on one direct path to root
        function isStrictBranch(seg1, seg2) {
          var chain1 = getAncestorChain(seg1);
          var chain2 = getAncestorChain(seg2);
          var set1 = new Set(chain1);
          var set2 = new Set(chain2);
          return set1.has(seg2) || set2.has(seg1);
        }
        // Use only branch heads to define clauses.
        var groupId = 1;
        var prevHead = branchHeads[0];
        clauseGroup.set(prevHead, groupId);
        for (var i = 1; i < branchHeads.length; i++) {
          var curHead = branchHeads[i];
          if (!isStrictBranch(curHead, prevHead)) {
            groupId++;
          }
          clauseGroup.set(curHead, groupId);
          prevHead = curHead;
        }

        // Assign groups to all heads so the postpass can evaluate full head sequences.
        heads.forEach(function(h) {
          if (clauseGroup.has(h)) return;
          var cur = h;
          var seen = new Set();
          while (cur !== undefined && !seen.has(cur)) {
            seen.add(cur);
            if (clauseGroup.has(cur)) {
              clauseGroup.set(h, clauseGroup.get(cur));
              break;
            }
            cur = parentOf.get(cur);
          }
          if (!clauseGroup.has(h)) clauseGroup.set(h, 0);
        });

        // Include singleton leaf tokens in the postpass.
        var standaloneLeaves = [];
        tokens.forEach(function(t) {
          var kids = children.get(t.i) || [];
          if (kids.length > 0) return;
          standaloneLeaves.push(t.i);
          if (clauseGroup.has(t.i)) return;
          var cur = t.i;
          var seen = new Set();
          while (cur !== undefined && !seen.has(cur)) {
            seen.add(cur);
            if (clauseGroup.has(cur)) {
              clauseGroup.set(t.i, clauseGroup.get(cur));
              break;
            }
            cur = parentOf.get(cur);
          }
          if (!clauseGroup.has(t.i)) clauseGroup.set(t.i, 0);
        });

        // Postpass: split on large depth drops within each clause head sequence.
        var headsByGroup = new Map();
        var postpassNodes = heads.concat(standaloneLeaves);
        postpassNodes.forEach(function(h) {
          var grp = clauseGroup.get(h);
          if (!grp) return;
          if (!headsByGroup.has(grp)) headsByGroup.set(grp, []);
          headsByGroup.get(grp).push(h);
        });
        var nextGroupId = groupId + 1;
        var depthDropMin = Math.max(0, Math.min(10, clauseDepthDrop !== undefined ? clauseDepthDrop : 3));
        headsByGroup.forEach(function(list) {
          list.sort(function(a, b) { return a - b; });
          var currentGroup = clauseGroup.get(list[0]);
          var prevDepth = depthOf.get(list[0]) || 0;
          clauseGroup.set(list[0], currentGroup);
          for (var hi = 1; hi < list.length; hi++) {
            var curHead = list[hi];
            var curDepth = depthOf.get(curHead) || 0;
            if (curDepth - prevDepth >= depthDropMin) {
              currentGroup = nextGroupId++;
            }
            clauseGroup.set(curHead, currentGroup);
            prevDepth = curDepth;
          }
        });

      }

      // Propagate groups to non-head tokens (each gets its nearest head ancestor's group)

      tokens.forEach(function(t) {
        if (clauseGroup.has(t.i)) return;

        // Walk up to find nearest head ancestor with a group
        var cur = t.i;
        var seen = new Set();
        while (cur !== undefined && !seen.has(cur)) {
          seen.add(cur);
          if (clauseGroup.has(cur)) {
            clauseGroup.set(t.i, clauseGroup.get(cur));
            break;
          }
          cur = parentOf.get(cur);
        }

        // If no ancestor found, assign to group 0
        if (!clauseGroup.has(t.i)) clauseGroup.set(t.i, 0);
      });

      function isHeadSeg(seg) {
        var kids = children.get(seg) || [];
        return kids.length > 0;
      }
      var headSegs = [];
      var headSet = new Set();
      tokens.forEach(function(t) {
        if (isHeadSeg(t.i)) {
          headSegs.push(t.i);
          headSet.add(t.i);
        }
      });
      if (headSegs.length === 0) {
        tokens.forEach(function(t) {
          headSegs.push(t.i);
          headSet.add(t.i);
        });
      }

        var splitMultiHeadOutClauseGroups = function() {
        var groupMembers = new Map();
        var groupMembersAll = new Map();
        var maxGroupId = 0;
        tokens.forEach(function(t) {
          var seg = t.i;
          var grpVal = clauseGroup.get(seg);
          if (grpVal === undefined || grpVal === 0) return;
          if (!groupMembersAll.has(grpVal)) groupMembersAll.set(grpVal, []);
          groupMembersAll.get(grpVal).push(seg);
          if (headSet.has(seg)) {
            if (!groupMembers.has(grpVal)) groupMembers.set(grpVal, []);
            groupMembers.get(grpVal).push(seg);
          }
          if (grpVal > maxGroupId) maxGroupId = grpVal;
        });
        var nextSplitGroupId = maxGroupId + 1;
          groupMembersAll.forEach(function(allMembers, grpVal) {
            var members = groupMembers.get(grpVal) || [];
            var memberSetAll = new Set(allMembers);

            // Find all members (not just heads) whose parent is outside the group
            var topLevel = [];
            var topParent = null;
            var allSameParent = true;
            allMembers.forEach(function(seg) {
              var parent = parentOf.get(seg);
              if (parent === undefined || !memberSetAll.has(parent)) {
                topLevel.push(seg);
                if (topParent === null) topParent = parent;
                else if (topParent !== parent) allSameParent = false;
              }
            });

            // Key guard: if multiple members point to the same external parent
            // (meaning the apex is outside the clause), split them into separate clauses
            var splitAnchors;
            var assignMembers;
            if (topLevel.length > 1 && allSameParent && (topParent === undefined || !memberSetAll.has(topParent))) {
              // Multiple members converge to the same external parent - split each into its own clause
              splitAnchors = topLevel;
              assignMembers = allMembers;
            } else {
              // Fall back to original head-out logic
              var headOuts = [];
              members.forEach(function(seg) {
                var parent = parentOf.get(seg);
                if (parent === undefined || !memberSetAll.has(parent)) {
                  headOuts.push(seg);
                }
              });
              splitAnchors = headOuts;
              assignMembers = members;
            }

          if (splitAnchors.length <= 1) return;
          var headToGroup = new Map();
          headToGroup.set(splitAnchors[0], grpVal);
          for (var ho = 1; ho < splitAnchors.length; ho++) {
            headToGroup.set(splitAnchors[ho], nextSplitGroupId++);
          }
          assignMembers.forEach(function(seg) {
            var cur = seg;
            var seen = new Set();
            while (cur !== undefined && !seen.has(cur)) {
              seen.add(cur);
              if (headToGroup.has(cur)) {
                clauseGroup.set(seg, headToGroup.get(cur));
                return;
              }
              var p = parentOf.get(cur);
              if (p === undefined || !memberSetAll.has(p)) {
                if (!headToGroup.has(cur)) {
                  headToGroup.set(cur, nextSplitGroupId++);
                }
                clauseGroup.set(seg, headToGroup.get(cur));
                return;
              }
              cur = p;
            }
            clauseGroup.set(seg, grpVal);
          });
        });
      };

      var propagateGroupsToNonHeads = function() {
        tokens.forEach(function(t) {
          if (headSet.has(t.i)) return;
          var cur = t.i;
          var seen = new Set();
          while (cur !== undefined && !seen.has(cur)) {
            seen.add(cur);
            if (headSet.has(cur) && clauseGroup.has(cur)) {
              clauseGroup.set(t.i, clauseGroup.get(cur));
              return;
            }
            cur = parentOf.get(cur);
          }
          if (!clauseGroup.has(t.i)) clauseGroup.set(t.i, 0);
        });
      };

      // Postpass: split clause groups that have multiple heads pointing outside the group.
      splitMultiHeadOutClauseGroups();

      // Sync non-head tokens to their nearest head before contiguity.
      propagateGroupsToNonHeads();

      // Postpass guard: enforce contiguous clause spans by token order.
      var orderedSegs = tokens.map(function(t) { return t.i; });
      orderedSegs.sort(function(a, b) { return a - b; });
      var remapGroupId = 0;
      var prevGroup = null;
      orderedSegs.forEach(function(seg) {
        var grp = clauseGroup.get(seg);
        if (grp === 0) return;
        if (grp !== prevGroup) {
          remapGroupId++;
          prevGroup = grp;
        }
        clauseGroup.set(seg, remapGroupId);
      });

      // Final postpass: split orphaned clauses whose head is outside the group (after contiguity split them off)
      splitMultiHeadOutClauseGroups();
    }

    // Get root phrase: root + only CONTIGUOUS leaf children
    // Children with children form their own clauses and are NOT part of root phrase
    // Non-contiguous leaf children become their own singleton chunks
    function getRootPhrase(rootSeg) {
      var kids = children.get(rootSeg) || [];

      // Find all leaf children (no grandchildren)
      var leafKids = [];
      kids.forEach(function(k) {
        var grandkids = children.get(k) || [];
        if (grandkids.length === 0) {
          leafKids.push(k);
        }
      });

      if (leafKids.length === 0) {
        return new Set([rootSeg]); // Just the root itself
      }

      // Build set of candidates (root + leaf kids)
      var candidateSet = new Set(leafKids);
      candidateSet.add(rootSeg);

      // Start from root and expand to adjacent candidates only (contiguous)
      var members = new Set();
      var toCheck = [rootSeg];
      var checked = new Set();

      while (toCheck.length > 0) {
        var current = toCheck.pop();
        if (checked.has(current)) continue;
        checked.add(current);

        // Only add if it's a valid candidate
        if (candidateSet.has(current)) {
          members.add(current);

          // Check adjacent token indices
          if (candidateSet.has(current - 1) && !checked.has(current - 1)) {
            toCheck.push(current - 1);
          }
          if (candidateSet.has(current + 1) && !checked.has(current + 1)) {
            toCheck.push(current + 1);
          }
        }
      }

      return members;
    }

    // Get subtree members for a token, but only contiguous leaf children
    // Returns { members: Set, nonContiguousLeaves: Array }
    function getSubtreeContiguous(seg) {
      var members = new Set([seg]);
      var nonContiguousLeaves = [];

      // First pass: recursively add all non-leaf children and their subtrees
      var stack = [seg];
      while (stack.length) {
        var cur = stack.pop();
        var kids = children.get(cur) || [];
        kids.forEach(function(k) {
          var grandkids = children.get(k) || [];
          if (grandkids.length > 0) {
            // Non-leaf child: add it and continue recursion
            if (!members.has(k)) {
              members.add(k);
              stack.push(k);
            }
          }
          // Leaf children handled separately for contiguity check
        });
      }

      // Second pass: for each token in members, keep only leaf kids contiguous to that parent
      var membersArray = Array.from(members);
      membersArray.forEach(function(m) {
        var kids = children.get(m) || [];
        var leafKids = [];
        kids.forEach(function(k) {
          var grandkids = children.get(k) || [];
          if (grandkids.length === 0) {
            leafKids.push(k);
          }
        });

        if (leafKids.length === 0) return;

        var candidate = new Set(leafKids);
        candidate.add(m);

        var local = new Set();
        var stack2 = [m];
        while (stack2.length) {
          var cur = stack2.pop();
          if (local.has(cur)) continue;
          if (!candidate.has(cur)) continue;
          local.add(cur);
          if (candidate.has(cur - 1) && !local.has(cur - 1)) stack2.push(cur - 1);
          if (candidate.has(cur + 1) && !local.has(cur + 1)) stack2.push(cur + 1);
        }

        leafKids.forEach(function(leaf) {
          if (local.has(leaf)) {
            members.add(leaf);
          } else {
            nonContiguousLeaves.push(leaf);
          }
        });
      });

      return { members: members, nonContiguousLeaves: nonContiguousLeaves };
    }

    // Simple getSubtree for backward compatibility (full subtree, no contiguity check)
    function getSubtree(seg) {
      var members = new Set([seg]);
      var stack = [seg];
      while (stack.length) {
        var cur = stack.pop();
        var kids = children.get(cur) || [];
        kids.forEach(function(k) {
          if (!members.has(k)) {
            members.add(k);
            stack.push(k);
          }
        });
      }
      return members;
    }

    // Check if token has children (i.e., is a chunk head candidate)
    function hasChildren(seg) {
      var kids = children.get(seg) || [];
      return kids.length > 0;
    }

    // Build chunks by depth level
    var allChunks = [];
    var tokenToChunks = new Map();  // seg -> [{chunk, depth}]
    var canonicalChunk = new Map(); // seg -> chunk (finest-grained)

    // Initialize tokenToChunks
    tokens.forEach(function(t) {
      tokenToChunks.set(t.i, []);
    });

    // Process depth 0 (roots) - roots with children form phrase chunks
    // Root's chunk is itself + CONTIGUOUS leaf children only
    // Non-contiguous leaf children become explicit singleton chunks
    tokens.forEach(function(t) {
      if (depthOf.get(t.i) === 0 && hasChildren(t.i)) {
        var members = getRootPhrase(t.i);  // Root + contiguous leaf children only
        var rootExtras = [];
        var chunk = {
          headSeg: t.i,
          members: members,
          depth: 0,
          pos: 'ROOT',  // Use special ROOT color for root phrase
          isRootPhrase: true
        };
        allChunks.push(chunk);

        // Register this chunk for members only
        members.forEach(function(m) {
          var list = tokenToChunks.get(m);
          if (list) list.push({ chunk: chunk, depth: 0 });
        });

        // Create explicit singleton chunks for non-contiguous leaf children of root
        var kids = children.get(t.i) || [];
        kids.forEach(function(kid) {
          var grandkids = children.get(kid) || [];
          // Only leaf children (no grandkids) that aren't in root phrase
          if (grandkids.length === 0 && !members.has(kid)) {
            rootExtras.push(kid);
            var singletonChunk = {
              headSeg: kid,
              members: new Set([kid]),
              depth: 0,  // Same depth level as root phrase
              pos: tokens.find(function(tok) { return tok.i === kid; })?.upos || 'DEFAULT',
              isSingleton: true,
              isNonContiguousLeaf: true
            };
            allChunks.push(singletonChunk);
            var kidList = tokenToChunks.get(kid);
            if (kidList) kidList.push({ chunk: singletonChunk, depth: 0 });
          }
        });
        if (rootExtras.length) {
          chunk.extraMembers = rootExtras;
        }
      }
    });

    // Process each depth level (1 to maxDepth)
    for (var d = 1; d <= maxDepth; d++) {
      // Find tokens at this depth that have children
      tokens.forEach(function(t) {
        if (depthOf.get(t.i) === d && hasChildren(t.i)) {
          // Use contiguous version to exclude non-contiguous leaf children
          var result = getSubtreeContiguous(t.i);
          var members = result.members;
          var nonContiguousLeaves = result.nonContiguousLeaves;

          if (clauseGroup) {
            var headGroup = clauseGroup.get(t.i);
            if (headGroup !== undefined) {
              var filtered = new Set();
              members.forEach(function(m) {
                if (clauseGroup.get(m) === headGroup) {
                  filtered.add(m);
                }
              });
              members = filtered;
              nonContiguousLeaves = nonContiguousLeaves.filter(function(m) {
                return clauseGroup.get(m) === headGroup;
              });
            }
          }

          var pos = t.upos || 'DEFAULT';
          var chunk = {
            headSeg: t.i,
            members: members,
            depth: d,
            pos: pos,
            extraMembers: nonContiguousLeaves
          };
          allChunks.push(chunk);

          // Register this chunk for all member tokens
          members.forEach(function(m) {
            var list = tokenToChunks.get(m);
            if (list) list.push({ chunk: chunk, depth: d });
          });

          // Create singleton chunks for non-contiguous leaf children
          nonContiguousLeaves.forEach(function(leaf) {
            var singletonChunk = {
              headSeg: leaf,
              members: new Set([leaf]),
              depth: d,  // Same depth as parent chunk
              pos: tokens.find(function(tok) { return tok.i === leaf; })?.upos || 'DEFAULT',
              isSingleton: true,
              isNonContiguousLeaf: true
            };
            allChunks.push(singletonChunk);
            var leafList = tokenToChunks.get(leaf);
            if (leafList) leafList.push({ chunk: singletonChunk, depth: d });
          });
        }
      });
    }

    // Compute canonical chunk for each token (deepest/finest-grained chunk it belongs to)
    tokens.forEach(function(t) {
      var chunkList = tokenToChunks.get(t.i) || [];
      if (chunkList.length === 0) {
        // Token not in any chunk - assign a pseudo-chunk based on its own POS
        canonicalChunk.set(t.i, {
          headSeg: t.i,
          members: new Set([t.i]),
          depth: -1,
          pos: t.upos || 'DEFAULT',
          isSingleton: true
        });
      } else {
        // Find deepest chunk (highest depth number)
        var deepest = chunkList[0].chunk;
        for (var i = 1; i < chunkList.length; i++) {
          if (chunkList[i].depth > deepest.depth) {
            deepest = chunkList[i].chunk;
          }
        }
        canonicalChunk.set(t.i, deepest);
      }
    });

    return {
      chunks: allChunks,
      tokenToChunks: tokenToChunks,
      canonicalChunk: canonicalChunk,
      children: children,
      tokenMap: tokenMap,
      depthOf: depthOf,
      clauseGroup: clauseGroup
    };
  }

    // Get chunk color based on POS
    function getChunkColor(pos) {
      return CHUNK_POS_COLORS[pos] || CHUNK_POS_COLORS['DEFAULT'];
    }

    function uposColorForTag(upos) {
      var key = (upos || '').toUpperCase();
      return (CHUNK_POS_COLORS[key] && CHUNK_POS_COLORS[key].bg) ? CHUNK_POS_COLORS[key].bg : '#e5e7eb';
    }

  // Get all chunks a token belongs to (sorted by depth, shallowest first)
  function getChunksForToken(seg) {
    if (!latestChunks) return [];
    var list = latestChunks.tokenToChunks.get(seg) || [];
    return list.slice().sort(function(a, b) { return a.depth - b.depth; });
  }

  // Check if a token is a chunk head
  function isChunkHead(seg) {
    if (!latestChunks) return null;
    for (var i = 0; i < latestChunks.chunks.length; i++) {
      if (latestChunks.chunks[i].headSeg === seg) {
        return latestChunks.chunks[i];
      }
    }
    return null;
  }

  // Container for chunk POS tag elements
  var chunkPosTags = [];
  var currentChunkHighlightTokens = null;
  var cachedClauseHead = null;
  var cachedTokenRectCache = null;
  var cachedContainerRect = null;
  var lastUdSegIdx = -1;
  // Performance: cache references to highlighted elements to avoid querySelectorAll
  var highlightedTokenElements = [];
  var highlightedSubtokenElements = [];

  // Clear all chunk highlighting
  function clearChunkHighlight() {
    // Clear context window cache
    clearContextWindowCache();
    // Clear bottom-up chunk cache
    clearBottomUpChunkCache();
    // Remove POS tag elements
    for (var pi = 0; pi < chunkPosTags.length; pi++) {
      var el = chunkPosTags[pi];
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    chunkPosTags = [];

    // Remove highlight styles from cached token elements (avoid querySelectorAll)
    for (var i = 0; i < highlightedTokenElements.length; i++) {
      var el = highlightedTokenElements[i];
      el.classList.remove('chunk-active', 'chunk-head-active', 'hovered-token');
      // Restore original backgroundColor if saved, otherwise clear
      if (el.dataset.originalBgColor) {
        el.style.backgroundColor = el.dataset.originalBgColor;
      } else {
        el.style.backgroundColor = '';
      }
      el.style.boxShadow = '';
      el.style.backgroundImage = '';
      el.style.backgroundSize = '';
      el.style.backgroundPosition = '';
      el.style.backgroundRepeat = '';
      el.style.borderRadius = '';
      el.style.outline = '';
      el.style.outlineOffset = '';
      el.style.position = '';  // Reset position from chunk head styling
    }
    highlightedTokenElements = [];

    // Clear subtoken styles from cached elements
    for (var j = 0; j < highlightedSubtokenElements.length; j++) {
      var sub = highlightedSubtokenElements[j];
      sub.classList.remove('chunk-subtoken-active');
      sub.style.outline = '';
      sub.style.outlineOffset = '';
      sub.style.boxShadow = '';
    }
    highlightedSubtokenElements = [];

    currentChunkHighlightTokens = null;
    cachedClauseHead = null;
    cachedTokenRectCache = null;
    cachedContainerRect = null;
  }

  // Apply chunk highlighting when hovering on a token
  // Uses STABLE canonical colors - each token always gets the same color
  function applyChunkHighlight(segIdx) {
    clearChunkHighlight();
    if (!latestChunks || !displaySettings.chunkHighlight) return;

    // Collect ALL tokens that should light up.
    // When clause splitting is enabled, highlight by clause group; otherwise use chunk membership.
    var allTokensToHighlight = new Set();
    var canonicalSegIdx = getCanonicalSegIdx(segIdx);

    var useContextWindow = displaySettings.contextWindow;
    var useBottomUpChunk = displaySettings.bottomUpChunk;
    var useIslandGroup = displaySettings.islandDepTree || displaySettings.connectedIslands;
    var useClauseGroup = latestChunks.clauseGroup && displaySettings.linearClauseSplit;
    if (useBottomUpChunk) {
      // Use bottom-up chunk algorithm (cached for sync with drawUdLinesForBottomUpChunk)
      allTokensToHighlight = getBottomUpChunkTokens(canonicalSegIdx);
    } else if (useContextWindow) {
      // Use context window algorithm (cached for sync with drawUdLinesForContextWindow)
      allTokensToHighlight = getContextWindowTokens(canonicalSegIdx);
    } else if (useIslandGroup) {
      if (displaySettings.connectedIslands) {
        // Use connected island group
        var connectedSpans = getConnectedIslandGroup(canonicalSegIdx);
        if (connectedSpans && connectedSpans.length > 0) {
          connectedSpans.forEach(function(span) {
            for (var i = span[0]; i < span[1]; i++) {
              allTokensToHighlight.add(i);
            }
          });
        } else {
          allTokensToHighlight.add(canonicalSegIdx);
        }
      } else {
        // Use single island
        var span = getIslandSpanForSeg(canonicalSegIdx);
        if (span) {
          for (var i = span[0]; i < span[1]; i++) {
            allTokensToHighlight.add(i);
          }
        } else {
          allTokensToHighlight.add(canonicalSegIdx);
        }
      }
    } else if (useClauseGroup) {
      var clauseGroup = latestChunks.clauseGroup;
      var targetGroup = clauseGroup.get(canonicalSegIdx);
      if (targetGroup !== undefined && targetGroup !== 0) {
        latestChunks.tokenMap.forEach(function(_, seg) {
          if (clauseGroup.get(seg) === targetGroup) {
            allTokensToHighlight.add(seg);
          }
        });
      } else {
        allTokensToHighlight.add(canonicalSegIdx);
      }
    } else {
      var chunks = getChunksForToken(canonicalSegIdx);
      // Always include the hovered token itself (even if it's an orphaned singleton not in any chunk)
      allTokensToHighlight.add(canonicalSegIdx);
      chunks.forEach(function(item) {
        var chunk = item.chunk;
        if (!chunk) return;
        if (chunk.members) {
          chunk.members.forEach(function(m) {
            allTokensToHighlight.add(m);
          });
        }
        if (!chunk.isRootPhrase && Array.isArray(chunk.extraMembers)) {
          chunk.extraMembers.forEach(function(m) {
            allTokensToHighlight.add(m);
          });
        }
      });
    }
    allTokensToHighlight.add(segIdx);
    allTokensToHighlight.add(canonicalSegIdx);
    allTokensToHighlight = expandHighlightSetForCollapsedSpans(allTokensToHighlight);

    // Find ALL chunk heads within the highlighted tokens (not just chunks the hovered token belongs to)
    // This ensures we show POS tags for every chunk head in the highlighted area
    var chunkHeadToChunk = new Map();
    latestChunks.chunks.forEach(function(chunk) {
      // If this chunk's head is in the highlighted area, track it
      if (allTokensToHighlight.has(chunk.headSeg)) {
        chunkHeadToChunk.set(chunk.headSeg, chunk);
      }
    });

    var containerRect = renderedText.getBoundingClientRect();
    var tokenRectCache = {}; // Shared cache for phrase boundaries and UD arrows - measure each token only once

    // Apply highlighting to each token using its CANONICAL color (stable, never changes)
    allTokensToHighlight.forEach(function(tokenSeg) {
      var spans = getTokenSpanList(tokenSeg);
      if (!spans.length) return;

      // Color by the token's own POS, not the chunk head
      var tokenData = latestChunks.tokenMap && typeof latestChunks.tokenMap.get === 'function'
        ? latestChunks.tokenMap.get(tokenSeg)
        : null;
      var tokenPos = tokenData && tokenData.upos ? tokenData.upos : null;
      var isRootToken = false;
      if (tokenData) {
        if (tokenData.head === tokenData.i) isRootToken = true;
        var depVal = (tokenData.dep || '').toLowerCase();
        if (depVal === 'root') isRootToken = true;
      }
      if (!isRootToken && latestUdOverlay && Array.isArray(latestUdOverlay.roots)) {
        if (latestUdOverlay.roots.indexOf(tokenSeg) !== -1) isRootToken = true;
      }
      if (!isRootToken && (!tokenPos || tokenPos === 'DEFAULT')) {
        var nerLabel = getNerLabelForSeg(tokenSeg);
        var nerPos = nerLabelToUpos(nerLabel);
        if (nerPos) tokenPos = nerPos;
      }
      if (isRootToken) tokenPos = 'ROOT';
      if (!tokenPos) {
        var canonChunk = latestChunks.canonicalChunk.get(tokenSeg);
        tokenPos = canonChunk ? canonChunk.pos : 'DEFAULT';
      }

      var color = getChunkColor(tokenPos);

      spans.forEach(function(span) {
        if (!span) return;
        // Save original backgroundColor before overwriting (for spacy POS overlay preservation)
        if (!span.dataset.originalBgColor && span.style.backgroundColor) {
          span.dataset.originalBgColor = span.style.backgroundColor;
        }

        // Apply styling to the token fragment span
        // Only use properties that don't affect box model to avoid subpixel shifts
        span.classList.add('chunk-active');
        span.style.backgroundColor = color.bg;
        span.style.outline = '1px solid rgba(0, 0, 0, 0.15)';
        span.style.outlineOffset = '-1px';

        // Track this element for fast clearing (avoid querySelectorAll)
        highlightedTokenElements.push(span);

        // Also apply outline to child subtokens (dictionary words within spaCy compounds)
        var subtokens = span.querySelectorAll('.reader-subtoken');
        if (subtokens.length > 1) {
          for (var si = 0; si < subtokens.length; si++) {
            subtokens[si].classList.add('chunk-subtoken-active');
            highlightedSubtokenElements.push(subtokens[si]);
          }
        }

        // If this is a chunk head, keep the head styling but skip the POS tag chip
        if (chunkHeadToChunk.get(tokenSeg)) {
          span.classList.add('chunk-head-active');
          span.style.position = 'relative';
        }

        // Mark the actively hovered token with a subtle glow effect via CSS class
        if (tokenSeg === segIdx) {
          span.classList.add('hovered-token');
        }
      });

      // Cache rect measurement for UD arrows using the first fragment
      if (displaySettings.udOverlay) {
        var anchor = udTokenIndex.get(tokenSeg) || spans[0];
        if (anchor) tokenRectCache[tokenSeg] = anchor.getBoundingClientRect();
      }
    });

    currentChunkHighlightTokens = allTokensToHighlight;
    // Draw UD arrows in the same pass using cached measurements
    if (displaySettings.udOverlay) {
      drawUdLinesForToken(segIdx);
    }
    var canonChunk = latestChunks ? latestChunks.canonicalChunk.get(segIdx) : null;
    cachedClauseHead = canonChunk ? canonChunk.headSeg : null;
    cachedTokenRectCache = tokenRectCache;
    cachedContainerRect = containerRect;

    // Note: External chunk highlighting removed - dep tree arrows are sufficient
    // to show connections to chunks outside the current clause
  }
  // ===================== END CHUNK HIGHLIGHTING =====================
  // Load saved settings from localStorage
  function loadDisplaySettings() {
    try {
      var saved = localStorage.getItem('burmeseReaderDisplaySettings');
      if (saved) {
        var parsed = JSON.parse(saved);
        // Backward compat: legacy grammarOverlay bool turns everything on/off
        var legacyGrammarAll = parsed.hasOwnProperty('grammarOverlay') ? !!parsed.grammarOverlay : false;
        displaySettings.grammarTypes = parsed.grammarTypes || {};
        GRAMMAR_TYPES.forEach(function(t) {
          if (displaySettings.grammarTypes[t] === undefined) {
            displaySettings.grammarTypes[t] = legacyGrammarAll;
          }
        });
        displaySettings.udOverlay = parsed.udOverlay !== undefined ? parsed.udOverlay : displaySettings.udOverlay;
        displaySettings.chunkHighlight = parsed.chunkHighlight !== undefined ? parsed.chunkHighlight : displaySettings.chunkHighlight;
        displaySettings.nerOverlay = parsed.nerOverlay !== undefined ? parsed.nerOverlay : displaySettings.nerOverlay;
        displaySettings.islandDepTree = parsed.islandDepTree !== undefined ? parsed.islandDepTree : displaySettings.islandDepTree;
        displaySettings.connectedIslands = parsed.connectedIslands !== undefined ? parsed.connectedIslands : displaySettings.connectedIslands;
        displaySettings.connectedIslandsAclGate = parsed.connectedIslandsAclGate !== undefined ? parsed.connectedIslandsAclGate : displaySettings.connectedIslandsAclGate;
        displaySettings.contextWindow = parsed.contextWindow !== undefined ? parsed.contextWindow : displaySettings.contextWindow;
        if (parsed.contextWindowSize !== undefined) {
          displaySettings.contextWindowSize = parsed.contextWindowSize;
        }
        displaySettings.bottomUpChunk = parsed.bottomUpChunk !== undefined ? parsed.bottomUpChunk : displaySettings.bottomUpChunk;
        if (parsed.bottomUpChunkThreshold !== undefined) {
          var chunkThreshold = parseInt(parsed.bottomUpChunkThreshold, 10);
          if (isNaN(chunkThreshold)) chunkThreshold = 5;
          if (chunkThreshold < 1) chunkThreshold = 1;
          if (chunkThreshold > 10) chunkThreshold = 10;
          displaySettings.bottomUpChunkThreshold = chunkThreshold;
        }
        displaySettings.linearClauseSplit = parsed.linearClauseSplit !== undefined ? parsed.linearClauseSplit : displaySettings.linearClauseSplit;
        if (parsed.branchDepthMin !== undefined) {
          displaySettings.branchDepthMin = parsed.branchDepthMin;
        }
        if (parsed.clauseDepthDrop !== undefined) {
          displaySettings.clauseDepthDrop = parsed.clauseDepthDrop;
        }
        displaySettings.depTreeView = parsed.depTreeView !== undefined ? parsed.depTreeView : displaySettings.depTreeView;
        displaySettings.udPopup = parsed.udPopup !== undefined ? parsed.udPopup : displaySettings.udPopup;
        displaySettings.pronunciation = parsed.pronunciation !== undefined ? parsed.pronunciation : displaySettings.pronunciation;
        displaySettings.grammarPopup = parsed.grammarPopup !== undefined ? parsed.grammarPopup : displaySettings.grammarPopup;
        displaySettings.dictPopup = parsed.dictPopup !== undefined ? parsed.dictPopup : displaySettings.dictPopup;
        displaySettings.comments = parsed.comments !== undefined ? parsed.comments : displaySettings.comments;
        if (parsed.fuzzyMaxEditDistance !== undefined) {
          var fuzzyVal = parseInt(parsed.fuzzyMaxEditDistance, 10);
          if (!isNaN(fuzzyVal)) {
            displaySettings.fuzzyMaxEditDistance = fuzzyVal;
          }
        }
        displaySettings.mergeGreedy = parsed.mergeGreedy !== undefined ? parsed.mergeGreedy : displaySettings.mergeGreedy;
        displaySettings.splitDictFill = parsed.splitDictFill !== undefined ? parsed.splitDictFill : displaySettings.splitDictFill;
        // posOverride, stanzaNer, collapseNerUd, dpResegment are now hardcoded to true
        if (parsed.lmWeights !== undefined) {
          displaySettings.lmWeights = parsed.lmWeights;
        }
        ensureLmWeightsInitialized();
        ensureFuzzySettingsInitialized();
      }
    } catch (e) {
      console.error('Failed to load display settings:', e);
    }
    ensureLmWeightsInitialized();
    ensureFuzzySettingsInitialized();
  }
  // Save settings to localStorage
  function saveDisplaySettings() {
    try {
      localStorage.setItem('burmeseReaderDisplaySettings', JSON.stringify(displaySettings));
    } catch (e) {
      console.error('Failed to save display settings:', e);
    }
  }
  // Load settings on startup
  loadDisplaySettings();
  function applyViewMode() {
    var showDep = !!displaySettings.depTreeView;
    if (renderedText) renderedText.style.display = showDep ? 'none' : 'block';
    if (depTreeViewEl) depTreeViewEl.style.display = showDep ? 'block' : 'none';
    if (window.DepTreeView && typeof window.DepTreeView.setVisible === 'function') {
      window.DepTreeView.setVisible(showDep);
    }
    if (showDep) {
      if (window.DepTreeView && typeof window.DepTreeView.refitView === 'function') {
        window.DepTreeView.refitView();
      }
      hidePopup();
    }
  }
  function initDepTreeView() {
    if (!depTreeViewEl || !window.DepTreeView || typeof window.DepTreeView.init !== 'function') return;
    depTreeController = window.DepTreeView;
    depTreeController.init({
      container: depTreeViewEl,
      chunkHighlight: displaySettings.chunkHighlight,
      dictPopup: displaySettings.dictPopup,
      linearClauseSplit: displaySettings.linearClauseSplit,
      branchDepthMin: displaySettings.branchDepthMin,
      clauseDepthDrop: displaySettings.clauseDepthDrop,
      bottomUpChunkThreshold: displaySettings.bottomUpChunkThreshold
    });
    if (typeof depTreeController.setSourceToggleState === 'function') {
      depTreeController.setSourceToggleState(depTreeUseConllu);
    }
    if (depTreeUseConllu && depTreeConlluMetaUrl && depTreeConlluUrl && typeof depTreeController.loadConlluSentenceSource === 'function') {
      depTreeController.loadConlluSentenceSource(depTreeConlluMetaUrl, depTreeConlluUrl);
    } else if (depTreeUseConllu && depTreeConlluUrl && typeof depTreeController.loadConlluFromUrl === 'function') {
      depTreeController.loadConlluFromUrl(depTreeConlluUrl);
    }
    depTreeController.setVisible(displaySettings.depTreeView);
  }

  function updateDepTreeFromLatestData() {
    if (!depTreeController || typeof depTreeController.setData !== 'function') return;
    if (!latestSegments || !latestUdOverlay) {
      depTreeController.setData({ segments: [], udOverlay: null });
      return;
    }
    depTreeController.debugMode = false;
    depTreeController.changedTokens = null;
    depTreeController.changeDetails = null;
    depTreeController.fills = latestFillsDict || {};
    depTreeController.setData({ segments: latestSegments, udOverlay: latestUdOverlay, originalText: latestOriginalText });
  }

  function setDepTreeSourceMode(useConllu) {
    depTreeUseConllu = !!useConllu;
    if (depTreeController && typeof depTreeController.setSourceToggleState === 'function') {
      depTreeController.setSourceToggleState(depTreeUseConllu);
    }
    if (depTreeUseConllu) {
      if (depTreeController && typeof depTreeController.loadConlluSentenceSource === 'function') {
        depTreeController.loadConlluSentenceSource(depTreeConlluMetaUrl, depTreeConlluUrl);
      }
    } else {
      if (depTreeController && typeof depTreeController.clearSentenceSource === 'function') {
        depTreeController.clearSentenceSource();
      }
      updateDepTreeFromLatestData();
    }
  }
  function getCurrentHoverSegIdx() {
    if (!currentSpan) return -1;
    var base = currentSpan;
    if (base.classList && base.classList.contains('reader-subtoken')) {
      base = base.closest('.reader-token');
    }
    if (!base || !base.dataset) return -1;
    return parseInt(base.dataset.index || '-1', 10);
  }
  function appendLmWeightsToUrl(url) {
    if (!displaySettings.lmWeights) return url;
    LM_WEIGHT_FIELDS.forEach(function(field) {
      var val = displaySettings.lmWeights[field.key];
      if (typeof val === 'number' && isFinite(val)) {
        url += '&' + field.param + '=' + encodeURIComponent(val);
      }
    });
    return url;
  }
  function buildLookupUrl(q) {
    var url = '/lookup?q=' + encodeURIComponent(q || '');
    url += '&merge_greedy=' + (displaySettings.mergeGreedy ? '1' : '0');
    url += '&split_fill=' + (displaySettings.splitDictFill ? '1' : '0');
    url += '&pos_override=' + (displaySettings.posOverride ? '1' : '0');
    url += '&stanza_ner=' + (displaySettings.stanzaNer ? '1' : '0');
    url += '&collapse_ner_spans=' + (displaySettings.collapseNerUd ? '1' : '0');
    url += '&dp_resegment=' + (displaySettings.dpResegment ? '1' : '0');
    return appendLmWeightsToUrl(url);
  }
  function buildLookupUrlLite(q) {
    var url = '/lookup?q=' + encodeURIComponent(q || '');
    url += '&merge_greedy=' + (displaySettings.mergeGreedy ? '1' : '0');
    url += '&split_fill=' + (displaySettings.splitDictFill ? '1' : '0');
    url += '&collapse_ner_spans=' + (displaySettings.collapseNerUd ? '1' : '0');
    url += '&lite=1';
    return appendLmWeightsToUrl(url);
  }
  function buildLookupUrlRaw(q, exact) {
    var url = '/lookup?q=' + encodeURIComponent(q || '');
    url += '&raw=1';
    if (exact) url += '&exact=1';
    url += '&stanza_ner=' + (displaySettings.stanzaNer ? '1' : '0');
    url += '&collapse_ner_spans=' + (displaySettings.collapseNerUd ? '1' : '0');
    url += '&dp_resegment=' + (displaySettings.dpResegment ? '1' : '0');
    return appendLmWeightsToUrl(url);
  }
  // Display controls dropdown
  var displayToggleBtn = document.getElementById('displayToggleBtn');
  var displayDropdown = document.getElementById('displayDropdown');
  var toggleDepTreeView = document.getElementById('toggleDepTreeView');
  var toggleGrammarOverlayAll = document.getElementById('toggleGrammarOverlayAll');
  var openGrammarOverlayPanel = document.getElementById('openGrammarOverlayPanel');
  var grammarOverlayPanel = null;
  var openLmWeightsPanel = document.getElementById('openLmWeightsPanel');
  var lmWeightsPanel = null;
  // OBSOLETE: greedy/split post-passes replaced by DP resegmentation
  // var toggleMergeGreedy = document.getElementById('toggleMergeGreedy');
  // var toggleSplitDictFill = document.getElementById('toggleSplitDictFill');
  // posOverride, stanzaNer, collapseNerUd, dpResegment toggles removed - now hardcoded
  var toggleUdOverlay = document.getElementById('toggleUdOverlay');
  var toggleChunkHighlight = document.getElementById('toggleChunkHighlight');
  var toggleNerOverlay = document.getElementById('toggleNerOverlay');
  var toggleIslandDepTree = document.getElementById('toggleIslandDepTree');
  var toggleConnectedIslands = document.getElementById('toggleConnectedIslands');
  var toggleConnectedIslandsAclGate = document.getElementById('toggleConnectedIslandsAclGate');
  var toggleContextWindow = document.getElementById('toggleContextWindow');
  var contextWindowSizeInput = document.getElementById('contextWindowSize');
  var toggleBottomUpChunk = document.getElementById('toggleBottomUpChunk');
  var bottomUpChunkThresholdInput = document.getElementById('bottomUpChunkThreshold');
  var branchDepthMinInput = document.getElementById('branchDepthMin');
  var clauseDepthDropInput = document.getElementById('clauseDepthDrop');
  var togglePronunciation = document.getElementById('togglePronunciation');
  var toggleGrammarPopup = document.getElementById('toggleGrammarPopup');
  var toggleDictPopup = document.getElementById('toggleDictPopup');
  var togglePdfjsTextLayer = document.getElementById('togglePdfjsTextLayer');
  var pdfTextSourceGroup = document.getElementById('pdfTextSourceGroup');
  var fuzzyMaxEditDistanceInput = document.getElementById('fuzzyMaxEditDistance');
  var toggleComments = document.getElementById('toggleComments');
  var toggleSubsegmentPopups = document.getElementById('toggleSubsegmentPopups');

  function ensureGrammarTypesInitialized() {
    GRAMMAR_TYPES.forEach(function(t) {
      if (displaySettings.grammarTypes[t] === undefined) {
        displaySettings.grammarTypes[t] = false;
      }
    });
  }
  function ensureFuzzySettingsInitialized() {
    if (typeof displaySettings.fuzzyMaxEditDistance !== 'number' || !isFinite(displaySettings.fuzzyMaxEditDistance)) {
      displaySettings.fuzzyMaxEditDistance = 3;
    }
    if (displaySettings.fuzzyMaxEditDistance < 0) {
      displaySettings.fuzzyMaxEditDistance = 0;
    }
    if (displaySettings.fuzzyMaxEditDistance > 6) {
      displaySettings.fuzzyMaxEditDistance = 6;
    }
  }
  ensureGrammarTypesInitialized();
  ensureLmWeightsInitialized();
  ensureFuzzySettingsInitialized();

  function syncMasterGrammarToggle() {
    if (!toggleGrammarOverlayAll) return;
    var allOn = GRAMMAR_TYPES.length ? GRAMMAR_TYPES.every(function(t) { return displaySettings.grammarTypes[t]; }) : false;
    toggleGrammarOverlayAll.checked = allOn;
  }

  function renderGrammarTypeCheckboxes() {
    if (!grammarOverlayPanel) return;
    grammarOverlayPanel.innerHTML = '';
    var header = document.createElement('h4');
    header.textContent = 'Grammar categories';
    grammarOverlayPanel.appendChild(header);
    var list = document.createElement('div');
    list.className = 'toggle-grid';
    grammarOverlayPanel.appendChild(list);
    GRAMMAR_TYPES.forEach(function(t) {
      var label = document.createElement('label');
      label.className = 'toggle-label';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!displaySettings.grammarTypes[t];
      cb.dataset.grammarType = t;
      cb.addEventListener('change', function() {
        var gt = this.dataset.grammarType;
        displaySettings.grammarTypes[gt] = this.checked;
        syncMasterGrammarToggle();
        saveDisplaySettings();
        if (latestData) {
          renderSegments(latestData, sourceText.value);
        }
      });
      var span = document.createElement('span');
      span.textContent = t;
      label.appendChild(cb);
      label.appendChild(span);
      list.appendChild(label);
    });
  }

  // Sync checkboxes with loaded settings
  syncMasterGrammarToggle();
  if (toggleDepTreeView) toggleDepTreeView.checked = displaySettings.depTreeView;
  // OBSOLETE: greedy/split post-passes replaced by DP resegmentation
  // if (toggleMergeGreedy) toggleMergeGreedy.checked = displaySettings.mergeGreedy;
  // if (toggleSplitDictFill) toggleSplitDictFill.checked = displaySettings.splitDictFill;
  if (toggleIslandDepTree) toggleIslandDepTree.checked = displaySettings.islandDepTree;
  if (toggleConnectedIslands) toggleConnectedIslands.checked = displaySettings.connectedIslands;
  if (toggleConnectedIslandsAclGate) toggleConnectedIslandsAclGate.checked = displaySettings.connectedIslandsAclGate;
  if (toggleContextWindow) toggleContextWindow.checked = displaySettings.contextWindow;
  if (contextWindowSizeInput) contextWindowSizeInput.value = displaySettings.contextWindowSize;
  if (toggleBottomUpChunk) toggleBottomUpChunk.checked = displaySettings.bottomUpChunk;
  if (bottomUpChunkThresholdInput) bottomUpChunkThresholdInput.value = displaySettings.bottomUpChunkThreshold;
  // posOverride, stanzaNer, collapseNerUd, dpResegment checkboxes removed - now hardcoded
  if (branchDepthMinInput) branchDepthMinInput.value = displaySettings.branchDepthMin;
  if (clauseDepthDropInput) clauseDepthDropInput.value = displaySettings.clauseDepthDrop;
  if (toggleUdOverlay) toggleUdOverlay.checked = displaySettings.udOverlay;
  if (toggleChunkHighlight) toggleChunkHighlight.checked = displaySettings.chunkHighlight;
  if (toggleNerOverlay) toggleNerOverlay.checked = displaySettings.nerOverlay;
  if (togglePronunciation) togglePronunciation.checked = displaySettings.pronunciation;
  if (toggleGrammarPopup) toggleGrammarPopup.checked = displaySettings.grammarPopup;
  if (toggleDictPopup) toggleDictPopup.checked = displaySettings.dictPopup;
  if (fuzzyMaxEditDistanceInput) fuzzyMaxEditDistanceInput.value = displaySettings.fuzzyMaxEditDistance;
  if (toggleComments) toggleComments.checked = displaySettings.comments;
  function openGrammarOverlayPanelUI() {
    if (!displayDropdown) return;
    if (!grammarOverlayPanel) {
      grammarOverlayPanel = document.createElement('div');
      grammarOverlayPanel.id = 'grammarOverlayPanel';
      grammarOverlayPanel.className = 'grammar-overlay-panel';
      displayDropdown.appendChild(grammarOverlayPanel);
    }
    renderGrammarTypeCheckboxes();
    grammarOverlayPanel.style.display = 'block';
  }

  function closeGrammarOverlayPanel() {
    if (grammarOverlayPanel) grammarOverlayPanel.style.display = 'none';
  }

  function renderLmWeightsPanel() {
    if (!lmWeightsPanel) return;
    ensureLmWeightsInitialized();
    lmWeightsPanel.innerHTML = '';
    var header = document.createElement('h4');
    header.textContent = 'LM weights';
    lmWeightsPanel.appendChild(header);
    var list = document.createElement('div');
    list.className = 'toggle-grid';
    lmWeightsPanel.appendChild(list);
    var updateWeights = debounce(function() {
      saveDisplaySettings();
      if (sourceText && sourceText.value) {
        triggerUpdate();
      }
    }, 300);
    var inputsByKey = {};
    LM_WEIGHT_FIELDS.forEach(function(field) {
      var row = document.createElement('label');
      row.className = 'toggle-label';
      row.style.justifyContent = 'space-between';
      row.style.width = '100%';
      var name = document.createElement('span');
      name.textContent = field.label;
      var input = document.createElement('input');
      input.type = 'number';
      input.step = field.step || '0.1';
      input.value = String(displaySettings.lmWeights[field.key]);
      input.style.width = '90px';
      input.dataset.lmKey = field.key;
      inputsByKey[field.key] = input;
      input.addEventListener('input', function() {
        var nextVal = parseFloat(this.value);
        if (!isFinite(nextVal)) return;
        displaySettings.lmWeights[field.key] = nextVal;
        updateWeights();
      });
      input.addEventListener('change', function() {
        var nextVal = parseFloat(this.value);
        if (!isFinite(nextVal)) {
          this.value = String(displaySettings.lmWeights[field.key]);
          return;
        }
        displaySettings.lmWeights[field.key] = nextVal;
        updateWeights();
      });
      row.appendChild(name);
      row.appendChild(input);
      list.appendChild(row);
    });
    var resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'dropdown-button';
    resetBtn.textContent = 'Reset to defaults';
    resetBtn.addEventListener('click', function() {
      displaySettings.lmWeights = Object.assign({}, LM_WEIGHT_DEFAULTS);
      Object.keys(inputsByKey).forEach(function(key) {
        if (inputsByKey[key]) {
          inputsByKey[key].value = String(displaySettings.lmWeights[key]);
        }
      });
      saveDisplaySettings();
      if (sourceText && sourceText.value) {
        triggerUpdate();
      }
    });
    lmWeightsPanel.appendChild(resetBtn);
  }

  function openLmWeightsPanelUI() {
    if (!displayDropdown) return;
    if (!lmWeightsPanel) {
      lmWeightsPanel = document.createElement('div');
      lmWeightsPanel.id = 'lmWeightsPanel';
      lmWeightsPanel.className = 'grammar-overlay-panel';
      displayDropdown.appendChild(lmWeightsPanel);
    }
    closeGrammarOverlayPanel();
    renderLmWeightsPanel();
    lmWeightsPanel.style.display = 'block';
  }

  function closeLmWeightsPanel() {
    if (lmWeightsPanel) lmWeightsPanel.style.display = 'none';
  }

  renderGrammarTypeCheckboxes();
  initDepTreeView();
  applyViewMode();

  // Legacy closeAllMenus - now handled by left sidebar
  function closeAllMenus(except) {
    closeGrammarOverlayPanel();
    closeLmWeightsPanel();
  }
  // Invalidate row band cache on resize/scroll (positions change)
  var resizeDebounceTimer = null;
  window.addEventListener('resize', function() {
    invalidateUdRectCache();
    invalidateUiRectCache();
    if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
    resizeDebounceTimer = setTimeout(function() {
      invalidateRowBandCache();
      computeAndCacheRowBands();
    }, 100);
  });
  if (renderedText) {
    renderedText.addEventListener('scroll', function() {
      invalidateRowBandCache();
      invalidateUdRectCache();
    invalidateUiRectCache();
    });
  }
  // Grammar overlay master toggle (select/deselect all)
  if (toggleGrammarOverlayAll) {
    toggleGrammarOverlayAll.addEventListener('change', function() {
      var val = this.checked;
      GRAMMAR_TYPES.forEach(function(t) { displaySettings.grammarTypes[t] = val; });
      saveDisplaySettings();
      renderGrammarTypeCheckboxes();
      if (latestData) {
        renderSegments(latestData, sourceText.value);
      }
    });
  }
  // Open grammar overlay panel
  if (openGrammarOverlayPanel) {
    openGrammarOverlayPanel.addEventListener('click', function(e) {
      e.stopPropagation();
      openGrammarOverlayPanelUI();
    });
  }
  if (openLmWeightsPanel) {
    openLmWeightsPanel.addEventListener('click', function(e) {
      e.stopPropagation();
      openLmWeightsPanelUI();
    });
  }
  if (toggleDepTreeView) {
    toggleDepTreeView.addEventListener('change', function() {
      displaySettings.depTreeView = this.checked;
      saveDisplaySettings();
      applyViewMode();
    });
  }
  // OBSOLETE: greedy/split post-passes replaced by DP resegmentation
  // if (toggleMergeGreedy) {
  //   toggleMergeGreedy.addEventListener('change', function() {
  //     displaySettings.mergeGreedy = this.checked;
  //     saveDisplaySettings();
  //     if (sourceText && sourceText.value) {
  //       triggerUpdate();
  //     }
  //   });
  // }
  // if (toggleSplitDictFill) {
  //   toggleSplitDictFill.addEventListener('change', function() {
  //     displaySettings.splitDictFill = this.checked;
  //     saveDisplaySettings();
  //     if (sourceText && sourceText.value) {
  //       triggerUpdate();
  //     }
  //   });
  // }
  // Event listeners for posOverride, stanzaNer, collapseNerUd, dpResegment removed
  // These settings are now hardcoded to true
  if (toggleUdOverlay) {
    toggleUdOverlay.addEventListener('change', function() {
      displaySettings.udOverlay = this.checked;
      // DEPLOYMENT: Auto-enable bottom-up chunk when UD arrows or chunks are on
      if (displaySettings.udOverlay || displaySettings.chunkHighlight) {
        displaySettings.bottomUpChunk = true;
        if (toggleBottomUpChunk) toggleBottomUpChunk.checked = true;
      }
      saveDisplaySettings();
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0) {
        // Re-apply UD lines
        if (displaySettings.udOverlay) {
          drawUdLinesForToken(segIdx);
        } else {
          hideUdLines();
        }
        // Also re-apply chunk highlighting (keep in sync)
        applyChunkHighlight(segIdx);
      } else {
        hideUdLines();
      }
    });
  }
  if (toggleChunkHighlight) {
    toggleChunkHighlight.addEventListener('change', function() {
      displaySettings.chunkHighlight = this.checked;
      displaySettings.linearClauseSplit = this.checked;  // UD chunks now controls linear clause split
      // DEPLOYMENT: Auto-enable bottom-up chunk when UD arrows or chunks are on
      if (displaySettings.udOverlay || displaySettings.chunkHighlight) {
        displaySettings.bottomUpChunk = true;
        if (toggleBottomUpChunk) toggleBottomUpChunk.checked = true;
      }
      saveDisplaySettings();
      // Recompute chunks (use max depth 100 when on, 0 when off)
      if (latestUdOverlay) {
        latestChunks = computeChunks(
          latestUdOverlay,
          displaySettings.chunkHighlight ? 100 : 0,
          displaySettings.linearClauseSplit || displaySettings.udOverlay,
          displaySettings.branchDepthMin,
          displaySettings.clauseDepthDrop
        );
      }
      // Sync with tree view
      if (depTreeController && typeof depTreeController.setChunkHighlight === 'function') {
        depTreeController.setChunkHighlight(displaySettings.chunkHighlight);
      }
      if (depTreeController && typeof depTreeController.setLinearClauseSplit === 'function') {
        depTreeController.setLinearClauseSplit(displaySettings.linearClauseSplit);
      }
      // Re-apply all hover highlights if applicable
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0) {
        // Re-apply UD lines (keep in sync)
        if (displaySettings.udOverlay) {
          drawUdLinesForToken(segIdx);
        }
        // Re-apply chunk highlighting
        applyChunkHighlight(segIdx);
      } else {
        // Clear highlighting if no hover
        clearChunkHighlight();
      }
    });
  }
  if (toggleNerOverlay) {
    toggleNerOverlay.addEventListener('change', function() {
      displaySettings.nerOverlay = this.checked;
      saveDisplaySettings();
      var segIdx = getCurrentHoverSegIdx();
      if (displaySettings.nerOverlay && segIdx >= 0) {
        renderNerHoverForToken(segIdx);
      } else {
        hideNerHover();
      }
    });
  }
  if (toggleIslandDepTree) {
    toggleIslandDepTree.addEventListener('change', function() {
      displaySettings.islandDepTree = this.checked;
      saveDisplaySettings();
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0) {
        if (displaySettings.udOverlay) {
          drawUdLinesForToken(segIdx);
        }
        applyChunkHighlight(segIdx);
      } else {
        hideUdLines();
        clearChunkHighlight();
      }
    });
  }
  if (toggleConnectedIslands) {
    toggleConnectedIslands.addEventListener('change', function() {
      displaySettings.connectedIslands = this.checked;
      saveDisplaySettings();
      rebuildConnectedIslandGroups();
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0) {
        if (displaySettings.udOverlay) {
          drawUdLinesForToken(segIdx);
        }
        applyChunkHighlight(segIdx);
      } else {
        hideUdLines();
        clearChunkHighlight();
      }
    });
  }
  if (toggleConnectedIslandsAclGate) {
    toggleConnectedIslandsAclGate.addEventListener('change', function() {
      displaySettings.connectedIslandsAclGate = this.checked;
      saveDisplaySettings();
      rebuildConnectedIslandGroups();
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0) {
        if (displaySettings.udOverlay) {
          drawUdLinesForToken(segIdx);
        }
        applyChunkHighlight(segIdx);
      } else {
        hideUdLines();
        clearChunkHighlight();
      }
    });
  }
  if (toggleContextWindow) {
    toggleContextWindow.addEventListener('change', function() {
      displaySettings.contextWindow = this.checked;
      saveDisplaySettings();
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0) {
        if (displaySettings.udOverlay) {
          drawUdLinesForToken(segIdx);
        }
        applyChunkHighlight(segIdx);
      } else {
        hideUdLines();
        clearChunkHighlight();
      }
    });
  }
  if (contextWindowSizeInput) {
    contextWindowSizeInput.addEventListener('change', function() {
      var val = parseInt(this.value, 10);
      if (isNaN(val)) val = 10;
      if (val < 1) val = 1;
      if (val > 50) val = 50;
      this.value = val;
      displaySettings.contextWindowSize = val;
      saveDisplaySettings();
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0 && displaySettings.contextWindow) {
        if (displaySettings.udOverlay) {
          drawUdLinesForToken(segIdx);
        }
        applyChunkHighlight(segIdx);
      }
    });
  }
  if (toggleBottomUpChunk) {
    toggleBottomUpChunk.addEventListener('change', function() {
      displaySettings.bottomUpChunk = this.checked;
      saveDisplaySettings();
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0) {
        if (displaySettings.udOverlay) {
          drawUdLinesForToken(segIdx);
        }
        applyChunkHighlight(segIdx);
      } else {
        hideUdLines();
        clearChunkHighlight();
      }
    });
  }
  if (bottomUpChunkThresholdInput) {
    bottomUpChunkThresholdInput.addEventListener('change', function() {
      var val = parseInt(this.value, 10);
      if (isNaN(val)) val = 5;
      if (val < 1) val = 1;
      if (val > 10) val = 10;
      this.value = val;
      displaySettings.bottomUpChunkThreshold = val;
      saveDisplaySettings();
      // Sync with dep tree view
      if (depTreeController && typeof depTreeController.setBottomUpChunkThreshold === 'function') {
        depTreeController.setBottomUpChunkThreshold(val);
      }
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0 && displaySettings.bottomUpChunk) {
        clearBottomUpChunkCache();
        if (displaySettings.udOverlay) {
          drawUdLinesForToken(segIdx);
        }
        applyChunkHighlight(segIdx);
      }
    });
  }
  var resetThresholdBtn = document.getElementById('resetThresholdBtn');
  if (resetThresholdBtn && bottomUpChunkThresholdInput) {
    resetThresholdBtn.addEventListener('click', function() {
      var defaultVal = 5;
      bottomUpChunkThresholdInput.value = defaultVal;
      displaySettings.bottomUpChunkThreshold = defaultVal;
      saveDisplaySettings();
      if (depTreeController && typeof depTreeController.setBottomUpChunkThreshold === 'function') {
        depTreeController.setBottomUpChunkThreshold(defaultVal);
      }
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0 && displaySettings.bottomUpChunk) {
        clearBottomUpChunkCache();
        if (displaySettings.udOverlay) {
          drawUdLinesForToken(segIdx);
        }
        applyChunkHighlight(segIdx);
      }
    });
  }
  if (branchDepthMinInput) {
    branchDepthMinInput.addEventListener('change', function() {
      var val = parseInt(this.value, 10);
      if (isNaN(val)) val = 1;
      if (val < 1) val = 1;
      if (val > 10) val = 10;
      this.value = val;
      displaySettings.branchDepthMin = val;
      saveDisplaySettings();
      if (latestUdOverlay) {
        latestChunks = computeChunks(
          latestUdOverlay,
          displaySettings.chunkHighlight ? 100 : 0,
          displaySettings.linearClauseSplit || displaySettings.udOverlay,
          displaySettings.branchDepthMin,
          displaySettings.clauseDepthDrop
        );
      }
      if (depTreeController && typeof depTreeController.setBranchDepthMin === 'function') {
        depTreeController.setBranchDepthMin(displaySettings.branchDepthMin);
      }
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0) {
        applyChunkHighlight(segIdx);
      } else {
        clearChunkHighlight();
      }
    });
  }
  if (clauseDepthDropInput) {
    clauseDepthDropInput.addEventListener('change', function() {
      var val = parseInt(this.value, 10);
      if (isNaN(val)) val = 3;
      if (val < 0) val = 0;
      if (val > 10) val = 10;
      this.value = val;
      displaySettings.clauseDepthDrop = val;
      saveDisplaySettings();
      if (latestUdOverlay) {
        latestChunks = computeChunks(
          latestUdOverlay,
          displaySettings.chunkHighlight ? 100 : 0,
          displaySettings.linearClauseSplit || displaySettings.udOverlay,
          displaySettings.branchDepthMin,
          displaySettings.clauseDepthDrop
        );
      }
      if (depTreeController && typeof depTreeController.setClauseDepthDrop === 'function') {
        depTreeController.setClauseDepthDrop(displaySettings.clauseDepthDrop);
      }
      var segIdx = getCurrentHoverSegIdx();
      if (segIdx >= 0) {
        applyChunkHighlight(segIdx);
      } else {
        clearChunkHighlight();
      }
    });
  }
  // Pronunciation popup toggle
  if (togglePronunciation) {
    togglePronunciation.addEventListener('change', function() {
      displaySettings.pronunciation = this.checked;
      saveDisplaySettings();
      if (!this.checked && g2pPopup) {
        g2pPopup.style.display = 'none';
      }
    });
  }
  // Grammar popup toggle
  if (toggleGrammarPopup) {
    toggleGrammarPopup.addEventListener('change', function() {
      displaySettings.grammarPopup = this.checked;
      saveDisplaySettings();
      if (!this.checked && grammarPopup) {
        grammarPopup.style.display = 'none';
      }
    });
  }
  // Dictionary popup toggle
  if (toggleDictPopup) {
    toggleDictPopup.addEventListener('change', function() {
      displaySettings.dictPopup = this.checked;
      saveDisplaySettings();
      if (!this.checked && hoverPopup) {
        hoverPopup.style.display = 'none';
      }
      // Sync with tree view
      if (depTreeController && typeof depTreeController.setDictPopup === 'function') {
        depTreeController.setDictPopup(displaySettings.dictPopup);
      }
    });
  }
  // PDF.js text layer toggle
  if (togglePdfjsTextLayer) {
    togglePdfjsTextLayer.addEventListener('change', function() {
      usePdfjsTextLayer = togglePdfjsTextLayer.checked;
      pdfjsTextLayerCache = {};
      pageLookupTextByIndex = {};
      lastLookupPageIndex = -1;
      pendingPdfLookupPageIndex = -1;
      latestSeq += 1;
      triggerUpdate();
    });
  }
  if (fuzzyMaxEditDistanceInput) {
    fuzzyMaxEditDistanceInput.addEventListener('change', function() {
      var val = parseInt(this.value, 10);
      if (isNaN(val)) {
        this.value = displaySettings.fuzzyMaxEditDistance;
        return;
      }
      if (val < 0) val = 0;
      if (val > 6) val = 6;
      displaySettings.fuzzyMaxEditDistance = val;
      this.value = val;
      saveDisplaySettings();
    });
  }
  // Comments toggle
  if (toggleComments) {
    toggleComments.addEventListener('change', function() {
      displaySettings.comments = this.checked;
      saveDisplaySettings();
      if (!this.checked && notePopup) {
        notePopup.style.display = 'none';
      }
    });
  }
  // Subsegment popups toggle
  if (toggleSubsegmentPopups) {
    toggleSubsegmentPopups.addEventListener('change', function() {
      displaySettings.subsegmentPopups = this.checked;
      saveDisplaySettings();
    });
  }
  // Panel toggle
  function togglePanel(open) {
    panelOpen = open !== undefined ? open : !panelOpen;
    sidePanel.classList.toggle('open', panelOpen);
    panelToggle.classList.toggle('panel-open', panelOpen);
    mainContainer.classList.toggle('panel-open', panelOpen);
  }
  panelToggle.addEventListener('click', function() { togglePanel(); });
  // Search
  function doSearch() {
    var q = (dictSearch.value || '').trim();
    if (!q) return;
    togglePanel(true);
    lookupAndDisplay(q, { raw: true, exact: true, allowFuzzy: true, noIsland: true, forceWholeToken: true });
  }
  searchBtn.addEventListener('click', doSearch);
  dictSearch.addEventListener('keydown', function(ev) {
    if (ev.key === 'Enter') doSearch();
  });
  function showCreateForm() {
    togglePanel(true);
    var formHtml = ''
      + '<div class="userdict-form-wrapper">'
      + '  <h4 style="margin:0 0 8px 0;font-size:13px;font-weight:600;">Create custom dictionary entry</h4>'
      + '  <form id="userdict-form" class="userdict-form">'
      + '    <div class="userdict-field">'
      + '      <label for="userdict-head">Headword *</label>'
      + '      <input type="text" id="userdict-head" required>'
      + '    </div>'
      + '    <div class="userdict-field">'
      + '      <label for="userdict-pron">Pronunciation</label>'
      + '      <input type="text" id="userdict-pron">'
      + '    </div>'
      + '    <div class="userdict-field">'
      + '      <label for="userdict-pos">Part of speech</label>'
      + '      <input type="text" id="userdict-pos">'
      + '    </div>'
      + '    <div class="userdict-field">'
      + '      <label for="userdict-gloss">Gloss</label>'
      + '      <textarea id="userdict-gloss" rows="3"></textarea>'
      + '    </div>'
      + '    <div class="userdict-actions">'
      + '      <button type="submit" id="userdict-save-btn">Save</button>'
      + '    </div>'
      + '  </form>'
      + '  <div class="userdict-rule-sep"></div>'
      + '  <h4 style="margin:12px 0 8px 0;font-size:13px;font-weight:600;">Create custom rule</h4>'
      + '  <form id="userdict-rule-form" class="userdict-form">'
      + '    <div class="userdict-field">'
      + '      <label for="userdict-rule-head">Headword *</label>'
      + '      <input type="text" id="userdict-rule-head" required>'
      + '    </div>'
      + '    <div class="userdict-field">'
      + '      <label for="userdict-rule-correct">Correct headword</label>'
      + '      <input type="text" id="userdict-rule-correct">'
      + '    </div>'
      + '    <div class="userdict-actions">'
      + '      <button type="submit" id="userdict-rule-save-btn">Save</button>'
      + '    </div>'
      + '  </form>'
      + '</div>';
    panelContent.innerHTML = formHtml;
    var headInput = document.getElementById('userdict-head');
    var pronInput = document.getElementById('userdict-pron');
    var posInput  = document.getElementById('userdict-pos');
    var glossInput = document.getElementById('userdict-gloss');
    var formEl = document.getElementById('userdict-form');
    var ruleHeadInput = document.getElementById('userdict-rule-head');
    var ruleCorrectInput = document.getElementById('userdict-rule-correct');
    var ruleFormEl = document.getElementById('userdict-rule-form');
    headInput.focus();
    formEl.addEventListener('submit', function(ev) {
      ev.preventDefault();
      var head = (headInput.value || '').trim();
      var gloss = (glossInput.value || '').trim();
      if (!head) {
        alert('Headword is required.');
        return;
      }
      var payload = {
        headword: head,
        romanization: (pronInput.value || '').trim(),
        pos: (posInput.value || '').trim(),
        definition: gloss
      };
      var saveBtn = document.getElementById('userdict-save-btn');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
      }
      fetch('/api/user_dict/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        if (!data || !data.ok) {
          var msg = (data && data.error) ? data.error : 'Failed to save entry.';
          alert(msg);
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
          }
          return;
        }
        lookupAndDisplay(head);
      })
      .catch(function(err) {
        console.error('Error saving user dict entry:', err);
        alert('Error saving entry.');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
        }
      });
    });
    ruleFormEl.addEventListener('submit', function(ev) {
      ev.preventDefault();
      var head = (ruleHeadInput.value || '').trim();
      var corrected = (ruleCorrectInput.value || '').trim();
      if (!head || !corrected) {
        alert('Headword and correct headword are required.');
        return;
      }
      var saveBtn = document.getElementById('userdict-rule-save-btn');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
      }
      fetch('/api/text_override/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: head, normalized: corrected })
      })
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        if (!data || !data.ok) {
          var msg = (data && data.error) ? data.error : 'Failed to save rule.';
          alert(msg);
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
          }
          return;
        }
        lookupAndDisplay(corrected);
      })
      .catch(function(err) {
        console.error('Error saving rule:', err);
        alert('Error saving rule.');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
        }
      });
    });
  }

  var customEntriesCache = [];
  var customEntriesFilter = 'all';

  function showCustomEntries() {
    togglePanel(true);
    var html = ''
      + '<div class="userdict-list">'
      + '  <div class="userdict-list-header">'
      + '    <div style="font-size:13px;font-weight:600;">Custom Entries</div>'
      + '    <div class="userdict-list-controls">'
      + '      <select id="userdict-filter" class="userdict-filter">'
      + '        <option value="all">All</option>'
      + '        <option value="dict">Dictionary entries</option>'
      + '        <option value="rule">Normalization rules</option>'
      + '      </select>'
      + '    </div>'
      + '  </div>'
      + '  <div class="userdict-list-body" id="userdict-list-body"></div>'
      + '</div>';
    panelContent.innerHTML = html;
    var filterEl = document.getElementById('userdict-filter');
    if (filterEl) {
      filterEl.value = customEntriesFilter;
      filterEl.addEventListener('change', function() {
        customEntriesFilter = this.value;
        renderCustomEntries();
      });
    }
    loadCustomEntries();
  }

  function loadCustomEntries() {
    var body = document.getElementById('userdict-list-body');
    if (body) {
      body.innerHTML = '<div class="userdict-empty">Loading...</div>';
    }
    fetch('/api/custom_entries/list')
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        if (!data || !data.ok) {
          if (body) {
            body.innerHTML = '<div class="userdict-empty">Failed to load entries.</div>';
          }
          return;
        }
        customEntriesCache = Array.isArray(data.entries) ? data.entries : [];
        renderCustomEntries();
      })
      .catch(function(err) {
        console.error('Failed to load custom entries:', err);
        if (body) {
          body.innerHTML = '<div class="userdict-empty">Failed to load entries.</div>';
        }
      });
  }

  function renderCustomEntries() {
    var body = document.getElementById('userdict-list-body');
    if (!body) return;
    var list = customEntriesCache.filter(function(entry) {
      if (customEntriesFilter === 'all') return true;
      return entry.type === customEntriesFilter;
    });
    if (!list.length) {
      body.innerHTML = '<div class="userdict-empty">No entries found.</div>';
      return;
    }
    var html = '';
    list.forEach(function(entry) {
      if (entry.type === 'dict') {
        html += ''
          + '<div class="userdict-item" data-type="dict" data-id="' + entry.id + '">'
          + '  <div class="userdict-item-header">'
          + '    <div class="userdict-item-title">Dictionary entry</div>'
          + '    <div class="userdict-item-actions">'
          + '      <button type="button" class="userdict-edit-btn">Edit</button>'
          + '      <button type="button" class="userdict-save-btn" style="display:none;">Save</button>'
          + '      <button type="button" class="userdict-cancel-btn" style="display:none;">Cancel</button>'
          + '      <button type="button" class="userdict-delete-btn danger">Delete</button>'
          + '    </div>'
          + '  </div>'
          + '  <div class="userdict-fields">'
          + '    <label>Headword</label>'
          + '    <input type="text" class="userdict-input" data-field="headword" value="' + escapeHtml(entry.headword || '') + '" disabled>'
          + '    <label>Pronunciation</label>'
          + '    <input type="text" class="userdict-input" data-field="romanization" value="' + escapeHtml(entry.romanization || '') + '" disabled>'
          + '    <label>POS</label>'
          + '    <input type="text" class="userdict-input" data-field="pos" value="' + escapeHtml(entry.pos || '') + '" disabled>'
          + '    <label>Definition</label>'
          + '    <textarea class="userdict-input userdict-textarea" data-field="definition" rows="2" disabled>' + escapeHtml(entry.definition || '') + '</textarea>'
          + '  </div>'
          + '</div>';
      } else if (entry.type === 'rule') {
        html += ''
          + '<div class="userdict-item" data-type="rule" data-id="' + entry.id + '">'
          + '  <div class="userdict-item-header">'
          + '    <div class="userdict-item-title">Normalization rule</div>'
          + '    <div class="userdict-item-actions">'
          + '      <button type="button" class="userdict-edit-btn">Edit</button>'
          + '      <button type="button" class="userdict-save-btn" style="display:none;">Save</button>'
          + '      <button type="button" class="userdict-cancel-btn" style="display:none;">Cancel</button>'
          + '      <button type="button" class="userdict-delete-btn danger">Delete</button>'
          + '    </div>'
          + '  </div>'
          + '  <div class="userdict-fields">'
          + '    <label>Raw</label>'
          + '    <input type="text" class="userdict-input" data-field="raw" value="' + escapeHtml(entry.raw || '') + '" disabled>'
          + '    <label>Normalized</label>'
          + '    <input type="text" class="userdict-input" data-field="normalized" value="' + escapeHtml(entry.normalized || '') + '" disabled>'
          + '  </div>'
          + '</div>';
      }
    });
    body.innerHTML = html;
    bindCustomEntryActions(body);
  }

  function setCustomEntryEditing(item, editing) {
    var inputs = item.querySelectorAll('.userdict-input');
    inputs.forEach(function(input) {
      input.disabled = !editing;
    });
    var editBtn = item.querySelector('.userdict-edit-btn');
    var saveBtn = item.querySelector('.userdict-save-btn');
    var cancelBtn = item.querySelector('.userdict-cancel-btn');
    if (editBtn) editBtn.style.display = editing ? 'none' : 'inline-block';
    if (saveBtn) saveBtn.style.display = editing ? 'inline-block' : 'none';
    if (cancelBtn) cancelBtn.style.display = editing ? 'inline-block' : 'none';
  }

  function bindCustomEntryActions(container) {
    var items = container.querySelectorAll('.userdict-item');
    items.forEach(function(item) {
      var inputs = item.querySelectorAll('.userdict-input');
      inputs.forEach(function(input) {
        if (input.dataset.orig === undefined) {
          input.dataset.orig = input.value || '';
        }
      });
      var editBtn = item.querySelector('.userdict-edit-btn');
      var saveBtn = item.querySelector('.userdict-save-btn');
      var cancelBtn = item.querySelector('.userdict-cancel-btn');
      var deleteBtn = item.querySelector('.userdict-delete-btn');
      var entryType = item.getAttribute('data-type');
      var entryId = parseInt(item.getAttribute('data-id') || '-1', 10);

      if (editBtn) {
        editBtn.addEventListener('click', function() {
          setCustomEntryEditing(item, true);
        });
      }
      if (cancelBtn) {
        cancelBtn.addEventListener('click', function() {
          inputs.forEach(function(input) {
            input.value = input.dataset.orig || '';
          });
          setCustomEntryEditing(item, false);
        });
      }
      if (saveBtn) {
        saveBtn.addEventListener('click', function() {
          var payload = { id: entryId };
          if (entryType === 'dict') {
            inputs.forEach(function(input) {
              payload[input.dataset.field] = (input.value || '').trim();
            });
            fetch('/api/user_dict/update', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            })
            .then(function(resp) { return resp.json(); })
            .then(function(data) {
              if (!data || !data.ok) {
                alert((data && data.error) ? data.error : 'Failed to update entry.');
                return;
              }
              loadCustomEntries();
            })
            .catch(function(err) {
              console.error('Failed to update entry:', err);
              alert('Failed to update entry.');
            });
          } else if (entryType === 'rule') {
            inputs.forEach(function(input) {
              payload[input.dataset.field] = (input.value || '').trim();
            });
            fetch('/api/text_override/update', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            })
            .then(function(resp) { return resp.json(); })
            .then(function(data) {
              if (!data || !data.ok) {
                alert((data && data.error) ? data.error : 'Failed to update rule.');
                return;
              }
              loadCustomEntries();
            })
            .catch(function(err) {
              console.error('Failed to update rule:', err);
              alert('Failed to update rule.');
            });
          }
        });
      }
      if (deleteBtn) {
        deleteBtn.addEventListener('click', function() {
          var label = entryType === 'dict' ? 'dictionary entry' : 'normalization rule';
          if (!confirm('Delete this ' + label + '?')) return;
          var url = entryType === 'dict' ? '/api/user_dict/delete' : '/api/text_override/delete';
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: entryId })
          })
          .then(function(resp) { return resp.json(); })
          .then(function(data) {
            if (!data || !data.ok) {
              alert((data && data.error) ? data.error : 'Failed to delete entry.');
              return;
            }
            loadCustomEntries();
          })
          .catch(function(err) {
            console.error('Failed to delete entry:', err);
            alert('Failed to delete entry.');
          });
        });
      }
    });
  }
  if (createBtn) {
    createBtn.addEventListener('click', function() {
      // Blank form as requested
      showCreateForm();
    });
  }
  if (viewBtn) {
    viewBtn.addEventListener('click', function() {
      showCustomEntries();
    });
  }
  // File handling
  function setLoadedFileName(name) {
    if (!fileNamePill || !fileNameText) return;
    var label = (name || '').toString();
    if (!label) {
      fileNamePill.style.display = 'none';
      fileNameText.textContent = '';
      return;
    }
    fileNameText.textContent = label;
    fileNamePill.style.display = 'inline-flex';
  }

  function clearLoadedFile() {
    cancelMovementLookupTimer();
    pdfJsSessionId += 1;
    pdfJsIframe = null;
    // Evict server-side PDF cache
    if (pdfCacheId) {
      fetch('/api/close_pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cache_id: pdfCacheId })
      }).catch(function() {});
    }
    // Destroy PDF.js document
    if (pdfOriginal.doc) {
      pdfOriginal.doc.destroy();
      pdfOriginal.doc = null;
    }
    pdfOriginal.fileToken = null;
    pdfOriginal.docPromise = null;
    // Reset DOCX original-view cache/cancellation state.
    docxOriginal.renderSeq += 1;
    docxOriginal.buf = null;
    docxOriginal.fileToken = null;
    docxOriginal.rendered = false;
    // Clean up observer
    if (pdfJsObserver) {
      pdfJsObserver.disconnect();
      pdfJsObserver = null;
    }
    pdfJsRenderedPages = {};

    inputMode = 'raw';
    docText = '';
    docPagerIsPaged = false;
    docPages = [];
    activePageIndex = 0;
    lastLookupPageIndex = -1;
    pendingPdfLookupPageIndex = -1;
    pageLookupTextByIndex = {};
    hideRawTextPill();
    // Reset original view state
    currentFile = null;
    currentFileType = null;
    pdfCacheId = null;
    pdfPageDimensions = [];
    pdfAveragePageDimensions = null;
    isOriginalView = false;
    originalLayoutCache = {};
    pdfRawTextCache = {};
    if (origViewToggle) origViewToggle.style.display = 'none';
    if (origViewCheckbox) origViewCheckbox.checked = false;

    if (sourcePager) {
      sourcePager.classList.remove('orig-view-mode');
      sourcePager.classList.remove('pdfjs-native-mode');
      sourcePager.style.display = 'none';
      sourcePager.innerHTML = '';
    }
    if (sourceText) {
      sourceText.style.display = '';
      sourceText.value = '';
    }
    if (fileNamePill) fileNamePill.style.display = 'none';
    if (fileNameText) fileNameText.textContent = '';
    if (rawTextPill) rawTextPill.style.display = 'none';
    if (rawTextText) rawTextText.textContent = '';
    if (fileInput) fileInput.value = '';
    if (renderedText) {
      renderedText.innerHTML = '';
    }
    if (statusText) statusText.textContent = 'Ready.';
    if (statusCounts) statusCounts.textContent = '';
    applyGlobalViewportClamp(true);
    updateRenderedOutputBackground();
  }

  if (clearFileBtn) {
    clearFileBtn.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      clearLoadedFile();
    });
  }

  if (clearRawTextBtn) {
    clearRawTextBtn.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      clearLoadedFile();
    });
  }

  fileButton.addEventListener('click', function() { fileInput.click(); });
  fileInput.addEventListener('change', function(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (file) loadFile(file);
  });
  function loadFile(file) {
    if (!file) return;
    cancelMovementLookupTimer();
    pdfJsSessionId += 1;
    pdfJsIframe = null;
    setLoadedFileName(file.name || 'document');
    var name = (file.name || '').toLowerCase();

    // Clean up previous PDF.js state
    hideRawTextPill();
    if (pdfCacheId) {
      fetch('/api/close_pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cache_id: pdfCacheId })
      }).catch(function() {});
    }
    if (pdfOriginal.doc) {
      pdfOriginal.doc.destroy();
      pdfOriginal.doc = null;
    }
    if (pdfJsObserver) {
      pdfJsObserver.disconnect();
      pdfJsObserver = null;
    }
    // Invalidate DOCX original-view state from the previous file.
    docxOriginal.renderSeq += 1;
    docxOriginal.buf = null;
    docxOriginal.fileToken = null;
    docxOriginal.rendered = false;
    pdfJsRenderedPages = {};
    currentFile = file;
    pdfCacheId = null;
    pdfPageDimensions = [];
    pdfAveragePageDimensions = null;
    isOriginalView = false;
    originalLayoutCache = {};
    pdfRawTextCache = {};
    activePageIndex = 0;
    lastLookupPageIndex = -1;
    pendingPdfLookupPageIndex = -1;
    pageLookupTextByIndex = {};
    if (origViewCheckbox) origViewCheckbox.checked = false;
    if (sourcePager) {
      sourcePager.classList.remove('orig-view-mode');
      sourcePager.classList.remove('pdfjs-native-mode');
    }

    if (name.endsWith('.pdf')) {
      currentFileType = 'pdf';
      if (origViewToggle) origViewToggle.style.display = 'inline-flex';
      loadBinaryDocument(file);
      return;
    }
    if (name.endsWith('.docx')) {
      currentFileType = 'docx';
      // DOCX original view now supported - show toggle
      if (origViewToggle) origViewToggle.style.display = 'inline-flex';
      loadBinaryDocumentSimplified(file);  // Use simplified extraction
      return;
    }

    // Text file - no original view
    currentFileType = 'text';
    if (origViewToggle) origViewToggle.style.display = 'none';

    // Text file - load directly into doc mode
    var reader = new FileReader();
    reader.onload = function(e) {
      var text = (e && e.target && e.target.result) ? e.target.result : '';
      text = text || '';
      if (sourceText) sourceText.value = text;
      loadTextAsDoc(text);
    };
    reader.readAsText(file, 'utf-8');
  }

  // Simplified extraction for .txt and .docx (500-word pagination)
  function loadBinaryDocumentSimplified(file) {
    statusText.textContent = 'Extracting text...';
    statusCounts.textContent = '';
    var fd = new FormData();
    fd.append('file', file, file.name || 'document');
    fetch('/api/extract_text_simple', { method: 'POST', body: fd })
      .then(function(resp) {
        if (!resp.ok) {
          // Try to get error details from response
          return resp.json().catch(function() { return {}; }).then(function(data) {
            var errMsg = (data && data.error) ? data.error : 'HTTP ' + resp.status;
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
      .then(function(data) {
        if (!data || !data.ok) {
          statusText.textContent = 'Extraction failed.';
          var errDetail = (data && data.error) ? data.error : 'unknown';
          if (errDetail.indexOf('not installed') >= 0) {
            errDetail += ' - Install with: pip install pypdf python-docx';
          }
          renderedText.innerHTML = '<div class="reader-output-placeholder">Error: ' + escapeHtml(errDetail) + '</div>';
          return;
        }
        var fullText = (data.text || '').toString();
        // Keep DOCX preview page-blind (continuous flow, no page metadata usage).
        if (currentFileType === 'docx') {
          docPages = [];
        } else {
          docPages = Array.isArray(data.pages) ? data.pages : [];
        }
        if (sourceText) sourceText.value = fullText;
        setDocMode(fullText);
        if (currentFileType === 'docx') {
          statusText.textContent = 'Ready.';
          // Auto-enable original view for DOCX
          if (origViewCheckbox && !origViewCheckbox.checked) {
            origViewCheckbox.checked = true;
            origViewCheckbox.dispatchEvent(new Event('change'));
          }
        } else if (docPages.length) {
          statusText.textContent = 'Ready (' + docPages.length + ' pages).';
        }
      })
      .catch(function(err) {
        console.error(err);
        statusText.textContent = 'Extraction failed.';
        renderedText.innerHTML = '<div class="reader-output-placeholder">Could not extract text from file.</div>';
      });
  }

  // PDF extraction - use full extract_text endpoint
  function loadBinaryDocument(file) {
    statusText.textContent = 'Extracting text...';
    statusCounts.textContent = '';
    var fd = new FormData();
    fd.append('file', file, file.name || 'document.pdf');
    fetch('/api/extract_text', { method: 'POST', body: fd })
      .then(function(resp) {
        if (!resp.ok) {
          return resp.json().catch(function() { return {}; }).then(function(data) {
            var errMsg = (data && data.error) ? data.error : 'HTTP ' + resp.status;
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
      .then(function(data) {
        if (!data || !data.ok) {
          statusText.textContent = 'Extraction failed.';
          var errDetail = (data && data.error) ? data.error : 'unknown';
          if (errDetail.indexOf('not installed') >= 0) {
            errDetail += ' - Install with: pip install pypdf';
          }
          renderedText.innerHTML = '<div class="reader-output-placeholder">Error: ' + escapeHtml(errDetail) + '</div>';
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
        currentFile = file;
        // Capture server-side PDF cache ID (avoids re-uploading for page rendering)
        pdfCacheId = meta.pdf_cache_id || null;
        pdfPageDimensions = sanitizePdfDimensionList(meta.pdf_page_dimensions);
        pdfAveragePageDimensions = sanitizePdfDimension(meta.pdf_average_page_dimensions) || computeAveragePdfDimension(pdfPageDimensions);
        if (sourceText) sourceText.value = fullText;
        // Default PDFs to original-view lookup mode before the first triggerUpdate call.
        if (origViewCheckbox) origViewCheckbox.checked = true;
        isOriginalView = !!(origViewCheckbox && origViewCheckbox.checked);
        setPagedMode(pages);
        statusText.textContent = 'Ready (' + pages.length + ' pages).';
      })
      .catch(function(err) {
        console.error(err);
        statusText.textContent = 'Extraction failed.';
        renderedText.innerHTML = '<div class="reader-output-placeholder">Could not extract PDF: ' + escapeHtml(err.message || 'unknown error') + '</div>';
      });
  }

  // Load text into document mode (no server call needed)
  function loadTextAsDoc(text) {
    if (origViewToggle) origViewToggle.style.display = 'none';
    if (origViewCheckbox) origViewCheckbox.checked = false;
    currentFile = null;
    currentFileType = 'text';
    pdfCacheId = null;
    pdfPageDimensions = [];
    pdfAveragePageDimensions = null;
    isOriginalView = false;
    originalLayoutCache = {};
    pdfRawTextCache = {};
    if (sourceText) sourceText.value = text || '';
    setDocMode(text || '');
  }
  dropZone.addEventListener('dragover', function(ev) { ev.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', function(ev) {
    if (ev.target === dropZone || !dropZone.contains(ev.relatedTarget)) dropZone.classList.remove('drag-over');
  });
  dropZone.addEventListener('drop', function(ev) {
    ev.preventDefault();
    dropZone.classList.remove('drag-over');
    var dt = ev.dataTransfer;
    if (dt && dt.files && dt.files.length) loadFile(dt.files[0]);
  });
  // ===================== ORIGINAL VIEW MODE =====================

  // Toggle between layout-aware and raw text for segmentation
  if (origViewCheckbox) {
    origViewCheckbox.addEventListener('change', function() {
      isOriginalView = origViewCheckbox.checked;
      if (inputMode === 'pdf') {
        // PDF mode: toggle only changes which text is sent for segmentation
        // PDF.js viewer stays visible regardless
        pageLookupTextByIndex = {};
        originalLayoutCache = {};
    pdfRawTextCache = {};
        lastLookupPageIndex = -1;
        pendingPdfLookupPageIndex = -1;
        latestSeq += 1;
        triggerUpdate();
      } else if (currentFileType === 'docx') {
        // DOCX original view handling
        if (sourcePager) {
          if (isOriginalView) {
            sourcePager.classList.add('orig-view-mode');
          } else {
            sourcePager.classList.remove('orig-view-mode');
          }
        }
        if (isOriginalView && currentFile) {
          latestSeq += 1;
          statusText.textContent = 'Loading DOCX layout...';
          statusCounts.textContent = '';

          var mySeq = ++docxOriginal.renderSeq;
          var fileForRender = currentFile;
          var fileToken = getDocxFileToken(fileForRender);

          Promise.resolve()
            .then(function() {
              if (!fileForRender) return;
              if (docxOriginal.buf && docxOriginal.fileToken === fileToken) return;
              return fileForRender.arrayBuffer().then(function(buf) {
                if (mySeq !== docxOriginal.renderSeq) return;
                docxOriginal.buf = buf;
                docxOriginal.fileToken = fileToken;
              });
            })
            .then(function() { return ensureDocxPreviewLoaded(); })
            .then(function() {
              if (mySeq !== docxOriginal.renderSeq) return;
              inputMode = 'doc';
              if (sourceText) sourceText.style.display = 'none';
              if (sourcePager) {
                sourcePager.style.display = 'block';
                sourcePager.classList.add('orig-view-mode');
              }
              return renderDocxPreviewInto(sourcePager, docxOriginal.buf);
            })
            .then(function() {
              if (mySeq !== docxOriginal.renderSeq) return;
              docxOriginal.rendered = true;
              statusText.textContent = 'Ready.';
              triggerUpdate();
            })
            .catch(function(err) {
              console.error(err);
              statusText.textContent = 'DOCX layout failed.';
              renderedText.innerHTML = '<div class="reader-output-placeholder">DOCX preview failed to load.</div>';
            });
        } else {
          // Leaving DOCX original view
          pageLookupTextByIndex = {};
          docxOriginal.renderSeq += 1;
          docxOriginal.rendered = false;
          if (sourcePager) sourcePager.innerHTML = '';
          setDocMode(docText || (sourceText ? (sourceText.value || '') : ''));
          return;
        }
      } else {
        // Other modes
        pageLookupTextByIndex = {};
        updateRenderedOutputBackground();
        triggerUpdate();
      }
    });
  }

  // Build layout text from PDF word list
  function shouldInsertSpace(word, wi) {
    if (wi <= 0) return false;
    if (word && typeof word.space_before === 'boolean') return word.space_before;
    return true;
  }

  function buildLayoutTextFromWords(pageData) {
    // If we have structured_blocks, use them for proper document structure
    var blocks = Array.isArray(pageData.structured_blocks) ? pageData.structured_blocks : null;
    var words = Array.isArray(pageData.words) ? pageData.words : [];
    
    if (blocks && blocks.length > 0) {
      // Sort blocks by Y position (min_y) for proper vertical ordering
      var sortedBlocks = blocks.slice().sort(function(a, b) {
        return (a.min_y || 0) - (b.min_y || 0);
      });
      
      var text = '';
      for (var bi = 0; bi < sortedBlocks.length; bi++) {
        if (bi > 0) text += '\n\n';  // Paragraph break between blocks
        var block = sortedBlocks[bi];
        var lines = block.lines || [];
        for (var li = 0; li < lines.length; li++) {
          if (li > 0) text += '\n';  // Line break within block
          var lineWords = lines[li].words || [];
          // Sort words by X within line
          var sortedWords = lineWords.slice().sort(function(a, b) {
            return (a.x || 0) - (b.x || 0);
          });
          for (var wi = 0; wi < sortedWords.length; wi++) {
            var w = sortedWords[wi];
            if (!w || !w.text) continue;
            if (shouldInsertSpace(w, wi)) text += ' ';
            text += w.text;
          }
        }
      }
      return text;
    }
    
    // Fallback: group words by Y, sort by X within each line
    if (!words.length) return '';
    
    // Compute median height for line detection
    var medianH = 12;
    var allHeights = [];
    for (var wi = 0; wi < words.length; wi++) {
      if (words[wi] && words[wi].h > 0) allHeights.push(words[wi].h);
    }
    if (allHeights.length) {
      allHeights.sort(function(a,b){ return a - b; });
      var mid = Math.floor(allHeights.length / 2);
      medianH = allHeights.length % 2 ? allHeights[mid] : (allHeights[mid-1] + allHeights[mid]) / 2;
    }
    
    // Group words into lines by Y
    var lineGroups = [];
    var currentLineY = -999;
    var currentLineWords = [];
    
    for (var wi = 0; wi < words.length; wi++) {
      var w = words[wi];
      if (!w || !w.text) continue;
      
      var y = (typeof w.y === 'number') ? w.y : 0;
      var h = (typeof w.h === 'number' && w.h > 0) ? w.h : medianH;
      
      if (currentLineY >= 0 && Math.abs(y - currentLineY) > h * 0.5) {
        if (currentLineWords.length > 0) {
          lineGroups.push({ y: currentLineY, words: currentLineWords });
        }
        currentLineWords = [];
      }
      
      currentLineWords.push(w);
      currentLineY = y;
    }
    if (currentLineWords.length > 0) {
      lineGroups.push({ y: currentLineY, words: currentLineWords });
    }
    
    // Sort lines by Y
    lineGroups.sort(function(a, b) { return a.y - b.y; });
    
    // Build text: lines separated by \n, words sorted by X and separated by space
    var text = '';
    for (var li = 0; li < lineGroups.length; li++) {
      if (li > 0) text += '\n';
      var lineWords = lineGroups[li].words;
      // Sort words by X within line
      lineWords.sort(function(a, b) { return (a.x || 0) - (b.x || 0); });
      for (var wi = 0; wi < lineWords.length; wi++) {
        var w = lineWords[wi];
        if (!w || !w.text) continue;
        if (shouldInsertSpace(w, wi)) text += ' ';
        text += w.text;
      }
    }
    return text;
  }

  function getLayoutTextForPage(pageIdx, fallbackText) {
    if (!isOriginalView) return fallbackText;
    if (originalLayoutCache[pageIdx]) return originalLayoutCache[pageIdx];
    return fallbackText;
  }

  function getLookupTextForPage(pageIdx) {
    if (pageLookupTextByIndex && pageLookupTextByIndex[pageIdx] != null) {
      return pageLookupTextByIndex[pageIdx];
    }
    if (pdfRawTextCache && pdfRawTextCache[pageIdx] != null) {
      return String(pdfRawTextCache[pageIdx] || '').trim();
    }
    var raw = (docPages && docPages[pageIdx] != null) ? String(docPages[pageIdx]) : '';
    return (raw || '').trim();
  }

  function buildWordOffsets(pageText, words) {
    if (!pageText || !words || !words.length) return [];
    var offsets = new Array(words.length);
    var cursor = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var wtext = (w && w.text != null) ? String(w.text) : '';
      if (!wtext) {
        offsets[i] = null;
        continue;
      }
      var idx = pageText.indexOf(wtext, cursor);
      if (idx < 0 && wtext.indexOf('\u00a0') >= 0) {
        var norm = wtext.replace(/\u00a0/g, ' ');
        idx = pageText.indexOf(norm, cursor);
        if (idx >= 0) wtext = norm;
      }
      if (idx < 0) {
        offsets[i] = null;
        continue;
      }
      offsets[i] = [idx, idx + wtext.length];
      cursor = idx + wtext.length;
    }
    return offsets;
  }

  // Show dict panel for segment
  function showDictPanelForSegment(segIdx) {
    if (!latestSegments) return;
    var seg = latestSegments[segIdx];
    if (!seg) return;
    if (dictSearch) dictSearch.value = seg;
    if (!panelOpen && panelToggle) panelToggle.click();
    if (searchBtn) searchBtn.click();
  }

  // POS colors for JavaScript (mirror of Python POS_COLORS)
  var POS_COLORS_JS = {
    'n': '#bbf7d0', 'v': '#fda4af', 'adj': '#fde68a', 'adv': '#fee2e2',
    'part': '#e0e7ff', 'conj': '#cffafe', 'pron': '#e2e8f0', 'num': '#f5d0fe',
    'int': '#fcd34d', 'post': '#bae6fd', 'punct': '#e5e7eb', 'fw': '#d1d5db',
    'afx': '#fef3c7', 'ono': '#ddd6fe', 'unk': '#f3f4f6'
  };

  // Update rendered output area with PDF page background when in original mode
  function updateRenderedOutputBackground() {
    if (!renderedText) return;
    renderedText.classList.remove('orig-view-bg');
    renderedText.style.backgroundImage = '';
  }

  var rawMeasureEl = null;

  function ensureRawMeasureEl() {
    if (rawMeasureEl) return rawMeasureEl;
    rawMeasureEl = document.createElement('div');
    rawMeasureEl.style.position = 'absolute';
    rawMeasureEl.style.visibility = 'hidden';
    rawMeasureEl.style.left = '-9999px';
    rawMeasureEl.style.top = '0';
    rawMeasureEl.style.whiteSpace = 'pre-wrap';
    rawMeasureEl.style.wordWrap = 'break-word';
    rawMeasureEl.style.overflowWrap = 'break-word';
    rawMeasureEl.style.boxSizing = 'border-box';
    rawMeasureEl.style.border = '0';
    rawMeasureEl.style.margin = '0';
    rawMeasureEl.style.padding = '0';
    rawMeasureEl.style.height = 'auto';
    rawMeasureEl.style.minHeight = '0';
    rawMeasureEl.style.maxHeight = 'none';
    document.body.appendChild(rawMeasureEl);
    return rawMeasureEl;
  }

  function getRawTextMetrics() {
    if (!sourceText) return null;
    var cs = window.getComputedStyle(sourceText);
    var fontSize = parseFloat(cs.fontSize) || 16;
    var lineHeight = parseFloat(cs.lineHeight);
    if (!isFinite(lineHeight)) lineHeight = fontSize * 1.6;
    return {
      font: cs.font,
      lineHeight: lineHeight,
      paddingTop: parseFloat(cs.paddingTop) || 0,
      paddingBottom: parseFloat(cs.paddingBottom) || 0,
      paddingLeft: parseFloat(cs.paddingLeft) || 0,
      paddingRight: parseFloat(cs.paddingRight) || 0,
      width: sourceText.clientWidth || sourceText.getBoundingClientRect().width || 0,
      letterSpacing: cs.letterSpacing,
      wordSpacing: cs.wordSpacing
    };
  }

  function getRawMaxHeightPx() {
    var metrics = getRawTextMetrics();
    if (!metrics) return 0;
    return Math.ceil(DOC_LINES_CONTENT * metrics.lineHeight);
  }

  function getRawMinHeightPx() {
    var metrics = getRawTextMetrics();
    if (!metrics) return 0;
    return Math.ceil(DOC_LINES_EMPTY * metrics.lineHeight);
  }

  function measureRawTextHeight(text, metrics) {
    if (!sourceText) return 0;
    var info = metrics || getRawTextMetrics();
    if (!info || !info.width) return 0;
    var measurer = ensureRawMeasureEl();
    measurer.style.width = Math.max(0, info.width) + 'px';
    measurer.style.font = info.font;
    measurer.style.lineHeight = info.lineHeight + 'px';
    measurer.style.letterSpacing = info.letterSpacing || 'normal';
    measurer.style.wordSpacing = info.wordSpacing || 'normal';
    measurer.style.paddingTop = info.paddingTop + 'px';
    measurer.style.paddingBottom = info.paddingBottom + 'px';
    measurer.style.paddingLeft = info.paddingLeft + 'px';
    measurer.style.paddingRight = info.paddingRight + 'px';
    var normalized = (text || '').replace(/\r\n/g, '\n');
    if (normalized && normalized.charAt(normalized.length - 1) === '\n') {
      normalized += ' ';
    }
    measurer.textContent = normalized;
    return measurer.scrollHeight || measurer.getBoundingClientRect().height || 0;
  }

  function findRawOverflowIndex(text) {
    var normalized = (text || '').replace(/\r\n/g, '\n');
    if (!normalized) return -1;
    var metrics = getRawTextMetrics();
    if (!metrics || !metrics.width) return -1;
    var maxHeight = Math.ceil(DOC_LINES_CONTENT * metrics.lineHeight);
    if (!maxHeight) return -1;
    var fullHeight = measureRawTextHeight(normalized, metrics);
    if (fullHeight <= maxHeight) return -1;
    var lo = 0;
    var hi = normalized.length;
    var result = hi;
    while (lo < hi) {
      var mid = Math.floor((lo + hi) / 2);
      var sample = normalized.slice(0, mid);
      var h = measureRawTextHeight(sample, metrics);
      if (h > maxHeight) {
        result = mid;
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    return result;
  }

  function autoResizeTextarea() {
    if (!sourceText || inputMode !== 'raw') return;
    var maxHeight = getRawMaxHeightPx();
    var minHeight = Math.max(180, getRawMinHeightPx());
    if (maxHeight > 0) minHeight = Math.min(minHeight, maxHeight);
    // Collapse to 1px to get true content height
    sourceText.style.height = '1px';
    var scrollH = sourceText.scrollHeight;
    // Set height between min and max
    var newHeight = Math.max(minHeight, Math.min(scrollH, maxHeight));
    sourceText.style.height = newHeight + 'px';
    if (maxHeight > 0 && scrollH > (maxHeight + 1)) {
      sourceText.style.overflowY = 'auto';
    } else {
      sourceText.style.overflowY = 'hidden';
    }
  }

  // Keep guidance visible on click/focus; clear only when user starts editing.
  sourceText.addEventListener('beforeinput', function() {
    if (!isShowingInitialInputGuidance()) return;
    clearInitialInputGuidanceIfNeeded();
    autoResizeTextarea();
  });

  sourceText.addEventListener('input', function() {
    if (initialInputGuidanceActive) initialInputGuidanceActive = false;
    if (inputMode !== 'raw') setRawMode();
    autoResizeTextarea();
    applyGlobalViewportClamp(false);
    triggerUpdate();
  });

  function docxOriginalLookupNow() {
    if (!docxOriginal.rendered) {
      statusText.textContent = 'Loading DOCX layout...';
      statusCounts.textContent = '';
      return;
    }

    var sliceInfo = getVisibleDocxSliceText(sourcePager);
    var sliceText = (sliceInfo && sliceInfo.text) ? sliceInfo.text : '';
    var sliceFragInfo = buildVisibleDocxSliceFragment(sliceInfo);
    var sliceRoot = sliceFragInfo ? sliceFragInfo.sliceRoot : null;

    if (!sliceText || !sliceRoot) {
      renderedText.innerHTML = '';
      statusText.textContent = 'Ready.';
      statusCounts.textContent = '';
      if (!depTreeUseConllu && depTreeController && typeof depTreeController.setData === 'function') {
        depTreeController.setData({ segments: [], udOverlay: null });
      }
      return;
    }

    var seqDocx = ++latestSeq;
    statusText.textContent = 'Segmenting...';
    statusCounts.textContent = '';

    if (renderedText) {
      renderedText.classList.remove('plain-text-mode', 'docx-original-view', 'orig-view-structured');
    }
    renderedText.innerHTML = '';
    renderedText.appendChild(sliceRoot);

    startSegmentLookupFetch(buildLookupUrl(sliceText))
      .then(function(resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.json(); })
      .then(function(data) {
        if (seqDocx !== latestSeq) return;
        if (!data || !data.ok) {
          statusText.textContent = 'Error from server.';
          renderedText.innerHTML = '<div class="reader-output-placeholder">Error: ' + escapeHtml(data && data.error ? data.error : 'unknown') + '</div>';
          return;
        }

        // Adopt lookup payload and map offsets onto the cloned visible slice DOM.
        latestData = data;
        var segments = Array.isArray(data.segments) ? data.segments : [];
        var gramOverlay = data.grammar_overlay && Array.isArray(data.grammar_overlay.tokens) ? data.grammar_overlay.tokens : [];
        var resultsBySeg = Array.isArray(data.results_by_seg) ? data.results_by_seg : [];

        setLatestUdOverlay(data.ud_overlay);
        var udTokenMap = latestUdTokenMap || {};

        latestChunks = computeChunks(
          latestUdOverlay,
          displaySettings.chunkHighlight ? 100 : 0,
          displaySettings.linearClauseSplit || displaySettings.udOverlay,
          displaySettings.branchDepthMin,
          displaySettings.clauseDepthDrop
        );
        rebuildConnectedIslandGroups();
        clearUdTokenIndex();
        invalidateUdRectCache();
        invalidateUiRectCache();
        if (fuzzyCache && typeof fuzzyCache.clear === 'function') {
          fuzzyCache.clear();
        }
        hideUdLines();
        hideNerHover();
        clearChunkHighlight();
        hoverReticle = null;
        udSvgOverlay = null;

        var fillsDict = {};
        if (resultsBySeg && resultsBySeg.length) {
          resultsBySeg.forEach(function(res, idx) {
            if (res && res.dict_fill && res.dict_fill.length) {
              fillsDict[idx] = res.dict_fill;
            }
          });
        }
        latestSegments = segments;
        latestOriginalText = sliceText;
        latestFillsDict = fillsDict;

        if (!depTreeUseConllu && depTreeController && typeof depTreeController.setData === 'function') {
          depTreeController.debugMode = false;
          depTreeController.changedTokens = null;
          depTreeController.changeDetails = null;
          depTreeController.fills = fillsDict;
          depTreeController.setData({ segments: segments, udOverlay: latestUdOverlay, originalText: sliceText });
        }

        var segmentOffsets = (data && Array.isArray(data.segment_offsets)) ? data.segment_offsets : null;
        function offsetsAreValid(offsets, text, count) {
          if (!offsets || offsets.length !== count) return false;
          var lastEnd = 0;
          for (var oi = 0; oi < offsets.length; oi++) {
            var off = offsets[oi];
            if (!off || off.length < 2) return false;
            var start = Number(off[0]);
            var end = Number(off[1]);
            if (!isFinite(start) || !isFinite(end)) return false;
            if (start < lastEnd || end < start || end > text.length) return false;
            lastEnd = end;
          }
          return true;
        }
        latestSegmentOffsets = offsetsAreValid(segmentOffsets, sliceText, segments.length) ? segmentOffsets : [];

        applyOffsetsAsTokenSpansOnDom(sliceRoot, data);

        // Rebuild segment->DOM mapping for hover logic.
        var tokenSpans = sliceRoot.querySelectorAll('.reader-token');
        for (var ti = 0; ti < tokenSpans.length; ti++) {
          var span = tokenSpans[ti];
          if (!span || !span.dataset) continue;
          var idxVal = parseInt(span.dataset.index || '-1', 10);
          if (idxVal >= 0) registerTokenSpan(idxVal, span);
        }

        attachHoverHandlers(renderedText, resultsBySeg, gramOverlay);

        requestAnimationFrame(function() {
          requestAnimationFrame(function() {
            computeAndCacheRowBands();
            buildUdRectCache();
          });
        });

        statusText.textContent = 'Ready.';
        statusCounts.textContent = 'Segmented ' + segments.length + ' tokens.';
      })
      .catch(function(err) {
        if (seqDocx !== latestSeq) return;
        console.error(err);
        statusText.textContent = 'Lookup failed.';
        renderedText.innerHTML = '<div class="reader-output-placeholder">Lookup request failed.</div>';
      });
  }

  function triggerUpdate() {
    cancelMovementLookupTimer();
    // PDF.js viewer mode - text extraction driven by current page
    if (inputMode === 'pdf') {
      var idx = Math.max(0, Math.min((docPages.length || 1) - 1, activePageIndex || 0));
      if (idx === lastLookupPageIndex || idx === pendingPdfLookupPageIndex) {
        return;
      }
      var textForLookup;

      if (usePdfjsTextLayer && isOriginalView) {
        // PDF.js text layer mode: use iframe-provided plain text directly.
        if (pdfjsTextLayerCache[idx]) {
          textForLookup = String(pdfjsTextLayerCache[idx].plainText || '');
        } else {
          statusText.textContent = 'Fetching text layer...';
          statusCounts.textContent = docPages.length ? ('Page ' + (idx + 1) + ' / ' + docPages.length) : '';
          fetchPdfjsTextLayer(idx);
          return;
        }
      } else if (isOriginalView) {
        // Use geometrically-aware layout text
        if (originalLayoutCache[idx]) {
          textForLookup = originalLayoutCache[idx];
        } else {
          // Fetch layout text from server
          statusText.textContent = 'Loading layout text...';
          statusCounts.textContent = docPages.length ? ('Page ' + (idx + 1) + ' / ' + docPages.length) : '';
          fetchPageLayoutText(idx);
          return;
        }
      } else {
        // Use per-page raw text extracted on demand.
        if (pdfRawTextCache[idx] != null) {
          textForLookup = String(pdfRawTextCache[idx] || '').trim();
        } else {
          statusText.textContent = 'Loading page text...';
          statusCounts.textContent = docPages.length ? ('Page ' + (idx + 1) + ' / ' + docPages.length) : '';
          fetchPageLayoutText(idx);
          return;
        }
      }

      pageLookupTextByIndex[idx] = textForLookup;

      if (!textForLookup) {
        renderedText.innerHTML = '';
        statusText.textContent = 'Ready.';
        statusCounts.textContent = '';
        if (!depTreeUseConllu && depTreeController && typeof depTreeController.setData === 'function') {
          depTreeController.setData({ segments: [], udOverlay: null });
        }
        return;
      }
      var seqPdf = ++latestSeq;
      pendingPdfLookupPageIndex = idx;
      statusText.textContent = 'Segmenting...';
      statusCounts.textContent = docPages.length ? ('Page ' + (idx + 1) + ' / ' + docPages.length) : '';
      startSegmentLookupFetch(buildLookupUrl(textForLookup))
        .then(function(resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.json(); })
        .then(function(data) {
          if (seqPdf !== latestSeq) return;
          if (pendingPdfLookupPageIndex === idx) pendingPdfLookupPageIndex = -1;
          if (!data || !data.ok) {
            statusText.textContent = 'Error from server.';
            renderedText.innerHTML = '<div class="reader-output-placeholder">Error: ' + escapeHtml(data && data.error ? data.error : 'unknown') + '</div>';
            return;
          }
          lastLookupPageIndex = idx;
          var finalLookupText = textForLookup;
          if (!(usePdfjsTextLayer && isOriginalView) && data && typeof data.q === 'string') {
            finalLookupText = data.q;
          }
          pageLookupTextByIndex[idx] = finalLookupText;
          latestData = data;
          latestSegments = Array.isArray(data.segments) ? data.segments : [];
          renderSegments(data, finalLookupText || textForLookup);
        })
        .catch(function(err) {
          if (pendingPdfLookupPageIndex === idx) pendingPdfLookupPageIndex = -1;
          if (seqPdf !== latestSeq) return;
          if (isAbortError(err)) return;
          console.error(err);
          statusText.textContent = 'Request failed.';
          renderedText.innerHTML = '<div class="reader-output-placeholder">Could not contact /lookup endpoint.</div>';
          updateRenderedOutputBackground();
        });
      return;
    }

    // Document mode - use visible text from scrollable container
    if (inputMode === 'doc') {

// DOCX Original view (docx-preview): lookup is based on the visible slice of the live
// docx-preview DOM, and output is rendered via the standard segmentation pipeline.
if (isOriginalView && currentFileType === 'docx') {
  docxOriginalLookupNow();
  return;
}

      var textForLookup = getDocVisibleText().trim();

      if (!textForLookup) {
        renderedText.innerHTML = '';
        statusText.textContent = 'Ready.';
        statusCounts.textContent = '';
        if (!depTreeUseConllu && depTreeController && typeof depTreeController.setData === 'function') {
          depTreeController.setData({ segments: [], udOverlay: null });
        }
        return;
      }
      var seqDoc = ++latestSeq;
      statusText.textContent = 'Segmenting...';
      statusCounts.textContent = '';
      startSegmentLookupFetch(buildLookupUrl(textForLookup))
        .then(function(resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.json(); })
        .then(function(data) {
          if (seqDoc !== latestSeq) return;
          if (!data || !data.ok) {
            statusText.textContent = 'Error from server.';
            renderedText.innerHTML = '<div class="reader-output-placeholder">Error: ' + escapeHtml(data && data.error ? data.error : 'unknown') + '</div>';
            return;
          }
          latestData = data;
          latestSegments = Array.isArray(data.segments) ? data.segments : [];
          renderSegments(data, textForLookup);
        })
        .catch(function(err) {
          if (seqDoc !== latestSeq) return;
          if (isAbortError(err)) return;
          console.error(err);
          statusText.textContent = 'Request failed.';
          renderedText.innerHTML = '<div class="reader-output-placeholder">Could not contact /lookup endpoint.</div>';
          updateRenderedOutputBackground();
        });
      return;
    }

    // Raw mode - use textarea content
    if (isShowingInitialInputGuidance()) {
      renderedText.innerHTML = '';
      statusText.textContent = 'Ready.';
      statusCounts.textContent = '';
      if (!depTreeUseConllu && depTreeController && typeof depTreeController.setData === 'function') {
        depTreeController.setData({ segments: [], udOverlay: null });
      }
      return;
    }

    var fullText = sourceText.value || '';
    var trimmed = fullText.trim();
    if (!trimmed) {
      renderedText.innerHTML = '';
      statusText.textContent = 'Ready.';
      statusCounts.textContent = '';
      if (!depTreeUseConllu && depTreeController && typeof depTreeController.setData === 'function') {
        depTreeController.setData({ segments: [], udOverlay: null });
      }
      return;
    }

    // If raw text exceeds the 30-line viewport, switch to doc mode
    var overflowIdx = findRawOverflowIndex(fullText);
    if (overflowIdx >= 0) {
      if (!currentFile) showRawTextPill('Clear text');
      loadTextAsDoc(fullText);
      return;
    }

    // Small text - segment directly
    var seq = ++latestSeq;
    statusText.textContent = 'Segmenting...';
    statusCounts.textContent = '';
    startSegmentLookupFetch(buildLookupUrl(trimmed))
      .then(function(resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.json(); })
      .then(function(data) {
        if (seq !== latestSeq) return;
        if (!data || !data.ok) {
          statusText.textContent = 'Error from server.';
          renderedText.innerHTML = '<div class="reader-output-placeholder">Error: ' + escapeHtml(data && data.error ? data.error : 'unknown') + '</div>';
          return;
        }
        latestData = data;
        renderSegments(data, fullText);
        updateRenderedOutputBackground();
      })
      .catch(function(err) {
        if (seq !== latestSeq) return;
        if (isAbortError(err)) return;
        console.error(err);
        statusText.textContent = 'Request failed.';
        renderedText.innerHTML = '<div class="reader-output-placeholder">Could not contact /lookup endpoint.</div>';
        updateRenderedOutputBackground();
      });
  }
  function buildDictIndex(results) {
    var map = new Map();
    if (!Array.isArray(results)) return map;
    for (var ri = 0; ri < results.length; ri++) {
      var res = results[ri];
      if (!res) continue;
      var head = (res.head || '').trim();
      if (head && !map.has(head)) map.set(head, []);
      if (head) map.get(head).push(res);
    }
    return map;
  }
  function resolveSegmentPosData(segIdx, res, udTok) {
    var collapsedInfo = (latestCollapsedSpanInfo && latestCollapsedSpanInfo[segIdx]) ? latestCollapsedSpanInfo[segIdx] : null;
    var resolvedUdTok = udTok;
    if (!resolvedUdTok && collapsedInfo && collapsedInfo.udTok) {
      resolvedUdTok = collapsedInfo.udTok;
    }
    var upos = (resolvedUdTok && resolvedUdTok.upos) ? resolvedUdTok.upos : ((res && res.upos) ? res.upos : '');
    var uposLabel = (resolvedUdTok && resolvedUdTok.upos) ? resolvedUdTok.upos : ((res && res.upos_label) ? res.upos_label : ((res && res.upos) ? res.upos : ''));
    var uposColor = (resolvedUdTok && resolvedUdTok.upos) ? uposColorForTag(resolvedUdTok.upos) : ((res && res.upos_color) ? res.upos_color : '');
    var dep = (resolvedUdTok && resolvedUdTok.dep) ? resolvedUdTok.dep : ((res && res.dep) ? res.dep : '');
    var depLabel = (resolvedUdTok && resolvedUdTok.dep) ? resolvedUdTok.dep : ((res && res.dep_label) ? res.dep_label : ((res && res.dep) ? res.dep : ''));
    var tag = (resolvedUdTok && resolvedUdTok.tag) ? resolvedUdTok.tag : ((res && res.tag) ? res.tag : '');

    if (collapsedInfo && collapsedInfo.isFirst === false) {
      var spanNerLabel = getNerLabelForSeg(segIdx);
      var spanNerPos = nerLabelToUpos(spanNerLabel);
      if (spanNerPos) {
        upos = spanNerPos;
        uposLabel = spanNerPos;
        uposColor = uposColorForTag(spanNerPos);
      }
    } else if (!upos || String(upos).toUpperCase() === 'DEFAULT') {
      var nerLabel = getNerLabelForSeg(segIdx);
      var nerPos = nerLabelToUpos(nerLabel);
      if (nerPos) {
        upos = nerPos;
        uposLabel = nerPos;
        uposColor = uposColorForTag(nerPos);
      }
    }

    return {
      upos: upos,
      upos_label: uposLabel,
      upos_color: uposColor,
      dep: dep,
      dep_label: depLabel,
      tag: tag
    };
  }

    function buildTokenSpan(i, seg, gramOverlay, resultsBySeg, udTokenMap, opts) {
      var span = document.createElement('span');
      span.className = 'reader-token';
      span.dataset.index = String(i);
      span.dataset.seg = seg;
      var options = opts || {};
      var lightweight = options.lightweight === true;
    // Myanmar punctuation tokens (၊/။) are kept for UD sentence boundaries but are non-interactive.
    if (isMyanmarPunctToken(seg)) {
      span.textContent = seg;
      span.classList.add('reader-punct');
      span.dataset.punct = '1';
      return { span: span, hasGrammar: false, isUnknown: false };
    }
    var needsDotted = needsDottedCircle(seg);
    // Tokens without a base consonant (bare diacritics, or only stacked consonants)
    // still get a dotted circle for display, but we no longer force them unknown.
    if (needsDotted) {
      span.textContent = DOTTED_CIRCLE + seg;
      span.classList.add('damaged-token');
      span.dataset.damaged = '1';
      span.dataset.originalSeg = seg;
      // Continue so dict_fill can decide known/unknown.
    }
    var hasGrammar = false, isUnknown = false;
    var tInfo = gramOverlay[i] || {};
    var entries = Array.isArray(tInfo.grammar) ? tInfo.grammar : [];
    if (entries.length) {
      // Prefer a non-UNKNOWN entry if available
      var chosen = entries.find(function(e) { return e && e.type && e.type !== 'UNKNOWN'; }) || entries[0];
      var type = (chosen.type || chosen.category || 'MISC_FUNC');
      if (displaySettings.grammarTypes && displaySettings.grammarTypes[type]) {
        var color = getGrammarColor(type);
        span.classList.add('grammar-token');
        span.dataset.grammarType = type;
        span.style.borderBottom = '2px solid ' + color;
        span.style.paddingBottom = '2px';
        hasGrammar = true;
      }
    }
    function isUnknownEntry(obj) {
      if (!obj) return true;
      var p = (obj.pos || '').toLowerCase();
      var ss = obj.senses || [];
      return p.indexOf('unknown') >= 0 || (ss.length === 1 && typeof ss[0] === 'string' && ss[0].toLowerCase().indexOf('no dictionary entry') >= 0);
    }
      var res = (resultsBySeg && resultsBySeg[i]) ? resultsBySeg[i] : null;
      if (res) {
        var fillHasKnown = (typeof res.dict_fill_has_known === 'boolean') ? res.dict_fill_has_known : false;
        var fillHasUnknown = (typeof res.dict_fill_has_unknown === 'boolean') ? res.dict_fill_has_unknown : false;
        var dictFill = Array.isArray(res.dict_fill) ? res.dict_fill : [];
      // Back-compat: infer fill coverage if flags are missing
      if ((typeof res.dict_fill_has_known !== 'boolean' || typeof res.dict_fill_has_unknown !== 'boolean') && dictFill.length) {
        for (var pi = 0; pi < dictFill.length; pi++) {
          if (isUnknownEntry(dictFill[pi])) fillHasUnknown = true; else fillHasKnown = true;
        }
      }
      // Last-resort: old heuristic on the token itself
      if (!fillHasKnown && !fillHasUnknown) {
        var pos = (res.pos || '').toLowerCase();
        var senses = res.senses || [];
        var looksUnknown = pos.indexOf('unknown') >= 0 || (senses.length === 1 && typeof senses[0] === 'string' && senses[0].toLowerCase().indexOf('no dictionary entry') >= 0);
        if (looksUnknown) fillHasUnknown = true; else fillHasKnown = true;
      }

      // Highlight ONLY unknown shards instead of coloring the whole token red.
      // (If the entire token is unknown, we still color the whole token.)
      if (fillHasUnknown) isUnknown = true;

      if (lightweight) {
        span.textContent = needsDotted ? (DOTTED_CIRCLE + seg) : seg;
        if (fillHasUnknown && !fillHasKnown) {
          span.classList.add('unknown-token');
        }
        return { span: span, hasGrammar: hasGrammar, isUnknown: isUnknown };
      }

      // Always create subtokens for all dict_fill entries to enable per-word hovering
        if (dictFill.length) {
          var joined = '';
          for (var di = 0; di < dictFill.length; di++) {
            joined += (dictFill[di] && dictFill[di].head) ? dictFill[di].head : '';
          }
          if (joined === seg) {
            span.textContent = '';
            for (var di2 = 0; di2 < dictFill.length; di2++) {
              var part = dictFill[di2] || {};
              var pHead = part.head || '';
              if (!pHead) continue;
            var sub = document.createElement('span');
            sub.className = 'reader-subtoken';
            if (isUnknownEntry(part)) sub.classList.add('unknown-subtoken');
              var displayHead = pHead;
              if (needsDotted && di2 === 0 && needsDottedCircle(pHead)) {
                displayHead = DOTTED_CIRCLE + pHead;
              }
              sub.textContent = displayHead;
              sub.dataset.word = pHead;
              sub.dataset.fillIdx = String(di2);
              span.appendChild(sub);
            }
            if (!span.childNodes || !span.childNodes.length) {
            span.textContent = needsDotted ? (DOTTED_CIRCLE + seg) : seg;
            span.classList.add('unknown-token');
          }
        } else {
          span.textContent = needsDotted ? (DOTTED_CIRCLE + seg) : seg;
          span.classList.add('unknown-token');
        }
      } else {
        span.textContent = needsDotted ? (DOTTED_CIRCLE + seg) : seg;
        if (fillHasUnknown && !fillHasKnown) {
          span.classList.add('unknown-token');
        }
      }
    } else {
      span.textContent = needsDotted ? (DOTTED_CIRCLE + seg) : seg;
      span.classList.add('unknown-token'); isUnknown = true;
    }
    return { span: span, hasGrammar: hasGrammar, isUnknown: isUnknown };
  }

  // Annotate raw PDF word spans with segment/NLP data
  function annotateRawWordSpans(wordSpans, pdfWords, segments, segmentOffsets, resultsBySeg, gramOverlay, udTokenMap, pageData) {
    if (!wordSpans || !segments || !segmentOffsets) return;

    // Build word offsets using SAME iteration order as buildLayoutTextFromWords()
    // This must match exactly for character-level mapping to work
    var wordOffsets = [];
    var charPos = 0;
    
    var structuredBlocks = (pageData && Array.isArray(pageData.structured_blocks)) ? pageData.structured_blocks : null;
    var words = (pageData && Array.isArray(pageData.words)) ? pageData.words : pdfWords;
    
    if (structuredBlocks && structuredBlocks.length > 0) {
      // Sort blocks by Y position - MUST match buildLayoutTextFromWords and render loop
      var sortedBlocks = structuredBlocks.slice().sort(function(a, b) {
        return (a.min_y || 0) - (b.min_y || 0);
      });
      
      var spanIdx = 0;
      for (var bi = 0; bi < sortedBlocks.length; bi++) {
        if (bi > 0) charPos += 2;  // '\n\n' paragraph break
        var block = sortedBlocks[bi];
        var lines = block.lines || [];
        for (var li = 0; li < lines.length; li++) {
          if (li > 0) charPos += 1;  // '\n' line break
          var lineWords = lines[li].words || [];
          // Sort words by X within line - MUST match buildLayoutTextFromWords
          var sortedWords = lineWords.slice().sort(function(a, b) {
            return (a.x || 0) - (b.x || 0);
          });
          for (var wi = 0; wi < sortedWords.length; wi++) {
            var w = sortedWords[wi];
            if (!w || !w.text) {
              wordOffsets.push(null);
              spanIdx++;
              continue;
            }
            if (shouldInsertSpace(w, wi)) charPos += 1;  // space between words
            var wtext = String(w.text);
            wordOffsets.push([charPos, charPos + wtext.length]);
            charPos += wtext.length;
            spanIdx++;
          }
        }
      }
    } else if (words && words.length > 0) {
      // Fallback: group words by Y, sort by X within each line
      // Compute median height
      var medianH = 12;
      var allHeights = [];
      for (var wi = 0; wi < words.length; wi++) {
        if (words[wi] && words[wi].h > 0) allHeights.push(words[wi].h);
      }
      if (allHeights.length) {
        allHeights.sort(function(a,b){ return a - b; });
        var mid = Math.floor(allHeights.length / 2);
        medianH = allHeights.length % 2 ? allHeights[mid] : (allHeights[mid-1] + allHeights[mid]) / 2;
      }
      
      // Group words into lines by Y
      var lineGroups = [];
      var currentLineY = -999;
      var currentLineWords = [];
      
      for (var wi = 0; wi < words.length; wi++) {
        var w = words[wi];
        if (!w || !w.text) continue;
        
        var y = (typeof w.y === 'number') ? w.y : 0;
        var h = (typeof w.h === 'number' && w.h > 0) ? w.h : medianH;
        
        if (currentLineY >= 0 && Math.abs(y - currentLineY) > h * 0.5) {
          if (currentLineWords.length > 0) {
            lineGroups.push({ y: currentLineY, words: currentLineWords });
          }
          currentLineWords = [];
        }
        
        currentLineWords.push(w);
        currentLineY = y;
      }
      if (currentLineWords.length > 0) {
        lineGroups.push({ y: currentLineY, words: currentLineWords });
      }
      
      // Sort lines by Y
      lineGroups.sort(function(a, b) { return a.y - b.y; });
      
      // Build offsets: lines separated by \n, words sorted by X and separated by space
      for (var li = 0; li < lineGroups.length; li++) {
        if (li > 0) charPos += 1;  // '\n' line break
        var lineWords = lineGroups[li].words;
        // Sort words by X within line
        lineWords.sort(function(a, b) { return (a.x || 0) - (b.x || 0); });
        for (var wi = 0; wi < lineWords.length; wi++) {
          var w = lineWords[wi];
          if (shouldInsertSpace(w, wi)) charPos += 1;  // space between words
          var wtext = String(w.text);
          wordOffsets.push([charPos, charPos + wtext.length]);
          charPos += wtext.length;
        }
      }
    }

    // For each segment, find which word(s) it overlaps and apply annotations
    for (var si = 0; si < segments.length; si++) {
      var off = segmentOffsets[si];
      if (!off || off.length < 2) continue;
      var segStart = Number(off[0]);
      var segEnd = Number(off[1]);
      if (!isFinite(segStart) || !isFinite(segEnd)) continue;

      // Find all words this segment overlaps
      for (var wi = 0; wi < wordOffsets.length; wi++) {
        var woff = wordOffsets[wi];
        if (!woff) continue;
        var wStart = Number(woff[0]);
        var wEnd = Number(woff[1]);

        // Check overlap
        if (segStart < wEnd && segEnd > wStart) {
          var segText = String(segments[si] || '');
          if (!hasMyanmarChars(segText) || isMyanmarPunctToken(segText)) {
            continue;
          }
          var wordSpan = wordSpans[wi];
          if (!wordSpan) continue;

          // Persist the word's character-offset span in the synthetic layout text.
          // This is critical for mapping multiple Burmese segments back onto a single PDF "word" span.
          if (wordSpan.dataset.wordStart == null) wordSpan.dataset.wordStart = String(wStart);
          if (wordSpan.dataset.wordEnd == null) wordSpan.dataset.wordEnd = String(wEnd);

          // Apply grammar overlay if present
          if (gramOverlay && Array.isArray(gramOverlay)) {
            for (var gi = 0; gi < gramOverlay.length; gi++) {
              var gramToken = gramOverlay[gi];
              if (gramToken && gramToken.seg_i === si) {
                var posTag = gramToken.pos || '';
                if (posTag) {
                  wordSpan.classList.add('pos-' + posTag);
                  wordSpan.dataset.pos = posTag;
                }
              }
            }
          }

          // Apply known/unknown status from dictionary results
          if (resultsBySeg && resultsBySeg[si]) {
            var res = resultsBySeg[si];
            var hasKnown = (typeof res.dict_fill_has_known === 'boolean') ? res.dict_fill_has_known : false;
            var dictFill = Array.isArray(res.dict_fill) ? res.dict_fill : [];
            if (!hasKnown && dictFill.length) hasKnown = true;

            if (hasKnown) {
              wordSpan.classList.add('seg-known');
            } else {
              wordSpan.classList.add('seg-unknown');
            }
          }

          // Make raw PDF span participate in the normal token UI by giving it the same hooks
          // the hover/click/overlay code expects.
          wordSpan.classList.add('reader-token');
          wordSpan.style.cursor = 'pointer';

          // Choose a canonical segment index for this span (used as a fallback when we can't resolve
          // which sub-segment within an island the pointer is on).
          if (!wordSpan.dataset.index || Number(si) < Number(wordSpan.dataset.index)) {
            wordSpan.dataset.index = String(si);
            wordSpan.dataset.seg = String(segments[si] || '');
          }

          // Ensure UD overlay / NER / dependency line rendering can locate an element for EACH segment.
          // In original PDF view, multiple segments may map to the same DOM span; that's fine.
          if (!udTokenIndex.has(si)) {
            registerTokenSpan(si, wordSpan);
          }

          // Store segment reference on the word span
          if (!wordSpan.dataset.segments) {
            wordSpan.dataset.segments = '';
          }
          if (!wordSpan.dataset.segments.includes(String(si))) {
            wordSpan.dataset.segments += (wordSpan.dataset.segments ? ',' : '') + String(si);
          }
        }
      }
    }

    // Second pass: split each absolute-positioned PDF word span into multiple interactive segment spans.
    // This is the key step that makes hover popups and overlays work properly when Burmese "islands" contain
    // multiple segmentation tokens.
    for (var wi2 = 0; wi2 < wordSpans.length; wi2++) {
      var ws = wordSpans[wi2];
      if (!ws) continue;
      var segCsv = ws.dataset.segments || '';
      if (!segCsv) continue;

      var wStart2 = parseInt(ws.dataset.wordStart || 'NaN', 10);
      var wEnd2 = parseInt(ws.dataset.wordEnd || 'NaN', 10);
      if (!isFinite(wStart2) || !isFinite(wEnd2) || wEnd2 <= wStart2) continue;

      var wText = ws.textContent || '';
      if (!wText) continue;

      var segList2 = segCsv.split(',').map(function(x){ return parseInt(x, 10); }).filter(function(n){ return isFinite(n) && n >= 0; });
      if (!segList2.length) continue;

      // Sort by segment start offset
      segList2.sort(function(a, b) {
        var oa = segmentOffsets[a] || [0,0];
        var ob = segmentOffsets[b] || [0,0];
        return Number(oa[0]) - Number(ob[0]);
      });

      // Rebuild the content as a mixture of plain text nodes and interactive token spans
      var frag2 = document.createDocumentFragment();
      var cursor2 = 0;
      for (var si3 = 0; si3 < segList2.length; si3++) {
        var sIdx = segList2[si3];
        var off3 = segmentOffsets[sIdx];
        if (!off3 || off3.length < 2) continue;
        var s0 = Number(off3[0]);
        var s1 = Number(off3[1]);
        if (!isFinite(s0) || !isFinite(s1)) continue;

        // Local indices within this word's text
        var local0 = s0 - wStart2;
        var local1 = s1 - wStart2;
        if (local1 <= 0 || local0 >= wText.length) continue;
        if (local0 < 0) local0 = 0;
        if (local1 > wText.length) local1 = wText.length;

        // Fill any gap between previous piece and this segment
        if (local0 > cursor2) {
          frag2.appendChild(document.createTextNode(wText.slice(cursor2, local0)));
        }

        // Only build a full token span when the substring matches the segment text.
        // If it doesn't match (rare, usually due to synthetic whitespace/newlines), fall back to plain text.
        var piece = wText.slice(local0, local1);
        var segText = String(segments[sIdx] || '');
        var isMyanmarSeg = hasMyanmarChars(segText) && !isMyanmarPunctToken(segText);
        if (piece && segText && piece === segText && isMyanmarSeg) {
          var built = buildTokenSpan(sIdx, segText, gramOverlay || [], resultsBySeg || [], udTokenMap || {});
          // buildTokenSpan returns {span, hasGrammar, isUnknown}.
          frag2.appendChild(built.span);
          // Ensure the UD overlay can anchor per-segment geometry to the inner span (not the outer container)
          registerTokenSpan(sIdx, built.span);
        } else if (isMyanmarSeg) {
          // Plain text fallback; keep basic click target by making it a token span with minimal metadata.
          var fallback = document.createElement('span');
          fallback.className = 'reader-token';
          fallback.dataset.index = String(sIdx);
          fallback.dataset.seg = segText || piece;
          fallback.textContent = piece;
          frag2.appendChild(fallback);
          registerTokenSpan(sIdx, fallback);
        } else {
          frag2.appendChild(document.createTextNode(piece));
        }

        cursor2 = local1;
      }
      if (cursor2 < wText.length) {
        frag2.appendChild(document.createTextNode(wText.slice(cursor2)));
      }

      // The outer span is only a positioned container now; the real interactive spans are children.
      ws.classList.remove('reader-token');
      ws.style.cursor = 'default';
      ws.textContent = '';
      ws.appendChild(frag2);
    }
  }

  function annotatePdfJsTextLayerSpans(wordSpans, segments, segmentOffsets, resultsBySeg, gramOverlay, udTokenMap) {
    if (!wordSpans || !wordSpans.length || !segments || !segmentOffsets) return;

    var spanOffsets = [];
    var charPos = 0;
    for (var wi = 0; wi < wordSpans.length; wi++) {
      var ws = wordSpans[wi];
      if (!ws) continue;
      var txt = ws.textContent || '';
      var start = charPos;
      charPos += txt.length;
      spanOffsets.push([start, charPos]);
      ws.dataset.wordStart = String(start);
      ws.dataset.wordEnd = String(charPos);
      ws.dataset.segments = '';
    }

    for (var si = 0; si < segments.length; si++) {
      var off = segmentOffsets[si];
      if (!off || off.length < 2) continue;
      var segStart = Number(off[0]);
      var segEnd = Number(off[1]);
      if (!isFinite(segStart) || !isFinite(segEnd)) continue;
      var segText = String(segments[si] || '');
      if (!hasMyanmarChars(segText) || isMyanmarPunctToken(segText)) continue;

      for (var wi2 = 0; wi2 < wordSpans.length; wi2++) {
        var spanOff = spanOffsets[wi2];
        if (!spanOff) continue;
        var wStart = spanOff[0];
        var wEnd = spanOff[1];
        if (!(segStart < wEnd && segEnd > wStart)) continue;

        var wordSpan = wordSpans[wi2];
        if (!wordSpan) continue;
        if (!wordSpan.dataset.index || Number(si) < Number(wordSpan.dataset.index)) {
          wordSpan.dataset.index = String(si);
          wordSpan.dataset.seg = segText;
        }
        if (!wordSpan.dataset.segments) wordSpan.dataset.segments = '';
        if (!wordSpan.dataset.segments.includes(String(si))) {
          wordSpan.dataset.segments += (wordSpan.dataset.segments ? ',' : '') + String(si);
        }
        wordSpan.classList.add('reader-token');
        if (!udTokenIndex.has(si)) registerTokenSpan(si, wordSpan);
      }
    }

    for (var wi3 = 0; wi3 < wordSpans.length; wi3++) {
      var ws2 = wordSpans[wi3];
      if (!ws2) continue;
      var segCsv = ws2.dataset.segments || '';
      if (!segCsv) continue;

      var wStart2 = parseInt(ws2.dataset.wordStart || 'NaN', 10);
      var wEnd2 = parseInt(ws2.dataset.wordEnd || 'NaN', 10);
      if (!isFinite(wStart2) || !isFinite(wEnd2) || wEnd2 <= wStart2) continue;
      var wText = ws2.textContent || '';
      if (!wText) continue;

      var segList = segCsv.split(',').map(function(x) { return parseInt(x, 10); }).filter(function(n) { return isFinite(n) && n >= 0; });
      if (!segList.length) continue;
      segList.sort(function(a, b) {
        var oa = segmentOffsets[a] || [0, 0];
        var ob = segmentOffsets[b] || [0, 0];
        return Number(oa[0]) - Number(ob[0]);
      });

      var frag = document.createDocumentFragment();
      var cursor = 0;
      for (var si2 = 0; si2 < segList.length; si2++) {
        var sIdx = segList[si2];
        var off2 = segmentOffsets[sIdx];
        if (!off2 || off2.length < 2) continue;
        var s0 = Number(off2[0]);
        var s1 = Number(off2[1]);
        if (!isFinite(s0) || !isFinite(s1)) continue;

        var local0 = s0 - wStart2;
        var local1 = s1 - wStart2;
        if (local1 <= 0 || local0 >= wText.length) continue;
        if (local0 < 0) local0 = 0;
        if (local1 > wText.length) local1 = wText.length;

        if (local0 > cursor) frag.appendChild(document.createTextNode(wText.slice(cursor, local0)));

        var piece = wText.slice(local0, local1);
        var segText2 = String(segments[sIdx] || '');
        var isMyanmarSeg = hasMyanmarChars(segText2) && !isMyanmarPunctToken(segText2);
        if (piece && segText2 && piece === segText2 && isMyanmarSeg) {
          var built = buildTokenSpan(sIdx, segText2, gramOverlay || [], resultsBySeg || [], udTokenMap || {});
          frag.appendChild(built.span);
          registerTokenSpan(sIdx, built.span);
        } else if (isMyanmarSeg) {
          var fallback = document.createElement('span');
          fallback.className = 'reader-token';
          fallback.dataset.index = String(sIdx);
          fallback.dataset.seg = segText2 || piece;
          fallback.textContent = piece;
          frag.appendChild(fallback);
          registerTokenSpan(sIdx, fallback);
        } else {
          frag.appendChild(document.createTextNode(piece));
        }
        cursor = local1;
      }
      if (cursor < wText.length) frag.appendChild(document.createTextNode(wText.slice(cursor)));

      ws2.classList.remove('reader-token');
      ws2.textContent = '';
      ws2.appendChild(frag);
    }
  }

  function renderSegments(data, rawText) {
    if (renderedText) {
      renderedText.classList.remove('plain-text-mode', 'docx-original-view');
    }
      var segments = Array.isArray(data.segments) ? data.segments : [];
      var gramOverlay = data.grammar_overlay && Array.isArray(data.grammar_overlay.tokens) ? data.grammar_overlay.tokens : [];
      var resultsBySeg = Array.isArray(data.results_by_seg) ? data.results_by_seg : [];
      // Store UD overlay for dependency visualization
      setLatestUdOverlay(data.ud_overlay);
      var udTokenMap = latestUdTokenMap || {};
      function shouldPreventTokenWrap() {
        return !isOriginalView && (
          rawTextDocActive ||
          inputMode === 'raw' ||
          currentFileType === 'text' ||
          currentFileType === 'docx' ||
          currentFileType === 'pdf'
        );
      }
      function applyPlainTextNoWrap(span) {
        if (!span || !shouldPreventTokenWrap()) return;
        span.style.whiteSpace = 'nowrap';
        span.style.overflowWrap = 'normal';
        span.style.wordBreak = 'normal';
      }
      // Collapsed span info + UD token map already rebuilt via setLatestUdOverlay()
      // Compute chunks from UD overlay (use max depth 100 when enabled)
      latestChunks = computeChunks(
        latestUdOverlay,
        displaySettings.chunkHighlight ? 100 : 0,
        displaySettings.linearClauseSplit || displaySettings.udOverlay,
      displaySettings.branchDepthMin,
      displaySettings.clauseDepthDrop
    );
    rebuildConnectedIslandGroups();
    clearUdTokenIndex();
    invalidateUdRectCache();
    invalidateUiRectCache();
    if (fuzzyCache && typeof fuzzyCache.clear === 'function') {
      fuzzyCache.clear();
    }
    hideUdLines();
    hideNerHover();
    clearChunkHighlight();
    hoverReticle = null; // Reset hover reticle overlay
    udSvgOverlay = null; // Reset SVG overlay
    var n = segments.length;
    if (!n) {
      renderedText.innerHTML = '<div class="reader-output-placeholder">No Burmese segments found.</div>';
      statusText.textContent = 'No segments.';
      statusCounts.textContent = '';
      return;
    }
    var text = (data && data.display_text) ? data.display_text : ((data && data.q) ? data.q : (rawText != null ? rawText : (sourceText.value || '')));
    if (usePdfjsTextLayer && isOriginalView && rawText != null) {
      text = String(rawText);
    }
    // Build fills dict for dictionary popups (dict_fill contains the entries)
    var fillsDict = {};
    if (resultsBySeg && resultsBySeg.length) {
      resultsBySeg.forEach(function(res, idx) {
        if (res && res.dict_fill && res.dict_fill.length) {
          fillsDict[idx] = res.dict_fill;
        }
      });
    }
    latestSegments = segments;
    latestOriginalText = text;
    latestFillsDict = fillsDict;
    if (!depTreeUseConllu && depTreeController && typeof depTreeController.setData === 'function') {
      depTreeController.debugMode = false;
      depTreeController.changedTokens = null;
      depTreeController.changeDetails = null;
      depTreeController.fills = fillsDict;
      depTreeController.setData({ segments: segments, udOverlay: latestUdOverlay, originalText: text });
    }
    var frag = document.createDocumentFragment();
    var segmentOffsets = (data && Array.isArray(data.segment_offsets)) ? data.segment_offsets : null;
    var grammarCount = 0, unknownCount = 0;
    function offsetsAreValid(offsets, text, count) {
      if (!offsets || offsets.length !== count) return false;
      var lastEnd = 0;
      for (var oi = 0; oi < offsets.length; oi++) {
        var off = offsets[oi];
        if (!off || off.length < 2) return false;
        var start = Number(off[0]);
        var end = Number(off[1]);
        if (!isFinite(start) || !isFinite(end)) return false;
        if (start < lastEnd || end < start || end > text.length) return false;
        lastEnd = end;
      }
      return true;
    }
    if (offsetsAreValid(segmentOffsets, text, n)) {
      latestSegmentOffsets = segmentOffsets;

      // ---- PDF.js text layer rendering path ----
      var tlCacheEntry = (usePdfjsTextLayer && isOriginalView) ? pdfjsTextLayerCache[lastLookupPageIndex] : null;
      if (usePdfjsTextLayer && isOriginalView && tlCacheEntry && tlCacheEntry.innerHTML) {
        var tlOuter = document.createElement('div');
        tlOuter.className = 'pdfjs-textlayer-container';

        var tlHost = document.createElement('div');
        tlHost.className = 'pdfjs-textlayer-host';
        var vpW = Number(tlCacheEntry.viewportWidth) || 0;
        var vpH = Number(tlCacheEntry.viewportHeight) || 0;
        var panelW = renderedText.clientWidth || renderedText.offsetWidth || 0;
        var fitScale = 1;
        if (vpW > 0 && panelW > 0) {
          fitScale = panelW / vpW;
          tlHost.style.width = panelW + 'px';
          if (vpH > 0) tlHost.style.height = Math.max(1, Math.round(panelW * (vpH / vpW))) + 'px';
        } else {
          if (vpW > 0) tlHost.style.width = vpW + 'px';
          if (vpH > 0) tlHost.style.height = vpH + 'px';
        }

        var tlLayer = document.createElement('div');
        tlLayer.className = (tlCacheEntry.layerClass || 'textLayer') + ' pdfjs-textlayer-clone';
        if (tlCacheEntry.layerStyle) {
          tlLayer.setAttribute('style', String(tlCacheEntry.layerStyle));
        }
        var baseScale = Number(tlCacheEntry.computedScaleFactor) || parseFloat(tlLayer.style.getPropertyValue('--scale-factor')) || 1;
        var baseTotalScale = Number(tlCacheEntry.computedTotalScaleFactor) || parseFloat(tlLayer.style.getPropertyValue('--total-scale-factor')) || baseScale;
        tlLayer.style.setProperty('--scale-factor', String(baseScale * fitScale));
        tlLayer.style.setProperty('--total-scale-factor', String(baseTotalScale * fitScale));
        tlLayer.innerHTML = String(tlCacheEntry.innerHTML || '');
        tlHost.appendChild(tlLayer);
        tlOuter.appendChild(tlHost);
        frag.appendChild(tlOuter);

        var tlWordSpans = tlLayer.querySelectorAll('span');
        annotatePdfJsTextLayerSpans(tlWordSpans, segments, segmentOffsets, resultsBySeg, gramOverlay, udTokenMap);

        renderedText.innerHTML = '';
        renderedText.appendChild(frag);
        hideNerHover();
        attachHoverHandlers(renderedText, resultsBySeg, gramOverlay);
        statusText.textContent = 'Segmented ' + n + ' tokens (PDF.js text layer).';
        statusCounts.textContent = docPages.length ? ('Page ' + (lastLookupPageIndex + 1) + ' / ' + docPages.length) : '';
        requestAnimationFrame(function() { computeAndCacheRowBands(); });
        requestAnimationFrame(function() { buildUdRectCache(); });
        return;
      }

      // Check if in original view with PDF positioning data
      var pageData = isOriginalView && renderedPageImages && renderedPageImages.byIndex ? renderedPageImages.byIndex[lastLookupPageIndex] : null;

      if (isOriginalView && pageData && pageData.words && pageData.words.length > 0) {
        // Render structured flowing text layout - each word positioned by its actual X coordinate
        var structuredBlocks = pageData.structured_blocks || [];
        var words = pageData.words || [];
        
        // Create container
        var container = document.createElement('div');
        container.className = 'structured-text-container';
        container.style.cssText = 'position:relative;background:#fff;border:1px solid #e5e7eb;border-radius:4px;box-sizing:border-box;overflow:hidden;';
        var containerWidth = renderedText.clientWidth || renderedText.offsetWidth || 0;
        var scaleFactor = (containerWidth > 0 && pageData.width > 0) ? (containerWidth / pageData.width) : 1;
        if (containerWidth > 0 && pageData.width > 0) {
          var containerHeight = containerWidth * (pageData.height / pageData.width);
          container.style.height = containerHeight + 'px';
        }
        
        // Global word spans array for annotation mapping
        var allWordSpans = [];
        
        var pageFontSizes = [];
        var fontCounts = {};
        if (structuredBlocks.length > 0) {
          for (var bi = 0; bi < structuredBlocks.length; bi++) {
            var bl = structuredBlocks[bi].lines || [];
            for (var li = 0; li < bl.length; li++) {
              var bw = bl[li].words || [];
              for (var wi = 0; wi < bw.length; wi++) {
                var pfs = bw[wi] && Number(bw[wi].fontSize);
                if (pfs && isFinite(pfs) && pfs > 0) pageFontSizes.push(pfs);
                var fontName = bw[wi] && bw[wi].font;
                if (fontName) {
                  fontCounts[fontName] = (fontCounts[fontName] || 0) + 1;
                }
              }
            }
          }
        } else {
          for (var wi = 0; wi < words.length; wi++) {
            var pfs2 = words[wi] && Number(words[wi].fontSize);
            if (pfs2 && isFinite(pfs2) && pfs2 > 0) pageFontSizes.push(pfs2);
            var fontName2 = words[wi] && words[wi].font;
            if (fontName2) {
              fontCounts[fontName2] = (fontCounts[fontName2] || 0) + 1;
            }
          }
        }
        var pageFontMedian = 0;
        if (pageFontSizes.length) {
          pageFontSizes.sort(function(a,b){ return a - b; });
          var midAll = Math.floor(pageFontSizes.length / 2);
          pageFontMedian = (pageFontSizes.length % 2)
            ? pageFontSizes[midAll]
            : (pageFontSizes[midAll - 1] + pageFontSizes[midAll]) / 2;
        }
        // Find most common font
        var mostCommonFont = null;
        var maxFontCount = 0;
        for (var fn in fontCounts) {
          if (fontCounts[fn] > maxFontCount) {
            maxFontCount = fontCounts[fn];
            mostCommonFont = fn;
          }
        }

        if (structuredBlocks.length > 0) {
          // Sort blocks by Y position (min_y) for proper vertical ordering
          var sortedBlocks = structuredBlocks.slice().sort(function(a, b) {
            return (a.min_y || 0) - (b.min_y || 0);
          });
          
          // Render using structured blocks - absolute-position each run by X/Y
          for (var bi = 0; bi < sortedBlocks.length; bi++) {
            var block = sortedBlocks[bi];
            var lines = block.lines || [];
            for (var li = 0; li < lines.length; li++) {
              var lineWords = lines[li].words || [];
              for (var wi = 0; wi < lineWords.length; wi++) {
                var w = lineWords[wi];
                if (!w || !w.text) continue;
                
                var wordSpan = document.createElement('span');
                wordSpan.className = 'pdf-raw-word';
                wordSpan.textContent = w.text;
                wordSpan.dataset.wordIdx = String(w.word_idx != null ? w.word_idx : allWordSpans.length);
                wordSpan.dataset.block = String(bi);
                wordSpan.dataset.line = String(li);
                wordSpan.dataset.bboxX = String(w.x || 0);
                wordSpan.dataset.bboxY = String(w.y || 0);
                wordSpan.dataset.bboxW = String(w.w || 0);
                wordSpan.dataset.bboxH = String(w.h || 0);
                
                var leftPct = ((w.x || 0) / pageData.width) * 100;
                var topPct = ((w.y || 0) / pageData.height) * 100;
                wordSpan.style.cssText = 'position:absolute;left:' + leftPct + '%;top:' + topPct + '%;white-space:nowrap;';
                if (mostCommonFont) {
                  var cleanedFont = String(mostCommonFont).replace(/"/g, '');
                  if (cleanedFont) wordSpan.style.fontFamily = '"' + cleanedFont + '", inherit';
                }
                var useFontSize = pageFontMedian || w.fontSize;
                if (useFontSize && scaleFactor > 0) {
                  wordSpan.style.fontSize = (Number(useFontSize) * scaleFactor) + 'px';
                }
                
                container.appendChild(wordSpan);
                allWordSpans.push(wordSpan);
              }
            }
          }
        } else {
          // Fallback: render flat word list grouped by Y, each word positioned individually
          // First, group words by Y coordinate (lines)
          var lineGroups = [];
          var currentLineY = -999;
          var currentLineWords = [];
          var medianH = 12;
          
          // Compute median height
          var allHeights = [];
          for (var wi = 0; wi < words.length; wi++) {
            if (words[wi] && words[wi].h > 0) allHeights.push(words[wi].h);
          }
          if (allHeights.length) {
            allHeights.sort(function(a,b){ return a - b; });
            var mid = Math.floor(allHeights.length / 2);
            medianH = allHeights.length % 2 ? allHeights[mid] : (allHeights[mid-1] + allHeights[mid]) / 2;
          }
          
          for (var wi = 0; wi < words.length; wi++) {
            var w = words[wi];
            if (!w || !w.text) continue;
            
            var y = (typeof w.y === 'number') ? w.y : 0;
            var h = (typeof w.h === 'number' && w.h > 0) ? w.h : medianH;
            
            // Check for new line
            if (currentLineY >= 0 && Math.abs(y - currentLineY) > h * 0.5) {
              if (currentLineWords.length > 0) {
                lineGroups.push({ y: currentLineY, words: currentLineWords });
              }
              currentLineWords = [];
            }
            
            currentLineWords.push(w);
            currentLineY = y;
          }
          if (currentLineWords.length > 0) {
            lineGroups.push({ y: currentLineY, words: currentLineWords });
          }
          
          // Sort lines by Y
          lineGroups.sort(function(a, b) { return a.y - b.y; });
          
          // Render each line with individually positioned words
          var fallbackFontMedian = pageFontMedian;
          for (var li = 0; li < lineGroups.length; li++) {
            var lineWords = lineGroups[li].words;
            for (var wi = 0; wi < lineWords.length; wi++) {
              var w = lineWords[wi];
              
              var wordSpan = document.createElement('span');
              wordSpan.className = 'pdf-raw-word';
              wordSpan.textContent = w.text;
              wordSpan.dataset.wordIdx = String(w.word_idx != null ? w.word_idx : allWordSpans.length);
              wordSpan.dataset.block = '0';
              wordSpan.dataset.line = String(li);
              wordSpan.dataset.bboxX = String(w.x || 0);
              wordSpan.dataset.bboxY = String(w.y || 0);
              wordSpan.dataset.bboxW = String(w.w || 0);
              wordSpan.dataset.bboxH = String(w.h || 0);
              
              // Position each word by its actual X coordinate
              var leftPct = ((w.x || 0) / pageData.width) * 100;
              var topPct = ((w.y || 0) / pageData.height) * 100;
              wordSpan.style.cssText = 'position:absolute;left:' + leftPct + '%;top:' + topPct + '%;white-space:nowrap;';
              if (mostCommonFont) {
                var cleanedFont2 = String(mostCommonFont).replace(/"/g, '');
                if (cleanedFont2) wordSpan.style.fontFamily = '"' + cleanedFont2 + '", inherit';
              }
              var useFontSize2 = fallbackFontMedian || w.fontSize;
              if (useFontSize2 && scaleFactor > 0) {
                wordSpan.style.fontSize = (Number(useFontSize2) * scaleFactor) + 'px';
              }
              
              container.appendChild(wordSpan);
              allWordSpans.push(wordSpan);
            }
          }
        }

        // Store reference to raw word spans for later annotation
        latestRawWordSpans = allWordSpans;
        latestRawPageData = pageData;  // Store page data for annotation
        window.latestRawPageData = pageData;

        frag.appendChild(container);
        renderedText.classList.add('orig-view-structured');

        // Now render the raw layout and annotate it from the existing lookup payload.
        renderedText.innerHTML = '';
        renderedText.appendChild(frag);
        hideNerHover();

        (function() {
          var basePx = (pageFontMedian && scaleFactor > 0) ? (pageFontMedian * scaleFactor) : 0;
          var runNormalize = function() {
            normalizeBlockFontSizes(container, basePx);
            normalizeLinePositions(container);
          };
          if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function() {
              requestAnimationFrame(runNormalize);
            });
          } else {
            requestAnimationFrame(runNormalize);
          }
        })();

        // Reuse the single lookup payload for this page; do not trigger a second /lookup.
        if (segments.length && segmentOffsets.length) {
          clearUdTokenIndex();
          invalidateUdRectCache();
          invalidateUiRectCache();

          // Annotate positioned word spans using the already-fetched segment payload.
          annotateRawWordSpans(latestRawWordSpans, pageData.words, segments, segmentOffsets, resultsBySeg, gramOverlay, udTokenMap, pageData);
          attachHoverHandlers(renderedText, resultsBySeg, gramOverlay);

          requestAnimationFrame(function() {
            requestAnimationFrame(function() {
              computeAndCacheRowBands();
              buildUdRectCache();
            });
          });

          statusText.textContent = 'Segmented ' + segments.length + ' tokens.';
          statusCounts.textContent = docPages.length ? ('Page ' + (lastLookupPageIndex + 1) + ' / ' + docPages.length) : '';
        } else {
          statusText.textContent = 'Segmented ' + n + ' tokens.';
          statusCounts.textContent = '';
        }
        return;
      } else {
        // Standard text rendering (not original view)
        var cursor = 0;
        for (var oi = 0; oi < n; oi++) {
          var start = Number(segmentOffsets[oi][0]);
          var end = Number(segmentOffsets[oi][1]);
          if (start > cursor) {
            frag.appendChild(document.createTextNode(text.slice(cursor, start)));
          }
          // Render each token individually for dictionary inspection
          var built = buildTokenSpan(oi, segments[oi], gramOverlay, resultsBySeg, udTokenMap);
          applyPlainTextNoWrap(built.span);
          frag.appendChild(built.span);
          if (built.hasGrammar) grammarCount++;
          if (built.isUnknown) unknownCount++;
          cursor = end;
          // Map each segment to its own element (NER spans are expanded later for highlighting).
          registerTokenSpan(oi, built.span);
        }
        if (cursor < text.length) {
          frag.appendChild(document.createTextNode(text.slice(cursor)));
        }
      }

      renderedText.innerHTML = '';
      renderedText.appendChild(frag);
      hideNerHover();
      statusText.textContent = 'Segmented ' + n + ' tokens.';
      attachHoverHandlers(renderedText, resultsBySeg, gramOverlay);
      // Defer row band caching to avoid blocking render
      requestAnimationFrame(function() { computeAndCacheRowBands(); });
      requestAnimationFrame(function() { buildUdRectCache(); });
      return;
    }
    var buffer = '';
    function flushBuffer() { if (buffer) { frag.appendChild(document.createTextNode(buffer)); buffer = ''; } }
    var segIndex = 0, len = text.length;
    for (var i = 0; i < len; i++) {
      var ch = text[i];
      if (isMyanmarChar(ch) && segIndex < n) {
        var token = segments[segIndex];
        if (token) {
          var match = matchTokenWithInvisibleChars(text, i, token);
          if (match) {
            flushBuffer();
            // Render each token individually for dictionary inspection
            var built = buildTokenSpan(segIndex, token, gramOverlay, resultsBySeg, udTokenMap);
            applyPlainTextNoWrap(built.span);
            frag.appendChild(built.span);
            if (built.hasGrammar) grammarCount++;
            if (built.isUnknown) unknownCount++;
            // Map each segment to its own element (NER spans are expanded later for highlighting).
            registerTokenSpan(segIndex, built.span);

            i = match.end;
            segIndex++;
            continue;
          }
        }
      }
      buffer += ch;
    }
    flushBuffer();
    renderedText.innerHTML = '';
    renderedText.appendChild(frag);
    hideNerHover();
    statusText.textContent = 'Segmented ' + n + ' tokens.';
    attachHoverHandlers(renderedText, resultsBySeg, gramOverlay);
    // Defer row band caching to avoid blocking render
    requestAnimationFrame(function() { computeAndCacheRowBands(); });
      requestAnimationFrame(function() { buildUdRectCache(); });
  }
  var currentSpan = null;
  var panelHoverToken = null;
  var panelHoverType = null;
  var lookupCache = new Map();
  var subsegCache = new Map();
  var fuzzyCache = new Map(); // Cache fuzzy matching results
  var lastMouseX = 0, lastMouseY = 0;
  /* NEW: annotation state */
  var noteCache = new Map();
  var currentPopupHead = null;

  // === PERFORMANCE CACHES ===
  var cachedRowBands = null;           // Row bands for popup positioning (computed once per render)
  var cachedRowSnapPoints = null;      // Snap points derived from row bands
  var cachedRowGapRanges = null;       // Gap ranges between rows
  var hoverRafId = null;               // requestAnimationFrame ID for debouncing
  var pendingHoverEvent = null;        // Pending hover event data
  var lastHoverProcessTime = 0;        // Last time hover was processed (for throttling)
  var hoverThrottleMs = 8;             // Minimum ms between hover updates (~120fps max)

  // Fix zero-width reader tokens by applying min-width styling
  function fixZeroWidthReaderTokens() {
    if (!renderedText) return;
    // Defer until browser finishes layout
    requestAnimationFrame(function() {
      var tokens = renderedText.querySelectorAll('.reader-token');
      tokens.forEach(function(tok) {
        var r = tok.getBoundingClientRect();
        if (r.width === 0) {
          tok.style.display = 'inline-block';
          tok.style.minWidth = '0.6em';
        }
      });
    });
  }

  // Compute and cache row bands from rendered text (call once after rendering)
  function computeAndCacheRowBands() {
    cachedRowBands = null;
    cachedRowSnapPoints = null;
    cachedRowGapRanges = null;
    if (!renderedText) return;
    try {
      var rowEls = renderedText.querySelectorAll('.reader-token');
      if (!rowEls.length) return;
      var bands = [];
      var tol = 6;
      for (var i = 0; i < rowEls.length; i++) {
        var r = rowEls[i].getBoundingClientRect();
        if (!r || r.width <= 0 || r.height <= 0) continue;
        var match = null;
        for (var j = 0; j < bands.length; j++) {
          if (Math.abs(bands[j].top - r.top) <= tol) { match = bands[j]; break; }
        }
        if (!match) {
          bands.push({ top: r.top, bottom: r.bottom });
        } else {
          match.top = Math.min(match.top, r.top);
          match.bottom = Math.max(match.bottom, r.bottom);
        }
      }
      bands.sort(function(a, b) { return a.top - b.top; });
      cachedRowBands = bands;
    } catch (e) {}
  }

  // Invalidate row band cache (call on resize/scroll)
  function invalidateRowBandCache() {
    cachedRowBands = null;
    cachedRowSnapPoints = null;
    cachedRowGapRanges = null;
  }

  function attachHoverHandlers(container, resultsBySeg, gramOverlay) {
    var lastHighlightedSegIdx = -2; // Track which clause is currently highlighted for static display

    // In original PDF view, a single rendered span (one PDF "word" / island fragment) may correspond to
    // multiple Burmese segments. This resolver chooses the most plausible segIdx under the pointer.
    function resolveSegIdxForSpan(span, clientX) {
      if (!span) return -1;
      var idx = parseInt(span.dataset.index || '-1', 10);
      var segList = (span.dataset.segments || '').split(',').map(function(x){ return parseInt(x, 10); }).filter(function(n){ return isFinite(n) && n >= 0; });
      if (segList.length <= 1) return idx;

      // If we don't have offsets, fall back to the canonical earliest index.
      if (!latestSegmentOffsets || !Array.isArray(latestSegmentOffsets) || !latestSegmentOffsets.length) {
        return idx;
      }

      // Estimate a character position within the synthetic layout text based on pointer x within the span.
      var wStart = parseInt(span.dataset.wordStart || 'NaN', 10);
      var wEnd = parseInt(span.dataset.wordEnd || 'NaN', 10);
      if (!isFinite(wStart) || !isFinite(wEnd) || wEnd <= wStart) {
        // No word-span offsets - choose the smallest seg whose offsets overlap anything.
        segList.sort(function(a,b){ return a-b; });
        return segList[0];
      }
      var rect = span.getBoundingClientRect ? span.getBoundingClientRect() : null;
      var spanW = rect ? rect.width : 0;
      var t = 0.0;
      if (rect && spanW > 1) {
        t = (clientX - rect.left) / spanW;
      }
      if (t < 0) t = 0;
      if (t > 0.999) t = 0.999;
      var estChar = wStart + Math.floor(t * (wEnd - wStart));
      if (estChar < wStart) estChar = wStart;
      if (estChar >= wEnd) estChar = wEnd - 1;

      // Pick the segment whose offset range contains estChar; otherwise choose nearest.
      var best = idx;
      var bestDist = 1e18;
      for (var i = 0; i < segList.length; i++) {
        var si = segList[i];
        var off = latestSegmentOffsets[si];
        if (!off || off.length < 2) continue;
        var s0 = Number(off[0]), s1 = Number(off[1]);
        if (!isFinite(s0) || !isFinite(s1)) continue;
        if (estChar >= s0 && estChar < s1) {
          return si;
        }
        var dist = 0;
        if (estChar < s0) dist = s0 - estChar; else if (estChar >= s1) dist = estChar - (s1 - 1);
        if (dist < bestDist) {
          bestDist = dist;
          best = si;
        }
      }
      return best;
    }

    // Process deferred hover updates (called via RAF)
    function processHoverUpdate(data) {
      var segIdx = data.segIdx;
      var subtoken = data.subtoken;
      var clientX = data.clientX;
      var clientY = data.clientY;

      // Apply clause highlighting only when entering a different clause span
      // For context window mode, always recompute since the window is centered on each token
      if (segIdx >= 0) {
        var needsRecompute = !currentChunkHighlightTokens || !currentChunkHighlightTokens.has(segIdx);
        // Context window mode: always recompute when moving to a different token
        if (displaySettings.contextWindow && segIdx !== lastHighlightedSegIdx) {
          needsRecompute = true;
        }
        if (needsRecompute) {
          applyChunkHighlight(segIdx);
          lastHighlightedSegIdx = segIdx;
        }
      } else if (segIdx < 0) {
        hideNerHover();
        clearChunkHighlight();
        lastHighlightedSegIdx = -2;
        hideHoverReticle();
      }

      // Update UD lines and NER tags for the current token
      if (segIdx >= 0) {
        if (displaySettings.udOverlay && segIdx !== lastUdSegIdx) {
          drawUdLinesForToken(segIdx);
          lastUdSegIdx = segIdx;
        }
        renderNerHoverForToken(segIdx);
      } else {
        lastUdSegIdx = -1;
        hideHoverReticle();
      }

      positionPopup(clientX, clientY);
      positionSubsegmentPopups();
    }

    container.onmousemove = function(ev) {
      var span = ev.target && ev.target.closest('.reader-token');
      if (!span) {
        currentSpan = null;
        hidePopup();
        hideUdLines();
        hideNerHover();
        clearChunkHighlight();
        lastHighlightedSegIdx = -2;
        hideHoverReticle();
        lastUdSegIdx = -1;
        // Cancel any pending RAF
        if (hoverRafId) { cancelAnimationFrame(hoverRafId); hoverRafId = null; }
        return;
      }
      if (span.classList.contains('reader-punct')) {
        currentSpan = null;
        hidePopup();
        hideUdLines();
        hideNerHover();
        clearChunkHighlight();
        lastHighlightedSegIdx = -2;
        hideHoverReticle();
        lastUdSegIdx = -1;
        // Cancel any pending RAF
        if (hoverRafId) { cancelAnimationFrame(hoverRafId); hoverRafId = null; }
        return;
      }

      // Resolve the most plausible segment index under the pointer.
      var segIdx = resolveSegIdxForSpan(span, ev.clientX);

      // Keep the span's canonical index in sync with the current pointer-resolved seg,
      // so downstream UI code that reads span.dataset.index stays consistent during hover.
      if (segIdx >= 0 && span.dataset && String(span.dataset.index) !== String(segIdx)) {
        span.dataset.index = String(segIdx);
        if (latestSegments && latestSegments[segIdx]) span.dataset.seg = String(latestSegments[segIdx]);
      }

      // Check if we're hovering over a subtoken (dictionary word)
      var subtoken = ev.target && ev.target.closest('.reader-subtoken');

      // Immediate updates: popup content (for responsiveness)
      if (subtoken) {
        if (subtoken !== currentSpan) {
          currentSpan = subtoken;
          buildPopupForWord(subtoken, span, segIdx, resultsBySeg, gramOverlay);
        }
      } else {
        // Hovering over main token (no subtokens)
        if (span !== currentSpan) {
          currentSpan = span;
          buildPopupForSpan(span, resultsBySeg, gramOverlay);
        }
      }

      // Free-floating hover reticle (dict-fill tokens only)
      if (subtoken) {
        showHoverReticle(subtoken);
      } else if (isOriginalView && currentFileType === 'docx') {
        // DOCX original view: show reticle on main token spans as well
        showHoverReticle(span);
      } else {
        hideHoverReticle();
      }

      // Throttle expensive visual updates via RAF
      var now = performance.now();
      var timeSinceLastProcess = now - lastHoverProcessTime;

      // Store pending data
      pendingHoverEvent = {
        segIdx: segIdx,
        subtoken: subtoken,
        clientX: ev.clientX,
        clientY: ev.clientY
      };

      // If enough time has passed, process immediately; otherwise schedule RAF
      if (timeSinceLastProcess >= hoverThrottleMs) {
        lastHoverProcessTime = now;
        if (hoverRafId) { cancelAnimationFrame(hoverRafId); hoverRafId = null; }
        processHoverUpdate(pendingHoverEvent);
      } else if (!hoverRafId) {
        hoverRafId = requestAnimationFrame(function() {
          hoverRafId = null;
          lastHoverProcessTime = performance.now();
          if (pendingHoverEvent) {
            processHoverUpdate(pendingHoverEvent);
          }
        });
      }
    };
    container.onmouseleave = function() {
      currentSpan = null;
      hidePopup();
      hideUdLines();
      hideNerHover();
      hideHoverReticle();
      clearChunkHighlight();
      lastHighlightedSegIdx = -2;
      lastUdSegIdx = -1;
      // Cancel any pending RAF
      if (hoverRafId) { cancelAnimationFrame(hoverRafId); hoverRafId = null; }
      pendingHoverEvent = null;
    };
    container.onclick = function(ev) {
      var span = ev.target && ev.target.closest('.reader-token');
      if (!span) return;
      if (span.classList.contains('reader-punct')) return;

      // Resolve the most plausible segment index for click location.
      var segIdx = resolveSegIdxForSpan(span, ev.clientX);
      if (segIdx >= 0 && span.dataset && String(span.dataset.index) !== String(segIdx)) {
        span.dataset.index = String(segIdx);
        if (latestSegments && latestSegments[segIdx]) span.dataset.seg = String(latestSegments[segIdx]);
      }

      // Check if we clicked on a subtoken
      var subtoken = ev.target && ev.target.closest('.reader-subtoken');
      if (subtoken) {
        // Use dataset.word (clean text without dotted circle) for pipeline operations
        var word = subtoken.dataset.word || subtoken.textContent || '';
        if (!word) return;
        var isUnknownPiece = subtoken.classList && subtoken.classList.contains('unknown-subtoken');
        togglePanel(true);
        lookupAndDisplay(word, {
          raw: true,
          exact: true,
          allowFuzzy: isUnknownPiece,
          segIdx: segIdx,
          baseToken: span.dataset.seg || '',
          unknownPiece: isUnknownPiece ? word : ''
        });
        // Trigger fuzzy matching using the neural token (parent .reader-token)
        var baseToken = span.dataset.seg || '';
        if (baseToken && isUnknownPiece) {
          setTimeout(function() {
            runSmartFuzzyMatching(baseToken, {
              segIdx: segIdx,
              unknownPiece: isUnknownPiece ? word : ''
            });
          }, 100);
        }
      } else {
        // Clicked on main token
        var seg = span.dataset.seg || '';
        if (!seg) return;
        var isUnknownMain = span.classList && span.classList.contains('unknown-token');
        togglePanel(true);
        lookupAndDisplay(seg, {
          raw: true,
          exact: true,
          allowFuzzy: isUnknownMain,
          segIdx: segIdx,
          baseToken: seg,
          unknownPiece: isUnknownMain ? seg : ''
        });
        if (isUnknownMain) {
          setTimeout(function() {
            runSmartFuzzyMatching(seg, { segIdx: segIdx, unknownPiece: seg });
          }, 100);
        }
      }
    };
  }
  function buildPopupForWord(wordSpan, parentToken, segIdx, resultsBySeg, gramOverlay) {
    if (!wordSpan) return hidePopup();
    // Use dataset.word or dataset.seg (clean text without dotted circle) for pipeline operations
    var word = wordSpan.dataset.word || wordSpan.dataset.seg || wordSpan.textContent || '';
    if (!word) return hidePopup();

    // Handle grammar popup (from parent segment)
    var tInfo = (segIdx >= 0 && gramOverlay) ? (gramOverlay[segIdx] || {}) : {};
    var grammarEntries = Array.isArray(tInfo.grammar) ? tInfo.grammar.filter(function(g){ return g && g.type && g.type !== 'UNKNOWN'; }) : [];
    if (grammarEntries.length && displaySettings.grammarPopup) {
      var grammarHtml = '';
      for (var gei = 0; gei < grammarEntries.length; gei++) {
        var ge = grammarEntries[gei];
        if (!ge) continue;
        var gType = ge.type || ge.category || '';
        var gColor = getGrammarColor(gType);
        grammarHtml += '<div class="popup-grammar-entry">';
        if (gType) grammarHtml += '<span class="type" style="background:' + gColor + ';color:white;">' + escapeHtml(gType) + '</span>';
        grammarHtml += '<span>' + escapeHtml(ge.gloss || '') + '</span></div>';
      }
      grammarPopup.innerHTML = grammarHtml;
      grammarPopup.style.display = 'block';
      hoverPopup.classList.add('has-grammar');
    } else {
      grammarPopup.style.display = 'none';
      hoverPopup.classList.remove('has-grammar');
    }

    var dictHtml = '';
    var g2pData = null;
    var res = (resultsBySeg && resultsBySeg[segIdx]) ? resultsBySeg[segIdx] : null;
    var dictFill = (res && Array.isArray(res.dict_fill)) ? res.dict_fill : [];
    var fillIdx = (wordSpan.dataset && wordSpan.dataset.fillIdx) ? parseInt(wordSpan.dataset.fillIdx, 10) : -1;
    var entry = (fillIdx >= 0 && dictFill[fillIdx]) ? dictFill[fillIdx] : null;
    if (!entry && res) entry = res;
    if (!entry) return hidePopup();

    var udTok = getUdInfoForSegment(segIdx);
    var posData = resolveSegmentPosData(segIdx, res, udTok);

    dictHtml = '<div class="popup-headline">' + escapeHtml(word);
    // Add UPOS (coarse POS like NOUN, VERB) with colored background
    if (posData && posData.upos_label) {
      var uposStyle = 'display:inline-block;padding:2px 6px;margin-left:6px;border-radius:3px;font-size:10px;font-weight:600;';
      if (posData.upos_color) {
        uposStyle += 'background-color:' + posData.upos_color + ';color:#000;';
      }
      dictHtml += '<span class="pos-badge" title="Coarse POS (UPOS)" style="' + uposStyle + '">' + escapeHtml(posData.upos_label) + '</span>';
    }
    // Add dependency relation (mark, case, nsubj, ROOT, etc.) with gray background
    var depLabel = (posData && (posData.dep_label || posData.dep)) || '';
    if (!depLabel && udTok && udTok.dep) {
      depLabel = udTok.dep;
    }
    if (depLabel && depLabel.toLowerCase() === 'root') depLabel = 'ROOT';
    if (depLabel) {
      var depStyle = 'display:inline-block;padding:2px 6px;margin-left:4px;border-radius:3px;font-size:10px;font-weight:500;background-color:#e5e7eb;color:#374151;';
      dictHtml += '<span class="dep-badge" title="Dependency relation" style="' + depStyle + '">' + escapeHtml(depLabel) + '</span>';
    }
    dictHtml += '</div>';

    // Extract g2p from the individual word's entry
    g2pData = entry.g2p || null;

    var isUnknownEntry = function(obj) {
      if (!obj) return true;
      var p = (obj.pos || '').toLowerCase();
      var ss = obj.senses || [];
      return p.indexOf('unknown') >= 0 || (ss.length === 1 && typeof ss[0] === 'string' && ss[0].toLowerCase().indexOf('no dictionary entry') >= 0);
    };

    if (!isUnknownEntry(entry)) {
      var senses = Array.isArray(entry.senses) ? entry.senses : [];
      if (senses.length) {
        dictHtml += renderSenseLines(senses, word);
      } else {
        dictHtml += '<div class="popup-empty">[no senses]</div>';
      }
    } else {
      // Unknown word - style the headline in red with romanization
      dictHtml = '<div class="popup-headline" style="color:#c00;font-weight:bold;">' + escapeHtml(word) + '</div>';
      if (g2pData && Array.isArray(g2pData.syllables) && g2pData.syllables.length) {
        dictHtml += '<div style="font-size:0.85em;color:#666;">';
        for (var si = 0; si < g2pData.syllables.length; si++) {
          var syll = g2pData.syllables[si];
          if (syll && syll.roman) dictHtml += escapeHtml(syll.roman) + ' ';
        }
        dictHtml += '</div>';
      }
    }
    displayWordPopup(dictHtml, word, segIdx, g2pData);
  }
  function renderSubsegmentPopups(subsegments) {
    // Helper to check if entry is unknown
    function isUnknownEntry(obj) {
      if (!obj) return true;
      var p = (obj.pos || '').toLowerCase();
      var ss = obj.senses || [];
      return p.indexOf('unknown') >= 0 ||
             (ss.length === 1 && typeof ss[0] === 'string' &&
              ss[0].toLowerCase().indexOf('no dictionary entry') >= 0);
    }

    // Create popup elements for each subsegment (same as regular dict popup but no POS/dep tags)
    for (var i = 0; i < subsegments.length; i++) {
      var sub = subsegments[i];
      if (!sub || !sub.head) continue;

      var popupDiv = document.createElement('div');
      popupDiv.className = 'subsegment-popup';

      var html = '';

      // Headword (no POS or dep tags)
      html += '<div class="popup-headline">' + escapeHtml(sub.head) + '</div>';

      var isUnk = isUnknownEntry(sub);

      // Romanization if unknown
      if (isUnk && sub.g2p && Array.isArray(sub.g2p.syllables) && sub.g2p.syllables.length) {
        html += '<div style="font-size:0.85em;color:#666;">';
        for (var si = 0; si < sub.g2p.syllables.length; si++) {
          var syll = sub.g2p.syllables[si];
          if (syll && syll.roman) html += escapeHtml(syll.roman) + ' ';
        }
        html += '</div>';
      }

      // Senses if known
      if (!isUnk && Array.isArray(sub.senses) && sub.senses.length) {
        html += renderSenseLines(sub.senses, sub.head);
      }

      popupDiv.innerHTML = html;
      subsegmentPopupsContainer.appendChild(popupDiv);
    }

    // Show the container if we have subsegments
    if (subsegmentPopupsContainer.children.length > 0) {
      subsegmentPopupsContainer.style.display = 'flex';
      positionSubsegmentPopups();
    }
  }

  function fetchAndDisplaySubsegmentPopups(word) {
    if (!word || !subsegmentPopupsContainer) return;

    // Clear existing subsegment popups
    subsegmentPopupsContainer.innerHTML = '';
    subsegmentPopupsContainer.style.display = 'none';

    // Check cache first to avoid lag
    if (subsegCache.has(word)) {
      var cached = subsegCache.get(word);
      if (cached && cached.length >= 1) {
        renderSubsegmentPopups(cached);
      }
      return;
    }

    // Fetch subsegments from server
    fetch('/subsegments?token=' + encodeURIComponent(word))
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        if (!data.ok || !data.subsegments || data.subsegments.length < 1) {
          return;
        }

        var subsegments = data.subsegments;
        // Cache the result
        subsegCache.set(word, subsegments);

        renderSubsegmentPopups(subsegments);
      })
      .catch(function(err) {
        console.error('Failed to fetch subsegments:', err);
      });
  }

  function positionSubsegmentPopups() {
    if (!subsegmentPopupsContainer || !hoverPopupContainer) return;
    if (subsegmentPopupsContainer.style.display === 'none') return;
    if (hoverPopupContainer.style.display === 'none') return;

    var vw = window.innerWidth;
    var vh = window.innerHeight;
    invalidateUiRectFor(hoverPopupContainer);
    var mainRect = getUiRect(hoverPopupContainer);
    var gap = 8;
    var pad = 8;

    // Start with vertical (column) layout
    subsegmentPopupsContainer.style.flexDirection = 'column';
    subsegmentPopupsContainer.style.flexWrap = 'nowrap';
    subsegmentPopupsContainer.style.left = '0px';
    subsegmentPopupsContainer.style.top = '0px';
    invalidateUiRectFor(subsegmentPopupsContainer);
    var subRect = getUiRect(subsegmentPopupsContainer);
    var subW = subRect.width;
    var subH = subRect.height;

    // If vertical layout is too tall, switch to horizontal (row)
    if (subH > vh - pad * 2) {
      subsegmentPopupsContainer.style.flexDirection = 'row';
      subsegmentPopupsContainer.style.flexWrap = 'wrap';
      invalidateUiRectFor(subsegmentPopupsContainer);
      subRect = getUiRect(subsegmentPopupsContainer);
      subW = subRect.width;
      subH = subRect.height;
    }

    // Try right of main popup first
    var x = mainRect.right + gap;
    var y = mainRect.top;

    // If goes off right edge, try left of main popup
    if (x + subW > vw - pad) {
      x = mainRect.left - gap - subW;
    }

    // If still off left edge, position at left edge
    if (x < pad) {
      x = pad;
    }

    // Vertical: keep on screen
    if (y + subH > vh - pad) {
      y = vh - pad - subH;
    }
    if (y < pad) {
      y = pad;
    }

    subsegmentPopupsContainer.style.left = x + 'px';
    subsegmentPopupsContainer.style.top = y + 'px';
  }

  function displayWordPopup(dictHtml, word, segIdx, g2pData) {
    currentPopupHead = word;
    if (displaySettings.dictPopup) {
      hoverPopup.innerHTML = dictHtml;
      hoverPopup.style.display = 'block';
    } else {
      hoverPopup.style.display = 'none';
    }
    // Set pronunciation popup for the individual word
    setG2PPopup(g2pData);
    // UD popup for the parent segment
    if (udPopup) {
      if (displaySettings.udPopup && segIdx >= 0) {
        var udHtml = buildUdPopupHtml(segIdx);
        if (udHtml) {
          udPopup.innerHTML = udHtml;
          udPopup.style.display = 'block';
        } else {
          udPopup.style.display = 'none';
          udPopup.innerHTML = '';
        }
      } else {
        udPopup.style.display = 'none';
        udPopup.innerHTML = '';
      }
    }
    var anyPopupVisible = (displaySettings.pronunciation && g2pPopup && g2pPopup.style.display !== 'none') ||
                          (displaySettings.udPopup && udPopup && udPopup.style.display !== 'none') ||
                          (displaySettings.grammarPopup && grammarPopup && grammarPopup.style.display !== 'none') ||
                          (displaySettings.dictPopup && hoverPopup && hoverPopup.style.display !== 'none') ||
                          displaySettings.comments;
    hoverPopupContainer.style.display = anyPopupVisible ? 'flex' : 'none';
    if (displaySettings.comments) {
      updateNotePopupForHead(word);
    }
    // Fetch and display subsegment popups if enabled
    if (displaySettings.subsegmentPopups && subsegmentPopupsContainer && word) {
      fetchAndDisplaySubsegmentPopups(word);
    } else if (subsegmentPopupsContainer) {
      subsegmentPopupsContainer.style.display = 'none';
      subsegmentPopupsContainer.innerHTML = '';
    }
  }
  function buildPopupForSpan(span, resultsBySeg, gramOverlay) {
    if (!span) return;
    var idx = parseInt(span.dataset.index || '-1', 10);
    var seg = span.dataset.seg || '';
    if (!seg || isNaN(idx)) { hidePopup(); return; }
    var res = (resultsBySeg && idx >= 0) ? resultsBySeg[idx] : null;
    var tInfo = gramOverlay[idx] || {};
    var grammarEntries = Array.isArray(tInfo.grammar) ? tInfo.grammar.filter(function(g){ return g && g.type && g.type !== 'UNKNOWN'; }) : [];
    var head = seg, g2pData = null;
    if (res) {
      head = res.head || seg;
      g2pData = res.g2p || null;
    }
    if (grammarEntries.length && displaySettings.grammarPopup) {
      var grammarHtml = '';
      for (var gei = 0; gei < grammarEntries.length; gei++) {
        var ge = grammarEntries[gei];
        if (!ge) continue;
        var gType = ge.type || ge.category || '';
        var gColor = getGrammarColor(gType);
        grammarHtml += '<div class="popup-grammar-entry">';
        if (gType) grammarHtml += '<span class="type" style="background:' + gColor + ';color:white;">' + escapeHtml(gType) + '</span>';
        grammarHtml += '<span>' + escapeHtml(ge.gloss || '') + '</span></div>';
      }
      grammarPopup.innerHTML = grammarHtml;
      grammarPopup.style.display = 'block';
      hoverPopup.classList.add('has-grammar');
    } else {
      grammarPopup.style.display = 'none';
      hoverPopup.classList.remove('has-grammar');
    }
    setG2PPopup(g2pData);

    // Determine if entry is unknown BEFORE building the headline
    var dictHtml = '';
    var mainIsUnknown = false;

    if (res && displaySettings.dictPopup) {
      var firstD = res;
      function isUnknownEntry(obj) {
        if (!obj) return true;
        var p = (obj.pos || '').toLowerCase();
        var ss = obj.senses || [];
        return p.indexOf('unknown') >= 0 || (ss.length === 1 && typeof ss[0] === 'string' && ss[0].toLowerCase().indexOf('no dictionary entry') >= 0);
      }
      var fill = Array.isArray(firstD.dict_fill) ? firstD.dict_fill : [];
      var fillHasKnown = (typeof firstD.dict_fill_has_known === 'boolean') ? firstD.dict_fill_has_known : false;
      var fillHasUnknown = (typeof firstD.dict_fill_has_unknown === 'boolean') ? firstD.dict_fill_has_unknown : false;
      if ((typeof firstD.dict_fill_has_known !== 'boolean' || typeof firstD.dict_fill_has_unknown !== 'boolean') && fill.length) {
        for (var pi = 0; pi < fill.length; pi++) {
          if (isUnknownEntry(fill[pi])) fillHasUnknown = true; else fillHasKnown = true;
        }
      }

      // Check if main entry is unknown
      var hasKnownFill = fillHasKnown && fill.length > 0;
      var hasAnyContent = (Array.isArray(firstD.senses) ? firstD.senses.length : 0) || hasKnownFill;
      mainIsUnknown = (firstD.pos || '').toLowerCase().indexOf('unknown') >= 0 || !hasAnyContent || (fill.length && !fillHasKnown);
    }

    // Build headline with proper color for unknowns
    var udTok = getUdInfoForSegment(idx);
    var posData = resolveSegmentPosData(idx, res, udTok);
    if (mainIsUnknown && displaySettings.dictPopup) {
      // Unknown entry - red headline + romanization (no POS/dep badges)
      dictHtml = '<div class="popup-headline" style="color:#c00;font-weight:bold;">' + escapeHtml(head);
      // Add UD tags (compound, noun, etc.) next to headword
      var udTags = buildUdTagsForHeadline(idx);
      if (udTags) dictHtml += udTags;
      dictHtml += '</div>';
      if (g2pData && Array.isArray(g2pData.syllables) && g2pData.syllables.length) {
        dictHtml += '<div style="font-size:0.85em;color:#666;">';
        for (var si = 0; si < g2pData.syllables.length; si++) {
          var syll = g2pData.syllables[si];
          if (syll && syll.roman) dictHtml += escapeHtml(syll.roman) + ' ';
        }
        dictHtml += '</div>';
      }
    } else {
      // Known entry - black headline with POS badge
      dictHtml = '<div class="popup-headline">' + escapeHtml(head);
      if (posData && posData.upos_label) {
        var uposStyleK = 'display:inline-block;padding:2px 6px;margin-left:6px;border-radius:3px;font-size:10px;font-weight:600;';
        if (posData.upos_color) uposStyleK += 'background-color:' + posData.upos_color + ';color:#000;';
        dictHtml += '<span class="pos-badge" title="Coarse POS (UPOS)" style="' + uposStyleK + '">' + escapeHtml(posData.upos_label) + '</span>';
      }
      var depLabelK = (posData && (posData.dep_label || posData.dep)) || '';
      if (depLabelK && depLabelK.toLowerCase() === 'root') depLabelK = 'ROOT';
      if (depLabelK) {
        var depStyleK = 'display:inline-block;padding:2px 6px;margin-left:4px;border-radius:3px;font-size:10px;font-weight:500;background-color:#e5e7eb;color:#374151;';
        dictHtml += '<span class="dep-badge" title="Dependency relation" style="' + depStyleK + '">' + escapeHtml(depLabelK) + '</span>';
      }
      // Add UD tags (compound, noun, etc.) next to headword
      var udTags = buildUdTagsForHeadline(idx);
      if (udTags) dictHtml += udTags;
      dictHtml += '</div>';

      // Add content for known entries
      if (res && displaySettings.dictPopup) {
        var firstD = res;
        function isUnknownEntry(obj) {
          if (!obj) return true;
          var p = (obj.pos || '').toLowerCase();
          var ss = obj.senses || [];
          return p.indexOf('unknown') >= 0 || (ss.length === 1 && typeof ss[0] === 'string' && ss[0].toLowerCase().indexOf('no dictionary entry') >= 0);
        }
        var fill = Array.isArray(firstD.dict_fill) ? firstD.dict_fill : [];
        var fillHasKnown = (typeof firstD.dict_fill_has_known === 'boolean') ? firstD.dict_fill_has_known : false;
        var fillHasUnknown = (typeof firstD.dict_fill_has_unknown === 'boolean') ? firstD.dict_fill_has_unknown : false;
        if ((typeof firstD.dict_fill_has_known !== 'boolean' || typeof firstD.dict_fill_has_unknown !== 'boolean') && fill.length) {
          for (var pi = 0; pi < fill.length; pi++) {
            if (isUnknownEntry(fill[pi])) fillHasUnknown = true; else fillHasKnown = true;
          }
        }

        if (fill.length && fillHasKnown) {
          // Find the first known entry
          var firstKnownEntry = null;
          for (var di = 0; di < fill.length; di++) {
            if (!isUnknownEntry(fill[di])) {
              firstKnownEntry = fill[di];
              break;
            }
          }

          // Render only the first known entry
          if (firstKnownEntry) {
            var pHead = firstKnownEntry.head || '';
            var pSenses = Array.isArray(firstKnownEntry.senses) ? firstKnownEntry.senses : [];
            if (pHead && pHead !== head) {
              dictHtml += '<div style="font-weight:bold;margin-top:6px;">' + escapeHtml(pHead) + '</div>';
            }
            if (pSenses.length) {
              dictHtml += renderSenseLines(pSenses, head);
            }
          }

          // If ANY unknown content exists within the token, show fuzzy guesses for the whole token.
          if (fillHasUnknown) {
            dictHtml += '<div class="popup-empty" style="margin-top:6px;">[contains unknown — click to run fuzzy]</div>';
          }
        } else {
          // Back-compat: old single-entry render path
          var senses = Array.isArray(firstD.senses) ? firstD.senses : [];
          if (senses.length) {
            dictHtml += renderSenseLines(senses, head);
            }
          }
        }
      }
    // Pronunciation stays in the dedicated G2P popup only
    currentPopupHead = head;
    if (notePopup) {
      notePopup.textContent = '';
      notePopup.style.display = 'none';
    }
    if (udPopup) {
      if (displaySettings.udPopup) {
        var udHtml = buildUdPopupHtml(idx);
        if (udHtml) {
          udPopup.innerHTML = udHtml;
          udPopup.style.display = 'block';
        } else {
          udPopup.style.display = 'none';
          udPopup.innerHTML = '';
        }
      } else {
        udPopup.style.display = 'none';
        udPopup.innerHTML = '';
      }
    }
    if (displaySettings.dictPopup) {
      hoverPopup.innerHTML = dictHtml;
      hoverPopup.style.display = 'block';
    } else {
      hoverPopup.style.display = 'none';
    }
    // Show container if any popup is enabled
    var anyPopupVisible = (displaySettings.pronunciation && g2pPopup && g2pPopup.style.display !== 'none') ||
                          (displaySettings.udPopup && udPopup && udPopup.style.display !== 'none') ||
                          (displaySettings.grammarPopup && grammarPopup && grammarPopup.style.display !== 'none') ||
                          (displaySettings.dictPopup && hoverPopup && hoverPopup.style.display !== 'none') ||
                          displaySettings.comments;
    hoverPopupContainer.style.display = anyPopupVisible ? 'flex' : 'none';
    if (displaySettings.comments) {
      updateNotePopupForHead(head);
    }
  }
  function positionPopup(clientX, clientY) {
    if (hoverPopupContainer.style.display !== 'flex') return;
    var vw = window.innerWidth, vh = window.innerHeight;

    // Refresh container rect to account for scrolling/layout changes
    // This is critical: udContainerRect is used for coordinate conversions,
    // and if stale, all positions will be offset by the scroll amount
    if (renderedText) {
      udContainerRect = renderedText.getBoundingClientRect();
    }

    hoverPopupContainer.style.left = '0px';
    hoverPopupContainer.style.top = '0px';
    invalidateUiRectFor(hoverPopupContainer);

    // Measure each visible popup individually (store relative positions) - DIRECT DOM
    var popups = [hoverPopup, grammarPopup, udPopup, g2pPopup, notePopup];
    var popupRects = []; // Array of {left, top, width, height} relative to container origin
    var minLeft = Infinity, minTop = Infinity, maxRight = 0, maxBottom = 0;
    var hasVisiblePopup = false;
    for (var pi = 0; pi < popups.length; pi++) {
      var p = popups[pi];
      if (!p || p.style.display === 'none') continue;
      var pr = p.getBoundingClientRect();
      if (!pr || pr.width <= 0 || pr.height <= 0) continue;
      hasVisiblePopup = true;
      popupRects.push({ left: pr.left, top: pr.top, width: pr.width, height: pr.height, right: pr.right, bottom: pr.bottom });
      if (pr.left < minLeft) minLeft = pr.left;
      if (pr.top < minTop) minTop = pr.top;
      if (pr.right > maxRight) maxRight = pr.right;
      if (pr.bottom > maxBottom) maxBottom = pr.bottom;
    }
    // If no visible popups, exit early
    if (!hasVisiblePopup) return;
    var w = maxRight - minLeft;
    var h = maxBottom - minTop;
    // Convert popup rects to be relative to the combined bounding box origin
    for (var pri = 0; pri < popupRects.length; pri++) {
      popupRects[pri].left -= minLeft;
      popupRects[pri].top -= minTop;
    }

    function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
    function rectsOverlap(a, b) {
      return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    }

    // no screen-bounds gating

    // Get hovered token rect - DIRECT DOM measurement for accuracy
    var anchorRect = null;
    try {
      var anchorTokenSpan = null;
      if (currentSpan && renderedText && renderedText.contains(currentSpan)) {
        anchorTokenSpan = currentSpan.classList.contains('reader-subtoken')
          ? currentSpan.closest('.reader-token')
          : currentSpan;
      }
      if (anchorTokenSpan) {
        var r = anchorTokenSpan.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) {
          anchorRect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        }
      }
    } catch (e) {}

    // === COLLECT FORBIDDEN REGIONS (DOM-based for reliability) ===
    var forbiddenRegions = [];

    // 1. UD lines - query DOM directly for all visible .ud-dep-line paths
    var udLinePoints = [];
    var udLineThickness = 2;
    var udPaths = document.querySelectorAll('.ud-dep-line');
    for (var ei = 0; ei < udPaths.length; ei++) {
      var el = udPaths[ei];
      var lineKey = el.getAttribute('data-from-idx') + '-' + el.getAttribute('data-to-idx');
      try {
        var pathLen = el.getTotalLength();
        var sampleStep = 50;
        for (var t = 0; t <= pathLen; t += sampleStep) {
          var pt = el.getPointAtLength(t);
          var svgEl = el.ownerSVGElement;
          if (svgEl && svgEl.createSVGPoint) {
            var svgPoint = svgEl.createSVGPoint();
            svgPoint.x = pt.x;
            svgPoint.y = pt.y;
            var ctm = el.getScreenCTM();
            if (ctm) {
              var screenPoint = svgPoint.matrixTransform(ctm);
              udLinePoints.push({ x: screenPoint.x, y: screenPoint.y, line: lineKey });
            }
          }
        }
      } catch (e) {}
    }

    // 2. Highlighted POS chunk tokens - query DOM for .chunk-active elements
    var chunkActiveEls = document.querySelectorAll('.chunk-active');
    var pad = 4;
    for (var hti = 0; hti < chunkActiveEls.length; hti++) {
      var r = chunkActiveEls[hti].getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) {
        forbiddenRegions.push({ left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad });
      }
    }

    // 3. NER label chips - query DOM for .ner-label elements
    var nerLabels = document.querySelectorAll('.ner-label');
    var chipPad = 2;
    for (var ci = 0; ci < nerLabels.length; ci++) {
      var cr = nerLabels[ci].getBoundingClientRect();
      if (cr && cr.width > 0 && cr.height > 0) {
        forbiddenRegions.push({ left: cr.left - chipPad, top: cr.top - chipPad, right: cr.right + chipPad, bottom: cr.bottom + chipPad });
      }
    }

    // 4. Hovered token + radius - HARD GUARD: popup can NEVER cover this area
    var tokenForbidden = null;
    if (anchorRect) {
      var rad = 10;
      tokenForbidden = {
        left: anchorRect.left - rad, top: anchorRect.top - rad,
        right: anchorRect.right + rad, bottom: anchorRect.bottom + rad
      };
    }

    // === HELPER: Check if any individual popup rect overlaps a region ===
    function anyPopupOverlapsRect(x, y, region) {
      for (var pi = 0; pi < popupRects.length; pi++) {
        var pr = popupRects[pi];
        var absRect = {
          left: x + pr.left,
          top: y + pr.top,
          right: x + pr.left + pr.width,
          bottom: y + pr.top + pr.height
        };
        if (rectsOverlap(absRect, region)) return true;
      }
      return false;
    }

    // === HELPER: Check if any popup rect overlaps a line point ===
    function anyPopupOverlapsLinePoint(x, y, pt) {
      for (var pi = 0; pi < popupRects.length; pi++) {
        var pr = popupRects[pi];
        var left = x + pr.left - udLineThickness;
        var right = x + pr.left + pr.width + udLineThickness;
        var top = y + pr.top - udLineThickness;
        var bottom = y + pr.top + pr.height + udLineThickness;
        if (pt.x >= left && pt.x <= right && pt.y >= top && pt.y <= bottom) return true;
      }
      return false;
    }

    // === HELPER: Check if any popup rect overflows viewport ===
    function anyPopupOverflowsViewport(x, y, margin) {
      for (var pi = 0; pi < popupRects.length; pi++) {
        var pr = popupRects[pi];
        if (x + pr.left < margin) return true;
        if (y + pr.top < margin) return true;
        if (x + pr.left + pr.width > vw - margin) return true;
        if (y + pr.top + pr.height > vh - margin) return true;
      }
      return false;
    }

    // === HELPER: Count how many things a position overlaps ===
    function countOverlaps(x, y) {
      var count = 0;

      // Count overlapping POS/NER regions (using individual popup rects)
      for (var i = 0; i < forbiddenRegions.length; i++) {
        if (anyPopupOverlapsRect(x, y, forbiddenRegions[i])) count++;
      }

      // Count overlapping UD line points (count per line)
      var hitLines = null;
      for (var i = 0; i < udLinePoints.length; i++) {
        var pt = udLinePoints[i];
        if (anyPopupOverlapsLinePoint(x, y, pt)) {
          if (!hitLines) hitLines = {};
          var key = pt.line || (pt.x + ',' + pt.y);
          hitLines[key] = true;
        }
      }
      if (hitLines) count += Object.keys(hitLines).length;

      return count;
    }

    // === GENERATE GRID OF CANDIDATE POSITIONS ===
    var gridStep = 50;
    var margin = 4;

    // Token center for distance calculation
    var tokenCenterX = anchorRect ? (anchorRect.left + anchorRect.right) / 2 : clientX;
    var tokenCenterY = anchorRect ? (anchorRect.top + anchorRect.bottom) / 2 : clientY;

    // Two-pass selection:
    // Pass 1: Find closest non-overlapping position within viewport
    // Pass 2: If none found, find closest to token that doesn't overlap token, with least obstacle overlaps
    var bestX = null, bestY = null;
    var bestDistance = Infinity;
    var bestOverlaps = Infinity;
    var foundPerfect = false;

    // Iterate over grid positions
    for (var gx = margin; gx + w <= vw - margin; gx += gridStep) {
      for (var gy = margin; gy + h <= vh - margin; gy += gridStep) {
        // Check if any popup overflows viewport
        if (anyPopupOverflowsViewport(gx, gy, margin)) continue;

        // HARD GUARD: Skip positions where any popup would cover hovered token + 10px buffer
        if (tokenForbidden && anyPopupOverlapsRect(gx, gy, tokenForbidden)) continue;

        var overlaps = countOverlaps(gx, gy);

        // Calculate distance from popup center to token center
        var popupCenterX = gx + w / 2;
        var popupCenterY = gy + h / 2;
        var dx = popupCenterX - tokenCenterX;
        var dy = popupCenterY - tokenCenterY;
        var distance = Math.sqrt(dx * dx + dy * dy);

        if (overlaps === 0) {
          // Pass 1: Perfect position (no overlaps) - pick closest
          if (!foundPerfect || distance < bestDistance) {
            foundPerfect = true;
            bestDistance = distance;
            bestX = gx;
            bestY = gy;
          }
        } else if (!foundPerfect) {
          // Pass 2: No perfect position yet - pick by (least overlaps, then closest distance)
          if (overlaps < bestOverlaps || (overlaps === bestOverlaps && distance < bestDistance)) {
            bestDistance = distance;
            bestOverlaps = overlaps;
            bestX = gx;
            bestY = gy;
          }
        }
      }
    }

    if (bestX !== null && bestY !== null) {
      hoverPopupContainer.style.left = bestX + 'px';
      hoverPopupContainer.style.top = bestY + 'px';
    }
  }

  var lastHoveredElement = null;  // Track the actual hovered element
  function positionSidePanelPopup(popupEl, clientX, clientY) {
    // Position popup to LEFT of hovered word - never cover the hovered word
    // No max distance constraint - popup can be anywhere as long as it doesn't cover the word
    if (!popupEl || popupEl.style.display === 'none') return;

    var vw = window.innerWidth, vh = window.innerHeight;
    var margin = 10;

    popupEl.style.left = '0px';
    popupEl.style.top = '0px';
    // DIRECT DOM measurement for accuracy
    var rect = popupEl.getBoundingClientRect();
    var w = rect ? rect.width : (popupEl.offsetWidth || 0);
    var h = rect ? rect.height : (popupEl.offsetHeight || 0);

    // Use the actual hovered element if we have it, otherwise search - DIRECT DOM
    var hoveredRect = null;
    try {
      if (lastHoveredElement) {
        var r = lastHoveredElement.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) {
          hoveredRect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
        }
      } else if (panelHoverToken && panelContent) {
        var els = panelContent.querySelectorAll('.headword-component, .panel-token');
        for (var i = 0; i < els.length; i++) {
          if (els[i].dataset.seg === panelHoverToken) {
            var r = els[i].getBoundingClientRect();
            if (r && r.width > 0 && r.height > 0) {
              hoveredRect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
            }
            break;
          }
        }
      }
    } catch (e) {}

    var x, y;
    if (hoveredRect && hoveredRect.width > 0) {
      // Position to the LEFT of the hovered word (toward the main window)
      x = hoveredRect.left - w - margin;
      y = hoveredRect.top;

      // If left placement would go off screen, try below the word
      if (x < 8) {
        x = Math.max(8, hoveredRect.left);
        y = hoveredRect.bottom + margin;
        // If below also goes off screen, position above
        if (y + h > vh - 8) {
          y = Math.max(8, hoveredRect.top - h - margin);
        }
      } else {
        // Left placement worked, but check if y needs adjustment
        if (y + h > vh - 8) {
          y = vh - h - 8;
        }
        if (y < 8) {
          y = 8;
        }
      }
    } else {
      // Fallback: position near cursor, preferring left side
      x = clientX - w - margin;
      y = clientY;
      // Clamp to viewport
      if (x < 8) {
        x = clientX + margin;  // Try right of cursor if left doesn't work
      }
      x = Math.max(8, Math.min(x, vw - w - 8));
      y = Math.max(8, Math.min(y, vh - h - 8));
    }

    popupEl.style.left = x + 'px';
    popupEl.style.top = y + 'px';
  }

  function hidePopup() {
    hoverPopupContainer.style.display = 'none';
    grammarPopup.style.display = 'none';
    if (udPopup) {
      udPopup.style.display = 'none';
      udPopup.innerHTML = '';
    }
    if (g2pPopup) {
      g2pPopup.style.display = 'none';
      g2pPopup.innerHTML = '';
    }
    if (notePopup) {
      notePopup.style.display = 'none';
      notePopup.textContent = '';
    }
    if (subsegmentPopupsContainer) {
      subsegmentPopupsContainer.style.display = 'none';
      subsegmentPopupsContainer.innerHTML = '';
    }
  }
  // ===================== SIDE PANEL =====================
  function lookupAndDisplay(token, options) {
    panelContent.innerHTML = '<div style="color:#888;text-align:center;margin-top:20px;">Loading...</div>';
    var useRaw = options && options.raw;
    var useExact = options && options.exact;
    var allowFuzzy = !(options && options.allowFuzzy === false);
    var fuzzyNoIsland = !!(options && options.noIsland);
    var fuzzySegIdx = (options && typeof options.segIdx === 'number' && isFinite(options.segIdx) && options.segIdx >= 0)
      ? options.segIdx
      : null;
    var fuzzyBaseToken = (options && options.baseToken) ? String(options.baseToken) : '';
    var fuzzyUnknownPiece = (options && options.unknownPiece) ? String(options.unknownPiece) : '';
    var fuzzyForceWholeToken = !!(options && options.forceWholeToken);
    var url = useRaw ? buildLookupUrlRaw(token, useExact) : buildLookupUrl(token);
    fetch(url)
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        if (!data.ok || !data.results || !data.results.length) {
          if (useExact) {
            var unknownEntry = {
              head: token,
              pos: 'unknown',
              senses: ['[no dictionary entry found for this segment]']
            };
            var fullData = data || {};
            if (!allowFuzzy) fullData.disableFuzzy = true;
            if (allowFuzzy && !fuzzyUnknownPiece) {
              fuzzyUnknownPiece = token;
            }
            if (allowFuzzy && typeof fuzzySegIdx === 'number') {
              fullData.fuzzySegIdx = fuzzySegIdx;
            }
            if (allowFuzzy && fuzzyBaseToken) {
              fullData.fuzzyBaseToken = fuzzyBaseToken;
            }
            if (allowFuzzy && fuzzyUnknownPiece) {
              fullData.fuzzyUnknownPiece = fuzzyUnknownPiece;
            }
            if (allowFuzzy && fuzzyForceWholeToken) {
              fullData.fuzzyForceWholeToken = true;
            }
            if (allowFuzzy && fuzzyNoIsland) {
              fullData.fuzzyNoIsland = true;
            }
            displayDictEntry(unknownEntry, token, fullData);
            return;
          }
          panelContent.innerHTML = '<div style="color:#888;text-align:center;margin-top:20px;">No results for "' + escapeHtml(token) + '"</div>';
          return;
        }
        // Cache results
        if (data.results) {
          for (var i = 0; i < data.results.length; i++) {
            var r = data.results[i];
            if (r && r.head) lookupCache.set(r.head, r);
          }
        }
        var fullData = data || {};
        if (!allowFuzzy) fullData.disableFuzzy = true;
        if (allowFuzzy && typeof fuzzySegIdx === 'number') {
          fullData.fuzzySegIdx = fuzzySegIdx;
        }
        if (allowFuzzy && fuzzyBaseToken) {
          fullData.fuzzyBaseToken = fuzzyBaseToken;
        }
        if (allowFuzzy && fuzzyUnknownPiece) {
          fullData.fuzzyUnknownPiece = fuzzyUnknownPiece;
        }
        if (allowFuzzy && fuzzyForceWholeToken) {
          fullData.fuzzyForceWholeToken = true;
        }
        if (allowFuzzy && fuzzyNoIsland) {
          fullData.fuzzyNoIsland = true;
        }
        displayDictEntry(data.results[0], token, fullData);
      })
      .catch(function(err) {
        console.error(err);
        panelContent.innerHTML = '<div style="color:#c00;text-align:center;margin-top:20px;">Error loading dictionary</div>';
      });
  }
  function displayDictEntry(res, originalToken, fullData) {
    var head = res.head || originalToken;
    var senses = res.senses || [];
    var pos = (res.pos || '').toLowerCase();
    function isUnknownEntry(obj) {
      if (!obj) return true;
      var p = (obj.pos || '').toLowerCase();
      var ss = obj.senses || [];
      return p.indexOf('unknown') >= 0 || (ss.length === 1 && typeof ss[0] === 'string' && ss[0].toLowerCase().indexOf('no dictionary entry') >= 0);
    }
    var dictFill = Array.isArray(res.dict_fill) ? res.dict_fill : [];
    var fillHasKnown = (typeof res.dict_fill_has_known === 'boolean') ? res.dict_fill_has_known : false;
    var fillHasUnknown = (typeof res.dict_fill_has_unknown === 'boolean') ? res.dict_fill_has_unknown : false;
    if ((typeof res.dict_fill_has_known !== 'boolean' || typeof res.dict_fill_has_unknown !== 'boolean') && dictFill.length) {
      for (var pi = 0; pi < dictFill.length; pi++) {
        if (isUnknownEntry(dictFill[pi])) fillHasUnknown = true; else fillHasKnown = true;
      }
    }
    var isUnk = fillHasUnknown || !fillHasKnown || isUnknownEntry(res);

    // Always fetch subsegments for the headword itself (for decomposability)
    // Cache server-provided dict_fill for canonical tokens
    if (dictFill.length) {
      for (var i = 0; i < dictFill.length; i++) {
        var sub = dictFill[i];
        if (sub && sub.head) lookupCache.set(sub.head, sub);
      }
    }

    // Fetch subsegments for headword decomposition
    fetch('/subsegments?token=' + encodeURIComponent(head))
      .then(function(resp) { return resp.json(); })
      .then(function(subData) {
        var headComponents = [];
        if (subData.ok && subData.subsegments && subData.subsegments.length >= 1) {
          headComponents = subData.subsegments;
          subsegCache.set(head, headComponents);
          for (var i = 0; i < headComponents.length; i++) {
            var sub = headComponents[i];
            if (sub && sub.head) lookupCache.set(sub.head, sub);
          }
        } else {
          headComponents = [res];
        }
        renderPanelEntry(res, head, senses, isUnk, headComponents, fullData);
      })
      .catch(function() {
        renderPanelEntry(res, head, senses, isUnk, [res], fullData);
      });
  }

  function prefetchPanelComponentLookups(components) {
    if (!components || !components.length) return;
    components.forEach(function(comp) {
      var compHead = comp && comp.head ? String(comp.head) : '';
      if (!compHead || lookupCache.has(compHead)) return;
      fetch('/lookup_dp_only?q=' + encodeURIComponent(compHead))
        .then(function(resp) { return resp.json(); })
        .then(function(data) {
          if (data && data.ok && data.results && data.results.length) {
            lookupCache.set(compHead, data.results[0]);
          }
        })
        .catch(function() {});
    });
  }
  // SIMPLIFIED: Render main dictionary entry in side panel
  function renderPanelEntry(res, head, senses, isUnk, headComponents, fullData) {
    // Helper to check if entry is unknown
    function isUnknownEntry(obj) {
      if (!obj) return true;
      var p = (obj.pos || '').toLowerCase();
      var ss = obj.senses || [];
      return p.indexOf('unknown') >= 0 ||
             (ss.length === 1 && typeof ss[0] === 'string' &&
              ss[0].toLowerCase().indexOf('no dictionary entry') >= 0);
    }

    var html = '<div class="dict-entry">';

    // 1. HEADWORD: Render using subsegments (headComponents) for decomposition hover
    html += '<div class="dict-headword" style="font-weight:bold;">';

    // Always use headComponents (subsegments) for hoverable decomposition
    // Color code based on dict_fill info if available
    var dictFill = Array.isArray(res.dict_fill) ? res.dict_fill : [];
    var dictFillMap = {};
    for (var fi = 0; fi < dictFill.length; fi++) {
      var df = dictFill[fi];
      if (df && df.head) dictFillMap[df.head] = df;
    }

    for (var ci = 0; ci < headComponents.length; ci++) {
      var comp = headComponents[ci];
      var compHead = comp.head || head;
      // Main headword is RED if the entry is unknown (broken/misspelled word)
      // BLACK if it's a known word
      var headColor = isUnk ? '#c00' : '#000';
      html += '<span class="headword-component" data-seg="' + escapeHtml(compHead) + '" style="color:' + headColor + ';">' + escapeHtml(compHead) + '</span>';
    }
    html += '</div>';

    // 2. ROMANIZATION: Show below headword if unknown
    if (isUnk && res.g2p && Array.isArray(res.g2p.syllables) && res.g2p.syllables.length) {
      html += '<div style="font-size:0.85em;color:#666;">';
      for (var si = 0; si < res.g2p.syllables.length; si++) {
        var syll = res.g2p.syllables[si];
        if (syll && syll.roman) html += escapeHtml(syll.roman) + ' ';
      }
      html += '</div>';
    }

    // 3. SENSES: Render definitions
    var hasContent = false;

    html += '<div class="dict-senses" id="dict-senses-container">';

    // If we have dict_fill entries, render each one
    if (dictFill.length) {
      for (var di = 0; di < dictFill.length; di++) {
        var part = dictFill[di] || {};
        var pHead = part.head || '';
        if (!pHead) continue;

        var pSenses = Array.isArray(part.senses) ? part.senses : [];
        var pUnk = isUnknownEntry(part);

        if (pUnk) {
          // Skip unknown parts that match the main headword (already shown above)
          if (pHead === head && isUnk) continue;

          // Unknown part: red text + romanization
          html += '<div style="margin-top:8px;color:#c00;font-weight:bold;">' + escapeHtml(pHead) + '</div>';
          if (part.g2p && Array.isArray(part.g2p.syllables) && part.g2p.syllables.length) {
            html += '<div style="font-size:0.85em;color:#666;">';
            for (var gi = 0; gi < part.g2p.syllables.length; gi++) {
              var gsyll = part.g2p.syllables[gi];
              if (gsyll && gsyll.roman) html += escapeHtml(gsyll.roman) + ' ';
            }
            html += '</div>';
          }
        } else {
          // Known part: heading + senses
          if (dictFill.length > 1) {
            html += '<div style="margin-top:8px;font-weight:bold;">' + escapeHtml(pHead) + '</div>';
          }
          if (pSenses.length) {
            html += renderSenseLines(pSenses, pHead);
            hasContent = true;
          }
        }
      }
    }
    // Fallback: use top-level senses if no dict_fill content
    else if (senses.length && !isUnk) {
      html += renderSenseLines(senses, head);
      hasContent = true;
    }

    html += '</div>';

    // 4. FUZZY MATCHING: Automatically run if there's unknown content
    var allowFuzzy = !(fullData && fullData.disableFuzzy);
    var hasUnknown = isUnk || dictFill.some(function(p) { return isUnknownEntry(p); });
    var fuzzyUnknownPiece = (fullData && fullData.fuzzyUnknownPiece) ? fullData.fuzzyUnknownPiece : '';
    var fuzzyForceWholeToken = !!(fullData && fullData.fuzzyForceWholeToken);
    if (hasUnknown && allowFuzzy && fuzzyUnknownPiece) {
      html += '<div id="dict-fuzzy-results"></div>';
    }
    html += '</div>';
    panelContent.innerHTML = html;
    prefetchPanelComponentLookups(headComponents || []);
    // Segment Burmese text in senses
    var sensesContainer = document.getElementById('dict-senses-container');
    if (sensesContainer) {
      segmentBurmeseInElement(sensesContainer);
    }
    // Also segment fuzzy senses
    var fuzzySenses = panelContent.querySelectorAll('.dict-fuzzy-senses');
    for (var i = 0; i < fuzzySenses.length; i++) {
      segmentBurmeseInElement(fuzzySenses[i]);
    }
    attachPanelHandlers();

    // Auto-trigger fuzzy matching if there's unknown content
    if (hasUnknown && allowFuzzy && fuzzyUnknownPiece) {
      var fuzzyToken = (fullData && fullData.fuzzyBaseToken) ? fullData.fuzzyBaseToken : head;
      var fuzzyNoIsland = !!(fullData && fullData.fuzzyNoIsland);
      if (fullData && typeof fullData.fuzzySegIdx === 'number' && isFinite(fullData.fuzzySegIdx)) {
        runSmartFuzzyMatching(fuzzyToken, { segIdx: fullData.fuzzySegIdx, noIsland: fuzzyNoIsland, unknownPiece: fuzzyUnknownPiece, forceWholeToken: fuzzyForceWholeToken });
      } else if (fuzzyNoIsland) {
        runSmartFuzzyMatching(fuzzyToken, { noIsland: true, unknownPiece: fuzzyUnknownPiece, forceWholeToken: fuzzyForceWholeToken });
      } else {
        runSmartFuzzyMatching(fuzzyToken, { unknownPiece: fuzzyUnknownPiece, forceWholeToken: fuzzyForceWholeToken });
      }
    }
  }
  // Segment a fuzzy headword into hoverable component spans
  function segmentFuzzyHeadword(el) {
    var fHead = el.getAttribute('data-fuzzy-head');
    if (!fHead) return;
    fetch('/subsegments?token=' + encodeURIComponent(fHead))
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        var components = [];
        if (data.ok && data.subsegments && data.subsegments.length >= 1) {
          components = data.subsegments;
          subsegCache.set(fHead, components);
          for (var i = 0; i < components.length; i++) {
            var sub = components[i];
            if (sub && sub.head) lookupCache.set(sub.head, sub);
          }
        } else {
          // Can't break down - use the word itself
          components = [{ head: fHead }];
        }
        // Replace content with hoverable spans
        var frag = document.createDocumentFragment();
        for (var ci = 0; ci < components.length; ci++) {
          var comp = components[ci];
          var compHead = comp.head || fHead;
          var span = document.createElement('span');
          span.className = 'headword-component';
          span.textContent = compHead;
          span.dataset.seg = compHead;
          frag.appendChild(span);
        }
        el.innerHTML = '';
        el.appendChild(frag);

        // Prefetch dict entries for fuzzy components so side-panel hover is not lazy.
        components.forEach(function(comp) {
          var compHead = comp && comp.head ? String(comp.head) : '';
          if (!compHead || lookupCache.has(compHead)) return;
          fetch('/lookup_dp_only?q=' + encodeURIComponent(compHead))
            .then(function(resp) { return resp.json(); })
            .then(function(d) {
              if (d && d.ok && d.results && d.results.length) {
                lookupCache.set(compHead, d.results[0]);
              }
            })
            .catch(function() {});
        });
      })
      .catch(function() {
        // On error, make the whole word hoverable
        var span = document.createElement('span');
        span.className = 'headword-component';
        span.textContent = fHead;
        span.dataset.seg = fHead;
        el.innerHTML = '';
        el.appendChild(span);
      });
  }
  function runSmartFuzzyMatching(baseToken, options) {
    // Distance-first fuzzy matching with unigram LM as tie-breaker.
    // Runs on the clicked token, then checks for larger island matches.
    var container = document.getElementById('dict-fuzzy-results');
    if (!container || !baseToken) return;

    var tokenIdx = -1;
    var cacheKey = null;
    var noIsland = !!(options && options.noIsland);
    var forceWholeToken = !!(options && options.forceWholeToken);
    if (forceWholeToken) {
      noIsland = true;
    }
    var unknownPiece = (options && options.unknownPiece) ? String(options.unknownPiece) : '';
    if (!unknownPiece) return;
    if (options && typeof options.segIdx === 'number' && isFinite(options.segIdx) && options.segIdx >= 0) {
      tokenIdx = options.segIdx;
      cacheKey = 'seg:' + tokenIdx + (unknownPiece ? '|unk:' + unknownPiece : '') + (forceWholeToken ? '|force:1' : '');
    }

    if (cacheKey && fuzzyCache.has(cacheKey)) {
      renderFuzzyResults(container, fuzzyCache.get(cacheKey), baseToken);
      return;
    }

    function isMyanmarWordToken(tok) {
      if (!tok) return false;
      if (tok.indexOf('။') >= 0 || tok.indexOf('၊') >= 0) return false;
      for (var i = 0; i < tok.length; i++) {
        var cp = tok.charCodeAt(i);
        var isCore = (cp >= 0x1000 && cp <= 0x109F);
        var isExtA = (cp >= 0xA9E0 && cp <= 0xA9FF);
        var isExtB = (cp >= 0xAA60 && cp <= 0xAA7F);
        if (!(isCore || isExtA || isExtB)) return false;
      }
      return true;
    }

    function buildIslandSpansFromOffsets(segments, offsets) {
      if (!segments || !offsets || segments.length !== offsets.length) return null;
      var spans = [];
      var islandStart = null;
      var prevEnd = null;
      for (var i = 0; i < segments.length; i++) {
        var seg = segments[i];
        var off = offsets[i];
        if (!off || off.length < 2 || !isMyanmarWordToken(seg)) {
          if (islandStart !== null) {
            spans.push([islandStart, i]);
            islandStart = null;
          }
          prevEnd = null;
          continue;
        }
        var s = Number(off[0]);
        var e = Number(off[1]);
        if (islandStart === null) {
          islandStart = i;
        } else if (prevEnd !== null && s !== prevEnd) {
          spans.push([islandStart, i]);
          islandStart = i;
        }
        prevEnd = e;
      }
      if (islandStart !== null) spans.push([islandStart, segments.length]);
      return spans;
    }

    // Extract island tokens from latestData
    var islandTokens = [];
    var tokenIdxInIsland = -1;
    if (!noIsland && latestData && Array.isArray(latestData.segments)) {
      var segments = latestData.segments;
      var islandSpans = null;
      if (Array.isArray(latestData.segment_offsets) && latestData.segment_offsets.length === segments.length) {
        islandSpans = buildIslandSpansFromOffsets(segments, latestData.segment_offsets);
      }
      if (!islandSpans || !islandSpans.length) {
        islandSpans = latestData.island_spans || [];
      }
      if (tokenIdx < 0 || tokenIdx >= segments.length) {
        // Find the index of this token (fallback by text match)
        for (var i = 0; i < segments.length; i++) {
          if (segments[i] === baseToken) {
            tokenIdx = i;
            break;
          }
        }
      }
      if (tokenIdx >= 0 && tokenIdx < segments.length) {
        // Find which island this token belongs to and extract all island tokens
        for (var si = 0; si < islandSpans.length; si++) {
          var span = islandSpans[si];
          var start = span[0], end = span[1];
          if (tokenIdx >= start && tokenIdx < end) {
            islandTokens = segments.slice(start, end);
            tokenIdxInIsland = tokenIdx - start;
            break;
          }
        }
      }
    }

    if (!cacheKey) {
      // Create cache key from base token + island
      cacheKey = baseToken + '|' + islandTokens.join(',') + '|' + tokenIdxInIsland + (unknownPiece ? '|unk:' + unknownPiece : '') + (forceWholeToken ? '|force:1' : '');
      if (fuzzyCache.has(cacheKey)) {
        renderFuzzyResults(container, fuzzyCache.get(cacheKey), baseToken);
        return;
      }
    }

    container.innerHTML = '<div class="dict-unknown">Finding spelling suggestions...</div>';

    fetch('/api/fuzzy_smart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base_token: baseToken,
        max_edit_distance: 2,
        max_suggestions: 10,
        island_tokens: islandTokens,
        token_idx_in_island: tokenIdxInIsland,
        unknown_piece: unknownPiece,
        force_whole_token: forceWholeToken
      })
    })
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        if (!data || !data.ok) {
          container.innerHTML = '<div class="dict-unknown">[fuzzy unavailable]</div>';
          return;
        }

        // Cache the results
        fuzzyCache.set(cacheKey, data);

        // Render the results
        renderFuzzyResults(container, data, baseToken);
      })
      .catch(function(err) {
        console.error('Fuzzy matching error:', err);
        container.innerHTML = '<div class="dict-unknown">[fuzzy request failed]</div>';
      });
  }

  function renderFuzzyResults(container, data, baseToken) {
    var final = data.final || {};
    var groups = Array.isArray(data.groups) ? data.groups : [];
    var sugg = final.suggestions || [];
    var fuzziedStr = final.fuzzied_string || baseToken;

    var html = '<div class="dict-fuzzy-section"><div class="dict-fuzzy-header">FUZZY SUGGESTIONS</div>';
    if (data && typeof data.distance_used === 'number') {
      html += '<div class="dict-unknown" style="margin-top:2px;font-size:0.85em;color:#666;">Edit distance: ' + escapeHtml(String(data.distance_used)) + '</div>';
    }

    if (final.removed_known && final.removed_known.length) {
      html += '<div class="dict-unknown" style="margin-top:2px;font-size:0.85em;color:#666;">Subtracted known words: ' + final.removed_known.map(escapeHtml).join(', ') + '</div>';
    }
    if (final.kept_pieces && final.kept_pieces.length > 1) {
      html += '<div class="dict-unknown" style="margin-top:2px;font-size:0.85em;color:#666;">Final word components: ' + final.kept_pieces.map(escapeHtml).join(' + ') + '</div>';
    }

    function buildEntryListHtml(list, label) {
      if (!list || !list.length) return '';
      var out = '';
      if (label) {
        out += '<div class="dict-unknown" style="margin-top:6px;font-size:0.85em;color:#666;">' + escapeHtml(label) + '</div>';
      }
      var ordered = list.slice ? list.slice() : list;
      for (var si = 0; si < ordered.length; si++) {
        var fm = ordered[si] || {};
        var fHead = fm.head || fm.candidate || '';
        if (!fHead) continue;
        out += '<div class="dict-fuzzy-entry">';
        out += '<span class="dict-fuzzy-head" data-fuzzy-head="' + escapeHtml(fHead) + '">' + escapeHtml(fHead) + '</span>';
        var fSenses = fm.senses || (fm.gloss ? [fm.gloss] : []);
        if (fSenses.length) {
          out += '<div class="dict-fuzzy-senses">' + renderSenseLines(fSenses, fHead) + '</div>';
        }
        out += '</div>';
      }
      return out;
    }

    if (groups.length) {
      for (var gi = 0; gi < groups.length; gi++) {
        var g = groups[gi] || {};
        var gTokens = Array.isArray(g.span_tokens) ? g.span_tokens : [];
        var gLabel = gTokens.length ? gTokens.join(' + ') : (g.span_text || '');
        if (gLabel) {
          html += '<div class="dict-unknown" style="margin-top:6px;font-size:0.85em;color:#666;">';
          html += 'Tokens: ' + escapeHtml(gLabel);
          html += '</div>';
        }
        var gEntries = Array.isArray(g.entries) ? g.entries : [];
        html += buildEntryListHtml(gEntries, '');
      }
    } else if (sugg.length) {
      html += buildEntryListHtml(sugg, '');
    } else {
      html += '<div class="dict-unknown">[no spelling suggestions found for "' + escapeHtml(fuzziedStr) + '"]</div>';
    }

    html += '</div>';
    container.innerHTML = html;

    var fuzzyHeadEls = container.querySelectorAll('.dict-fuzzy-head[data-fuzzy-head]');
    for (var fi = 0; fi < fuzzyHeadEls.length; fi++) {
      segmentFuzzyHeadword(fuzzyHeadEls[fi]);
    }

    var fuzzySenses = container.querySelectorAll('.dict-fuzzy-senses');
    for (var i = 0; i < fuzzySenses.length; i++) {
      segmentBurmeseInElement(fuzzySenses[i]);
    }
  }
  function segmentBurmeseInElement(el) {
    // Find all text nodes with Myanmar
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    var textNodes = [];
    var n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue && /[\u1000-\u109F]/.test(n.nodeValue)) {
        textNodes.push(n);
      }
    }
    textNodes.forEach(function(textNode) {
      var text = textNode.nodeValue;
      if (!text) return;
      // Extract Myanmar spans
      var parts = [];
      var i = 0;
      while (i < text.length) {
        if (isMyanmarChar(text[i])) {
          var start = i;
          while (i < text.length && (isMyanmarChar(text[i]) || /[\u104A\u104B]/.test(text[i]))) {
            i++;
          }
          parts.push({ type: 'myanmar', text: text.slice(start, i) });
        } else {
          var start = i;
          while (i < text.length && !isMyanmarChar(text[i])) {
            i++;
          }
          parts.push({ type: 'other', text: text.slice(start, i) });
        }
      }
      // For Myanmar parts, segment via API
      var myanmarParts = parts.filter(function(p) { return p.type === 'myanmar' && p.text.trim(); });
      if (!myanmarParts.length) return;
      var promises = myanmarParts.map(function(p) {
        var url = '/lookup_dp_only?q=' + encodeURIComponent(p.text || '');
        return fetch(url)
          .then(function(resp) { return resp.json(); })
          .then(function(data) {
            p.segments = data.segments || [];
            p.results = data.results || [];
            p.results_by_seg = data.results_by_seg || {};
            // Cache results
            if (data.results) {
              for (var ri = 0; ri < data.results.length; ri++) {
                var r = data.results[ri];
                if (r && r.head) lookupCache.set(r.head, r);
              }
            }
          })
          .catch(function() { p.segments = []; p.results = []; p.results_by_seg = {}; });
      });
      Promise.all(promises).then(function() {
        var frag = document.createDocumentFragment();
        for (var pi = 0; pi < parts.length; pi++) {
          var part = parts[pi];
          if (part.type === 'other') {
            frag.appendChild(document.createTextNode(part.text));
          } else {
            // Wrap segmented tokens
            var segs = part.segments || [];
            var resultsBySeg = part.results_by_seg || {};
            var txt = part.text;
            if (segs.length) {
              var idx = 0;
              for (var si = 0; si < segs.length; si++) {
                var seg = segs[si];
                var pos = txt.indexOf(seg, idx);
                if (pos > idx) {
                  frag.appendChild(document.createTextNode(txt.slice(idx, pos)));
                }
                if (pos >= 0) {
                  // Skip Myanmar punctuation - don't wrap it
                  if (isMyanmarPunctToken(seg)) {
                    frag.appendChild(document.createTextNode(seg));
                    idx = pos + seg.length;
                    continue;
                  }

                  // Check if this segment has dict_fill (multiword token)
                  var res = resultsBySeg[si] || null;
                  var dictFill = res && Array.isArray(res.dict_fill) ? res.dict_fill : [];

                  if (dictFill.length > 0) {
                    // MULTIWORD TOKEN: Create sub-spans for each dict entry
                    for (var di = 0; di < dictFill.length; di++) {
                      var fillEntry = dictFill[di];
                      var fillHead = fillEntry.head || '';
                      if (!fillHead) continue;

                      var subspan = document.createElement('span');
                      subspan.className = 'panel-token';
                      subspan.textContent = fillHead;
                      subspan.dataset.seg = fillHead;
                      frag.appendChild(subspan);

                      // Cache the fill entry for hover lookup
                      if (fillEntry) lookupCache.set(fillHead, fillEntry);
                    }
                  } else {
                    // SINGLE-WORD TOKEN: One span for the whole segment
                    var span = document.createElement('span');
                    span.className = 'panel-token';
                    span.textContent = seg;
                    span.dataset.seg = seg;
                    frag.appendChild(span);
                  }
                  idx = pos + seg.length;
                }
              }
              if (idx < txt.length) {
                frag.appendChild(document.createTextNode(txt.slice(idx)));
              }
            } else {
              frag.appendChild(document.createTextNode(txt));
            }
          }
        }
        if (textNode.parentNode) {
          textNode.parentNode.replaceChild(frag, textNode);
        }
      });
    });
  }
  function attachPanelHandlers() {
    panelContent.onmousemove = function(ev) {
      lastMouseX = ev.clientX;
      lastMouseY = ev.clientY;
      // Check if hovering a headword component (main or fuzzy)
      var componentEl = ev.target && ev.target.closest('.headword-component');
      if (componentEl) {
        var seg = componentEl.dataset.seg;
        lastHoveredElement = componentEl;  // Track the actual element
        if (seg && seg !== panelHoverToken) {
          panelHoverToken = seg;
          panelHoverType = 'headword-component';
          showDictPopupSimple(seg);
        }
        positionSidePanelPopup(hoverPopupContainer, lastMouseX, lastMouseY);
        return;
      }
      // Check if hovering panel token (definition body words)
      var tokenEl = ev.target && ev.target.closest('.panel-token');
      if (tokenEl) {
        var seg = tokenEl.dataset.seg;
        lastHoveredElement = tokenEl;  // Track the actual element
        if (seg && seg !== panelHoverToken) {
          panelHoverToken = seg;
          panelHoverType = 'token';
          showDictPopupSimple(seg);
        }
        positionSidePanelPopup(hoverPopupContainer, lastMouseX, lastMouseY);
        return;
      }
      panelHoverToken = null;
      panelHoverType = null;
      lastHoveredElement = null;
      hidePopup();
    };
    panelContent.onmouseleave = function() {
      panelHoverToken = null;
      panelHoverType = null;
      lastHoveredElement = null;
      hidePopup();
    };
  }
  // Show simple dict popup (NO fuzzy matches)
  function showDictPopupSimple(seg) {
    var cached = lookupCache.get(seg);
    if (cached) {
      // If unknown and no g2p, fetch to get g2p
      var isUnk = !cached.senses || !cached.senses.length ||
                  (cached.pos && cached.pos.toLowerCase().indexOf('unknown') >= 0) ||
                  (cached.senses.length === 1 && typeof cached.senses[0] === 'string' && cached.senses[0].toLowerCase().indexOf('no dictionary entry') >= 0);
      if (isUnk && !cached.g2p) {
        fetch(buildLookupUrl(seg))
          .then(function(resp) { return resp.json(); })
          .then(function(data) {
            if (data.ok && data.results && data.results.length) {
              var res = data.results[0];
              lookupCache.set(seg, res);
              renderDictPopupSimple(res, seg);
            } else {
              renderDictPopupSimple(cached, seg);
            }
          })
          .catch(function() { renderDictPopupSimple(cached, seg); });
        return;
      }
      renderDictPopupSimple(cached, seg);
      return;
    }
    fetch(buildLookupUrl(seg))
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        if (data.ok && data.results && data.results.length) {
          var res = data.results[0];
          lookupCache.set(seg, res);
          renderDictPopupSimple(res, seg);
        } else {
          renderUnknownPopup(seg);
        }
      })
      .catch(function() { renderUnknownPopup(seg); });
  }
  // Wrap component words in an element with hoverable spans
  function wrapComponentWords(seg, components) {
    var html = '';
    for (var i = 0; i < components.length; i++) {
      var comp = components[i];
      var compHead = comp.head || '';
      if (compHead) {
        html += '<span class="panel-token" data-seg="' + escapeHtml(compHead) + '">' + escapeHtml(compHead) + '</span>';
      }
    }
    return html;
  }
  // SIMPLIFIED: Render dictionary popup for side panel hover
  function renderDictPopupSimple(res, seg) {
    grammarPopup.style.display = 'none';
    hoverPopup.classList.remove('has-grammar');

    var head = res.head || seg;
    var senses = res.senses || [];

    // Helper to check if entry is unknown
    function isUnknownEntry(obj) {
      if (!obj) return true;
      var p = (obj.pos || '').toLowerCase();
      var ss = obj.senses || [];
      return p.indexOf('unknown') >= 0 ||
             (ss.length === 1 && typeof ss[0] === 'string' &&
              ss[0].toLowerCase().indexOf('no dictionary entry') >= 0);
    }

    var isUnk = isUnknownEntry(res);

    // Disable G2P pronunciation popup in side panel (pronunciation only in main window)
    if (g2pPopup) {
      g2pPopup.style.display = 'none';
      g2pPopup.innerHTML = '';
    }

    if (!displaySettings.dictPopup) {
      hoverPopup.style.display = 'none';
      hoverPopupContainer.style.display = 'none';
      return;
    }

    var html = '';

    // Always black text for headword components
    html += '<div class="popup-headline">' + escapeHtml(head) + '</div>';

    // Show romanization if unknown
    if (isUnk && res.g2p && Array.isArray(res.g2p.syllables) && res.g2p.syllables.length) {
      html += '<div style="font-size:0.85em;color:#666;">';
      for (var si = 0; si < res.g2p.syllables.length; si++) {
        var syll = res.g2p.syllables[si];
        if (syll && syll.roman) html += escapeHtml(syll.roman) + ' ';
      }
      html += '</div>';
    }

    // Show senses if known
    if (!isUnk && senses.length) {
      html += renderSenseLines(senses, head);
    }

    hoverPopup.innerHTML = html;
    hoverPopup.style.display = 'block';

    // Show only dict popup (pronunciation disabled in side panel)
    hoverPopupContainer.style.display = displaySettings.dictPopup ? 'flex' : 'none';
    positionSidePanelPopup(hoverPopupContainer, lastMouseX, lastMouseY);
  }
  function setG2PPopup(g2pData) {
    if (!g2pPopup) return;
    if (g2pData && Array.isArray(g2pData.syllables) && displaySettings.pronunciation) {
      g2pPopup.innerHTML = renderG2PBlock(g2pData, false);
      g2pPopup.style.display = 'block';
    } else {
      g2pPopup.style.display = 'none';
      g2pPopup.innerHTML = '';
    }
  }
  function renderG2PBlock(g2pData, showTitle) {
    if (!g2pData || !Array.isArray(g2pData.syllables)) return '';
    var syllablesHtml = '';
    for (var i = 0; i < g2pData.syllables.length; i++) {
      var s = g2pData.syllables[i] || {};
      // Use the new components array for phonetic breakdown
      var parts = Array.isArray(s.components) ? s.components : [];
      // Build horizontal component boxes
      var compsHtml = '';
      parts.forEach(function(p) {
        if (!p || !p.ch) return;
        var label = p.label || '';
        compsHtml += '<div class="g2p-comp">';
        compsHtml += '<span class="g2p-comp-ch">' + escapeHtml(p.ch) + '</span>';
        if (label) compsHtml += '<span class="g2p-comp-label">' + escapeHtml(label) + '</span>';
        compsHtml += '</div>';
      });
      syllablesHtml += '<div class="g2p-syll">';
      syllablesHtml += '<div class="g2p-syll-head">';
      syllablesHtml += '<span class="g2p-syll-orth">' + escapeHtml(s.orth || '') + '</span>';
      if (s.roman) syllablesHtml += '<span class="g2p-syll-roman">' + escapeHtml(s.roman) + '</span>';
      syllablesHtml += '</div>';
      if (compsHtml) {
        syllablesHtml += '<div class="g2p-components">' + compsHtml + '</div>';
      }
      syllablesHtml += '</div>';
    }
    var titleHtml = (showTitle === false) ? '' : '<div class="g2p-title">Pronunciation</div>';
    return '<div class="g2p-block">' + titleHtml + '<div class="g2p-syllables">' + syllablesHtml + '</div></div>';
  }
  function renderUnknownPopup(seg) {
    grammarPopup.style.display = 'none';
    hoverPopup.classList.remove('has-grammar');
    // Disable G2P pronunciation popup in side panel (pronunciation only in main window)
    if (g2pPopup) {
      g2pPopup.style.display = 'none';
      g2pPopup.innerHTML = '';
    }
    // Always black text, show romanization for unknown
    if (lookupCache.has(seg)) {
      var cached = lookupCache.get(seg);
      var html = '<div class="popup-headline">' + escapeHtml(seg) + '</div>';
      if (cached.g2p && Array.isArray(cached.g2p.syllables) && cached.g2p.syllables.length) {
        html += '<div style="font-size:0.85em;color:#666;">';
        for (var si = 0; si < cached.g2p.syllables.length; si++) {
          var syll = cached.g2p.syllables[si];
          if (syll && syll.roman) html += escapeHtml(syll.roman) + ' ';
        }
        html += '</div>';
      }
      hoverPopup.innerHTML = html;
    } else {
      var html = '<div class="popup-headline">' + escapeHtml(seg) + '</div>';
      hoverPopup.innerHTML = html;
      fetch(buildLookupUrl(seg))
        .then(function(resp) { return resp.json(); })
        .then(function(data) {
          if (data.ok && data.results && data.results.length) {
            var res = data.results[0];
            var fullHtml = '<div class="popup-headline">' + escapeHtml(seg) + '</div>';
            if (res.g2p && Array.isArray(res.g2p.syllables) && res.g2p.syllables.length) {
              fullHtml += '<div style="font-size:0.85em;color:#666;">';
              for (var si = 0; si < res.g2p.syllables.length; si++) {
                var syll = res.g2p.syllables[si];
                if (syll && syll.roman) fullHtml += escapeHtml(syll.roman) + ' ';
              }
              fullHtml += '</div>';
            }
            hoverPopup.innerHTML = fullHtml;
          }
        })
        .catch(function() {
          // Keep initial html with just the heading
        });
    }
    hoverPopupContainer.style.display = 'flex';
    positionSidePanelPopup(hoverPopupContainer, lastMouseX, lastMouseY);
  }
  // ---------------- Flashcard UI (reading SRS) ----------------
  var flashcardOverlay = document.getElementById('flashcardOverlay');
  var flashcardWord = document.getElementById('flashcardWord');
  var flashcardMessage = document.getElementById('flashcardMessage');
  var flashcardStats = document.getElementById('flashcardStats');
  var flashcardShowAnswerBtn = document.getElementById('flashcardShowAnswerBtn');
  var flashcardAnswer = document.getElementById('flashcardAnswer');
  var flashcardGradeButtons = document.getElementById('flashcardGradeButtons');
  var flashcardPronunciation = document.getElementById('flashcardPronunciation');
  var flashcardDictionary = document.getElementById('flashcardDictionary');
  var flashcardGrammar = document.getElementById('flashcardGrammar');
  var flashcardAnnotation = document.getElementById('flashcardAnnotation');
  var flashcardKnowBtn = document.getElementById('flashcardKnowBtn');
  var flashcardDontKnowBtn = document.getElementById('flashcardDontKnowBtn');
  var flashcardCloseBtn = document.getElementById('flashcardCloseBtn');
  var flashcardModeBtn = document.getElementById('flashcardModeBtn');
  var flashcardCurrent = null;
  var flashcardIsLoading = false;
  var flashcardAnnotationSaveTimeout = null;
  function openFlashcardMode() {
    if (!flashcardOverlay) return;
    flashcardOverlay.style.display = 'flex';
    resetFlashcardUI();
    loadNextFlashcard();
  }
  function resetFlashcardUI() {
    flashcardMessage.textContent = '';
    if (flashcardStats) flashcardStats.textContent = '';
    if (flashcardWord) flashcardWord.style.display = 'block';
    if (flashcardShowAnswerBtn) flashcardShowAnswerBtn.style.display = 'block';
    if (flashcardAnswer) flashcardAnswer.style.display = 'none';
    if (flashcardGradeButtons) flashcardGradeButtons.style.display = 'none';
    if (flashcardPronunciation) flashcardPronunciation.innerHTML = '';
    if (flashcardDictionary) flashcardDictionary.innerHTML = '';
    if (flashcardGrammar) flashcardGrammar.innerHTML = '';
    if (flashcardAnnotation) flashcardAnnotation.value = '';
  }
  function closeFlashcardMode() {
    if (!flashcardOverlay) return;
    flashcardOverlay.style.display = 'none';
    flashcardCurrent = null;
  }
  function loadNextFlashcard() {
    if (flashcardIsLoading) return;
    flashcardIsLoading = true;
    if (!flashcardOverlay) return;
    resetFlashcardUI();
    flashcardWord.textContent = '...';
    if (flashcardShowAnswerBtn) flashcardShowAnswerBtn.disabled = true;
    fetch('/api/reading_srs/next_card')
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        flashcardIsLoading = false;
        if (!data || !data.ok || !data.card) {
          flashcardCurrent = null;
          flashcardWord.textContent = 'No cards available';
          if (flashcardShowAnswerBtn) flashcardShowAnswerBtn.style.display = 'none';
          var msg = (data && data.error) || 'Paste and analyze some text first so the reader can collect known words.';
          flashcardMessage.textContent = msg;
          return;
        }
        var card = data.card;
        flashcardCurrent = card;
        var head = card.head || '';
        var display = card.display || head;
        flashcardWord.textContent = display || head || '...';
        flashcardMessage.textContent = card.is_new ? 'New word' : 'Review';
        var stats = card.stats || {};
        var review = card.review || {};
        var seen = stats.total_seen || 0;
        var reps = review.repetitions || 0;
        if (flashcardStats) flashcardStats.textContent = 'Seen ' + seen + 'x / Repetitions ' + reps;
        if (flashcardShowAnswerBtn) flashcardShowAnswerBtn.disabled = false;
      })
      .catch(function(err) {
        console.error('reading_srs next_card error', err);
        flashcardIsLoading = false;
        flashcardWord.textContent = 'Error';
        flashcardMessage.textContent = 'Failed to load next card.';
        if (flashcardShowAnswerBtn) flashcardShowAnswerBtn.style.display = 'none';
      });
  }
  function showFlashcardAnswer() {
    if (!flashcardCurrent) return;
    var head = flashcardCurrent.head || flashcardCurrent.display || '';
    if (!head) return;
    if (flashcardWord) flashcardWord.style.display = 'none';
    if (flashcardShowAnswerBtn) flashcardShowAnswerBtn.style.display = 'none';
    if (flashcardAnswer) flashcardAnswer.style.display = 'flex';
    if (flashcardGradeButtons) flashcardGradeButtons.style.display = 'flex';
    if (flashcardKnowBtn) flashcardKnowBtn.disabled = false;
    if (flashcardDontKnowBtn) flashcardDontKnowBtn.disabled = false;
    loadFlashcardContent(head);
  }
  function gradeFlashcard(knew) {
    if (!flashcardCurrent || flashcardIsLoading) return;
    var head = flashcardCurrent.head || flashcardCurrent.display || '';
    if (!head) return;
    if (flashcardKnowBtn) flashcardKnowBtn.disabled = true;
    if (flashcardDontKnowBtn) flashcardDontKnowBtn.disabled = true;
    fetch('/api/reading_srs/grade', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ head: head, knew: !!knew })
    })
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        if (!data || !data.ok) {
          flashcardMessage.textContent = 'Failed to update card.';
          if (flashcardKnowBtn) flashcardKnowBtn.disabled = false;
          if (flashcardDontKnowBtn) flashcardDontKnowBtn.disabled = false;
          return;
        }
        loadNextFlashcard();
      })
      .catch(function(err) {
        console.error('reading_srs grade error', err);
        flashcardMessage.textContent = 'Failed to update card.';
        if (flashcardKnowBtn) flashcardKnowBtn.disabled = false;
        if (flashcardDontKnowBtn) flashcardDontKnowBtn.disabled = false;
      });
  }
  function loadFlashcardContent(head) {
    if (!head) return;
    if (flashcardPronunciation) flashcardPronunciation.innerHTML = '<div class="flashcard-loading">Loading...</div>';
    if (flashcardDictionary) flashcardDictionary.innerHTML = '<div class="flashcard-loading">Loading...</div>';
    if (flashcardGrammar) flashcardGrammar.innerHTML = '';
    // Fetch dictionary data (includes g2p and grammar_overlay)
    fetch(buildLookupUrl(head))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        // Pronunciation
        if (flashcardPronunciation) {
          var g2pData = (data && data.results && data.results[0] && data.results[0].g2p) || (data && data.g2p);
          var g2pContent = '';
          if (g2pData) {
            if (typeof renderG2PBlock === 'function' && g2pData.syllables && Array.isArray(g2pData.syllables)) {
              g2pContent = renderG2PBlock(g2pData, true);
            } else if (typeof g2pData === 'string' && g2pData.trim()) {
              g2pContent = '<div class="flashcard-g2p">' + escapeHtml(g2pData) + '</div>';
            }
          }
          if (g2pContent) {
            flashcardPronunciation.innerHTML = g2pContent;
          } else {
            flashcardPronunciation.innerHTML = '';
          }
        }
        // Dictionary
        if (flashcardDictionary) {
          if (data && data.ok && data.results && data.results.length) {
            var main = data.results[0];
            var senses = main.senses || [];
            var dictHtml = '<div class="flashcard-section-title">Dictionary</div>';
            if (senses.length && typeof renderSenseLines === 'function') {
              dictHtml += renderSenseLines(senses, head);
            } else {
              dictHtml += '<div class="popup-empty">[no senses found]</div>';
            }
            flashcardDictionary.innerHTML = dictHtml;
          } else {
            flashcardDictionary.innerHTML = '';
          }
        }
        // Grammar overlay senses (from /lookup response)
        if (flashcardGrammar && data && data.grammar_overlay) {
          var gramOverlay = data.grammar_overlay;
          if (gramOverlay && gramOverlay.tokens && gramOverlay.tokens.length) {
            var token = gramOverlay.tokens[0];
            var grammarEntries = token.grammar || [];
            if (grammarEntries.length) {
              var gramHtml = '<div class="flashcard-section-title">Grammar</div>';
              for (var i = 0; i < grammarEntries.length; i++) {
                var entry = grammarEntries[i];
                gramHtml += '<div class="flashcard-grammar-entry">';
                gramHtml += '<div class="flashcard-grammar-category">' + escapeHtml(entry.category || entry.type || '') + '</div>';
                gramHtml += '<div class="flashcard-grammar-gloss">' + escapeHtml(entry.gloss || '') + '</div>';
                gramHtml += '</div>';
              }
              flashcardGrammar.innerHTML = gramHtml;
            }
          }
        }
        // Load existing annotation
        fetch('/annotation?head=' + encodeURIComponent(head))
          .then(function(resp) { return resp.json(); })
          .then(function(aData) {
            if (aData && aData.ok && typeof aData.note === 'string' && flashcardAnnotation) {
              flashcardAnnotation.value = aData.note;
            }
          })
          .catch(function(err) {
            console.error('annotation load error', err);
          });
      })
      .catch(function(err) {
        console.error('flashcard content load error', err);
        if (flashcardPronunciation) flashcardPronunciation.innerHTML = '<div class="flashcard-error">Failed to load.</div>';
        if (flashcardDictionary) flashcardDictionary.innerHTML = '<div class="flashcard-error">Failed to load.</div>';
      });
  }
  function saveFlashcardAnnotation() {
    if (!flashcardCurrent || !flashcardAnnotation) return;
    var head = flashcardCurrent.head || flashcardCurrent.display || '';
    if (!head) return;
    var note = flashcardAnnotation.value;
    fetch('/annotation', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ head: head, note: note })
    })
      .catch(function(err) {
        console.error('annotation autosave error', err);
      });
  }
  if (flashcardModeBtn) {
    flashcardModeBtn.addEventListener('click', function() {
      openFlashcardMode();
    });
  }
  if (flashcardCloseBtn) {
    flashcardCloseBtn.addEventListener('click', function() {
      closeFlashcardMode();
    });
  }
  if (flashcardShowAnswerBtn) {
    flashcardShowAnswerBtn.addEventListener('click', function() {
      showFlashcardAnswer();
    });
  }
  if (flashcardKnowBtn) {
    flashcardKnowBtn.addEventListener('click', function() {
      gradeFlashcard(true);
    });
  }
  if (flashcardDontKnowBtn) {
    flashcardDontKnowBtn.addEventListener('click', function() {
      gradeFlashcard(false);
    });
  }
  // Autosave annotation with debounce
  if (flashcardAnnotation) {
    flashcardAnnotation.addEventListener('input', function() {
      if (flashcardAnnotationSaveTimeout) {
        clearTimeout(flashcardAnnotationSaveTimeout);
      }
      flashcardAnnotationSaveTimeout = setTimeout(function() {
        saveFlashcardAnnotation();
      }, 1000);
    });
  }

  // ===================== LEFT SIDEBAR MENU =====================
  var leftMenu = document.getElementById('left-menu');
  var menuToggle = document.getElementById('menu-toggle');
  var menuSections = document.querySelectorAll('.menu-section');
  var thresholdSlider = document.getElementById('bottomUpChunkThreshold');
  var thresholdValue = document.querySelector('.menu-slider-value');

  // Menu toggle (collapse/expand sidebar) - mirrors panel-toggle behavior
  if (menuToggle && leftMenu) {
    menuToggle.addEventListener('click', function() {
      var isOpen = menuToggle.classList.contains('menu-open');
      if (isOpen) {
        // Close the menu
        leftMenu.classList.add('collapsed');
        menuToggle.classList.remove('menu-open');
      } else {
        // Open the menu
        leftMenu.classList.remove('collapsed');
        menuToggle.classList.add('menu-open');
      }
    });
  }

  // Toggle behavior for menu sections (multiple can be open at once)
  menuSections.forEach(function(section) {
    var header = section.querySelector('.menu-section-header');
    if (header) {
      header.addEventListener('click', function() {
        section.classList.toggle('open');
      });
    }
  });

  // Slider value display update
  if (thresholdSlider && thresholdValue) {
    thresholdSlider.addEventListener('input', function() {
      thresholdValue.textContent = this.value;
    });
    // Sync initial value
    thresholdValue.textContent = thresholdSlider.value;
  }

  // Expose dictionary popup helpers for the reader interface.
  window.togglePanel = togglePanel;
  window.displayDictEntry = displayDictEntry;
  window.lookupAndDisplay = lookupAndDisplay;
  window.getSyntheticLookupText = function() {
    var idx = activePageIndex || 0;
    if (pageLookupTextByIndex && pageLookupTextByIndex[idx] != null) {
      return String(pageLookupTextByIndex[idx] || '');
    }
    return String(latestOriginalText || '');
  };
  window.getSyntheticLookupTextDebug = function() {
    var t = window.getSyntheticLookupText();
    return t.replace(/ /g, '[SP]').replace(/\n/g, '\\n\n');
  };
  window.setDepTreeSourceMode = setDepTreeSourceMode;
  Object.defineProperty(window, 'latestData', {
    get: function() { return latestData; },
    set: function(v) { latestData = v; },
    configurable: true
  });

  // On page load, show English guidance in the input and a one-time cached demo in output.
  setTimeout(function() {
    showInitialInputGuidanceIfEmpty();
    renderInitialExampleDemoIfAvailable();
  }, 100);
})();
