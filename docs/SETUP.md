# Setup and external resources

Use Python 3.12. Create and activate a virtual environment, then install `requirements.txt`. The deployment dependencies target Linux and include a pinned Stanza revision.

The application requires separately provisioned resources:

- The layered dictionary files named in `newserverPDF21split.py`: Burmese Wiktionary, `MMD_clean.tsv`, `peu.tsv`, and the grammar dictionary.
- The `myWord-main` frequency resources used by the lexical engine.
- The custom spaCy pipeline under `model-best/`.
- Stanza's Burmese resources under `stanza_resources/`.

`BURMESE_DATA_ROOT` specifies the dictionary and spaCy resource root. `STANZA_RESOURCES_DIR` specifies Stanza's resource directory. See `.env.example` for configuration names; export those values into the process environment before running Gunicorn. This application's WSGI entrypoint does not automatically load `.env`.

From the repository root on Linux, after providing resources:

```sh
gunicorn wsgi:app --bind 127.0.0.1:5000 --workers 1 --threads 1 --timeout 120
```

Open `/reader`. `wsgi.py` initializes the dictionaries, grammar lexicon, parser, and NER pipeline.

## Research tools

`research/` contains the original corpus preparation, segmentation experiments, boundary models, and evaluations. Its spaCy configuration files describe training architecture without distributing model weights. Research tools have individual CLI and corpus requirements; they do not all share the deployed runtime environment.

`training/deployed_spacy_config.cfg` preserves the deployed parser configuration. The root `requirements.txt` describes the reader runtime, not every historical experiment.

No dictionaries, trained models, source corpora, personal annotations, or reading-review records are bundled. Source-only validation checks syntax and packaging. Full reader and NLP evaluation require those external resources.
