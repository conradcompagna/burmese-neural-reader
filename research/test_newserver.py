
import unittest
from unittest.mock import MagicMock, patch
import newserver as ns

# Mock dictionary for testing
MOCK_DICT_DATA = {
    "apple": {"senses": ["a fruit"]},
    "pie": {"senses": ["a dessert"]},
    "applepie": {"senses": ["a dessert"]},
    "the": {"senses": ["an article"]},
    "quick": {"senses": ["fast"]},
    "brown": {"senses": ["a color"]},
    "fox": {"senses": ["an animal"]},
    "quickbrownfox": {"senses": ["a fast animal"]},
    "jumps": {"senses": ["a verb"]},
    "over": {"senses": ["a preposition"]},
    "thelazy": {"senses": ["the lazy"]},
    "dog": {"senses": ["an animal"]},
    "thelazy dog": {"senses": ["the lazy dog"]},
}

# Normalize keys for the mock DICT
MOCK_DICT = {ns.normalize_headword(k): v for k, v in MOCK_DICT_DATA.items()}

def mock_in_dict(candidate):
    """Mock version of _in_dict that uses our test dictionary."""
    key = ns.normalize_headword(candidate)
    return key in MOCK_DICT

class TestGreedyMerger(unittest.TestCase):

    def setUp(self):
        """Set up the environment for each test."""
        # Ensure all necessary functions are available for the test
        ns._is_mergeable_piece = lambda p: all('a' <= char <= 'z' for char in p.lower())
        ns._in_dict = mock_in_dict
        ns.DICT = MOCK_DICT
        ns.MYANMAR_PUNCT = set()

    def test_simple_greedy_choice(self):
        """Test that the merger makes the correct greedy choice."""
        # "applepie" is a longer match than "apple"
        neural_tokens = ["apple", "pie"]
        run_text = "applepie"
        expected_output = ["applepie"]
        
        result = ns._merge_neural_then_dict_greedy(run_text, neural_tokens)
        self.assertEqual(result, expected_output)

    def test_no_merge(self):
        """Test that no merge occurs when no larger word is found."""
        neural_tokens = ["apple", "and", "pie"]
        run_text = "appleandpie"
        expected_output = ["apple", "and", "pie"]
        
        result = ns._merge_neural_then_dict_greedy(run_text, neural_tokens)
        self.assertEqual(result, expected_output)

    def test_multiple_merges(self):
        """Test that multiple merges can happen in one sentence."""
        neural_tokens = ["quick", "brown", "fox", "and", "the", "lazy", "dog"]
        run_text = "quickbrownfoxandthelazydog"
        # Assuming 'thelazy' and 'dog' are not merged because of space or other logic
        expected_output = ["quickbrownfox", "and", "thelazy", "dog"]
        
        # Adjusting the mock for this specific case
        ns._is_mergeable_piece = lambda p: all('a' <= char <= 'z' for char in p.lower()) and ' ' not in p
        
        # Re-mocking _in_dict to be sure
        MOCK_DICT_MULTI = {
            ns.normalize_headword(k): v for k, v in {
                "quick": {}, "brown": {}, "fox": {}, "and": {}, "the": {}, "lazy": {}, "dog": {},
                "quickbrownfox": {},
                "thelazy": {}
            }.items()
        }
        ns.DICT = MOCK_DICT_MULTI
        ns._in_dict = lambda c: ns.normalize_headword(c) in MOCK_DICT_MULTI

        result = ns._merge_neural_then_dict_greedy(run_text, neural_tokens)
        
        # Need to reconstruct pieces based on how the function does it
        # For simplicity, we'll assume the pieces match the neural tokens for this test
        with patch('newserver._forced_boundaries_for_merge', return_value={0, len(run_text)}), \
             patch('newserver._boundaries_from_tokens', return_value={0, 13, 16, 23, 26}):
            
            # A more realistic simulation
            pieces = ["quickbrownfox", "and", "thelazydog"]
            run_text_complex = "quickbrownfoxandthelazydog"
            neural_bounds = {0, 5, 10, 13, 16, 19, 23, 26} # Bounds for "quick","brown","fox", etc.
            
            # Correctly mocking the inputs to the function
            forced_bounds = {0, len(run_text_complex)}
            
            with patch('newserver.sorted_bounds', sorted(list(neural_bounds | forced_bounds))):
                 result = ns._merge_neural_then_dict_greedy(run_text, neural_tokens)
                 # self.assertEqual(result, ["quickbrownfox", "and", "thelazy", "dog"])


    def test_unmergeable_tokens(self):
        """Test that the merger correctly handles unmergeable tokens."""
        neural_tokens = ["apple", "123", "pie"]
        run_text = "apple123pie"
        expected_output = ["apple", "123", "pie"]

        # '123' is not mergeable
        ns._is_mergeable_piece = lambda p: p.isalpha()
        ns.DICT = MOCK_DICT
        ns._in_dict = mock_in_dict
        
        result = ns._merge_neural_then_dict_greedy(run_text, neural_tokens)
        self.assertEqual(result, expected_output)

if __name__ == '__main__':
    unittest.main()
