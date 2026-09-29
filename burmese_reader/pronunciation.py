"""Burmese reader: pronunciation."""

from __future__ import annotations

import burmese_transliteration as g2p_engine

MYANMAR_CONSONANTS = g2p_engine.MYANMAR_CONSONANTS


MYANMAR_INDEPENDENT_VOWELS = g2p_engine.MYANMAR_INDEPENDENT_VOWELS


MYANMAR_MEDIALS = g2p_engine.MYANMAR_MEDIALS


CONSONANT_ROMAN = g2p_engine.CONSONANT_ROMAN


MEDIAL_ROMAN = g2p_engine.MEDIAL_ROMAN


DIACRITIC_LABELS = g2p_engine.DIACRITIC_LABELS


def _split_into_syllables_for_g2p(text: str) -> list[str]:
    """Split Burmese text into orthographic syllables for G2P processing."""
    return g2p_engine._split_into_syllables(text)


def _romanize_syllable(syl: str) -> str:
    """Romanize a single Burmese syllable."""
    return g2p_engine.romanize_syllable(syl)


def _infer_pronunciation(text: str) -> str:
    """
    Romanize a whole Burmese string as hyphen-separated syllables.
    Example:
      '??????' -> 'myan-ma'
    """
    return g2p_engine.romanize(text, separator="-")


def g2p_explain_for_ui(text: str) -> dict:
    """
    Full pronunciation + breakdown for UI display.
    Returns:
      {
        "overall_roman": "myan-ma",
        "syllables": [
           {
             "orth": "????",
             "roman": "myan",
             "is_burmese": True,
             "is_minor": False,
             "tone": "checked",
             "base": {"ch": "?", "roman": "m", "label": "consonant"},
             "medials": [{"ch": "?", "roman": "y", "label": "? medial"}],
             "vowels": [...],
             "finals": [...],
             "marks": [...],
             "components": [...],  # detailed component breakdown
           },
           ...
        ]
      }
    """
    return g2p_engine.get_g2p_data(text)
