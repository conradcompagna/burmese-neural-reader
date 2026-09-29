# Pipeline

Scripts and configurations for building the reader's corpora, models and dictionaries.

| Folder | Contents |
|---|---|
| `corpus/` | Corpus converters and CRF training-data builders |
| `crf/` | Sentence-boundary and OCR-structure CRF trainers |
| `spacy/` | spaCy configurations, including the deployed parser (`spacy/deployed_pipeline/`) |
| `dictionaries/` | Dictionary builders and the chronicle unknown-word list |

At runtime the reader loads the spaCy POS/dependency model, Stanza for named entities,
four TSV dictionaries and myWord unigram/bigram frequency tables.

---

## 1. Word segmentation

The current reader uses custom dictionary dynamic programming with unigram/bigram
scoring to determine final words, followed by unknown-token merging. The Stanza
NER pre-pass supplies preliminary spans; contiguous regions are resegmented and
entities are remapped onto the resulting words. The BILU tagger below is an earlier
approach that learned boundaries at the grapheme-cluster level; it is not used by the
reader.

### 1a. The BILU boundary tagger

A spaCy model, separate from the UD parser, that labels each **grapheme cluster**
B / I / L / U so that word boundaries can be read off the label sequence.

```
myPOS v3 (word-segmented corpus)  +  myAlt (constituency trees)
  │
  ├─ corpus/build_tokenizer_bilu_from_mypos_myalt.py
  │     Splits each token into grapheme clusters, assigns BILU over them,
  │     and writes a spaCy DocBin. Constituency leaves are read out of the
  │     myAlt bracketing with a leaf regex.
  │
  ├─ corpus/altbank_to_bilou_chunks.py        alternative chunking of the same source
  │
  ├─ spacy/bilu/pretrain.cfg                  tok2vec pretraining on chronicle text
  ├─ spacy/bilu/bilu.cfg                      the tagger itself
  └─ spacy/bilu/check_tok2vec_init.py         confirms pretrained weights were loaded
```

The BILU inspection tools display grapheme-cluster labels for individual strings:
[`bilu_query_app.py`](../evaluation/viewers/bilu_query_app.py) and
[`query_bilu_tagger.py`](../evaluation/viewers/query_bilu_tagger.py).

### 1b. Dictionary dynamic programming and LM scoring

The DP runs over the dictionary inventory and scores candidates with the myWord
unigram/bigram tables. An alternative set of counts was built from the chronicle text:

```
chronicle text
  └─ corpus/build_chronicle_ngrams.py
        Normalizes with the server's own normalization function so that the
        inventory matches what the runtime will see, splits into Myanmar
        "islands", and counts word and phrase unigrams and bigrams up to
        length 4. Also emits chronicle-unknown-words.json.
        → chronicle-{unigram,bigram}-{word,phrase}.txt, consumed by lmbrain.py
```

`corpus/segment_text_file.py` segments a text file with the reader's segmenter.
`../components/word_breaker/` holds the Rabbit syllable segmenter and a rule-based word
segmenter.

---

## 2. Sentence-boundary CRFs

Chronicle prose lacks reliable punctuation, so sentence boundaries have to be predicted
from grammatical particles and context. `crf/train_sentence_boundary_crf.py` is the
basic trainer; the series below adds particle features, mixed training data and token
normalization.

### Generation 1 — chronicle-only

`crf/train_chronicle_sentence_crf.py`

- Punctuation is stripped **aggressively**, so the model cannot learn "`。` implies
  split" and then fail on unpunctuated text.
- Features come from the hand-built grammar dictionary: sentence-final phrase
  particles (`Stc~`) and sentence markers (`V~`, `N~`).
- Top end-word unigrams are learned from the training data itself, which catches
  chronicle-specific enders the grammar dictionary does not list.

### Generation 2 — pooled across registers

`crf/train_sentence_crf_pooled_strip_punct.py`, then the final-particle series.

Training mix by sequence count: **chronicle 50%, myUDTree 25%, alt 25%**, combining
historical and modern Burmese.

### Generation 3 — the `သည်` problem

`crf/train_sentence_final_particle_crf_pooled_v6_thi_merge.py`
(v3 and v4 are in [`../experiments/sentence-final-particle-crf/`](../experiments/sentence-final-particle-crf/))

The particle `သည်` appears both attached to the preceding word and standing alone. In
multi-sentence training sequences a standalone sentence-final `သည်` is always the last
token, so the model can learn "`သည်` at end-of-sequence" — an end-of-sequence shortcut
that does not generalize. v6 fuses sentence-final standalone `သည်` into the previous
token (`X` + `သည်` → `Xသည်`) inside multi-sentence sequences to remove that cue. See
[`../experiments/sentence-final-particle-crf/`](../experiments/sentence-final-particle-crf/).

Chronicle sentences are also filtered to those whose final token is in an allowed set
drawn from the grammar TSV plus a short additional list.

### OCR structure boundaries

`crf/train_ocr_structure_boundary_crf.py` — a **non-lexical** CRF over
boundary positions between whitespace-delimited islands, labelling O / SENT\_END /
PARA\_END. It has no token-identity features at all. It learns from junk tokens between
Myanmar islands, orthographic-cluster counts for short-line paragraph ends, and
line-shape features (digit and punctuation density, low Myanmar ratio) that identify
headers, titles and footnotes. Trains v1/v2/v3 and selects a best.

[`predict_ocr_structure_boundary.py`](../evaluation/predict_ocr_structure_boundary.py)
applies the OCR boundary model to document text.

### Corpus preparation for all of the above

```
corpus/build_crf_corpus_tagged_strict.py     strict tagged corpus
corpus/process_tagged_strict.py              post-processing
corpus/make_crf_windows_from_conllu.py       fixed windows from CoNLL-U
corpus/make_crf_windows_from_alt.py          fixed windows from the alt bank
corpus/rewrite_crf_corpus.py                 relabelling passes
corpus/rechunk_crf_jsonl.py                  re-chunk sequences
corpus/split_jsonl_contiguous.py             contiguous train/dev split
corpus/select_every_nth_jsonl.py             subsampling
```

Input format throughout is JSONL with `tokens`, `pos` and `sent_end_after`.
The [scoring script](../evaluation/eval_model_on_jsonl.py) evaluates JSONL sequences,
the [comparison tool](../evaluation/compare_segmentation_and_sentence_chunkers.py)
compares strategies on the same text, and the
[annotation viewers](../evaluation/viewers/) expose individual boundary decisions.

---

## 3. The UD parsing pipeline

The deployed model contains **tok2vec, morphologizer and parser**, trained with
`spacy/deployed_pipeline/joint_ud_morph_parser_no_ner.cfg`; named entities come from
Stanza. [`selected_checkpoint.json`](spacy/deployed_pipeline/selected_checkpoint.json)
records the checkpoint hashes, the 95/5 split and the development scores. The model
card is [`../releases/burmese-pos-dependency-spacy/`](../releases/burmese-pos-dependency-spacy/).

```
Burmese UD treebank (my_burmese-ud-{train,dev,test}.conllu)
myUDTree v1.0, myNER 7-tag, alt bank
  │
  ├─ corpus/fix_conllu_root_count.py          repair multi-root sentences
  ├─ spacy/stream_train/drop_punct_from_conllu.py
  ├─ corpus/retokenize_conll_for_app.py       align NER corpus to app tokenization
  ├─ corpus/const2dep_mech_mimic_udtree.py    constituency → dependency, mimicking
  │                                           myUDTree's conventions
  ├─ corpus/conllu_to_docbin.py
  ├─ corpus/conllu_to_spacy.py
  ├─ spacy/stream_train/make_spacy_stream_docbin.py   streaming DocBin build for
  │                                           corpora that do not fit in memory
  ├─ spacy/stream_train/split_conllu_train_dev.py
  │
  ├─ spacy/deployed_pipeline/pretrain_chr.cfg, pretrain_chr_v3_config.cfg
  │                                           tok2vec pretraining on chronicle text
  ├─ spacy/deployed_pipeline/pretrain_vec.cfg  vector-based pretraining
  │
  └─ spacy/deployed_pipeline/joint_ud_morph_parser_no_ner.cfg       → selected model-best
     spacy/deployed_pipeline/joint_ud_morph_parser_ner_filled.cfg   joint NER experiment
     spacy/deployed_pipeline/nerconfig.cfg                          NER-only variant
     spacy/deployed_pipeline/spacy_docbins_manifest_95_5.json       the 95/5 split manifest
```

Other configurations in `spacy/`: `config.cfg` and `config_caps.cfg` (earlier parser
configurations), `ner.cfg` (spaCy NER), `config_senter.cfg` (sentence segmenter),
`config_phrases.cfg` and `phrase_tagger.cfg` (phrase tagging),
`spancat_model_last_config.cfg` (span categorizer), and `stream_train/config.cfg`,
`configfast.cfg` (streaming training).

Stanza supplies the selected application's NER; `evaluation/stanza_test.py` is the harness.

---

## 4. Dictionaries

The reader combines four TSV dictionaries, with source-specific preparation paths:

| Dictionary | Built by |
|---|---|
| Burmese–English Wiktionary | `dictionaries/kaikki_to_tsv.py` from the Kaikki Wiktionary dump |
| MMD (Myanmar–English) | `dictionaries/clean_mmd.py` — strips non-Myanmar suffixes from headwords, drops ASCII-only entries, normalizes the rest; emits a JSON report of every change |
| Pali (`peu.tsv`) | external |
| Burmese grammar dictionary | Hand-built grammatical lexicon (`burmese_grammar_dictionary.tsv`); not included in the repository |

The grammar dictionary's `Stc~`, `V~` and `N~` classes are the particle features used
by the sentence-boundary CRFs.

`dictionaries/chronicle-unknown-words/` lists chronicle words missing from the
dictionaries. Scoring scripts and viewers are in [`../evaluation/`](../evaluation/).
