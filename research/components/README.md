# Components

Historical standalone algorithm modules whose maintained counterparts now live
under `burmese_reader/`. See the [current module map](../../docs/architecture/modules.md).

| File | What it does |
|---|---|
| `advanced_segmenter.py` | the segmenter in its standalone form, before it became section 05 |
| `burmese_clause_chunker_final_patched_v3.py` | clause chunking over parsed output |
| [Dependency-tree source](../../frontend/dependency-tree/) | data/layout, SVG rendering, chunking and interaction; `npm run build` generates `dep_tree_view.js` at this location |
| `whitespace_boundaries.js`, `chunk_gap_logic.js` | boundary and gap handling in the reader |
| `word_breaker/Rabbit.py` | Rabbit syllable segmentation for Burmese |
| `word_breaker/myparser.py`, `word_breaker/word_segment_v5.py` | rule-based word segmentation, used as a baseline and a fallback |

These are reference copies. The runtime does not import them.

The spaced-repetition engine is not reproduced here: the standalone copy in the
development workspace has drifted from the maintained implementation, which is
[`burmese_reader/srs.py`](../../burmese_reader/srs.py).
