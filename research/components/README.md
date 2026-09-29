# Components

Standalone copies of segmentation and chunking algorithms. The application does not
import them; the maintained versions are in [`../../burmese_reader/`](../../burmese_reader/).

| File | Purpose |
|---|---|
| `advanced_segmenter.py` | Dictionary dynamic-programming word segmenter (maintained version: `burmese_reader/segmentation.py`) |
| `burmese_clause_chunker_final_patched_v3.py` | Clause chunking over parsed output |
| `whitespace_boundaries.js`, `chunk_gap_logic.js` | Boundary and gap handling in the reader |
| `word_breaker/Rabbit.py` | Rabbit syllable segmentation |
| `word_breaker/myparser.py`, `word_breaker/word_segment_v5.py` | Rule-based word segmentation |

The dependency-tree viewer source is in [`../../frontend/dependency-tree/`](../../frontend/dependency-tree/).
