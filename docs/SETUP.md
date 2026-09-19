# Setup and external resources

Use Python 3.12. Create and activate a virtual environment, then install `requirements.txt`. The deployment dependencies target Linux and include a pinned Stanza revision.

The application requires separately provisioned resources:

- The layered dictionary files named in `app.py`: Burmese Wiktionary, `MMD_clean.tsv`, `peu.tsv`, and the grammar dictionary.
- The `myWord-main` frequency resources used by the lexical engine.
- The custom spaCy pipeline under `model-best/`.
- Stanza's Burmese resources under `stanza_resources/`.

`BURMESE_DATA_ROOT` specifies the dictionary and spaCy resource root. `STANZA_RESOURCES_DIR` specifies Stanza's resource directory. See `.env.example` for configuration names; export those values into the process environment before running Gunicorn. This application's WSGI entrypoint does not automatically load `.env`.

From the repository root on Linux, after providing resources:

```sh
gunicorn wsgi:app --bind 127.0.0.1:5000 --workers 1 --threads 1 --timeout 120
```

Open `/reader`. `wsgi.py` initializes the dictionaries, grammar lexicon, parser, and NER pipeline.

## Training and checks

`training/corpus/` and `training/boundaries/` contain preparation and training code. `training/configs/` holds the named spaCy architectures; `training/deployed_spacy_config.cfg` records the deployed parser architecture. Training inputs and weights must be supplied separately. See the [training guide](../training/README.md).

Run `python -m unittest discover -s tests -v` for the model-free lexical regressions. Install `ruff==0.16.8` and run `ruff check .` and `ruff format --check .` for the authored Python checks used in CI. Full neural parsing and document integration require the external resources above.
