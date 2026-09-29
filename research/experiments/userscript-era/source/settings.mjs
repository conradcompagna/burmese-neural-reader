import { settingsState } from './settings.state.mjs';
export function initializeSettings() {
  settingsState.API_URL = 'http://127.0.0.1:5000/lookup';
  settingsState.SUBSEG_API_URL = 'http://127.0.0.1:5000/subsegments';

  // ADDED: Simple in-memory cache for lookups (reduces server load dramatically)
  settingsState.lookupCache = new Map();
  settingsState.CACHE_MAX_SIZE = 500;
  settingsState.CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

  // ------------------------------------------------------------------
  // POS COLOURING / GRAMMAR OVERLAY (UI SIDE)
  // ------------------------------------------------------------------

  // Coarse tag set – must match server-side tags
  return true;
}
