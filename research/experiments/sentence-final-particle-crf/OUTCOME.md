# Sentence-final particle CRF, v3 and v4 — superseded

## The problem

Chronicle Burmese has no sentence-final punctuation. A sentence ends with a grammatical
particle, and the same particle can appear mid-sentence. So the boundary decision has
to be made from the particle plus its context.

## v3

`train_sentence_final_particle_crf_pooled_v3.py`. Pooled training across chronicle,
myUDTree and alt-bank data, punctuation dropped, sentence-final cue features drawn from
the grammar dictionary.

It scored well and behaved badly. The particle `သည်` occurs both suffixed to the
preceding word and standing alone as a separate token. In the training data, a
standalone sentence-final `သည်` is by construction the last token of its sequence. The
CRF learned "standalone `သည်` at end-of-sequence implies boundary" — a shortcut that is
perfectly predictive in training and useless at inference, where sequences are
arbitrary windows of running text.

This is the same class of error as a model learning that a full stop means a sentence
break: it is true, it is learnable, and it does not survive contact with text that
lacks the cue. Stripping punctuation, which the earlier generations already did, was
the fix for the obvious version of the problem. This was the non-obvious version.

## v4

`train_sentence_final_particle_crf_pooled_v4_thi.py`. Targeted the `သည်` case directly
(`thi` is the romanisation) with additional features. It reduced the effect without
removing the underlying asymmetry: standalone final `သည်` was still positionally
special in the training data.

## v6 — what shipped

`../../pipeline/crf/train_sentence_final_particle_crf_pooled_v6_thi_merge.py` fuses a
sentence-final standalone `သည်` into the preceding token (`X` + `သည်` → `Xသည်`) inside
multi-sentence training sequences. The two surface realisations become one, the
positional shortcut disappears, and the model has to use the grammatical context.

It also filters chronicle sentences to those ending in an allowed final token, taken
from the grammar TSV plus a short additional list, so that OCR noise at a line end is
not treated as a sentence ender.

v5 was not kept.
