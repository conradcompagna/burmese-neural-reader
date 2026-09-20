# BK-Tree Implementation for Efficient Fuzzy Matching

## Overview

The lmbrain.py fuzzy matching system has been upgraded from brute-force Levenshtein distance scanning to use a **BK-tree** (Burkhard-Keller tree), which dramatically reduces the number of distance calculations needed per query.

## What Changed

### 1. Added BK-Tree Implementation (lmbrain.py:77-181)

Two new classes were added:
- `BKNode`: Represents a node in the BK-tree
- `BKTree`: The main BK-tree data structure with efficient query capabilities

The BK-tree uses the **triangle inequality property** of edit distance to prune the search space:
- If `d(query, node) = d`, then any child at distance `k` can only contain terms within distance of the query in range `[d - max_dist, d + max_dist]`
- This allows the tree to skip entire branches that cannot possibly contain matches

### 2. Automatic BK-Tree Building (lmbrain.py:888-890)

The BK-tree is automatically built during `AdvancedSegmenter` initialization in the `_build_spell_vocab()` method:

```python
# Build BK-tree for efficient fuzzy matching
self._bk_tree = BKTree(levenshtein_distance)
self._bk_tree.build(self.spell_list)
```

This happens once at startup, so there's no runtime overhead.

### 3. Updated All Fuzzy Matching Methods

Three methods were updated to use BK-tree queries:

1. **`suggest_spellings()`** (lines 1133-1184)
   - Primary spell-checking method
   - Stage 1 now uses BK-tree query instead of full vocabulary scan
   - Stage 2 (LM reranking) remains unchanged

2. **`suggest_spellings_distance_first()`** (lines 1313-1337)
   - Distance-first matching with unigram LM tie-breaker
   - Uses BK-tree for candidate collection

3. **`suggest_spellings_with_bigram()`** (lines 1412-1443)
   - Bigram-aware fuzzy matching
   - Uses BK-tree for efficient candidate grouping by distance

All methods include a **fallback** to the old brute-force approach if the BK-tree is not available (for safety).

## Performance Improvements

### Before (Brute-Force)
- **Complexity**: O(N × M) per query
  - N = vocabulary size (tens of thousands of words)
  - M = average word length
- Every query scans the entire vocabulary

### After (BK-Tree)
- **Complexity**: O(log N × M) per query (average case)
- **Build time**: O(N² × M) one-time cost at startup
- Queries skip ~90-99% of vocabulary depending on max_edit_distance

### Test Results
From [test_bktree.py](../evaluation/tests/test_bktree.py):
- ✓ Correctness: BK-tree returns identical results to brute-force
- ✓ Performance: Massive speedup (>1000x on small vocabulary)
- Speedup increases with vocabulary size

## Usage

### No Changes Required!

The BK-tree is a **drop-in replacement** for the old brute-force implementation:
- Same API
- Same results (identical candidates, same ranking)
- Same configuration parameters
- Automatically enabled when `AdvancedSegmenter` is initialized

### Dynamic max_edit_distance

The `max_edit_distance` parameter can be adjusted per query without rebuilding:

```python
# Base config value
suggestions = segmenter.suggest_spellings(
    word="မန်မာ",
    max_edit_distance=3  # or any value
)

# UI can add extra distance dynamically
ui_extra = 2  # from slider
suggestions = segmenter.suggest_spellings(
    word="မန်မာ",
    max_edit_distance=base_distance + ui_extra
)
```

No rebuild needed - the BK-tree supports arbitrary max_dist values at query time.

## Technical Details

### Triangle Inequality

The BK-tree exploits this property of Levenshtein distance:

```
|d(a,b) - d(b,c)| ≤ d(a,c) ≤ d(a,b) + d(b,c)
```

This means if:
- We're at node `n` with term `t_n`
- Query term is `q` with `d(q, t_n) = d`
- We want matches within `max_dist`

Then we only need to explore children at edge distances in range `[d - max_dist, d + max_dist]`.

### Memory Overhead

- Each node stores: `term` (string) + `children` (dict of int → BKNode)
- Total overhead: ~O(N) nodes with O(N) edges
- Negligible compared to vocabulary storage

### Build Time

- One-time cost during initialization
- Takes a few seconds for vocabularies of 10K-100K words
- Happens once at server startup, so not a concern

## Future Enhancements

Possible improvements (not implemented yet):

1. **Incremental Updates**: Add new words to BK-tree without full rebuild
2. **Serialization**: Save/load BK-tree to disk to skip build on restart
3. **Configurable Distance Function**: Support other metrics (Damerau-Levenshtein, etc.)
4. **Multi-threaded Building**: Parallelize tree construction for huge vocabularies

## Validation

Run the test suite to verify correctness and performance:

```bash
python test_bktree.py
```

Expected output:
- ✓ All correctness tests passed (BK-tree matches brute-force exactly)
- ✓ Performance tests show significant speedup

## References

- Burkhard, W. A.; Keller, R. M. (1973). "Some approaches to best-match file searching"
- BK-trees are also used in spell checkers, DNA sequence matching, and duplicate detection
