# Module map for `app.py`

`app.py` is a single 372 KB Flask module. That is a deliberate deployment choice — one
file, no import graph to get wrong on a small VPS — but it is not readable top to
bottom.

During development the same server was maintained in a decomposed form: eighteen
numbered backend sections plus a ten-part reader template, reassembled into the single
file at build time. That decomposition is the best available map of what is inside
`app.py`, and it is reproduced below with the line counts of each section.

Sections are listed in the order they appear. The names are the original ones.

## Backend

| # | Section | Lines | What it holds |
|---:|---|---:|---|
| 01 | core framework | 281 | paths, configuration, dictionary and corpus locations, Flask app construction |
| 02 | reading SRS backend | 238 | the spaced-repetition flashcard engine; `TokenStats` and review scheduling |
| 03 | UD parser backend | 493 | loads the spaCy UD model (`model-best`), produces dependency parses |
| 04 | BILU and normalization backend | 292 | the neural token-boundary segmenter: a **separate** spaCy model that predicts B/I/L/U labels over grapheme clusters, which is how word boundaries are recovered from unspaced Burmese |
| 05 | embedded segmenter core | 880 | the segmenter proper, merged in from what was once a standalone module |
| 06 | dictionary sources backend | 576 | loading and indexing of the Wiktionary, MMD, Pali, grammar and user dictionaries |
| 07 | segmentation without ML, and DP | 720 | grapheme-cluster construction and dictionary-driven dynamic-programming segmentation |
| 08 | DP resegmentation backend | 356 | full bigram/unigram DP resegmentation per island; DP is allowed to cross NER spans rather than treating them as hard boundaries |
| 09 | neural segmentation merge | 852 | reconciles the BILU model's boundaries with greedy dictionary matching |
| 10 | POS disambiguation overlay | 418 | myPOS-driven part-of-speech disambiguation and grammar hinting |
| 11 | LM overlay backend | 758 | language-model scoring over candidate segmentations, surfaced to the UI |
| 12 | HTTP API backend | 991 | the routes; `merge_token_overlays` combines the overlays above into one token stream |
| 13 | document import (PDF/DOCX) | 308 | document ingestion |
| 14 | simplified text extraction | 500 | Word and plain-text pages with 500-word breaks |
| 15 | debug: UD and displaCy | 774 | `/debug_ud_parser` and dependency visualisation |
| 16 | debug tools and assets | 1248 | `/segment_text` and the rest of the developer endpoints |
| 18 | reader route and main | 15 | `/reader` and the entry point |

## Reader template

Section 17 is the reader page, held as ten string parts and concatenated by
`17_reader_html_assemble.py`.

| Part | Lines | Contents |
|---|---:|---|
| 01 template and CSS | 1898 | document shell and styling |
| 02 JS bootstrap | 1106 | grammar type colours, initialisation |
| 03 UD visualisation | 1734 | the dependency-tree SVG overlay |
| 04 UI state init | 79 | display toggles, localStorage defaults |
| 05 chunk highlighting | 963 | POS-coloured chunk rendering |
| 06 post-chunk UI | 1484 | settings, persistence, controls |
| 07 original view A | 1520 | the original-page (PDF image) view |
| 08 original view B | — | continuation of the original view; present in the development snapshot only |
| 09 side panel | 894 | `lookupAndDisplay` and the dictionary panel |
| 10 flashcard and close | 277 | the SRS flashcard overlay |

## Reading order

To understand how a lookup works, read 07 → 08 → 04 → 09 → 10 → 11 → 12: dictionary DP,
resegmentation, neural boundaries, the merge, POS disambiguation, LM scoring, then the
route that assembles them.

The decomposed source in the development workspace is a snapshot of an earlier revision
of the server (`newserverpdf21.py`, 20,829 lines) and is not byte-identical to the
current `app.py`; the section boundaries and responsibilities are unchanged. It is not
published as runnable code, because maintaining two copies of a server is worse than
maintaining one.
