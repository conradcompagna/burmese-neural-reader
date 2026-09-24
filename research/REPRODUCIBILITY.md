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
sentences longer than `max_len` remain intact. These checks cover format and
alignment; the annotation viewers support a separate linguistic review.

The [v6 CRF trainer](pipeline/crf/train_sentence_final_particle_crf_pooled_v6_thi_merge.py)
accepts `--chron_train`, `--chron_dev`, `--myud_train`, `--myud_dev`, `--alt_train`,
`--alt_dev`, `--grammar_tsv`, `--out_model`, and `--seed`; provide all dataset paths
explicitly. It also requires `python-crfsuite`. For a new CRF run, record
Python/library versions, the command, input SHA-256s, split IDs, and output SHA-256
alongside the model. This captures the training environment separately from the
application requirements and complements the original historical metadata.

For spaCy, use the selected POS/dependency config with native path overrides after obtaining
authorized DocBins and the configured initialization resources:

```sh
python -m spacy train research/pipeline/spacy/deployed_pipeline/joint_ud_morph_parser_no_ner.cfg --paths.train /path/to/train_95.spacy --paths.dev /path/to/dev_5.spacy --paths.vectors /path/to/vector-model --output /path/to/run
```

Inspect all `[paths]` and initialization entries first; the historical config retains
original workstation paths as evidence. Use a separate edited copy or CLI overrides
for additional resources. The [selected artifact record](pipeline/spacy/deployed_pipeline/selected_checkpoint.json)
records retained DocBin hashes alongside split counts, model identities and saved scores. See the [evidence index](EVIDENCE.md) for corpus, seed, and evaluation context.

The old `newserver` consumers (`build_chronicle_ngrams.py` and
`retokenize_conll_for_app.py`) are archival and need a deliberate port before use.
Other historical viewers may require external models or old layouts; they are not
part of the dependency-light CI suite. No paid API, model download or training run
is performed by the public fixture checks.
