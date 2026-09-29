# Research

Training, evaluation and data-preparation code behind the Burmese Neural Reader models
and dictionaries. The application is described in the [root README](../README.md).

| Folder | Contents |
|---|---|
| [releases/burmese-pos-dependency-spacy/](releases/burmese-pos-dependency-spacy/) | The trained POS and dependency parser used by the reader, with model card and evaluation |
| [pipeline/](pipeline/) | Corpus converters, word-segmentation data, sentence-boundary CRF trainers, spaCy configurations and dictionary builders |
| [evaluation/](evaluation/) | Score records, tests, scoring scripts and small viewers for inspecting model output |
| [components/](components/) | Standalone copies of segmentation and chunking algorithms (not imported by the application) |
| [experiments/](experiments/) | Sentence-boundary CRF development, the reader's userscript predecessor, and a retired POS diagnostic |
| `artifacts.py` | Checks and reassembles files stored as shards (see `pipeline/dictionaries/chronicle-unknown-words/`) |
