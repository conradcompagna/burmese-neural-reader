"""Burmese reader: segmentation config."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class SegmenterConfig:
    """
    Configuration for the segmenter. Only 3 main tuning parameters.
    OOV_SYLLABLE_PENALTY: Extra cost per syllable for completely unknown words
    DICT_NO_LM_DISCOUNT: Multiplier for words in dictionary but not in LM
    BIGRAM_WEIGHT: How much bigram context influences segmentation
    KNOWN_WORD_BASE_COST: Per-word base cost anchor for known tokens
    UNKNOWN_WORD_BASE_COST: Per-word base cost anchor for unknown/LM-only tokens
    UNIGRAM_WEIGHT: Scale for how much unigram LM cost contributes
    """

    # Core tuning parameters
    OOV_SYLLABLE_PENALTY: float = 2.0
    DICT_NO_LM_DISCOUNT: float = 0.7  # Generous to specialized dicts
    BIGRAM_WEIGHT: float = 0.1
    KNOWN_WORD_BASE_COST: float = 1.0
    UNKNOWN_WORD_BASE_COST: float = 5.0
    UNIGRAM_WEIGHT: float = 1.0
    # Structural parameters (rarely need adjustment)
    MAX_WORD_CLUSTERS: int = 16  # Max syllables to consider as single word
    BEAM_WIDTH: int = 4  # For bigram-aware Viterbi (0 = no beam, pure DP)
    # Laplace smoothing for LM (matches myWord approach)
    UNIGRAM_ALPHA: float = 1.0
