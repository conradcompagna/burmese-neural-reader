# Burmese Neural Reader

**A deployed Burmese reading application integrating neural parsing, dictionary segmentation, and source-document exploration.**

I built this reader to make Burmese texts easier to investigate at the level of words, grammatical structure, and source passages. The project combines language-specific lexical engineering with neural analysis for a low-resource language.

[Live reader](https://burmeseneuralreader.com/reader) · [Setup](docs/SETUP.md) · [Architecture](docs/ARCHITECTURE.md) · [Portfolio](https://github.com/conradcompagna)

[![Checks](https://github.com/conradcompagna/burmese-neural-reader/actions/workflows/checks.yml/badge.svg)](https://github.com/conradcompagna/burmese-neural-reader/actions/workflows/checks.yml)

## Engineering highlights

- **Language-specific lexical search:** layered dictionaries, dynamic-programming segmentation, language-model scoring, and BK-tree fuzzy matching over edit distance.
- **Neural analysis in context:** a custom spaCy parsing pipeline and Stanza named-entity recognition integrated with dictionary segmentation and document spans.
- **Interactive close reading:** document import, hover definitions, dependency visualization, pronunciation/transliteration, annotations, and reading-review state.
- **Inspectable lexical behavior:** model-free regressions compare BK-tree results with exhaustive edit-distance search and verify spelling suggestions against Burmese fixtures.

## Explore the code

| Area | Starting point |
|---|---|
| Application lifecycle and routes | [wsgi.py](wsgi.py), [app.py](app.py) |
| Language-model scoring and fuzzy search | [lmbrain.py](lmbrain.py) |
| Grammar and pronunciation | [dict_pos_override.py](dict_pos_override.py), [ud_overlay.py](ud_overlay.py), [burmese_transliteration.py](burmese_transliteration.py) |
| Reading interface | [static/reader.js](static/reader.js), [templates/reader.html](templates/reader.html) |
| Deployed parser architecture | [Model configuration](training/deployed_spacy_config.cfg) |
| Model-free regressions | [tests/](tests/) |

## Run the lightweight checks

```sh
python -m unittest discover -s tests -v
```

The tests compare fuzzy search with exhaustive edit-distance search and exercise the reader's spelling suggestions using in-memory Burmese fixtures. Full neural reading requires the external dictionaries and models described in [setup](docs/SETUP.md).

The [Konbaung Knowledge Graph](https://github.com/conradcompagna/konbaung-knowledge-graph) reuses this reader's lexical stack through an explicit local adapter. See [publication contents](docs/PUBLICATION.md) for excluded data.
