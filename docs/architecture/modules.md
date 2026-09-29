# Maintained module map

The Flask server is organized by responsibility under `burmese_reader/`. Each
feature owns its implementation and uses application-scoped state.

| Responsibility | Modules |
|---|---|
| App construction, explicit startup, feature-owned state | `application.py`, `runtime.py`, `http.py`, `settings.py` |
| Input preservation and grapheme/syllable boundaries | `normalization.py`, `graphemes.py` |
| Layer priority and dictionary storage | `dictionary_types.py`, `dictionary_loaders.py`, `lexicon.py`, `custom_entries.py` |
| Dictionary DP, costs and traces | `segmentation_config.py`, `segmentation.py`, `dictionary_dp.py`, `fill.py` |
| Current Stanza → DP → merge pipeline | `ner.py`, `pipeline.py`, `ud.py`, `lookup.py` |
| POS and grammar overlays | `pos.py`, `grammar.py`, `pos_statistics.py` |
| Optional lexical language model | `language_model.py`, `lm_runtime.py`, `lm_overlay.py`; root `lmbrain.py` |
| Pronunciation | `pronunciation.py`; root `burmese_transliteration.py` |
| Documents | `document_conversion.py`, `pdf_extraction.py`, `pdf_geometry.py`, `pdf_cache.py`, `text_extraction.py`, `document_routes.py` |
| Annotation/SRS persistence | `annotations.py`, `srs.py`; their public routes retain the existing disabled behavior |
| HTTP policy and diagnostics | `policy.py`, `memory.py`, `logs.py`, `debug_*.py`, `templates/debug/` |

Start with `pipeline.py`, then `segmentation.py` and `dictionary_types.py`; follow
`lookup.py` to see how surface spans and overlays become the HTTP payload.
`ner.py` reuses the Stanza document from tokenization for entity extraction.
`pos.py` implements the POS overlay and its normalization rules.

`runtime.py` resolves each feature's state against the active application's
extensions. State factories are lazy and do not read model files. The
`app.py` facade shares the command-line runtime so
existing `from app import load_dictionary, segment_with_pipeline` adapters retain
their contract. New integrations should import the owning feature module and
operate inside their application's context. Configuration is process-level;
model/dictionary handles and mutable caches belong to an app.

The published default keeps debug routes blocked. Several historical diagnostic
views also return `debug_disabled` inside their handlers; changing the outer flag
does not turn them into supported production features. Their code is retained for
research inspection.

The earlier BILU model, retired POS tagger and sentence-boundary experiments are
under `research/`. They do not replace the maintained Stanza/DP path.
