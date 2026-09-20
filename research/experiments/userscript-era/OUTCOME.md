# Tampermonkey hover dictionary — the reader's first form

Before the reader was a web application it was a userscript: inject a hover dictionary
into any page showing Burmese text, segment on the fly, and show definitions in a
tooltip.

Two versions are here:

- `...0.99k-fixed (29).user.js` — hierarchical entry rendering
- `...0.99m-grammar (bells ans whisltes version).user.js` — unlimited nesting plus
  grammar display

They are published because they show where the segmentation and entry-rendering logic
started, and because the constraint of running entirely in a content script forced the
lookup design that the application still uses: segment locally, look up in batches,
render progressively.

What ended the approach was the parsing. Dependency trees, POS overlays and
language-model scoring need a server and real models. The userscript could not carry
them, and the reader became an application instead.
