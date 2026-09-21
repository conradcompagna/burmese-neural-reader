# Research and build infrastructure

Everything here is **offline work**. None of it runs in production. It is the record of
how the models, dictionaries and corpora the reader loads were built and evaluated.

The deployed application is at the repository root. If you only want to see what the
service does, stop at the root [README](../README.md).

## Layout

| Directory | Contents |
|---|---|
| [`pipeline/`](pipeline/) | Code that produced something the runtime loads. See [pipeline/README.md](pipeline/README.md) for the build chains. |
| [`evaluation/`](evaluation/) | Tests, scoring harnesses, and the annotation viewers used to inspect model output by hand. |
| [`components/`](components/) | Historical standalone algorithm modules; maintained runtime code is now in `burmese_reader/`. |
| [`experiments/`](experiments/) | Work that did not ship, each with an `OUTCOME.md`. |
| [`notes/`](notes/) | Implementation notes. |

Start with the [evidence index](EVIDENCE.md) and [reproduction guide](REPRODUCIBILITY.md).
[`STATUS.md`](STATUS.md) distinguishes current source wiring from historical build records.

## Why this project is mostly about boundaries

Burmese is written without spaces between words, and chronicle prose has no
sentence-final punctuation of the kind a tokenizer can key on. Almost every hard
problem here is a boundary problem:

- **Word boundaries** — the current pipeline combines Stanza tokenization, dictionary
  dynamic programming and unknown-token merging; the BILU tagger is a historical
  research path, and optional language-model tables score dictionary candidates.
- **Sentence boundaries** — a sequence of CRFs, described in
  [pipeline/README.md](pipeline/README.md#2-sentence-boundary-crfs). The recurring
  design problem is preventing the model from learning a shortcut.
- **Page and paragraph boundaries in OCR** — a deliberately non-lexical CRF that reads
  line shape rather than words.

## What is deliberately not here

Model weights, dictionary TSVs, and training corpora. The myPOS, myNER and myUDTree
datasets, the Burmese UD treebank and the Judson and chronicle texts are third-party
resources under their own terms and are not redistributed. Scripts name their inputs.

Two archival scripts, `pipeline/corpus/build_chronicle_ngrams.py` and
`retokenize_conll_for_app.py`, still depend on the retired `newserver` startup contract.
They are method records and do not run against this clone unchanged; use the
maintained package and explicit resource initialization for any future port.
