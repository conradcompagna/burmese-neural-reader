"""Burmese reader: language model."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Optional

from . import (
    normalization as normalization_service,
    segmentation_config as segmentation_config_service,
)


class LanguageModel:
    """
    Simple unigram + bigram language model using -log P as cost.
    Loads from myWord-format files:
        unigram: word<TAB>count
        bigram:  ('word1', 'word2')<TAB>count  (or word1<TAB>word2<TAB>count)
    """

    def __init__(self, config: segmentation_config_service.SegmenterConfig):
        self.config = config
        # Unigram data
        self.unigram_counts: dict[str, int] = {}
        self.unigram_total: int = 0
        self.unigram_cost: dict[str, float] = {}
        self.unigram_default_cost: float = 15.0  # For truly unseen words
        # Bigram data
        self.bigram_counts: dict[tuple[str, str], int] = {}
        self.bigram_left_total: dict[str, int] = {}
        self.bigram_cost: dict[tuple[str, str], float] = {}
        # Stats for diagnostics
        self.unigram_min_cost: float = 0.0
        self.unigram_max_cost: float = 15.0

    def load_unigram(self, path: str | Path) -> int:
        """
        Load unigram frequencies from file.
        Returns number of entries loaded.
        Format: word<TAB>count (one per line)
        """
        self.unigram_counts.clear()
        self.unigram_cost.clear()
        self.unigram_total = 0
        path = Path(path)
        if not path.exists():
            print(f"[WARN] Unigram file not found: {path}")
            return 0
        count = 0
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                parts = line.split("\t")
                if len(parts) >= 2:
                    word = parts[0].strip()
                    try:
                        freq = int(parts[-1])
                    except ValueError:
                        continue
                else:
                    # Try space-separated fallback
                    try:
                        word, freq_str = line.rsplit(maxsplit=1)
                        freq = int(freq_str)
                    except (ValueError, IndexError):
                        continue
                word = word.replace("\ufeff", "").strip()
                if not word:
                    continue
                # Normalize for consistent lookup
                norm = normalization_service._normalize_burmese(word)
                self.unigram_counts[norm] = self.unigram_counts.get(norm, 0) + freq
                self.unigram_total += freq
                count += 1
        # Compute -log P costs with Laplace smoothing
        vocab_size = len(self.unigram_counts)
        self._compute_unigram_costs()
        print(f"[INFO] Loaded {count} unigram entries, vocab={vocab_size}")
        return count

    def _compute_unigram_costs(self) -> None:
        """Compute -log P for all unigrams with Laplace smoothing."""
        if not self.unigram_counts:
            self.unigram_default_cost = 15.0
            return
        V = len(self.unigram_counts)
        alpha = self.config.UNIGRAM_ALPHA
        denom = self.unigram_total + alpha * V
        min_cost = float("inf")
        max_cost = 0.0
        for word, freq in self.unigram_counts.items():
            p = (freq + alpha) / denom
            cost = -math.log(p)
            self.unigram_cost[word] = cost
            min_cost = min(min_cost, cost)
            max_cost = max(max_cost, cost)
        # Default cost for unseen = treat as if count=0 with smoothing
        p0 = alpha / denom
        self.unigram_default_cost = -math.log(p0)
        self.unigram_min_cost = min_cost if min_cost != float("inf") else 0.0
        self.unigram_max_cost = max_cost
        # Drop raw counts to save memory (runtime only needs costs).
        self.unigram_counts.clear()
        print(
            f"[INFO] Unigram costs: min={min_cost:.2f}, max={max_cost:.2f}, default={self.unigram_default_cost:.2f}"
        )

    def load_bigram(self, path: str | Path) -> int:
        """
        Load bigram frequencies from file.
        Returns number of entries loaded.
        Format options:
            ('word1', 'word2')<TAB>count  (myWord format)
            word1<TAB>word2<TAB>count     (simple format)
        """
        import ast

        self.bigram_counts.clear()
        self.bigram_left_total.clear()
        self.bigram_cost.clear()
        path = Path(path)
        if not path.exists():
            print(f"[WARN] Bigram file not found: {path}")
            return 0
        count = 0
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                w1, w2, freq = None, None, None
                # Try myWord tuple format first: ('word1', 'word2')\tcount
                if line.startswith("("):
                    try:
                        pair_str, freq_str = line.rsplit("\t", 1)
                        w1, w2 = ast.literal_eval(pair_str.strip())
                        freq = int(freq_str.strip())
                    except Exception:
                        pass
                # Try simple tab-separated: word1\tword2\tcount
                if w1 is None:
                    parts = line.split("\t")
                    if len(parts) >= 3:
                        try:
                            w1 = parts[0].strip()
                            w2 = parts[1].strip()
                            freq = int(parts[2].strip())
                        except Exception:
                            pass
                if w1 is None or w2 is None or freq is None:
                    continue
                w1 = normalization_service._normalize_burmese(
                    w1.replace("\ufeff", "").strip()
                )
                w2 = normalization_service._normalize_burmese(
                    w2.replace("\ufeff", "").strip()
                )
                if not w1 or not w2:
                    continue
                key = (w1, w2)
                self.bigram_counts[key] = self.bigram_counts.get(key, 0) + freq
                count += 1
        # Compute left-word totals and costs
        self._compute_bigram_costs()
        print(f"[INFO] Loaded {count} bigram entries")
        return count

    def _compute_bigram_costs(self) -> None:
        """Compute -log P(w2|w1) for all bigrams."""
        if not self.bigram_counts:
            return
        # Sum counts for each left word
        for (w1, w2), freq in self.bigram_counts.items():
            self.bigram_left_total[w1] = self.bigram_left_total.get(w1, 0) + freq
        # Compute conditional probabilities
        for (w1, w2), freq in self.bigram_counts.items():
            left_total = self.bigram_left_total[w1]
            p = freq / left_total
            self.bigram_cost[(w1, w2)] = -math.log(p)
        # Drop raw counts to save memory (runtime only needs costs).
        self.bigram_counts.clear()
        self.bigram_left_total.clear()

    def get_unigram_cost(self, word: str) -> float:
        """
        Get -log P(word) from unigram model.
        Returns default cost if word not in LM.
        """
        norm = normalization_service._normalize_burmese(word)
        return self.unigram_cost.get(norm, self.unigram_default_cost)

    def get_bigram_cost(self, w1: str, w2: str) -> Optional[float]:
        """
        Get -log P(w2|w1) from bigram model.
        Returns None if bigram not observed (caller should back off to unigram).
        """
        key = (
            normalization_service._normalize_burmese(w1),
            normalization_service._normalize_burmese(w2),
        )
        return self.bigram_cost.get(key)

    def in_lm(self, word: str) -> bool:
        """Check if word was observed in training data."""
        return normalization_service._normalize_burmese(word) in self.unigram_cost
