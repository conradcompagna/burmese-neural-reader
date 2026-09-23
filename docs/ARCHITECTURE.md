# Architecture

```mermaid
flowchart LR
    Source[Document / selected Burmese text] --> App[Flask reader]
    App --> Lexical[Dictionary segmentation and scoring]
    App --> Neural[spaCy parsing / Stanza NER]
    Lexical --> UI[Aligned reader overlays]
    Neural --> UI
```

`burmese_reader/application.py` composes the application and initializes resources
explicitly. `wsgi.py` uses that startup path; `app.py` is the small import facade
used by command-line and research adapters. Feature state belongs to the active
Flask application, with an explicit shared runtime for command-line use.

The current lookup path is Stanza tokenization → dictionary DP resegmentation →
unknown-token merging → NER/UD/POS overlays. The [research build chains](../research/pipeline/README.md)
explain the BILU and CRF experiments that informed language-specific feature design.
See the [module map](architecture/modules.md) for runtime ownership.

`lmbrain.py` provides language-model scoring and spelling suggestions;
`burmese_transliteration.py`, `dict_pos_override.py`, and `ud_overlay.py` provide
language-specific display and grammatical processing.

`templates/reader.html` and the modules under `frontend/reader/` form the reading
interface. `npm run build` produces the `static/reader.js` browser bundle. The
[browser map](../frontend/README.md) explains feature ownership, stylesheet order
and the standalone research viewer. Model packages and dictionaries are
provisioned separately.
