# Tampermonkey hover dictionary — the reader's first form

Before the reader was a web application it was a userscript: inject a hover dictionary
into any page showing Burmese text, segment on the fly, and show definitions in a
tooltip.

Two versions are here:

- `...0.99k-fixed (29).user.js` — hierarchical entry rendering
- [`source/`](source/) — the `0.99m-grammar` version's modular source for unlimited
  nesting, transport/cache, pronunciation and grammar display.

The reader application kept the userscript's lookup design (segment locally, look up in
batches, render progressively) and added server-side parsing, POS tagging and
language-model scoring.

`metadata.txt` and `source-manifest.json` record the original userscript's metadata and
SHA-256.
