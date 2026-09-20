# Components

Algorithm modules that the deployed server absorbed into `app.py`. They are kept here
in their standalone form because each is readable on its own, where the corresponding
section of a 372 KB file is not. See [`docs/architecture/modules.md`](../../docs/architecture/modules.md)
for how they map onto the deployed file.

| File | What it does |
|---|---|
| `advanced_segmenter.py` | the segmenter in its standalone form, before it became section 05 |
| `burmese_clause_chunker_final_patched_v3.py` | clause chunking over parsed output |
| `reading_srs.py` | the spaced-repetition engine behind the flashcard UI |
| `dep_tree_view.js` | dependency-tree rendering; the largest single piece of front-end code in the project |
| `whitespace_boundaries.js`, `chunk_gap_logic.js` | boundary and gap handling in the reader |
| `word_breaker/Rabbit.py` | Rabbit syllable segmentation for Burmese |
| `word_breaker/myparser.py`, `word_breaker/word_segment_v5.py` | rule-based word segmentation, used as a baseline and a fallback |

These are reference copies. The runtime does not import them.
