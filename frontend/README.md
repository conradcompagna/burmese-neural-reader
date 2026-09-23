# Browser source

Run `npm ci && npm run build` before starting the application. Node 22+ is needed
for development/building; deployed browser assets have no Node runtime dependency.
`entries.json` maps maintained ES module/CSS entrypoints to the existing public
URLs. Generated bundles and source maps are ignored by Git.

`reader/index.mjs` initializes the interface through explicit feature imports.
Each feature uses named functions and shared state modules. The compiled classic
script exposes the template API, including `lookupAndDisplay`,
`getSyntheticLookupText`, and `latestData`.

| Feature | Modules to start with |
|---|---|
| Text and dictionary display | [text](reader/text.mjs), [dictionary rendering](reader/dictionary-rendering.mjs), [dictionary panel](reader/dictionary-panel.mjs) |
| Lookup and annotations | [lookup](reader/lookup.mjs), [tokens](reader/token-rendering.mjs), [segments](reader/segment-rendering.mjs), [source annotations](reader/source-annotations.mjs) |
| Documents | [file import](reader/file-import.mjs), [PDF pages](reader/pdf-pages.mjs), [DOCX selection](reader/docx-selection.mjs), [pagination](reader/document-pagination.mjs) |
| Syntax/entity interaction | [chunk model](reader/chunk-model.mjs), [context chunks](reader/context-chunks.mjs), [entity hover](reader/entity-hover.mjs), [dependency highlighting](reader/dependency-highlighting.mjs) |
| Settings and menus | [preferences](reader/preferences.mjs), [settings panels](reader/settings-panels.mjs), [menu events](reader/menu-events.mjs) |
| Standalone research tree viewer | [entrypoint](dependency-tree/index.mjs), [data](dependency-tree/data.mjs), [tree state](dependency-tree/tree-state.mjs), [rendering](dependency-tree/rendering.mjs), [chunks](dependency-tree/chunks.mjs) |
| Styles | [reader.css](styles/reader.css) imports semantic stylesheets in explicit cascade order |

The userscript experiment lives under `research/experiments/userscript-era/source/`;
its build preserves the metadata banner required by userscript managers. The
standalone research tree viewer has its own entrypoint and output in `entries.json`.

## Validation

`npm test` checks Unicode classification, dependency chunk membership,
CoNLL-U mappings and userscript metadata. `npm run test:browser` uses the real
Flask template against `tools/fixture_server.py`, with an injected tokenizer/parser
and synthetic dictionary in a temporary data directory. It covers lookup, hover,
side-panel lookup, text import, standalone tree rendering and archived userscript
wrapping with mocked transport. Install Chromium once with
`npx playwright install chromium` (CI uses `--with-deps`).

Backend and browser fixtures validate the application contracts independently of
model assets. Neural evaluation and training evidence are documented in the
[research guide](../research/EVIDENCE.md).
