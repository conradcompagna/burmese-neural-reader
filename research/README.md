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
| [`components/`](components/) | Algorithm modules that the runtime absorbed into `app.py`, kept separately because they are readable on their own. |
| [`experiments/`](experiments/) | Work that did not ship, each with an `OUTCOME.md`. |
| [`notes/`](notes/) | Implementation notes. |

[`STATUS.md`](STATUS.md) states which models the deployed reader loads and which build
chain produced each one.

## Why this project is mostly about boundaries

Burmese is written without spaces between words, and chronicle prose has no
sentence-final punctuation of the kind a tokenizer can key on. Almost every hard
problem here is a boundary problem:

- **Word boundaries** — solved three ways at once and reconciled: dictionary-driven
  dynamic programming, a neural BILU tagger over grapheme clusters, and language-model
  scoring over the candidates.
- **Sentence boundaries** — a sequence of CRFs, described in
  [pipeline/README.md](pipeline/README.md#2-sentence-boundary-crfs). The recurring
  design problem is preventing the model from learning a shortcut.
- **Page and paragraph boundaries in OCR** — a deliberately non-lexical CRF that reads
  line shape rather than words.

## What is deliberately not here

Model weights, dictionary TSVs, and training corpora. The myPOS, myNER and myUDTree
datasets, the Burmese UD treebank and the Judson and chronicle texts are third-party
resources under their own terms and are not redistributed. Scripts name their inputs.

Two scripts in `pipeline/corpus/` import `newserver`, the name the server module had
when they were written. The module is now `app.py`. They are published unmodified.
