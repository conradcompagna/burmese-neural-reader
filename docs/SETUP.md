# Setup and external resources

Use Python 3.12. Create and activate a virtual environment, then install `requirements.txt`. The deployment dependencies target Linux and include a pinned Stanza revision.

Build the browser assets with Node 22+: `npm ci && npm run build`. This writes the
existing `static/reader.js` and `static/reader.css` URLs from the maintained source
under `frontend/`; the generated files are not committed.

The application requires separately provisioned resources:

- The layered dictionary files named in `burmese_reader/settings.py`: Burmese Wiktionary, `MMD_clean.tsv`, `peu.tsv`, and the grammar dictionary.
- The `myWord-main` frequency resources used by the lexical engine.
- The custom spaCy pipeline under `model-best/`.
- Stanza's Burmese resources under `stanza_resources/`.

`BURMESE_DATA_ROOT` specifies the dictionary and spaCy resource root. `STANZA_RESOURCES_DIR` specifies Stanza's resource directory. See `.env.example` for configuration names; export those values into the process environment before running Gunicorn. This application's WSGI entrypoint does not automatically load `.env`.

From the repository root on Linux, after providing resources:

```sh
gunicorn wsgi:app --bind 127.0.0.1:5000 --workers 1 --threads 1 --timeout 120
```

Open `/reader`. `wsgi.py` initializes the dictionaries, grammar lexicon, parser, and NER pipeline.

Running the full neural reader requires the external resources above.

## Fixture checks without neural assets

```sh
python -m pip install -r requirements-dev.txt
python -m pytest
python tools/check_repository.py
```

The fixtures exercise dictionary priority, grapheme boundaries, DP segmentation,
Stanza-shaped adapters, Unicode spans, full lookup responses, persistence, DOCX
text extraction and PDF text/geometry. They do not establish trained model quality.
Word-to-PDF conversion still requires the original optional `docx2pdf`/Word setup
and is distinct from the portable DOCX text extraction test.

`create_app(load_resources=False, segmenter=..., stanza_ner=..., ud_parser=...)`
accepts explicit adapters and prevents lazy neural loading. Each constructed app
owns its model handles, dictionaries, NER cache, annotation state and PDF cache.
Production filesystem paths are configured through the process environment before
import; separate apps in one process should not use different on-disk corpora.
The optional `lmbrain` frequency tables remain a process-wide read-only resource.

For an interactive local fixture, build the assets, install `requirements-dev.txt`,
then run `python tools/fixture_server.py` and open `http://127.0.0.1:8792/reader`.
The page labels its synthetic annotations; its custom-entry data is temporary.
`npm test` and `npm run test:browser` exercise the browser contracts and UI.
On Windows, `BNR_TEST_PYTHON` may be set to the full path of the Python executable
inside your virtual environment before running the browser suite.
