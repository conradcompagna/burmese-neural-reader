"""Burmese reader: pos statistics."""

from __future__ import annotations

import math
import os
from collections import defaultdict
from math import inf as _INF

from . import (
    lexicon as lexicon_service,
    normalization as normalization_service,
    settings as settings_service,
)
from .runtime import feature_state

_COARSE_POS_TAGS = {
    "adj",
    "adv",
    "conj",
    "exp",
    "int",
    "kjano",
    "n",
    "part",
    "pos",
    "ppm",
    "pron",
    "v",
}


_LEXICAL_WEIGHT = 1.0  # strength of lexical prior log P(tag | token)


_BIGRAM_WEIGHT = 0.7  # strength of transition log P(tag_i | tag_{i-1})


_LEX_SMOOTH = 0.0  # add-one etc; leave 0 for now (we clamp to eps)


_TRANS_SMOOTH = 0.1  # small smoothing for unseen bigrams


_MIN_LEX_PROB = 1e-4  # floor for lexical probability


_MIN_TRANS_PROB = 1e-4  # floor for transition probability


def _coarse_pos_tag(raw_pos: str) -> str:
    """
    Map raw POS strings (dict or myPOS) into your coarse tag set.
    We only use coarse tags internally; the UI can still show the
    original fine-grained POS labels.
    """
    p = (raw_pos or "").strip().lower()
    if not p:
        return ""
    # Core tags first
    if p.startswith("adj"):
        return "adj"
    if p.startswith("adv"):
        return "adv"
    if p.startswith("pron"):
        return "pron"
    if p.startswith("conj"):
        return "conj"
    if p.startswith("exp"):
        return "exp"
    if p.startswith("int") or p.startswith("interj"):
        return "int"
    if p.startswith("pos"):  # possessive etc.
        return "pos"
    # Numerals / classifiers / measure words
    if p.startswith("kjano") or p.startswith("num") or p in {"m", "nm", "tn"}:
        return "kjano"
    # Postpositions / case markers
    if p.startswith("ppm") or p.startswith("postp") or p.startswith("prep"):
        return "ppm"
    # Particles (verbal / clausal / sentence-final)
    if p.startswith("part") or p.startswith("particle"):
        return "part"
    # Nouns (including proper)
    if p.startswith("n"):
        return "n"
    # Verbs / auxiliaries
    if p.startswith("v") or p.startswith("aux"):
        return "v"
    # myPOS extras we don't explicitly model: fw, sb, abb, punc etc.
    # These will map to "" and be ignored.
    return p if p in _COARSE_POS_TAGS else ""


def _extract_pos_candidates_from_entry(entry: dict) -> list[str]:
    """
    Given a DICT[head] entry, collect all POS tags that appear
    for this headword (main pos + any embedded POS in sense lines),
    then collapse them to coarse tags.
    Returns a *sorted* list of unique coarse tags.
    """
    candidates: set[str] = set()
    # 1) Primary pos on the entry
    main_pos = _coarse_pos_tag(entry.get("pos", ""))
    if main_pos:
        candidates.add(main_pos)
    # 2) Embedded POS in hierarchical sense lines (MMD/PALI style)
    senses = entry.get("senses", []) or []
    for line in senses:
        parts = line.split("\t")
        if len(parts) >= 3:
            raw_pos = (parts[2] or "").strip()
            if raw_pos:
                p = _coarse_pos_tag(raw_pos)
                if p:
                    candidates.add(p)
    out = sorted(candidates)
    return out


def _get_pos_candidates_for_token(token: str) -> list[str]:
    """
    Wrapper to fetch all plausible coarse POS tags for a single token.
    If DICT has no entry, returns [].
    """
    if not token or not normalization_service.contains_burmese(token):
        return []
    head = normalization_service.normalize_burmese(token)
    entry = lexicon_service.DICT.get(head)
    if not entry:
        return []
    return _extract_pos_candidates_from_entry(entry)


def _ensure_mypos_stats_loaded() -> None:
    if state._MYPOS_STATS_LOADED:
        return
    if not settings_service.MYPOS_CORPUS_PATH or not os.path.exists(
        settings_service.MYPOS_CORPUS_PATH
    ):
        # Fail gracefully: fall back to heuristic-only behaviour
        state._MYPOS_STATS_LOADED = True
        return
    _load_mypos_statistics(settings_service.MYPOS_CORPUS_PATH)
    state._MYPOS_STATS_LOADED = True


def _load_mypos_statistics(path: str) -> None:
    """
    One-time pass over myPOS corpus to fill:
      - _TOKEN_TAG_COUNTS[token][tag]
      - _TAG_UNIGRAM_COUNTS[tag]
      - _TAG_BIGRAM_COUNTS[(tag_prev, tag_cur)]
    Then compute:
      - _LEXICAL_TAG_PRIORS[token][tag] = P(tag|token)
      - _TAG_TRANSITION_LOGPROBS[(t_prev, t_cur)] = log P(t_cur|t_prev)
    """
    token_tag_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    tag_unigrams: dict[str, int] = defaultdict(int)
    tag_bigrams: dict[tuple[str, str], int] = defaultdict(int)
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            # Sentence-level: reset previous tag at each new line
            prev_tag: str | None = None
            # myPOS: tokens separated by spaces; compounds use "|"
            for tok in line.split():
                # Split compound word notation: "?????/n|????????/n"
                for chunk in tok.split("|"):
                    if "/" not in chunk:
                        continue
                    # split on last "/" to be safe
                    word, raw_tag = chunk.rsplit("/", 1)
                    word = normalization_service.normalize_burmese(word)
                    coarse_tag = _coarse_pos_tag(raw_tag)
                    # Ignore things we don't model (punc, fw, sb, etc.)
                    if not coarse_tag or coarse_tag not in _COARSE_POS_TAGS:
                        prev_tag = None
                        continue
                    # Lexical counts
                    token_tag_counts[word][coarse_tag] += 1
                    # Tag unigram
                    tag_unigrams[coarse_tag] += 1
                    # Tag bigram (skip if no previous tag in this sentence)
                    if prev_tag is not None:
                        tag_bigrams[(prev_tag, coarse_tag)] += 1
                    prev_tag = coarse_tag
    # Store raw counts
    state._TOKEN_TAG_COUNTS = {w: dict(cnts) for w, cnts in token_tag_counts.items()}
    state._TAG_UNIGRAM_COUNTS = dict(tag_unigrams)
    state._TAG_BIGRAM_COUNTS = dict(tag_bigrams)
    # Derive lexical priors P(tag|token)
    lexical_priors: dict[str, dict[str, float]] = {}
    for w, tag_counts in state._TOKEN_TAG_COUNTS.items():
        total = sum(tag_counts.values())
        if total <= 0:
            continue
        inner: dict[str, float] = {}
        # simple MLE; smoothing is via clamping to _MIN_LEX_PROB at scoring time
        for tag, c in tag_counts.items():
            p = c / total
            inner[tag] = p
        lexical_priors[w] = inner
    state._LEXICAL_TAG_PRIORS = lexical_priors
    # Derive transition log-probs log P(tag_cur | tag_prev)
    tags_seen = set(tag_unigrams.keys())
    num_tags = max(1, len(tags_seen))
    trans_logprobs: dict[tuple[str, str], float] = {}
    for (t_prev, t_cur), c_bigram in state._TAG_BIGRAM_COUNTS.items():
        total_prev = tag_unigrams.get(t_prev, 0)
        if total_prev <= 0:
            continue
        # add small smoothing for unseen continuations
        p = (c_bigram + _TRANS_SMOOTH) / (total_prev + _TRANS_SMOOTH * num_tags)
        if p <= 0.0:
            p = _MIN_TRANS_PROB
        trans_logprobs[(t_prev, t_cur)] = math.log(p)
    state._TAG_TRANSITION_LOGPROBS = trans_logprobs


def _tag_bigram_score(t_prev: str, t_cur: str) -> float:
    """
    Pairwise tag compatibility score using myPOS bigram statistics.
    """
    if not t_prev or not t_cur:
        return 0.0
    # If stats failed to load, just return 0
    if not state._TAG_TRANSITION_LOGPROBS:
        return 0.0
    key = (t_prev, t_cur)
    logp = state._TAG_TRANSITION_LOGPROBS.get(key)
    if logp is None:
        # unseen: back off to small floor
        logp = math.log(_MIN_TRANS_PROB)
    return _BIGRAM_WEIGHT * logp


def _local_pos_score(token: str, tag: str, candidates: list[str]) -> float:
    """
    Local score for assigning 'tag' to 'token', ignoring neighbours.
    Now driven primarily by lexical priors from myPOS:
      - P(tag | token) from corpus
      - small stabiliser for single-candidate tokens
      - light numeric / classifier bias
    No hand-coded grammar hint list any more.
    """
    if not tag:
        return -5.0
    # If this tag isn't even a candidate (shouldn't happen), nuke it.
    if candidates and tag not in candidates:
        return -20.0
    score = 0.0
    # Lexical prior from myPOS: P(tag | token)
    priors = state._LEXICAL_TAG_PRIORS.get(token)
    if priors:
        p = priors.get(tag, _MIN_LEX_PROB)
        if p <= 0.0:
            p = _MIN_LEX_PROB
        score += _LEXICAL_WEIGHT * math.log(p)
    else:
        # Unknown token to myPOS: neutral (let context + dict handle it)
        score += 0.0
    # Single candidate: stabilise a bit so sequence model doesn't flip it
    if len(candidates) == 1 and tag == candidates[0]:
        score += 0.5
    # Numeric-ish tokens: prefer kjano/n very lightly
    if any(ch.isdigit() for ch in token):
        if tag in {"kjano", "n"}:
            score += 0.5
        elif tag in {"v", "adj"}:
            score -= 0.5
    return score


def _viterbi_pos_sequence(
    tokens: list[str],
) -> tuple[list[str], list[dict[str, float]]]:
    """
    Core POS sequence decoder.
    Input:
      tokens: list of segmented Burmese words (one clause / sentence).
    Output:
      (best_tags, local_scores_per_position)
      best_tags[i] is the chosen coarse POS for tokens[i].
      local_scores_per_position[i] is a dict {tag -> local_score}
      that we later use to derive a "confidence" strength.
    """
    # Ensure myPOS stats are available before scoring
    _ensure_mypos_stats_loaded()
    n = len(tokens)
    if n == 0:
        return [], []
    # Build candidate tag sets and local scores
    C: list[list[str]] = []
    local_scores: list[dict[str, float]] = []
    for tok in tokens:
        cand = _get_pos_candidates_for_token(tok)
        if not cand:
            cand = []
        C.append(cand)
        ls: dict[str, float] = {}
        for t in cand:
            ls[t] = _local_pos_score(tok, t, cand)
        local_scores.append(ls)
    # If everything is unknown / has no tags, bail out
    if all(len(c) == 0 for c in C):
        return ["" for _ in tokens], local_scores
    # Viterbi DP: dp[i][tag] = best score up to position i if position i has tag
    dp: list[dict[str, float]] = []
    back: list[dict[str, str]] = []
    for i in range(n):
        dp.append({})
        back.append({})
        tok = tokens[i]
        cand_i = C[i]
        # If no candidates, propagate previous best without change
        if not cand_i:
            if i == 0:
                dp[i][""] = 0.0
                back[i][""] = ""
            else:
                best_prev_tag = max(dp[i - 1], key=lambda t: dp[i - 1][t])
                dp[i][""] = dp[i - 1][best_prev_tag]
                back[i][""] = best_prev_tag
            continue
        for t in cand_i:
            loc = local_scores[i].get(t, 0.0)
            best_score = -_INF
            best_prev = ""
            if i == 0:
                # No previous tag
                best_score = loc
                best_prev = ""
            else:
                for t_prev, prev_score in dp[i - 1].items():
                    pair = _tag_bigram_score(t_prev, t)
                    s = prev_score + loc + pair
                    if s > best_score:
                        best_score = s
                        best_prev = t_prev
            dp[i][t] = best_score
            back[i][t] = best_prev
    # Choose best final tag
    last_idx = n - 1
    if not dp[last_idx]:
        return ["" for _ in tokens], local_scores
    last_tag = max(dp[last_idx], key=lambda t: dp[last_idx][t])
    best_tags = [""] * n
    best_tags[last_idx] = last_tag
    for i in range(n - 1, 0, -1):
        best_tags[i - 1] = back[i].get(best_tags[i], "")
    return best_tags, local_scores


def _confidence_from_local_scores(
    local_scores_i: dict[str, float], best_tag: str
) -> float:
    """
    Turn local score differences into a crude confidence value in [0, 1].
    Uses only local scores (lexical priors), not sequence scores.
    """
    if not local_scores_i or not best_tag:
        return 0.0
    best = local_scores_i.get(best_tag, 0.0)
    if len(local_scores_i) == 1:
        return 1.0
    second = -_INF
    for t, s in local_scores_i.items():
        if t == best_tag:
            continue
        if s > second:
            second = s
    if second == -_INF:
        return 1.0
    diff = best - second
    if diff >= 4.0:
        return 1.0
    if diff >= 2.0:
        return 0.85
    if diff >= 1.0:
        return 0.6
    if diff >= 0.5:
        return 0.4
    return 0.25


def _new_state():
    from types import SimpleNamespace

    return SimpleNamespace(
        _MYPOS_STATS_LOADED=False,
        _TOKEN_TAG_COUNTS={},
        _TAG_UNIGRAM_COUNTS={},
        _TAG_BIGRAM_COUNTS={},
        _LEXICAL_TAG_PRIORS={},
        _TAG_TRANSITION_LOGPROBS={},
    )


state = feature_state("pos_statistics", _new_state)
