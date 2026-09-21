#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional


@dataclass(frozen=True)
class Sentence:
    tokens: list[str]
    upos: list[str]
    tag: list[str]


def iter_conllu_sentences(path: Path) -> Iterable[Sentence]:
    """
    Parse CoNLL-U into Sentence objects.

    - ignores comment lines (# ...)
    - ignores multiword ranges (IDs containing '-')
    - ignores empty nodes (IDs containing '.')
    """
    sent_tokens: list[str] = []
    sent_upos: list[str] = []
    sent_tag: list[str] = []

    def flush():
        nonlocal sent_tokens, sent_upos, sent_tag
        if sent_tokens:
            yield Sentence(tokens=sent_tokens, upos=sent_upos, tag=sent_tag)
        sent_tokens, sent_upos, sent_tag = [], [], []

    with path.open("r", encoding="utf-8") as f:
        for raw in f:
            line = raw.rstrip("\n")
            if not line.strip():
                yield from flush()
                continue
            if line.startswith("#"):
                continue
            cols = line.split("\t")
            if len(cols) < 4:
                # not CoNLL-U token line
                continue
            tid = cols[0]
            if "-" in tid or "." in tid:
                continue
            form = cols[1] if len(cols) > 1 else ""
            upos = cols[3] if len(cols) > 3 else ""
            xpos = cols[4] if len(cols) > 4 else ""
            if not form:
                continue
            if not upos or upos == "_":
                upos = "X"
            if not xpos or xpos == "_":
                xpos = upos
            sent_tokens.append(form)
            sent_upos.append(upos)
            sent_tag.append(xpos)

    yield from flush()


def sentences_to_windows(
    sentences: Iterable[Sentence],
    *,
    max_len: int,
    source: str,
) -> Iterable[dict]:
    if max_len < 1:
        raise ValueError("max_len must be positive")
    buf_tokens: list[str] = []
    buf_upos: list[str] = []
    buf_tag: list[str] = []
    buf_y: list[int] = []

    def emit() -> Optional[dict]:
        nonlocal buf_tokens, buf_upos, buf_tag, buf_y
        if not buf_tokens:
            return None
        L = len(buf_tokens)
        rec = {
            "tokens": list(buf_tokens),
            "pos": [
                {"i": i, "tok": buf_tokens[i], "upos": buf_upos[i], "tag": buf_tag[i]}
                for i in range(L)
            ],
            "sent_end_after": list(buf_y),
            "source": source,
        }
        buf_tokens, buf_upos, buf_tag, buf_y = [], [], [], []
        return rec

    for sent in sentences:
        if not sent.tokens:
            continue
        if len(sent.tokens) != len(sent.upos) or len(sent.tokens) != len(sent.tag):
            raise ValueError("Sentence column length mismatch")

        # If the next sentence doesn't fit, emit current window.
        if buf_tokens and (len(buf_tokens) + len(sent.tokens) > max_len):
            rec = emit()
            if rec is not None:
                yield rec

        # If sentence itself exceeds max_len, emit it as its own window (boundary-safe).
        if not buf_tokens and len(sent.tokens) > max_len:
            y = [0] * len(sent.tokens)
            y[-1] = 1
            yield {
                "tokens": list(sent.tokens),
                "pos": [
                    {"i": i, "tok": sent.tokens[i], "upos": sent.upos[i], "tag": sent.tag[i]}
                    for i in range(len(sent.tokens))
                ],
                "sent_end_after": y,
                "source": source,
            }
            continue

        # Append sentence.
        buf_tokens.extend(sent.tokens)
        buf_upos.extend(sent.upos)
        buf_tag.extend(sent.tag)
        y = [0] * len(sent.tokens)
        y[-1] = 1
        buf_y.extend(y)

        if len(buf_tokens) == max_len:
            rec = emit()
            if rec is not None:
                yield rec

    rec = emit()
    if rec is not None:
        yield rec


def qa_and_write(windows: Iterable[dict], out_path: Path) -> None:
    n_records = 0
    total_tokens = 0
    total_boundaries = 0
    lengths: list[int] = []

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as out:
        for rec in windows:
            tokens = rec["tokens"]
            pos = rec["pos"]
            y = rec["sent_end_after"]

            if not (len(tokens) == len(pos) == len(y)):
                raise ValueError("length mismatch")
            if any((t is None) or (not str(t)) for t in tokens):
                raise ValueError("empty token")
            if any(p.get("i") != i or p.get("tok") != tokens[i] for i, p in enumerate(pos)):
                raise ValueError("pos/tokens misalignment")
            if any(type(value) is not int or value not in (0, 1) for value in y):
                raise ValueError("sentence boundary labels must be 0 or 1")
            if 1 not in y:
                raise ValueError("window has no sentence boundary")

            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            n_records += 1
            L = len(tokens)
            lengths.append(L)
            total_tokens += L
            total_boundaries += int(sum(1 for v in y if v == 1))

    mean_len = (sum(lengths) / len(lengths)) if lengths else 0.0
    print(
        f"WROTE {out_path} (records={n_records}, total_tokens={total_tokens}, "
        f"total_boundaries={total_boundaries}, mean_window_len={mean_len:.2f})"
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in_conllu", required=True, type=Path)
    ap.add_argument("--out_jsonl", required=True, type=Path)
    ap.add_argument("--max_len", type=int, default=400)
    ap.add_argument("--source", required=True, choices=["myudtree", "alt"])
    args = ap.parse_args()

    sents = iter_conllu_sentences(args.in_conllu)
    wins = sentences_to_windows(sents, max_len=args.max_len, source=args.source)
    qa_and_write(wins, args.out_jsonl)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
