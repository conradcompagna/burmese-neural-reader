# Burmese Neural Reader

**A deployed Burmese reading application integrating neural parsing, dictionary segmentation, and source-document exploration.**

I built this reader to make Burmese texts easier to investigate at the level of words, grammatical structure, and source passages. The project combines language-specific lexical engineering with neural analysis for a low-resource language.

[Live reader](https://burmeseneuralreader.com/reader) · [Setup](docs/SETUP.md) · [Architecture](docs/ARCHITECTURE.md) · [Portfolio](https://github.com/conradcompagna)

---

## What runs in production

The repository root is the deployed application.

### Engineering highlights

- **Language-specific lexical search:** layered dictionaries, dynamic-programming segmentation, language-model scoring, and BK-tree fuzzy matching over edit distance.
- **Neural analysis in context:** a custom spaCy parsing pipeline and Stanza named-entity recognition integrated with dictionary segmentation and document spans.
- **Interactive close reading:** document import, hover definitions, dependency visualization, pronunciation/transliteration, annotations, and reading-review state.

### Explore the runtime

| Area | Starting point |
|---|---|
| Application lifecycle and routes | [wsgi.py](wsgi.py), [app.py](app.py) |
| Language-model scoring and fuzzy search | [lmbrain.py](lmbrain.py) |
| Grammar and pronunciation | [dict_pos_override.py](dict_pos_override.py), [ud_overlay.py](ud_overlay.py), [burmese_transliteration.py](burmese_transliteration.py) |
| Reading interface | [static/reader.js](static/reader.js), [templates/reader.html](templates/reader.html) |

`app.py` is one 372 KB module by design. [**docs/architecture/modules.md**](docs/architecture/modules.md) maps it: eighteen backend sections and a ten-part reader template, with line counts and a suggested reading order. Start there rather than at the top of the file.

The [Konbaung Knowledge Graph](https://github.com/conradcompagna/konbaung-knowledge-graph) reuses this reader's lexical stack through an explicit local adapter.

---

## How it was built

None of this runs in production. It is the offline infrastructure that produced the models, dictionaries and corpora the reader loads.

**[`research/`](research/)** — start at [research/README.md](research/README.md).

| | |
|---|---|
| [**Build chains**](research/pipeline/README.md) | Word segmentation, the sentence-boundary CRFs, the UD pipeline, and the dictionaries — how each was made. Start here. |
| [**What the reader loads**](research/STATUS.md) | Every loaded artefact mapped to the code that produced it, and the four CRF generations with their status. |
| [`research/pipeline/`](research/pipeline/) | Corpus construction, CRF training, spaCy configurations, dictionary building. |
| [`research/evaluation/`](research/evaluation/) | Tests, scoring harnesses, and the annotation viewers used to judge output by hand. |
| [`research/components/`](research/components/) | Algorithm modules in standalone form. |
| [`research/experiments/`](research/experiments/) | Superseded CRF generations and the original userscript, each with an `OUTCOME.md`. |

Almost every hard problem in this project is a boundary problem, because Burmese is written without spaces between words and chronicle prose carries no sentence-final punctuation. The clearest example is in the CRF series: a model that scored well by learning that a standalone sentence-final `သည်` sits at the end of its training sequence, and the change that removed the shortcut. That is written up in [research/experiments/sentence-final-particle-crf/OUTCOME.md](research/experiments/sentence-final-particle-crf/OUTCOME.md).

See [publication contents](docs/PUBLICATION.md) for what is excluded and why.
