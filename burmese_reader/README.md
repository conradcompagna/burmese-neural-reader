# burmese_reader

The Flask application behind the reader, organized by feature.

| Area | Modules |
|---|---|
| Application setup and state | `application.py`, `runtime.py`, `http.py`, `settings.py`, `templating.py`, `pages.py` |
| Text normalization and grapheme/syllable boundaries | `normalization.py`, `graphemes.py` |
| Dictionaries | `dictionary_types.py`, `dictionary_loaders.py`, `lexicon.py`, `custom_entries.py`, `custom_routes.py` |
| Word segmentation (dictionary dynamic programming) | `segmentation_config.py`, `segmentation.py`, `dictionary_dp.py`, `fill.py` |
| Analysis pipeline (Stanza NER, segmentation, spaCy parse) | `pipeline.py`, `ner.py`, `ud.py`, `lookup.py` |
| POS and grammar | `pos.py`, `pos_labels.py`, `pos_statistics.py`, `grammar.py` |
| Language model and spelling suggestions | `language_model.py`, `lm_runtime.py`, `lm_overlay.py`, `fuzzy.py`; `lmbrain.py` at the repository root |
| Pronunciation | `pronunciation.py`; `burmese_transliteration.py` at the repository root |
| Documents and PDF | `document_conversion.py`, `document_routes.py`, `document_support.py`, `pdf_extraction.py`, `pdf_geometry.py`, `pdf_cache.py`, `text_extraction.py` |
| Annotations and review (public routes disabled) | `annotations.py`, `annotation_routes.py`, `srs.py`, `srs_routes.py` |
| Request policy and diagnostics (debug routes disabled) | `policy.py`, `memory.py`, `logs.py`, `debug_*.py` |

`pipeline.py` runs the Stanza NER pass, resegments the text with the dictionary DP
(`fill.py`, `dictionary_dp.py`) and merges unknown segments. `lookup.py` adds the spaCy
parse (`ud.py`) and assembles the result returned to the browser. `app.py` at the repository
root keeps older import paths working.
