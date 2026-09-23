# Repository contents

## Included

**Runtime.** The Flask application, language modules, reader interface and deployment
entry point. This is everything at the repository root.
[`docs/architecture/modules.md`](architecture/modules.md) maps the sections inside
`app.py`.

**Build infrastructure.** Under [`research/`](../research/): corpus construction, CRF
and spaCy training configurations, dictionary builders, evaluation harnesses,
annotation viewers, standalone algorithm components, and the development of
language-specific model features.

## Separately provisioned resources

| Excluded | Reason |
|---|---|
| Model weights (`model-best`, the BILU tagger, NER, CRF `.crfsuite` files) | Large binaries derived from third-party corpora. The configurations and trainers that produce them are published. |
| Dictionary TSVs (Wiktionary, MMD, Pali) and the myPOS corpus | Third-party lexical resources under their own terms. The converters and cleaners are published, and the original grammar dictionary supplies language-specific CRF features. |
| Training corpora (Burmese UD treebank, myNER 7-tag, myUDTree, alt bank, chronicle text, Judson) | Third-party datasets. Scripts name their inputs. |
| Chronicle n-gram tables | Derived from the chronicle text; the builder is published. |
| `reading_srs_state.json` | Personal review history. |
| Versioned development copies | The workspace holds 130+ dated copies of the server and 34 of `reader.js`. One current version of each is published. |
| Vendored Stanza source | Upstream; install from its own distribution. |

The hand-built `burmese_grammar_dictionary.tsv` supplies the `Stc~`, `V~`, and `N~`
grammatical classes used by the sentence-boundary CRFs. The published trainers show
how these classes become model features; the lexicon is provisioned with the reader's
other language resources.

Live environment files, credentials, logs, caches and backups are excluded.
Configuration examples require your own settings. Third-party notices are preserved in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
