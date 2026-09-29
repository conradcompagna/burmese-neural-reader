#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Chronicle-only CRF sentence boundary model.

Input JSONL format (per line):
{
  "tokens": [...],
  "pos": [{"upos": "...", "tag": "..."}, ...],
  "sent_end_after": [0/1, 0/1, ...]   # same length as tokens
}

Key ideas:
- Strip punctuation aggressively (model cannot learn "." => split).
- Add sentence-final cue features from burmese_grammar_dictionary.tsv
  (Sentence-final phrase particles (Stc~), Sentence markers (V~, N~)).
- Add top endword unigrams from endword_unigrams_all_labels.tsv (label=SENT_END).
- Add top endwords learned directly from the chronicle training JSONL (captures ဇါ etc).
"""

import argparse
import csv
import json
import pickle
import random
import re
from collections import Counter
from pathlib import Path
from typing import Dict, List, Tuple

import sklearn_crfsuite


# -----------------------------
# Punctuation / normalization
# -----------------------------

MYANMAR_PUNCT = {"\u104a", "\u104b", "။", "၊"}  # Burmese section punctuation and common glyphs
ASCII_PUNCT = set(r""".,;:!?()[]{}"'`|/\-""")
PUNCT_RE = re.compile(r"""^[\.\,\!\?\:\;\-\(\)\[\]\{\}\'\"`|/\\]+$""")
ZERO_WIDTH = {"\u200b", "\u200c", "\u200d", "\ufeff"}


def _is_myanmar_letter(ch: str) -> bool:
    o = ord(ch)
    return (0x1000 <= o <= 0x109F) or (0xA9E0 <= o <= 0xA9FF) or (0xAA60 <= o <= 0xAA7F)


def has_myanmar(s: str) -> bool:
    return any(_is_myanmar_letter(ch) for ch in s)


def strip_punct(tok: str) -> str:
    if tok is None:
        return ""
    for zw in ZERO_WIDTH:
        tok = tok.replace(zw, "")
    if not tok:
        return ""

    def is_strip_char(ch: str) -> bool:
        return (ch in ASCII_PUNCT) or (ch in MYANMAR_PUNCT)

    start, end = 0, len(tok)
    while start < end and is_strip_char(tok[start]):
        start += 1
    while end > start and is_strip_char(tok[end - 1]):
        end -= 1
    return tok[start:end]


def is_punct_token(tok: str) -> bool:
    if not tok:
        return True
    if tok in MYANMAR_PUNCT:
        return True
    if tok in ASCII_PUNCT:
        return True
    if PUNCT_RE.match(tok):
        return True
    return strip_punct(tok) == ""


def keep_token(tok: str) -> bool:
    """
    Keep only Myanmar-ish tokens (or digit-bearing tokens), drop punctuation and roman junk.
    """
    if not tok:
        return False
    if is_punct_token(tok):
        return False
    n = strip_punct(tok)
    if not n:
        return False
    if has_myanmar(n):
        return True
    if any(ch.isdigit() for ch in n):
        return True
    return False


# -----------------------------
# Load cue lexicons
# -----------------------------


def load_grammar_sentence_finals(grammar_tsv: str) -> Dict[str, set]:
    """
    Expects TSV header: burmese\tcategory\tgloss
    We pull two categories:
      - Sentence-final phrase particles (Stc~)
      - Sentence markers (V~, N~)
    """
    finals_all = set()
    finals_stc = set()
    finals_vn = set()

    with open(grammar_tsv, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for r in reader:
            tok = (r.get("burmese") or "").strip()
            cat = (r.get("category") or "").strip()
            if not tok or not cat:
                continue
            if cat == "Sentence-final phrase particles (Stc~)":
                finals_all.add(tok)
                finals_stc.add(tok)
            elif cat == "Sentence markers (V~, N~)":
                finals_all.add(tok)
                finals_vn.add(tok)

    return {"finals_all": finals_all, "finals_stc": finals_stc, "finals_vn": finals_vn}


def load_endword_unigrams(endword_tsv: str, label: str = "SENT_END", top_k: int = 300) -> Tuple[set, Dict[str, int]]:
    """
    Expects TSV header: label\trank\tunigram\tcount
    Returns:
      - set of top-K unigrams
      - rank map unigram -> rank
    """
    items = []
    with open(endword_tsv, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for r in reader:
            if (r.get("label") or "").strip() != label:
                continue
            uni = (r.get("unigram") or "").strip()
            if not uni:
                continue
            try:
                rank = int(r.get("rank") or 10**9)
            except ValueError:
                rank = 10**9
            items.append((rank, uni))

    items.sort(key=lambda x: x[0])
    items = items[:top_k]
    s = set(u for _, u in items)
    rank_map = {u: rk for rk, u in items}
    return s, rank_map


# -----------------------------
# Load / preprocess JSONL
# -----------------------------


def load_jsonl(path: str) -> List[dict]:
    recs = []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            recs.append(json.loads(line))
    return recs


def filter_sequence(tokens: List[str], y: List[int], pos: List[dict]) -> Tuple[List[str], List[int], List[dict]]:
    """
    Remove punctuation/junk tokens while preserving boundaries.
    If a removed token had y[i]==1, carry that boundary to the previous kept token.
    """
    out_t, out_y, out_p = [], [], []
    pending_boundary = False

    for tok, yi, pi in zip(tokens, y, pos):
        yi = int(yi)
        if not keep_token(tok):
            if yi == 1:
                pending_boundary = True
            continue

        out_t.append(tok)
        out_p.append(pi if isinstance(pi, dict) else {})

        if yi == 1 or pending_boundary:
            out_y.append(1)
            pending_boundary = False
        else:
            out_y.append(0)

    if pending_boundary and out_y:
        out_y[-1] = 1

    return out_t, out_y, out_p


def get_upos(p: dict) -> str:
    u = (p.get("upos") or "").strip()
    return u if u else "X"


def get_tag(p: dict) -> str:
    t = (p.get("tag") or "").strip()
    if t:
        return t
    u = (p.get("upos") or "").strip()
    return u if u else "X"


# -----------------------------
# Feature extraction
# -----------------------------


def token_shape(tok: str) -> str:
    out = []
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


def rank_bucket(rank: int) -> str:
    if rank <= 10:
        return "r<=10"
    if rank <= 50:
        return "r<=50"
    if rank <= 200:
        return "r<=200"
    return "r>200"


def word_features(
    tokens: List[str],
    pos: List[dict],
    i: int,
    win: int,
    gram: Dict[str, set],
    modern_end: set,
    modern_rank: Dict[str, int],
    chron_end: set,
    chron_rank: Dict[str, int],
) -> Dict[str, object]:
    tok = tokens[i]
    n = strip_punct(tok)
    p = pos[i] if pos else {}

    up = get_upos(p)
    tg = get_tag(p)

    feats: Dict[str, object] = {
        "bias": 1.0,
        "w": tok,
        "n": n,
        "shape": token_shape(tok),
        "len": str(min(len(tok), 12)),
        "is_myan": str(has_myanmar(n)),
        "has_digit": str(any(ch.isdigit() for ch in n)),
        "upos": up,
        "tag": tg,
        "suf1": n[-1:] if len(n) >= 1 else n,
        "suf2": n[-2:] if len(n) >= 2 else n,
        "suf3": n[-3:] if len(n) >= 3 else n,
        "pre1": n[:1] if len(n) >= 1 else n,
        "pre2": n[:2] if len(n) >= 2 else n,
        "gram_final_any": str(n in gram["finals_all"]),
        "gram_final_stc": str(n in gram["finals_stc"]),
        "gram_final_vn": str(n in gram["finals_vn"]),
        "modern_end": str(n in modern_end),
        "chron_end": str(n in chron_end),
    }

    if n in modern_rank:
        feats["modern_rank_bucket"] = rank_bucket(modern_rank[n])
    if n in chron_rank:
        feats["chron_rank_bucket"] = rank_bucket(chron_rank[n])

    for k in range(1, win + 1):
        if i - k >= 0:
            t = tokens[i - k]
            nn = strip_punct(t)
            pp = pos[i - k] if pos else {}
            feats[f"-{k}:n"] = nn
            feats[f"-{k}:upos"] = get_upos(pp)
            feats[f"-{k}:gram_final"] = str(nn in gram["finals_all"])
            feats[f"-{k}:chron_end"] = str(nn in chron_end)
        else:
            feats[f"BOS{k}"] = True

        if i + k < len(tokens):
            t = tokens[i + k]
            nn = strip_punct(t)
            pp = pos[i + k] if pos else {}
            feats[f"+{k}:n"] = nn
            feats[f"+{k}:upos"] = get_upos(pp)
            feats[f"+{k}:gram_final"] = str(nn in gram["finals_all"])
        else:
            feats[f"EOS{k}"] = True

    if i > 0:
        feats["upos_-1_0"] = (get_upos(pos[i - 1]) if pos else "X") + "_" + up
    if i + 1 < len(tokens):
        feats["upos_0_+1"] = up + "_" + (get_upos(pos[i + 1]) if pos else "X")

    if i > 0:
        feats["n_-1_0"] = strip_punct(tokens[i - 1]) + "_" + n
    if i + 1 < len(tokens):
        feats["n_0_+1"] = n + "_" + strip_punct(tokens[i + 1])

    return feats


def make_X(tokens, pos, win, gram, modern_end, modern_rank, chron_end, chron_rank):
    return [word_features(tokens, pos, i, win, gram, modern_end, modern_rank, chron_end, chron_rank) for i in range(len(tokens))]


def make_y(sent_end_after: List[int]) -> List[str]:
    return ["E" if int(v) == 1 else "O" for v in sent_end_after]


# -----------------------------
# Train / eval
# -----------------------------


def concat_records(records: List[Tuple[List[str], List[int], List[dict]]], cmin: int, cmax: int, seed: int):
    rng = random.Random(seed)
    out = []
    i = 0
    while i < len(records):
        n = rng.randint(cmin, cmax)
        tt, yy, pp = [], [], []
        for j in range(n):
            if i + j >= len(records):
                break
            t, y, p = records[i + j]
            tt.extend(t)
            yy.extend(y)
            pp.extend(p)
        if tt:
            out.append((tt, yy, pp))
        i += n
    return out


def prf(tp, fp, fn):
    P = tp / (tp + fp) if (tp + fp) else 0.0
    R = tp / (tp + fn) if (tp + fn) else 0.0
    F = (2 * P * R / (P + R)) if (P + R) else 0.0
    return P, R, F


def eval_model(crf, sequences_X, sequences_y):
    tp = fp = fn = 0
    pred_total = gold_total = 0
    for X, y in zip(sequences_X, sequences_y):
        pred = crf.predict_single(X)
        for yi, pi in zip(y, pred):
            gold = yi == "E"
            pr = pi == "E"
            if pr and gold:
                tp += 1
            elif pr and not gold:
                fp += 1
            elif (not pr) and gold:
                fn += 1
        pred_total += sum(1 for p in pred if p == "E")
        gold_total += sum(1 for yi in y if yi == "E")
    P, R, F = prf(tp, fp, fn)
    return P, R, F, pred_total, gold_total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train_jsonl", required=True)
    ap.add_argument("--dev_jsonl", required=True)
    ap.add_argument("--grammar_tsv", required=True)
    ap.add_argument("--endword_tsv", required=True)
    ap.add_argument("--out_model", required=True)
    ap.add_argument("--win", type=int, default=3)
    ap.add_argument("--max_iter", type=int, default=400)
    ap.add_argument("--c1", type=float, default=0.05)
    ap.add_argument("--c2", type=float, default=0.01)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--top_modern_end", type=int, default=300)
    ap.add_argument("--top_chron_end", type=int, default=1200)
    ap.add_argument("--concat_min", type=int, default=1)
    ap.add_argument("--concat_max", type=int, default=3)
    args = ap.parse_args()

    random.seed(args.seed)

    gram = load_grammar_sentence_finals(args.grammar_tsv)
    modern_end, modern_rank = load_endword_unigrams(args.endword_tsv, label="SENT_END", top_k=args.top_modern_end)

    train_raw = load_jsonl(args.train_jsonl)
    dev_raw = load_jsonl(args.dev_jsonl)

    train_seq = []
    for rec in train_raw:
        toks = rec["tokens"]
        y = rec["sent_end_after"]
        pos = rec.get("pos") or [{} for _ in toks]
        t2, y2, p2 = filter_sequence(toks, y, pos)
        if t2:
            train_seq.append((t2, y2, p2))

    dev_seq = []
    for rec in dev_raw:
        toks = rec["tokens"]
        y = rec["sent_end_after"]
        pos = rec.get("pos") or [{} for _ in toks]
        t2, y2, p2 = filter_sequence(toks, y, pos)
        if t2:
            dev_seq.append((t2, y2, p2))

    end_ctr = Counter()
    for toks, y, _pos in train_seq:
        for tok, yi in zip(toks, y):
            if yi == 1:
                end_ctr[strip_punct(tok)] += 1
    chron_items = end_ctr.most_common(args.top_chron_end)
    chron_end = set(w for w, _c in chron_items)
    chron_rank = {w: (i + 1) for i, (w, _c) in enumerate(chron_items)}

    train_seq2 = concat_records(train_seq, args.concat_min, args.concat_max, seed=args.seed)
    dev_seq2 = concat_records(dev_seq, 1, 1, seed=args.seed)

    X_train, y_train = [], []
    for toks, y, pos in train_seq2:
        X_train.append(make_X(toks, pos, args.win, gram, modern_end, modern_rank, chron_end, chron_rank))
        y_train.append(make_y(y))

    X_dev, y_dev = [], []
    for toks, y, pos in dev_seq2:
        X_dev.append(make_X(toks, pos, args.win, gram, modern_end, modern_rank, chron_end, chron_rank))
        y_dev.append(make_y(y))

    print("TRAIN sequences:", len(X_train), "DEV sequences:", len(X_dev))
    print("Grammar finals:", len(gram["finals_all"]), "(Stc:", len(gram["finals_stc"]), "VN:", len(gram["finals_vn"]), ")")
    print("Modern endwords:", len(modern_end), "Chronicle endwords:", len(chron_end))

    crf = sklearn_crfsuite.CRF(
        algorithm="lbfgs",
        c1=args.c1,
        c2=args.c2,
        max_iterations=args.max_iter,
        all_possible_transitions=True,
        verbose=True,
    )
    crf.fit(X_train, y_train)

    P, R, F, pred_total, gold_total = eval_model(crf, X_dev, y_dev)
    print(f"DEV: P={P:.4f} R={R:.4f} F1={F:.4f} (pred={pred_total} gold={gold_total})")

    out_path = Path(args.out_model)
    if out_path.parent == Path("."):
        out_path = Path("corpus") / out_path.name
    out_path.parent.mkdir(parents=True, exist_ok=True)

    out_obj = {
        "crf": crf,
        "win": args.win,
        "meta": {
            "train_jsonl": args.train_jsonl,
            "dev_jsonl": args.dev_jsonl,
            "max_iter": args.max_iter,
            "c1": args.c1,
            "c2": args.c2,
            "top_modern_end": args.top_modern_end,
            "top_chron_end": args.top_chron_end,
            "concat_min": args.concat_min,
            "concat_max": args.concat_max,
            "seed": args.seed,
            "dev_P": P,
            "dev_R": R,
            "dev_F1": F,
            "dev_pred": pred_total,
            "dev_gold": gold_total,
        },
        "grammar_sets": {
            "finals_all": sorted(list(gram["finals_all"])),
            "finals_stc": sorted(list(gram["finals_stc"])),
            "finals_vn": sorted(list(gram["finals_vn"])),
        },
        "modern_endwords": sorted(list(modern_end)),
        "chron_endwords": sorted(list(chron_end)),
        "chron_endword_counts_top50": chron_items[:50],
    }

    out_path.write_bytes(pickle.dumps(out_obj))
    print("WROTE:", out_path)


if __name__ == "__main__":
    main()

