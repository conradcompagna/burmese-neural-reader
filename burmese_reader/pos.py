"""Burmese reader: pos."""

from __future__ import annotations

import re

from . import (
    fill as fill_service,
    lexicon as lexicon_service,
    normalization as normalization_service,
    ud as ud_service,
)
from .runtime import feature_state

POS_COLORS: dict = {}


POS_DISPLAY_LABELS: dict = {}


SPACY_UPOS_COLORS = {
    "ADJ": "#fde68a",
    "ADP": "#e0f2fe",
    "ADV": "#fee2e2",
    "AUX": "#e0e7ff",
    "CCONJ": "#cffafe",
    "DET": "#f1f5f9",
    "INTJ": "#fcd34d",
    "NOUN": "#bbf7d0",
    "NUM": "#f5d0fe",
    "PART": "#f4f4f5",
    "PRON": "#e2e8f0",
    "PROPN": "#c7d2fe",
    "PUNCT": "#e5e7eb",
    "SCONJ": "#bae6fd",
    "SYM": "#f3e8ff",
    "VERB": "#fda4af",
    "X": "#d1d5db",
}


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


def init_pos_tagger():
    """POS tagger disabled (phrase_chunker removed)."""
    return None


COARSE_POS_MAP: dict[str, str] = {
    "n": "N",
    "pron": "PRON",
    "v": "V",
    "adj": "ADJ",
    "adv": "ADV",
    "ppm": "POSTP",
    "conj": "CONJ",
    "part": "PART",
    "exp": "PART",
    "int": "PART",
    "kjano": "PART",
}


def _split_atomic_pos(raw_pos: str) -> list[str]:
    if not raw_pos:
        return []
    token = raw_pos
    for sep in [",", ";", "+", "/"]:
        token = token.replace(sep, " ")
    return [p for p in token.split() if p]


def _infer_coarse_pos_from_dict_entry(entry: dict) -> set[str]:
    """
    Given a single dictionary entry from DICT[head], return a set of coarse POS labels.
    """
    raw_pos = (entry.get("pos") or "").strip()
    if not raw_pos:
        return {"UNKNOWN"}
    coarse: set[str] = set()
    for part in _split_atomic_pos(raw_pos):
        label = COARSE_POS_MAP.get(part.lower())
        if label is None:
            coarse.add("UNKNOWN")
        else:
            coarse.add(label)
    return coarse or {"UNKNOWN"}


def _infer_coarse_pos_for_token(token: str, dict_obj: dict) -> set[str]:
    """
    Look up the token in DICT and infer a set of coarse POS labels.
    Falls back to simple heuristics when the token is unknown.
    """
    entry = dict_obj.get(normalization_service.normalize_headword(token))
    if not entry:
        # Very crude numeric detection for classifiers: treat bare digits as NUM
        if token.isdigit():
            return {"NUM"}
        return {"UNKNOWN"}
    # In the merged dictionary, each head maps to a single entry dict.
    return _infer_coarse_pos_from_dict_entry(entry)


def _iter_neighbor_indices(i: int, n_tokens: int, direction: str, max_distance: int):
    if direction in ("LEFT", "BOTH"):
        for offset in range(1, max_distance + 1):
            j = i - offset
            if j < 0:
                break
            yield j
    if direction in ("RIGHT", "BOTH"):
        for offset in range(1, max_distance + 1):
            j = i + offset
            if j >= n_tokens:
                break
            yield j


def build_pos_overlay_for_segments(segments: list[str]) -> dict:
    """
    Build POS overlay for a list of segmented tokens using the POS tagger.
    Input:
        segments - list of token strings in sentence order
    Output structure:
        {
            i: {
                "pos": str,              # best guess POS tag (myPOS format)
                "pos_label": str,        # display label (e.g., "Noun", "Verb")
                "pos_color": str,        # background color for UI
                "pos_probs": {           # all candidate probabilities
                    "n": 0.75,
                    "v": 0.25,
                    ...
                },
                "pos_source": str,       # "dict", "corpus", "guess", or "unknown"
                "pos_confidence": int,   # 0-100 confidence percentage
            },
            ...
        }
    The dict is keyed by token index (as string for JSON compatibility).
    """
    if not segments or state.POS_TAGGER is None:
        return {}
    # Build token list for tagger
    tokens = []
    for seg in segments:
        seg_norm = normalization_service.normalize_burmese(seg)
        # Get POS from dictionary if available
        dict_entry = lexicon_service.DICT.get(seg_norm, {})
        dict_pos = dict_entry.get("pos", "")
        tokens.append(
            {
                "word": seg,
                "pos": dict_pos,
            }
        )
    # Run POS tagger
    tagged = state.POS_TAGGER.tag_tokens(tokens, state.DICT_POS_LOOKUP)
    # Build overlay structure
    result = {}
    for i, t in enumerate(tagged):
        pos = t.get("pos")
        pos_probs = t.get("pos_probs", {})
        pos_source = t.get("pos_source", "unknown")
        if pos:
            # Calculate confidence as the probability of the best guess
            confidence = int(pos_probs.get(pos, 1.0) * 100)
            result[i] = {
                "coarse_pos": pos,
                "coarse_pos_label": POS_DISPLAY_LABELS.get(pos, pos.upper()),
                "coarse_pos_color": POS_COLORS.get(pos, "#f5f5f5"),
                "coarse_pos_probs": {k: round(v, 3) for k, v in pos_probs.items()},
                "coarse_pos_source": pos_source,
                "coarse_pos_confidence": confidence,
            }
        else:
            # No POS determined
            result[i] = {
                "coarse_pos": None,
                "coarse_pos_label": "?",
                "coarse_pos_color": "transparent",
                "coarse_pos_probs": {},
                "coarse_pos_source": "unknown",
                "coarse_pos_confidence": 0,
            }
    return result


def build_spacy_pos_overlay_for_segments(
    segments: list[str],
    dict_fills: list[dict | None] | None = None,
) -> dict:
    """
    Build a POS overlay using the spaCy UD parser model (UPOS/TAG).
    Returns the same shape as build_pos_overlay_for_segments.
    """
    parser = ud_service.init_ud_parser()
    if parser is None or not segments:
        return {}
    try:
        # For analysis only: filter junk tokens (e.g., stray combining marks) out of spaCy input,
        # while returning an overlay keyed by ORIGINAL segment indices for UI alignment.
        #
        # Also parse 1 sentence-span at a time (split on sentence terminators) so POS/parse
        # doesn't get skewed by long paragraph-scale contexts.
        SENT_END = {
            "\u104b",
            "\u0965",
            "?",
            "!",
            ".",
        }  # ။, ॥, and common ASCII fallbacks

        overlay: dict[int, dict] = {}

        def _process_span(start: int, end: int) -> None:
            kept_words: list[str] = []
            doc2seg: list[int] = []
            for si in range(start, end):
                tok = segments[si]
                if normalization_service._is_spacy_clean_token(tok):
                    doc2seg.append(si)
                    kept_words.append(tok)
            if not kept_words:
                return
            spaces = [True] * (len(kept_words) - 1) + [False]
            doc = parser._Doc(parser.nlp.vocab, words=kept_words, spaces=spaces)

            # Compute dictionary fills for each kept word and set them on tokens.
            # If dict_fills is provided, use it to match /lookup behavior.
            if dict_fills is not None:
                dict_fills_for_kept = [dict_fills[si] for si in doc2seg]
            else:
                dict_fills_for_kept = [
                    fill_service._fill_token_with_dict_for_ui(word)
                    for word in kept_words
                ]
            for tok, fill_data in zip(doc, dict_fills_for_kept):
                if fill_data is not None:
                    tok._.dict_fills = fill_data

            doc = parser.nlp(doc)
            for doc_i, t in enumerate(doc):
                seg_i = doc2seg[doc_i]
                # Some pipelines don't have a morphologizer, so Token.pos_ can be empty.
                # In those cases, Token.tag_ often holds UD-like coarse tags (NOUN/VERB/...).
                tag = t.tag_ or ""
                pos = t.pos_ or tag or ""
                dep = t.dep_ or ""  # Dependency relation (mark, case, nsubj, etc.)
                color = SPACY_UPOS_COLORS.get(pos, "#e5e7eb")
                overlay[seg_i] = {
                    # Coarse POS (NOUN, VERB, ADJ, etc.)
                    "upos": pos,
                    "upos_label": pos or "?",
                    "upos_color": color,
                    # Dependency relation (mark, case, nsubj, compound, etc.)
                    "dep": dep,
                    "dep_label": dep or "",
                    # Keep tag for fine-grained POS
                    "tag": tag,
                    # Fields for embedded reader POS overlay
                    "pos": pos,
                    "pos_label": pos or "?",
                    "pos_color": color,
                    "pos_confidence": 100,
                }

        start = 0
        for i, tok in enumerate(segments):
            if tok in SENT_END:
                _process_span(start, i + 1)
                start = i + 1
        if start < len(segments):
            _process_span(start, len(segments))

        return overlay
    except Exception as e:
        print("[WARN] spaCy POS overlay failed:", e)
        return {}


def build_spacy_pos_overlay_from_ud(ud_overlay: dict) -> dict:
    """
    Derive a spaCy POS overlay from an already-built UD overlay.
    This avoids running the spaCy pipeline twice per request.
    """
    if not ud_overlay or not ud_overlay.get("ok"):
        return {}
    overlay: dict[int, dict] = {}
    tokens = ud_overlay.get("tokens") or []
    for tok in tokens:
        upos = tok.get("upos") or ""
        dep = tok.get("dep") or ""
        tag = tok.get("tag") or ""
        color = SPACY_UPOS_COLORS.get(upos, "#e5e7eb")
        seg_span = tok.get("seg_span") or [tok.get("i")]
        for seg_i in seg_span:
            if seg_i is None or seg_i < 0:
                continue
            overlay[seg_i] = {
                "upos": upos,
                "upos_label": upos or "?",
                "upos_color": color,
                "dep": dep,
                "dep_label": dep or "",
                "tag": tag,
                "pos": upos,
                "pos_label": upos or "?",
                "pos_color": color,
                "pos_confidence": 100,
            }
    return overlay


def _new_state():
    from types import SimpleNamespace

    return SimpleNamespace(
        POS_TAGGER=None,
        DICT_POS_LOOKUP={},
    )


state = feature_state("pos", _new_state)
