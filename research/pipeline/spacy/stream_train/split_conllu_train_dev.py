#!/usr/bin/env python3
"""
Merge one or more CoNLL-U files, shuffle by sentence, and split into train/dev.

Keeps sentence-level comments with their sentence.
Drops multi-word tokens and empty nodes by default when re-emitting.
"""

from __future__ import annotations

import argparse
import random
from pathlib import Path


def iter_conllu_sentences_with_comments(path: Path) -> list[list[str]]:
    sentences: list[list[str]] = []
    buf: list[str] = []
    with path.open("r", encoding="utf-8", errors="replace") as f:
        for raw in f:
            line = raw.rstrip("\n")
            if not line.strip():
                if buf:
                    sentences.append(buf)
                    buf = []
                continue
            buf.append(line)
    if buf:
        sentences.append(buf)
    return sentences


def normalize_sentence_lines(lines: list[str]) -> list[str]:
    out: list[str] = []
    for line in lines:
        if line.startswith("#"):
            out.append(line)
            continue
        cols = line.split("\t")
        if len(cols) < 8:
            continue
        tid = cols[0]
        if "-" in tid or "." in tid:
            continue
        out.append(line)
    return out


def write_conllu(path: Path, sents: list[list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        for sent in sents:
            for line in sent:
                f.write(line + "\n")
            f.write("\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inputs", action="append", required=True, help="Repeatable input CoNLL-U paths")
    ap.add_argument("--out-train", required=True)
    ap.add_argument("--out-dev", required=True)
    ap.add_argument("--dev-ratio", type=float, default=0.10)
    ap.add_argument("--seed", type=int, default=1337)
    args = ap.parse_args()

    inputs = [Path(p) for p in args.inputs]
    for p in inputs:
        if not p.exists():
            raise SystemExit(f"Missing input: {p}")

    all_sents: list[list[str]] = []
    for p in inputs:
        sents = iter_conllu_sentences_with_comments(p)
        for s in sents:
            ns = normalize_sentence_lines(s)
            if ns:
                all_sents.append(ns)

    rng = random.Random(int(args.seed))
    rng.shuffle(all_sents)

    dev_ratio = float(args.dev_ratio)
    n_dev = int(round(len(all_sents) * dev_ratio))
    dev = all_sents[:n_dev]
    train = all_sents[n_dev:]

    write_conllu(Path(args.out_train), train)
    write_conllu(Path(args.out_dev), dev)
    print(f"WROTE train_sents={len(train)} -> {args.out_train}")
    print(f"WROTE dev_sents={len(dev)} -> {args.out_dev}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

