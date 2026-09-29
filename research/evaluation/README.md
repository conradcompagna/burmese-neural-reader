# Evaluation

| Path | Contents |
|---|---|
| `results/selected-spacy-training.json` | Development scores of the deployed spaCy parser, reproduced on all 216 development documents |
| `results/selected-component-origins.json` | Which components are trained here and which are upstream (Stanza) |
| `results/burmese-live-runtime-inventory.json` | Model-loading paths checked against the live application |
| `results/burmese-sanitized-validation.json` | Check that the published parser files, with checkpoint metadata removed, reproduce the saved scores |
| `tests/` | Tests for the BK-tree fuzzy dictionary search |
| `benchmark_bktree.py` | Timing benchmark for the BK-tree search |
| `dep_v3.postpass_v1.report.json` | Counts from a rule-based dependency correction pass (679,592 tokens) |
| `viewers/` | Small local apps for inspecting CRF, boundary, POS, BILU and dependency output |

## Scoring and inspection scripts

| Script | Purpose |
|---|---|
| `eval_model_on_jsonl.py` | Scores a sentence-boundary CRF on held-out JSONL sequences |
| `compare_segmentation_and_sentence_chunkers.py` | Compares segmentation and sentence-chunking methods on the same text |
| `predict_ocr_structure_boundary.py` | Runs the OCR structure CRF over a document |
| `top_chronicle_sentence_endwords.py` | Counts the words that end sentences in the chronicle corpus; used to choose CRF features |
| `inspect_jsonl_boundaries.py`, `inspect_upos.py`, `inspect_ud_span.py` | Inspect corpus files and model output |
| `stanza_test.py` | Runs the Stanza NER model on sample text |

The parser's development scores and training details are in the
[model card](../releases/burmese-pos-dependency-spacy/README.md).
