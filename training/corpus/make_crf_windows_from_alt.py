#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from training.corpus.make_crf_windows_from_conllu import (
    iter_conllu_sentences,
    sentences_to_windows,
    qa_and_write,
    Sentence,
)


ALT2UPOS = {
    "noun": "NOUN",
    "verb": "VERB",
    "adj": "ADJ",
    "adv": "ADV",
    "adp": "ADP",
    "part": "PART",
    "pron": "PRON",
    "num": "NUM",
    "conj": "CCONJ",
    "cconj": "CCONJ",
    "sconj": "SCONJ",
    "punct": "PUNCT",
    "det": "DET",
    "aux": "AUX",
    "propn": "PROPN",
}


_PAIR_RE = re.compile(r"\(([^\s()]+)\s+([^\s()]+)\)")


@dataclass(frozen=True)
class AltSentence:
    tokens: list[str]
    upos: list[str]
    tag: list[str]


def detect_format(path: Path) -> str:
    """
    Returns: "conllu" | "bracketed"
    """
    with path.open("r", encoding="utf-8") as f:
        for _ in range(200):
            line = f.readline()
            if not line:
                break
            s = line.strip()
            if not s:
                continue
            if s.startswith("#"):
                continue
            if "\t" in s:
                cols = s.split("\t")
                if cols and re.fullmatch(r"\d+([-.]\d+)?", cols[0]):
                    # looks like a token line; conllu-ish
                    return "conllu"
                if len(cols) >= 2 and cols[0].startswith("SNT.") and "(" in cols[1]:
                    return "bracketed"
            if s.startswith("SNT.") and "\t" in s and "(" in s:
                return "bracketed"
    # Default to bracketed; it's the more "special" format and avoids silently skipping token lines.
    return "bracketed"


def iter_alt_bracketed_sentences(path: Path) -> Iterable[Sentence]:
    """
    Parse ALT bracketed constituency trees:
      SNT.xxx.y<TAB>(ROOT (tag token) ...)

    Extracts (XPOS FORM) pairs via regex, then maps XPOS to UPOS when possible.
    """
    with path.open("r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line:
                continue
            if "\t" not in line:
                continue
            _sid, tree = line.split("\t", 1)
            tokens: list[str] = []
            upos: list[str] = []
            tag: list[str] = []

            for xpos_raw, form in _PAIR_RE.findall(tree):
                if not form:
                    continue

                xpos_l = xpos_raw.lower()
                base = xpos_l.split("-", 1)[0]

                if base in ALT2UPOS:
                    u = ALT2UPOS[base]
                elif xpos_raw in ALT2UPOS:
                    u = ALT2UPOS[xpos_raw]
                else:
                    # Heuristic: drop pairs whose POS isn't recognized (reduces non-preterminal noise).
                    continue

                tokens.append(form)
                upos.append(u)
                tag.append(xpos_raw)

            if tokens:
                yield Sentence(tokens=tokens, upos=upos, tag=tag)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in_file", required=True, type=Path)
    ap.add_argument("--out_jsonl", required=True, type=Path)
    ap.add_argument("--max_len", type=int, default=400)
    args = ap.parse_args()

    fmt = detect_format(args.in_file)
    if fmt == "conllu":
        sents = iter_conllu_sentences(args.in_file)
    else:
        sents = iter_alt_bracketed_sentences(args.in_file)

    wins = sentences_to_windows(sents, max_len=args.max_len, source="alt")
    qa_and_write(wins, args.out_jsonl)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
