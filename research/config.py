"""
config.py - Configuration for Burmese Segmenter

Paths to data files and tuning parameters.
Edit these to match your local setup.
"""

from pathlib import Path
from segmenter import SegmenterConfig

# ============================================================================
# DATA DIRECTORY
# ============================================================================

# Base directory for all data files
DATA_DIR = Path(r"C:\Users\conra\Desktop\burmese d")

# ============================================================================
# LANGUAGE MODEL FILES (myWord - MIT License)
# ============================================================================

# Download from: https://github.com/ye-kyaw-thu/myWord
# Files needed:
#   - unigram-word.txt
#   - bigram-word.txt

MYWORD_UNIGRAM_PATH = DATA_DIR / "myWord-main" / "unigram-word.txt"
MYWORD_BIGRAM_PATH = DATA_DIR / "myWord-main" / "bigram-word.txt"

# Alternative paths if using different naming (keep for reference)
# MYWORD_UNIGRAM_PATH = DATA_DIR / "unigram.txt"
# MYWORD_BIGRAM_PATH = DATA_DIR / "bigram.txt"

# ============================================================================
# DICTIONARY FILES
# ============================================================================

# Wiktionary Burmese (CC BY-SA 3.0 - commercial OK with attribution)
# Your existing Kaikki-based export
WIKTIONARY_PATH = DATA_DIR / "Burmese-English Wiktionary dictionary.tsv"

# Myanmar-Myanmar Dictionary cleaned (if you have it)
MMD_PATH = DATA_DIR / "MMD_clean.tsv"

# Pali/Classical dictionary (for historical texts)
PALI_PATH = DATA_DIR / "peu.tsv"

# Grammar lexicon (function words, particles)
GRAMMAR_PATH = DATA_DIR / "burmese_grammar_dictionary.tsv"

# User custom dictionary (dynamically updated)
USER_DICT_PATH = DATA_DIR / "user_custom_dictionary.tsv"

# ============================================================================
# SEGMENTER TUNING PARAMETERS
# ============================================================================

# These are the ONLY 3 parameters you need to tune.
# Start with these values and adjust based on results.

SEGMENTER_CONFIG = SegmenterConfig(
    # OOV_SYLLABLE_PENALTY: Cost per extra syllable for unknown words
    # Higher = prefer breaking unknown chunks into smaller pieces
    # Lower = allow longer unknown words
    # Range: 1.0 - 5.0 typical
    OOV_SYLLABLE_PENALTY=15.0,
    
    # DICT_NO_LM_DISCOUNT: Multiplier for dict-only words (not in LM)
    # This is KEY for your historical texts with rare Pali/proper names
    # Lower = more trust in dictionaries even if LM hasn't seen word
    # Higher = more skeptical of dict-only words
    # Range: 0.5 - 0.9 typical
    # 0.7 = treat dict-only words as ~30% cheaper than true OOV
    DICT_NO_LM_DISCOUNT=0.0,
    
    # UNIGRAM_WEIGHT: Scale LM unigram cost (lower to reduce LM influence)
    UNIGRAM_WEIGHT=0.0,
    
    # Per-token anchors (mirrors old base costs)
    KNOWN_WORD_BASE_COST=1.0,
    UNKNOWN_WORD_BASE_COST=5.0,
    
    # BIGRAM_WEIGHT: How much context affects segmentation
    # 0.0 = pure unigram (no context)
    # 0.1 = gentle nudging from common sequences
    # 0.3+ = strong preference for observed bigrams
    # Range: 0.0 - 0.3 typical
    BIGRAM_WEIGHT=0.0,
    
    # Structural parameters (usually don't need to change)
    MAX_WORD_CLUSTERS=16,  # Max syllables in a single word
    BEAM_WIDTH=4,          # For future beam search (not used in pure DP)
    UNIGRAM_ALPHA=1.0,     # Laplace smoothing
)

# ============================================================================
# DICTIONARY PRIORITIES
# ============================================================================

# Lower number = higher priority in lookup
# When same word exists in multiple dicts, highest priority wins

DICT_PRIORITIES = {
    "user": 1,           # User's custom entries - always wins
    "chronicle": 99,      # Domain-specific historical terms
    "pali": 5,           # Classical/religious vocabulary  
    "wiktionary": 3,     # General Burmese
    "mmd": 2,            # Myanmar-Myanmar dictionary
    "grammar": 4,        # Function words
    "lm_vocab": 99,      # Auto-populated from LM (lowest priority)
}

# ============================================================================
# LOGGING / DEBUG
# ============================================================================

LOG_DIR = DATA_DIR
LOG_SEGMENTATION = False  # Log each segmentation for debugging
LOG_OOV = True            # Log unknown words to file for later review


# ============================================================================
# HELPER: Get file if exists
# ============================================================================

def get_path_if_exists(path: Path) -> Path | None:
    """Return path if it exists, None otherwise."""
    return path if path.exists() else None


def print_config_status():
    """Print status of all configured files."""
    print("=== Segmenter Configuration Status ===\n")
    
    files = [
        ("myWord Unigram", MYWORD_UNIGRAM_PATH),
        ("myWord Bigram", MYWORD_BIGRAM_PATH),
        ("Wiktionary", WIKTIONARY_PATH),
        ("MMD", MMD_PATH),
        ("Pali", PALI_PATH),
        ("Grammar", GRAMMAR_PATH),
        ("User Dict", USER_DICT_PATH),
    ]
    
    for name, path in files:
        status = "✓ Found" if path.exists() else "✗ Missing"
        print(f"  {name}: {status}")
        print(f"    {path}")
    
    print(f"\n=== Tuning Parameters ===")
    print(f"  OOV_SYLLABLE_PENALTY: {SEGMENTER_CONFIG.OOV_SYLLABLE_PENALTY}")
    print(f"  DICT_NO_LM_DISCOUNT:  {SEGMENTER_CONFIG.DICT_NO_LM_DISCOUNT}")
    print(f"  BIGRAM_WEIGHT:        {SEGMENTER_CONFIG.BIGRAM_WEIGHT}")


if __name__ == "__main__":
    print_config_status()
