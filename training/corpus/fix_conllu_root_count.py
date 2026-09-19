#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fix CoNLL-U sentences that have 0 or >1 root (HEAD==0).

This is a *structural* post-pass to make the treebank safer for downstream
spaCy training. It does NOT attempt full linguistic repair.

Heuristics:
  - If multiple roots:
      * choose the token whose DEPREL == 'root' as the primary root if present,
        else choose the first root token.
      * reattach extra roots:
          - if DEPREL == 'case' -> attach to previous token (i-1) when possible
          - if DEPREL == 'compound' -> attach to next token (i+1) when possible
          - else attach to primary root
  - If zero roots:
      * choose the token whose DEPREL == 'root' if present, else last token
      * set its HEAD=0
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, List, Optional, Tuple


@dataclass
class Tok:
    cols: List[str]  # len 10

    @property
    def id(self) -> int:
        return int(self.cols[0])

    @property
    def head(self) -> int:
        try:
            return int(self.cols[6])
        except Exception:
            return -1

    @head.setter
    def head(self, v: int) -> None:
        self.cols[6] = str(int(v))

    @property
    def deprel(self) -> str:
        return (self.cols[7] or "").strip()


def iter_sentence_blocks(path: Path) -> Iterator[List[str]]:
    block: List[str] = []
    with path.open("r", encoding="utf-8", errors="replace") as f:
        for raw in f:
            line = raw.rstrip("\n")
            if not line.strip():
                if block:
                    yield block
                    block = []
                else:
                    yield []  # preserve blank lines
                continue
            block.append(line)
    if block:
        yield block


def parse_tokens(block: List[str]) -> Tuple[List[str], List[Tok]]:
    """
    Returns (raw_lines, parsed_tokens) where raw_lines is the original block and
    parsed_tokens contains only normal token lines (no comments / no MWT / no empty nodes).
    """
    toks: List[Tok] = []
    for line in block:
        if line.startswith("#"):
            continue
        cols = line.split("\t")
        if len(cols) != 10:
            if len(cols) < 10:
                cols += ["_"] * (10 - len(cols))
            else:
                cols = cols[:10]
        tid = cols[0]
        if "-" in tid or "." in tid:
            continue
        try:
            int(tid)
        except Exception:
            continue
        toks.append(Tok(cols=cols))
    return block, toks


def fix_roots(toks: List[Tok]) -> bool:
    """
    Mutates toks in-place. Returns True if changed.
    """
    if not toks:
        return False
    n = len(toks)

    root_idxs = [i for i, t in enumerate(toks) if t.head == 0]
    if len(root_idxs) == 1:
        return False

    changed = False

    if len(root_idxs) == 0:
        # Choose DEPREL==root if present, else last token.
        cand = None
        for i, t in enumerate(toks):
            if t.deprel == "root":
                cand = i
                break
        if cand is None:
            cand = n - 1
        toks[cand].head = 0
        changed = True
        return changed

    # Multiple roots.
    primary = None
    for i in root_idxs:
        if toks[i].deprel == "root":
            primary = i
            break
    if primary is None:
        primary = root_idxs[0]

    primary_id = toks[primary].id
    root_ids = {toks[i].id for i in root_idxs}
    head_by_id = {t.id: t.head for t in toks}

    for i in root_idxs:
        if i == primary:
            continue
        t = toks[i]
        new_head = primary_id
        if t.deprel == "case" and t.id > 1:
            new_head = t.id - 1
        elif t.deprel == "compound" and t.id < n:
            new_head = t.id + 1
        if new_head <= 0 or new_head > n or new_head == t.id:
            new_head = primary_id
        # Avoid attaching a former-root to another former-root (can create cycles).
        if new_head in root_ids:
            new_head = primary_id
        # Avoid immediate 2-cycles: if candidate currently points back to t, don't create t->candidate.
        if head_by_id.get(new_head, -1) == t.id:
            new_head = primary_id
        t.head = new_head
        changed = True

    return changed


def rewrite_block(block: List[str], toks: List[Tok]) -> List[str]:
    """
    Reconstruct block lines, replacing token lines we parsed with updated columns.
    Keeps comments and MWT/empty nodes unchanged.
    """
    tok_by_id = {t.cols[0]: t for t in toks}
    out: List[str] = []
    for line in block:
        if line.startswith("#"):
            out.append(line)
            continue
        cols = line.split("\t")
        if not cols:
            out.append(line)
            continue
        tid = cols[0]
        if tid in tok_by_id:
            out.append("\t".join(tok_by_id[tid].cols))
        else:
            out.append(line)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in_conllu", required=True)
    ap.add_argument("--out_conllu", required=True)
    ap.add_argument("--max_report", type=int, default=10)
    args = ap.parse_args()

    in_path = Path(args.in_conllu)
    out_path = Path(args.out_conllu)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    changed_sents = 0
    report: List[Tuple[int, int]] = []

    with out_path.open("w", encoding="utf-8", newline="\n") as out:
        sent_idx = 0
        for block in iter_sentence_blocks(in_path):
            if block == []:
                out.write("\n")
                continue
            sent_idx += 1
            raw_block, toks = parse_tokens(block)
            did = fix_roots(toks)
            if did:
                changed_sents += 1
                if len(report) < int(args.max_report):
                    roots = sum(1 for t in toks if t.head == 0)
                    report.append((sent_idx, roots))
            new_block = rewrite_block(raw_block, toks)
            out.write("\n".join(new_block) + "\n\n")

    print(f"WROTE {out_path} (sentences_changed={changed_sents})")
    if report:
        print("examples (sentence_index, roots_after):", report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
