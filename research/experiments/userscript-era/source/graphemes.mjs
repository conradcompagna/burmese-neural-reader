import { graphemesState } from './graphemes.state.mjs';
export function isMyanmarChar(ch) {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return code >= 0x1000 && code <= 0x109f;
}

// Rough Myanmar combining mark check (for building grapheme-ish clusters)
export function isMyanmarCombining(ch) {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  // main combining range + viramas/medials
  if (code >= 0x102b && code <= 0x103e) return true;
  if (code >= 0x1050 && code <= 0x1059) return true;
  if (code === 0x1039 || code === 0x103a) return true;
  // ADDED: Additional marks
  if (code === 0x1036 || code === 0x1038) return true;
  return false;
}

// Return Burmese grapheme-ish clusters as an array
export function splitMyanmarClusters(s) {
  const clusters = [];
  let current = '';
  for (const ch of s) {
    if (isMyanmarChar(ch) && !isMyanmarCombining(ch)) {
      if (current) clusters.push(current);
      current = ch;
    } else if (isMyanmarCombining(ch) && current) {
      current += ch;
    } else {
      if (current) {
        clusters.push(current);
        current = '';
      }
      // keep non-Myanmar or stray as separate chunk if you want it visible
      clusters.push(ch);
    }
  }
  if (current) clusters.push(current);
  return clusters;
}

// For "Spelling:" display
export function phoneticBreakdown(s) {
  return splitMyanmarClusters(s).join(' · ');
}

// --- G2P (pronunciation) UI layer ------------------------------------
export function initializeGraphemes() {
  graphemesState.BASE_Z_INDEX = 1000001;
  return true;
}
