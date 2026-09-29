---
license: other
license_name: conrad-compagna-model-evaluation-1.0
license_link: LICENSE
language:
- my
inference: false
library_name: spacy
tags:
- dependency-parsing
- part-of-speech
- sentence-segmentation
- burmese
---

# Burmese POS and Dependency Parser

I trained this spaCy pipeline for the grammatical analysis stage of
[Burmese Neural Reader](https://github.com/conradcompagna/burmese-neural-reader).
It combines a shared tok2vec encoder, a morphologizer that assigns universal POS
tags, and a transition-based dependency parser with sentence-boundary prediction.
These are the trained components used by the deployed reader.

## Training and evaluation

I prepared the myUDTree v1.0 annotations as 4,320 multi-sentence documents and
trained the joint pipeline on a 95/5 document split: 4,104 training documents
and 216 development documents. Each document contains ten source sentences,
apart from the final six-sentence group. The training partition contains 536,791
tokens and the development partition 27,716 tokens.

| Development metric | Score |
| --- | ---: |
| Universal POS accuracy | 96.92% |
| Unlabeled attachment score | 92.39% |
| Labeled attachment score | 89.41% |
| Sentence-boundary F1 | 93.01% |

These scores are saved in the selected checkpoint. Re-evaluating it against the
retained development set with spaCy 3.8.11 reproduces the saved figures exactly.

The encoder combines multihash token features with 300-dimensional fastText
vectors and a six-layer, width-128 maxout window encoder. The task heads share
these representations. I trained with Adam, dropout 0.1 and seed 0, selecting
checkpoints using POS accuracy, dependency attachment and sentence-boundary F1.

## Use the trained pipeline

The model takes **already segmented Burmese words**. In my reader, dictionary
dynamic programming and unigram/bigram scoring determine the final word
boundaries before the grammatical analysis stage.

With the downloaded `model` directory and spaCy 3.8.11:

```python
import spacy
from spacy.tokens import Doc

nlp = spacy.load("model")

def analyze_words(words: list[str], spaces: list[bool]) -> Doc:
    """Preserve the word boundaries and spacing supplied by your segmenter."""
    return nlp(Doc(nlp.vocab, words=words, spaces=spaces))
```

Read POS labels from `token.pos_`, dependency relations from `token.dep_`, heads
from `token.head`, and predicted sentences from `doc.sents`. The checkpoint uses
spaCy's `xx` language class to accept externally segmented Burmese text. Its
morphologizer's label set is POS-only. NER is a separate stage in the reader.

## Sources

The training annotations are from [myUDTree v1.0](https://github.com/ye-kyaw-thu/myUDTree)
by Zar Zar Hlaing, Ye Kyaw Thu and collaborators. The corpus is distributed under
[CC BY-NC-SA 4.0](https://github.com/ye-kyaw-thu/myUDTree/blob/main/LICENSE.md).

The static embeddings are the Burmese Common Crawl/Wikipedia
[fastText vectors](https://fasttext.cc/docs/en/crawl-vectors), distributed under
CC BY-SA 3.0. The spaCy vocabulary retains 200,000 vector rows and 335,230 word
keys. See Grave et al., *Learning Word Vectors for 157 Languages*, LREC 2018.


[Evaluation record](evaluation.json) · [Artifact identities](artifact-manifest.json) · [Third-party notices](THIRD_PARTY_NOTICES.md)

## Downloads

[Hugging Face model and files](https://huggingface.co/conradcompagna/burmese-pos-dependency-spacy) ·
[Complete GitHub ZIP](https://github.com/conradcompagna/burmese-neural-reader/releases/download/models-2026-09-24/burmese-pos-dependency-spacy.zip)

The package contains the selected native weights, evaluation record, artifact
hashes, source credits and runtime requirements.

## Release terms

My original weights and accompanying code are available for research, education,
experimentation and evaluation under the [Model Evaluation License](LICENSE).
Commercial deployment or redistribution of those weights requires my permission.
Third-party assets retain the terms in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
