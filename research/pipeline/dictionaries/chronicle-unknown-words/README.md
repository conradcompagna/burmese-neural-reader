# Chronicle unknown-word inventory

The chronicle n-gram build produced an inventory of 3,702 word/count records.
Frequency-ranked shards preserve the original ordering and spelling, making the
lexical material inspectable alongside its construction code.

The [manifest](manifest.json) records each shard's checksum and the original JSON
checksum and byte length. The [artifact utility](../../../artifacts.py) verifies
the shards and can reconstruct the original interchange format; the
[corpus builder](../../corpus/build_chronicle_ngrams.py) records how the inventory
was produced from normalized chronicle text.
