# Chronicle unknown-word inventory

The original 3,702 word/count records are stored in consecutive frequency-rank
shards, preserving their original insertion order and spelling. The manifest
records each shard's checksum and the original JSON checksum and byte length.

From the repository root:

```sh
python research/artifacts.py research/pipeline/dictionaries/chronicle-unknown-words/manifest.json
python research/artifacts.py research/pipeline/dictionaries/chronicle-unknown-words/manifest.json --output /tmp/chronicle-unknown-words.json
```

The corpus builder still produces the original single-file interchange format
in its output directory. This directory is the published, reviewable inventory;
generated full inventories should stay outside maintained source.
