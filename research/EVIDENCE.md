# Research evidence index

The reader brings linguistic data preparation, sequence modeling, lexical search,
and interactive inspection into one application. This index connects each part to
its implementation and recorded evaluation; the [module map](../docs/architecture/modules.md)
shows how the maintained runtime fits together.

| Work | Implementation | Data and configuration | Recorded evidence |
|---|---|---|---|
| Joint spaCy UD/NER | [Joint configuration](pipeline/spacy/deployed_pipeline/joint_ud_morph_parser_ner_filled.cfg) | [DocBin manifest](pipeline/spacy/deployed_pipeline/spacy_docbins_manifest_95_5.json): 4,320 documents, 4,104 train / 216 dev; configuration seed 0 | Corpus proportions and complete model configuration |
| Sentence-boundary CRF v6 | [Trainer](pipeline/crf/train_sentence_final_particle_crf_pooled_v6_thi_merge.py) | Chronicle/myUDTree/alt pooled 50/25/25 by sequence count; seed 42 default; explicit train/dev paths and capped `သည်` merge augmentation | [Feature-design case study](experiments/sentence-final-particle-crf/OUTCOME.md); trainer-generated dev evaluations and metadata; [held-out evaluator](evaluation/eval_model_on_jsonl.py) |
| Dependency post-pass | Reference-alignment correction workflow; report retains thresholds and reference-map counts | Rules inferred from reference alignments | [Run report](evaluation/dep_v3.postpass_v1.report.json): 679,592 tokens inspected, 43,570 UPOS and 45,774 dependency-label changes |
| BILU word boundaries | [Configuration](pipeline/spacy/bilu/bilu.cfg) and [corpus builder](pipeline/corpus/build_tokenizer_bilu_from_mypos_myalt.py) | Grapheme-level labels from myPOS/myAlt resources | Earlier segmentation research, alongside the maintained Stanza-based lookup path |
| Lexical search and corpus alignment | [BK-tree checks](../tests/test_lexical_search.py) and [conversion checks](../tests/test_corpus_conversion.py) | Public examples and unique lexical vocabularies | Brute-force search agreement, Unicode/POS alignment, sentence-preserving windows, and malformed-label rejection |

## Interpreting the record

The spaCy manifest records corpus sizes and the 95/5 split, while weights, exact
split-member IDs/hashes, and independent held-out scores remain separate resources.
The CRF case study documents the motivation and implementation of the feature
changes; a controlled held-out comparison is the next step for quantifying their
effect. The published post-pass report measures agreement with the same reference
that informed its corrections, rather than unseen-data parser accuracy; its builder
is outside this source release.

For new CRF experiments, keep evaluation examples separate from training and record
any overlap introduced through `--extra_marked_train`. The [reproduction guide](REPRODUCIBILITY.md)
provides the relevant commands and run-record fields.
