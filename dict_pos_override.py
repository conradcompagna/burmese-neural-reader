# dict_pos_override.py
#
# A spaCy pipeline component that constrains morphologizer POS predictions
# based on dictionary-allowed candidates from mmd_head_pos.ud.jsonl.
#
# The component REQUIRES pre-assigned dictionary fills from newserver via the
# token._.dict_fills custom attribute. It does NOT perform its own greedy matching.
#
# Usage (config-based training):
#   python -m spacy train config.cfg --code dict_pos_override.py
# and add "dict_pos_override" after "morphologizer" in [nlp] pipeline.
#
# Usage (programmatic):
#   nlp.add_pipe("dict_pos_override", after="morphologizer")
#
# IMPORTANT: When using with newserver, set token._.dict_fills before processing:
#   for token, fill_data in zip(doc, fills_from_newserver):
#       token._.dict_fills = fill_data  # {"mode": "...", "fills": [...]}

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

import numpy as np
from spacy.language import Language
from spacy.tokens import Doc, Token

# Register custom token extensions
if not Token.has_extension("dict_fills"):
    Token.set_extension("dict_fills", default=None)
if not Token.has_extension("ner_locked"):
    Token.set_extension("ner_locked", default=False)

# Path to the UD-normalized dictionary POS lookup
DICT_POS_JSONL_PATH = Path(__file__).parent / "mmd_head_pos.ud.jsonl"

# Valid UD POS tags from the treebank
VALID_UPOS = {
    "ADJ",
    "ADP",
    "ADV",
    "AUX",
    "CCONJ",
    "DET",
    "INTJ",
    "NOUN",
    "NUM",
    "PART",
    "PRON",
    "PROPN",
    "PUNCT",
    "SCONJ",
    "SYM",
    "VERB",
    "X",
}

# POS equivalence groups for allowed-set expansion
POS_EQUIV_ALLOWED_GROUPS = [
    {"NOUN", "PROPN", "NUM"},
    {"SCONJ", "CCONJ"},
]

# POS equivalence groups for score expansion (keep POS distinct)
POS_EQUIV_SCORE_GROUPS: list[set[str]] = []

# POS aliases (normalized before equivalence logic)
POS_ALIASES = {
    "CONJ": "SCONJ",
}

# Don't touch punctuation/symbol outputs
_DONT_TOUCH = {"PUNCT", "SYM"}

# Certainty thresholds for dynamic weighting
# When max_prob >= HIGH_CERTAINTY_THRESHOLD, spaCy gets 100% weight
# When max_prob <= LOW_CERTAINTY_THRESHOLD, spaCy gets 50% weight (50/50 blend)
# In between, linear interpolation
HIGH_CERTAINTY_THRESHOLD = 0.85
LOW_CERTAINTY_THRESHOLD = 0.40


def _softmax(logits: np.ndarray) -> np.ndarray:
    """Convert logits to probabilities using softmax."""
    # Subtract max for numerical stability
    shifted = logits - np.max(logits)
    exp_scores = np.exp(shifted)
    return exp_scores / np.sum(exp_scores)


def _calculate_certainty(probs: np.ndarray) -> float:
    """
    Calculate certainty from probability distribution.
    Returns max probability as certainty measure (0-1).
    High max_prob = spaCy is confident in one prediction.
    Low max_prob = spaCy is uncertain/ambiguous.
    """
    return float(np.max(probs))


def _get_spacy_weight(certainty: float) -> float:
    """
    Calculate spaCy's weight based on certainty.
    - certainty >= HIGH_CERTAINTY_THRESHOLD: spaCy gets 100% weight
    - certainty <= LOW_CERTAINTY_THRESHOLD: spaCy gets 50% weight
    - In between: linear interpolation
    """
    if certainty >= HIGH_CERTAINTY_THRESHOLD:
        return 1.0
    elif certainty <= LOW_CERTAINTY_THRESHOLD:
        return 0.5
    else:
        # Linear interpolation between 0.5 and 1.0
        t = (certainty - LOW_CERTAINTY_THRESHOLD) / (
            HIGH_CERTAINTY_THRESHOLD - LOW_CERTAINTY_THRESHOLD
        )
        return 0.5 + 0.5 * t


def _normalize_pos_tag(tag: str) -> str:
    """Normalize a POS tag and apply alias mapping."""
    if not tag:
        return tag
    tag_up = tag.upper()
    return POS_ALIASES.get(tag_up, tag_up)


def _load_dict_pos_lookup(path: Path) -> Dict[str, List[str]]:
    """
    Load the mmd_head_pos.ud.jsonl file into a dict: headword -> list of UPOS.
    """
    lookup: Dict[str, List[str]] = {}
    if not path.exists():
        print(f"[dict_pos_override] Warning: {path} not found")
        return lookup

    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                head = entry.get("head", "")
                upos = entry.get("upos", [])
                if head and upos:
                    # Normalize to NFC if needed
                    import unicodedata

                    head = unicodedata.normalize("NFC", head)
                    lookup[head] = upos if isinstance(upos, list) else [upos]
            except json.JSONDecodeError:
                continue

    print(f"[dict_pos_override] Loaded {len(lookup)} headwords from {path}")
    return lookup


# Global lookup table (loaded once)
_DICT_POS_LOOKUP: Optional[Dict[str, List[str]]] = None


def _get_dict_pos_lookup() -> Dict[str, List[str]]:
    """Get or initialize the dictionary POS lookup."""
    global _DICT_POS_LOOKUP
    if _DICT_POS_LOOKUP is None:
        _DICT_POS_LOOKUP = _load_dict_pos_lookup(DICT_POS_JSONL_PATH)
    return _DICT_POS_LOOKUP


def _expand_to_allowed_set(upos_list: List[str]) -> Set[str]:
    """
    Normalize POS equivalences for allowed sets only.

    Rules:
    - NOUN/PROPN/NUM are interchangeable
    - SCONJ/CCONJ are interchangeable
    """
    allowed: Set[str] = set()
    for tag in upos_list:
        tag_norm = _normalize_pos_tag(tag)
        if not tag_norm:
            continue
        allowed.add(tag_norm)
        for group in POS_EQUIV_ALLOWED_GROUPS:
            if tag_norm in group:
                allowed.update(group)
                break
    return allowed


def _expand_equivalent_scores(scores: Dict[str, float]) -> Dict[str, float]:
    """
    Expand scores across POS equivalence groups without changing group maxima.

    This keeps scoring anchored to the POS tags that spaCy produced, but can
    optionally expand configured equivalence groups for blending/selection.

    If any tag in a group is present, all tags in that group get the group's max score.
    This ensures group members share the same max score when groups are configured.
    """
    if not scores:
        return {}
    expanded: Dict[str, float] = {}
    for pos, score in scores.items():
        pos_norm = _normalize_pos_tag(pos)
        if not pos_norm:
            continue
        if pos_norm in expanded:
            if score > expanded[pos_norm]:
                expanded[pos_norm] = score
        else:
            expanded[pos_norm] = score
    for group in POS_EQUIV_SCORE_GROUPS:
        # Get scores for tags present in this group
        present_scores = [expanded[pos] for pos in group if pos in expanded]
        if not present_scores:
            continue
        # Find max score in this group
        group_max = max(present_scores)
        # Assign max to ALL tags in this group (even if not originally present)
        for pos in group:
            expanded[pos] = group_max
    return expanded


def _label_to_pos(label: str) -> str:
    """
    Convert a morphologizer label to its POS.
    Common formats:
      - "POS=NOUN|Number=Sing"
      - "NOUN"
    """
    if label.startswith("POS="):
        pos = label.split("|", 1)[0][4:]
        return _normalize_pos_tag(pos)
    m = re.search(r"\bPOS=([A-Z]{2,6})\b", label)
    if m:
        return _normalize_pos_tag(m.group(1))
    # Check if the label itself is a valid POS tag
    if label in VALID_UPOS:
        return _normalize_pos_tag(label)
    return _normalize_pos_tag(label)


# Type aliases
Fill = Dict[str, Any]
DecomposeFunc = Callable[[str], List[Dict[str, Any]]]


def _default_decompose_func() -> Optional[DecomposeFunc]:
    """Try to import the decompose function from newserver."""
    try:
        from app import _decompose_known_head_into_subwords

        return _decompose_known_head_into_subwords
    except ImportError:
        return None


def _has_valid_pos(pos_field: str) -> bool:
    """Check if a POS field contains valid (non-empty, non-unknown) POS information."""
    if not pos_field:
        return False
    pos_lower = pos_field.lower().strip()
    return pos_lower not in {"", "unknown", "unk"}


def _normalize_text(text: str) -> str:
    """Normalize text to NFC for dictionary lookup."""
    import unicodedata

    return unicodedata.normalize("NFC", text)


def _extract_upos_from_pos_field(pos_field: str) -> Set[str]:
    """
    Parse a dictionary POS field and extract UD POS tags.
    The field may be raw myPOS format (noun, verb, etc.) that needs mapping,
    or already UD format (NOUN, VERB, etc.).
    """
    if not pos_field or pos_field.lower() == "unknown":
        return set()

    # myPOS -> UD mapping
    MYPOS_TO_UD = {
        "n": "NOUN",
        "noun": "NOUN",
        "v": "VERB",
        "verb": "VERB",
        "adj": "ADJ",
        "adjective": "ADJ",
        "adv": "ADV",
        "adverb": "ADV",
        "pron": "PRON",
        "pronoun": "PRON",
        "conj": "SCONJ",
        "conjunction": "SCONJ",
        "ppm": "ADP",
        "postposition": "ADP",
        "postp": "ADP",
        "part": "PART",
        "particle": "PART",
        "num": "NUM",
        "number": "NUM",
        "numeral": "NUM",
        "tn": "NOUN",  # classifier -> noun
        "fw": "X",  # foreign word
        "punc": "PUNCT",
        "punctuation": "PUNCT",
        "int": "INTJ",
        "interjection": "INTJ",
        "intj": "INTJ",
        "name": "PROPN",
        "prop": "PROPN",
        "det": "DET",
        "determiner": "DET",
        "aux": "AUX",
        "classifier": "NOUN",
        "prep": "ADP",
        "prefix": "PART",
        "symbol": "SYM",
        "character": "SYM",
        "phrase": "X",
        "proverb": "X",
        "exp": "X",
    }

    result: Set[str] = set()

    # Already UD format?
    pos_upper = _normalize_pos_tag(pos_field.strip().upper())
    if pos_upper in VALID_UPOS:
        result.add(pos_upper)
        return result

    # Try to extract UD tags directly (e.g., "NOUN|VERB")
    for tag in re.findall(r"\b[A-Z]{2,6}\b", pos_field):
        tag_norm = _normalize_pos_tag(tag)
        if tag_norm in VALID_UPOS:
            result.add(tag_norm)

    if result:
        return result

    # Parse as myPOS format (e.g., "n|v", "noun; verb")
    pos_lower = pos_field.lower()
    for delim in ["|", ";", ",", "/"]:
        if delim in pos_lower:
            parts = pos_lower.split(delim)
            for part in parts:
                part = part.strip()
                if part in MYPOS_TO_UD:
                    result.add(_normalize_pos_tag(MYPOS_TO_UD[part]))
            return result

    # Single tag
    if pos_lower in MYPOS_TO_UD:
        result.add(_normalize_pos_tag(MYPOS_TO_UD[pos_lower]))

    return result


def _collect_upos_from_fills(fills: List[Fill]) -> Tuple[Set[str], Counter]:
    """
    Collect allowed UPOS from dictionary fills - union of all possible tags.

    For each fill, use the POS that newserver selected (LM-informed),
    then augment with ALL possible POS variants from mmd_head_pos.ud.jsonl.
    This ensures we get all grammatical possibilities, not just the one
    that newserver's LM scoring ranked highest.

    For multiple fills (greedy decomposition), collect all POS tags from all subwords.
    Let spaCy's morphologizer choose based on context.

    Args:
        fills: List of dictionary fill entries (with POS already selected by newserver)

    Returns:
        (allowed_set, uniform_counts) where all counts are 1.0
    """
    all_pos: Set[str] = set()
    dict_lookup = _get_dict_pos_lookup()

    for fill in fills:
        head = fill.get("head", "")
        if not head:
            continue

        head_norm = _normalize_text(head)

        # Collect POS from mmd_head_pos.ud.jsonl (if present)
        if head_norm in dict_lookup:
            all_pos.update(dict_lookup[head_norm])

        # Also include POS from the fill itself (TSV), even if lookup exists.
        pos_field = fill.get("pos", "")
        if _has_valid_pos(pos_field):
            tags = _extract_upos_from_pos_field(pos_field)
            if tags:
                all_pos.update(tags)

    # Return uniform counts - no weighting
    counts: Counter = Counter()
    for pos in all_pos:
        counts[pos] = 1.0

    counts = Counter(_expand_equivalent_scores(dict(counts)))
    return all_pos, counts


def _collect_upos_from_fills_strict(fills: List[Fill]) -> Tuple[Optional[Set[str]], Counter]:
    """
    Collect allowed UPOS from dictionary fills - STRICT mode for compound tokens.

    For compound tokens (multiple fills), ALL fills must have determinable POS
    for hard constraints to apply. If ANY fill lacks POS info (unknown to
    dictionary or no valid POS like Pali entries), returns None to indicate
    no constraints should apply.

    Example: compound verb with fills [VERB, VERB/NOUN, VERB/ADJ]
        → returns {VERB, NOUN, ADJ} as hard constraint

    Example: compound with one Pali word (no POS)
        → returns None (no constraints, spaCy uses discretion)

    Args:
        fills: List of dictionary fill entries

    Returns:
        (None, Counter()) if ANY fill lacks valid POS info
        (allowed_set, counts) if ALL fills have valid POS
    """
    all_pos: Set[str] = set()
    dict_lookup = _get_dict_pos_lookup()

    for fill in fills:
        head = fill.get("head", "")
        if not head:
            # Empty head = unknown token, bail out
            return None, Counter()

        head_norm = _normalize_text(head)
        fill_pos: Set[str] = set()

        # Collect POS from mmd_head_pos.ud.jsonl (if present)
        if head_norm in dict_lookup:
            fill_pos.update(dict_lookup[head_norm])

        # Also include POS from the fill's TSV entry, even if lookup exists.
        pos_field = fill.get("pos", "")
        if _has_valid_pos(pos_field):
            tags = _extract_upos_from_pos_field(pos_field)
            if tags:
                fill_pos.update(tags)

        if not fill_pos:
            # This fill has no valid POS - can't apply hard constraints
            return None, Counter()

        all_pos.update(fill_pos)

    # All fills had valid POS - return union
    counts: Counter = Counter()
    for pos in all_pos:
        counts[pos] = 1.0
    counts = Counter(_expand_equivalent_scores(dict(counts)))
    return all_pos, counts


class DictPosOverride:
    """
    Postprocess POS using dictionary constraints + morphologizer candidate ranking.

    Simplified logic:
      - First check if token has pre-assigned dictionary fills in token._.dict_fills
        (set by newserver when processing tokens)
      - If fills have valid POS: collect union of all possible POS tags from all subwords
      - If fills have NO valid POS (e.g., Pali words): decompose into known subwords
        and collect union of their POS tags
      - If not pre-assigned, look up token in mmd_head_pos.ud.jsonl for allowed UPOS
      - NO FALLBACK: all dictionary fills must come from newserver pre-assignment
      - NO WEIGHTING: all POS tags get uniform weight (1.0), let spaCy's morphologizer
        choose based on context
      - Example: မင်းရဲသင်္ခ → [မင်း:NOUN|PROPN, ရဲ:NOUN|ADJ, သင်္ခ:NOUN]
        → allowed = {NOUN, PROPN, ADJ} → spaCy chooses PROPN based on context
      - Treat NOUN/PROPN/NUM as interchangeable for allowed-set expansion
      - Treat SCONJ/CCONJ as interchangeable for allowed-set expansion
    """

    def __init__(self, nlp: Language, decompose_func: Optional[DecomposeFunc] = None) -> None:
        self.nlp = nlp
        self.decompose_func = decompose_func
        self.dict_pos_lookup: Dict[str, List[str]] = {}
        self._labels: List[str] = []
        self._label_pos: List[str] = []
        self._tok2vec = None
        self._initialize()

    def _initialize(self) -> None:
        """Initialize after __init__."""
        # Load dictionary POS lookup
        self.dict_pos_lookup = _get_dict_pos_lookup()

        # Get decompose function from newserver if not provided
        if self.decompose_func is None:
            self.decompose_func = _default_decompose_func()

        # Get morphologizer labels for candidate ranking
        if "morphologizer" in self.nlp.pipe_names:
            morph = self.nlp.get_pipe("morphologizer")
            labels = getattr(morph, "labels", None)
            if labels is not None:
                self._labels = list(labels)
                self._label_pos = [_label_to_pos(lab) for lab in self._labels]
        if "tok2vec" in self.nlp.pipe_names:
            self._tok2vec = self.nlp.get_pipe("tok2vec")

        if not self._labels:
            print(
                "[dict_pos_override] Warning: morphologizer has no labels; will use simple override"
            )

    def _ensure_tok2vec(self, doc: Doc) -> None:
        """Ensure doc.tensor is populated for tok2vec-based morphologizer scoring."""
        if self._tok2vec is None:
            return
        try:
            if doc.tensor is None or doc.tensor.size == 0:
                self._tok2vec(doc)
        except Exception:
            # Fall back to morphologizer-only scoring if tok2vec fails.
            pass

    def __call__(self, doc: Doc) -> Doc:
        # If we have morphologizer labels, use score-based selection
        if self._labels and "morphologizer" in self.nlp.pipe_names:
            return self._process_with_scores(doc)
        else:
            return self._process_simple(doc)

    def debug_token(self, tok: Token) -> Dict[str, Any]:
        """
        Return detailed scoring/debug info for a token.
        Safe for use in debug endpoints.

        Returns:
        - subword_scores: Aggregated normalized scores from subword decomposition (only if decomposed)
        - original_scores: Raw morphologizer scores for the token
        - blended_scores: 50/50 blend of original and subword scores (only for decomposed tokens)
        - per_subword_scores: Individual morphologizer scores for each subword (if decomposed)
        """
        info: Dict[str, Any] = {
            "text": tok.text,
            "pos": tok.pos_,
            "is_punct": bool(tok.is_punct),
        }
        context_prev = tok.nbor(-1).text if tok.i > 0 else ""
        context_next = tok.nbor(1).text if (tok.i + 1) < len(tok.doc) else ""
        # Only show context when we actually use subword decomposition for scoring.
        info["subword_context"] = {}
        allowed, subword_scores, debug = self._get_allowed_for_token_debug(tok)
        info["allowed"] = sorted(allowed) if allowed else []
        info["source"] = debug.get("source", "")
        info["fills"] = debug.get("fills", [])
        info["subwords"] = debug.get("subwords", [])
        info["subwords_level2"] = debug.get("subwords_level2", [])
        info["subword_debug"] = []

        # Check if this token uses multi-component scoring (decomposed or multi-fill)
        is_decomposed = "decomposed" in info["source"]
        is_multi_fill = "multi_fill" in info["source"]
        is_multi_component = is_decomposed or is_multi_fill

        # Only include subword scores/context for multi-component tokens
        if is_multi_component:
            info["subword_scores"] = (
                {k: float(v) for k, v in subword_scores.items()} if subword_scores else {}
            )
            info["subword_context"] = {"prev": context_prev, "next": context_next}
        else:
            info["subword_scores"] = {}

        # Build per-subword debug scoring with individual morphologizer scores
        try:
            sub_list = info["subwords"] or []
            if not sub_list and info["fills"]:
                sub_list = info["fills"]

            if is_multi_component:
                # For multi-component tokens, get individual subword scores from morphologizer
                try:
                    if "morphologizer" in self.nlp.pipe_names and sub_list:
                        morph = self.nlp.get_pipe("morphologizer")
                        subword_heads = [
                            sw.get("head", "") for sw in sub_list if sw.get("head", "")
                        ]

                        if subword_heads:
                            # Create Doc with context tokens around subwords
                            ctx_words = []
                            offset = 0
                            if context_prev:
                                ctx_words.append(context_prev)
                                offset = 1
                            ctx_words.extend(subword_heads)
                            if context_next:
                                ctx_words.append(context_next)
                            spaces = [True] * (len(ctx_words) - 1) + [False] if ctx_words else []
                            subword_doc = Doc(self.nlp.vocab, words=ctx_words, spaces=spaces)
                            self._ensure_tok2vec(subword_doc)
                            subword_doc = morph(subword_doc)

                            # Get scores for subword sequence
                            subword_scores_list = morph.model.predict([subword_doc])
                            if subword_scores_list:
                                scores_array = np.asarray(subword_scores_list[0])

                                for token_idx, sw in enumerate(sub_list):
                                    score_idx = token_idx + offset
                                    if score_idx >= len(scores_array):
                                        break
                                    head = sw.get("head", "")
                                    if not head:
                                        continue

                                    head_norm = _normalize_text(head)

                                    # Get dictionary constraints for this subword
                                    tags: Set[str] = set()
                                    if head_norm in self.dict_pos_lookup:
                                        tags.update(self.dict_pos_lookup[head_norm])
                                    else:
                                        pos_field = sw.get("pos", "")
                                        if _has_valid_pos(pos_field):
                                            tags.update(_extract_upos_from_pos_field(pos_field))

                                    # Get morphologizer scores for this subword (sum-normalized)
                                    subword_pos_scores = {}
                                    scores_row = scores_array[score_idx]
                                    for label_idx in range(len(self._labels)):
                                        pos = (
                                            self._label_pos[label_idx]
                                            if label_idx < len(self._label_pos)
                                            else ""
                                        )
                                        if pos and (not tags or pos in tags):
                                            subword_pos_scores[pos] = float(scores_row[label_idx])

                                    if len(subword_pos_scores) == 1:
                                        only_pos = next(iter(subword_pos_scores.keys()))
                                        subword_pos_scores = {only_pos: 1.0}
                                    else:
                                        min_val = (
                                            min(subword_pos_scores.values())
                                            if subword_pos_scores
                                            else 0.0
                                        )
                                        if min_val < 0:
                                            for pos in list(subword_pos_scores.keys()):
                                                subword_pos_scores[pos] = (
                                                    subword_pos_scores[pos] - min_val
                                                )
                                        row_sum = sum(subword_pos_scores.values())
                                        if row_sum <= 0:
                                            row_sum = 1.0
                                        for pos in list(subword_pos_scores.keys()):
                                            subword_pos_scores[pos] = (
                                                subword_pos_scores[pos] / row_sum
                                            )

                                    info["subword_debug"].append(
                                        {
                                            "text": head,
                                            "allowed": sorted(_expand_to_allowed_set(list(tags)))
                                            if tags
                                            else [],
                                            "pos_scores": subword_pos_scores,  # Individual morphologizer scores
                                        }
                                    )
                except Exception:
                    pass

            # For single-component tokens, just show allowed POS without per-item breakdown
            if not is_multi_component:
                for sw in sub_list:
                    head = sw.get("head", "")
                    if not head:
                        continue
                    head_norm = _normalize_text(head)
                    tags: Set[str] = set()
                    if head_norm in self.dict_pos_lookup:
                        tags.update(self.dict_pos_lookup[head_norm])
                    else:
                        pos_field = sw.get("pos", "")
                        if _has_valid_pos(pos_field):
                            tags.update(_extract_upos_from_pos_field(pos_field))
                    info["subword_debug"].append(
                        {
                            "text": head,
                            "allowed": sorted(_expand_to_allowed_set(list(tags))) if tags else [],
                        }
                    )
        except Exception:
            pass

        # Get morphologizer scores for the original token
        info["spacy_raw_scaled"] = {}  # ALL spaCy scores scaled (max=1.0) - for debugging
        info["spacy_scaled_scores"] = {}  # Filtered to allowed POS (NO second scaling)
        info["blended_scores"] = {}
        info["constraint_type"] = "hard"  # Always hard constraints
        try:
            if "morphologizer" in self.nlp.pipe_names:
                morph = self.nlp.get_pipe("morphologizer")
                scores_list = morph.model.predict([tok.doc])
                if scores_list:
                    row = np.asarray(scores_list[0])[tok.i]

                    # STEP 1: Scale ALL spaCy raw logits by max (for initial scaling, NO softmax)
                    all_spacy_scores: Dict[str, float] = {}
                    for j in range(len(self._labels)):
                        pos = self._label_pos[j] if j < len(self._label_pos) else ""
                        if pos:
                            all_spacy_scores[pos] = all_spacy_scores.get(pos, 0.0) + float(row[j])

                    # Shift by min to handle negative logits (so all become >= 0)
                    if all_spacy_scores:
                        spacy_min = min(all_spacy_scores.values())
                        if spacy_min < 0:
                            all_spacy_scores = {
                                pos: score - spacy_min for pos, score in all_spacy_scores.items()
                            }

                    # Scale by max (ONCE, before filtering) - now guaranteed non-negative
                    spacy_max = max(all_spacy_scores.values()) if all_spacy_scores else 0.0
                    if spacy_max > 0:
                        all_spacy_scores = {
                            pos: score / spacy_max for pos, score in all_spacy_scores.items()
                        }

                    # Store for debugging (shows ALL POS with initial scaling)
                    info["spacy_raw_scaled"] = all_spacy_scores

                    # STEP 2: Filter to allowed POS (keep original scaled values, NO second scaling)
                    info["spacy_scaled_scores"] = {
                        pos: all_spacy_scores[pos] for pos in allowed if pos in all_spacy_scores
                    }

                    if is_multi_component:
                        # Multi-component: fixed 50/50 blend with subword scores
                        # Scale subword scores: max=1.0, others proportional
                        allowed_subword = {
                            pos: subword_scores.get(pos, 0.0) for pos in subword_scores
                        }
                        sub_max = max(allowed_subword.values()) if allowed_subword else 0.0
                        if sub_max > 0:
                            allowed_subword = {
                                pos: v / sub_max for pos, v in allowed_subword.items()
                            }

                        # Fixed 50/50 blend (NO normalization after blending)
                        for pos in allowed:
                            spacy_score = info["spacy_scaled_scores"].get(pos, 0.0)
                            sub_score = allowed_subword.get(pos, 0.0)
                            info["blended_scores"][pos] = 0.5 * spacy_score + 0.5 * sub_score
                    else:
                        # Single-component: blended scores = spaCy scaled scores (no subword blending)
                        info["blended_scores"] = dict(info["spacy_scaled_scores"])
        except Exception:
            pass

        return info

    def _log_debug(self, msg: str) -> None:
        """Debug logging - ENABLED for troubleshooting."""
        try:
            print(f"[dict_pos_override] {msg}")
        except UnicodeEncodeError:
            # Windows console can't handle Burmese, use ASCII repr
            print(f"[dict_pos_override] {msg.encode('ascii', 'replace').decode('ascii')}")

    def _process_with_scores(self, doc: Doc) -> Doc:
        """Process using morphologizer scores with dictionary constraints.

        For single-component tokens: Hard dictionary constraints apply.
            spaCy's morphologizer ranks candidates, dictionary filters to allowed set.
            Scores are scaled so max=1.0, others proportional.

        For multi-component (compound) tokens: Hard constraints + 50/50 blended scoring.
            - Must stay within allowed POS set (hard constraints)
            - Fixed 50/50 blend: spaCy scaled scores + subword scaled scores
            - Both scaled independently (max=1.0, others proportional)
            - No normalization after blending, just pick highest
        """
        self._log_debug(f"Processing doc with {len(doc)} tokens")
        morph = self.nlp.get_pipe("morphologizer")

        # Get model predictions (scores for each label) for the original doc
        try:
            scores_list = morph.model.predict([doc])
            if not scores_list:
                self._log_debug("No scores returned from morphologizer")
                return doc
            scores = np.asarray(scores_list[0])
        except Exception as e:
            self._log_debug(f"Score prediction failed: {e}, falling back to simple")
            return self._process_simple(doc)

        for i, tok in enumerate(doc):
            self._log_debug(f"Token[{i}] '{tok.text}': morph_pos={tok.pos_}")

            if tok.is_punct or tok.pos_ in _DONT_TOUCH:
                self._log_debug(f"  -> SKIP (punct or dont_touch)")
                continue

            allowed, pos_counts, debug_info = self._get_allowed_for_token_debug(tok)
            self._log_debug(f"  -> allowed={allowed}, counts={dict(pos_counts)}")

            current_pos = tok.pos_

            # Check if token needs blended scoring (multi-component)
            # - Decomposed tokens (Pali words with no POS broken into subwords)
            # - Multi-fill tokens (compounds where all fills have valid POS)
            # Both use 50/50 blend of original token score + subword scores
            source = debug_info.get("source", "")
            is_multi_component = "decomposed" in source or "multi_fill" in source

            # Get original token's morphologizer raw scores (logits)
            original_logits = scores[i]

            if is_multi_component:
                # MULTI-COMPONENT TOKEN: Hard constraints + fixed 50/50 blend with subword scores
                # Must stay within allowed POS set, but blend compound score with subword scores
                if not allowed:
                    self._log_debug(f"  -> SKIP (multi-component but no allowed POS)")
                    continue

                # If current POS is allowed, we still might change it based on blended scores
                self._log_debug(
                    f"  -> MULTI-COMPONENT: hard constraints + 50/50 blend, allowed={allowed}"
                )

                # STEP 1: Build ALL spaCy raw logit scores (NO softmax)
                all_spacy_scores: Dict[str, float] = {}
                for j in range(len(self._labels)):
                    pos = self._label_pos[j] if j < len(self._label_pos) else ""
                    if pos:
                        all_spacy_scores[pos] = all_spacy_scores.get(pos, 0.0) + float(
                            original_logits[j]
                        )

                # STEP 2: Shift by min to handle negative logits (so all become >= 0)
                if all_spacy_scores:
                    spacy_min = min(all_spacy_scores.values())
                    if spacy_min < 0:
                        all_spacy_scores = {
                            pos: score - spacy_min for pos, score in all_spacy_scores.items()
                        }

                # STEP 3: Scale ALL scores by max (ONCE, before filtering) - now guaranteed non-negative
                spacy_max = max(all_spacy_scores.values()) if all_spacy_scores else 0.0
                if spacy_max > 0:
                    all_spacy_scores = {
                        pos: score / spacy_max for pos, score in all_spacy_scores.items()
                    }
                all_spacy_scores = _expand_equivalent_scores(all_spacy_scores)

                # STEP 4: Filter to allowed POS (keep original scaled values, NO second scaling)
                spacy_pos_probs = {
                    pos: all_spacy_scores[pos] for pos in allowed if pos in all_spacy_scores
                }

                # Build subword scores (from subword aggregation)
                subword_scores: Dict[str, float] = {}
                if pos_counts:
                    subword_scores = dict(pos_counts)  # Copy all subword scores

                # Scale subword scores: max=1.0, others proportional
                subword_max = max(subword_scores.values()) if subword_scores else 0.0
                if subword_max > 0:
                    subword_scores = {
                        pos: score / subword_max for pos, score in subword_scores.items()
                    }
                subword_scores = _expand_equivalent_scores(subword_scores)

                # Fixed 50/50 blend (NO normalization after blending)
                blended_scores: Dict[str, float] = {}
                for pos in allowed:
                    spacy_score = spacy_pos_probs.get(pos, 0.0)
                    sub_score = subword_scores.get(pos, 0.0)
                    blended_scores[pos] = 0.5 * spacy_score + 0.5 * sub_score

                # Find best POS from blended scores (must be in allowed set)
                best_pos = None
                best_score = float("-inf")
                for pos, score in blended_scores.items():
                    if score > best_score:
                        best_score = score
                        best_pos = pos

                if best_pos is not None and best_pos != current_pos:
                    self._log_debug(
                        f"  -> CHANGED (multi): {current_pos} -> {best_pos} (score={best_score:.4f})"
                    )
                    tok.pos_ = best_pos
                else:
                    self._log_debug(f"  -> KEEP (multi-component, best={best_pos})")

            else:
                # SINGLE-COMPONENT TOKEN: Hard dictionary constraints
                # Must stay within allowed POS set from dictionary
                if not allowed:
                    self._log_debug(f"  -> SKIP (no allowed POS found in dict)")
                    continue

                # If current POS is already allowed, keep it
                if self._is_pos_allowed(current_pos, allowed):
                    self._log_debug(f"  -> KEEP (current {current_pos} is allowed)")
                    continue

                self._log_debug(f"  -> SINGLE-COMPONENT: using hard constraints, allowed={allowed}")

                # Find best allowed POS from morphologizer probabilities
                best_pos = None
                best_prob = float("-inf")

                for j in range(len(self._labels)):
                    pos = self._label_pos[j] if j < len(self._label_pos) else ""
                    if not pos or pos not in allowed:
                        continue

                    prob = float(original_logits[j])
                    if prob > best_prob:
                        best_prob = prob
                        best_pos = pos

                if best_pos is not None and best_pos != current_pos:
                    self._log_debug(
                        f"  -> CHANGED (single): {current_pos} -> {best_pos} (prob={best_prob:.4f})"
                    )
                    tok.pos_ = best_pos
                else:
                    self._log_debug(f"  -> KEEP (single component)")

        return doc

    def _process_simple(self, doc: Doc) -> Doc:
        """Simple processing without morphologizer scores."""
        for tok in doc:
            if tok.is_punct or tok.pos_ in _DONT_TOUCH:
                continue

            allowed, pos_counts = self._get_allowed_for_token(tok)
            if not allowed:
                continue

            current_pos = tok.pos_

            # If current POS is already allowed, keep it
            if self._is_pos_allowed(current_pos, allowed):
                continue

            # Pick the most frequent allowed POS from dictionary
            if pos_counts:
                # Sort by count, prefer the most frequent
                best_pos = pos_counts.most_common(1)[0][0]
                tok.pos_ = best_pos

        return doc

    def _is_pos_allowed(self, pos: str, allowed: Set[str]) -> bool:
        """Check if a POS is allowed (equivalences already applied to `allowed`)."""
        return pos in allowed

    def _get_allowed_for_token(self, tok: Token) -> Tuple[Set[str], Counter]:
        """
        Get allowed UPOS set and frequency counts for a token.

        Returns:
            (allowed_set, pos_counts)
        """
        allowed, counts, _ = self._get_allowed_for_token_debug(tok)
        return allowed, counts

    def _get_allowed_for_token_debug(self, tok: Token) -> Tuple[Set[str], Counter, Dict[str, Any]]:
        """
        Debuggable version of _get_allowed_for_token.
        Returns: (allowed_set, pos_counts, debug_info)
        """
        text = tok.text
        text_norm = _normalize_text(text)
        context_prev = tok.nbor(-1).text if tok.i > 0 else ""
        context_next = tok.nbor(1).text if (tok.i + 1) < len(tok.doc) else ""
        debug: Dict[str, Any] = {
            "source": "none",
            "fills": [],
            "subwords": [],
            "subwords_level2": [],
        }

        # Skip if token is NER-locked (already has fixed POS from NER)
        if tok.has_extension("ner_locked") and tok._.ner_locked:
            debug["source"] = "ner_locked"
            return set(), Counter(), debug

        # 1. Check if token has pre-assigned dictionary fills from newserver
        # These are stored in the custom attribute _.dict_fills
        if tok.has_extension("dict_fills") and tok._.dict_fills is not None:
            fills = tok._.dict_fills.get("fills", [])
            if fills:
                mode = tok._.dict_fills.get("mode", "")
                debug["source"] = f"pre-assigned:{mode or 'unknown'}"
                debug["fills"] = [
                    {
                        "head": f.get("head", ""),
                        "pos": f.get("pos", ""),
                        "source": f.get("source", ""),
                    }
                    for f in fills
                ]

                # Check if any fill has valid POS
                has_any_valid_pos = any(_has_valid_pos(f.get("pos", "")) for f in fills)
                has_unknown = bool(tok._.dict_fills.get("has_unknown"))

                self._log_debug(
                    f"Token '{text}': fills={len(fills)}, has_any_valid_pos={has_any_valid_pos}, has_unknown={has_unknown}, mode={mode}"
                )

                if has_unknown:
                    # Any unknown piece -> no constraints, no subword scoring.
                    self._log_debug(f"Token '{text}': has unknown pieces, no constraints")
                    debug["source"] = f"pre-assigned:{mode or 'unknown'}:has_unknown"
                    debug["subwords"] = [
                        {"head": f.get("head", ""), "pos": f.get("pos", "")} for f in fills
                    ]
                    return set(), Counter(), debug

                if has_any_valid_pos:
                    # For MULTIPLE fills, use STRICT mode: all must have valid POS
                    # If all have POS: use 50/50 blended scoring (soft constraints)
                    # If any lacks POS: no constraints (spaCy uses discretion)
                    if len(fills) > 1:
                        # First check if ALL fills have valid POS
                        allowed_strict, _ = _collect_upos_from_fills_strict(fills)
                        if allowed_strict is None:
                            # At least one fill has no valid POS - no constraints
                            self._log_debug(
                                f"Token '{text}': multi-fill but some lack POS, no constraints"
                            )
                            debug["source"] = f"pre-assigned:{mode or 'unknown'}:partial_pos"
                            debug["subwords"] = [
                                {"head": f.get("head", ""), "pos": f.get("pos", "")} for f in fills
                            ]
                            return set(), Counter(), debug
                        # All fills have valid POS - use subword scoring for 50/50 blend
                        self._log_debug(f"Token '{text}': multi-fill with subword scoring")
                        allowed, counts = self._aggregate_subword_pos(
                            fills,
                            prev_text=context_prev,
                            next_text=context_next,
                        )
                        if allowed:
                            debug["source"] = f"pre-assigned:{mode or 'unknown'}:multi_fill"
                            debug["subwords"] = [
                                {"head": f.get("head", ""), "pos": f.get("pos", "")} for f in fills
                            ]
                            return _expand_to_allowed_set(list(allowed)), counts, debug
                    else:
                        # Single fill: just collect allowed POS (uniform weights, spaCy decides)
                        allowed, counts = _collect_upos_from_fills(fills)
                        if allowed:
                            return _expand_to_allowed_set(list(allowed)), counts, debug
                else:
                    # No valid POS in any fill (e.g., Pali word with no POS).
                    # Do not constrain or subword-score; keep spaCy's original prediction.
                    self._log_debug(f"Token '{text}' has no valid POS, no constraints")
                    debug["source"] = "pre-assigned:no_pos"
                    return set(), Counter(), debug

        # 2. No constraints found - no fallback dictionary lookup or greedy matching
        # All dictionary fills must be pre-assigned by newserver via token._.dict_fills
        return set(), Counter(), debug

    def _aggregate_subword_pos(
        self,
        sub_entries: List[Dict],
        prev_text: str = "",
        next_text: str = "",
    ) -> Tuple[Set[str], Counter]:
        """
        Aggregate POS from subword decomposition using spaCy morphologizer scores.

        Algorithm:
        1. Extract all subword heads from sub_entries
        2. Create a Doc with all subwords in sequence
        3. Run morphologizer on the full sequence (subwords see each other in context)
        4. Aggregate POS scores across all subwords
        5. Filter by dictionary constraints
        6. Blend with original token's morphologizer scores (50/50 weight)

        Example: မင်းရဲသင်္ခ decomposes to [မင်း, ရဲ, သင်္ခ]
        - Run spaCy on "မင်း ရဲ သင်္ခ" (subwords in context)
        - Aggregate their scores
        - Compare to spaCy's score on original "မင်းရဲသင်္ခ"
        - Blend: 50% from decomposition + 50% from original
        """
        if not "morphologizer" in self.nlp.pipe_names:
            # Fallback: use dictionary lookup if morphologizer not available
            return self._aggregate_subword_pos_fallback(sub_entries)

        try:
            from spacy.tokens import Doc  # type: ignore

            morph = self.nlp.get_pipe("morphologizer")

            # Extract subword heads and get dictionary constraints for each
            subword_heads = []
            subword_constraints = []  # List of constraint sets, one per subword

            for entry in sub_entries:
                head = entry.get("head", "")
                if not head:
                    continue

                head_norm = _normalize_text(head)
                subword_heads.append(head)

                # Get dictionary constraints for this subword
                dict_constraints = set()
                if head_norm in self.dict_pos_lookup:
                    dict_constraints.update(self.dict_pos_lookup[head_norm])

                # Also include POS from the entry itself (TSV), even if lookup exists.
                pos_field = entry.get("pos", "")
                if _has_valid_pos(pos_field):
                    tags = _extract_upos_from_pos_field(pos_field)
                    if tags:
                        dict_constraints.update(tags)

                # Expand constraints to include equivalent POS (SCONJ<->CCONJ, NOUN<->PROPN<->NUM)
                if dict_constraints:
                    dict_constraints = _expand_to_allowed_set(list(dict_constraints))

                if not dict_constraints:
                    # No constraints found, try recursive decomposition
                    if self.decompose_func is not None:
                        try:
                            sub_entries_2 = self.decompose_func(head)
                            if sub_entries_2:
                                # Recursively aggregate - for now treat as any POS
                                _, sub_counts = self._aggregate_subword_pos(sub_entries_2)
                                dict_constraints = set(sub_counts.keys())
                        except Exception:
                            pass

                subword_constraints.append(dict_constraints)

            if not subword_heads:
                return self._aggregate_subword_pos_fallback(sub_entries)

            # Create Doc with context tokens around the subwords
            ctx_words = []
            offset = 0
            if prev_text:
                ctx_words.append(prev_text)
                offset = 1
            ctx_words.extend(subword_heads)
            if next_text:
                ctx_words.append(next_text)
            spaces = [True] * (len(ctx_words) - 1) + [False] if ctx_words else []
            subword_doc = Doc(self.nlp.vocab, words=ctx_words, spaces=spaces)
            self._ensure_tok2vec(subword_doc)
            subword_doc = morph(subword_doc)

            # Get morphologizer scores for the subword sequence
            subword_scores_list = morph.model.predict([subword_doc])
            subword_pos_scores: Counter = Counter()

            if subword_scores_list and len(subword_scores_list) > 0:
                scores_array = np.asarray(subword_scores_list[0])  # [num_tokens, num_labels]

                # Track scores for summing
                pos_score_sums: Dict[str, float] = {}
                start_idx = offset
                end_idx = min(offset + len(subword_constraints), len(scores_array))
                num_subwords = max(0, end_idx - start_idx)

                for token_idx in range(start_idx, end_idx):
                    scores_row = scores_array[token_idx]
                    constraints = subword_constraints[token_idx - start_idx]
                    per_pos: Dict[str, float] = {}
                    for label_idx in range(len(self._labels)):
                        pos = self._label_pos[label_idx] if label_idx < len(self._label_pos) else ""
                        if (
                            not constraints or pos in constraints
                        ):  # Allow if no constraints or if constrained POS
                            per_pos[pos] = per_pos.get(pos, 0.0) + float(scores_row[label_idx])

                    # Expand any configured score equivalences BEFORE normalizing.
                    if per_pos:
                        per_pos = _expand_equivalent_scores(per_pos)

                    # If only one possible POS, give it full weight.
                    if len(per_pos) == 1:
                        only_pos = next(iter(per_pos.keys()))
                        per_pos = {only_pos: 1.0}
                    else:
                        # Normalize per-subword scores so each subword contributes equally (sum-to-1).
                        # Shift by min to avoid negative-only sums from logits.
                        min_val = min(per_pos.values()) if per_pos else 0.0
                        if min_val < 0:
                            for pos in list(per_pos.keys()):
                                per_pos[pos] = per_pos[pos] - min_val
                        row_sum = sum(per_pos.values())
                        if row_sum <= 0:
                            row_sum = 1.0
                        for pos, score in per_pos.items():
                            per_pos[pos] = score / row_sum

                    # Accumulate normalized per-subword scores
                    for pos, score in per_pos.items():
                        pos_score_sums[pos] = pos_score_sums.get(pos, 0.0) + score

                # Divide by total number of subwords
                for pos in pos_score_sums:
                    if num_subwords > 0:
                        subword_pos_scores[pos] = pos_score_sums[pos] / num_subwords

                # NOW normalize to max=1 across POS (match original-score normalization)
                if subword_pos_scores:
                    max_subword_score = max(subword_pos_scores.values())
                    if max_subword_score > 0:
                        subword_pos_scores = Counter(
                            {
                                pos: score / max_subword_score
                                for pos, score in subword_pos_scores.items()
                            }
                        )
                if subword_pos_scores:
                    subword_pos_scores = Counter(
                        _expand_equivalent_scores(dict(subword_pos_scores))
                    )

            # For now, just return the subword scores
            # (The original token score blending happens in the caller)
            final_pos = set(subword_pos_scores.keys())
            return _expand_to_allowed_set(list(final_pos)), subword_pos_scores

        except Exception as e:
            # Fallback on error
            self._log_debug(f"Morphologizer scoring failed: {e}")
            return self._aggregate_subword_pos_fallback(sub_entries)

    def _aggregate_subword_pos_fallback(self, sub_entries: List[Dict]) -> Tuple[Set[str], Counter]:
        """Fallback aggregation using dictionary lookup only (no morphologizer scoring)."""
        all_pos: Set[str] = set()

        def _add_entry(entry: Dict, depth: int) -> None:
            head = entry.get("head", "")
            if not head:
                return

            head_norm = _normalize_text(head)
            pos_field = entry.get("pos", "")

            added = False
            # Check UD lookup first
            if head_norm in self.dict_pos_lookup:
                all_pos.update(self.dict_pos_lookup[head_norm])
                added = True
            elif _has_valid_pos(pos_field):
                # Parse POS field (only if it has valid POS)
                tags = _extract_upos_from_pos_field(pos_field)
                if tags:
                    all_pos.update(tags)
                    added = True

            # If no valid POS info and we haven't recursed yet, try one more subword pass
            if not added and depth == 0 and self.decompose_func is not None:
                try:
                    sub_entries_2 = self.decompose_func(head)
                except Exception:
                    sub_entries_2 = []
                for sub in sub_entries_2 or []:
                    _add_entry(sub, depth + 1)

        for entry in sub_entries:
            _add_entry(entry, 0)

        # Return uniform counts
        uniform_counts: Counter = Counter()
        for pos in all_pos:
            uniform_counts[pos] = 1.0
        uniform_counts = Counter(_expand_equivalent_scores(dict(uniform_counts)))
        # Return allowed set from the counts (plus allowed-set equivalences).
        return _expand_to_allowed_set(list(uniform_counts.keys())), uniform_counts


@Language.factory("dict_pos_override")
def make_dict_pos_override(nlp, name):
    """Factory function for spaCy pipeline registration."""
    return DictPosOverride(nlp=nlp)


# Convenience function for standalone use
def create_dict_pos_override(nlp: Language) -> DictPosOverride:
    """Create a DictPosOverride instance for manual use."""
    return DictPosOverride(nlp=nlp)


def set_dict_fills_on_doc(doc: Doc, fills_list: List[Dict[str, Any]]) -> None:
    """
    Set dictionary fills from newserver on a spaCy Doc.

    Args:
        doc: spaCy Doc with tokens
        fills_list: List of fill dictionaries from newserver's _fill_token_with_dict_for_ui
                   or _fill_island_tokens_with_dict_lm, one per token.
                   Each should have format: {"mode": "...", "fills": [...], ...}

    Example:
        from newserver import _fill_token_with_dict_for_ui
        doc = nlp("မြန်မာ")
        fills = [_fill_token_with_dict_for_ui(tok.text) for tok in doc]
        set_dict_fills_on_doc(doc, fills)
    """
    if len(fills_list) != len(doc):
        raise ValueError(
            f"fills_list length ({len(fills_list)}) must match doc length ({len(doc)})"
        )

    for token, fill_data in zip(doc, fills_list):
        token._.dict_fills = fill_data


if __name__ == "__main__":
    # Quick test
    lookup = _get_dict_pos_lookup()
    print(f"Loaded {len(lookup)} entries")

    # Show some examples
    test_words = ["က", "ကစား", "ကတည်းက", "ကတင်"]
    for word in test_words:
        if word in lookup:
            print(f"  {word}: {lookup[word]}")
