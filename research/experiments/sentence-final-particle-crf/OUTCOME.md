# Sentence-boundary CRFs: designing for running Burmese text

## Linguistic problem

Chronicle prose often lacks the punctuation used by modern sentence tokenizers.
Burmese grammatical particles can signal sentence endings, but the same forms also
occur inside sentences. The training design therefore needs to represent both the
particle and its surrounding context.

## From cue features to token normalization

The v3 trainer pooled chronicle, myUDTree, and alt-bank data, removed punctuation,
and drew final-particle features from the grammar dictionary. Reviewing the sequence
construction identified a positional cue: standalone final `သည်` was associated
with the end of a training sequence, while inference uses windows of running text.

The v4 trainer added features for this particle. The retained v6 trainer goes further:
it merges a standalone sentence-final `သည်` with the preceding token
(`X` + `သည်` → `Xသည်`) inside multi-sentence training sequences. This normalizes
the attached and standalone surface forms and directly addresses the identified cue
in the training representation.

The trainer also selects chronicle sentences using an allowed final-token inventory
drawn from the grammar dictionary and a supplementary list, helping keep OCR line
endings separate from sentence-boundary supervision.

## Inspect the implementation

- `train_sentence_final_particle_crf_pooled_v3.py`: pooled data and cue features.
- `train_sentence_final_particle_crf_pooled_v4_thi.py`: particle-specific features.
- [v6 trainer](../../pipeline/crf/train_sentence_final_particle_crf_pooled_v6_thi_merge.py):
  token normalization and multi-sentence training construction.
- [Evaluation tools](../../evaluation/README.md): held-out sequence scoring,
  segmentation comparisons, and boundary viewers.

This case study documents the feature-design and corpus-construction changes. The
published record does not include a controlled held-out comparison quantifying the
accuracy difference between these generations.
