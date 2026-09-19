"""Compare BK-tree fuzzy search with exhaustive edit-distance search."""

import unittest

from lmbrain import BKTree, levenshtein_distance

test_vocab = [
    "မြန်မာ",
    "ရန်គုန်",
    "မန္တလေး",
    "ဘားအံ",
    "မော်လမြိုင်",
    "သီရိလင်္ကာ",
    "အမေရိကန်",
    "ပြင်သစ်",
    "ဂျပန်",
    "တရုတ်",
    "ကိုရီးယား",
    "ထိုင်း",
    "လာအို",
    "ဗီယက်နမ်",
    "ဖိလစ်ပိုင်",
    "အင်ဒိုနီးရှား",
    "မလေးရှား",
    "ဆင်္ကာပူ",
    "ကမ္ဘောဒီးယား",
    "ဘရူနိုင်း",
]


class BKTreeTests(unittest.TestCase):
    def test_queries_match_exhaustive_search(self):
        tree = BKTree(levenshtein_distance)
        tree.build(test_vocab)
        for query, max_distance in [("မန်မာ", 1), ("ရင်ကုန်", 2), ("အမရိကန်", 2)]:
            with self.subTest(query=query, distance=max_distance):
                expected = sorted(
                    (word, distance)
                    for word in test_vocab
                    if (distance := levenshtein_distance(query, word)) <= max_distance
                )
                self.assertEqual(sorted(tree.query(query, max_distance)), expected)


if __name__ == "__main__":
    unittest.main()
