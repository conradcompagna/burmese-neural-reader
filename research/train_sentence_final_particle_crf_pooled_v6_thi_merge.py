#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pooled CRF to predict sentence-final particles (boundary after token) with:
  - punctuation ignored (dropped)
  - chronicle sentences filtered by allowed final tokens (grammar TSV + a small extra list)
  - training mix: chronicle 50%, myudtree 25%, alt 25% (by sequence count)
  - v6: augment training to better handle attached `...သည်` forms by fusing
        sentence-final standalone "သည်" into the previous token (X + သည် -> Xသည်)
        inside multi-sentence sequences (avoids EOS shortcut).

Input JSONL (per line):
{
  "tokens": [...],
  "pos": [{"upos": "...", "tag": "..."}, ...],
  "sent_end_after": [0/1, ...]
}
"""

from __future__ import annotations

import argparse
import csv
import json
import pickle
import random
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

import pycrfsuite


# -----------------------------
# Text filtering (punct ignored)
# -----------------------------

MYANMAR_SENT_PUNCT = {"\u104a", "\u104b", "။", "၊"}  # section punctuation + common glyphs
ASCII_PUNCT = set(r""".,;:!?()[]{}"'`|/\-""")
PUNCT_RE = re.compile(r"""^[\.\,\!\?\:\;\-\(\)\[\]\{\}\'\"`|/\\]+$""")
ZERO_WIDTH = {"\u200b", "\u200c", "\u200d", "\ufeff"}


def _is_myanmar_letter(ch: str) -> bool:
    o = ord(ch)
    return (0x1000 <= o <= 0x109F) or (0xA9E0 <= o <= 0xA9FF) or (0xAA60 <= o <= 0xAA7F)


def has_myanmar(s: str) -> bool:
    return any(_is_myanmar_letter(ch) for ch in s)


def _strip_zw(s: str) -> str:
    s = s or ""
    for zw in ZERO_WIDTH:
        s = s.replace(zw, "")
    return s


def strip_punct_edges(tok: str) -> str:
    tok = _strip_zw(tok).strip()
    if not tok:
        return ""

    def is_strip_char(ch: str) -> bool:
        return ch in ASCII_PUNCT or ch in MYANMAR_SENT_PUNCT

    start, end = 0, len(tok)
    while start < end and is_strip_char(tok[start]):
        start += 1
    while end > start and is_strip_char(tok[end - 1]):
        end -= 1
    return tok[start:end].strip()


def is_punct_token(tok: str) -> bool:
    tok = _strip_zw(tok).strip()
    if not tok:
        return True
    if tok in MYANMAR_SENT_PUNCT:
        return True
    if tok in ASCII_PUNCT:
        return True
    if PUNCT_RE.match(tok):
        return True
    return strip_punct_edges(tok) == ""


def keep_token(tok: str) -> bool:
    """
    Keep only Myanmar tokens (punct removed elsewhere).
    """
    if not tok:
        return False
    if is_punct_token(tok):
        return False
    n = strip_punct_edges(tok)
    if not n:
        return False
    return has_myanmar(n)


# -----------------------------
# Grammar TSV (for chronicle filtering)
# -----------------------------


def load_grammar_sentence_finals(grammar_tsv: Path) -> set[str]:
    finals = set()
    keep_cats = {
        "Sentence-final phrase particles (Stc~)",
        "Sentence markers (V~, N~)",
    }
    with grammar_tsv.open("r", encoding="utf-8", errors="replace", newline="") as f:
        r = csv.DictReader(f, delimiter="\t")
        for row in r:
            tok = (row.get("burmese") or "").strip()
            cat = (row.get("category") or "").strip()
            if tok and cat in keep_cats:
                finals.add(tok)
    return finals


# Extra chronicle enders taken from the observed top endword list that are not
# literal entries in the grammar TSV but are clearly "…+sentence-final marker".
CHRONICLE_ALLOWED_EXTRA_ENDERS = {
    # Very common chronicle sentence marker / OCR variant.
    "ဇါ",
    "ဇာ",
    "လေသည်",
    "ဖြစ်သည်",
    "ပါသည်",
    "ဖြစ်စေ",
}

# Some chronicle enders are commonly glued to the previous token in whitespace-tokenized
# text (e.g., "ဟောင်းသည်"). Allow these as suffixes during chronicle filtering so we
# don't drop good training sentences just because tokenization differs.
CHRONICLE_ALLOWED_SUFFIX_ENDERS = {
    "\u101e\u100a\u103a",  # သည်
}


# -----------------------------
# JSONL -> sequences
# -----------------------------


# If these tokens occur anywhere inside a chronicle sentence, treat them as an
# additional sentence boundary (chronicle gold segmentation is noisy).
CHRONICLE_FORCE_INTERNAL_ENDERS = {
    "\u1007\u102b",  # ဇါ
    "\u1007\u102c",  # ဇာ
}


@dataclass(frozen=True)
class Sequence:
    tokens: list[str]
    upos: list[str]
    tag: list[str]
    y: list[int]  # 0/1 boundary-after


def iter_jsonl(path: Path) -> Iterable[dict]:
    with path.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            yield json.loads(line)


def _get_upos(p: dict) -> str:
    u = (p.get("upos") or "").strip()
    return u if u else "X"


def _get_tag(p: dict) -> str:
    t = (p.get("tag") or "").strip()
    if t:
        return t
    return _get_upos(p)


def preprocess_record_to_sequence(
    rec: dict,
    *,
    corpus: str,
    chronicle_allowed_enders: set[str],
) -> Optional[Sequence]:
    tokens = rec.get("tokens") or []
    y = rec.get("sent_end_after") or []
    pos = rec.get("pos") or []
    if not tokens or not y:
        return None

    # Align pos length if missing or mismatched.
    if len(pos) != len(tokens):
        pos = (pos[: len(tokens)] if pos else []) + ([{}] * max(0, len(tokens) - len(pos)))

    out_t: list[str] = []
    out_upos: list[str] = []
    out_tag: list[str] = []
    out_y: list[int] = []

    sent_t: list[str] = []
    sent_up: list[str] = []
    sent_tg: list[str] = []

    def flush_sentence(is_sentence_end: bool) -> None:
        nonlocal sent_t, sent_up, sent_tg, out_t, out_upos, out_tag, out_y
        if not is_sentence_end:
            return

        # Filter tokens (drop punct/non-Myanmar) and normalize token surface.
        kept_t: list[str] = []
        kept_up: list[str] = []
        kept_tg: list[str] = []
        for tok, up, tg in zip(sent_t, sent_up, sent_tg):
            if not keep_token(tok):
                continue
            norm = strip_punct_edges(tok)
            if not norm:
                continue
            kept_t.append(norm)
            kept_up.append(up)
            kept_tg.append(tg)

        sent_t, sent_up, sent_tg = [], [], []

        if not kept_t:
            return

        end_tok = kept_t[-1]
        if corpus == "chronicle":
            ok = end_tok in chronicle_allowed_enders
            if not ok:
                for suf in CHRONICLE_ALLOWED_SUFFIX_ENDERS:
                    if suf and end_tok.endswith(suf):
                        ok = True
                        break
            if not ok:
                return

        out_t.extend(kept_t)
        out_upos.extend(kept_up)
        out_tag.extend(kept_tg)

        y_sent = [0] * len(kept_t)
        if corpus == "chronicle":
            for j, tt in enumerate(kept_t):
                if tt in CHRONICLE_FORCE_INTERNAL_ENDERS:
                    y_sent[j] = 1
        y_sent[-1] = 1
        out_y.extend(y_sent)

    for tok, yi, pi in zip(tokens, y, pos):
        sent_t.append(tok)
        sent_up.append(_get_upos(pi if isinstance(pi, dict) else {}))
        sent_tg.append(_get_tag(pi if isinstance(pi, dict) else {}))

        if int(yi) == 1:
            flush_sentence(True)

    if not out_t:
        return None
    return Sequence(tokens=out_t, upos=out_upos, tag=out_tag, y=out_y)


def load_sequences(
    path: Path,
    *,
    corpus: str,
    chronicle_allowed_enders: set[str],
) -> list[Sequence]:
    seqs: list[Sequence] = []
    for rec in iter_jsonl(path):
        s = preprocess_record_to_sequence(rec, corpus=corpus, chronicle_allowed_enders=chronicle_allowed_enders)
        if s is None:
            continue
        if len(s.tokens) != len(s.y):
            continue
        if 1 not in s.y:
            continue
        seqs.append(s)
    return seqs


# -----------------------------
# Features / training
# -----------------------------


def token_shape(tok: str) -> str:
    out: list[str] = []
    for ch in tok:
        if _is_myanmar_letter(ch):
            out.append("M")
        elif ch.isdigit():
            out.append("D")
        elif ch.isalpha():
            out.append("A")
        else:
            out.append("P")
    return "".join(out[:16])


def word_features(seq: Sequence, i: int, win: int) -> dict[str, str]:
    tok = seq.tokens[i]
    thi = "\u101e\u100a\u103a"  # သည်
    has_thi = thi in tok
    feats: dict[str, str] = {
        "bias": "1",
        "shape": token_shape(tok),
        "len": str(min(len(tok), 12)),
        "has_thi": "1" if has_thi else "0",
        "endswith_thi": "1" if tok.endswith(thi) else "0",
        "suf1": tok[-1:] if len(tok) >= 1 else tok,
        "suf2": tok[-2:] if len(tok) >= 2 else tok,
        "suf3": tok[-3:] if len(tok) >= 3 else tok,
        "pre1": tok[:1] if len(tok) >= 1 else tok,
        "pre2": tok[:2] if len(tok) >= 2 else tok,
    }

    for k in range(1, win + 1):
        if i - k >= 0:
            feats[f"-{k}:suf2"] = seq.tokens[i - k][-2:] if len(seq.tokens[i - k]) >= 2 else seq.tokens[i - k]
            feats[f"-{k}:suf3"] = seq.tokens[i - k][-3:] if len(seq.tokens[i - k]) >= 3 else seq.tokens[i - k]
        else:
            feats[f"BOS{k}"] = "1"

        if i + k < len(seq.tokens):
            feats[f"+{k}:suf2"] = seq.tokens[i + k][-2:] if len(seq.tokens[i + k]) >= 2 else seq.tokens[i + k]
            feats[f"+{k}:suf3"] = seq.tokens[i + k][-3:] if len(seq.tokens[i + k]) >= 3 else seq.tokens[i + k]
        else:
            feats[f"EOS{k}"] = "1"

    return feats


def seq_to_xy(seq: Sequence, win: int) -> tuple[list[dict[str, str]], list[str]]:
    X = [word_features(seq, i, win) for i in range(len(seq.tokens))]
    Y = ["E" if int(seq.y[i]) == 1 else "O" for i in range(len(seq.tokens))]
    return X, Y


def prf(tp: int, fp: int, fn: int) -> tuple[float, float, float]:
    P = tp / (tp + fp) if (tp + fp) else 0.0
    R = tp / (tp + fn) if (tp + fn) else 0.0
    F = (2 * P * R / (P + R)) if (P + R) else 0.0
    return P, R, F


def eval_sequences(model_path: Path, seqs: list[Sequence], win: int, name: str) -> None:
    tagger = pycrfsuite.Tagger()
    tagger.open(str(model_path))

    tp = fp = fn = 0
    pred_total = gold_total = 0
    for seq in seqs:
        X, Y = seq_to_xy(seq, win)
        pred = tagger.tag(X)
        for yi, pi in zip(Y, pred):
            gold = yi == "E"
            pr = pi == "E"
            if pr and gold:
                tp += 1
            elif pr and not gold:
                fp += 1
            elif (not pr) and gold:
                fn += 1
        pred_total += sum(1 for p in pred if p == "E")
        gold_total += sum(1 for y in Y if y == "E")

    P, R, F = prf(tp, fp, fn)
    print(f"{name}: P={P:.4f} R={R:.4f} F1={F:.4f} (pred={pred_total} gold={gold_total})")


def eval_on_whitespace_text(model_path: Path, text_path: Path, win: int) -> None:
    """
    Sanity check on a space-tokenized chronicle snippet where POS is unknown.
    Matches training-time normalization (drop punct/non-Myanmar, strip punct edges),
    then tags with POS forced to X.
    """
    tagger = pycrfsuite.Tagger()
    tagger.open(str(model_path))

    raw = text_path.read_text(encoding="utf-8", errors="replace")
    raw_tokens = [t for t in raw.split() if t]

    tokens: list[str] = []
    for tok in raw_tokens:
        if not keep_token(tok):
            continue
        norm = strip_punct_edges(tok)
        if not norm:
            continue
        tokens.append(norm)

    if not tokens:
        print(f"TARGET({text_path.name}): 0 tokens after filtering")
        return

    seq = Sequence(tokens=tokens, upos=["X"] * len(tokens), tag=["X"] * len(tokens), y=[0] * len(tokens))
    X, _ = seq_to_xy(seq, win)
    pred = tagger.tag(X)

    zhaa = "\u1007\u102b"  # ဇါ
    zhaa_total = sum(1 for t in tokens if t == zhaa)
    zhaa_hit = sum(1 for t, p in zip(tokens, pred) if t == zhaa and p == "E")
    pred_total = sum(1 for p in pred if p == "E")

    print(f"TARGET({text_path.name}): tokens={len(tokens)} pred_E={pred_total} zhaa_hit={zhaa_hit}/{zhaa_total}")


def eval_on_marked_text(model_path: Path, marked_path: Path, win: int) -> tuple[int, int, int]:
    """
    Evaluate on a whitespace-tokenized text that contains literal <SENT_END> tokens.
    We remove the markers from the token stream and treat the token immediately
    preceding each marker as a gold boundary.

    Returns (gold, pred, missed).
    """
    tagger = pycrfsuite.Tagger()
    tagger.open(str(model_path))

    raw = marked_path.read_text(encoding="utf-8", errors="replace")
    raw_tokens = [t for t in raw.split() if t]

    tokens: list[str] = []
    gold = set()

    for rt in raw_tokens:
        if rt == "<SENT_END>":
            if tokens:
                gold.add(len(tokens) - 1)
            continue

        if not keep_token(rt):
            continue
        norm = strip_punct_edges(rt)
        if not norm:
            continue
        tokens.append(norm)

    if not tokens or not gold:
        print(f"MARKED({marked_path.name}): tokens={len(tokens)} gold=0")
        return 0, 0, 0

    seq = Sequence(tokens=tokens, upos=["X"] * len(tokens), tag=["X"] * len(tokens), y=[0] * len(tokens))
    X, _ = seq_to_xy(seq, win)
    pred = tagger.tag(X)
    pred_idx = {i for i, p in enumerate(pred) if p == "E"}

    missed = len([i for i in gold if i not in pred_idx])
    print(
        f"MARKED({marked_path.name}): tokens={len(tokens)} gold={len(gold)} pred={len(pred_idx)} missed={missed} recall={(len(gold)-missed)/len(gold):.3f}"
    )
    return len(gold), len(pred_idx), missed


def eval_on_marked_text_clean(
    model_path: Path,
    marked_path: Path,
    win: int,
    *,
    ignore_next_tokens: set[str],
) -> tuple[int, int, int]:
    """
    Like eval_on_marked_text(), but ignores markers when the next *kept* token is in
    ignore_next_tokens. Useful for removing known oversplits in the hand-marked example
    (e.g., ... သည် <SENT_END> သာမက ...).

    Returns (gold, pred, missed) after ignoring those markers.
    """
    tagger = pycrfsuite.Tagger()
    tagger.open(str(model_path))

    raw = marked_path.read_text(encoding="utf-8", errors="replace")
    raw_tokens = [t for t in raw.split() if t]

    tokens: list[str] = []
    gold = set()
    ignored = 0
    last_kept_idx: Optional[int] = None

    i = 0
    while i < len(raw_tokens):
        rt = raw_tokens[i]
        if rt == "<SENT_END>":
            # find next kept token after marker
            next_tok: Optional[str] = None
            j = i + 1
            while j < len(raw_tokens):
                if raw_tokens[j] == "<SENT_END>":
                    j += 1
                    continue
                if not keep_token(raw_tokens[j]):
                    j += 1
                    continue
                nn = strip_punct_edges(raw_tokens[j])
                if not nn:
                    j += 1
                    continue
                next_tok = nn
                break

            if last_kept_idx is not None:
                if next_tok is not None and next_tok in ignore_next_tokens:
                    ignored += 1
                else:
                    gold.add(last_kept_idx)

            i += 1
            continue

        if keep_token(rt):
            norm = strip_punct_edges(rt)
            if norm:
                tokens.append(norm)
                last_kept_idx = len(tokens) - 1
        i += 1

    if not tokens or not gold:
        print(f"MARKED_CLEAN({marked_path.name}): tokens={len(tokens)} gold=0 ignored={ignored}")
        return 0, 0, 0

    seq = Sequence(tokens=tokens, upos=["X"] * len(tokens), tag=["X"] * len(tokens), y=[0] * len(tokens))
    X, _ = seq_to_xy(seq, win)
    pred = tagger.tag(X)
    pred_idx = {i for i, p in enumerate(pred) if p == "E"}

    missed = len([i for i in gold if i not in pred_idx])
    print(
        f"MARKED_CLEAN({marked_path.name}): tokens={len(tokens)} gold={len(gold)} pred={len(pred_idx)} missed={missed} ignored={ignored} recall={(len(gold)-missed)/len(gold):.3f}"
    )
    return len(gold), len(pred_idx), missed


def eval_thi_hit_rate_on_text(model_path: Path, text_path: Path, win: int) -> None:
    """
    Diagnostic on a whitespace-tokenized file: report how often tokens containing "သည်"
    are predicted as boundaries.
    """
    tagger = pycrfsuite.Tagger()
    tagger.open(str(model_path))

    raw = text_path.read_text(encoding="utf-8", errors="replace")
    raw_tokens = [t for t in raw.split() if t]

    tokens: list[str] = []
    for rt in raw_tokens:
        if not keep_token(rt):
            continue
        norm = strip_punct_edges(rt)
        if not norm:
            continue
        tokens.append(norm)

    if not tokens:
        print(f"THI_HIT({text_path.name}): 0 tokens after filtering")
        return

    seq = Sequence(tokens=tokens, upos=["X"] * len(tokens), tag=["X"] * len(tokens), y=[0] * len(tokens))
    X, _ = seq_to_xy(seq, win)
    pred = tagger.tag(X)

    thi = "\u101e\u100a\u103a"  # သည်
    thi_total = sum(1 for t in tokens if thi in t)
    thi_hit = sum(1 for t, p in zip(tokens, pred) if (thi in t) and p == "E")
    pred_total = sum(1 for p in pred if p == "E")

    print(f"THI_HIT({text_path.name}): tokens={len(tokens)} pred_E={pred_total} thi_hit={thi_hit}/{thi_total}")


def sequence_from_marked_text(
    marked_path: Path,
    *,
    ignore_next_tokens: set[str],
) -> Optional[Sequence]:
    """
    Convert a whitespace-tokenized text that contains literal <SENT_END> tokens into a
    training Sequence. Markers are removed from the token stream and the token
    immediately preceding each (non-ignored) marker is labeled as a boundary.

    If the next *kept* token after a marker is in ignore_next_tokens, that marker is
    treated as an oversplit and ignored.
    """
    raw = marked_path.read_text(encoding="utf-8", errors="replace")
    raw_tokens = [t for t in raw.split() if t]

    tokens: list[str] = []
    gold = set()
    last_kept_idx: Optional[int] = None

    i = 0
    while i < len(raw_tokens):
        rt = raw_tokens[i]
        if rt == "<SENT_END>":
            next_tok: Optional[str] = None
            j = i + 1
            while j < len(raw_tokens):
                if raw_tokens[j] == "<SENT_END>":
                    j += 1
                    continue
                if not keep_token(raw_tokens[j]):
                    j += 1
                    continue
                nn = strip_punct_edges(raw_tokens[j])
                if not nn:
                    j += 1
                    continue
                next_tok = nn
                break

            if last_kept_idx is not None and not (next_tok is not None and next_tok in ignore_next_tokens):
                gold.add(last_kept_idx)

            i += 1
            continue

        if keep_token(rt):
            norm = strip_punct_edges(rt)
            if norm:
                tokens.append(norm)
                last_kept_idx = len(tokens) - 1
        i += 1

    if not tokens or not gold:
        return None

    y = [0] * len(tokens)
    for idx in gold:
        if 0 <= idx < len(y):
            y[idx] = 1

    return Sequence(tokens=tokens, upos=["X"] * len(tokens), tag=["X"] * len(tokens), y=y)


def augment_thi_merge_in_sequences(seqs: list[Sequence]) -> list[Sequence]:
    """
    Create augmented sequences by fusing sentence-final standalone "သည်" into the
    previous token (X + သည် -> Xသည်) while keeping the rest of the multi-sentence
    sequence intact.

    This teaches the model to handle tokenization/OCR variants where the ender is
    glued, without creating single-sentence examples that over-emphasize EOS.
    """
    thi = "\u101e\u100a\u103a"  # သည်
    out: list[Sequence] = []

    for s in seqs:
        if thi not in s.tokens:
            continue

        changed = False
        nt: list[str] = []
        nu: list[str] = []
        ng: list[str] = []
        ny: list[int] = []

        for tok, up, tg, yi in zip(s.tokens, s.upos, s.tag, s.y):
            yi = int(yi)
            if yi == 1 and tok == thi and nt and ny and ny[-1] != 1:
                nt[-1] = nt[-1] + thi
                ny[-1] = 1
                changed = True
                continue

            nt.append(tok)
            nu.append(up)
            ng.append(tg)
            ny.append(yi)

        if changed and nt and len(nt) == len(ny):
            out.append(Sequence(tokens=nt, upos=nu, tag=ng, y=ny))

    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--chron_train", type=Path, default=Path("corpus/chronicle.train.jsonl"))
    ap.add_argument("--chron_dev", type=Path, default=Path("corpus/chronicle.dev.jsonl"))
    ap.add_argument("--myud_train", type=Path, default=Path("corpus/myudtree.train.jsonl"))
    ap.add_argument("--myud_dev", type=Path, default=Path("corpus/myudtree.dev.jsonl"))
    ap.add_argument("--alt_train", type=Path, default=Path("corpus/alt.train.jsonl"))
    ap.add_argument("--alt_dev", type=Path, default=Path("corpus/alt.dev.jsonl"))
    ap.add_argument("--grammar_tsv", type=Path, default=Path("burmese_grammar_dictionary.tsv"))
    ap.add_argument("--out_model", type=Path, default=Path("corpus/burmese_sentence_finalparticle_v6_thi_merge.crfsuite"))
    ap.add_argument("--eval_target", type=Path, default=Path("corpus/target_snippet_space_tok.txt"))
    ap.add_argument("--eval_marked", type=Path, default=Path("corpus/thi_eval_example_marked.txt"))
    ap.add_argument("--eval_problem", type=Path, default=Path("corpus/problem_snippet.txt"))
    ap.add_argument(
        "--ignore_marked_next",
        action="append",
        default=["\u1016\u103c\u1005\u103a", "\u101e\u102c\u1019\u1000"],
        help="Repeatable token(s) after <SENT_END> to ignore as oversplits (default: ဖြစ်, သာမက)",
    )
    ap.add_argument(
        "--thi_merge_max",
        type=int,
        default=200,
        help="Max number of thi-merge augmented sequences to add (0 disables).",
    )
    ap.add_argument("--extra_marked_train", type=Path, default=None, help="Optional <SENT_END>-marked file to add to training.")
    ap.add_argument("--extra_marked_repeat", type=int, default=0, help="Repeat extra_marked_train sequence N times (0 disables).")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--win", type=int, default=3)
    ap.add_argument("--c1", type=float, default=0.1)
    ap.add_argument("--c2", type=float, default=0.01)
    ap.add_argument("--max_iter", type=int, default=150)
    args = ap.parse_args()

    rng = random.Random(args.seed)

    finals = load_grammar_sentence_finals(args.grammar_tsv)
    chron_allowed = set(finals) | set(CHRONICLE_ALLOWED_EXTRA_ENDERS)

    chron_train = load_sequences(args.chron_train, corpus="chronicle", chronicle_allowed_enders=chron_allowed)
    myud_train = load_sequences(args.myud_train, corpus="myudtree", chronicle_allowed_enders=chron_allowed)
    alt_train = load_sequences(args.alt_train, corpus="alt", chronicle_allowed_enders=chron_allowed)

    chron_dev = load_sequences(args.chron_dev, corpus="chronicle", chronicle_allowed_enders=chron_allowed)
    myud_dev = load_sequences(args.myud_dev, corpus="myudtree", chronicle_allowed_enders=chron_allowed)
    alt_dev = load_sequences(args.alt_dev, corpus="alt", chronicle_allowed_enders=chron_allowed)

    # 50% chronicle, 25% myudtree, 25% alt (by sequence count)
    max_other = min(len(myud_train), len(alt_train))
    if len(chron_train) <= 2 * max_other:
        n_chron = len(chron_train)
        n_other_each = n_chron // 2
    else:
        n_other_each = max_other
        n_chron = 2 * n_other_each

    rng.shuffle(chron_train)
    rng.shuffle(myud_train)
    rng.shuffle(alt_train)

    chron_used = chron_train[:n_chron]
    myud_used = myud_train[:n_other_each]
    alt_used = alt_train[:n_other_each]

    train_all = chron_used + myud_used + alt_used
    rng.shuffle(train_all)

    # Augment training with "X + သည် -> Xသည်" variants to better handle glued enders,
    # but keep it capped so we don't dilute positive examples of standalone "သည်".
    aug_merge_all = augment_thi_merge_in_sequences(train_all)
    rng.shuffle(aug_merge_all)
    aug_merge = aug_merge_all[: max(0, int(args.thi_merge_max))] if int(args.thi_merge_max) > 0 else []

    extra_seq_n = 0
    extra_seq: list[Sequence] = []
    if args.extra_marked_repeat and args.extra_marked_train and args.extra_marked_train.exists():
        s = sequence_from_marked_text(args.extra_marked_train, ignore_next_tokens=set(args.ignore_marked_next))
        if s is not None:
            extra_seq_n = int(args.extra_marked_repeat)
            extra_seq = [s] * extra_seq_n

    train_all_aug = train_all + aug_merge + extra_seq
    rng.shuffle(train_all_aug)

    print(f"chronicle_train seqs: {len(chron_train)} used: {len(chron_used)}")
    print(f"myudtree_train  seqs: {len(myud_train)} used: {len(myud_used)}")
    print(f"alt_train       seqs: {len(alt_train)} used: {len(alt_used)}")
    print(
        f"TRAIN pooled sequences: {len(train_all)} (+thi_merge={len(aug_merge)}/{len(aug_merge_all)} cap={int(args.thi_merge_max)} +extra_marked={extra_seq_n} => {len(train_all_aug)})"
    )
    print(
        f"chronicle_allowed_enders: {len(chron_allowed)} (grammar={len(finals)} extra={len(CHRONICLE_ALLOWED_EXTRA_ENDERS)} suffix={len(CHRONICLE_ALLOWED_SUFFIX_ENDERS)})"
    )

    args.out_model.parent.mkdir(parents=True, exist_ok=True)

    trainer = pycrfsuite.Trainer(verbose=True)
    trainer.set_params(
        {
            "c1": float(args.c1),
            "c2": float(args.c2),
            "max_iterations": int(args.max_iter),
            "feature.possible_transitions": True,
        }
    )

    for seq in train_all_aug:
        X, Y = seq_to_xy(seq, args.win)
        trainer.append(X, Y)

    trainer.train(str(args.out_model))
    print(f"WROTE model: {args.out_model}")

    print("\n=== DEV EVAL ===")
    eval_sequences(args.out_model, chron_dev, args.win, "chronicle.dev")
    eval_sequences(args.out_model, myud_dev, args.win, "myudtree.dev")
    eval_sequences(args.out_model, alt_dev, args.win, "alt.dev")
    eval_sequences(args.out_model, chron_dev + myud_dev + alt_dev, args.win, "pooled.dev")

    if args.eval_target and args.eval_target.exists():
        print("\n=== TARGET SNIPPET (whitespace tokens, POS=X) ===")
        eval_on_whitespace_text(args.out_model, args.eval_target, args.win)

    if args.eval_problem and args.eval_problem.exists():
        print("\n=== PROBLEM SNIPPET (thi hit-rate) ===")
        eval_thi_hit_rate_on_text(args.out_model, args.eval_problem, args.win)

    if args.eval_marked and args.eval_marked.exists():
        print("\n=== THI MARKED EVAL (<SENT_END> tokens) ===")
        eval_on_marked_text(args.out_model, args.eval_marked, args.win)
        eval_on_marked_text_clean(
            args.out_model,
            args.eval_marked,
            args.win,
            ignore_next_tokens=set(args.ignore_marked_next),
        )

    # Save a small pickle with metadata + allowed sets for reproducibility.
    meta_path = args.out_model.with_suffix(args.out_model.suffix + ".meta.pkl")
    meta = {
        "model_path": str(args.out_model),
        "win": args.win,
        "seed": args.seed,
        "c1": args.c1,
        "c2": args.c2,
        "max_iter": args.max_iter,
        "chronicle_allowed_enders": sorted(list(chron_allowed)),
        "chronicle_allowed_extra": sorted(list(CHRONICLE_ALLOWED_EXTRA_ENDERS)),
        "chronicle_allowed_suffix_enders": sorted(list(CHRONICLE_ALLOWED_SUFFIX_ENDERS)),
        "chronicle_force_internal_enders": sorted(list(CHRONICLE_FORCE_INTERNAL_ENDERS)),
        "grammar_finals": sorted(list(finals)),
        "eval_marked": str(args.eval_marked) if args.eval_marked else "",
        "ignore_marked_next": list(args.ignore_marked_next),
        "thi_merge_aug": len(aug_merge),
        "thi_merge_max": int(args.thi_merge_max),
        "extra_marked_train": str(args.extra_marked_train) if args.extra_marked_train else "",
        "extra_marked_repeat": int(args.extra_marked_repeat),
        "train_counts": {
            "chronicle_total": len(chron_train),
            "chronicle_used": len(chron_used),
            "myudtree_total": len(myud_train),
            "myudtree_used": len(myud_used),
            "alt_total": len(alt_train),
            "alt_used": len(alt_used),
        },
    }
    meta_path.write_bytes(pickle.dumps(meta))
    print(f"WROTE meta: {meta_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
