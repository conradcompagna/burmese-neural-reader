#!/usr/bin/env python3
"""
Rewrite CRF JSONL corpus to:
  1) Avoid label leakage by stripping literal <SENT_END> markers from `text`.
     (Optionally, set text to a marker-free reconstruction from tokens.)
  2) Split long sequences into shorter ones (e.g. 200-400 tokens), preserving labels.

Input records must contain:
  - tokens: list[str]
  - pos: list[{"i": int, "tok": str, "upos": str, "tag": str}]
  - sent_end_after: list[int] (0/1, boundary AFTER token i)

Output keeps the same fields, with updated indices and doc_breaks.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path


SENT_MARKER = "<SENT_END>"


@dataclass(frozen=True)
class Chunk:
    tokens: list[str]
    pos: list[dict]
    sent_end_after: list[int]
    doc_breaks: dict
    text: str


def _marker_positions_from_sent_end(sent_end_after: list[int]) -> list[int]:
    positions = [0]
    for i, v in enumerate(sent_end_after):
        if v == 1:
            positions.append(i + 1)
    return positions


def _chunk_one_record(
    tokens: list[str],
    pos: list[dict],
    sent_end_after: list[int],
    doc_breaks: dict,
    *,
    min_tokens: int,
    max_tokens: int,
    prefer_boundary: bool,
    text_mode: str,
) -> list[Chunk]:
    if not (len(tokens) == len(pos) == len(sent_end_after)):
        raise ValueError("len(tokens) != len(pos) != len(sent_end_after)")

    marker_positions = (doc_breaks or {}).get("marker_positions_in_raw") or [0]
    marker_positions = [int(x) for x in marker_positions]
    marker_positions_set = set(marker_positions)

    out: list[Chunk] = []
    n = len(tokens)
    start = 0

    while start < n:
        hard_end = min(n, start + max_tokens)
        end = hard_end

        if prefer_boundary:
            # Prefer ending at a sentence boundary (sent_end_after == 1).
            best = None
            search_start = min(hard_end - 1, n - 1)
            for i in range(search_start, start - 1, -1):
                if sent_end_after[i] == 1:
                    cand_end = i + 1
                    if cand_end - start >= min_tokens:
                        best = cand_end
                        break
            if best is not None:
                end = best
            else:
                # If no boundary in range, still enforce min_tokens if possible.
                if hard_end - start < min_tokens and n - start >= min_tokens:
                    end = min(n, start + min_tokens)

        chunk_tokens = tokens[start:end]
        chunk_sent_end = sent_end_after[start:end]

        chunk_pos: list[dict] = []
        for j, p in enumerate(pos[start:end]):
            chunk_pos.append(
                {
                    "i": j,
                    "tok": chunk_tokens[j],
                    "upos": p.get("upos", ""),
                    "tag": p.get("tag", ""),
                }
            )

        # Recompute marker positions within the chunk.
        chunk_markers = [0]
        for rel_i, v in enumerate(chunk_sent_end):
            if v == 1:
                chunk_markers.append(rel_i + 1)

        # Best-effort: indicate if the chunk starts at an original marker boundary.
        leading_marker = bool(start in marker_positions_set)

        if text_mode == "empty":
            text = ""
        elif text_mode == "from_tokens":
            text = "".join(chunk_tokens)
        elif text_mode == "strip_markers":
            # Strip markers from any provided text, but we don't have access to the
            # original per-token spacing; `from_tokens` is safer and marker-free.
            text = "".join(chunk_tokens)
        else:
            raise ValueError(f"Unknown text_mode: {text_mode}")

        out.append(
            Chunk(
                tokens=chunk_tokens,
                pos=chunk_pos,
                sent_end_after=chunk_sent_end,
                doc_breaks={
                    "leading_marker": leading_marker,
                    "marker_positions_in_raw": chunk_markers,
                },
                text=text,
            )
        )

        start = end

    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", type=Path, default=Path("corpus/tagged_strict_crf.jsonl"))
    ap.add_argument("--output", type=Path, default=Path("corpus/tagged_strict_crf.chunked.jsonl"))
    ap.add_argument("--min-tokens", type=int, default=200)
    ap.add_argument("--max-tokens", type=int, default=400)
    ap.add_argument(
        "--prefer-boundary",
        action="store_true",
        help="Prefer chunk boundaries that fall on sent_end_after==1",
    )
    ap.add_argument(
        "--text-mode",
        choices=["from_tokens", "empty"],
        default="from_tokens",
        help="How to write `text` (marker-free).",
    )
    args = ap.parse_args()

    if args.min_tokens <= 0 or args.max_tokens <= 0 or args.min_tokens > args.max_tokens:
        raise SystemExit("Invalid min/max token settings")

    args.output.parent.mkdir(parents=True, exist_ok=True)

    in_lines = 0
    out_lines = 0

    with args.input.open("r", encoding="utf-8") as fin, args.output.open("w", encoding="utf-8") as fout:
        for line in fin:
            line = line.strip()
            if not line:
                continue
            in_lines += 1
            rec = json.loads(line)

            text = rec.get("text", "") or ""
            if SENT_MARKER in text:
                # Avoid leakage even if caller uses text.
                # We still write a marker-free replacement below.
                pass

            tokens = rec["tokens"]
            pos = rec["pos"]
            sent_end_after = rec["sent_end_after"]
            doc_breaks = rec.get("doc_breaks", {}) or {}

            chunks = _chunk_one_record(
                tokens,
                pos,
                sent_end_after,
                doc_breaks,
                min_tokens=args.min_tokens,
                max_tokens=args.max_tokens,
                prefer_boundary=args.prefer_boundary,
                text_mode=args.text_mode,
            )

            for ch in chunks:
                out_rec = {
                    "text": ch.text,
                    "tokens": ch.tokens,
                    "pos": ch.pos,
                    "sent_end_after": ch.sent_end_after,
                    "doc_breaks": ch.doc_breaks,
                    "invariants": [
                        "Do not train from `text`; train from tokens (+ pos) only.",
                        "len(tokens) == len(pos) == len(sent_end_after).",
                        "sent_end_after[i]=1 means boundary AFTER tokens[i].",
                        f"'{SENT_MARKER}' markers never appear in `tokens` or `text`.",
                    ],
                }
                fout.write(json.dumps(out_rec, ensure_ascii=False) + "\n")
                out_lines += 1

    print(f"Read {in_lines} records, wrote {out_lines} records to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

