#!/usr/bin/env python3
# -*- coding: utf-8 -*-

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

MYANMAR_PUNCT = {"\u104a", "\u104b", "။", "၊"}
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
    # Keep Myanmar-ish tokens; drop punctuation and pure non-Myanmar junk.
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
# TSV lexicons
# -----------------------------


def load_grammar_sentence_finals(grammar_tsv: str) -> Dict[str, set]:
    """
    Expects TSV header: burmese\tcategory\tgloss  (at minimum: burmese, category)
    Pull exact categories:
      - Sentence-final phrase particles (Stc~)
      - Sentence markers (V~, N~)
    """
    finals_all = set()
    finals_stc = set()
    finals_vn = set()

    with open(grammar_tsv, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f, delimiter="\t")
        field_b = (
            "burmese"
            if reader.fieldnames and "burmese" in reader.fieldnames
            else (reader.fieldnames[0] if reader.fieldnames else "burmese")
        )
        field_c = (
            "category"
            if reader.fieldnames and "category" in reader.fieldnames
            else (
                reader.fieldnames[1]
                if reader.fieldnames and len(reader.fieldnames) > 1
                else "category"
            )
        )
        for r in reader:
            tok = (r.get(field_b) or "").strip()
            cat = (r.get(field_c) or "").strip()
            if not tok or not cat:
                continue
            if cat == "Sentence-final phrase particles (Stc~)":
                finals_all.add(tok)
                finals_stc.add(tok)
            elif cat == "Sentence markers (V~, N~)":
                finals_all.add(tok)
                finals_vn.add(tok)

    return {"finals_all": finals_all, "finals_stc": finals_stc, "finals_vn": finals_vn}


def load_endword_unigrams(
    endword_tsv: str, label: str = "SENT_END", top_k: int = 300
) -> Tuple[set, Dict[str, int]]:
    """
    Expects TSV header with at least: label, unigram, rank
    """
    items = []
    with open(endword_tsv, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f, delimiter="\t")
        fld_label = (
            "label"
            if reader.fieldnames and "label" in reader.fieldnames
            else (reader.fieldnames[0] if reader.fieldnames else "label")
        )
        fld_rank = (
            "rank"
            if reader.fieldnames and "rank" in reader.fieldnames
            else (
                reader.fieldnames[1] if reader.fieldnames and len(reader.fieldnames) > 1 else "rank"
            )
        )
        fld_uni = (
            "unigram"
            if reader.fieldnames and "unigram" in reader.fieldnames
            else (
                reader.fieldnames[2]
                if reader.fieldnames and len(reader.fieldnames) > 2
                else "unigram"
            )
        )
        for r in reader:
            if (r.get(fld_label) or "").strip() != label:
                continue
            uni = (r.get(fld_uni) or "").strip()
            if not uni:
                continue
            try:
                rk = int(r.get(fld_rank) or 10**9)
            except ValueError:
                rk = 10**9
            items.append((rk, uni))
    items.sort(key=lambda x: x[0])
    items = items[:top_k]
    s = set(u for _, u in items)
    rank_map = {u: rk for rk, u in items}
    return s, rank_map


# -----------------------------
# JSONL loading / preprocessing
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


def filter_sequence(
    tokens: List[str], y: List[int], pos: List[dict]
) -> Tuple[List[str], List[int], List[dict]]:
    """
    Remove punctuation/junk tokens while preserving boundaries.
    If removed token had y[i]==1, carry boundary to previous kept token.
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
# Features
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
    if rank <= 1000:
        return "r<=1000"
    return "r>1000"


def word_features(
    tokens,
    pos,
    i,
    win,
    gram,
    modern_end,
    modern_rank,
    pooled_end,
    pooled_rank,
    chron_end,
    chron_rank,
):
    tok = tokens[i]
    n = strip_punct(tok)
    p = pos[i] if pos else {}

    up = get_upos(p)
    tg = get_tag(p)

    feats = {
        "bias": 1.0,
        "w": tok,
        "n": n,
        "shape": token_shape(tok),
        "len": str(min(len(tok), 12)),
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
        "pooled_end": str(n in pooled_end),
        "chron_end": str(n in chron_end),
    }

    if n in modern_rank:
        feats["modern_rank_bucket"] = rank_bucket(modern_rank[n])
    if n in pooled_rank:
        feats["pooled_rank_bucket"] = rank_bucket(pooled_rank[n])
    if n in chron_rank:
        feats["chron_rank_bucket"] = rank_bucket(chron_rank[n])

    for k in range(1, win + 1):
        if i - k >= 0:
            nn = strip_punct(tokens[i - k])
            pp = pos[i - k] if pos else {}
            feats[f"-{k}:n"] = nn
            feats[f"-{k}:upos"] = get_upos(pp)
            feats[f"-{k}:gram_final"] = str(nn in gram["finals_all"])
            feats[f"-{k}:pooled_end"] = str(nn in pooled_end)
            feats[f"-{k}:chron_end"] = str(nn in chron_end)
        else:
            feats[f"BOS{k}"] = True

        if i + k < len(tokens):
            nn = strip_punct(tokens[i + k])
            pp = pos[i + k] if pos else {}
            feats[f"+{k}:n"] = nn
            feats[f"+{k}:upos"] = get_upos(pp)
            feats[f"+{k}:gram_final"] = str(nn in gram["finals_all"])
            feats[f"+{k}:pooled_end"] = str(nn in pooled_end)
        else:
            feats[f"EOS{k}"] = True

    if i > 0:
        feats["upos_-1_0"] = get_upos(pos[i - 1]) + "_" + up
        feats["tag_-1_0"] = get_tag(pos[i - 1]) + "_" + tg
        feats["n_-1_0"] = strip_punct(tokens[i - 1]) + "_" + n
    if i + 1 < len(tokens):
        feats["upos_0_+1"] = up + "_" + get_upos(pos[i + 1])
        feats["tag_0_+1"] = tg + "_" + get_tag(pos[i + 1])
        feats["n_0_+1"] = n + "_" + strip_punct(tokens[i + 1])

    return feats


def make_X(
    tokens, pos, win, gram, modern_end, modern_rank, pooled_end, pooled_rank, chron_end, chron_rank
):
    return [
        word_features(
            tokens,
            pos,
            i,
            win,
            gram,
            modern_end,
            modern_rank,
            pooled_end,
            pooled_rank,
            chron_end,
            chron_rank,
        )
        for i in range(len(tokens))
    ]


def make_y(sent_end_after):
    return ["E" if int(v) == 1 else "O" for v in sent_end_after]


# -----------------------------
# Helpers: concatenation + weighting
# -----------------------------


def concat_records(records, cmin, cmax, seed):
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


def replicate(records, weight: int):
    if weight <= 1:
        return records
    out = []
    for _ in range(weight):
        out.extend(records)
    return out


def prf(tp, fp, fn):
    P = tp / (tp + fp) if (tp + fp) else 0.0
    R = tp / (tp + fn) if (tp + fn) else 0.0
    F = (2 * P * R / (P + R)) if (P + R) else 0.0
    return P, R, F


def eval_sequences(crf, Xs, ys):
    tp = fp = fn = 0
    pred_total = gold_total = 0
    for X, y in zip(Xs, ys):
        pred = crf.predict_single(X)
        for yi, pi in zip(y, pred):
            g = yi == "E"
            p = pi == "E"
            if p and g:
                tp += 1
            elif p and not g:
                fp += 1
            elif (not p) and g:
                fn += 1
        pred_total += sum(1 for pi in pred if pi == "E")
        gold_total += sum(1 for yi in y if yi == "E")
    P, R, F = prf(tp, fp, fn)
    return P, R, F, pred_total, gold_total


# -----------------------------
# Main
# -----------------------------


def main():
    ap = argparse.ArgumentParser()

    ap.add_argument("--train_jsonl", action="append", required=True)
    ap.add_argument("--dev_jsonl", action="append", required=True)
    ap.add_argument("--corpus_name", action="append", required=True)

    ap.add_argument("--grammar_tsv", required=True)
    ap.add_argument("--endword_tsv", required=True)
    ap.add_argument("--out_model", required=True)

    ap.add_argument("--win", type=int, default=3)
    ap.add_argument("--max_iter", type=int, default=500)
    ap.add_argument("--c1", type=float, default=0.05)
    ap.add_argument("--c2", type=float, default=0.01)
    ap.add_argument("--seed", type=int, default=42)

    ap.add_argument("--top_modern_end", type=int, default=300)
    ap.add_argument("--top_pooled_end", type=int, default=3000)
    ap.add_argument("--top_chron_end", type=int, default=3000)

    ap.add_argument("--concat_min", type=int, default=1)
    ap.add_argument("--concat_max", type=int, default=4)

    ap.add_argument("--w_chronicle", type=int, default=8)
    ap.add_argument("--w_myudtree", type=int, default=1)
    ap.add_argument("--w_alt", type=int, default=1)

    args = ap.parse_args()

    if not (len(args.train_jsonl) == len(args.dev_jsonl) == len(args.corpus_name)):
        raise SystemExit("train_jsonl, dev_jsonl, corpus_name must have same count/order")

    rng = random.Random(args.seed)

    gram = load_grammar_sentence_finals(args.grammar_tsv)
    modern_end, modern_rank = load_endword_unigrams(
        args.endword_tsv, label="SENT_END", top_k=args.top_modern_end
    )

    corp_train = {}
    corp_dev = {}
    for name, tr, dv in zip(args.corpus_name, args.train_jsonl, args.dev_jsonl):
        tr_raw = load_jsonl(tr)
        dv_raw = load_jsonl(dv)

        tr_seq = []
        for rec in tr_raw:
            toks = rec["tokens"]
            y = rec["sent_end_after"]
            pos = rec.get("pos") or [{} for _ in toks]
            t2, y2, p2 = filter_sequence(toks, y, pos)
            if t2:
                tr_seq.append((t2, y2, p2))

        dv_seq = []
        for rec in dv_raw:
            toks = rec["tokens"]
            y = rec["sent_end_after"]
            pos = rec.get("pos") or [{} for _ in toks]
            t2, y2, p2 = filter_sequence(toks, y, pos)
            if t2:
                dv_seq.append((t2, y2, p2))

        corp_train[name] = tr_seq
        corp_dev[name] = dv_seq

    pooled_ctr = Counter()
    for _name, seqs in corp_train.items():
        for toks, y, _ in seqs:
            for tok, yi in zip(toks, y):
                if yi == 1:
                    pooled_ctr[strip_punct(tok)] += 1
    pooled_items = pooled_ctr.most_common(args.top_pooled_end)
    pooled_end = set(w for w, _c in pooled_items)
    pooled_rank = {w: i + 1 for i, (w, _c) in enumerate(pooled_items)}

    chron_ctr = Counter()
    if "chronicle" in corp_train:
        for toks, y, _ in corp_train["chronicle"]:
            for tok, yi in zip(toks, y):
                if yi == 1:
                    chron_ctr[strip_punct(tok)] += 1
    chron_items = chron_ctr.most_common(args.top_chron_end)
    chron_end = set(w for w, _c in chron_items)
    chron_rank = {w: i + 1 for i, (w, _c) in enumerate(chron_items)}

    for name in list(corp_train.keys()):
        corp_train[name] = concat_records(
            corp_train[name], args.concat_min, args.concat_max, seed=args.seed
        )
        corp_dev[name] = concat_records(corp_dev[name], 1, 1, seed=args.seed)

    weights = {"chronicle": args.w_chronicle, "myudtree": args.w_myudtree, "alt": args.w_alt}

    train_all = []
    for name, seqs in corp_train.items():
        w = weights.get(name, 1)
        train_all.extend(replicate(seqs, w))

    rng.shuffle(train_all)

    X_train, y_train = [], []
    for toks, y, pos in train_all:
        X_train.append(
            make_X(
                toks,
                pos,
                args.win,
                gram,
                modern_end,
                modern_rank,
                pooled_end,
                pooled_rank,
                chron_end,
                chron_rank,
            )
        )
        y_train.append(make_y(y))

    dev_by_name = {}
    for name, seqs in corp_dev.items():
        Xd, yd = [], []
        for toks, y, pos in seqs:
            Xd.append(
                make_X(
                    toks,
                    pos,
                    args.win,
                    gram,
                    modern_end,
                    modern_rank,
                    pooled_end,
                    pooled_rank,
                    chron_end,
                    chron_rank,
                )
            )
            yd.append(make_y(y))
        dev_by_name[name] = (Xd, yd)

    X_dev_all, y_dev_all = [], []
    for _name, (Xd, yd) in dev_by_name.items():
        X_dev_all.extend(Xd)
        y_dev_all.extend(yd)

    print("TRAIN pooled sequences:", len(X_train))
    for name in corp_train:
        print(f"TRAIN {name}: {len(corp_train[name])} (weight {weights.get(name, 1)})")
    for name in corp_dev:
        print(f"DEV   {name}: {len(corp_dev[name])}")

    print(
        "Grammar finals:",
        len(gram["finals_all"]),
        "(Stc:",
        len(gram["finals_stc"]),
        "VN:",
        len(gram["finals_vn"]),
        ")",
    )
    print("Modern endwords:", len(modern_end))
    print("Pooled endwords:", len(pooled_end), "Chronicle endwords:", len(chron_end))

    crf = sklearn_crfsuite.CRF(
        algorithm="lbfgs",
        c1=args.c1,
        c2=args.c2,
        max_iterations=args.max_iter,
        all_possible_transitions=True,
        verbose=True,
    )
    crf.fit(X_train, y_train)

    print("\n=== DEV EVAL (per corpus) ===")
    scores = {}
    for name, (Xd, yd) in dev_by_name.items():
        P, R, F, pred_total, gold_total = eval_sequences(crf, Xd, yd)
        scores[name] = (P, R, F, pred_total, gold_total)
        print(f"{name}: P={P:.4f} R={R:.4f} F1={F:.4f} (pred={pred_total} gold={gold_total})")

    print("\n=== DEV EVAL (pooled) ===")
    P, R, F, pred_total, gold_total = eval_sequences(crf, X_dev_all, y_dev_all)
    print(f"pooled: P={P:.4f} R={R:.4f} F1={F:.4f} (pred={pred_total} gold={gold_total})")

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
            "corpus_name": args.corpus_name,
            "weights": weights,
            "max_iter": args.max_iter,
            "c1": args.c1,
            "c2": args.c2,
            "seed": args.seed,
            "top_modern_end": args.top_modern_end,
            "top_pooled_end": args.top_pooled_end,
            "top_chron_end": args.top_chron_end,
            "concat_min": args.concat_min,
            "concat_max": args.concat_max,
            "dev_scores": {
                k: {"P": v[0], "R": v[1], "F1": v[2], "pred": v[3], "gold": v[4]}
                for k, v in scores.items()
            },
            "dev_pooled": {"P": P, "R": R, "F1": F, "pred": pred_total, "gold": gold_total},
        },
        "grammar": {
            "finals_all": sorted(list(gram["finals_all"])),
            "finals_stc": sorted(list(gram["finals_stc"])),
            "finals_vn": sorted(list(gram["finals_vn"])),
        },
        "endwords": {
            "modern_endwords": sorted(list(modern_end)),
            "pooled_endwords_top50": pooled_items[:50],
            "chron_endwords_top50": chron_items[:50],
        },
    }

    out_path.write_bytes(pickle.dumps(out_obj))
    print("\nWROTE:", out_path)


if __name__ == "__main__":
    main()
