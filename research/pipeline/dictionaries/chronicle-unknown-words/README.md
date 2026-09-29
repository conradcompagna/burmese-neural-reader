# Chronicle unknown words

3,702 words from the Konbaung chronicle text that are not in the reader's dictionaries,
with their frequencies, ordered by frequency. They were produced by
[`build_chronicle_ngrams.py`](../../corpus/build_chronicle_ngrams.py) from the normalized
chronicle text.

The list is stored as shards; [`manifest.json`](manifest.json) records their checksums,
and [`artifacts.py`](../../../artifacts.py) reassembles the original JSON file.
