# Evaluation

## Tests

`tests/test_bktree.py`, `tests/test_lmbrain_bktree.py` — the BK-tree fuzzy search over
edit distance, which is what makes a lookup succeed when the segmenter produces a form
that is one or two characters away from a dictionary headword. `tests/test_pos_simple.py`
is a POS smoke test.

## Scoring

| Script | What it does |
|---|---|
| `eval_model_on_jsonl.py` | scores a CRF against held-out JSONL sequences |
| `compare_segmentation_and_sentence_chunkers.py` | compares segmentation and sentence-chunking strategies on the same text |
| `predict_ocr_structure_boundary.py` | runs the OCR structure CRF over a document |
| `top_chronicle_sentence_endwords.py` | ranks the tokens that actually end sentences in the chronicle corpus — the analysis that produced the CRF cue features |
| `inspect_jsonl_boundaries.py`, `inspect_upos.py`, `inspect_ud_span.py` | inspect corpus and model output |
| `stanza_test.py` | Stanza NER harness |

`dep_v3.postpass_v1.report.json` is a scored dependency post-pass run.

## Viewers

Annotation is judged by eye as well as by score. These are small local apps built for
that:

| Viewer | Shows |
|---|---|
| `viewers/crf_sentence_app.py` | CRF sentence predictions over a document, boundary by boundary |
| `viewers/boundary_app.py` | boundary decisions with their features |
| `viewers/pos_compare_app.py` | two POS sources side by side |
| `viewers/bilu_query_app.py`, `viewers/query_bilu_tagger.py` | the BILU tagger's grapheme-cluster labels for an input string |
| `viewers/tree_viewer.html` | dependency trees |
