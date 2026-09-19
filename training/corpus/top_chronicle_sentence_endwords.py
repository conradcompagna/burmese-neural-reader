#!/usr/bin/env python3
"""
Compute most frequent sentence-final tokens in the chronicle text.

Default behavior:
  - Reads `tagged_strict.txt` (sentences delimited by literal "<SENT_END>").
  - Segments each sentence using `newserver.segment_with_pipeline`.
  - Optionally strips punctuation tokens and shifts to last kept token.
  - Counts the last token of each sentence and prints top-N.
"""

from __future__ import annotations

import argparse
import re
from collections import Counter
from pathlib import Path

SENT_MARK = "<SENT_END>"

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
    tok = tok or ""
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
    if tok in MYANMAR_PUNCT or tok in ASCII_PUNCT:
        return True
    if PUNCT_RE.match(tok):
        return True
    return strip_punct(tok) == ""


def keep_token(tok: str, *, drop_non_myanmar: bool) -> bool:
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
    return not drop_non_myanmar


def iter_sentences(raw: str):
    for part in raw.split(SENT_MARK):
        s = (part or "").strip()
        if s:
            yield s


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", type=Path, default=Path("tagged_strict.txt"))
    ap.add_argument("--top_n", type=int, default=200)
    ap.add_argument(
        "--strip_punct",
        action="store_true",
        help="Drop punctuation tokens and use last kept token.",
    )
    ap.add_argument(
        "--drop_non_myanmar", action="store_true", help="Also drop non-Myanmar, non-digit tokens."
    )
    ap.add_argument(
        "--tokenize",
        choices=["newserver", "whitespace"],
        default="newserver",
        help="How to tokenize each sentence before taking the final token.",
    )
    ap.add_argument("--out_tsv", type=Path, default=None)
    args = ap.parse_args()

    raw = args.input.read_text(encoding="utf-8", errors="replace")

    if args.tokenize == "newserver":
        import sys

        sys.path.insert(0, str(Path(__file__).parent))
        import app as newserver  # type: ignore

        tokenize = newserver.segment_with_pipeline
    else:
        tokenize = lambda s: [t for t in s.split() if t]  # noqa: E731

    ctr: Counter[str] = Counter()
    n_sent = 0
    n_skipped = 0

    for sent in iter_sentences(raw):
        n_sent += 1
        toks = tokenize(sent) or []
        if not toks:
            n_skipped += 1
            continue

        if args.strip_punct or args.drop_non_myanmar:
            toks2 = [t for t in toks if keep_token(t, drop_non_myanmar=args.drop_non_myanmar)]
            if not toks2:
                n_skipped += 1
                continue
            end_tok = strip_punct(toks2[-1])
        else:
            end_tok = toks[-1]

        end_tok = (end_tok or "").strip()
        if not end_tok:
            n_skipped += 1
            continue
        ctr[end_tok] += 1

    rows = ctr.most_common(args.top_n)
    print(
        f"sentences={n_sent} counted={sum(ctr.values())} skipped={n_skipped} unique_endwords={len(ctr)}"
    )
    for w, c in rows:
        print(f"{c}\t{w}")

    if args.out_tsv:
        args.out_tsv.parent.mkdir(parents=True, exist_ok=True)
        with args.out_tsv.open("w", encoding="utf-8") as f:
            f.write("count\tendword\n")
            for w, c in rows:
                f.write(f"{c}\t{w}\n")
        print(f"WROTE {args.out_tsv}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
