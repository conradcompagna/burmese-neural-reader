# What the deployed reader loads

The tables connect the reader's language resources to corpus builders, model
configurations, and evaluation tools. The CRF section records the development of
sentence-boundary feature design.

| Loaded at runtime | Kind | Built by |
|---|---|---|
| `model-best` | spaCy joint UD pipeline: tok2vec, tagger, morphologiser, parser, NER | [`pipeline/spacy/deployed_pipeline/joint_ud_morph_parser_ner_filled.cfg`](pipeline/spacy/deployed_pipeline/joint_ud_morph_parser_ner_filled.cfg) over DocBins from [`pipeline/corpus/`](pipeline/corpus/) |
| BILU boundary tagger | spaCy tagger over grapheme clusters | [`pipeline/spacy/bilu/bilu.cfg`](pipeline/spacy/bilu/) over [`pipeline/corpus/build_tokenizer_bilu_from_mypos_myalt.py`](pipeline/corpus/build_tokenizer_bilu_from_mypos_myalt.py) |
| standalone NER model | spaCy NER | [`pipeline/spacy/deployed_pipeline/nerconfig.cfg`](pipeline/spacy/deployed_pipeline/) over the retokenised myNER 7-tag corpus |
| Stanza NER + tokenizer | Stanza | upstream; harness in [`evaluation/stanza_test.py`](evaluation/stanza_test.py) |
| chronicle n-gram tables | counts | [`pipeline/corpus/build_chronicle_ngrams.py`](pipeline/corpus/build_chronicle_ngrams.py) |
| Burmese–English Wiktionary TSV | dictionary | [`pipeline/dictionaries/kaikki_to_tsv.py`](pipeline/dictionaries/kaikki_to_tsv.py) |
| MMD TSV | dictionary | [`pipeline/dictionaries/clean_mmd.py`](pipeline/dictionaries/clean_mmd.py) |
| grammar TSV | hand-built | grammatical classes used by the [CRF trainers](pipeline/crf/); provisioned with the reader resources |
| myPOS corpus | third-party | not redistributed |

## Sentence-boundary CRFs

Four generations exist. The published trainers are in [`pipeline/crf/`](pipeline/crf/);
two superseded generations are in
[`experiments/sentence-final-particle-crf/`](experiments/sentence-final-particle-crf/).

| Trainer | Development role | Design contribution |
|---|---|---|
| `train_sentence_boundary_crf.py` | Superseded | baseline; no cue features |
| `train_chronicle_sentence_crf.py` | Maintained | chronicle-only; still the clearest statement of the feature design |
| `train_sentence_crf_pooled_strip_punct.py` | Maintained | adds the pooled training mix |
| `..._final_particle_crf_pooled_v3.py` | Superseded | identified a positional cue in standalone sentence-final `သည်` |
| `..._final_particle_crf_pooled_v4_thi.py` | Superseded | adds features for the standalone `သည်` case |
| `..._final_particle_crf_pooled_v6_thi_merge.py` | **Current** | normalizes final standalone `သည်` with the preceding token to address the positional cue |
| `train_ocr_structure_boundary_crf.py` | Maintained | separate problem: page structure, non-lexical features |

## Tests

[`evaluation/tests/`](evaluation/tests/) holds the BK-tree fuzzy-search tests
(`test_bktree.py`, `test_lmbrain_bktree.py`) and a POS smoke test. The BK-tree tests
cover the edit-distance search that the root README names as an engineering highlight.

The published tests focus on retained interfaces; development checks for the retired
`newserver` and `segmenter` modules remain outside this release.
