import { initializeData } from './data.mjs';
import { initializeDom } from './dom.mjs';
import { initializeEvents } from './events.mjs';
import { initializeSources } from './sources.mjs';
import { initializeTreeState } from './tree-state.mjs';
import { initializeRendering } from './rendering.mjs';
import { initializeNavigation } from './navigation.mjs';
import { initializeTooltips } from './tooltips.mjs';
import { initializeOptions } from './options.mjs';
import { initializeChunks } from './chunks.mjs';
import { initializeBottomUp } from './bottom-up.mjs';
import { initializeRelations } from './relations.mjs';
import { initializeContextWindow } from './context-window.mjs';
import { initializeBranchDepth } from './branch-depth.mjs';
import { initializeRootPath } from './root-path.mjs';
import { initializeHighlights } from './highlights.mjs';
import { initializePublicApi } from './public-api.mjs';

/** Initialize features in the original script order. */
function bootstrap() {
  if (!initializeData()) return;
  if (!initializeDom()) return;
  if (!initializeEvents()) return;
  if (!initializeSources()) return;
  if (!initializeTreeState()) return;
  if (!initializeRendering()) return;
  if (!initializeNavigation()) return;
  if (!initializeTooltips()) return;
  if (!initializeOptions()) return;
  if (!initializeChunks()) return;
  if (!initializeBottomUp()) return;
  if (!initializeRelations()) return;
  if (!initializeContextWindow()) return;
  if (!initializeBranchDepth()) return;
  if (!initializeRootPath()) return;
  if (!initializeHighlights()) return;
  if (!initializePublicApi()) return;
}
bootstrap();
