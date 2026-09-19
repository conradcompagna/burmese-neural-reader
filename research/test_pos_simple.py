"""
Simple test for POS-bigram implementation - avoiding encoding issues.
"""

from phrase_chunker import create_pos_tagger
import sys

# Set UTF-8 encoding for output
sys.stdout.reconfigure(encoding='utf-8') if hasattr(sys.stdout, 'reconfigure') else None

# Create tagger
print("Loading corpus...")
tagger = create_pos_tagger("mypos-ver.3.0.txt")

print(f"\nStatistics:")
print(f"  Unique words: {len(tagger.stats.unigram_counts)}")
print(f"  POS-word bigram patterns: {len(tagger.stats.pos_word_bigram_counts)}")
print(f"  Total tokens: {tagger.stats.total_word_count}")

# Test POS-bigram functionality
print("\n" + "="*70)
print("TEST: POS-Bigram scoring for ambiguous word 'ka'")
print("="*70)

word = "က"  # ka - highly ambiguous particle/postposition

print(f"\nWord: {word}")
print("\nUnigram (no context):")
uni_probs = tagger.stats.get_unigram_probs(word)
for pos, prob in sorted(uni_probs.items(), key=lambda x: -x[1]):
    print(f"  {pos:6s} {prob:.4f} ({prob:.1%})")

print("\nPOS-Bigram patterns:")
for prev_pos in ['n', 'pron', 'v', 'adj', 'part']:
    bi_probs = tagger.stats.get_pos_word_bigram_probs(prev_pos, word)
    if bi_probs:
        winner = max(bi_probs.keys(), key=lambda p: bi_probs[p])
        win_prob = bi_probs[winner]
        print(f"  After {prev_pos:5s}: {winner:5s} {win_prob:.4f} ({win_prob:.1%})")
    else:
        print(f"  After {prev_pos:5s}: (no data)")

# Test sentence tagging
print("\n" + "="*70)
print("TEST: Sentence tagging with POS context")
print("="*70)

sentence = [
    {'word': 'သူ', 'pos': 'pron'},
    {'word': 'က', 'pos': 'ppm|part'},
    {'word': 'စား', 'pos': 'v|n'},
    {'word': 'နေ', 'pos': 'v|part'},
    {'word': 'တယ်', 'pos': 'ppm'},
]

tagged = tagger.tag_tokens(sentence)

print("\nTagged sequence:")
for i, t in enumerate(tagged):
    prev = tagged[i-1]['pos'] if i > 0 else None
    prev_str = f"after {prev:5s}" if prev else "(start) "
    prob = t.get('pos_probs', {}).get(t['pos'], 1.0)
    print(f"  {t['word']:8s} [{prev_str}] -> {t['pos']:5s} [{prob:.2%}]")

# Test debug function
print("\n" + "="*70)
print("TEST: Debug scoring breakdown")
print("="*70)

debug = tagger.debug_score_word("က", prev_pos="n")
print(f"\nWord: {debug['word']}")
print(f"Context: After {debug['prev_pos'].upper()}")
print(f"Candidates: {debug['candidates']}")

print("\nUnigram scores:")
for pos, prob in sorted(debug['unigram']['probabilities'].items(), key=lambda x: -x[1]):
    print(f"  {pos:6s} {prob:.4f}")

if debug.get('pos_bigram'):
    print("\nPOS-Bigram scores:")
    for pos, prob in sorted(debug['pos_bigram']['probabilities'].items(), key=lambda x: -x[1]):
        print(f"  {pos:6s} {prob:.4f}")

print("\nFinal scores (50% unigram + 50% POS-bigram):")
for pos, prob in sorted(debug['final_scores']['probabilities'].items(), key=lambda x: -x[1]):
    winner = " <-- WINNER" if pos == debug['final_scores']['winner'] else ""
    print(f"  {pos:6s} {prob:.4f}{winner}")

print("\n" + "="*70)
print("SUCCESS: All tests completed!")
print("="*70)
