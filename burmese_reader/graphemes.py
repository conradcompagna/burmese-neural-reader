"""Burmese reader: graphemes."""

from __future__ import annotations

from . import normalization as normalization_service


def _build_grapheme_clusters(text: str) -> tuple[list[str], list[int]]:
    """
    Build low-level grapheme clusters for Myanmar text.
    A cluster is:
      - one base character, followed by
      - any number of combining marks (vowel signs, medials, tones, asat, etc.)
      - if the last mark was virama (?), include the stacked consonant + its marks
    """
    clusters: list[str] = []
    starts: list[int] = []
    n = len(text)
    i = 0
    while i < n:
        start = i
        ch = text[i]
        i += 1
        # Myanmar base + following combining marks
        if 0x1000 <= ord(ch) <= 0x109F and not (0x1040 <= ord(ch) <= 0x1049):
            # Collect all combining marks after the base
            while i < n and normalization_service.is_combining_mark(text[i]):
                i += 1
            # Handle stacked consonants (virama + consonant) - LOOP for multiple levels
            # Pali/Sanskrit words can have multiple consecutive stacks (e.g. င်္ဂ္ပ)
            while (
                i > 0 and i < n and ord(text[i - 1]) == 0x1039
            ):  # previous char was virama
                # Check if next char is a Myanmar consonant
                next_cp = ord(text[i])
                if 0x1000 <= next_cp <= 0x1021:  # Myanmar consonant range
                    i += 1  # Include the stacked consonant
                    # Collect any combining marks on the stacked consonant
                    while i < n and normalization_service.is_combining_mark(text[i]):
                        i += 1
                else:
                    break  # Next char isn't a stackable consonant, stop
        else:
            # Non-Myanmar base; just keep contiguous run of non-combining
            # non-Myanmar chars together. This keeps Latin / punctuation as
            # their own small clusters.
            while (
                i < n
                and not normalization_service.is_combining_mark(text[i])
                and not (0x1000 <= ord(text[i]) <= 0x109F)
            ):
                i += 1
        # Append the cluster we just built (this is OUTSIDE both if/else)
        clusters.append(text[start:i])
        starts.append(start)
    return clusters, starts


_CODA_INITIALS = set("ကတပစငံမယရလဉနည")


_ASAT = "\u103a"


_CODA_BLOCKING_MEDIALS = {"?", "?", "?", "?"}


_FULL_VOWEL_SIGNS = {
    "\u102b",  # tall AA
    "\u102c",  # AA
    "\u102d",  # I
    "\u102e",  # II
    "\u102f",  # U
    "\u1030",  # UU
    "\u1031",  # E
    "\u1032",  # AI
}


def _looks_like_coda_cluster(cluster: str) -> bool:
    """
    Heuristic: does this grapheme cluster *look* like a coda that should attach
    to the previous syllable, rather than start a new one?
    We now require:
      - starts with one of ? / ? / ? / ? / ? / ? / ? / ? / ? / ?
      - contains U+103A (asat)
      - does *not* contain any full vowel signs (?, ?, ...)
      - does *not* contain medials (?, ?, ?, ?)
    """
    if not cluster:
        return False
    first = cluster[0]
    if first not in _CODA_INITIALS:
        return False
    # must have asat (the "kill" mark)
    if _ASAT not in cluster:
        return False
    # NEW: if the cluster has any medials, treat it as a full syllable,
    # not as a coda. This stops "???" etc. from gluing.
    for ch in cluster:
        if ch in _CODA_BLOCKING_MEDIALS:
            return False
    # If there's a full vowel sign, treat as an independent syllable.
    for ch in cluster:
        if ch in _FULL_VOWEL_SIGNS:
            return False
    return True


def _can_attach_coda_to_prev(prev_cluster: str) -> bool:
    """
    Only attach a coda-looking cluster to the previous cluster if that previous
    cluster actually looks like a Myanmar syllable (not space/punctuation/etc.).
    """
    if not prev_cluster:
        return False
    last = prev_cluster[-1]
    # Don't glue onto whitespace
    if last.isspace():
        return False
    cp = ord(last)
    # Non-Myanmar: don't attach
    if not (0x1000 <= cp <= 0x109F):
        return False
    # Myanmar digits
    if 0x1040 <= cp <= 0x1049:
        return False
    # Myanmar punctuation (? ? ? etc.)
    if 0x104A <= cp <= 0x104F:
        return False
    return True


def _build_clusters(text: str) -> tuple[list[str], list[int], list[int]]:
    """
    Build *syllable-ish* clusters for the DP segmenter.
    Steps:
      1. Build raw grapheme clusters (_build_grapheme_clusters).
      2. Post-process them so that coda-shaped clusters (e.g. "??", "???", "??")
         are merged into the previous cluster, giving syllable-like units:
             ? | ???   ->  ????
             ?? | ??   ->  ????
             ? | ??   ->  ???

    Re-enabled (2026-01-31): Coda attachment enabled for syllable-like clusters.
    """
    base_clusters, base_starts = _build_grapheme_clusters(text)
    clusters: list[str] = []
    starts: list[int] = []
    for cluster, start in zip(base_clusters, base_starts):
        # Coda attachment disabled again: keep raw grapheme clusters.
        # if (
        #     clusters
        #     and _looks_like_coda_cluster(cluster)
        #     and _can_attach_coda_to_prev(clusters[-1])
        # ):
        #     # Merge into previous cluster
        #     clusters[-1] += cluster
        #     continue
        clusters.append(cluster)
        starts.append(start)
    # Build char -> cluster index map
    char_to_cluster = [-1] * len(text)
    for ci, start in enumerate(starts):
        end = start + len(clusters[ci])
        for j in range(start, end):
            char_to_cluster[j] = ci
    return clusters, starts, char_to_cluster
