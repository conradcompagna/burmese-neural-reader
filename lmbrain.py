"""
lmbrain.py

Language-model 'brain' for the Burmese hover dictionary.

This module:
  - loads word-level unigram & bigram LMs
  - loads phrase-level unigram & bigram LMs
  - builds a phrase inventory from unigram-phrase.txt, mapping
    token sequences -> phrase keys
  - exposes an AdvancedSegmenter class that:
        * delegates segmentation to a base dp_segmenter
        * provides LM scoring helpers that app.py can call
          from inside its segmentation pipeline
        * exposes a spell-check / fuzzy-match engine powered by the LMs
        * exposes phrase detection over segmented word tokens

It does NOT:
  - normalize Burmese
  - build clusters
  - run its own DP segmentation

All orthographic / segmentation logic stays in app.py.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple

import math
import ast


# ============================================================================
# LEVENSHTEIN (EDIT DISTANCE) HELPER
# ============================================================================


def levenshtein_distance(a: str, b: str) -> int:
    """
    Standard dynamic-programming Levenshtein distance:
    insertion, deletion, substitution = cost 1.
    """
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if la == 0:
        return lb
    if lb == 0:
        return la

    # ensure a is the shorter
    if la > lb:
        a, b = b, a
        la, lb = lb, la

    prev_row = list(range(lb + 1))
    curr_row = [0] * (lb + 1)

    for i in range(1, la + 1):
        curr_row[0] = i
        ca = a[i - 1]
        for j in range(1, lb + 1):
            cb = b[j - 1]
            cost_sub = 0 if ca == cb else 1
            curr_row[j] = min(
                prev_row[j] + 1,  # deletion
                curr_row[j - 1] + 1,  # insertion
                prev_row[j - 1] + cost_sub,  # substitution
            )
        prev_row, curr_row = curr_row, prev_row

    return prev_row[lb]


# ============================================================================
# BK-TREE FOR EFFICIENT FUZZY MATCHING
# ============================================================================


@dataclass
class BKNode:
    """Node in a BK-tree."""

    term: str
    children: Dict[int, "BKNode"] = field(default_factory=dict)


class BKTree:
    """
    BK-tree (Burkhard-Keller tree) for efficient metric-space search.

    Instead of scanning the entire vocabulary for fuzzy matches, the BK-tree
    uses the triangle inequality property of edit distance to prune the search
    space, drastically reducing the number of distance calculations needed.
    """

    def __init__(self, distance_fn: Callable[[str, str], int]) -> None:
        """
        Initialize a BK-tree with a distance function.

        Args:
            distance_fn: A metric distance function (e.g., levenshtein_distance)
        """
        self.distance_fn = distance_fn
        self.root: Optional[BKNode] = None
        self.size = 0

    def add(self, term: str) -> None:
        """
        Add a term to the BK-tree.

        Args:
            term: The string to add
        """
        if not term:
            return

        if self.root is None:
            self.root = BKNode(term)
            self.size = 1
            return

        node = self.root
        while True:
            d = self.distance_fn(term, node.term)
            if d == 0:
                # Term already exists, don't add duplicates
                return
            child = node.children.get(d)
            if child is None:
                node.children[d] = BKNode(term)
                self.size += 1
                return
            node = child

    def build(self, terms: Iterable[str]) -> None:
        """
        Build the BK-tree from an iterable of terms.

        Args:
            terms: Iterable of strings to add to the tree
        """
        for t in terms:
            self.add(t)

    def query(self, term: str, max_dist: int) -> List[Tuple[str, int]]:
        """
        Find all terms within a given distance from the query term.

        Uses the triangle inequality to prune the search space:
        If d(query, node) = d, then any child at distance k can only
        contain terms within distance of the query in range [d-max_dist, d+max_dist].

        Args:
            term: The query term
            max_dist: Maximum edit distance to search

        Returns:
            List of (term, distance) tuples for all matches within max_dist
        """
        if self.root is None or not term:
            return []

        out: List[Tuple[str, int]] = []
        stack = [self.root]

        while stack:
            node = stack.pop()
            d = self.distance_fn(term, node.term)

            if d <= max_dist:
                out.append((node.term, d))

            # Triangle inequality: only explore children in valid range
            lo = d - max_dist
            hi = d + max_dist
            for edge_dist, child in node.children.items():
                if lo <= edge_dist <= hi:
                    stack.append(child)

        return out


# ============================================================================
# WORD-LEVEL UNIGRAM LM
# ============================================================================

UNIGRAM_COUNTS: dict[str, int] = {}
UNIGRAM_TOTAL: int = 0
UNIGRAM_COST: dict[str, float] = {}

UNIGRAM_ALPHA: float = 1.0  # Laplace smoothing
UNIGRAM_DEFAULT_COST: float = 12.0  # fallback cost for unseen words


def load_unigram_lm(path: str | Path) -> None:
    """
    Load a word-level unigram frequency file and precompute negative log
    probabilities as costs.

    Expected format per line:
        <word>\t<count>

    If the tab is missing, we fall back to splitting on the last whitespace.
    """
    global UNIGRAM_COUNTS, UNIGRAM_TOTAL, UNIGRAM_COST, UNIGRAM_DEFAULT_COST

    UNIGRAM_COUNTS = {}
    UNIGRAM_COST = {}
    UNIGRAM_TOTAL = 0

    p = str(path)

    with open(p, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            parts = line.split("\t")
            if len(parts) == 2:
                head, count_str = parts
            else:
                # Be forgiving: "<word> <count>"
                try:
                    head, count_str = line.rsplit(maxsplit=1)
                except ValueError:
                    continue

            head = head.replace("\ufeff", "").strip()
            if not head:
                continue

            try:
                count = int(count_str)
            except ValueError:
                continue

            UNIGRAM_COUNTS[head] = UNIGRAM_COUNTS.get(head, 0) + count
            UNIGRAM_TOTAL += count

    # Nothing loaded → keep a neutral-ish default
    if not UNIGRAM_COUNTS:
        UNIGRAM_DEFAULT_COST = 12.0
        return

    V = len(UNIGRAM_COUNTS)
    alpha = UNIGRAM_ALPHA
    denom = UNIGRAM_TOTAL + alpha * V

    # Precompute cost for each word: -log P(w)
    for w, c in UNIGRAM_COUNTS.items():
        p_w = (c + alpha) / denom
        UNIGRAM_COST[w] = -math.log(p_w)

    # Default cost for unseen words: treat as very rare
    p0 = alpha / denom
    UNIGRAM_DEFAULT_COST = -math.log(p0)
    # Drop raw counts to save memory (runtime only needs costs).
    UNIGRAM_COUNTS.clear()


def get_unigram_cost(word: str) -> float:
    """
    Return a non-negative cost for `word`:
      - frequent words   -> smaller cost
      - rare words       -> larger cost
      - unseen words     -> UNIGRAM_DEFAULT_COST

    If the LM hasn't been loaded yet, returns 0.0 (neutral).
    """
    if not UNIGRAM_COST:
        # LM not loaded (or failed): treat as neutral
        return 0.0
    return UNIGRAM_COST.get(word, UNIGRAM_DEFAULT_COST)


# ============================================================================
# WORD-LEVEL BIGRAM LM
# ============================================================================

BIGRAM_COUNTS: dict[tuple[str, str], int] = {}
BIGRAM_LEFT_TOTAL: dict[str, int] = {}
BIGRAM_COST: dict[tuple[str, str], float] = {}

BIGRAM_LEFT_DEFAULT_COST: dict[str, float] = {}
BIGRAM_GLOBAL_DEFAULT_COST: float = 10.0

BIGRAM_ALPHA: float = 0.1  # smoothing
BIGRAM_BACKOFF_WEIGHT: float = 0.5  # how strongly to mix in unigram backoff


def load_bigram_lm(path: str | Path) -> None:
    """
    Load a word-level bigram frequency file and precompute negative log
    conditional probabilities as costs.

    Expected format per line (like your sample):
        "('word1', 'word2')\tCOUNT"

    We use ast.literal_eval on the tuple part, so it's robust to Burmese
    punctuation etc.
    """
    global BIGRAM_COUNTS, BIGRAM_LEFT_TOTAL
    global BIGRAM_COST, BIGRAM_LEFT_DEFAULT_COST, BIGRAM_GLOBAL_DEFAULT_COST

    BIGRAM_COUNTS.clear()
    BIGRAM_LEFT_TOTAL.clear()
    BIGRAM_COST.clear()
    BIGRAM_LEFT_DEFAULT_COST.clear()

    p = str(path)

    with open(p, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            # Split tuple and count on the last tab
            try:
                pair_str, count_str = line.rsplit("\t", 1)
            except ValueError:
                continue

            pair_str = pair_str.strip()
            count_str = count_str.strip()

            try:
                # e.g. "('မ', 'ဟုတ်')"
                w1, w2 = ast.literal_eval(pair_str)
            except Exception:
                continue

            w1 = w1.replace("\ufeff", "").strip()
            w2 = w2.replace("\ufeff", "").strip()
            if not w1 or not w2:
                continue

            try:
                c = int(count_str)
            except ValueError:
                continue

            key = (w1, w2)
            BIGRAM_COUNTS[key] = BIGRAM_COUNTS.get(key, 0) + c

    if not BIGRAM_COUNTS:
        BIGRAM_GLOBAL_DEFAULT_COST = 10.0
        return

    # Totals for each left word
    for (w1, w2), c in BIGRAM_COUNTS.items():
        BIGRAM_LEFT_TOTAL[w1] = BIGRAM_LEFT_TOTAL.get(w1, 0) + c

    # Vocabulary size for the right side
    right_vocab = {w2 for (_, w2) in BIGRAM_COUNTS.keys()}
    V = max(len(right_vocab), 1)
    alpha = BIGRAM_ALPHA

    # Per-left default costs (unseen right word after a given left word)
    for w1, total_left in BIGRAM_LEFT_TOTAL.items():
        denom = total_left + alpha * V
        p0 = alpha / denom
        BIGRAM_LEFT_DEFAULT_COST[w1] = -math.log(p0)

    # Costs for seen bigrams
    for (w1, w2), c in BIGRAM_COUNTS.items():
        total_left = BIGRAM_LEFT_TOTAL[w1]
        denom = total_left + alpha * V
        p = (c + alpha) / denom
        BIGRAM_COST[(w1, w2)] = -math.log(p)

    # Global default for completely unseen left words
    if BIGRAM_LEFT_DEFAULT_COST:
        BIGRAM_GLOBAL_DEFAULT_COST = sum(BIGRAM_LEFT_DEFAULT_COST.values()) / len(
            BIGRAM_LEFT_DEFAULT_COST
        )
    else:
        BIGRAM_GLOBAL_DEFAULT_COST = 10.0
    # Drop raw counts to save memory (runtime only needs costs).
    BIGRAM_COUNTS.clear()
    BIGRAM_LEFT_TOTAL.clear()


def get_bigram_cost(w1: str, w2: str) -> float:
    """
    Return a cost for the transition w1 -> w2:

      - If (w1, w2) seen:      cost = -log P(w2 | w1)
      - If unseen but w1 seen: cost ≈ unseen_after_w1 + backoff_to_unigram(w2)
      - If w1 never seen:      cost ≈ BIGRAM_GLOBAL_DEFAULT_COST + backoff_to_unigram(w2)

    Requires get_unigram_cost() for informative backoff; if that LM
    isn't loaded we treat unigram backoff as 0.
    """
    if not BIGRAM_COST:
        # Bigram LM not loaded: fall back to unigram only
        return get_unigram_cost(w2)

    key = (w1, w2)
    if key in BIGRAM_COST:
        return BIGRAM_COST[key]

    left_default = BIGRAM_LEFT_DEFAULT_COST.get(w1, BIGRAM_GLOBAL_DEFAULT_COST)
    uni = get_unigram_cost(w2)
    return left_default + BIGRAM_BACKOFF_WEIGHT * uni


# ============================================================================
# PHRASE-LEVEL UNIGRAM LM + INVENTORY
# ============================================================================

PHRASE_UNIGRAM_COUNTS: dict[str, int] = {}
PHRASE_UNIGRAM_TOTAL: int = 0
PHRASE_UNIGRAM_COST: dict[str, float] = {}

PHRASE_UNIGRAM_ALPHA: float = 1.0
PHRASE_UNIGRAM_DEFAULT_COST: float = 12.0

# Phrase inventory built from unigram-phrase.txt:
#   "အရမ်း_ချစ်" -> tokens ("အရမ်း", "ချစ်")
PHRASE_BY_TOKENS: dict[tuple[str, ...], str] = {}
PHRASE_TOKEN_COUNTS: dict[tuple[str, ...], int] = {}
PHRASE_MAX_TOKENS: int = 1


def load_phrase_unigram_lm(
    path: str | Path,
    *,
    min_count: int = 1,
    max_tokens: int | None = None,
) -> None:
    """
    Load a phrase unigram frequency file and precompute negative log
    probabilities as costs.

    Expected format per line (like your sample):
        "phrase\\tCOUNT"

    where 'phrase' can be:
        "ရင်", "အရမ်း_ချစ်", "မော်လမြိုင်_မြို့", etc.

    In addition to the LM, this also builds a phrase inventory:

      PHRASE_BY_TOKENS[(w1, w2, ...)] = "w1_w2_..."
      PHRASE_TOKEN_COUNTS[(w1, w2, ...)] = count

    only for multi-word phrases (len(tokens) >= 2), with count >= min_count,
    and optionally len(tokens) <= max_tokens.
    """
    global PHRASE_UNIGRAM_COUNTS, PHRASE_UNIGRAM_TOTAL
    global PHRASE_UNIGRAM_COST, PHRASE_UNIGRAM_DEFAULT_COST
    global PHRASE_BY_TOKENS, PHRASE_TOKEN_COUNTS, PHRASE_MAX_TOKENS

    PHRASE_UNIGRAM_COUNTS = {}
    PHRASE_UNIGRAM_COST = {}
    PHRASE_UNIGRAM_TOTAL = 0

    PHRASE_BY_TOKENS = {}
    PHRASE_TOKEN_COUNTS = {}
    PHRASE_MAX_TOKENS = 1

    p = str(path)

    with open(p, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            parts = line.split("\t")
            if len(parts) == 2:
                phrase, count_str = parts
            else:
                try:
                    phrase, count_str = line.rsplit(maxsplit=1)
                except ValueError:
                    continue

            phrase = phrase.replace("\ufeff", "").strip()
            if not phrase:
                continue

            try:
                count = int(count_str)
            except ValueError:
                continue

            # --- LM counts ---
            PHRASE_UNIGRAM_COUNTS[phrase] = PHRASE_UNIGRAM_COUNTS.get(phrase, 0) + count
            PHRASE_UNIGRAM_TOTAL += count

            # --- Phrase inventory for multiword phrases ---
            tokens = phrase.split("_")
            if len(tokens) >= 2 and count >= min_count:
                if max_tokens is None or len(tokens) <= max_tokens:
                    tup = tuple(tokens)
                    prev = PHRASE_TOKEN_COUNTS.get(tup)
                    # Keep the highest-count phrase mapping for a given token tuple
                    if prev is None or count > prev:
                        PHRASE_TOKEN_COUNTS[tup] = count
                        PHRASE_BY_TOKENS[tup] = phrase

    # Update max phrase length for detection
    if PHRASE_TOKEN_COUNTS:
        PHRASE_MAX_TOKENS = max(len(t) for t in PHRASE_TOKEN_COUNTS.keys())
    else:
        PHRASE_MAX_TOKENS = 1

    if not PHRASE_UNIGRAM_COUNTS:
        PHRASE_UNIGRAM_DEFAULT_COST = 12.0
        return

    V = len(PHRASE_UNIGRAM_COUNTS)
    alpha = PHRASE_UNIGRAM_ALPHA
    denom = PHRASE_UNIGRAM_TOTAL + alpha * V

    for phrase, c in PHRASE_UNIGRAM_COUNTS.items():
        p_ph = (c + alpha) / denom
        PHRASE_UNIGRAM_COST[phrase] = -math.log(p_ph)

    p0 = alpha / denom
    PHRASE_UNIGRAM_DEFAULT_COST = -math.log(p0)
    # Drop raw counts to save memory (runtime only needs costs).
    PHRASE_UNIGRAM_COUNTS.clear()


def get_phrase_unigram_cost(phrase: str) -> float:
    """
    Return a non-negative cost for `phrase`:
      - frequent phrases   -> smaller cost
      - rare phrases       -> larger cost
      - unseen phrases     -> PHRASE_UNIGRAM_DEFAULT_COST

    If the phrase LM hasn't been loaded, returns 0.0 (neutral).
    """
    if not PHRASE_UNIGRAM_COST:
        return 0.0
    return PHRASE_UNIGRAM_COST.get(phrase, PHRASE_UNIGRAM_DEFAULT_COST)


# ============================================================================
# PHRASE-LEVEL BIGRAM LM
# ============================================================================

PHRASE_BIGRAM_COUNTS: dict[tuple[str, str], int] = {}
PHRASE_BIGRAM_LEFT_TOTAL: dict[str, int] = {}
PHRASE_BIGRAM_COST: dict[tuple[str, str], float] = {}

PHRASE_BIGRAM_LEFT_DEFAULT_COST: dict[str, float] = {}
PHRASE_BIGRAM_GLOBAL_DEFAULT_COST: float = 10.0

PHRASE_BIGRAM_ALPHA: float = 0.1
PHRASE_BIGRAM_BACKOFF_WEIGHT: float = 0.5


def load_phrase_bigram_lm(path: str | Path) -> None:
    """
    Load a phrase bigram frequency file and precompute negative log
    conditional probabilities as costs.

    Expected format per line (like your sample):
        "('phrase1', 'phrase2')\\tCOUNT"

    where phrase1/phrase2 look like "အရမ်း_ချစ်", "ရင်", etc.
    """
    global PHRASE_BIGRAM_COUNTS, PHRASE_BIGRAM_LEFT_TOTAL
    global PHRASE_BIGRAM_COST, PHRASE_BIGRAM_LEFT_DEFAULT_COST
    global PHRASE_BIGRAM_GLOBAL_DEFAULT_COST

    PHRASE_BIGRAM_COUNTS.clear()
    PHRASE_BIGRAM_LEFT_TOTAL.clear()
    PHRASE_BIGRAM_COST.clear()
    PHRASE_BIGRAM_LEFT_DEFAULT_COST.clear()

    p = str(path)

    with open(p, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            try:
                pair_str, count_str = line.rsplit("\t", 1)
            except ValueError:
                continue

            pair_str = pair_str.strip()
            count_str = count_str.strip()

            try:
                # e.g. "('အရမ်း_ချစ်', 'တယ်')"
                p1, p2 = ast.literal_eval(pair_str)
            except Exception:
                continue

            p1 = p1.replace("\ufeff", "").strip()
            p2 = p2.replace("\ufeff", "").strip()
            if not p1 or not p2:
                continue

            try:
                c = int(count_str)
            except ValueError:
                continue

            key = (p1, p2)
            PHRASE_BIGRAM_COUNTS[key] = PHRASE_BIGRAM_COUNTS.get(key, 0) + c

    if not PHRASE_BIGRAM_COUNTS:
        PHRASE_BIGRAM_GLOBAL_DEFAULT_COST = 10.0
        return

    # Totals for each left phrase
    for (p1, p2), c in PHRASE_BIGRAM_COUNTS.items():
        PHRASE_BIGRAM_LEFT_TOTAL[p1] = PHRASE_BIGRAM_LEFT_TOTAL.get(p1, 0) + c

    right_vocab = {p2 for (_, p2) in PHRASE_BIGRAM_COUNTS.keys()}
    V = max(len(right_vocab), 1)
    alpha = PHRASE_BIGRAM_ALPHA

    # Per-left default costs
    for p1, total_left in PHRASE_BIGRAM_LEFT_TOTAL.items():
        denom = total_left + alpha * V
        p0 = alpha / denom
        PHRASE_BIGRAM_LEFT_DEFAULT_COST[p1] = -math.log(p0)

    # Costs for seen phrase bigrams
    for (p1, p2), c in PHRASE_BIGRAM_COUNTS.items():
        total_left = PHRASE_BIGRAM_LEFT_TOTAL[p1]
        denom = total_left + alpha * V
        p = (c + alpha) / denom
        PHRASE_BIGRAM_COST[(p1, p2)] = -math.log(p)

    # Global default for unseen left phrases
    if PHRASE_BIGRAM_LEFT_DEFAULT_COST:
        PHRASE_BIGRAM_GLOBAL_DEFAULT_COST = sum(PHRASE_BIGRAM_LEFT_DEFAULT_COST.values()) / len(
            PHRASE_BIGRAM_LEFT_DEFAULT_COST
        )
    else:
        PHRASE_BIGRAM_GLOBAL_DEFAULT_COST = 10.0
    # Drop raw counts to save memory (runtime only needs costs).
    PHRASE_BIGRAM_COUNTS.clear()
    PHRASE_BIGRAM_LEFT_TOTAL.clear()


def get_phrase_bigram_cost(p1: str, p2: str) -> float:
    """
    Return a cost for transition phrase1 -> phrase2:

      - If (p1, p2) seen: cost = -log P(p2 | p1)
      - If unseen but p1 seen: unseen_after_p1 + backoff_to_phrase_unigram(p2)
      - If p1 never seen:      PHRASE_BIGRAM_GLOBAL_DEFAULT_COST + backoff_to_phrase_unigram(p2)

    If phrase unigram LM is not loaded, unigram backoff is treated as 0.
    """
    # Bigram LM not loaded: fall back to phrase unigram only
    if not PHRASE_BIGRAM_COST:
        return get_phrase_unigram_cost(p2) if PHRASE_UNIGRAM_COST else 0.0

    key = (p1, p2)
    if key in PHRASE_BIGRAM_COST:
        return PHRASE_BIGRAM_COST[key]

    left_default = PHRASE_BIGRAM_LEFT_DEFAULT_COST.get(p1, PHRASE_BIGRAM_GLOBAL_DEFAULT_COST)

    if PHRASE_UNIGRAM_COST:
        uni = get_phrase_unigram_cost(p2)
    else:
        uni = 0.0

    return left_default + PHRASE_BIGRAM_BACKOFF_WEIGHT * uni


# ----------------------------------------------------------------------
# Myanmar consonant utilities for onset-based spell indexing
# ----------------------------------------------------------------------

MYANMAR_CONSONANTS: set[str] = set("ကခဂဃငစဆဇဈဉဋဌဍဎဏတထဒဓနပဖဗဘမယရလဝသဟဠအ")

# Also treat independent vowels as valid onsets for spell checking
MYANMAR_CONSONANTS.update("ဣဤဥဦဧဩဪ")


def first_myanmar_consonant(s: str) -> Optional[str]:
    """
    Return the first Myanmar consonant character in `s`, or None if
    none is found.

    We use this as a cheap 'onset key' for bucketing spell candidates,
    instead of scanning the full vocabulary every time.
    """
    for ch in s:
        if ch in MYANMAR_CONSONANTS:
            return ch
    return None


def _is_myanmar_token(token: str) -> bool:
    """
    Return True if the token consists solely of Myanmar codepoints
    (core + extended) with no punctuation/Latin.
    """
    if not token:
        return False
    for ch in token:
        cp = ord(ch)
        if not (0x1000 <= cp <= 0x109F or 0xAA60 <= cp <= 0xAA7F or 0xA9E0 <= cp <= 0xA9FF):
            return False
    return True


# ============================================================================
# CONFIG + WRAPPER CLASS
# ============================================================================


@dataclass
class LMConfig:
    """
    Configuration for the LM brain.

    Paths are optional. If a path is None, that LM is simply not loaded.
    The lambdas control how strongly each LM contributes to total cost.
    """

    word_unigram_path: Optional[Path] = None
    word_bigram_path: Optional[Path] = None
    phrase_unigram_path: Optional[Path] = None
    phrase_bigram_path: Optional[Path] = None

    # Word-level weights
    lambda_unigram: float = 0.05
    lambda_bigram: float = 0.10
    enable_word_unigram: bool = True
    enable_word_bigram: bool = True

    # Phrase-level weights
    lambda_phrase_unigram: float = 0.02
    lambda_phrase_bigram: float = 0.04
    enable_phrase_unigram: bool = True
    enable_phrase_bigram: bool = True

    # Phrase inventory parameters (for unigram-phrase.txt)
    phrase_min_count: int = 2  # ignore super-rare phrases
    phrase_max_tokens: int | None = 4  # cap phrase length for inventory
    enable_phrase_inventory: bool = True

    # Spell-check / fuzzy-match parameters
    spell_max_edit_distance: int = 3  # max Levenshtein distance (tight for OCR)
    spell_max_candidates: int = 5  # how many to return in the final list
    spell_edit_weight: float = 1.0  # weight of edit distance in total cost
    spell_lm_weight: float = 0.3  # downweight LM inside the spell checker
    spell_min_similarity: float = 0.0  # optional floor on edit similarity
    spell_stage1_pool_size: int = 50  # top-N by morphology before LM rerank

    # Unused in the new global search, kept for compatibility
    spell_max_bucket_size: int = 0  # 0 = no cap


@dataclass
class SpellCandidate:
    candidate: str
    edit_distance: int
    edit_similarity: float
    lm_cost: float
    total_cost: float
    probability: float  # normalized 0–1

    def to_dict(self) -> dict:
        return {
            "candidate": self.candidate,
            "edit_distance": self.edit_distance,
            "edit_similarity": self.edit_similarity,
            "lm_cost": self.lm_cost,
            "total_cost": self.total_cost,
            "probability": self.probability,
            "prob_percent": self.probability * 100.0,
        }


class AdvancedSegmenter:
    """
    LM-only 'advanced' segmenter.

    Responsibilities:
      - load word/phrase LMs according to LMConfig
      - optionally delegate segmentation to a base dp_segmenter
      - expose LM scoring helpers for app.py to call from its DP
      - provide a spell-check / fuzzy-match engine using edit distance
        plus the same LMs
      - provide phrase detection over segmented tokens using the
        phrase inventory built from unigram-phrase.txt

    It does NOT implement its own segmentation pipeline.
    """

    def __init__(
        self,
        dict_obj: dict[str, dict] | None = None,
        dp_segmenter=None,
        myword_root: Optional[Path] = None,
        config: Optional[LMConfig] = None,
    ) -> None:
        # Keep dict_obj & myword_root for interface compatibility, even
        # if we don't currently use them inside the LM brain.
        self.dict = dict_obj or {}
        self.dp_segmenter = dp_segmenter
        self.myword_root = myword_root
        self.config = config or LMConfig()

        # Load LMs according to config
        if self.config.word_unigram_path is not None:
            load_unigram_lm(self.config.word_unigram_path)
        if self.config.word_bigram_path is not None:
            load_bigram_lm(self.config.word_bigram_path)
        if self.config.phrase_unigram_path is not None:
            load_phrase_unigram_lm(
                self.config.phrase_unigram_path,
                min_count=self.config.phrase_min_count,
                max_tokens=self.config.phrase_max_tokens,
            )
        if self.config.phrase_bigram_path is not None:
            load_phrase_bigram_lm(self.config.phrase_bigram_path)

        # Build vocabulary used by spell checker (dict keys + LM vocab)
        self._build_spell_vocab()

        # Cache for spell-checking: map (word, max_edit_distance, min_similarity)
        # -> list of (candidate, edit_distance, edit_similarity)
        self._spell_morph_cache: dict[tuple[str, int, float], list[tuple[str, int, float]]] = {}

    # ------------------------------------------------------------------
    # 1) Compatibility shim: delegate segmentation to base DP
    # ------------------------------------------------------------------

    def segment(self, text: str) -> list[str]:
        """
        Compatibility method so newserver can keep calling
        ADVANCED_SEGMENTER.segment(q) for now.

        In this LM-only design, we simply delegate to the injected
        dp_segmenter (which lives in app.py).

        Later, you can remove this shim and call dp_segmenter directly
        once you've threaded LM scoring into the DP itself.
        """
        if self.dp_segmenter is None:
            return [text] if text else []
        return self.dp_segmenter(text)

    # ------------------------------------------------------------------
    # INTERNAL: spell vocab
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # INTERNAL: spell vocab
    # ------------------------------------------------------------------

    def _build_spell_vocab(self) -> None:
        """
        Dictionary-driven spell vocabulary.
        - Only dictionary keys are used.
        - Filter out non-Myanmar tokens.
        - Build a BK-tree for fuzzy matching.
        """
        vocab: set[str] = set()

        # From dictionary only
        for w in self.dict or {}:
            if w and not w.isspace() and _is_myanmar_token(w):
                vocab.add(w)

        # Build BK-tree for efficient fuzzy matching
        self._bk_tree = BKTree(levenshtein_distance)
        self._bk_tree.build(vocab)
        # Keep only a lightweight size marker (no parallel lists/sets retained)
        self._spell_vocab_size = len(vocab)

    # ------------------------------------------------------------------
    # 2) Word-level LM scoring
    # ------------------------------------------------------------------

    def score_word(self, word: str, prev_word: Optional[str] = None) -> float:
        """
        LM cost contribution for a single word, optionally conditioned
        on the previous word.

          total_cost = λ_uni * cost_uni(word)
                      + λ_big * cost_big(prev_word, word)
        """
        cfg = self.config
        cost = 0.0

        if cfg.enable_word_unigram and cfg.lambda_unigram:
            cost += cfg.lambda_unigram * get_unigram_cost(word)

        if prev_word and cfg.enable_word_bigram and cfg.lambda_bigram:
            cost += cfg.lambda_bigram * get_bigram_cost(prev_word, word)

        return cost

    def sequence_lm_cost(self, tokens: Sequence[str]) -> float:
        """
        Convenience: LM cost for a full token sequence using the
        word-level models.

        This is mainly for debugging / rescoring; the DP integration
        will usually call score_word() inside its transitions.
        """
        total = 0.0
        prev: Optional[str] = None
        for w in tokens:
            total += self.score_word(w, prev)
            prev = w
        return total

    # ------------------------------------------------------------------
    # 3) Phrase-level helpers & detection
    # ------------------------------------------------------------------

    @staticmethod
    def phrase_from_tokens(tokens: Sequence[str]) -> str:
        """
        Join a sequence of tokens into a phrase key, e.g.:

            ["အရမ်း", "ချစ်"] -> "အရမ်း_ချစ်"
        """
        return "_".join(tokens)

    def score_phrase(
        self,
        phrase_tokens: Sequence[str],
        prev_phrase: Optional[str] = None,
    ) -> float:
        """
        LM cost contribution for a single phrase (tokens joined with "_"),
        optionally conditioned on the previous phrase key.

          total_cost = λ_puni * cost_puni(phrase)
                      + λ_pbig * cost_pbig(prev_phrase, phrase)
        """
        cfg = self.config
        phrase = self.phrase_from_tokens(phrase_tokens)
        cost = 0.0

        if cfg.enable_phrase_unigram and cfg.lambda_phrase_unigram:
            cost += cfg.lambda_phrase_unigram * get_phrase_unigram_cost(phrase)

        if prev_phrase and cfg.enable_phrase_bigram and cfg.lambda_phrase_bigram:
            cost += cfg.lambda_phrase_bigram * get_phrase_bigram_cost(prev_phrase, phrase)

        return cost

    def phrase_sequence_lm_cost(
        self,
        phrase_sequence: Sequence[Sequence[str]],
    ) -> float:
        """
        Cost for a sequence of phrases, where each phrase is a list of
        tokens. Example:

            [["မော်လမြိုင်", "မြို့"],
             ["ကို"],
             ["လာလည်"]]

        This computes LM cost over the phrase keys
        "မော်လမြိုင်_မြို့" -> "ကို" -> "လာလည်".
        """
        cfg = self.config
        total = 0.0
        prev_phrase_key: Optional[str] = None

        for phrase_tokens in phrase_sequence:
            phrase_key = self.phrase_from_tokens(phrase_tokens)

            if cfg.enable_phrase_unigram and cfg.lambda_phrase_unigram:
                total += cfg.lambda_phrase_unigram * get_phrase_unigram_cost(phrase_key)

            if (
                prev_phrase_key is not None
                and cfg.enable_phrase_bigram
                and cfg.lambda_phrase_bigram
            ):
                total += cfg.lambda_phrase_bigram * get_phrase_bigram_cost(
                    prev_phrase_key, phrase_key
                )

            prev_phrase_key = phrase_key

        return total

    def detect_phrases(self, tokens: Sequence[str]) -> list[dict]:
        """
        Greedy longest-match phrase detector over word tokens using the
        phrase inventory built from unigram-phrase.txt.

        tokens: e.g. ["အရမ်း", "ချစ်", "တယ်", "မော်လမြိုင်", "မြို့", "ကို", "လာလည်"]

        Returns a list of dicts like:
            {
              "phrase": "အရမ်း_ချစ်",
              "span": (0, 2),          # [start, end) in token indices
              "tokens": ["အရမ်း", "ချစ်"],
              "count": 4648,
              "unigram_cost": 1.23,
            }

        This is meant as a phrase *overlay* for the UI – it does not
        affect base segmentation itself.
        """
        cfg = self.config
        if not cfg.enable_phrase_inventory:
            return []
        if not PHRASE_BY_TOKENS:
            return []

        n = len(tokens)
        if n == 0:
            return []

        result: list[dict] = []
        i = 0
        max_len = PHRASE_MAX_TOKENS

        while i < n:
            best_match: tuple[str, ...] | None = None
            best_len = 0

            # Don't go past end, only consider multiword phrases
            limit = min(max_len, n - i)
            for L in range(limit, 1, -1):
                tup = tuple(tokens[i : i + L])
                if tup in PHRASE_BY_TOKENS:
                    best_match = tup
                    best_len = L
                    break

            if best_match is None:
                i += 1
                continue

            phrase_key = PHRASE_BY_TOKENS[best_match]
            count = PHRASE_TOKEN_COUNTS.get(best_match, 0)
            unigram_cost = get_phrase_unigram_cost(phrase_key) if PHRASE_UNIGRAM_COST else 0.0

            result.append(
                {
                    "phrase": phrase_key,
                    "span": (i, i + best_len),
                    "tokens": list(best_match),
                    "count": count,
                    "unigram_cost": unigram_cost,
                }
            )

            i += best_len

        return result

    # ------------------------------------------------------------------
    # 4) Spell checker / fuzzy matcher
    # ------------------------------------------------------------------

    def suggest_spellings(
        self,
        word: str,
        prev_word: Optional[str] = None,
        next_word: Optional[str] = None,
        max_candidates: Optional[int] = None,
        max_edit_distance: Optional[int] = None,
    ) -> list[SpellCandidate]:
        cfg = self.config

        # Use config defaults if caller didn’t specify overrides
        if max_candidates is None:
            max_candidates = cfg.spell_max_candidates
        if max_edit_distance is None:
            max_edit_distance = cfg.spell_max_edit_distance

        word = (word or "").strip()
        if not word:
            return []

        # BK-tree is the sole candidate structure
        bk = getattr(self, "_bk_tree", None)
        if bk is None:
            return []

        # Ensure cache exists
        morph_cache = getattr(self, "_spell_morph_cache", None)
        if morph_cache is None:
            self._spell_morph_cache = {}
            morph_cache = self._spell_morph_cache

        # Cache key: morphology depends only on the misspelt form + basic config
        cache_key = (word, max_edit_distance, cfg.spell_min_similarity)
        stage1_candidates = morph_cache.get(cache_key)

        len_word = len(word)

        # ---------------- STAGE 1: morphology-first filtering ----------------
        if stage1_candidates is None:
            stage1_candidates: list[tuple[str, int, float]] = []

            # Use BK-tree query - much faster!
            bk_hits = bk.query(word, max_edit_distance)  # [(cand, d)]

            for cand, d in bk_hits:
                # Skip exact matches (not a correction)
                if d == 0:
                    continue

                len_cand = len(cand)
                max_len = max(len_word, len_cand)
                if max_len == 0:
                    continue

                edit_sim = 1.0 - (d / max_len)
                if edit_sim < cfg.spell_min_similarity:
                    continue

                # (candidate, edit_distance, edit_similarity)
                stage1_candidates.append((cand, d, edit_sim))

            if not stage1_candidates:
                morph_cache[cache_key] = []
                return []

            # Sort purely by morphology:
            #   1) smallest edit distance
            #   2) highest similarity
            #   3) highest unigram frequency (if available)
            def _morph_sort_key(triple: tuple[str, int, float]) -> tuple[int, float]:
                cand, d, edit_sim = triple
                # Pure morphology: edit distance first, then similarity.
                return (d, -edit_sim)

            stage1_candidates.sort(key=_morph_sort_key)

            pool_size = getattr(cfg, "spell_stage1_pool_size", 10) or 10
            if pool_size > 0 and len(stage1_candidates) > pool_size:
                stage1_candidates = stage1_candidates[:pool_size]

            morph_cache[cache_key] = stage1_candidates

        if not stage1_candidates:
            return []

        candidates: list[SpellCandidate] = []

        # ---------------- STAGE 2: LM + edit distance reranking on small pool ---------------
        for cand, d, edit_sim in stage1_candidates:
            # Pure bigram score (no unigram): split across available sides
            lm_prev = (
                get_bigram_cost(prev_word, cand) if (cfg.enable_word_bigram and prev_word) else None
            )
            lm_next = (
                get_bigram_cost(cand, next_word) if (cfg.enable_word_bigram and next_word) else None
            )

            if lm_prev is None and lm_next is None:
                # No context available: fall back to unigram if enabled
                lm_score = get_unigram_cost(cand) if cfg.enable_word_unigram else 0.0
            elif lm_prev is not None and lm_next is not None:
                lm_score = 0.5 * lm_prev + 0.5 * lm_next
            else:
                # Only one side available: give full weight to that side
                side = lm_prev if lm_prev is not None else lm_next
                lm_score = side

            # Final cost: 50% edit distance, 50% bigram score
            total_cost = 0.5 * d + 0.5 * lm_score

            candidates.append(
                SpellCandidate(
                    candidate=cand,
                    edit_distance=d,
                    edit_similarity=edit_sim,
                    lm_cost=lm_score,
                    total_cost=total_cost,
                    probability=0.0,
                )
            )

        if not candidates:
            return []

        # Sort by LM cost; tie-break by edit distance, then similarity
        candidates.sort(key=lambda c: (c.total_cost, c.edit_distance, -c.edit_similarity))
        candidates = candidates[:max_candidates]

        # Softmax normalization over negative total costs
        min_cost = candidates[0].total_cost
        weights: list[float] = []
        for c in candidates:
            w = math.exp(-(c.total_cost - min_cost))
            weights.append(w)

        Z = sum(weights) or 1.0
        for c, w in zip(candidates, weights):
            c.probability = w / Z

        return candidates

    def suggest_spellings_dict(
        self,
        word: str,
        prev_word: Optional[str] = None,
        next_word: Optional[str] = None,
        max_candidates: Optional[int] = None,
        max_edit_distance: Optional[int] = None,
    ) -> list[dict]:
        """
        Convenience wrapper that returns plain dicts, ready to be
        serialized into JSON as `fuzzy_matches`.
        """
        return [
            c.to_dict()
            for c in self.suggest_spellings(
                word,
                prev_word=prev_word,
                next_word=next_word,
                max_candidates=max_candidates,
                max_edit_distance=max_edit_distance,
            )
        ]

    def suggest_spellings_distance_first(
        self,
        word: str,
        max_edit_distance: int = 2,
        max_candidates: int = 10,
    ) -> list[dict]:
        """
        Distance-first fuzzy matching with unigram LM as tie-breaker only.

        1. Filter candidates by edit distance <= max_edit_distance
        2. Find minimum edit distance among candidates
        3. Keep only candidates at that minimum distance
        4. Rank by unigram cost
        5. Return top max_candidates
        """
        word = (word or "").strip()
        if not word:
            return []

        len_word = len(word)

        # Stage 1: Collect all candidates within max_edit_distance
        # Use BK-tree for efficiency
        bk = getattr(self, "_bk_tree", None)
        if bk is None:
            return []
        # Use BK-tree query - much faster!
        bk_hits = bk.query(word, max_edit_distance)  # [(cand, d)]
        pool: list[tuple[str, int]] = [
            (cand, d)
            for cand, d in bk_hits
            if d > 0  # Skip exact matches
        ]

        if not pool:
            return []

        # Find the best (minimum) edit distance
        best_d = min(d for _, d in pool)

        # Keep only candidates at the best distance
        best_candidates = [cand for cand, d in pool if d == best_d]

        # Stage 2: Unigram LM tie-break within same distance
        scored: list[tuple[float, str]] = []
        for cand in best_candidates:
            uni_cost = get_unigram_cost(cand)
            scored.append((uni_cost, cand))

        # Sort by unigram cost (lower is better)
        scored.sort(key=lambda t: t[0])

        # Take top candidates
        top = scored[:max_candidates]

        # Build results
        results: list[dict] = []
        for uni_cost, cand in top:
            max_len = max(len_word, len(cand))
            edit_sim = 1.0 - (best_d / max_len) if max_len > 0 else 0.0
            results.append(
                {
                    "candidate": cand,
                    "edit_distance": best_d,
                    "edit_similarity": edit_sim,
                    "lm_cost": uni_cost,
                }
            )

        return results

    def suggest_spellings_with_bigram(
        self,
        word: str,
        context_words: list[str],
        max_edit_distance: int = 2,
        max_candidates: int = 10,
    ) -> list[dict]:
        """
        Distance-first fuzzy matching with bigram-aware scoring.

        Primary ranking: edit distance (lowest first)
        Secondary ranking within same edit distance:
          - 50% bigram score + 50% unigram score (if bigram exists)
          - 100% unigram score (if no bigram exists)
          - Candidates with no LM data go to bottom of their edit-distance tier

        context_words: list of words to use for bigram context (e.g., removed words from previous iteration)
                       Bigram is computed as (context_word, candidate) for each context word

        Returns list of dicts with:
          - candidate: the matched word
          - edit_distance: Levenshtein distance
          - edit_similarity: 1 - (edit_distance / max_len)
          - unigram_cost: -log P(candidate) from unigram LM
          - bigram_cost: -log P(candidate | context) from bigram LM (None if no bigram exists)
          - has_bigram: True if at least one bigram was found
          - combined_score: final score (50% bigram + 50% unigram, or 100% unigram)
        """
        word = (word or "").strip()
        if not word:
            return []

        len_word = len(word)

        # Stage 1: Collect all candidates within max_edit_distance, grouped by distance
        # Use BK-tree for efficiency
        bk = getattr(self, "_bk_tree", None)
        if bk is None:
            return []
        # Use BK-tree query - much faster!
        bk_hits = bk.query(word, max_edit_distance)  # [(cand, d)]
        pool_by_dist: dict[int, list[str]] = {}
        for cand, d in bk_hits:
            # Skip exact matches (d=0)
            if d == 0:
                continue
            if d not in pool_by_dist:
                pool_by_dist[d] = []
            pool_by_dist[d].append(cand)

        if not pool_by_dist:
            return []

        # Sort distances to process best first
        sorted_distances = sorted(pool_by_dist.keys())

        # Stage 2: Score candidates with bigram/unigram
        results: list[dict] = []

        for dist in sorted_distances:
            candidates = pool_by_dist[dist]
            scored_in_tier: list[tuple[float, bool, float, float | None, str]] = []

            for cand in candidates:
                uni_cost = get_unigram_cost(cand)

                # Check bigram with each context word, take the best (lowest cost)
                bigram_cost: float | None = None
                has_bigram = False

                if context_words and BIGRAM_COST:
                    for ctx_word in context_words:
                        # Check both directions: (context -> candidate) and (candidate -> context)
                        key_fwd = (ctx_word, cand)
                        key_bwd = (cand, ctx_word)

                        if key_fwd in BIGRAM_COST:
                            cost = BIGRAM_COST[key_fwd]
                            if bigram_cost is None or cost < bigram_cost:
                                bigram_cost = cost
                            has_bigram = True

                        if key_bwd in BIGRAM_COST:
                            cost = BIGRAM_COST[key_bwd]
                            if bigram_cost is None or cost < bigram_cost:
                                bigram_cost = cost
                            has_bigram = True

                # Compute combined score
                if has_bigram and bigram_cost is not None:
                    # 50% bigram + 50% unigram
                    combined_score = 0.5 * bigram_cost + 0.5 * uni_cost
                else:
                    # 100% unigram
                    combined_score = uni_cost

                scored_in_tier.append((combined_score, has_bigram, uni_cost, bigram_cost, cand))

            # Sort tier: candidates with bigram first (has_bigram=True sorts before False when negated)
            # Then by combined_score (lower is better)
            scored_in_tier.sort(key=lambda t: (not t[1], t[0]))

            for combined_score, has_bigram, uni_cost, bigram_cost, cand in scored_in_tier:
                if len(results) >= max_candidates:
                    break

                max_len = max(len_word, len(cand))
                edit_sim = 1.0 - (dist / max_len) if max_len > 0 else 0.0

                results.append(
                    {
                        "candidate": cand,
                        "edit_distance": dist,
                        "edit_similarity": edit_sim,
                        "unigram_cost": uni_cost,
                        "bigram_cost": bigram_cost,
                        "has_bigram": has_bigram,
                        "combined_score": combined_score,
                    }
                )

            if len(results) >= max_candidates:
                break

        return results
