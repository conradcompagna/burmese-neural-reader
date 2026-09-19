#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Run an OCR-structure boundary CRF (trained by train_ocr_structure_boundary_crf.py)
to insert <SENT_END> / <PARA_END> markers into raw OCR-ish text.

This model is intentionally non-lexical: it relies on whitespace/gap + junk + line-shape features.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import List

import pycrfsuite

from training.boundaries import train_ocr_structure_boundary_crf as ocr


def apply_post_filters(
    tagger: pycrfsuite.Tagger,
    labels: List[str],
    *,
    p_threshold: float,
    min_gap: int,
) -> List[str]:
    if p_threshold > 0.0:
        for i in range(len(labels)):
            p_any = float(tagger.marginal("SENT_END", i)) + float(tagger.marginal("PARA_END", i))
            if p_any < p_threshold:
                labels[i] = "O"

    if min_gap > 0:
        last_b = -(10**9)
        for i in range(len(labels)):
            if labels[i] not in ("SENT_END", "PARA_END"):
                continue
            if i - last_b <= min_gap:
                labels[i] = "O"
            else:
                last_b = i

    return labels


def make_marked_text(ig: ocr.Islands, pred: List[str]) -> str:
    out_parts: List[str] = []
    if ig.leading_ws:
        out_parts.append(ig.leading_ws)
    for i, tok in enumerate(ig.islands):
        out_parts.append(tok)
        if i < len(pred):
            if pred[i] == "SENT_END":
                out_parts.append(" <SENT_END>")
            elif pred[i] == "PARA_END":
                out_parts.append(" <PARA_END>")
        if i < len(ig.gaps):
            out_parts.append(ig.gaps[i])
    return "".join(out_parts).rstrip()


def make_sentences(islands: List[str], pred: List[str]) -> List[str]:
    sentences: List[str] = []
    buf: List[str] = []
    for i, tok in enumerate(islands):
        buf.append(tok)
        if i < len(pred) and pred[i] in ("SENT_END", "PARA_END"):
            s = " ".join(buf).strip()
            if s:
                sentences.append(s)
            if pred[i] == "PARA_END":
                sentences.append("")  # blank line between paragraphs
            buf = []
    if buf:
        s = " ".join(buf).strip()
        if s:
            sentences.append(s)
    # Trim trailing blank paragraph marker if present
    while sentences and sentences[-1] == "":
        sentences.pop()
    return sentences


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--model", required=True, help="Path to *.crfsuite (ocr_boundary_struct_* model)"
    )
    ap.add_argument("--in_file", required=True, help="UTF-8 input text")
    ap.add_argument("--out_file", required=True, help="Output file")
    ap.add_argument(
        "--mode",
        choices=["marked", "sentences"],
        default="marked",
        help="marked = preserve whitespace and insert markers; sentences = one sentence per line",
    )
    ap.add_argument(
        "--p_threshold", type=float, default=0.0, help="Keep boundary only if P(SENT)+P(PARA) >= t"
    )
    ap.add_argument(
        "--min_gap", type=int, default=0, help="Suppress boundaries closer than this many islands"
    )
    args = ap.parse_args()

    model_path = Path(args.model)
    if not model_path.exists():
        raise SystemExit(f"Missing model: {model_path}")

    text = Path(args.in_file).read_text(encoding="utf-8", errors="replace")
    ig = ocr.islands_and_gaps(text.replace("\r\n", "\n").replace("\r", "\n"))
    if len(ig.islands) < 2:
        Path(args.out_file).write_text(text, encoding="utf-8", newline="\n")
        print(f"WROTE {args.out_file} (too few islands to segment)")
        return 0

    stats = ocr.compute_doc_stats(ig.islands, ig.gaps)
    X = [ocr.boundary_features(ig.islands, ig.gaps, stats, i) for i in range(len(ig.islands) - 1)]

    tagger = pycrfsuite.Tagger()
    tagger.open(str(model_path))
    pred = list(tagger.tag(X))
    pred = apply_post_filters(
        tagger, pred, p_threshold=float(args.p_threshold), min_gap=int(args.min_gap)
    )

    if args.mode == "marked":
        out_text = make_marked_text(ig, pred)
    else:
        out_text = "\n".join(make_sentences(ig.islands, pred)) + "\n"

    Path(args.out_file).write_text(out_text, encoding="utf-8", newline="\n")

    n_sent = sum(1 for x in pred if x == "SENT_END")
    n_para = sum(1 for x in pred if x == "PARA_END")
    print(f"WROTE {args.out_file} (islands={len(ig.islands)} sent_end={n_sent} para_end={n_para})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
