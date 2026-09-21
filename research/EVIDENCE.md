# Research evidence index

This index separates source/configuration evidence from measured model quality.
Private weights, corpora and original model hashes are excluded. Current runtime
behavior is described in the [module map](../docs/architecture/modules.md).

| Work | Trainer/configuration | Data, split and seed | Evaluation/artifact evidence |
|---|---|---|---|
| Joint spaCy UD/NER | [joint configuration](pipeline/spacy/deployed_pipeline/joint_ud_morph_parser_ner_filled.cfg) | [DocBin manifest](pipeline/spacy/deployed_pipeline/spacy_docbins_manifest_95_5.json): 4,320 documents, 4,104 train / 216 dev (95/5); config seed 0 | Manifest lacks per-document IDs/hashes; no published weights or independent held-out score |
| Sentence-boundary CRF v6 | [trainer](pipeline/crf/train_sentence_final_particle_crf_pooled_v6_thi_merge.py) | Chronicle/myUDTree/alt pooled 50/25/25 by sequence count; seed 42 default; train/dev paths supplied separately; capped `သည်` merge augmentation | [superseded v3/v4 analysis](experiments/sentence-final-particle-crf/OUTCOME.md); trainer emits dev evaluations and `.meta.pkl`; [independent evaluator](evaluation/eval_model_on_jsonl.py); no numeric F1 reproduced here |
| Dependency post-pass | Builder not included in this publication; report records thresholds and reference-map counts | Rules inferred from reference alignments | [historical report](evaluation/dep_v3.postpass_v1.report.json): 679,592 tokens inspected, 43,570 UPOS and 45,774 dependency-label changes; alignment proxy uses the reference that informed corrections and is not unseen-data accuracy |
| BILU word boundaries | [configuration](pipeline/spacy/bilu/bilu.cfg), [corpus builder](pipeline/corpus/build_tokenizer_bilu_from_mypos_myalt.py) | myPOS/myAlt resources and grapheme labels | Historical research path; current reader starts from Stanza rather than this tagger |
| Lexical search and corpus alignment | [BK-tree checks](../tests/test_lexical_search.py), [conversion checks](../tests/test_corpus_conversion.py) | Public hand-written examples and unique lexical vocabularies | Correctness against brute force, Unicode/POS alignment, sentence-preserving windows and malformed-label rejection; no neural accuracy claim |

The CRF shortcut account explains the motivation for augmentation. Without a
published controlled held-out ablation it does not establish that every shortcut
has disappeared. Keep diagnostic snippets out of training if reporting them as
evaluation, and record whether `--extra_marked_train` overlaps an evaluation file.
Never load untrusted pickle model metadata. See [reproduction commands](REPRODUCIBILITY.md).
