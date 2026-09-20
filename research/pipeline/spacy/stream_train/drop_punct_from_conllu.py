#!/usr/bin/env python3
"""
Remove UPOS=PUNCT tokens from a CoNLL-U file, rewriting token IDs and HEADs.

Rules:
- Drop token lines where UPOS == "PUNCT" (column 4).
- Keep comments and sentence boundaries.
- Re-number remaining token IDs from 1..N per sentence.
- Re-map HEAD:
  - If HEAD points to a kept token, remap to the new ID.
  - If HEAD points to a dropped token or is invalid, set HEAD=0 and DEPREL=root.
- Drop multi-word tokens (ID like "1-2") and empty nodes (ID like "3.1"), mirroring typical training prep.
"""

from __future__ import annotations

import argparse
from pathlib import Path


def is_int(s: str) -> bool:
    try:
        int(s)
        return True
    except Exception:
        return False


def process_sentence(lines: list[str]) -> list[str]:
    tokens: list[list[str]] = []
    for line in lines:
        if not line or line.startswith("#"):
            continue
        cols = line.split("\t")
        if len(cols) < 8:
            continue
        tid = cols[0]
        if "-" in tid or "." in tid:
            continue
        if cols[3] == "PUNCT":
            continue
        tokens.append(cols)

    # old_id -> new_id
    id_map: dict[int, int] = {}
    old_ids: list[int] = []
    for cols in tokens:
        tid = cols[0]
        if is_int(tid):
            old_ids.append(int(tid))
    for new_i, old_i in enumerate(old_ids, start=1):
        id_map[old_i] = new_i

    out: list[str] = []
    for cols in tokens:
        old_id = int(cols[0])
        cols[0] = str(id_map[old_id])

        head = cols[6]
        if head == "0":
            pass
        elif is_int(head):
            old_head = int(head)
            new_head = id_map.get(old_head)
            if new_head is None:
                cols[6] = "0"
                cols[7] = "root"
            else:
                cols[6] = str(new_head)
        else:
            cols[6] = "0"
            cols[7] = "root"

        out.append("\t".join(cols))

    return out


def convert_conllu_drop_punct(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    with src.open("r", encoding="utf-8", errors="replace") as f:
        raw_lines = [ln.rstrip("\n") for ln in f]

    out_lines: list[str] = []
    sent_buf: list[str] = []
    for line in raw_lines:
        if line.strip() == "":
            # flush sentence
            if sent_buf:
                # keep sentence-level comments
                for l in sent_buf:
                    if l.startswith("#"):
                        out_lines.append(l)
                out_lines.extend(process_sentence(sent_buf))
                out_lines.append("")
                sent_buf = []
            else:
                out_lines.append("")
            continue
        sent_buf.append(line)

    if sent_buf:
        for l in sent_buf:
            if l.startswith("#"):
                out_lines.append(l)
        out_lines.extend(process_sentence(sent_buf))
        out_lines.append("")

    dst.write_text("\n".join(out_lines), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", dest="out", required=True)
    args = ap.parse_args()

    src = Path(args.inp)
    dst = Path(args.out)
    if not src.exists():
        raise SystemExit(f"Missing input: {src}")
    convert_conllu_drop_punct(src, dst)
    print(f"WROTE {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

