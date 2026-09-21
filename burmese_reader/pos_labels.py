"""Dictionary POS labels independent of overlays and resource loading."""

import re

POS_WHITELIST_RE = re.compile(
    r"^(n|noun|v|verb|adj|adjective|adv|adverb|num|number|pron|pronoun|aux|auxiliary|prep|preposition|postp|postposition|conj|conjunction|interj|interjection|part|particle|det|determiner|prefix|suffix|m|nm)\b",
    re.I,
)


def normalize_pos(pos: str) -> str:
    pos = (pos or "").strip()
    if not pos:
        return ""
    if not POS_WHITELIST_RE.match(pos):
        # junk like "cocoa.", "domino", etc ? drop
        return ""
    return pos


def get_meta_pos(pos: str) -> str:
    """
    Collapse raw POS into four meta-classes:
    CASE  - postpositions / preposition-like case markers
    VPART ÃÂ¢Ã¢âÂ¬Ã¢â¬Å particles (verbal / clausal)
    LINK  ÃÂ¢Ã¢âÂ¬Ã¢â¬Å conjunctions, determiners
    BOUND ÃÂ¢Ã¢âÂ¬Ã¢â¬Å prefix / suffix (bound morphology)
    """
    p = (pos or "").lower()
    if not p:
        return ""
    # CASE markers
    if p.startswith("postp") or p.startswith("prep"):
        return "CASE"
    # particles: MMD 'Part/part', WIKI 'particle'
    if p.startswith("part"):
        return "VPART"
    # linkers: conj, det
    if p.startswith("conj") or p.startswith("det"):
        return "LINK"
    # bound morphemes
    if p.startswith("prefix") or p.startswith("suffix"):
        return "BOUND"
    return ""
