"""
Test script to verify BK-tree implementation for fuzzy matching.

This script tests that:
1. BK-tree builds correctly
2. BK-tree query returns same results as brute-force
3. Performance improvement is significant
"""

import sys
import time
from lmbrain import BKTree, levenshtein_distance

# Fix Windows console encoding for Unicode
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')

# Test vocabulary (simulating Burmese words)
test_vocab = [
    "မြန်မာ", "ရန်គုန်", "မန္တလေး", "ဘားအံ", "မော်လမြိုင်",
    "သီရိလင်္ကာ", "အမေရိကန်", "ပြင်သစ်", "ဂျပန်", "တရုတ်",
    "ကိုရီးယား", "ထိုင်း", "လာအို", "ဗီယက်နမ်", "ဖိလစ်ပိုင်",
    "အင်ဒိုနီးရှား", "မလေးရှား", "ဆင်္ကာပူ", "ကမ္ဘောဒီးယား", "ဘရူနိုင်း"
]

def test_bktree_correctness():
    """Test that BK-tree returns same results as brute-force."""
    print("Testing BK-tree correctness...")

    # Build BK-tree
    bk = BKTree(levenshtein_distance)
    bk.build(test_vocab)

    print(f"Built BK-tree with {bk.size} terms")

    # Test queries
    test_queries = [
        ("မန်မာ", 1),    # 1 char off from "မြန်မာ"
        ("ရင်ကုန်", 2),   # 2 chars off from "ရန်គုန်"
        ("အမရိကန်", 2), # 2 chars off from "အမေရိကန်"
    ]

    for query, max_dist in test_queries:
        # BK-tree query
        bk_results = bk.query(query, max_dist)
        bk_results = sorted(bk_results)

        # Brute-force
        bf_results = []
        for word in test_vocab:
            d = levenshtein_distance(query, word)
            if d <= max_dist:
                bf_results.append((word, d))
        bf_results = sorted(bf_results)

        # Compare
        match = bk_results == bf_results
        print(f"  Query: '{query}' (max_dist={max_dist})")
        print(f"    BK-tree: {len(bk_results)} results")
        print(f"    Brute-force: {len(bf_results)} results")
        print(f"    Match: {match}")

        if not match:
            print(f"    ERROR: Results don't match!")
            print(f"    BK: {bk_results}")
            print(f"    BF: {bf_results}")
            return False

    print("✓ All correctness tests passed!")
    return True


def test_bktree_performance():
    """Test that BK-tree is significantly faster than brute-force."""
    print("\nTesting BK-tree performance...")

    # Create larger vocabulary for performance testing
    large_vocab = test_vocab * 100  # 2000 words

    # Build BK-tree
    start = time.time()
    bk = BKTree(levenshtein_distance)
    bk.build(large_vocab)
    build_time = time.time() - start

    print(f"Built BK-tree with {bk.size} unique terms in {build_time:.3f}s")

    test_query = "မန်မာ"
    max_dist = 2
    iterations = 100

    # BK-tree timing
    start = time.time()
    for _ in range(iterations):
        bk.query(test_query, max_dist)
    bk_time = (time.time() - start) / iterations

    # Brute-force timing
    start = time.time()
    for _ in range(iterations):
        results = []
        for word in large_vocab:
            d = levenshtein_distance(test_query, word)
            if d <= max_dist:
                results.append((word, d))
    bf_time = (time.time() - start) / iterations

    speedup = bf_time / bk_time if bk_time > 0 else float('inf')

    print(f"  BK-tree query time: {bk_time*1000:.3f}ms")
    print(f"  Brute-force time: {bf_time*1000:.3f}ms")
    print(f"  Speedup: {speedup:.1f}x")

    if speedup > 1.5:
        print(f"✓ BK-tree is {speedup:.1f}x faster!")
        return True
    else:
        print(f"⚠ BK-tree speedup is only {speedup:.1f}x (expected >1.5x)")
        return False


if __name__ == "__main__":
    print("=" * 60)
    print("BK-Tree Fuzzy Matching Test Suite")
    print("=" * 60)

    correctness_ok = test_bktree_correctness()
    performance_ok = test_bktree_performance()

    print("\n" + "=" * 60)
    if correctness_ok and performance_ok:
        print("✓ All tests passed!")
    else:
        print("✗ Some tests failed")
    print("=" * 60)
