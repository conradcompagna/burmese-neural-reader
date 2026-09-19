#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Train a non-lexical CRF for OCR-chronicle boundary detection.

Labels are on *boundary positions* (between whitespace-delimited islands):
  - O
  - SENT_END
  - PARA_END   (implies sentence boundary)

The model is intentionally "non-linguistic":
  - No token identity features (no suffixes/prefixes/words).
  - Learns from:
      * junk tokens (punct/digits/bare marks) between Myanmar islands
      * Myanmar punctuation treated like any other junk token
      * short-line paragraph ends by orthographic-cluster count
      * header/title/footnote-ish lines by line-shape (digit/punct density, low Myanmar ratio)

Data sources (existing in this repo):
  - Modern UD: my_burmese-ud-train.conllu
  - OCR chronicle: chronicle1.txt

Outputs (in corpus/):
  - ocr_boundary_struct_v1.crfsuite (+ .meta.json)
  - ocr_boundary_struct_v2.crfsuite (+ .meta.json)
  - ocr_boundary_struct_v3.crfsuite (+ .meta.json)
  - ocr_boundary_struct_best.crfsuite (+ .meta.json)
"""

from __future__ import annotations

import argparse
import json
import random
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from statistics import median
from typing import Any, Dict, Iterable, List, Optional, Sequence as Seq, Tuple

import pycrfsuite

LABEL_O = "O"
LABEL_SENT = "SENT_END"
LABEL_PARA = "PARA_END"


# -----------------------------
# Unicode / token stats
# -----------------------------


def is_myanmar_script(ch: str) -> bool:
    o = ord(ch)
    return (0x1000 <= o <= 0x109F) or (0xA9E0 <= o <= 0xA9FF) or (0xAA60 <= o <= 0xAA7F)


def is_myanmar_letter(ch: str) -> bool:
    if not is_myanmar_script(ch):
        return False
    return unicodedata.category(ch).startswith("L")


def is_myanmar_mark(ch: str) -> bool:
    if not is_myanmar_script(ch):
        return False
    return unicodedata.category(ch).startswith("M")


def token_has_myanmar_letters(tok: str) -> bool:
    return any(is_myanmar_letter(ch) for ch in tok)


def token_has_ascii_letters(tok: str) -> bool:
    return any(("A" <= ch <= "Z") or ("a" <= ch <= "z") for ch in tok)


def token_has_digit(tok: str) -> bool:
    return any(ch.isdigit() for ch in tok)


def token_has_punct_or_symbol(tok: str) -> bool:
    return any(unicodedata.category(ch).startswith(("P", "S")) for ch in tok)


def token_is_bare_mark(tok: str) -> bool:
    if not tok:
        return False
    if any(is_myanmar_letter(ch) for ch in tok):
        return False
    if not any(is_myanmar_mark(ch) for ch in tok):
        return False
    for ch in tok:
        cat = unicodedata.category(ch)
        if is_myanmar_mark(ch):
            continue
        if cat.startswith(("P", "S")):
            continue
        if ch.isdigit():
            continue
        return False
    return True


def token_type(tok: str) -> str:
    """
    Non-lexical token type. A token with Myanmar letters counts as MY (word island).
    Myanmar punctuation like '။'/'၊' is PUNCT (junk) because it has no Myanmar *letters*.
    """
    if not tok:
        return "EMPTY"
    if token_has_myanmar_letters(tok):
        return "MY"
    if token_is_bare_mark(tok):
        return "BARE_MARK"
    if token_has_punct_or_symbol(tok):
        return "PUNCT"
    if token_has_digit(tok):
        return "DIGIT"
    if token_has_ascii_letters(tok):
        return "ASCII"
    return "OTHER"


def token_mixed_junk(tok: str) -> bool:
    """
    Token contains Myanmar letters but also includes junk (punct/symbol/digit/ascii),
    e.g. '...သည်#' or OCR-attached punctuation.
    """
    if not tok:
        return False
    if not token_has_myanmar_letters(tok):
        return False
    return (
        token_has_punct_or_symbol(tok)
        or token_has_digit(tok)
        or token_has_ascii_letters(tok)
        or token_is_bare_mark(tok)
    )


def bucket_int(x: int, cuts: Seq[int]) -> str:
    for c in cuts:
        if x <= c:
            return f"<= {c}"
    return f"> {cuts[-1]}"


def char_class(ch: str) -> str:
    if not ch:
        return "EMPTY"
    if is_myanmar_letter(ch):
        return "MY_L"
    if is_myanmar_mark(ch):
        return "MY_M"
    if ch.isdigit():
        return "DIG"
    cat = unicodedata.category(ch)
    if cat.startswith(("P", "S")):
        return "PUN"
    if ("A" <= ch <= "Z") or ("a" <= ch <= "z"):
        return "ASC"
    return "OTH"


# -----------------------------
# Islandization (whitespace-delimited, preserve whitespace runs)
# -----------------------------


@dataclass(frozen=True)
class Islands:
    islands: List[str]
    gaps: List[str]  # whitespace run after islands[i] (same length as islands)
    leading_ws: str = ""


def islands_and_gaps(text: str) -> Islands:
    islands: List[str] = []
    gaps: List[str] = []
    leading_ws = ""

    i = 0
    n = len(text)
    while i < n:
        if text[i].isspace():
            j = i + 1
            while j < n and text[j].isspace():
                j += 1
            ws = text[i:j]
            if not islands:
                leading_ws += ws
            else:
                gaps[-1] += ws
            i = j
            continue

        j = i + 1
        while j < n and (not text[j].isspace()):
            j += 1
        tok = text[i:j]
        islands.append(tok)
        gaps.append("")
        i = j

    return Islands(islands=islands, gaps=gaps, leading_ws=leading_ws)


# -----------------------------
# Line stats
# -----------------------------


@dataclass(frozen=True)
class LineStats:
    my_clusters: int
    total_islands: int
    digit_islands: int
    punct_islands: int
    baremark_islands: int
    ascii_islands: int


@dataclass(frozen=True)
class DocStats:
    line_for_island: List[int]
    line_stats: List[LineStats]
    line_median: float
    line_mad: float
    line_short: List[bool]


def compute_doc_stats(islands: List[str], gaps: List[str]) -> DocStats:
    line_for_island: List[int] = []
    line_idx = 0
    for i, _tok in enumerate(islands):
        line_for_island.append(line_idx)
        if i < len(gaps) and "\n" in gaps[i]:
            line_idx += gaps[i].count("\n")

    n_lines = (max(line_for_island) + 1) if line_for_island else 0
    my = [0] * n_lines
    tot = [0] * n_lines
    dig = [0] * n_lines
    pun = [0] * n_lines
    bm = [0] * n_lines
    asc = [0] * n_lines

    for tok, li in zip(islands, line_for_island):
        tt = token_type(tok)
        tot[li] += 1
        if tt == "MY":
            my[li] += 1
        elif tt == "DIGIT":
            dig[li] += 1
        elif tt == "PUNCT":
            pun[li] += 1
        elif tt == "BARE_MARK":
            bm[li] += 1
        elif tt == "ASCII":
            asc[li] += 1

    line_stats: List[LineStats] = []
    for li in range(n_lines):
        line_stats.append(
            LineStats(
                my_clusters=my[li],
                total_islands=tot[li],
                digit_islands=dig[li],
                punct_islands=pun[li],
                baremark_islands=bm[li],
                ascii_islands=asc[li],
            )
        )

    # Baseline for "short line": robust median/MAD on "body-ish" lines.
    body_counts: List[int] = []
    for st in line_stats:
        if st.total_islands <= 0:
            continue
        my_ratio = st.my_clusters / st.total_islands
        if st.my_clusters > 0 and my_ratio >= 0.5:
            body_counts.append(st.my_clusters)
    if not body_counts:
        body_counts = [st.my_clusters for st in line_stats if st.my_clusters > 0]

    med = float(median(body_counts)) if body_counts else 0.0
    abs_dev = [abs(x - med) for x in body_counts] if body_counts else []
    mad = float(median(abs_dev)) if abs_dev else 0.0

    short: List[bool] = []
    for st in line_stats:
        if med <= 0.0:
            short.append(False)
            continue
        ratio_rule = st.my_clusters < (0.65 * med)
        mad_rule = (mad > 0.0) and (st.my_clusters < (med - 1.5 * mad))
        short.append(bool(mad_rule or ratio_rule))

    return DocStats(
        line_for_island=line_for_island,
        line_stats=line_stats,
        line_median=med,
        line_mad=mad,
        line_short=short,
    )


# -----------------------------
# Features on boundary positions
# -----------------------------


def line_ratio_bucket(st: LineStats) -> str:
    if st.total_islands <= 0:
        return "empty"
    r = st.my_clusters / st.total_islands
    if r >= 0.9:
        return ">=0.9"
    if r >= 0.7:
        return ">=0.7"
    if r >= 0.5:
        return ">=0.5"
    if r >= 0.3:
        return ">=0.3"
    return "<0.3"


def boundary_features(
    islands: List[str],
    gaps: List[str],
    stats: DocStats,
    i: int,
) -> Dict[str, str]:
    """
    Boundary position i is after islands[i], before islands[i+1].
    """
    prev_tok = islands[i]
    next_tok = islands[i + 1]
    gap = gaps[i] if i < len(gaps) else ""

    prev_t = token_type(prev_tok)
    next_t = token_type(next_tok)

    gap_newlines = gap.count("\n")
    gap_spaces = gap.count(" ")
    gap_tabs = gap.count("\t")

    cur_line = stats.line_for_island[i] if stats.line_for_island else 0
    next_line = stats.line_for_island[i + 1] if stats.line_for_island else 0
    cur_st = stats.line_stats[cur_line] if stats.line_stats else LineStats(0, 0, 0, 0, 0, 0)
    next_st = stats.line_stats[next_line] if stats.line_stats else LineStats(0, 0, 0, 0, 0, 0)

    # Header/title-ish: low Myanmar ratio + digits/punct/ASCII presence.
    def headerish(st: LineStats) -> bool:
        if st.total_islands <= 0:
            return False
        my_ratio = st.my_clusters / st.total_islands
        if my_ratio >= 0.4:
            return False
        return (st.digit_islands + st.punct_islands + st.ascii_islands) >= 2

    feats: Dict[str, str] = {
        # Token types (no identity)
        "prev_t": prev_t,
        "next_t": next_t,
        "prev_mixed_junk": "1" if token_mixed_junk(prev_tok) else "0",
        "next_mixed_junk": "1" if token_mixed_junk(next_tok) else "0",
        "prev_len_b": bucket_int(len(prev_tok), [1, 2, 3, 5, 8, 12]),
        "next_len_b": bucket_int(len(next_tok), [1, 2, 3, 5, 8, 12]),
        # Edge character classes (captures glued punctuation like "...#", "...!", "...)")
        "prev_first_c": char_class(prev_tok[:1]),
        "prev_last_c": char_class(prev_tok[-1:]),
        "next_first_c": char_class(next_tok[:1]),
        "next_last_c": char_class(next_tok[-1:]),
        "prev_ends_punct": "1" if char_class(prev_tok[-1:]) == "PUN" else "0",
        "prev_ends_digit": "1" if char_class(prev_tok[-1:]) == "DIG" else "0",
        "prev_ends_mark": "1" if char_class(prev_tok[-1:]) == "MY_M" else "0",
        # Gap / whitespace regime
        "gap_len_b": bucket_int(len(gap), [0, 1, 2, 3, 5, 8]),
        "gap_spaces_b": bucket_int(gap_spaces, [0, 1, 2, 3, 5, 8]),
        "gap_tabs": "1" if gap_tabs > 0 else "0",
        "gap_nl_b": bucket_int(gap_newlines, [0, 1, 2, 3]),
        "gap_has_newline": "1" if gap_newlines > 0 else "0",
        "gap_blankline": "1" if "\n\n" in gap else "0",
        # Key hypothesis: junk island near boundary
        "next_is_junk": "1" if next_t != "MY" else "0",
        "prev_is_my__next_is_junk": "1" if (prev_t == "MY" and next_t != "MY") else "0",
        "prev_mixed_or_next_junk": "1" if (token_mixed_junk(prev_tok) or (next_t != "MY")) else "0",
        # Line structure
        "is_eol": "1" if gap_newlines > 0 else "0",
        "cur_line_my": bucket_int(cur_st.my_clusters, [0, 1, 2, 3, 5, 8]),
        "cur_line_ratio": line_ratio_bucket(cur_st),
        "cur_line_short": "1"
        if (stats.line_short[cur_line] if stats.line_short else False)
        else "0",
        "cur_line_headerish": "1" if headerish(cur_st) else "0",
        "next_line_ratio": line_ratio_bucket(next_st),
        "next_line_short": "1"
        if (stats.line_short[next_line] if stats.line_short else False)
        else "0",
        "next_line_headerish": "1" if headerish(next_st) else "0",
        # Doc baseline
        "doc_line_med_b": bucket_int(int(round(stats.line_median)), [0, 1, 2, 3, 5, 8, 12]),
        "doc_line_mad_b": bucket_int(int(round(stats.line_mad)), [0, 1, 2, 3]),
    }

    return feats


# -----------------------------
# Modern sentence sources
# -----------------------------


def iter_conllu_sentences(path: Path) -> Iterable[List[str]]:
    sent_tokens: List[str] = []
    with path.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line:
                if sent_tokens:
                    yield sent_tokens
                    sent_tokens = []
                continue
            if line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            tok_id = parts[0]
            if "-" in tok_id or "." in tok_id:
                continue
            form = parts[1]
            if not form:
                continue
            sent_tokens.append(form)
    if sent_tokens:
        yield sent_tokens


def load_myanmar_sentences_from_conllu(path: Path, *, max_sents: int) -> List[List[str]]:
    out: List[List[str]] = []
    for sent in iter_conllu_sentences(path):
        # Keep only "clean" Myanmar word islands so non-linguistic junk cues don't
        # appear inside sentences (we will inject junk at boundaries ourselves).
        toks = [t for t in sent if token_type(t) == "MY" and not token_mixed_junk(t)]
        if len(toks) < 3:
            continue
        out.append(toks)
        if len(out) >= max_sents:
            break
    return out


# -----------------------------
# Chronicle junk pools + silver labels
# -----------------------------


def extract_chronicle_junk_token_pool(text: str, *, max_pool: int) -> List[str]:
    toks = [t for t in text.split() if t]
    pool: List[str] = []
    seen = set()
    for t in toks:
        tt = token_type(t)
        if tt == "MY":
            # Still allow mixed-junk tokens as separators sometimes.
            if token_mixed_junk(t) and t not in seen:
                pool.append(t)
                seen.add(t)
            continue
        # Keep short-ish junk tokens as separators.
        if len(t) > 8:
            continue
        if t not in seen:
            pool.append(t)
            seen.add(t)
        if len(pool) >= max_pool:
            break

    # Always include common Myanmar punctuation as "junk" too.
    for t in ["\u104a", "\u104b", "။", "၊"]:
        if t not in seen:
            pool.append(t)
            seen.add(t)
    return pool


@dataclass(frozen=True)
class LabeledDoc:
    islands: List[str]
    gaps: List[str]
    y: List[str]  # labels per boundary position (len == len(islands)-1)


def label_chronicle_silver(text: str) -> Optional[LabeledDoc]:
    ig = islands_and_gaps(text)
    if len(ig.islands) < 5:
        return None
    stats = compute_doc_stats(ig.islands, ig.gaps)
    y = [LABEL_O] * (len(ig.islands) - 1)

    for i in range(len(y)):
        prev_tok = ig.islands[i]
        next_tok = ig.islands[i + 1]
        gap = ig.gaps[i]

        cur_line = stats.line_for_island[i]
        cur_st = stats.line_stats[cur_line]

        is_eol = "\n" in gap
        line_short = stats.line_short[cur_line]

        my_ratio = (cur_st.my_clusters / cur_st.total_islands) if cur_st.total_islands else 0.0
        headerish = (my_ratio < 0.4) and (
            (cur_st.digit_islands + cur_st.punct_islands + cur_st.ascii_islands) >= 2
        )

        if is_eol and (line_short or headerish or ("\n\n" in gap)):
            y[i] = LABEL_PARA
            continue

        if token_type(prev_tok) == "MY" and (
            token_mixed_junk(prev_tok) or token_type(next_tok) != "MY"
        ):
            y[i] = LABEL_SENT
            continue

    if (LABEL_SENT not in y) and (LABEL_PARA not in y):
        return None
    return LabeledDoc(islands=ig.islands, gaps=ig.gaps, y=y)


def chronicle_middle_slice_lines(text: str, *, skip_lines: int) -> List[str]:
    lines = text.splitlines()
    if len(lines) <= 2 * skip_lines:
        return lines
    return lines[skip_lines:-skip_lines]


def sample_chronicle_blocks(
    rng: random.Random,
    lines: List[str],
    *,
    blocks: int,
    block_size: int,
) -> List[str]:
    if not lines:
        return []
    max_start = max(0, len(lines) - block_size)
    out = []
    for _ in range(blocks):
        s = rng.randint(0, max_start) if max_start > 0 else 0
        out.append("\n".join(lines[s : s + block_size]))
    return out


# -----------------------------
# Synthetic docs from modern sentences
# -----------------------------


def pick_sep_token(rng: random.Random, junk_pool: List[str], *, myanmar_punct_keep: float) -> str:
    """
    At sentence boundaries in synthetic modern docs:
      - keep ~myanmar_punct_keep as Myanmar punctuation
      - otherwise use random junk from chronicle-derived pool
    """
    if rng.random() < myanmar_punct_keep:
        return rng.choice(["\u104a", "\u104b", "။", "၊"])
    return rng.choice(junk_pool) if junk_pool else "#"


def layout_paragraph_into_lines(
    islands: List[str],
    gaps: List[str],
    rng: random.Random,
    *,
    base_line_len: int,
    short_last_max: int,
) -> None:
    """
    Mutates gaps in-place by inserting '\\n' at line ends.
    Enforces the last line in the paragraph to be short (<= short_last_max)
    in terms of Myanmar-cluster count (approx as MY-token count).
    """
    my_flags = [1 if token_type(t) == "MY" else 0 for t in islands]

    idx = 0
    while idx < len(islands):
        rem_my = sum(my_flags[idx:])
        if rem_my <= short_last_max:
            break

        target = max(2, base_line_len + rng.choice([-1, 0, 1]))
        my_count = 0
        j = idx
        while j < len(islands) - 1:
            my_count += my_flags[j]
            if my_count >= target:
                break
            j += 1

        while j > idx and (sum(my_flags[j + 1 :]) <= short_last_max):
            j -= 1

        gaps[j] = "\n"
        idx = j + 1


def build_synth_doc(
    rng: random.Random,
    sentences: List[List[str]],
    junk_pool: List[str],
    *,
    paragraphs_min: int,
    paragraphs_max: int,
    sents_per_para_min: int,
    sents_per_para_max: int,
    myanmar_punct_keep: float,
    attach_sep_prob: float,
    attach_para_end_prob: float,
    base_line_len: int,
    short_last_max: int,
    header_prob: float,
) -> LabeledDoc:
    """
    Build a synthetic multi-paragraph doc with:
      - sentence boundaries represented by junk tokens (incl Myanmar punctuation)
      - paragraph boundaries represented by short ragged last lines
      - occasional header/title lines inserted as separate paragraphs
    """
    assert sentences

    all_islands: List[str] = []
    all_gaps: List[str] = []
    sent_end_positions: set[int] = set()
    para_end_positions: set[int] = set()

    def append_token(tok: str, gap: str = " ") -> None:
        all_islands.append(tok)
        all_gaps.append(gap)

    def mark_sent_end(idx_last_tok: int) -> None:
        if idx_last_tok >= 0:
            sent_end_positions.add(idx_last_tok)

    def mark_para_end(idx_last_tok: int) -> None:
        if idx_last_tok >= 0:
            para_end_positions.add(idx_last_tok)

    pcount = rng.randint(paragraphs_min, paragraphs_max)

    for _p in range(pcount):
        if rng.random() < header_prob:
            n1 = rng.randint(1, 999)
            n2 = rng.randint(1, 999)
            tok_line = [str(n1) + "#", str(n2), rng.choice(junk_pool) if junk_pool else "/", "("]
            sample_sent = rng.choice(sentences)
            for _ in range(rng.randint(1, 3)):
                tok_line.append(rng.choice(sample_sent))
            tok_line.append(")")
            for t in tok_line:
                append_token(t, " ")
            all_gaps[-1] = "\n"
            mark_para_end(len(all_islands) - 1)

        para_islands: List[str] = []
        para_gaps: List[str] = []
        para_sent_ends: set[int] = set()

        k = rng.randint(sents_per_para_min, sents_per_para_max)
        for si in range(k):
            sent = rng.choice(sentences)
            for t in sent:
                para_islands.append(t)
                para_gaps.append(" ")

            if si < k - 1:
                para_sent_ends.add(len(para_islands) - 1)
                sep_tok = pick_sep_token(rng, junk_pool, myanmar_punct_keep=myanmar_punct_keep)
                # Simulate OCR that sometimes glues punctuation/junk to the previous Myanmar token.
                if sep_tok and (rng.random() < attach_sep_prob):
                    para_islands[-1] = para_islands[-1] + sep_tok
                else:
                    para_islands.append(sep_tok)
                    para_gaps.append(" ")

        para_para_end = len(para_islands) - 1
        # Also simulate paragraph-final glued markers like "...သည်#" at some rate.
        if para_islands and (rng.random() < attach_para_end_prob):
            para_islands[-1] = para_islands[-1] + pick_sep_token(
                rng, junk_pool, myanmar_punct_keep=myanmar_punct_keep
            )

        layout_paragraph_into_lines(
            para_islands,
            para_gaps,
            rng,
            base_line_len=base_line_len,
            short_last_max=short_last_max,
        )
        para_gaps[-1] = "\n"

        offset = len(all_islands)
        all_islands.extend(para_islands)
        all_gaps.extend(para_gaps)

        for idx in para_sent_ends:
            mark_sent_end(offset + idx)
        mark_para_end(offset + para_para_end)

    y: List[str] = []
    for i in range(len(all_islands) - 1):
        if i in para_end_positions:
            y.append(LABEL_PARA)
        elif i in sent_end_positions:
            y.append(LABEL_SENT)
        else:
            y.append(LABEL_O)

    return LabeledDoc(islands=all_islands, gaps=all_gaps, y=y)


# -----------------------------
# Train / eval
# -----------------------------


def to_xy(doc: LabeledDoc) -> Tuple[List[Dict[str, str]], List[str]]:
    stats = compute_doc_stats(doc.islands, doc.gaps)
    X = [boundary_features(doc.islands, doc.gaps, stats, i) for i in range(len(doc.islands) - 1)]
    return X, doc.y


def prf(tp: int, fp: int, fn: int) -> Tuple[float, float, float]:
    p = tp / (tp + fp) if (tp + fp) else 0.0
    r = tp / (tp + fn) if (tp + fn) else 0.0
    f = (2 * p * r / (p + r)) if (p + r) else 0.0
    return p, r, f


def eval_docs(model_path: Path, docs: List[LabeledDoc], *, name: str) -> Dict[str, Any]:
    tagger = pycrfsuite.Tagger()
    tagger.open(str(model_path))

    out: Dict[str, Any] = {}

    # Any-boundary vs O
    tp = fp = fn = 0
    for d in docs:
        X, y = to_xy(d)
        pred = tagger.tag(X)
        for yi, pi in zip(y, pred):
            g = yi != LABEL_O
            p_ = pi != LABEL_O
            if p_ and g:
                tp += 1
            elif p_ and not g:
                fp += 1
            elif (not p_) and g:
                fn += 1
    P, R, F = prf(tp, fp, fn)
    out["any"] = {"P": P, "R": R, "F1": F, "tp": tp, "fp": fp, "fn": fn}

    # per-label
    for lab in [LABEL_SENT, LABEL_PARA]:
        tp = fp = fn = 0
        for d in docs:
            X, y = to_xy(d)
            pred = tagger.tag(X)
            for yi, pi in zip(y, pred):
                g = yi == lab
                p_ = pi == lab
                if p_ and g:
                    tp += 1
                elif p_ and not g:
                    fp += 1
                elif (not p_) and g:
                    fn += 1
        P, R, F = prf(tp, fp, fn)
        out[lab] = {"P": P, "R": R, "F1": F, "tp": tp, "fp": fp, "fn": fn}

    print(f"\n=== {name} ===")
    print(
        f"ANY:     P={out['any']['P']:.4f} R={out['any']['R']:.4f} F1={out['any']['F1']:.4f} (tp={out['any']['tp']} fp={out['any']['fp']} fn={out['any']['fn']})"
    )
    for lab in [LABEL_SENT, LABEL_PARA]:
        r = out[lab]
        print(
            f"{lab:8s} P={r['P']:.4f} R={r['R']:.4f} F1={r['F1']:.4f} (tp={r['tp']} fp={r['fp']} fn={r['fn']})"
        )

    return out


def heuristic_target_test(model_path: Path, text_path: Path) -> None:
    """
    No-gold target test: agreement with the intended *mechanical* rules:
      - sentence break whenever MY token is followed by a non-MY token (junk) OR prev has mixed junk
      - paragraph break when end-of-line AND line is short (cluster count)
    """
    raw = text_path.read_text(encoding="utf-8", errors="replace")
    ig = islands_and_gaps(raw)
    if len(ig.islands) < 5:
        print(f"TARGET({text_path.name}): too few islands")
        return

    stats = compute_doc_stats(ig.islands, ig.gaps)
    X = [boundary_features(ig.islands, ig.gaps, stats, i) for i in range(len(ig.islands) - 1)]

    tagger = pycrfsuite.Tagger()
    tagger.open(str(model_path))
    pred = tagger.tag(X)

    gold_sent = set()
    gold_para = set()
    for i in range(len(pred)):
        prev_tok = ig.islands[i]
        next_tok = ig.islands[i + 1]
        gap = ig.gaps[i]
        cur_line = stats.line_for_island[i]
        cur_short = stats.line_short[cur_line]

        if ("\n" in gap) and cur_short:
            gold_para.add(i)
        if token_type(prev_tok) == "MY" and (
            token_mixed_junk(prev_tok) or token_type(next_tok) != "MY"
        ):
            gold_sent.add(i)

    pred_sent = {i for i, p in enumerate(pred) if p == LABEL_SENT}
    pred_para = {i for i, p in enumerate(pred) if p == LABEL_PARA}

    sent_hit = len(gold_sent & pred_sent)
    para_hit = len(gold_para & pred_para)

    sent_rec = (sent_hit / len(gold_sent)) if gold_sent else 0.0
    para_rec = (para_hit / len(gold_para)) if gold_para else 0.0

    print(f"\n=== TARGET HEURISTIC AGREEMENT ({text_path.name}) ===")
    print(
        f"heur_SENT gold={len(gold_sent)} pred={len(pred_sent)} hit={sent_hit} recall={sent_rec:.3f}"
    )
    print(
        f"heur_PARA gold={len(gold_para)} pred={len(pred_para)} hit={para_hit} recall={para_rec:.3f}"
    )


def train_one(
    out_model: Path,
    train_docs: List[LabeledDoc],
    *,
    c1: float,
    c2: float,
    max_iter: int,
    seed: int,
) -> None:
    rng = random.Random(seed)
    rng.shuffle(train_docs)

    trainer = pycrfsuite.Trainer(verbose=True)
    trainer.set_params(
        {
            "c1": float(c1),
            "c2": float(c2),
            "max_iterations": int(max_iter),
            "feature.possible_transitions": True,
        }
    )

    for d in train_docs:
        X, y = to_xy(d)
        if not X:
            continue
        trainer.append(X, y)

    out_model.parent.mkdir(parents=True, exist_ok=True)
    trainer.train(str(out_model))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ud_conllu", type=Path, default=Path("my_burmese-ud-train.conllu"))
    ap.add_argument("--chronicle_txt", type=Path, default=Path("chronicle1.txt"))
    ap.add_argument("--target_text", type=Path, default=Path("corpus/problem_snippet.txt"))
    ap.add_argument(
        "--out_prefix",
        type=str,
        default="ocr_boundary_struct",
        help="Model name prefix under corpus/.",
    )
    ap.add_argument("--seed", type=int, default=1337)

    ap.add_argument("--max_ud_sents", type=int, default=50000)
    ap.add_argument("--synth_docs", type=int, default=5000)
    ap.add_argument("--dev_ratio", type=float, default=0.10)

    ap.add_argument("--chron_skip_lines", type=int, default=800)
    ap.add_argument("--chron_blocks", type=int, default=80)
    ap.add_argument("--chron_block_size", type=int, default=50)
    ap.add_argument("--chron_blocks_dev", type=int, default=20)

    ap.add_argument("--junk_pool", type=int, default=5000)

    ap.add_argument("--base_line_len", type=int, default=6)
    ap.add_argument("--short_last_max", type=int, default=3)
    ap.add_argument("--myanmar_punct_keep", type=float, default=0.20)
    ap.add_argument(
        "--attach_sep_prob",
        type=float,
        default=0.50,
        help="Prob of gluing separator to previous token at SENT_END.",
    )
    ap.add_argument(
        "--attach_para_end_prob",
        type=float,
        default=0.35,
        help="Prob of gluing junk to paragraph-final token.",
    )
    ap.add_argument("--header_prob", type=float, default=0.10)
    ap.add_argument(
        "--chron_upweight",
        type=int,
        default=2,
        help="Replicate chronicle silver blocks in training.",
    )

    ap.add_argument("--max_iter", type=int, default=250)
    args = ap.parse_args()

    rng = random.Random(args.seed)

    if not args.ud_conllu.exists():
        raise SystemExit(f"Missing UD conllu: {args.ud_conllu}")
    if not args.chronicle_txt.exists():
        raise SystemExit(f"Missing chronicle text: {args.chronicle_txt}")

    print("Loading UD sentences...")
    ud_sents = load_myanmar_sentences_from_conllu(args.ud_conllu, max_sents=int(args.max_ud_sents))
    print("UD sentences:", len(ud_sents))

    chron_raw = args.chronicle_txt.read_text(encoding="utf-8", errors="replace")
    chron_mid_lines = chronicle_middle_slice_lines(chron_raw, skip_lines=int(args.chron_skip_lines))

    print("Extracting chronicle junk pool...")
    junk_pool = extract_chronicle_junk_token_pool(
        "\n".join(chron_mid_lines[:5000]), max_pool=int(args.junk_pool)
    )
    print("junk_pool size:", len(junk_pool))

    print("Building synthetic docs...")
    synth = [
        build_synth_doc(
            rng,
            ud_sents,
            junk_pool,
            paragraphs_min=1,
            paragraphs_max=3,
            sents_per_para_min=3,
            sents_per_para_max=8,
            myanmar_punct_keep=float(args.myanmar_punct_keep),
            attach_sep_prob=float(args.attach_sep_prob),
            attach_para_end_prob=float(args.attach_para_end_prob),
            base_line_len=int(args.base_line_len),
            short_last_max=int(args.short_last_max),
            header_prob=float(args.header_prob),
        )
        for _ in range(int(args.synth_docs))
    ]

    n_dev = max(1, int(round(len(synth) * float(args.dev_ratio))))
    rng.shuffle(synth)
    synth_dev = synth[:n_dev]
    synth_train = synth[n_dev:]
    print(f"synth: train={len(synth_train)} dev={len(synth_dev)}")

    print("Building chronicle silver blocks...")
    chron_train_blocks = sample_chronicle_blocks(
        rng,
        chron_mid_lines,
        blocks=int(args.chron_blocks),
        block_size=int(args.chron_block_size),
    )
    chron_dev_blocks = sample_chronicle_blocks(
        rng,
        chron_mid_lines,
        blocks=int(args.chron_blocks_dev),
        block_size=int(args.chron_block_size),
    )
    chron_train = [d for b in chron_train_blocks if (d := label_chronicle_silver(b)) is not None]
    chron_dev = [d for b in chron_dev_blocks if (d := label_chronicle_silver(b)) is not None]
    print(f"chron_silver: train={len(chron_train)} dev={len(chron_dev)}")

    train_docs = synth_train + (chron_train * max(1, int(args.chron_upweight)))
    rng.shuffle(train_docs)

    variants = [
        ("v1", 0.05, 0.01),
        ("v2", 0.10, 0.01),
        ("v3", 0.02, 0.005),
    ]

    corpus_dir = Path("corpus")
    best_name = ""
    best_score = -1.0
    best_path: Optional[Path] = None

    for name, c1, c2 in variants:
        out_model = corpus_dir / f"{args.out_prefix}_{name}.crfsuite"
        meta_path = out_model.with_suffix(out_model.suffix + ".meta.json")

        print("\n" + "=" * 72)
        print(f"TRAIN {name}: c1={c1} c2={c2} max_iter={int(args.max_iter)}")
        print("=" * 72)

        train_one(
            out_model, train_docs, c1=c1, c2=c2, max_iter=int(args.max_iter), seed=int(args.seed)
        )

        synth_metrics = eval_docs(out_model, synth_dev, name=f"{name} synth.dev")
        chron_metrics = eval_docs(out_model, chron_dev, name=f"{name} chron.silver.dev")

        score = float(synth_metrics["any"]["F1"]) * 0.7 + float(chron_metrics["any"]["F1"]) * 0.3
        print(f"{name} score={score:.4f}")

        meta = {
            "name": name,
            "c1": c1,
            "c2": c2,
            "max_iter": int(args.max_iter),
            "seed": int(args.seed),
            "out_prefix": args.out_prefix,
            "synth_params": {
                "base_line_len": int(args.base_line_len),
                "short_last_max": int(args.short_last_max),
                "myanmar_punct_keep": float(args.myanmar_punct_keep),
                "attach_sep_prob": float(args.attach_sep_prob),
                "attach_para_end_prob": float(args.attach_para_end_prob),
                "header_prob": float(args.header_prob),
            },
            "chron_params": {
                "chron_skip_lines": int(args.chron_skip_lines),
                "chron_blocks": int(args.chron_blocks),
                "chron_block_size": int(args.chron_block_size),
                "chron_blocks_dev": int(args.chron_blocks_dev),
                "chron_upweight": int(args.chron_upweight),
            },
            "train_sizes": {
                "synth_train": len(synth_train),
                "chron_train": len(chron_train),
                "train_total": len(train_docs),
            },
            "dev_sizes": {"synth_dev": len(synth_dev), "chron_dev": len(chron_dev)},
            "metrics": {
                "synth_dev": synth_metrics,
                "chron_silver_dev": chron_metrics,
                "score": score,
            },
            "feature_policy": "non-lexical",
        }
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        print("WROTE:", out_model)
        print("WROTE:", meta_path)

        if score > best_score:
            best_score = score
            best_name = name
            best_path = out_model

    if best_path is None:
        raise SystemExit("No model trained")

    best_out = corpus_dir / f"{args.out_prefix}_best.crfsuite"
    best_meta = best_out.with_suffix(best_out.suffix + ".meta.json")
    best_out.write_bytes(best_path.read_bytes())
    best_meta.write_text(
        json.dumps(
            {"best_variant": best_name, "best_score": best_score, "source_model": str(best_path)},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print("\nBEST:", best_out, "(from", best_path.name, f"score={best_score:.4f})")

    if args.target_text.exists():
        heuristic_target_test(best_out, args.target_text)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
