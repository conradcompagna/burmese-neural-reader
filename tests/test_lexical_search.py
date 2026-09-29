"""Deterministic lexical regressions that require no corpus or model files."""
import random

import pytest

from lmbrain import AdvancedSegmenter, BKTree, LMConfig, levenshtein_distance


@pytest.mark.parametrize("left,right,distance", [
    ("", "", 0), ("", "မြန်မာ", 6), ("kitten", "sitting", 3),
    ("မြန်မာ", "မန်မာ", 1), ("က", "ခ", 1), ("ကက", "က", 1),
])
def test_edit_distance(left, right, distance):
    assert levenshtein_distance(left, right) == distance
    assert levenshtein_distance(right, left) == distance


def test_tree_matches_exhaustive_search():
    rng = random.Random(1729)
    vocabulary = {"", "မြန်မာ", "မန်မာ", "ရန်ကုန်", "မန္တလေး"}
    vocabulary.update("".join(rng.choices("ကခဂငစဆညတနမယရလဝသ", k=rng.randint(2, 7)))
                      for _ in range(160))
    vocabulary = sorted(vocabulary)
    tree = BKTree(levenshtein_distance)
    tree.build(vocabulary + vocabulary)
    # BKTree intentionally ignores empty dictionary headwords and duplicates.
    accepted = [word for word in vocabulary if word]
    assert tree.size == len(accepted)
    assert tree.query("", 5) == []
    for query in ["မန်မာ", "က", "မရှိ"] + accepted[::11]:
        for radius in (0, 1, 2):
            expected = sorted((word, d) for word in accepted
                              if (d := levenshtein_distance(query, word)) <= radius)
            assert sorted(tree.query(query, radius)) == expected


def test_empty_tree_and_exact_match():
    tree = BKTree(levenshtein_distance)
    assert tree.query("မြန်မာ", 2) == []
    tree.add("မြန်မာ")
    assert tree.query("မြန်မာ", 0) == [("မြန်မာ", 0)]


def make_segmenter():
    return AdvancedSegmenter(
        dict_obj={"မြန်မာ": {"definition": "Myanmar"}, "ရန်ကုန်": {"definition": "Yangon"}},
        dp_segmenter=None, myword_root=None,
        config=LMConfig(word_unigram_path=None, word_bigram_path=None,
                        phrase_unigram_path=None, phrase_bigram_path=None),
    )


def test_spelling_uses_dictionary_candidates_and_cache():
    segmenter = make_segmenter()
    first = segmenter.suggest_spellings("မန်မာ", max_edit_distance=1)
    second = segmenter.suggest_spellings("မန်မာ", max_edit_distance=1)
    assert [item.candidate for item in first] == ["မြန်မာ"]
    assert [item.to_dict() for item in second] == [item.to_dict() for item in first]
    assert segmenter.suggest_spellings("", max_edit_distance=1) == []


def test_missing_tree_returns_no_candidates():
    segmenter = make_segmenter()
    segmenter._bk_tree = None
    assert segmenter.suggest_spellings("မန်မာ", max_edit_distance=1) == []
