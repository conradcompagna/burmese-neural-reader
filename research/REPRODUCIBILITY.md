# Parser training and sequence-modeling record

The selected reader combines a trained spaCy POS/dependency parser with custom
lexical segmentation and separately integrated Stanza NER. The preparation and
training records explain how those responsibilities were developed.

## Selected parser

The [selected configuration](pipeline/spacy/deployed_pipeline/joint_ud_morph_parser_no_ner.cfg)
trains tok2vec, morphologizer and parser. It records seed 0, dropout 0.1, evaluation
every 1,000 steps and separate training, development and vector-initialization
paths. The [split manifest](pipeline/spacy/deployed_pipeline/spacy_docbins_manifest_95_5.json)
records 4,104 training and 216 development documents.

The [checkpoint record](pipeline/spacy/deployed_pipeline/selected_checkpoint.json)
connects the retained DocBins, selected configuration and deployed model files by
identity. Its saved development evaluation records POS accuracy, UAS, LAS and
sentence-boundary F1; the [evidence index](EVIDENCE.md) gives their context.

## Corpus transformations

[Corpus tools](pipeline/corpus/) cover CoNLL-U/DocBin conversion, token alignment,
root repair and constituency-to-dependency conversion. The streaming preparation
work in [spaCy](pipeline/spacy/) handles larger corpora and records alternative
training and pretraining paths. The selected model map distinguishes these
experiments from the parser used in the application.

The CRF window builder preserves whole sentences and encodes sentence-final labels
alongside Burmese Unicode and POS information. The
[v6 trainer](pipeline/crf/train_sentence_final_particle_crf_pooled_v6_thi_merge.py)
combines chronicle, myUDTree and alt-bank sequences, uses grammar-lexicon features
and applies the recorded final-particle merge augmentation. Its explicit dataset,
seed and output settings define the training procedure.

The [feature-development case study](experiments/sentence-final-particle-crf/OUTCOME.md)
explains the linguistic motivation across trainer generations. The
[held-out evaluator](evaluation/eval_model_on_jsonl.py) and annotation viewers
record the separate evaluation and inspection interfaces for that work.
