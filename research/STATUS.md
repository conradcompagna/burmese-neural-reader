# Selected reader resources and development record

The reader's final word boundaries come from dictionary-aware DP with unigram and
bigram scoring. Stanza supplies an NER pre-pass and preliminary spans; contiguous
regions are resegmented, unknowns merged and entities remapped before grammatical
analysis. See the [construction guide](../docs/BUILD_PROCESS.md) and
[runtime sequence](../docs/BUILD_PROCESS.md#runtime-architecture).

## Selected resources

| Artifact | Runtime role | Build / identity record |
|---|---|---|
| `model-best` | spaCy tok2vec, morphologizer and dependency parser | [Selected no-NER configuration](pipeline/spacy/deployed_pipeline/joint_ud_morph_parser_no_ner.cfg), [split counts](pipeline/spacy/deployed_pipeline/spacy_docbins_manifest_95_5.json), [checkpoint hashes and saved scores](pipeline/spacy/deployed_pipeline/selected_checkpoint.json). |
| Stanza UCSY NER | Entities from the preliminary raw-text pass; ALT tokenization is internal to that pass | UCSY pretrained vectors plus OSCAR forward/backward character models; five model hashes verified against the resource manifest. |
| myWord unigram and bigram tables | Statistical evidence for the custom segmenter | `myWord-main/unigram-word.txt` and `bigram-word.txt`, fingerprinted in the artifact record. |
| Wiktionary dictionary | Definitions and lexical candidates | [Kaikki converter](pipeline/dictionaries/kaikki_to_tsv.py). |
| MMD dictionary | Burmese lexical layer | [MMD cleanup](pipeline/dictionaries/clean_mmd.py). |
| Pali dictionary | Additional lexical layer | Separately provisioned `peu.tsv`. |
| Grammar lexicon | Function-word grammar and linguistic features | Hand-built `burmese_grammar_dictionary.tsv`, used by the reader and research trainers. |

The checkpoint was verified against production on 23 September 2026: all 14
locally retained model files match, including trained component weights,
configuration and evaluation metadata. The deployed vector matrix is also
fingerprinted. Saved development scores are **96.92% POS accuracy, 92.39% UAS,
89.41% LAS and 93.01% sentence F1**; the retained split is 4,104 train / 216 dev
documents. [Evaluation context](EVIDENCE.md) keeps these scores connected to that split.

## Other development paths

The BILU grapheme tagger, standalone spaCy NER, NER-inclusive joint configuration
and chronicle n-gram builder document separate experiments. The selected spaCy
checkpoint has no NER component, and the standalone spaCy NER and Stanza
tokenizer-only initializers are disabled. The combined Stanza NER pre-pass remains
part of the default lookup, followed by the custom dictionary/LM segmentation.

## Sentence-boundary CRFs

The published trainer sequence is in [`pipeline/crf/`](pipeline/crf/);
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

## Lexical and model evidence

The [BK-tree implementation guide](notes/BK_TREE_IMPLEMENTATION.md) explains
edit-distance retrieval and contextual ranking. The [evaluation index](evaluation/README.md)
connects the scoring tools and annotation viewers to the model-development work;
the [evidence index](EVIDENCE.md) identifies the selected parser's saved results.
