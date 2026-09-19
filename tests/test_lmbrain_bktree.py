"""Exercise spelling suggestions with an in-memory Burmese dictionary."""

import unittest

from lmbrain import AdvancedSegmenter, LMConfig


class SegmenterSearchTests(unittest.TestCase):
    def test_expected_spelling_suggestions(self):
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
        segmenter = AdvancedSegmenter(
            dict_obj=mock_dict,
            dp_segmenter=None,
            myword_root=None,
            config=LMConfig(
                word_unigram_path=None,
                word_bigram_path=None,
                phrase_unigram_path=None,
                phrase_bigram_path=None,
                spell_max_edit_distance=2,
                spell_max_candidates=5,
            ),
        )
        self.assertIsNotNone(segmenter._bk_tree)
        for misspelling, expected in [
            ("မန်မာ", "မြန်မာ"),
            ("ရင်ကုန်", "ရန်ကုန်"),
            ("မန်တလေး", "မန္တလေး"),
            ("ဘားအန်", "ဘားအံ"),
        ]:
            with self.subTest(misspelling=misspelling):
                suggestions = segmenter.suggest_spellings(
                    word=misspelling, max_edit_distance=2, max_candidates=5
                )
                self.assertTrue(suggestions)
                self.assertEqual(suggestions[0].candidate, expected)


if __name__ == "__main__":
    unittest.main()
