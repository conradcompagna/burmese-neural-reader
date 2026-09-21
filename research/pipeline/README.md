# Build chains

Historical build chains and their recorded outcomes; see the [evidence index](../EVIDENCE.md)
for public artifacts, split/seed records and verification limits.

The runtime loads, from `DATA_ROOT`: a spaCy UD model (`model-best`), a standalone NER
model, a Stanza NER pipeline and tokenizer, four dictionary TSVs, and the myPOS corpus.
None of those are in this repository. This is how they were produced.

---

## 1. Word segmentation

Burmese has no inter-word spaces. The current source uses Stanza tokenization,
dictionary DP and unknown-token merging. The BILU path below records an earlier
research approach; it is not an active default lookup stage.

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

Inspect a trained tagger with `evaluation/viewers/bilu_query_app.py` or
`evaluation/viewers/query_bilu_tagger.py`.

### 1b. Dictionary dynamic programming and LM scoring

No training. The DP runs over the dictionary inventory; the language model that scores
candidate segmentations is built from chronicle n-grams:

```
chronicle text
  └─ corpus/build_chronicle_ngrams.py
        Normalises with the server's own normalisation function so that the
        inventory matches what the runtime will see, splits into Myanmar
        "islands", and counts word and phrase unigrams and bigrams up to
        length 4. Also emits chronicle-unknown-words.json.
        → chronicle-{unigram,bigram}-{word,phrase}.txt, consumed by lmbrain.py
```

`components/word_breaker/` holds the Rabbit syllable segmenter and a rule-based word
segmenter used as a baseline and fallback.

---

## 2. Sentence-boundary CRFs

The hardest problem in the project. Chronicle Burmese has no full stop; sentences end
with a grammatical particle, and which particles end a sentence depends on context.

Each generation exists because the previous one learned a shortcut.

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

Training mix by sequence count: **chronicle 50%, myUDTree 25%, alt 25%**. A
chronicle-only model over-fits to chronicle style; a modern-Burmese model does not
transfer to it.

### Generation 3 — the `သည်` problem

`crf/train_sentence_final_particle_crf_pooled_v6_thi_merge.py`
(v3 and v4 are in [`../experiments/sentence-final-particle-crf/`](../experiments/sentence-final-particle-crf/))

The particle `သည်` appears both attached to the preceding word and standing alone. In
multi-sentence training sequences a standalone sentence-final `သည်` is always the last
token, so the model can learn "`သည်` at end-of-sequence" — an end-of-sequence shortcut
that does not generalise. v6 fuses sentence-final standalone `သည်` into the previous
token (`X` + `သည်` → `Xသည်`) inside multi-sentence sequences, removing the shortcut.

Chronicle sentences are also filtered to those whose final token is in an allowed set
drawn from the grammar TSV plus a short additional list.

### OCR structure boundaries

`crf/train_ocr_structure_boundary_crf.py` — a deliberately **non-lexical** CRF over
boundary positions between whitespace-delimited islands, labelling O / SENT\_END /
PARA\_END. It has no token-identity features at all. It learns from junk tokens between
Myanmar islands, orthographic-cluster counts for short-line paragraph ends, and
line-shape features (digit and punctuation density, low Myanmar ratio) that identify
headers, titles and footnotes. Trains v1/v2/v3 and selects a best.

Predict with `evaluation/predict_ocr_structure_boundary.py`.

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
Score with `evaluation/eval_model_on_jsonl.py`; compare generations with
`evaluation/compare_segmentation_and_sentence_chunkers.py`; inspect by hand with
`evaluation/viewers/crf_sentence_app.py` and `boundary_app.py`.

---

## 3. The UD parsing pipeline

The deployed `model-best` is a joint spaCy pipeline: tok2vec, tagger, morphologiser,
parser and NER trained together.

```
Burmese UD treebank (my_burmese-ud-{train,dev,test}.conllu)
myUDTree v1.0, myNER 7-tag, alt bank
  │
  ├─ corpus/fix_conllu_root_count.py          repair multi-root sentences
  ├─ corpus/drop_punct_from_conllu.py         (spacy/stream_train/)
  ├─ corpus/retokenize_conll_for_app.py       align NER corpus to app tokenisation
  ├─ corpus/const2dep_mech_mimic_udtree.py    constituency → dependency, mimicking
  │                                           myUDTree's conventions
  ├─ corpus/conllu_to_docbin.py
  ├─ corpus/conllu_to_spacy.py
  ├─ spacy/stream_train/make_spacy_stream_docbin.py   streaming DocBin build for
  │                                           corpora that do not fit in memory
  ├─ spacy/stream_train/split_conllu_train_dev.py
  │
  ├─ spacy/deployed_pipeline/pretrain_chr.cfg  tok2vec pretraining on chronicle text
  ├─ spacy/deployed_pipeline/pretrain_vec.cfg  vector-based pretraining
  ├─ spacy/deployed_pipeline/pretrain_log.jsonl  the pretraining loss trace
  │
  └─ spacy/deployed_pipeline/joint_ud_morph_parser_ner_filled.cfg   → model-best
     spacy/deployed_pipeline/joint_ud_morph_parser_no_ner.cfg       ablation without NER
     spacy/deployed_pipeline/nerconfig.cfg                          NER-only variant
     spacy/deployed_pipeline/spacy_docbins_manifest_95_5.json       the 95/5 split manifest
```

Other configs: `spacy/config_senter.cfg` (sentence segmenter), `config_phrases.cfg` and
`phrase_tagger.cfg` (phrase tagging), `spancat_model_last_config.cfg` (a span
categoriser over capitalised/structural spans).

Stanza supplies a second NER opinion; `evaluation/stanza_test.py` is the harness.

---

## 4. Dictionaries

Four TSVs load at runtime. None are published.

| Dictionary | Built by |
|---|---|
| Burmese–English Wiktionary | `dictionaries/kaikki_to_tsv.py` from the Kaikki Wiktionary dump |
| MMD (Myanmar–English) | `dictionaries/clean_mmd.py` — strips non-Myanmar suffixes from headwords, drops ASCII-only entries, normalises the rest; emits a JSON report of every change |
| Pali (`peu.tsv`) | external |
| Burmese grammar dictionary | hand-built, **published**: `dictionaries/burmese_grammar_dictionary.tsv` |

`dictionaries/burmese_grammar_dictionary.tsv` is the one lexical resource published
here, because it is original work rather than a redistribution. It is also a feature
source for the sentence CRFs above: the `Stc~`, `V~` and `N~` classes are what those
models key on.

Supporting analyses, all published: `ambiguous_pos_words_coverage.tsv` (which word
forms carry more than one POS and how often), `shared_tokens_below_0_8*.tsv` and
`top1000_shared_pos_similarity.tsv` (POS-distribution similarity between shared tokens
across corpora), `mypos-ver.3.0.unigram_ud.tsv`, `udtree_mark_tokens.tsv`,
`chronicle-unknown-words.json`.
