# Research evidence index

The reader brings linguistic data preparation, sequence modeling, lexical search,
and interactive inspection into one application. This index connects each part to
its implementation and recorded evaluation; the [module map](../docs/architecture/modules.md)
shows how the maintained runtime fits together.

| Work | Implementation | Data and configuration | Recorded evidence |
|---|---|---|---|
| Selected spaCy POS/dependency parser | [Selected configuration](pipeline/spacy/deployed_pipeline/joint_ud_morph_parser_no_ner.cfg) | [DocBin manifest](pipeline/spacy/deployed_pipeline/spacy_docbins_manifest_95_5.json): 4,104 train / 216 dev; seed 0 | [Verified checkpoint record](pipeline/spacy/deployed_pipeline/selected_checkpoint.json): POS 96.92%, UAS 92.39%, LAS 89.41%, sentence F1 93.01%, from saved development evaluation. |
| Sentence-boundary CRF v6 | [Trainer](pipeline/crf/train_sentence_final_particle_crf_pooled_v6_thi_merge.py) | Chronicle/myUDTree/alt pooled 50/25/25 by sequence count; seed 42 default; explicit train/dev paths and capped `သည်` merge augmentation | [Feature-design case study](experiments/sentence-final-particle-crf/OUTCOME.md); trainer-generated dev evaluations and metadata; [held-out evaluator](evaluation/eval_model_on_jsonl.py) |
| Dependency post-pass | Reference-alignment correction workflow; report retains thresholds and reference-map counts | Rules inferred from reference alignments | [Run report](evaluation/dep_v3.postpass_v1.report.json): 679,592 tokens inspected, 43,570 UPOS and 45,774 dependency-label changes |
| BILU word boundaries | [Configuration](pipeline/spacy/bilu/bilu.cfg) and [corpus builder](pipeline/corpus/build_tokenizer_bilu_from_mypos_myalt.py) | Grapheme-level labels from myPOS/myAlt resources | Earlier segmentation research, alongside the selected dictionary/LM DP segmentation path |

## Interpreting the record

The selected checkpoint record brings together deployed-file hashes, retained
DocBin file hashes and saved development scores. The historical checkpoint names
its split files; the retained split manifest supplies their separate identity record.
The four scores above describe the selected parser's development evaluation.

The CRF case study records the linguistic motivation, corpus construction and
implementation of the feature changes. The post-pass report records alignment with
the reference used to construct its corrections; its counts describe that correction
workflow rather than accuracy on unseen data.

The [training record](REPRODUCIBILITY.md) connects the selected parser configuration,
sequence-modeling experiments and evaluation methods.
