"""Burmese reader: segmentation."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from . import (
    dictionary_types as dictionary_types_service,
    graphemes as graphemes_service,
    language_model as language_model_service,
    lm_runtime as lm_runtime_service,
    normalization as normalization_service,
    segmentation_config as segmentation_config_service,
)


def build_syllable_clusters(text: str) -> tuple[list[str], list[int]]:
    """
    Wrapper over the local syllable cluster builder used by the new segmenter.
    """
    clusters, starts, _ = graphemes_service._build_clusters(text)
    return clusters, starts


def count_syllables(text: str) -> int:
    """Count syllable clusters in text."""
    if not text or not normalization_service._contains_burmese(text):
        return len(text) if text else 0
    clusters, _ = build_syllable_clusters(text)
    return len(clusters)


def _get_unigram_cost(norm_word: str, fallback_lm=None) -> tuple[float | None, bool]:
    """
    Try lmbrain's get_unigram_cost first (if available), else fall back to the
    embedded segmenter's LM. Returns (cost, known_flag) where known_flag only
    reflects true LM membership, not the existence of a default cost.
    """
    if lm_runtime_service.state.get_unigram_cost:
        try:
            c = lm_runtime_service.state.get_unigram_cost(norm_word)
        except Exception:
            c = None
        lm_known = False
        try:
            from lmbrain import UNIGRAM_COST  # type: ignore

            if UNIGRAM_COST:
                lm_known = norm_word in UNIGRAM_COST
        except Exception:
            lm_known = False
        if c is not None:
            try:
                return float(c), lm_known
            except Exception:
                pass
    if fallback_lm is not None:
        try:
            return fallback_lm.get_unigram_cost(norm_word), fallback_lm.in_lm(norm_word)
        except Exception:
            pass
    return None, False


def _get_bigram_cost(
    left: str, right: str, fallback_lm=None
) -> tuple[float | None, bool]:
    """
    Try lmbrain's get_bigram_cost first (if available), else fall back to the
    embedded segmenter's LM. Returns (cost, known_flag) where known_flag is true
    only if the pair was seen in the LM.
    """
    if lm_runtime_service.state.get_bigram_cost:
        try:
            c = lm_runtime_service.state.get_bigram_cost(left, right)
        except Exception:
            c = None
        lm_known = False
        try:
            from lmbrain import BIGRAM_COST  # type: ignore

            if BIGRAM_COST:
                lm_known = (left, right) in BIGRAM_COST
        except Exception:
            lm_known = False
        if c is not None:
            try:
                return float(c), lm_known
            except Exception:
                pass
    if fallback_lm is not None:
        try:
            c = fallback_lm.get_bigram_cost(left, right)
            if c is not None:
                return c, True
        except Exception:
            c = None
    return None, False


BIGRAM_SCORE_SCALE: float = 40.0


class BurmeseSegmenter:
    """
    Simplified log-probability Burmese word segmenter.
    """

    def __init__(
        self, config: Optional[segmentation_config_service.SegmenterConfig] = None
    ):
        self.config = config or segmentation_config_service.SegmenterConfig()
        self.lm = language_model_service.LanguageModel(self.config)
        self.dictionary = dictionary_types_service.StackedDictionary()
        # Add default layers (can be populated later)
        self.dictionary.add_layer("user", priority=10)  # Highest priority
        self.dictionary.add_layer("pali", priority=30)  # Historical/classical
        self.dictionary.add_layer("chronicle", priority=40)  # Domain-specific
        self.dictionary.add_layer("wiktionary", priority=50)
        self.dictionary.add_layer("mmd", priority=60)
        self.dictionary.add_layer("lm_vocab", priority=100)  # Auto-populated from LM

    def load_lm(
        self, unigram_path: str | Path, bigram_path: Optional[str | Path] = None
    ) -> None:
        """Load language model files."""
        self.lm.load_unigram(unigram_path)
        if bigram_path:
            self.lm.load_bigram(bigram_path)

    def load_dictionary_tsv(
        self, path: str | Path, layer_name: str, has_header: bool = True
    ) -> int:
        """
        Load a TSV dictionary file into a layer.
        Expected columns: headword, romanization, pos, definition
        (Missing columns are OK - will use defaults)
        Returns number of entries loaded.
        """
        layer = self.dictionary.get_layer(layer_name)
        if not layer:
            layer = self.dictionary.add_layer(layer_name, priority=50)
        path = Path(path)
        if not path.exists():
            print(f"[WARN] Dictionary file not found: {path}")
            return 0
        count = 0
        with open(path, "r", encoding="utf-8") as f:
            for i, line in enumerate(f):
                if i == 0 and has_header:
                    continue
                line = line.strip()
                if not line:
                    continue
                parts = line.split("\t")
                if not parts:
                    continue
                headword = parts[0].strip() if len(parts) > 0 else ""
                roman = parts[1].strip() if len(parts) > 1 else ""
                pos = parts[2].strip() if len(parts) > 2 else ""
                defn = parts[3].strip() if len(parts) > 3 else ""
                if not headword:
                    continue
                layer.add_entry(headword, roman, pos, defn)
                count += 1
        self.dictionary.rebuild_cache()
        print(f"[INFO] Loaded {count} entries into '{layer_name}' layer")
        return count

    def segment_cost(self, seg_text: str, prev_word: Optional[str] = None) -> float:
        """
        Compute the cost for a candidate segment.
        """
        cfg = self.config
        norm = normalization_service._normalize_burmese(seg_text)
        entry = self.dictionary.lookup(norm)
        fallback_default = getattr(self.lm, "unigram_default_cost", 15.0)
        lm_cost, lm_known = _get_unigram_cost(norm, self.lm)
        if entry and (entry.source or "").lower() == "user":
            # Treat user entries as LM-known to avoid discounting penalties.
            lm_known = True
            if lm_cost is None:
                lm_cost = fallback_default
        # === BASE COST ===
        if entry and (entry.source or "").lower() not in {"lm_vocab", "lm"}:
            # Case 1: In a real dictionary layer (user/mmd/pali/etc.)
            if lm_known and lm_cost is not None:
                lm_val = min(lm_cost, fallback_default)
            else:
                lm_val = fallback_default * cfg.DICT_NO_LM_DISCOUNT
            base_cost = cfg.KNOWN_WORD_BASE_COST + cfg.UNIGRAM_WEIGHT * lm_val
        elif lm_known:
            # Case 2: LM-only word (not in our dictionaries) - treat near OOV
            num_syllables = count_syllables(seg_text)
            lm_val = (
                fallback_default  # stopgap only; don't let LM-only beat dict splits
            )
            base_cost = (
                cfg.UNKNOWN_WORD_BASE_COST
                + cfg.UNIGRAM_WEIGHT * lm_val
                + (num_syllables - 1) * cfg.OOV_SYLLABLE_PENALTY
            )
        else:
            # Case 3: True OOV - unknown to both LM and dictionaries
            num_syllables = count_syllables(seg_text)
            base_cost = (
                cfg.UNKNOWN_WORD_BASE_COST
                + cfg.UNIGRAM_WEIGHT * fallback_default
                + (num_syllables - 1) * cfg.OOV_SYLLABLE_PENALTY
            )
        # === BIGRAM ADJUSTMENT (ONE DIRECTION ONLY) ===
        bigram_adj = 0.0
        if (
            prev_word
            and cfg.BIGRAM_WEIGHT > 0
            and (norm in self.dictionary or lm_known)
        ):
            # DP runs right-to-left; prev_word here is the next token in text order.
            bc_next, _ = _get_bigram_cost(norm, prev_word, self.lm)
            if bc_next is not None:
                bigram_score_next = BIGRAM_SCORE_SCALE / (bc_next + 1e-9)
                bigram_adj = -cfg.BIGRAM_WEIGHT * bigram_score_next
        return base_cost + bigram_adj

    def segment(self, text: str) -> list[str]:
        """Segment Burmese text into words using DP."""
        if not text:
            return []
        clusters, starts = build_syllable_clusters(text)
        n = len(clusters)
        if n == 0:
            return [text] if text else []
        cluster_ends = [s + len(c) for s, c in zip(starts, clusters)]
        max_clusters = self.config.MAX_WORD_CLUSTERS

        dp_cost = [float("inf")] * (n + 1)
        next_idx = [0] * (n + 1)
        first_word: list[str] = [""] * (n + 1)
        dp_cost[n] = 0.0
        # Fill DP table right-to-left
        for i in range(n - 1, -1, -1):
            best_cost = float("inf")
            best_j = i + 1
            start_char = starts[i]
            max_j = min(n, i + max_clusters)
            for j in range(i + 1, max_j + 1):
                end_char = cluster_ends[j - 1]
                seg_text = text[start_char:end_char]
                # Get previous word for bigram context (from what follows this segment)
                prev_word = first_word[j] if j < n else None
                seg_cost = self.segment_cost(seg_text, prev_word)
                total_cost = seg_cost + dp_cost[j]
                if total_cost < best_cost:
                    best_cost = total_cost
                    best_j = j
            if best_cost == float("inf"):
                # No dict-only candidate found (should be rare) - fall back to first cluster.
                best_j = i + 1
            dp_cost[i] = best_cost
            next_idx[i] = best_j
            # Record first word of best path from i
            best_end = cluster_ends[best_j - 1]
            first_word[i] = text[start_char:best_end]
        # Reconstruct path
        segments: list[str] = []
        i = 0
        while i < n:
            j = next_idx[i]
            if j <= i or j > n:
                segments.append(text[starts[i] :])
                break
            start_char = starts[i]
            end_char = cluster_ends[j - 1]
            segments.append(text[start_char:end_char])
            i = j
        return segments

    def segment_with_info(self, text: str) -> list[dict]:
        """
        Segment text and return detailed info for each segment.
        """
        if not text:
            return []
        clusters, starts = build_syllable_clusters(text)
        n = len(clusters)
        if n == 0:
            return [
                {
                    "text": text,
                    "start": 0,
                    "end": len(text),
                    "in_dict": False,
                    "in_lm": False,
                    "cost": 0.0,
                    "entry": None,
                }
            ]
        segments = self.segment(text)
        results = []
        pos = 0
        prev_word = None
        for seg in segments:
            norm = normalization_service._normalize_burmese(seg)
            start = text.find(seg, pos)
            if start == -1:
                start = pos
            end = start + len(seg)
            entry = self.dictionary.lookup(seg)
            in_lm = self.lm.in_lm(norm)
            cost = self.segment_cost(seg, prev_word)
            results.append(
                {
                    "text": seg,
                    "start": start,
                    "end": end,
                    "in_dict": entry is not None,
                    "in_lm": in_lm,
                    "cost": cost,
                    "entry": entry,
                }
            )
            pos = end
            prev_word = seg
        return results

    def segment_with_trace(self, text: str) -> dict:
        """
        Segment text and return DP trace for debugging:
          - segments (best path)
          - dp_cost, next_idx, first_word arrays
          - candidates considered at each start position with proper prev_word context
        """
        if not text:
            return {
                "segments": [],
                "dp_cost": [],
                "next_idx": [],
                "first_word": [],
                "candidates": [],
            }
        clusters, starts = build_syllable_clusters(text)
        n = len(clusters)
        if n == 0:
            return {
                "segments": [text],
                "dp_cost": [0.0],
                "next_idx": [],
                "first_word": [text],
                "candidates": [],
            }
        cluster_ends = [s + len(c) for s, c in zip(starts, clusters)]
        dp_cost = [float("inf")] * (n + 1)
        next_idx = [0] * (n + 1)
        first_word: list[str] = [""] * (n + 1)
        candidates_trace: list[list[dict]] = [[] for _ in range(n)]
        dp_cost[n] = 0.0
        max_clusters = self.config.MAX_WORD_CLUSTERS

        def _is_dict_segment(seg_text: str) -> bool:
            entry = self.dictionary.lookup(seg_text)
            return bool(
                entry and (entry.source or "").lower() not in {"lm_vocab", "lm"}
            )

        def _compute_breakdown(seg_text: str, prev_word: Optional[str]) -> dict:
            cfg = self.config
            norm = normalization_service._normalize_burmese(seg_text)
            entry = self.dictionary.lookup(norm)
            lm_cost, lm_known = _get_unigram_cost(norm, self.lm)
            fallback_default = getattr(self.lm, "unigram_default_cost", 15.0)
            if entry and (entry.source or "").lower() == "user":
                lm_known = True
                if lm_cost is None:
                    lm_cost = fallback_default
            syllables = count_syllables(seg_text)
            if entry and (entry.source or "").lower() not in {"lm_vocab", "lm"}:
                if lm_known and lm_cost is not None:
                    lm_val = min(lm_cost, fallback_default)
                else:
                    lm_val = fallback_default * cfg.DICT_NO_LM_DISCOUNT
                base_cost = cfg.KNOWN_WORD_BASE_COST + cfg.UNIGRAM_WEIGHT * lm_val
                branch = "dict"
                source = entry.source
            elif lm_known:
                lm_val = fallback_default
                base_cost = (
                    cfg.UNKNOWN_WORD_BASE_COST
                    + cfg.UNIGRAM_WEIGHT * lm_val
                    + (syllables - 1) * cfg.OOV_SYLLABLE_PENALTY
                )
                branch = "lm_only"
                source = "lm_only"
            else:
                lm_val = fallback_default
                base_cost = (
                    cfg.UNKNOWN_WORD_BASE_COST
                    + cfg.UNIGRAM_WEIGHT * lm_val
                    + (syllables - 1) * cfg.OOV_SYLLABLE_PENALTY
                )
                branch = "oov"
                source = "oov"
            bigram_adj = 0.0
            bigram_cost_prev = None
            bigram_cost_next = None
            bigram_known = False
            bigram_reward = 0.0
            bigram_score_prev = 0.0
            bigram_score_next = 0.0
            if (
                prev_word
                and cfg.BIGRAM_WEIGHT > 0
                and (norm in self.dictionary or lm_known)
            ):
                # Text-order only: current -> next word in text (prev_word in DP context)
                bigram_cost_next, known_next = _get_bigram_cost(
                    norm, prev_word, self.lm
                )
                bigram_known = bool(known_next and bigram_cost_next is not None)
                if bigram_cost_next is not None:
                    bigram_score_next = BIGRAM_SCORE_SCALE / (bigram_cost_next + 1e-9)
                    bigram_reward = bigram_score_next
                    bigram_adj = -cfg.BIGRAM_WEIGHT * bigram_reward
            total = base_cost + bigram_adj
            return {
                "total": float(total),
                "base": float(base_cost),
                "bigram_adj": float(bigram_adj),
                "lm_cost": float(lm_cost)
                if lm_cost is not None
                else float(fallback_default),
                "lm_known": bool(lm_known),
                "bigram_cost": float(bigram_cost_next)
                if bigram_cost_next is not None
                else None,
                "bigram_known": bool(bigram_known),
                "source": source,
                "branch": branch,
                "syllables": syllables,
                "components": {
                    "known_word_base": cfg.KNOWN_WORD_BASE_COST
                    if branch == "dict"
                    else 0.0,
                    "unknown_word_base": cfg.UNKNOWN_WORD_BASE_COST
                    if branch in ("lm_only", "oov")
                    else 0.0,
                    "lm_unigram": float(lm_val),
                    "lm_unigram_weighted": cfg.UNIGRAM_WEIGHT * float(lm_val),
                    "unigram_weight": cfg.UNIGRAM_WEIGHT,
                    "dict_discount": cfg.DICT_NO_LM_DISCOUNT
                    if branch == "dict" and not lm_known
                    else None,
                    "oov_penalty": (syllables - 1) * cfg.OOV_SYLLABLE_PENALTY
                    if branch in ("lm_only", "oov")
                    else 0.0,
                    "bigram_score": bigram_score_next
                    if bigram_cost_next is not None
                    else 0.0,
                    "bigram_reward": bigram_reward,
                    "bigram_reward_weighted": cfg.BIGRAM_WEIGHT * bigram_reward
                    if bigram_reward
                    else 0.0,
                },
            }

        for i in range(n - 1, -1, -1):
            best_cost = float("inf")
            best_j = i + 1
            start_char = starts[i]
            max_j = min(n, i + max_clusters)
            cand_list = []
            for j in range(i + 1, max_j + 1):
                end_char = cluster_ends[j - 1]
                seg_text = text[start_char:end_char]
                is_dict = _is_dict_segment(seg_text)
                prev_word = first_word[j] if j < n else None
                seg_cost = self.segment_cost(seg_text, prev_word)
                total_cost = seg_cost + dp_cost[j]
                breakdown = _compute_breakdown(seg_text, prev_word)
                cand_list.append(
                    {
                        "text": seg_text,
                        "start_char": start_char,
                        "end_char": end_char,
                        "clusters": j - i,
                        "seg_cost": float(seg_cost),
                        "total_cost": float(total_cost),
                        "next_idx": j,
                        "prev_word": prev_word,
                        "is_dict": bool(is_dict),
                        "cost_breakdown": breakdown,
                    }
                )
                if total_cost < best_cost:
                    best_cost = total_cost
                    best_j = j
            if best_cost == float("inf"):
                best_j = i + 1
            dp_cost[i] = best_cost
            next_idx[i] = best_j
            best_end = cluster_ends[best_j - 1]
            first_word[i] = text[start_char:best_end]
            cand_list.sort(key=lambda c: c["total_cost"])
            candidates_trace[i] = cand_list
        segments: list[str] = []
        i = 0
        while i < n:
            j = next_idx[i]
            if j <= i or j > n:
                segments.append(text[starts[i] :])
                break
            start_char = starts[i]
            end_char = cluster_ends[j - 1]
            segments.append(text[start_char:end_char])
            i = j
        return {
            "segments": segments,
            "dp_cost": dp_cost,
            "next_idx": next_idx,
            "first_word": first_word,
            "candidates": candidates_trace,
            "clusters": clusters,
            "starts": starts,
            "cluster_ends": cluster_ends,
        }
