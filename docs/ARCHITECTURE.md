# Architecture

```mermaid
flowchart LR
    Source[Document / selected Burmese text] --> App[Flask reader]
    App --> Lexical[Dictionary segmentation and scoring]
    App --> Neural[spaCy parsing / Stanza NER]
    Lexical --> UI[Aligned reader overlays]
    Neural --> UI
```

`wsgi.py` initializes dictionaries, the grammar lexicon, spaCy, and Stanza before serving `app.py`. The application owns document handling, segmentation orchestration, and HTTP routes. `lmbrain.py` provides language-model scoring and spelling suggestions; `burmese_transliteration.py`, `dict_pos_override.py`, and `ud_overlay.py` provide language-specific display and grammatical processing.

`templates/reader.html` and `static/reader.js` form the reading interface. `training/deployed_spacy_config.cfg` records the deployed parser architecture; dictionary resources and model weights remain external. Runtime lexical regressions live in `tests/`.
