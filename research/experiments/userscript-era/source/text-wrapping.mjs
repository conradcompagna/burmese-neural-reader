import { isMyanmarChar } from './graphemes.mjs';
import { isInEditable } from './popup-lifecycle.mjs';
export // ---- DOM walking / wrapping ----
function walk(node) {
  let child, next;
  switch (node.nodeType) {
    case 1:
      // element
      // don't touch the popup itself
      if (node.id === 'burmese-hover-popup') return;

      // skip anything in editable / input areas (ChatGPT editor, forms, etc.)
      if (isInEditable(node)) return;

      // avoid re-wrapping already-processed spans
      if (node.classList && node.classList.contains('burmese-word')) return;
      child = node.firstChild;
      while (child) {
        next = child.nextSibling;
        walk(child);
        child = next;
      }
      break;
    case 3:
      // text node
      // if this text node lives inside an editable, leave it alone
      if (isInEditable(node)) return;
      handleText(node);
      break;
  }
}
export function handleText(textNode) {
  const text = textNode.nodeValue;
  // Only bother if there is at least one Myanmar char in this node
  if (!text || !/[\u1000-\u109F]/.test(text)) return;
  const frag = document.createDocumentFragment();
  let buffer = '';
  const len = text.length;
  function flushBuffer() {
    if (buffer) {
      frag.appendChild(document.createTextNode(buffer));
      buffer = '';
    }
  }
  let i = 0;
  while (i < len) {
    const ch = text[i];

    // Anything that is NOT a Myanmar char: keep as plain text
    if (!isMyanmarChar(ch)) {
      buffer += ch;
      i++;
      continue;
    }

    // FIXED: We hit a Myanmar char: start a Burmese run
    // Keep going while we see Myanmar chars or non-whitespace garbage
    // Stop at: spaces, Myanmar punctuation, or line breaks
    flushBuffer();
    let start = i;
    let j = i + 1;
    while (j < len) {
      const c = text[j];

      // Stop at whitespace (space, tab, etc.)
      if (/\s/.test(c)) {
        break;
      }

      // Stop at Myanmar sentence marks (၊ ။)
      if (c === '\u104a' || c === '\u104b') {
        break;
      }

      // Stop at dashes and common punctuation that separate text
      if (c === '–' || c === '-' || c === '—') {
        break;
      }

      // If we hit non-Myanmar char, check if it's start of English text
      if (!isMyanmarChar(c)) {
        // Look ahead: if next char is also non-Myanmar (esp. letters/spaces),
        // this is probably English text starting, so stop
        if (j + 1 < len) {
          const next = text[j + 1];
          if (/[a-zA-Z\s]/.test(next)) {
            break;
          }
        }
      }

      // Otherwise keep going - Myanmar chars or isolated garbage like ရေ1ာက်
      j++;
    }
    const token = text.slice(start, j);
    const span = document.createElement('span');
    span.textContent = token;
    span.className = 'burmese-word';
    frag.appendChild(span);
    i = j;
  }
  flushBuffer();
  if (textNode.parentNode) {
    textNode.parentNode.replaceChild(frag, textNode);
  }
}

// NEW: wrap Myanmar text inside a specific element in .burmese-word spans
export function wrapMyanmarInElement(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) {
    textNodes.push(n);
  }
  for (const tn of textNodes) {
    handleText(tn);
  }
}
export function initWrap() {
  walk(document.body);
}

// initial passes (for static content)
