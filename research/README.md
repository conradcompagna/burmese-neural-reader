# Burmese NLP: from linguistic data to a reading application

Start with the [construction story and supporting evidence](../docs/BUILD_PROCESS.md)
for the selected artifacts and the process connecting them to the application.

This directory records corpus preparation, model training, lexical engineering, and
the tools used to inspect their outputs. The work addresses a connected set of
language-specific problems: word segmentation, sentence boundaries, OCR structure,
and alignment between neural analysis and the text a reader sees.

## Where to start

1. **Corpus and model construction:** the [build chains](pipeline/README.md) connect
   CoNLL-U, constituency data, and DocBins to spaCy and CRF training configurations.
2. **Boundary feature design:** the [sentence-boundary case study](experiments/sentence-final-particle-crf/OUTCOME.md)
   follows the treatment of Burmese final particles across trainer generations.
3. **Inspection and evaluation:** the [evaluation guide](evaluation/README.md) covers
   lexical regression tests, scoring harnesses, and interactive annotation viewers.

The [application overview](../README.md) and [architecture](../docs/BUILD_PROCESS.md#runtime-architecture)
connect this research to the deployed reading interface.

## Supporting records

| Directory | Contents |
|---|---|
| [pipeline/](pipeline/) | Corpus converters, CRF trainers, spaCy configurations, and dictionary builders |
| [evaluation/](evaluation/) | Tests, scoring tools, and viewers for inspecting model output |
| [components/](components/) | Standalone records of segmentation and visualization algorithms |
| [experiments/](experiments/) | Feature-design iterations and the reader's userscript origins |
| [notes/](notes/) | Implementation notes for lexical retrieval and related components |

[STATUS.md](STATUS.md) connects model and dictionary artifacts to their build records.

## Corpus and model records

The [selected resource map](STATUS.md) distinguishes the parser and lexical
resources used by the reader from retained BILU, NER and CRF experiments.

The [evidence index](EVIDENCE.md) connects each research path to its data, training
configuration, and evaluation record. The [training procedure](REPRODUCIBILITY.md)
explains the selected parser configuration and the sequence-modeling work.
