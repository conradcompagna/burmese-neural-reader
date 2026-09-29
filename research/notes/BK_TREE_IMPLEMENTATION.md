# BK-tree fuzzy dictionary search

The reader needs spelling candidates that exist in its Burmese dictionary, with
contextual ranking applied after candidate retrieval. In
[`lmbrain.py`](../../lmbrain.py), `AdvancedSegmenter._build_spell_vocab()` builds a
BK-tree from nonempty Myanmar-script dictionary keys; `suggest_spellings()` then
uses that index to find nearby forms before scoring them with language-model
context.

## Candidate retrieval and ranking

`BKTree` indexes words by Levenshtein distance. For a query at distance `d` from a
node and an allowed radius `r`, only child edges in `[d - r, d + r]` need searching.
The triangle inequality makes this pruning exact: it can skip branches without
discarding candidates inside the requested radius.

The spelling pipeline filters the returned candidates by edit similarity, caches
that morphology-dependent shortlist, and applies contextual ranking afterwards.
Changing the radius does not require rebuilding the tree. Duplicate words do not
create duplicate nodes, and empty dictionary headwords are ignored. If the tree
is unavailable, the maintained spelling path returns no candidates.

Index construction has a startup and memory cost; query work depends on the
vocabulary, insertion order, and search radius. The index provides a way to prune
distance calculations, without a fixed speedup or logarithmic-query guarantee.

## Demonstrated behavior

The [lexical regression suite](../../tests/test_lexical_search.py) compares BK-tree
results with exhaustive edit-distance search over a seeded vocabulary of distinct
Burmese strings and multiple queries at radii 0, 1, and 2. It also checks duplicate
insertion, empty inputs, exact matches, dictionary-backed spelling suggestions,
and repeated cached lookups. These examples run without private models or corpora.

From the repository root, after installing the
[development dependencies](../../requirements-dev.txt):

```sh
python -m pytest tests/test_lexical_search.py -q
```

For the larger reader flow, continue with the
[runtime module map](../../docs/architecture/modules.md).
