"""Burmese reader: dictionary dp."""

from __future__ import annotations

from . import (
    grammar as grammar_service,
    lexicon as lexicon_service,
    normalization as normalization_service,
    segmentation as segmentation_service,
)
from .runtime import feature_state

_MAX_WORD_CLUSTERS = 16  # max clusters to consider for a single word


def rebuild_grammar_forms_cache() -> None:
    """Refresh cached grammar forms (sorted list only; no duplicate set)."""
    try:
        state.GRAMMAR_FORMS_SORTED = sorted(
            grammar_service.state.GRAMMAR_LEXICON.keys(), key=len, reverse=True
        )
    except Exception:
        state.GRAMMAR_FORMS_SORTED = []


def _segment_by_clusters_dp_debug(text: str) -> dict:
    """
    Debug helper for the new segmenter: returns segment-level info.
    """
    if not text:
        return {
            "segments": [],
            "clusters": [],
            "starts": [],
            "cluster_ends": [],
            "dp_cost": [],
            "next_idx": [],
            "first_word": [],
            "events": [],
        }
    seg_inst = lexicon_service.get_segmenter_instance()
    trace = lexicon_service.segmenter_segment_with_trace(text)
    info = lexicon_service.segmenter_segment_with_info(text)
    clusters = trace.get("clusters", [])
    starts = trace.get("starts", [])
    cluster_ends = trace.get("cluster_ends", [])

    # Cost breakdown helper so we can see where the cost comes from
    def _compute_cost_breakdown(seg_text: str, prev_word: str | None) -> dict:
        cfg = seg_inst.config
        norm = normalization_service._normalize_burmese(seg_text)
        entry = seg_inst.dictionary.lookup(norm)
        lm_cost, lm_known = segmentation_service._get_unigram_cost(norm, seg_inst.lm)
        fallback_default = getattr(seg_inst.lm, "unigram_default_cost", 15.0)
        if entry and (entry.source or "").lower() == "user":
            lm_known = True
            if lm_cost is None:
                lm_cost = fallback_default
        syllables = segmentation_service.count_syllables(seg_text)
        # Base cost
        if entry and (entry.source or "").lower() not in {"lm_vocab", "lm"}:
            if lm_known and lm_cost is not None:
                lm_val = min(lm_cost, fallback_default)
            else:
                lm_val = fallback_default * cfg.DICT_NO_LM_DISCOUNT
            base_cost = cfg.KNOWN_WORD_BASE_COST + cfg.UNIGRAM_WEIGHT * lm_val
            source = entry.source
            branch = "dict"
        elif lm_known:
            num_syllables = segmentation_service.count_syllables(seg_text)
            lm_val = fallback_default
            base_cost = (
                cfg.UNKNOWN_WORD_BASE_COST
                + cfg.UNIGRAM_WEIGHT * lm_val
                + (num_syllables - 1) * cfg.OOV_SYLLABLE_PENALTY
            )
            source = "lm_only"
            branch = "lm_only"
        else:
            num_syllables = segmentation_service.count_syllables(seg_text)
            base_cost = (
                cfg.UNKNOWN_WORD_BASE_COST
                + cfg.UNIGRAM_WEIGHT * fallback_default
                + (num_syllables - 1) * cfg.OOV_SYLLABLE_PENALTY
            )
            source = "oov"
            branch = "oov"
        # Bigram adjustment (one direction: current -> next in text order)
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
            and (norm in seg_inst.dictionary or lm_known)
        ):
            bigram_cost_next, known_next = segmentation_service._get_bigram_cost(
                norm, prev_word, seg_inst.lm
            )
            bigram_known = bool(known_next and bigram_cost_next is not None)
            if bigram_cost_next is not None:
                bigram_score_next = segmentation_service.BIGRAM_SCORE_SCALE / (
                    bigram_cost_next + 1e-9
                )
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
                "lm_unigram": float(
                    lm_val if (lm_known or branch == "dict") else fallback_default
                ),
                "lm_unigram_weighted": cfg.UNIGRAM_WEIGHT
                * float(lm_val if (lm_known or branch == "dict") else fallback_default),
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

    # JSON-safe events (convert DictionaryEntry to plain dict) + breakdowns
    events = []
    prev_word = None
    for seg in info:
        entry = seg.get("entry")
        if entry:
            seg = dict(seg)
            seg["entry"] = {
                "headword": entry.headword,
                "romanization": entry.romanization,
                "pos": entry.pos,
                "definition": "\n".join(entry.senses) if entry.senses else "",
                "source": entry.source,
            }
        seg["cost_breakdown"] = _compute_cost_breakdown(seg.get("text", ""), prev_word)
        prev_word = seg.get("text", "")
        events.append(seg)
    return {
        "segments": [seg.get("text", "") for seg in info],
        "clusters": clusters,
        "starts": starts,
        "cluster_ends": cluster_ends,
        "dp_cost": trace.get("dp_cost", []),
        "next_idx": trace.get("next_idx", []),
        "first_word": trace.get("first_word", []),
        "events": events,
        "candidates": trace.get("candidates", []),
    }


def _new_state():
    from types import SimpleNamespace

    return SimpleNamespace(
        GRAMMAR_FORMS_SORTED=[],
    )


state = feature_state("dictionary_dp", _new_state)
