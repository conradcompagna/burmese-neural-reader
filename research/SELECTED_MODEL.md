# The trained Burmese grammatical-analysis model

I trained a joint spaCy pipeline for Burmese Neural Reader: a shared tok2vec
encoder, a POS morphologizer and a dependency parser that also predicts sentence
boundaries. The deployed checkpoint combines these three trained components.

## Corpus construction

I converted the myUDTree v1.0 annotations into 4,320 multi-sentence spaCy documents
and used a 95/5 document split. The selected training partition contains 4,104
documents, 41,036 sentences and 536,791 tokens; development contains 216 documents,
2,160 sentences and 27,716 tokens. The documents preserve the source words, POS,
dependency heads/relations and sentence boundaries; each groups ten consecutive
source sentences apart from the final six-sentence group.

## Model and selection

The shared encoder combines learned multihash features, 300-dimensional fastText
vectors and a width-128, six-layer maxout window encoder. Both task heads use
these features. The saved configuration specifies Adam, seed 0, dropout 0.1 and
evaluation every 1,000 steps. Checkpoint selection combines POS accuracy, UAS,
LAS and sentence-boundary F1 with weights 0.3, 0.3, 0.3 and 0.1.

| Development measure | Selected result |
|---|---:|
| Universal POS accuracy | 96.92% |
| Dependency UAS | 92.39% |
| Dependency LAS | 89.41% |
| Sentence-boundary precision | 91.49% |
| Sentence-boundary recall | 94.58% |
| Sentence-boundary F1 | 93.01% |

Re-evaluation of the selected model on all 216 retained development documents
with spaCy 3.8.11 reproduces all six saved scores exactly. The
[machine-readable record](evaluation/results/selected-spacy-training.json)
includes full-precision values, per-relation scores, split hashes and source
identities. This re-evaluation uses the original development split.

## Position in the reader

The model consumes already segmented words. My dictionary dynamic programming
and unigram/bigram scoring supply the reader’s final word boundaries; the
morphologizer assigns POS and the parser supplies syntax. The morphologizer’s
14 labels encode POS. Stanza’s UCSY entity model and supporting ALT/OSCAR
resources are upstream components, recorded separately from this trained model.

The static vocabulary contains 200,000 vector rows; every retained float32 row
matches its source in the Burmese fastText `cc.my.300` vectors. The source
annotations are [myUDTree](https://github.com/ye-kyaw-thu/myUDTree) (CC BY-NC-SA 4.0),
and the [fastText vectors](https://fasttext.cc/docs/en/crawl-vectors) use CC BY-SA 3.0.

The [complete component inventory](evaluation/results/selected-component-origins.json)
distinguishes the jointly trained spaCy components from stock Stanza resources
and the separate local CRF/BILU experiments. The
[deployed source inventory](evaluation/results/burmese-live-runtime-inventory.json)
records the model-loading paths checked against the live application.
