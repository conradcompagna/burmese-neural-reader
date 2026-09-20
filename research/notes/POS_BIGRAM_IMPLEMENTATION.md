# POS-Based Bigram Scoring Implementation

## Summary

Successfully implemented POS-based bigram scoring to replace word-word bigram scoring in the phrase chunker. The new system learns patterns like "when word X follows a NOUN/VERB/etc, what POS is it usually?" instead of "when word X follows specific word Y, what POS is it?"

## Key Changes

### 1. Data Structure (`MyPOSStats` class)

**REPLACED:**
```python
# Old: word-word bigrams
self.bigram_counts: Dict[Tuple[str, str], Dict[str, int]]
# Example: ("မြို့", "မှာ") → {ppm: 150, part: 5}
```

**WITH:**
```python
# New: POS-word bigrams
self.pos_word_bigram_counts: Dict[Tuple[str, str], Dict[str, int]]
# Example: ("n", "မှာ") → {ppm: 8542, part: 124}
```

### 2. Statistics Collection (`load_corpus()`)

Now tracks the POS of the previous word instead of the word itself:

```python
for word, pos_set in tokens:
    for pos in pos_set:
        # Collect unigram statistics (unchanged)
        self.unigram_counts[word][pos] += 1

        # NEW: Collect POS-word bigram statistics
        if prev_pos:
            self.pos_word_bigram_counts[(prev_pos, word)][pos] += 1

    # Track prev_pos for next iteration
    if pos_set:
        prev_pos = max(pos_set, key=lambda p: self.unigram_counts[word].get(p, 0))
```

### 3. Probability Lookup (`get_pos_word_bigram_probs()`)

New method that answers: **"When this word follows a NOUN/VERB/etc, what POS is it usually?"**

```python
def get_pos_word_bigram_probs(self, prev_pos: str, word: str) -> Dict[str, float]:
    """
    Returns P(pos | prev_pos, word)

    Example:
        get_pos_word_bigram_probs("n", "က")
        → {ppm: 0.9945, part: 0.0041, n: 0.0007, ...}

        Meaning: When "က" follows a NOUN, it's a postposition 99.45% of the time
    """
```

### 4. Scoring Function (`_compute_pos_probs()`)

**Scoring Formula:** 50% unigram + 50% POS-bigram

```python
for pos in candidates:
    uni = unigram_probs.get(pos, 0.0)      # P(pos | word)
    pos_bi = pos_bigram_probs.get(pos, 0.0)  # P(pos | prev_pos, word)
    result[pos] = 0.5 * uni + 0.5 * pos_bi
```

### 5. Tagging Loop (`tag_tokens()`)

Now tracks `prev_pos` instead of `prev_word`:

```python
prev_pos = None
for token in tokens:
    # ... get candidates ...

    if ambiguous:
        pos_probs = self._compute_pos_probs(word, prev_pos, candidates)
        best_pos = max(pos_probs.keys(), key=lambda p: pos_probs[p])

    # Update prev_pos for next iteration
    prev_pos = tagged.get('pos')
```

## Statistics from Corpus

After loading `mypos-ver.3.0.txt`:
- **33,503** unique words
- **55,097** POS-word bigram patterns (vs ~millions of possible word-word bigrams)
- **536,604** total tokens

## Usage Examples

### Basic Usage (Same API)

```python
from phrase_chunker import create_pos_tagger

# Create tagger
tagger = create_pos_tagger("mypos-ver.3.0.txt")

# Tag tokens (same as before, but now uses POS-bigram scoring internally)
tokens = [
    {'word': 'သူ', 'pos': 'pron'},
    {'word': 'က', 'pos': 'ppm|part'},  # Ambiguous!
    {'word': 'စား', 'pos': 'v|n'},
]

tagged = tagger.tag_tokens(tokens)
```

### Debug Word Scoring

**NEW:** Inspect how scoring works for a specific word:

```python
# Debug a word without context
debug = tagger.debug_score_word("က")
print(debug)

# Debug a word with POS context
debug = tagger.debug_score_word("က", prev_pos="n")
print(debug)

# Pretty-print debug output
from phrase_chunker import print_debug_score
print_debug_score(debug)
```

**Output:**
```
============================================================
DEBUG SCORING: 'က'
Previous POS: N (Noun)
============================================================

📊 UNIGRAM P(pos | word='က'):
   Total corpus occurrences: 13234
   ppm    0.9898 (13098) ████████████████████████████████████████
   part   0.0048 (   63)
   v      0.0026 (   35)
   n      0.0024 (   32)

📊 POS-BIGRAM P(pos | prev_pos=n, word='က'):
   Question: When 'က' follows a N, what POS is it?
   Total bigram occurrences: 5847
   ppm    0.9945 ( 5815) ████████████████████████████████████████
   part   0.0041 (   24)
   n      0.0007 (    4)

🎯 FINAL SCORES:
   Formula: 50% unigram + 50% POS-bigram
   ppm    0.9921 ████████████████████████████████████████ ← WINNER
   part   0.0044
   v      0.0016
   n      0.0016
```

### Command-Line Testing

```bash
# Run general tests
python phrase_chunker.py

# Debug specific word
python phrase_chunker.py --debug က n

# Debug without context
python phrase_chunker.py --debug မှာ
```

## Real Examples from Test

### Example 1: Ambiguous "က" (ka) particle

**Unigram (no context):**
- ppm: 98.98% (usually postposition)
- part: 0.48% (sometimes particle)

**POS-Bigram (context-aware):**
- After **NOUN**: ppm 99.45% ← even more confident!
- After **PRONOUN**: ppm 99.73%
- After **VERB**: ppm 90.91% ← less certain, could be connector
- After **ADJECTIVE**: ppm 98.61%

**Why this matters:** When "က" follows a verb, it's more likely to be a particle/connector than a postposition, even though overall it's usually a postposition.

### Example 2: Sentence Tagging

**Input:** `သူ က စား နေ တယ်` (He is eating)

**Tagged with POS context:**
```
သူ    (start)     → pron  [79.33%]
က     (after pron) → ppm   [99.35%]  ← High confidence: postposition after pronoun
စား   (after ppm)  → v     [98.49%]  ← Verb (not noun)
နေ    (after v)    → part  [92.43%]  ← Progressive aspect particle
တယ်   (after part) → ppm   [99.87%]  ← Sentence-final particle
```

## Benefits

### 1. Generalization
- **Before:** Needed to see every word-word combination in corpus
- **After:** Any word following a known POS gets reasonable prediction

### 2. Data Efficiency
- **Before:** ~millions of possible word-word bigrams (vocab²)
- **After:** ~55,000 POS-word patterns (13 POS × vocab)

### 3. Better Rare Word Handling
- **Before:** Rare word after common word → no bigram data → fall back to unigram
- **After:** Rare word after any POS → POS-bigram provides context

### 4. Linguistically Motivated
- Captures the fact that grammatical function depends on syntactic context (POS of neighbors)
- Particularly important for Burmese postpositions and particles

## Debug Function API

```python
def debug_score_word(word: str, prev_pos: Optional[str] = None,
                     candidates: Optional[Set[str]] = None) -> Dict:
    """
    Returns detailed scoring breakdown with:
    - word: The word being scored
    - prev_pos: Previous word's POS (if provided)
    - candidates: All candidate POS tags
    - unigram: {probabilities, raw_counts, total_count}
    - pos_bigram: {probabilities, raw_counts, total_count, question}
    - final_scores: {probabilities, formula, winner}
    """
```

## Integration

The new implementation is **100% backward compatible**. No changes needed to calling code:

```python
# Old API still works exactly the same
tokens = [{'word': 'သူ', 'pos': 'pron'}, ...]
tagged = tagger.tag_tokens(tokens)

# But internally now uses POS-bigram scoring instead of word-word bigrams
```

## Files Modified

- `phrase_chunker.py` - Main implementation with POS-bigram scoring
- `test_pos_simple.py` - Test script demonstrating functionality

## Testing

Run the included test:
```bash
python test_pos_simple.py
```

This will show:
- Statistics from loaded corpus
- POS-bigram patterns for ambiguous words
- Sentence tagging with context-aware scoring
- Debug breakdown showing how scores are computed
