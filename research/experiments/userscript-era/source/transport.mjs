import { isMyanmarChar, splitMyanmarClusters } from './graphemes.mjs';
import { settingsState } from './settings.state.mjs';
export // ADDED: Cache management
function getCachedLookup(chunk) {
  const cached = settingsState.lookupCache.get(chunk);
  if (!cached) return null;

  // Check if cache is stale
  if (Date.now() - cached.timestamp > settingsState.CACHE_DURATION_MS) {
    settingsState.lookupCache.delete(chunk);
    return null;
  }
  return cached.data;
}
export function setCachedLookup(chunk, data) {
  // Simple LRU: if cache is full, delete oldest entries
  if (settingsState.lookupCache.size >= settingsState.CACHE_MAX_SIZE) {
    const firstKey = settingsState.lookupCache.keys().next().value;
    settingsState.lookupCache.delete(firstKey);
  }
  settingsState.lookupCache.set(chunk, {
    data: data,
    timestamp: Date.now()
  });
}

// ---- dictionary lookup via GM_xmlhttpRequest with caching ----
export function lookupWord(chunk) {
  // ADDED: Check cache first
  const cached = getCachedLookup(chunk);
  if (cached) {
    return Promise.resolve(cached);
  }
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET',
      url: settingsState.API_URL + '?q=' + encodeURIComponent(chunk),
      timeout: 5000,
      // ADDED: 5 second timeout
      onload: (resp) => {
        try {
          const data = JSON.parse(resp.responseText);
          setCachedLookup(chunk, data); // ADDED: Cache the result
          resolve(data);
        } catch (e) {
          console.error('[BurmeseHoverDict] parse error', e);
          reject(e);
        }
      },
      onerror: (e) => {
        console.error('[BurmeseHoverDict] network error', e);
        reject(e);
      },
      ontimeout: () => {
        console.error('[BurmeseHoverDict] timeout');
        reject(new Error('Request timeout'));
      }
    });
  });
}

// Fallback: lookup components for an unknown/any word by splitting into grapheme clusters
export async function lookupComponentsForUnknown(head) {
  const clusters = splitMyanmarClusters(head);
  const components = [];
  for (const c of clusters) {
    const hasBur = [...c].some(isMyanmarChar);
    if (!hasBur || !c.trim()) continue;
    try {
      const compData = await lookupWord(c);
      if (compData.ok && compData.results && compData.results.length) {
        components.push({
          cluster: c,
          results: compData.results
        });
      } else {
        components.push({
          cluster: c,
          results: []
        });
      }
    } catch (e) {
      console.error('[BurmeseHoverDict] component lookup error', e);
      components.push({
        cluster: c,
        results: []
      });
    }
  }
  return components;
}

// ADDED: helper to get subsegments for a head (via /subsegments, with fallback)
export async function getSubsegmentsForHead(head) {
  const token = (head || '').trim();
  if (!token) {
    return [];
  }

  // First, try dedicated /subsegments endpoint if available
  try {
    const data = await new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: settingsState.SUBSEG_API_URL + '?token=' + encodeURIComponent(token),
        timeout: 5000,
        onload: (resp) => {
          try {
            const json = JSON.parse(resp.responseText);
            resolve(json);
          } catch (err) {
            console.error('[BurmeseHoverDict] subsegments parse error', err);
            resolve(null);
          }
        },
        onerror: () => {
          resolve(null);
        },
        ontimeout: () => {
          resolve(null);
        }
      });
    });
    if (data && data.ok && Array.isArray(data.subsegments) && data.subsegments.length) {
      return data.subsegments;
    }
  } catch (e) {
    console.error('[BurmeseHoverDict] subsegments request error', e);
  }

  // Fallback: derive subsegments via component lookups
  try {
    const components = await lookupComponentsForUnknown(token);
    const subsegments = [];
    for (const comp of components) {
      const c = comp.cluster;
      const results = comp.results || [];
      if (results.length) {
        const best = results[0];
        subsegments.push({
          head: best.head || c,
          roman: best.roman || '',
          pos: best.pos || '',
          senses: best.senses || (best.gloss ? [best.gloss] : [])
        });
      } else {
        subsegments.push({
          head: c,
          roman: '',
          pos: '[unknown]',
          senses: ['[no dictionary entry found for this subsegment]'],
          // Mark this as an irreducible unknown subsegment
          irreducible: true
        });
      }
    }
    return subsegments;
  } catch (e) {
    console.error('[BurmeseHoverDict] subsegment fallback error', e);
    return [];
  }
}

// ---- DOM walking / wrapping ----
