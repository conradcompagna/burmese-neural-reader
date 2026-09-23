import { chunkHighlightingState } from './chunk-highlighting.state.mjs';
import { dependencyGeometryState } from './dependency-geometry.state.mjs';
import { dependencyState } from './dependency-state.state.mjs';
import { readerState } from './reader-state.state.mjs';
export function ensureUdSvgOverlay() {
  if (dependencyState.udSvgOverlay) return dependencyState.udSvgOverlay;
  dependencyState.udSvgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  dependencyState.udSvgOverlay.id = 'ud-svg-overlay';
  dependencyState.udSvgOverlay.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
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
  dependencyState.udSvgOverlay.appendChild(defs);
  readerState.renderedText.appendChild(dependencyState.udSvgOverlay);
  return dependencyState.udSvgOverlay;
}

// --- UD rect caching (avoid per-hover layout queries) ---
export function invalidateUdRectCache() {
  dependencyState.udTokenRectCache.clear();
  dependencyGeometryState.udContainerRect = null;
}
export function buildUdRectCache() {
  dependencyState.udTokenRectCache.clear();
  if (!readerState.renderedText) {
    dependencyGeometryState.udContainerRect = null;
    return;
  }
  dependencyGeometryState.udContainerRect = readerState.renderedText.getBoundingClientRect();
  if (!dependencyGeometryState.udContainerRect) return;
  dependencyState.udTokenIndex.forEach(function (spanEl, segIdx) {
    if (!spanEl || typeof spanEl.getBoundingClientRect !== 'function') return;
    var r = spanEl.getBoundingClientRect();
    if (!r) return;
    var left = r.left - dependencyGeometryState.udContainerRect.left;
    var top = r.top - dependencyGeometryState.udContainerRect.top;
    dependencyState.udTokenRectCache.set(Number(segIdx), {
      left: left,
      top: top,
      width: r.width,
      height: r.height,
      right: left + r.width,
      bottom: top + r.height,
      cx: left + r.width / 2,
      cy: top + r.height / 2
    });
  });
}
export function ensureUdRectCache() {
  if (!dependencyGeometryState.udContainerRect || dependencyState.udTokenRectCache.size === 0)
    buildUdRectCache();
}

// === UI RECT CACHE (POPUPS / CHIPS / NON-TOKEN ELEMENTS) ===
// These caches are separate from the token geometry cache (udTokenRectCache).
// They primarily exist to avoid repeated layout reads (getBoundingClientRect) across hot paths like
// hover popups and NER chips, while being conservatively invalidated on layout changes.
export function invalidateUiRectCache() {
  dependencyGeometryState.uiRectCache = new WeakMap();
  dependencyGeometryState.uiRectCacheEpoch++;
}
export function invalidateUiRectFor(el) {
  try {
    if (dependencyGeometryState.uiRectCache && el) dependencyGeometryState.uiRectCache.delete(el);
  } catch (e) {}
}
export function _rectObjFromDomRect(r) {
  if (!r) return null;
  return {
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height
  };
}
export function getUiRect(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  var rec = null;
  try {
    rec = dependencyGeometryState.uiRectCache.get(el);
  } catch (e) {
    rec = null;
  }
  if (rec && rec.epoch === dependencyGeometryState.uiRectCacheEpoch && rec.rect) return rec.rect;
  var r = null;
  try {
    r = el.getBoundingClientRect();
  } catch (e2) {
    r = null;
  }
  if (!r) return null;
  var obj = _rectObjFromDomRect(r);
  try {
    dependencyGeometryState.uiRectCache.set(el, {
      epoch: dependencyGeometryState.uiRectCacheEpoch,
      rect: obj
    });
  } catch (e3) {}
  return obj;
}

// Prefer UD token geometry cache for .reader-token spans (fast + stable). Falls back to UI rect cache.
export function getViewportRectForTokenSpan(spanEl) {
  if (!spanEl) return null;
  var segIdx = parseInt(spanEl.dataset && spanEl.dataset.index ? spanEl.dataset.index : '-1', 10);
  if (isFinite(segIdx) && segIdx >= 0) {
    ensureUdRectCache();
    var t = dependencyState.udTokenRectCache.get(segIdx);
    if (
      t &&
      dependencyGeometryState.udContainerRect &&
      isFinite(dependencyGeometryState.udContainerRect.left) &&
      isFinite(dependencyGeometryState.udContainerRect.top)
    ) {
      var L = dependencyGeometryState.udContainerRect.left + t.left;
      var T = dependencyGeometryState.udContainerRect.top + t.top;
      var R = dependencyGeometryState.udContainerRect.left + t.right;
      var B = dependencyGeometryState.udContainerRect.top + t.bottom;
      return {
        left: L,
        top: T,
        right: R,
        bottom: B,
        width: R - L,
        height: B - T
      };
    }
  }
  return getUiRect(spanEl);
}
export function hideUdLines() {
  // Remove active SVG elements without DOM-wide queries
  if (dependencyGeometryState.udActivePaths && dependencyGeometryState.udActivePaths.length) {
    for (var i = 0; i < dependencyGeometryState.udActivePaths.length; i++) {
      var p = dependencyGeometryState.udActivePaths[i];
      if (p && p.parentNode) p.remove();
    }
    dependencyGeometryState.udActivePaths.length = 0;
  }

  // Clear any tracked highlighted elements
  if (dependencyGeometryState.udActiveHighlights && dependencyGeometryState.udActiveHighlights.length) {
    for (var j = 0; j < dependencyGeometryState.udActiveHighlights.length; j++) {
      var el = dependencyGeometryState.udActiveHighlights[j];
      if (!el || !el.classList) continue;
      el.classList.remove('ud-highlight', 'ud-highlight-parent', 'ud-highlight-child', 'ud-root-highlight');
    }
    dependencyGeometryState.udActiveHighlights.length = 0;
  }
  clearPosTagHighlights();
}
export function clearPosTagHighlights() {
  chunkHighlightingState.chunkPosTags.forEach(function (tag) {
    // Reset to default styling
    tag.style.backgroundColor = '';
    tag.style.color = '';
    tag.style.fontWeight = '';
    tag.style.boxShadow = '';
    tag.style.transform = '';
  });
}
export function initializeDependencyGeometry() {
  // segIdx -> {left, top, width, height, right, bottom, cx, cy}
  dependencyGeometryState.udContainerRect = null; // Cached renderedText bounding rect at cache build time
  dependencyGeometryState.udActivePaths = []; // Track SVG elements created for fast cleanup
  dependencyGeometryState.udActiveHighlights = []; // Track highlighted elements for fast cleanup
  dependencyGeometryState.nerHoverOverlay = null;
  dependencyGeometryState.hoverReticle = null;
  dependencyGeometryState.lastHoverReticleSegIdx = -1;
  dependencyGeometryState.lastHoverReticleTarget = null;
  dependencyGeometryState.uiRectCache = new WeakMap(); // element -> { epoch, rect:{left,top,right,bottom,width,height} }
  dependencyGeometryState.uiRectCacheEpoch = 1;
  return true;
}
