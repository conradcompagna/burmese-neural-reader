#!/usr/bin/env python3
import json, pickle, argparse
from pathlib import Path
import re

PUNCT_RE = re.compile(r"^[\.\,\!\?\:\;\-\(\)\[\]\{\}\'\"`|/\\]+$")


def is_myanmar(s: str) -> bool:
    return any("\u1000" <= ch <= "\u109F" for ch in s)


def token_shape(tok: str) -> str:
    out = []
    for ch in tok:
        if "\u1000" <= ch <= "\u109F":
            out.append("M")
        elif ch.isdigit():
            out.append("D")
        elif ch.isalpha():
            out.append("A")
        else:
            out.append("P")
    return "".join(out[:12])


def word_features(tokens, upos, tag, i, win=3):
    tok = tokens[i]
    feats = {
        "bias": 1.0,
        "w": tok,
        "wlen": str(min(len(tok), 12)),
        "shape": token_shape(tok),
        "is_myan": str(is_myanmar(tok)),
        "is_punct": str(bool(PUNCT_RE.match(tok))),
        "has_digit": str(any(c.isdigit() for c in tok)),
        "upos": upos[i] or "X",
        "tag": tag[i] or (upos[i] or "X"),
        "suf2": tok[-2:] if len(tok) >= 2 else tok,
        "suf3": tok[-3:] if len(tok) >= 3 else tok,
        "pre2": tok[:2] if len(tok) >= 2 else tok,
    }
    for k in range(1, win + 1):
        if i - k >= 0:
            feats[f"-{k}:w"] = tokens[i - k]
            feats[f"-{k}:upos"] = upos[i - k] or "X"
        else:
            feats[f"BOS{k}"] = True
        if i + k < len(tokens):
            feats[f"+{k}:w"] = tokens[i + k]
            feats[f"+{k}:upos"] = upos[i + k] or "X"
        else:
            feats[f"EOS{k}"] = True

    # simple POS bigrams (match training features)
    if i > 0:
        feats["upos_-1_0"] = (upos[i - 1] or "X") + "_" + (upos[i] or "X")
    if i + 1 < len(tokens):
        feats["upos_0_+1"] = (upos[i] or "X") + "_" + (upos[i + 1] or "X")
    return feats


def make_X(tokens, upos, tag, win):
    return [word_features(tokens, upos, tag, i, win=win) for i in range(len(tokens))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--jsonl", required=True)
    args = ap.parse_args()

    obj = pickle.loads(Path(args.model).read_bytes())
    crf = obj["crf"] if isinstance(obj, dict) and "crf" in obj else obj
    win = int(obj.get("win", 3)) if isinstance(obj, dict) else 3

    tp = fp = fn = 0
    pred_total = gold_total = 0

    with open(args.jsonl, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            tokens = rec["tokens"]
            y = [int(v) for v in rec["sent_end_after"]]
            pos = rec["pos"]
            upos = [p.get("upos", "") for p in pos]
            tag = [p.get("tag", "") for p in pos]

            X = make_X(tokens, upos, tag, win)
            pred = crf.predict_single(X)

            for yi, pi in zip(y, pred):
                gold = yi == 1
                pr = pi in ("E", "B")
                if pr and gold:
                    tp += 1
                elif pr and not gold:
                    fp += 1
                elif (not pr) and gold:
                    fn += 1

            pred_total += sum(1 for pi in pred if pi in ("E", "B"))
            gold_total += sum(y)

    P = tp / (tp + fp) if (tp + fp) else 0.0
    R = tp / (tp + fn) if (tp + fn) else 0.0
    F = (2 * P * R / (P + R)) if (P + R) else 0.0
    print(f"P={P:.4f} R={R:.4f} F1={F:.4f}  (pred={pred_total} gold={gold_total})")


if __name__ == "__main__":
    main()
