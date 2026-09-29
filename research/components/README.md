# Components

Standalone development records make individual segmentation and visualization
algorithms easy to explore. The [module guide](../../docs/architecture/modules.md)
connects them to the maintained application modules in `burmese_reader/`.

| File | What it does |
|---|---|
| `advanced_segmenter.py` | the standalone dictionary-DP segmenter; maintained integration lives in `burmese_reader/segmentation.py` |
| `burmese_clause_chunker_final_patched_v3.py` | clause chunking over parsed output |
| [Dependency-tree source](../../frontend/dependency-tree/) | data/layout, SVG rendering, chunking and interaction for the research dependency-tree viewer |
| `whitespace_boundaries.js`, `chunk_gap_logic.js` | boundary and gap handling in the reader |
| `word_breaker/Rabbit.py` | Rabbit syllable segmentation for Burmese |
| `word_breaker/myparser.py`, `word_breaker/word_segment_v5.py` | rule-based word segmentation, used as a baseline and a fallback |

These are reference copies. The runtime does not import them.

The maintained spaced-repetition implementation is
[`burmese_reader/srs.py`](../../burmese_reader/srs.py).
