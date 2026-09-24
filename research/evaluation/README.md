# Evaluation

## Selected grammatical-analysis model

The [trained spaCy model](../SELECTED_MODEL.md) records corpus construction,
joint tok2vec/POS/parser training and checkpoint selection. Re-evaluation on all
216 retained development documents reproduces the six saved POS, attachment and
sentence-boundary scores exactly; the [score record](results/selected-spacy-training.json)
includes full-precision results, per-relation scores and split identities.

## Tests

`tests/test_bktree.py`, `tests/test_lmbrain_bktree.py` — the BK-tree fuzzy search over
edit distance, which is what makes a lookup succeed when the segmenter produces a form
that is one or two characters away from a dictionary headword. The retired POS smoke test is archived under
[`../experiments/legacy-pos/`](../experiments/legacy-pos/).

## Scoring

| Script | What it does |
|---|---|
| `eval_model_on_jsonl.py` | scores a CRF against held-out JSONL sequences |
| `compare_segmentation_and_sentence_chunkers.py` | compares segmentation and sentence-chunking strategies on the same text |
| `predict_ocr_structure_boundary.py` | runs the OCR structure CRF over a document |
| `top_chronicle_sentence_endwords.py` | ranks the tokens that actually end sentences in the chronicle corpus — the analysis that produced the CRF cue features |
| `inspect_jsonl_boundaries.py`, `inspect_upos.py`, `inspect_ud_span.py` | inspect corpus and model output |
| `stanza_test.py` | Stanza NER harness |

`dep_v3.postpass_v1.report.json` records a dependency post-pass over 679,592 tokens.
It measures reference alignment following rule-based corrections; unseen-data parser
accuracy requires a separate evaluation. The [evidence index](../EVIDENCE.md) connects
these measurements to the corpus and correction workflow.

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
