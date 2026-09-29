import { initializeSettings } from './settings.mjs';
import { initializePosOverlay } from './pos-overlay.mjs';
import { initializeGraphemes } from './graphemes.mjs';
import { initializePronunciation } from './pronunciation.mjs';
import { initializePopupLifecycle } from './popup-lifecycle.mjs';
import { initializeHover } from './hover.mjs';
import { initializePopupEvents } from './popup-events.mjs';
import { initializeBootstrapEvents } from './bootstrap-events.mjs';

/** Initialize features in the original script order. */
function bootstrap() {
  if (!initializeSettings()) return;
  if (!initializePosOverlay()) return;
  if (!initializeGraphemes()) return;
  if (!initializePronunciation()) return;
  if (!initializePopupLifecycle()) return;
  if (!initializeHover()) return;
  if (!initializePopupEvents()) return;
  if (!initializeBootstrapEvents()) return;
}
bootstrap();
