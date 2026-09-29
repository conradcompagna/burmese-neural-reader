"""Burmese reader: fill."""

from __future__ import annotations
from . import pos as pos_service

from . import (
    dictionary_dp as dictionary_dp_service,
    graphemes as graphemes_service,
    lexicon as lexicon_service,
    normalization as normalization_service,
    pronunciation as pronunciation_service,
)


def _make_unknown_entry(w: str) -> dict:
    """
    Build a standard 'unknown' entry, including an inferred pronunciation
    (roman_inferred) when possible.
    """
    inferred = (
        pronunciation_service._infer_pronunciation(w)
        if normalization_service.contains_burmese(w)
        else ""
    )
    senses = ["[no dictionary entry found for this segment]"]
    if inferred:
        senses.append(f"[approximate pronunciation: {inferred}]")
    entry = {
        "head": w,
        # keep this empty so "real" dict roman stays visually distinct
        "roman": "",
        "pos": "unknown",
        "senses": senses,
    }
    if inferred:
        entry["roman_inferred"] = inferred
    return entry


def _split_unknown_into_subsegments(seg: str) -> list[dict]:
    """
    For an unknown Burmese segment `seg`, break it into subsegments using
    greedy left-to-right longest dictionary match over syllable-ish clusters.
    - Uses _build_clusters(seg) for syllable-ish units.
    - At each cluster position, takes the longest substring (up to
      _MAX_WORD_CLUSTERS clusters) that is in DICT.
    - If nothing starting at that position is in DICT, it emits a
      single-cluster shard as an unknown subsegment.
    - No dedup: repeated subsegments are kept, so the sequence of
      heads fully covers `seg` and can be phonetically reconstructed.
    """
    seg = normalization_service.normalize_burmese(seg)
    if not seg or not normalization_service.contains_burmese(seg):
        return []
    clusters, starts, _ = graphemes_service._build_clusters(seg)
    n = len(clusters)
    if n <= 1:
        # Single-syllable unknown; the top-level unknown entry is enough.
        return []
    # End character index for each cluster
    cluster_ends = [s + len(c) for s, c in zip(starts, clusters)]
    sub_entries: list[dict] = []
    i = 0
    while i < n:
        start_char = starts[i]
        max_j = min(n, i + dictionary_dp_service._MAX_WORD_CLUSTERS)
        best_piece = None
        best_piece_norm = None
        best_j = i + 1  # fallback: one cluster
        # Greedy longest-first search for a dictionary word starting at i
        for j in range(max_j, i, -1):
            end_char = cluster_ends[j - 1]
            piece = seg[start_char:end_char]
            piece_norm = normalization_service.normalize_headword(piece)
            if piece_norm in lexicon_service.DICT:
                best_piece = piece
                best_piece_norm = piece_norm
                best_j = j
                break
        if best_piece is not None and best_piece_norm is not None:
            entry = lexicon_service.DICT[best_piece_norm]
            sub_entries.append(
                {
                    "head": best_piece,
                    "roman": entry.get("roman", ""),
                    "pos": entry.get("pos", ""),
                    "senses": entry.get("senses", []),
                    "g2p": pronunciation_service.g2p_explain_for_ui(best_piece),
                }
            )
            i = best_j
        else:
            # No dictionary hit from this position: emit a 1-cluster shard
            end_char = cluster_ends[i]
            shard = seg[start_char:end_char]
            # Compute g2p romanization for unknown subsegments
            g2p_data = pronunciation_service.g2p_explain_for_ui(shard)
            roman = ""
            if g2p_data and g2p_data.get("syllables"):
                roman = " ".join(
                    s.get("roman", "") for s in g2p_data["syllables"] if s.get("roman")
                )
            sub_entries.append(
                {
                    "head": shard,
                    "roman": roman,
                    "pos": "unknown",
                    "senses": ["[no dictionary entry found for this subsegment]"],
                    "g2p": g2p_data,
                }
            )
            i += 1
    return sub_entries


def _decompose_known_head_into_subwords(head: str) -> list[dict]:
    """
    For a known dictionary head (e.g. 'မြန်မာ'), try to break it into
    smaller known subwords using the same cluster logic and a greedy
    longest-first search.
    - Uses _build_clusters(head), same as _split_unknown_into_subsegments.
    - Skips the trivial decomposition where the only piece is the whole head.
    - Returns a list of subentries {head, roman, pos, senses} in order.
      If we don't find at least two known subwords, returns [].
    """
    head = normalization_service.normalize_burmese(head)
    if not head or not normalization_service.contains_burmese(head):
        return []
    clusters, starts, _ = graphemes_service._build_clusters(head)
    n = len(clusters)
    if n <= 1:
        # Single-syllable head: nothing interesting to decompose.
        return []
    # End character index for each cluster
    cluster_ends = [s + len(c) for s, c in zip(starts, clusters)]
    sub_entries: list[dict] = []
    known_count = 0
    i = 0
    while i < n:
        start_char = starts[i]
        max_j = min(n, i + dictionary_dp_service._MAX_WORD_CLUSTERS)
        best_piece = None
        best_piece_norm = None
        best_j = i + 1  # fallback: one cluster
        # Greedy longest-first search for a dictionary word starting at i
        for j in range(max_j, i, -1):
            end_char = cluster_ends[j - 1]
            piece = head[start_char:end_char]
            # Don't use the *entire* head as a sub-piece (we already know it)
            if piece == head and i == 0 and j == n:
                continue
            piece_norm = normalization_service.normalize_headword(piece)
            if piece_norm in lexicon_service.DICT:
                best_piece = piece
                best_piece_norm = piece_norm
                best_j = j
                break
        if best_piece is not None and best_piece_norm is not None:
            entry = lexicon_service.DICT[best_piece_norm]
            sub_entries.append(
                {
                    "head": best_piece,
                    "roman": entry.get("roman", ""),
                    "pos": entry.get("pos", ""),
                    "senses": entry.get("senses", []),
                    "g2p": pronunciation_service.g2p_explain_for_ui(best_piece),
                }
            )
            known_count += 1
            i = best_j
        else:
            # No dictionary hit from this position: just emit a 1-cluster shard,
            # but mark it unknown. This lets you see "gap" pieces if needed.
            end_char = cluster_ends[i]
            shard = head[start_char:end_char]
            # Compute g2p romanization for unknown subsegments
            g2p_data = pronunciation_service.g2p_explain_for_ui(shard)
            roman = ""
            if g2p_data and g2p_data.get("syllables"):
                roman = " ".join(
                    s.get("roman", "") for s in g2p_data["syllables"] if s.get("roman")
                )
            sub_entries.append(
                {
                    "head": shard,
                    "roman": roman,
                    "pos": "unknown",
                    "senses": ["[no dictionary entry found for this subsegment]"],
                    "g2p": g2p_data,
                }
            )
            i += 1
    # If we didn't actually find at least 2 known subwords, don't show anything.
    if known_count < 2:
        return []
    return sub_entries


def _dict_entry_payload(head: str, entry: dict) -> dict:
    pos = entry.get("pos", "") or ""
    return {
        "head": head,
        "roman": entry.get("roman", ""),
        "pos": pos,
        "meta_pos": pos_service.get_meta_pos(pos),
        "senses": entry.get("senses", []),
        "source": entry.get("source", "DICT"),
        "g2p": pronunciation_service.g2p_explain_for_ui(head),
    }


def _unknown_subpart_payload(text: str) -> dict:
    g2p_data = (
        pronunciation_service.g2p_explain_for_ui(text)
        if normalization_service.contains_burmese(text)
        else None
    )
    return {
        "head": text,
        "roman": "",
        "pos": "unknown",
        "meta_pos": "unknown",
        "senses": ["[no dictionary entry found for this subpart]"],
        "source": "UNKNOWN_SUBPART",
        "g2p": g2p_data,
    }


def _fill_token_with_dict_for_ui(token: str) -> dict:
    """
    Cosmetic-only dictionary fill for a *single* token.
    Exact-match only: either one dictionary entry or unknown.
    """
    token = token or ""
    if not token:
        return {
            "mode": "unknown",
            "fills": [],
            "has_known": False,
            "has_unknown": False,
        }

    token_key = normalization_service.normalize_headword(token)
    if token_key and token_key in lexicon_service.DICT:
        entry = lexicon_service.DICT[token_key]
        return {
            "mode": "exact",
            "fills": [_dict_entry_payload(token, entry)],
            "has_known": True,
            "has_unknown": False,
        }

    return {
        "mode": "unknown",
        "fills": [_unknown_subpart_payload(token)],
        "has_known": False,
        "has_unknown": True,
    }
