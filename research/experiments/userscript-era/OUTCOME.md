# Tampermonkey hover dictionary — the reader's first form

Before the reader was a web application it was a userscript: inject a hover dictionary
into any page showing Burmese text, segment on the fly, and show definitions in a
tooltip.

Two versions are here:

- `...0.99k-fixed (29).user.js` — hierarchical entry rendering
- [`source/`](source/) — the `0.99m-grammar` version's modular source for unlimited
  nesting, transport/cache, pronunciation and grammar display; `npm run build`
  recreates its historical output filename without installing the userscript.

They are published because they show where the segmentation and entry-rendering logic
started, and because the constraint of running entirely in a content script forced the
lookup design that the application still uses: segment locally, look up in batches,
render progressively.

What ended the approach was the parsing. Dependency trees, POS overlays and
language-model scoring need a server and real models. The userscript could not carry
them, and the reader became an application instead.

`metadata.txt` retains the exact userscript metadata. `source-manifest.json` records
the original Git commit, path and SHA-256, so the historical artifact can be
retrieved and checked independently. The readable bundled output is behaviorally
equivalent source, not a claim of byte-for-byte identity with the original file.
The browser fixture mocks `GM_xmlhttpRequest`; it never sends document contents
to a real dictionary server.
