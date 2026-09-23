import { textState } from './text.state.mjs';
export function getGrammarColor(type) {
  return textState.GRAMMAR_TYPE_COLORS[type] || '#6b7280';
}
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
export function isMyanmarChar(ch) {
  if (!ch) return false;
  var cp = ch.codePointAt(0);
  if (!cp) return false;
  if (cp >= 0x1000 && cp <= 0x109f) return true;
  if (cp >= 0xaa60 && cp <= 0xaa7f) return true;
  if (cp >= 0xa9e0 && cp <= 0xa9ff) return true;
  return false;
}
export function isMyanmarCombiningMark(ch) {
  if (!ch) return false;
  var cp = ch.codePointAt(0);
  if (!cp) return false;
  if (cp >= 0x102b && cp <= 0x103e) return true;
  if (cp >= 0x1056 && cp <= 0x1059) return true;
  if (cp >= 0x105e && cp <= 0x1060) return true;
  if (cp >= 0x1062 && cp <= 0x1064) return true;
  if (cp >= 0x1067 && cp <= 0x106d) return true;
  if (cp >= 0x1071 && cp <= 0x1074) return true;
  if (cp >= 0x1082 && cp <= 0x108d) return true;
  if (cp === 0x108f) return true;
  if (cp === 0x1094) return true;
  if (cp >= 0x109a && cp <= 0x109d) return true;
  if (cp === 0x1036 || cp === 0x1038 || cp === 0x1039 || cp === 0x103a) return true;
  return false;
}
// Characters that can serve as syllable bases (consonants and independent vowels)
export // ္ - stacker that makes following consonant a modifier

// Check if a character is a base consonant or independent vowel
function isMyanmarBaseChar(ch) {
  return ch && textState.MYANMAR_BASE_CHARS.indexOf(ch) >= 0;
}

// Check if token has at least one BASE consonant (not preceded by virama)
// Stacked consonants (after virama) are modifiers, not bases
export function hasBaseConsonant(tok) {
  if (!tok) return false;
  for (var i = 0; i < tok.length; i++) {
    var ch = tok[i];
    if (isMyanmarBaseChar(ch)) {
      // Check if preceded by virama (making it a stacked consonant)
      if (i > 0 && tok[i - 1] === textState.VIRAMA) {
        continue; // Stacked consonant, not a base
      }
      return true; // Found a base consonant
    }
  }
  return false;
}

// Check if token has any combining marks (diacritics that need a base)
export function hasCombiningMarks(tok) {
  if (!tok) return false;
  for (var i = 0; i < tok.length; i++) {
    if (isMyanmarCombiningMark(tok[i])) return true;
  }
  return false;
}

// Check if a token needs a dotted circle prefix
// Only applies to tokens that have combining marks but no base consonant
// Numerals, abbreviations, etc. don't need dotted circles
export function needsDottedCircle(tok) {
  if (!tok) return false;
  // Must have combining marks to need a dotted circle
  if (!hasCombiningMarks(tok)) return false;
  // Needs dotted circle if it has combining marks but no base consonant
  return !hasBaseConsonant(tok);
}

// Unicode dotted circle character for displaying combining marks in isolation
export function isMyanmarPunctToken(tok) {
  return tok === '\u104a' || tok === '\u104b'; // ၊  ။
}
export function hasMyanmarChars(str) {
  if (!str) return false;
  for (var i = 0; i < str.length; i++) {
    if (isMyanmarChar(str[i])) return true;
  }
  return false;
}
export function debounce(fn, delay) {
  var t = null;
  return function () {
    var args = arguments,
      ctx = this;
    clearTimeout(t);
    t = setTimeout(function () {
      fn.apply(ctx, args);
    }, delay);
  };
}

// ------------------------------
// DOCX Original View (docx-preview) - Frontend-only
// ------------------------------
export function initializeText() {
  textState.GRAMMAR_TYPE_COLORS = {
    CLAUSE_ATTR: '#f59e0b',
    COMPOUND_NOUN_ELEM: '#16a34a',
    COMPOUND_VERB_ELEM: '#22c55e',
    CLASSIFIER: '#15803d',
    PREVERB: '#f97316',
    COORDINATOR: '#0ea5e9',
    LOCATION_NOUN: '#0891b2',
    MISC_FUNC: '#6b7280',
    NOUN_ATTR_MARKER: '#38bdf8',
    NOUN_MARKER: '#2563eb',
    NOUN_MODIFIER: '#1d4ed8',
    NEGATION_MARKER: '#dc2626',
    SELECTIVE: '#0d9488',
    SENTENCE_MARKER: '#4b5563',
    SENTENCE_MEDIAL_PART: '#6366f1',
    SENTENCE_FINAL_PART: '#a855f7',
    HEAD_NOUN: '#65a30d',
    SUBORDINATE_CLAUSE_MARKER: '#7c3aed',
    SUBORDINATE_SENTENCE_MARKER: '#7c3aed',
    VERB_ATTR_MARKER: '#84cc16',
    VERB_MODIFIER: '#d97706'
  };
  textState.MYANMAR_BASE_CONSONANTS = 'ကခဂဃငစဆဇဈဉညဋဌဍဎဏတထဒဓနပဖဗဘမယရလဝသဟဠအ';
  textState.MYANMAR_INDEPENDENT_VOWELS = 'ဣဤဥဦဧဩဪ';
  textState.MYANMAR_BASE_CHARS = textState.MYANMAR_BASE_CONSONANTS + textState.MYANMAR_INDEPENDENT_VOWELS;
  textState.MYANMAR_NUMERALS = '၀၁၂၃၄၅၆၇၈၉';
  textState.MYANMAR_ABBREVIATIONS = '၌၍၎၏';
  textState.VIRAMA = '\u1039';
  textState.DOTTED_CIRCLE = '\u25CC';
  return true;
}
