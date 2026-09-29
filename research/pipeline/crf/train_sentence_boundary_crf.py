#!/usr/bin/env python3
import argparse, json, pickle, re
from pathlib import Path
import sklearn_crfsuite

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

    if i > 0:
        feats["upos_-1_0"] = (upos[i - 1] or "X") + "_" + (upos[i] or "X")
    if i + 1 < len(tokens):
        feats["upos_0_+1"] = (upos[i] or "X") + "_" + (upos[i + 1] or "X")

    return feats


def record_to_xy(rec, win=3):
    tokens = rec["tokens"]
    pos = rec["pos"]
    y = rec["sent_end_after"]

    upos = [p.get("upos", "") for p in pos]
    tag = [p.get("tag", "") for p in pos]

    X = [word_features(tokens, upos, tag, i, win=win) for i in range(len(tokens))]
    Y = ["E" if int(y[i]) == 1 else "O" for i in range(len(tokens))]
    return X, Y


def load_jsonl(paths):
    recs = []
    for p in paths:
        with open(p, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                recs.append(json.loads(line))
    return recs


def eval_boundary_f1(crf, recs, win=3, name="DEV"):
    tp = fp = fn = 0
    for rec in recs:
        X, Y = record_to_xy(rec, win=win)
        pred = crf.predict_single(X)
        for y, p in zip(Y, pred):
            if p == "E" and y == "E":
                tp += 1
            elif p == "E" and y != "E":
                fp += 1
            elif p != "E" and y == "E":
                fn += 1
    prec = tp / (tp + fp) if (tp + fp) else 0.0
    rec = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = (2 * prec * rec) / (prec + rec) if (prec + rec) else 0.0
    print(f"{name}: P={prec:.4f} R={rec:.4f} F1={f1:.4f} (tp={tp} fp={fp} fn={fn})")
    return f1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", action="append", required=True, help="JSONL training file (repeatable)")
    ap.add_argument("--dev", action="append", required=True, help="JSONL dev file (repeatable)")
    ap.add_argument("--out_model", required=True)
    ap.add_argument("--c1", type=float, default=0.05)
    ap.add_argument("--c2", type=float, default=0.01)
    ap.add_argument("--max_iter", type=int, default=250)
    ap.add_argument("--win", type=int, default=3)
    ap.add_argument("--repeat_chronicle", type=int, default=4, help="Upsample chronicle by repeating its train file N times")
    args = ap.parse_args()

    train_paths = args.train[:]
    upsampled = []
    for p in train_paths:
        upsampled.append(p)
        if "chronicle" in Path(p).name.lower():
            upsampled.extend([p] * (args.repeat_chronicle - 1))
    train_paths = upsampled

    train_recs = load_jsonl(train_paths)
    dev_recs = load_jsonl(args.dev)

    X_train, y_train = [], []
    for rec in train_recs:
        X, Y = record_to_xy(rec, win=args.win)
        X_train.append(X)
        y_train.append(Y)

    crf = sklearn_crfsuite.CRF(
        algorithm="lbfgs",
        c1=args.c1,
        c2=args.c2,
        max_iterations=args.max_iter,
        all_possible_transitions=True,
        verbose=True,
    )

    crf.fit(X_train, y_train)

    eval_boundary_f1(crf, dev_recs, win=args.win, name="DEV(all)")

    out_path = Path(args.out_model)
    if out_path.parent == Path("."):
        out_path = Path("corpus") / out_path.name
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with open(out_path, "wb") as f:
        pickle.dump({"crf": crf, "win": args.win}, f)
    print(f"WROTE model: {out_path}")


if __name__ == "__main__":
    main()

