"""Burmese reader: normalization."""

from __future__ import annotations

import html
import re
import unicodedata

from . import settings as settings_service
from .runtime import feature_state


def contains_burmese(s: str) -> bool:
    """Return True if any Myanmar-range char is in s."""
    return any(0x1000 <= ord(ch) <= 0x109F for ch in s)


def burmese_char_count(s: str) -> int:
    """Count Myanmar-range characters in s."""
    return sum(1 for ch in s if 0x1000 <= ord(ch) <= 0x109F)


def clean_html(s: str) -> str:
    """Strip basic HTML tags and normalize whitespace."""
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def normalize_burmese(s: str) -> str:
    """
    Simple normalization for Burmese text for INTERNAL use only
    (dictionary / LM / grammar keys). Currently: NFC.
    IMPORTANT: do NOT call this on the page text that you send
    back to the frontend for segmentation; that must stay
    byte-identical so the browser can map segments to DOM text.
    """
    if not s:
        return s
    s = unicodedata.normalize("NFC", s)
    return s


def normalize_headword(s: str) -> str:
    """
    Normalize a headword for dictionary keying:
    - apply basic Burmese normalization,
    - KEEP ONLY Myanmar-range characters (drop stray ASCII like ')' etc.)
    """
    s = normalize_burmese(s)
    s = "".join(ch for ch in s if 0x1000 <= ord(ch) <= 0x109F)
    return s.strip()


MYANMAR_EXTENDED_A_START = 0xAA60


MYANMAR_EXTENDED_A_END = 0xAA7F


MYANMAR_EXTENDED_B_START = 0xA9E0


MYANMAR_EXTENDED_B_END = 0xA9FF


MYANMAR_PUNCT = {"\u104a", "\u104b"}


ASCII_PUNCT = set(".,;:!?()[]{}\"'`|/\\-")


ZERO_WIDTH_CHARS = {"\u200b", "\u200c", "\u200d", "\ufeff"}


SINGLETON_COMBINING = {
    "\u102b",
    "\u102c",  # tall AA, AA
    "\u102d",
    "\u102e",  # i, ii
    "\u102f",
    "\u1030",  # u, uu
    "\u1032",  # ai
    "\u1036",  # anusvara
    "\u1037",  # dot below
    "\u1038",  # visarga
    "\u103a",  # asat
}


def _is_myanmar_core(cp: int) -> bool:
    """Core Myanmar block U+1000ÃÂ¢Ã¢âÂ¬Ã¢â¬ÅU+109F."""
    return 0x1000 <= cp <= 0x109F


def _is_myanmar_extended(cp: int) -> bool:
    """Myanmar Extended-A/B."""
    return (MYANMAR_EXTENDED_A_START <= cp <= MYANMAR_EXTENDED_A_END) or (
        MYANMAR_EXTENDED_B_START <= cp <= MYANMAR_EXTENDED_B_END
    )


TSV_USER_TEXT_OVERRIDE_PATH = settings_service.TSV_WIKI_PATH.with_name(
    "user_text_overrides.tsv"
)


def _apply_manual_text_overrides(text: str) -> str:
    for src, dst in state.MANUAL_TEXT_OVERRIDES:
        if src in text:
            text = text.replace(src, dst)
    return text


def normalize_burmese_for_segmentation(
    text: str,
    extended_hits: set[str] | None = None,
) -> str:
    """
    Identity transform so that segmentation operates on raw page text.
    We keep this separate from `normalize_burmese` so that we can
    freely change internal NFC/cleanup behaviour without ever
    touching the bytes the frontend sees.

    DISABLED (2026-01-20): Disabled manual overrides, zero-width filtering,
    and combining mark validation to diagnose normalization desync issues.
    """
    if not text:
        return text

    # DISABLED: text = _apply_manual_text_overrides(text)

    out: list[str] = []
    in_cluster = False  # have we seen a Myanmar base in the current cluster?
    chars = list(text)
    n = len(chars)
    for idx, ch in enumerate(chars):
        # DISABLED: if ch in ZERO_WIDTH_CHARS:
        #     continue
        cp = ord(ch)
        if extended_hits is not None and 0xAA60 <= cp <= 0xAA7F:
            extended_hits.add(ch)

        if ch in MYANMAR_PUNCT:
            out.append(ch)
            in_cluster = False
            continue

        if _is_myanmar_core(cp) or _is_myanmar_extended(cp):
            # DISABLED: if is_combining_mark(ch):
            #     if in_cluster:
            #         out.append(ch)
            #     # else: drop stray combining mark
            #     continue
            out.append(ch)
            in_cluster = True
            continue

        # Non-Myanmar resets cluster state but is preserved for UI alignment.
        out.append(ch)
        in_cluster = False

    return "".join(out)


def is_combining_mark(ch: str) -> bool:
    """
    IMPROVED: Enhanced detection of Burmese combining marks.
    """
    code = ord(ch)
    # Burmese combining vowels/medials/signs
    if 0x102B <= code <= 0x103E:
        return True
    if 0x1056 <= code <= 0x1059:
        return True
    if 0x105E <= code <= 0x1060:
        return True
    if 0x1062 <= code <= 0x1064:
        return True
    if 0x1067 <= code <= 0x106D:
        return True
    if 0x1071 <= code <= 0x1074:
        return True
    if 0x1082 <= code <= 0x108D:
        return True
    if code == 0x108F:
        return True
    if code == 0x1094:
        return True
    if 0x109A <= code <= 0x109D:
        return True
    # Additional marks: anusvara (?), visarga (?), virama (?)
    if code in (0x1036, 0x1038, 0x1039):
        return True
    return False


_MYANMAR_BASE_CONSONANTS = set("ကခဂဃငစဆဇဈဉညဋဌဍဎဏတထဒဓနပဖဗဘမယရလဝသဟဠအ")


_MYANMAR_INDEPENDENT_VOWELS = set("ဣဤဥဦဧဩဪ")


_MYANMAR_BASE_CHARS = _MYANMAR_BASE_CONSONANTS | _MYANMAR_INDEPENDENT_VOWELS


_MYANMAR_NUMERALS = set("၀၁၂၃၄၅၆၇၈၉")


_MYANMAR_ABBREVIATIONS = set("၌၍၎၏")


_VIRAMA = "\u1039"  # ္ - stacker that makes following consonant a modifier


def _has_base_consonant(tok: str) -> bool:
    """
    Return True if the token has at least one BASE consonant or independent vowel.

    A base consonant is one that is NOT immediately preceded by virama (္).
    Stacked consonants (after virama) are modifiers, not bases.

    Examples:
      - "ကား" → True (က is a base consonant)
      - "္ဖ္ယ" → False (both ဖ and ယ are preceded by virama, so no base)
      - "သင်္ဘော" → True (သ and င are bases, ္ဘ is stacked)
      - "ိုး" → False (only combining marks, no consonant at all)
    """
    if not tok:
        return False
    for i, ch in enumerate(tok):
        if ch in _MYANMAR_BASE_CHARS:
            # Check if preceded by virama (making it a stacked consonant, not a base)
            if i > 0 and tok[i - 1] == _VIRAMA:
                continue  # This is a stacked consonant, skip it
            return True  # Found a base consonant
    return False


def _has_combining_marks(tok: str) -> bool:
    """Return True if the token contains any combining marks (diacritics)."""
    if not tok:
        return False
    for ch in tok:
        if is_combining_mark(ch):
            return True
    return False


def _is_spacy_clean_token(tok: str) -> bool:
    """
    Return True if a segment should be passed to spaCy for POS/UD analysis.

    DISABLED (2026-02): Previously filtered out combining-mark-only tokens,
    but this created gaps in dependency parses. Now allows all tokens through
    so the NLP pipeline sees complete sentences, even with OCR-damaged tokens.

    Old behavior (for reference):
      - Filtered: tokens with only combining marks (bare diacritics)
      - Filtered: tokens where all consonants are stacked (preceded by virama)
      - Allowed: normal words, numerals, abbreviations, punctuation
    """
    tok = tok or ""
    if not tok:
        return False
    # Allow all non-empty tokens through to NLP pipeline
    return True


def _spacy_keep_fn(tok: str) -> bool:
    # Allow all tokens through to NLP pipeline, including combining-mark-only tokens.
    # These "broken" tokens are often part of sentences (OCR damage) and gaps in the
    # dependency parse are more confusing than letting the model see them.
    return True


def _normalize_burmese(s: str) -> str:
    return normalize_burmese(s)


def _normalize_headword(s: str) -> str:
    return normalize_headword(s)


def _is_combining_mark(ch: str) -> bool:
    return is_combining_mark(ch)


def _contains_burmese(s: str) -> bool:
    return contains_burmese(s)


def _new_state():
    from types import SimpleNamespace

    return SimpleNamespace(
        USER_TEXT_OVERRIDES=[],
        MANUAL_TEXT_OVERRIDES=[],
    )


state = feature_state("normalization", _new_state)
