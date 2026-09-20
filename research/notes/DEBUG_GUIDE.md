# Debug Function Quick Reference

## How to Use the Debug Lookup

The debug function helps you understand **exactly how** the POS scoring works for any word.

## Basic Usage

```python
from phrase_chunker import create_pos_tagger, print_debug_score

# Load the tagger
tagger = create_pos_tagger("mypos-ver.3.0.txt")

# Debug a word
debug = tagger.debug_score_word("က")
print_debug_score(debug)
```

## With Context (Most Useful!)

```python
# See how "က" is scored when it follows a NOUN
debug = tagger.debug_score_word("က", prev_pos="n")
print_debug_score(debug)

# See how "က" is scored when it follows a VERB
debug = tagger.debug_score_word("က", prev_pos="v")
print_debug_score(debug)

# Compare different contexts
for pos in ['n', 'v', 'pron', 'adj']:
    debug = tagger.debug_score_word("မှာ", prev_pos=pos)
    winner = debug['final_scores']['winner']
    prob = debug['final_scores']['probabilities'][winner]
    print(f"After {pos}: {winner} ({prob:.1%})")
```

## Command Line

```bash
# Debug without context
python phrase_chunker.py --debug က

# Debug with POS context
python phrase_chunker.py --debug က n
python phrase_chunker.py --debug မှာ v
python phrase_chunker.py --debug တယ် part
```

## Understanding the Output

### 1. Unigram Scores
**Question:** "What POS is this word, regardless of context?"

```
📊 UNIGRAM P(pos | word='က'):
   Total corpus occurrences: 13234
   ppm    0.9898 (13098) ████████████████████████████████████████
   part   0.0048 (   63)
```

- Shows how often each POS appears for this word in the entire corpus
- `0.9898` means 98.98% of the time "က" is tagged as `ppm` (postposition)
- `(13098)` is the raw count: appeared 13,098 times as postposition

### 2. POS-Bigram Scores
**Question:** "When this word follows a [NOUN/VERB/etc], what POS is it?"

```
📊 POS-BIGRAM P(pos | prev_pos=n, word='က'):
   Question: When 'က' follows a N, what POS is it?
   Total bigram occurrences: 5847
   ppm    0.9945 ( 5815) ████████████████████████████████████████
   part   0.0041 (   24)
```

- Shows how often each POS appears when word follows a specific POS
- `0.9945` means 99.45% of the time "က" is `ppm` when it follows a NOUN
- This is HIGHER than the unigram (98.98%), meaning context makes us more confident

### 3. Final Scores
**Formula:** 50% unigram + 50% POS-bigram

```
🎯 FINAL SCORES:
   Formula: 50% unigram + 50% POS-bigram
   ppm    0.9921 ████████████████████████████████████████ ← WINNER
   part   0.0044
```

- Combines both sources of information
- The WINNER is the POS tag with highest combined score
- `0.9921 = 0.5 × 0.9898 + 0.5 × 0.9945`

## Practical Examples

### Example 1: Finding context-dependent words

```python
# Find words whose POS changes based on context
word = "က"

contexts = {}
for pos in ['n', 'v', 'pron', 'adj', 'part']:
    debug = tagger.debug_score_word(word, prev_pos=pos)
    if debug.get('final_scores'):
        winner = debug['final_scores']['winner']
        contexts[pos] = winner

print(f"'{word}' POS varies by context:")
for prev, current in contexts.items():
    print(f"  After {prev}: {current}")
```

### Example 2: Checking your tagging hypothesis

```python
# "I think 'မှာ' after verbs should be different than after nouns"

# After noun
debug_n = tagger.debug_score_word("မှာ", prev_pos="n")
print(f"After NOUN: {debug_n['final_scores']['winner']}")

# After verb
debug_v = tagger.debug_score_word("မှာ", prev_pos="v")
print(f"After VERB: {debug_v['final_scores']['winner']}")

# Compare probabilities
print("\nDetailed comparison:")
for pos in debug_n['candidates']:
    prob_n = debug_n['final_scores']['probabilities'].get(pos, 0)
    prob_v = debug_v['final_scores']['probabilities'].get(pos, 0)
    diff = prob_v - prob_n
    print(f"  {pos}: noun={prob_n:.3f}, verb={prob_v:.3f}, diff={diff:+.3f}")
```

### Example 3: Investigating scoring for a sentence

```python
sentence = "သူ က စား နေ တယ်".split()

print("Sentence analysis:")
prev_pos = None
for word in sentence:
    debug = tagger.debug_score_word(word, prev_pos=prev_pos)

    if debug.get('final_scores'):
        winner = debug['final_scores']['winner']
        prob = debug['final_scores']['probabilities'][winner]

        print(f"\n{word}")
        print(f"  Previous POS: {prev_pos or '(start)'}")
        print(f"  Best POS: {winner} ({prob:.1%})")

        # Show how context helped (if applicable)
        if prev_pos and debug.get('pos_bigram'):
            uni = debug['unigram']['probabilities'].get(winner, 0)
            bi = debug['pos_bigram']['probabilities'].get(winner, 0)
            if abs(bi - uni) > 0.05:  # Significant difference
                print(f"  Context effect: unigram={uni:.1%}, bigram={bi:.1%}")

        prev_pos = winner
```

## What to Look For

### 🔍 Strong POS-bigram effect
When POS-bigram probability is very different from unigram:
- **High bigram, lower unigram**: Context makes us MORE confident
- **Low bigram, higher unigram**: Context suggests DIFFERENT POS than usual

### 🔍 Context-dependent words
Words where the winner changes based on `prev_pos`:
- These are the words that benefit most from POS-bigram scoring
- Common in Burmese: particles, postpositions, auxiliary verbs

### 🔍 Data sparsity
When bigram count is very low (< 10):
- Less reliable, more weight goes to unigram
- Might need more training data for this pattern

## Tips

1. **Always specify `prev_pos`** when debugging - that's where POS-bigram scoring shines

2. **Compare multiple contexts** for the same word to see how context matters

3. **Check raw counts** to understand if the probabilities are based on enough data

4. **Use programmatically** to analyze patterns across many words:
   ```python
   # Find all highly context-dependent postpositions
   for word in common_postpositions:
       variance = analyze_context_variance(word)
       if variance > 0.1:
           print(f"{word} is highly context-dependent")
   ```

## Common POS Tags to Use

When specifying `prev_pos`, use these myPOS tags:

- `n` - Noun
- `v` - Verb
- `adj` - Adjective
- `adv` - Adverb
- `pron` - Pronoun
- `ppm` - Postpositional marker
- `part` - Particle
- `conj` - Conjunction
- `num` - Number
- `tn` - Classifier (textual noun)

See full list in `phrase_chunker.py` under `MYPOS_TAGS`.
