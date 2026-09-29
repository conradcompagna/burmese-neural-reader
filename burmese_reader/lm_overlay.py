"""Burmese reader: lm overlay."""

from __future__ import annotations

import math

from . import (
    lexicon as lexicon_service,
    lm_runtime as lm_runtime_service,
    normalization as normalization_service,
)


def build_lm_overlay_for_segments(segments: list[str]) -> dict:
    """
    Build a lightweight LM overlay for a *single* segmented query, to drive the UI.
    Returns a dict:
      {
        "tokens": [
          {
            "text": "...",
            "unigram_cost": <float or None>,
            "rarity_score": <float in [0,1] or None>,  # 0 = very common, 1 = very rare
            "dict_known": <bool>,
            "lm_known": <bool>,
            "ok_for_lm": <bool>,  # used to gate collocs/phrases
          },
          ...
        ],
        "edges": [
          {
            "i": <int>,            # left index in segments
            "j": <int>,            # right index in segments (= i+1)
            "bigram": "w_i w_j",
            "strength": <float in (0,1]>,  # normalized collocation strength
          },
          ...
        ],
        "phrases": [
          {
            "start": <int>,        # inclusive
            "end": <int>,          # exclusive
            "phrase": "<string>",
            "tokens": [ ... ],     # from LM
            "count": <int>,
            "unigram_cost": <float>,
          },
          ...
        ],
      }
    """
    overlay: dict = {
        "tokens": [],
        "edges": [],
        "phrases": [],
    }
    if not segments:
        return overlay
    n = len(segments)
    tokens: list[dict] = []
    use_for_lm: list[bool] = [False] * n
    # Which LM helpers do we actually have?
    has_unigram_lm = lm_runtime_service.state.get_unigram_cost is not None
    has_bigram_lm = lm_runtime_service.state.get_bigram_cost is not None
    has_phrase_lm = lm_runtime_service.state.ADVANCED_SEGMENTER is not None
    # Lazily derive global unigram cost bounds (for rarity) if possible.
    # This is safe even if UNIGRAM_MIN_COST / MAX were never defined before.
    g = vars(lm_runtime_service.state._get_current_object())
    min_cost = g.get("UNIGRAM_MIN_COST")
    max_cost = g.get("UNIGRAM_MAX_COST")
    if min_cost is None or max_cost is None:
        try:
            from lmbrain import UNIGRAM_COST  # type: ignore
        except Exception:
            min_cost = None
            max_cost = None
        else:
            try:
                if UNIGRAM_COST:
                    costs = list(UNIGRAM_COST.values())
                    min_cost = float(min(costs))
                    max_cost = float(max(costs))
                else:
                    min_cost = None
                    max_cost = None
            except Exception:
                min_cost = None
                max_cost = None
        g["UNIGRAM_MIN_COST"] = min_cost
        g["UNIGRAM_MAX_COST"] = max_cost
    have_global_bounds = (
        min_cost is not None and max_cost is not None and max_cost > min_cost
    )
    # 1) Per-token info + global-ish rarity score
    for idx, w in enumerate(segments):
        info = {
            "text": w,
            "unigram_cost": None,
            "rarity_score": None,
            "dict_known": False,
            "lm_known": False,
            "ok_for_lm": False,
        }
        # Dictionary knowledge
        norm_w = normalization_service.normalize_burmese(w)
        dict_key = normalization_service.normalize_headword(w)
        dict_known = dict_key in lexicon_service.DICT
        info["dict_known"] = dict_known
        # If it's not Burmese or empty/garbage, don't try LM on it
        if (
            not has_unigram_lm
            or not normalization_service.contains_burmese(w)
            or len(w.strip()) == 0
        ):
            tokens.append(info)
            continue
        cost = None
        try:
            c = float(lm_runtime_service.state.get_unigram_cost(norm_w))
            if math.isfinite(c):
                cost = c
        except Exception:
            cost = None
        lm_known = cost is not None
        info["lm_known"] = lm_known
        # Only allow into collocs/phrases if:
        #   (a) in DICT, AND
        #   (b) LM has a usable unigram cost.
        ok_for_lm = bool(dict_known and lm_known)
        info["ok_for_lm"] = ok_for_lm
        if ok_for_lm:
            use_for_lm[idx] = True
        if lm_known:
            info["unigram_cost"] = cost
            # Prefer global bounds if we have them; otherwise fall back
            # to a logistic mapping of cost.
            rarity = None
            if have_global_bounds:
                try:
                    span = max(max_cost - min_cost, 1e-6)
                    rarity = (cost - min_cost) / span
                    rarity = max(0.0, min(1.0, rarity))
                except Exception:
                    rarity = None
            if rarity is None:
                # Fallback: cost ~ -log P, map to [0,1] via logistic.
                # Center at ~8 with moderate slope.
                try:
                    rarity = 1.0 / (1.0 + math.exp(-(cost - 8.0) / 3.0))
                    rarity = max(0.0, min(1.0, rarity))
                except Exception:
                    rarity = None
            info["rarity_score"] = rarity
        tokens.append(info)
    overlay["tokens"] = tokens
    # 2) Bigram edges (collocations) between successive tokens.
    #    IMPORTANT: only between tokens we marked ok_for_lm on BOTH sides,
    #    so you do NOT get collocs inside unknown blobs like ??? + ???.
    edges: list[dict] = []
    if has_bigram_lm:
        for i in range(n - 1):
            # Skip any pair touching a token we decided is not ok_for_lm
            if not (use_for_lm[i] and use_for_lm[i + 1]):
                continue
            w_i = segments[i]
            w_j = segments[i + 1]
            bigram = f"{w_i} {w_j}"
            try:
                cost = float(lm_runtime_service.state.get_bigram_cost(w_i, w_j))
            except Exception:
                continue
            if not math.isfinite(cost):
                continue
            # Strong collocations = low bigram cost.
            # Map cost (roughly -log P) into (0,1] strength.
            try:
                # Shift & scale so that:
                #   cost <= 5  ? strength ~ 1.0
                #   cost  ~ 8  ? strength ~ 0.37
                #   cost >= 14 ? strength ~ 0.05
                shifted = max(cost - 5.0, 0.0)
                strength = math.exp(-shifted / 3.0)
            except Exception:
                strength = 0.0
            # Drop extremely weak links
            if strength <= 0.02:
                continue
            edges.append(
                {
                    "i": i,
                    "j": i + 1,
                    "bigram": bigram,
                    "strength": strength,
                }
            )
    overlay["edges"] = edges
    # 3) Phrase detection: skip any span that contains a token
    #    we marked as not ok_for_lm, so no phrases over unknown blobs.
    phrases: list[dict] = []
    if has_phrase_lm:
        try:
            phrase_hits = lm_runtime_service.state.ADVANCED_SEGMENTER.detect_phrases(
                segments
            )
        except Exception:
            phrase_hits = []
        for ph in phrase_hits or []:
            span = ph.get("span")
            if not span or len(span) != 2:
                continue
            try:
                start, end = int(span[0]), int(span[1])
            except Exception:
                continue
            if start < 0 or end <= start or end > n:
                continue
            # Drop phrases that touch unknown / out-of-LM tokens
            if not all(use_for_lm[k] for k in range(start, end)):
                continue
            phrases.append(
                {
                    "start": start,
                    "end": end,
                    "phrase": ph.get("phrase", ""),
                    "tokens": ph.get("tokens", []),
                    "count": ph.get("count", 0),
                    "unigram_cost": ph.get("unigram_cost", 0.0),
                }
            )
    overlay["phrases"] = phrases
    return overlay
