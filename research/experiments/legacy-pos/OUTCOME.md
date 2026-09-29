# Historical POS-bigram inspection

`inspect_pos_bigrams.py` is a historical diagnostic for the retired `phrase_chunker`
module and private myPOS corpus; it is not a runnable test of the current reader.
The runtime disables that tagger, so restoring a placeholder would misrepresent
coverage; maintained lexical regressions live in `tests/`.
