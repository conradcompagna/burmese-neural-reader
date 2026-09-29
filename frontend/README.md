# Browser source

Source for the reader's browser code, as ES modules. `npm run build`
(`tools/build_frontend.mjs`) compiles the entry points listed in `entries.json` into
the `static/` files loaded by the reader template; those build outputs are not tracked.

`reader/index.mjs` initializes the interface. The compiled script exposes the functions
the template calls, including `lookupAndDisplay`, `getSyntheticLookupText` and
`latestData`.

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
its build keeps the metadata header that userscript managers require.
