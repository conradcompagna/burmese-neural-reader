# Browser source

Run `npm ci && npm run build` before starting the application. Node 22+ is needed
for development/building; deployed browser assets have no Node runtime dependency.
`entries.json` maps maintained ES module/CSS entrypoints to the existing public
URLs. Generated bundles and source maps are ignored by Git.

`reader/index.mjs` initializes features in the same order as the former IIFE.
Features import named functions and explicit feature state. There is no runtime
source concatenation or `eval` loader. The compiled classic script preserves
existing globals such as `lookupAndDisplay`, `getSyntheticLookupText` and
`latestData`, so the template and integrations keep their contract.

| Feature | Modules to start with |
|---|---|
| Text and dictionary display | `reader/text.mjs`, `dictionary-rendering.mjs`, `dictionary-panel.mjs` |
| Lookup and annotations | `reader/lookup.mjs`, `token-rendering.mjs`, `segment-rendering.mjs`, `source-annotations.mjs` |
| Documents | `reader/file-import.mjs`, `pdf-pages.mjs`, `docx-selection.mjs`, `document-pagination.mjs` |
| Syntax/entity interaction | `reader/chunk-model.mjs`, `context-chunks.mjs`, `entity-hover.mjs`, `dependency-highlighting.mjs` |
| Settings and menus | `reader/preferences.mjs`, `settings-panels.mjs`, `menu-events.mjs` |
| Standalone research tree viewer | `dependency-tree/index.mjs`, `data.mjs`, `tree-state.mjs`, `rendering.mjs`, `chunks.mjs` |
| Styles | `styles/reader.css` imports semantic stylesheets in original cascade order |

The userscript entry lives under `research/experiments/userscript-era/source/` and
builds its historical output filename with the original metadata banner. Building
does not install or activate it. The research tree viewer also builds to its
existing filename; the production reader's enabled features remain unchanged.

## Validation

`npm test` checks original Unicode classification, dependency chunk membership,
CoNLL-U mappings and userscript metadata. `npm run test:browser` uses the real
Flask template against `tools/fixture_server.py`, with an injected tokenizer/parser
and synthetic dictionary in a temporary data directory. It covers lookup, hover,
side-panel lookup, text import, standalone tree rendering and archived userscript
wrapping with mocked transport. Install Chromium once with
`npx playwright install chromium` (CI uses `--with-deps`).

The local pre/post extraction comparison matched the reader DOM/style contract
for 558 elements and produced identical 1440×1000 Chromium screenshots (SHA-256
`739ce0e79517b9890ac2afa4eb0507b3124e38884bba2c97da87f78d542e2a19`). This is a
same-machine comparison, not a portable pixel baseline or a neural-quality metric.
