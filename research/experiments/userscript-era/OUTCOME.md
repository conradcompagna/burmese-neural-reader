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

The next stage combined that interaction design with server-side parsing, POS
overlays, and language-model scoring. That integration became the full reading
application, retaining the userscript's emphasis on responsive lookup in context.

`metadata.txt` and `source-manifest.json` record the original userscript metadata,
Git commit, path, and SHA-256. The readable bundle preserves behavior while the
manifest supports byte-level checks against the original. Browser fixtures use a
mock dictionary transport for local testing.
