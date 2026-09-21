# Public checks and external training

From the repository root with Python 3.12:

```sh
python -m pip install -r requirements-dev.txt
python -m pytest tests/test_corpus_conversion.py tests/test_lexical_search.py
python research/pipeline/corpus/make_crf_windows_from_conllu.py --help
python research/pipeline/corpus/make_crf_windows_from_conllu.py --in_conllu /path/to/input.conllu --out_jsonl /path/to/windows.jsonl --source myudtree --max_len 400
```

The hand-written fixture checks Burmese Unicode, UPOS/XPOS, multiword/empty-node
handling, sentence-final labels and repeatability without model assets. Whole
sentences longer than `max_len` remain intact. This validates format and alignment,
not whether a corpus's annotations are linguistically correct.

The [v6 CRF trainer](pipeline/crf/train_sentence_final_particle_crf_pooled_v6_thi_merge.py)
accepts `--chron_train`, `--chron_dev`, `--myud_train`, `--myud_dev`, `--alt_train`,
`--alt_dev`, `--grammar_tsv`, `--out_model`, and `--seed`; provide all dataset paths
explicitly. It also requires `python-crfsuite`. Historical training environments
are incompletely recorded: the application's requirements are not a reproducible
CRF-training lockfile. Record Python/library versions, command, input SHA-256s,
split IDs and output SHA-256 alongside each new model. Do not overwrite historical
metadata to imply that an old run captured information it did not record.

For spaCy, use the published joint config with native path overrides after obtaining
authorized DocBins and the configured initialization resources:

```sh
python -m spacy train research/pipeline/spacy/deployed_pipeline/joint_ud_morph_parser_ner_filled.cfg --paths.train /path/to/train.spacy --paths.dev /path/to/dev.spacy --output /path/to/run
```

Inspect all `[paths]` and initialization entries first; the historical config retains
original workstation paths as evidence. Use a separate edited copy or CLI overrides
for additional resources. The public 95/5 count manifest does not identify the exact
members of the split. See [EVIDENCE.md](EVIDENCE.md) for seed and scoring limits.

The old `newserver` consumers (`build_chronicle_ngrams.py` and
`retokenize_conll_for_app.py`) are archival and need a deliberate port before use.
Other historical viewers may require external models or old layouts; they are not
part of the dependency-light CI suite. No paid API, model download or training run
is performed by the public fixture checks.
