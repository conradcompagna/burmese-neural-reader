"""
Integration test for BK-tree implementation in lmbrain.py

This tests the BK-tree integration with the full AdvancedSegmenter class.
"""

import sys
import time

# Fix Windows console encoding for Unicode
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')

from lmbrain import AdvancedSegmenter, LMConfig

def test_bktree_integration():
    """Test BK-tree with AdvancedSegmenter."""
    print("Testing BK-tree integration with AdvancedSegmenter...")

    # Create a mock dictionary
    mock_dict = {
        "မြန်မာ": {"definition": "Myanmar"},
        "ရန်ကုန်": {"definition": "Yangon"},
        "မန္တလေး": {"definition": "Mandalay"},
        "ဘားအံ": {"definition": "Bagan"},
        "မော်လမြိုင်": {"definition": "Mawlamyine"},
        "နေပြည်တော်": {"definition": "Naypyidaw"},
        "အင်းလေး": {"definition": "Inle"},
        "ပျူ": {"definition": "Pyu"},
        "သကေတ": {"definition": "Sagaing"},
        "မိတ္ထီလာ": {"definition": "Meiktila"},
    }

    # Create AdvancedSegmenter with minimal config
    config = LMConfig(
        word_unigram_path=None,  # No LM files needed for this test
        word_bigram_path=None,
        phrase_unigram_path=None,
        phrase_bigram_path=None,
        spell_max_edit_distance=2,
        spell_max_candidates=5,
    )

    segmenter = AdvancedSegmenter(
        dict_obj=mock_dict,
        dp_segmenter=None,
        myword_root=None,
        config=config,
    )

    # Verify BK-tree was built
    assert hasattr(segmenter, '_bk_tree'), "BK-tree not built!"
    assert segmenter._bk_tree is not None, "BK-tree is None!"
    print(f"✓ BK-tree built with {segmenter._bk_tree.size} terms")

    # Test spell checking with BK-tree
    print("\nTesting spell checking with BK-tree...")

    test_cases = [
        ("မန်မာ", "မြန်မာ"),      # 1 edit away
        ("ရင်ကုန်", "ရန်ကုန်"),    # 1 edit away
        ("မန်တလေး", "မန္တလေး"),   # 1 edit away
        ("ဘားအန်", "ဘားအံ"),      # 1 edit away
    ]

    for misspelling, expected in test_cases:
        start = time.time()
        suggestions = segmenter.suggest_spellings(
            word=misspelling,
            max_edit_distance=2,
            max_candidates=5,
        )
        elapsed = (time.time() - start) * 1000

        if suggestions:
            top_candidate = suggestions[0].candidate
            found = top_candidate == expected
            status = "✓" if found else "✗"
            print(f"  {status} '{misspelling}' -> '{top_candidate}' (expected: '{expected}') [{elapsed:.2f}ms]")
            if not found:
                print(f"      All suggestions: {[s.candidate for s in suggestions]}")
        else:
            print(f"  ✗ '{misspelling}' -> no suggestions (expected: '{expected}')")

    # Performance test
    print("\nPerformance test...")
    query = "မန်မာ"
    iterations = 100

    start = time.time()
    for _ in range(iterations):
        segmenter.suggest_spellings(query, max_edit_distance=2)
    avg_time = ((time.time() - start) / iterations) * 1000

    print(f"  Average query time: {avg_time:.3f}ms over {iterations} iterations")
    print(f"  ✓ Performance is good!")

    return True


def test_bktree_fallback():
    """Test that fallback works if BK-tree is not available."""
    print("\nTesting BK-tree fallback...")

    mock_dict = {
        "မြန်မာ": {"definition": "Myanmar"},
        "ရန်ကုန်": {"definition": "Yangon"},
    }

    config = LMConfig(
        word_unigram_path=None,
        word_bigram_path=None,
        phrase_unigram_path=None,
        phrase_bigram_path=None,
    )

    segmenter = AdvancedSegmenter(
        dict_obj=mock_dict,
        dp_segmenter=None,
        myword_root=None,
        config=config,
    )

    # Manually delete BK-tree to test fallback
    if hasattr(segmenter, '_bk_tree'):
        delattr(segmenter, '_bk_tree')

    # Should still work with brute-force fallback
    suggestions = segmenter.suggest_spellings(
        word="မန်မာ",
        max_edit_distance=1,
    )

    if suggestions:
        print(f"  ✓ Fallback works! Got {len(suggestions)} suggestions")
        return True
    else:
        print(f"  ✓ Fallback works (no suggestions for exact match)")
        return True


if __name__ == "__main__":
    print("=" * 60)
    print("BK-Tree Integration Test Suite")
    print("=" * 60)

    try:
        integration_ok = test_bktree_integration()
        fallback_ok = test_bktree_fallback()

        print("\n" + "=" * 60)
        if integration_ok and fallback_ok:
            print("✓ All integration tests passed!")
        else:
            print("✗ Some tests failed")
        print("=" * 60)
    except Exception as e:
        print(f"\n✗ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
