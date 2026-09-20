#!/usr/bin/env python3
"""
Build CRF training corpus from `tagged_strict.txt` using newserver's:
  - neural segmentation pipeline
  - POS tagger (spaCy UD by default; optional myPOS fallback)

Output: JSONL records shaped like:
{
  "text": "<SENT_END> ... <SENT_END> ...",
  "tokens": [...],
  "pos": [{"i":0,"tok":"...","upos":"NOUN","tag":"NOUN"}, ...],
  "sent_end_after": [0,0,1,...],
  "doc_breaks": {"leading_marker": true, "marker_positions_in_raw": [0, 11, ...]}
}
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


SENT_MARKER = "<SENT_END>"


@dataclass(frozen=True)
class Record:
    text: str
    tokens: list[str]
    pos: list[dict]
    sent_end_after: list[int]
    doc_breaks: dict


def _iter_sentences_from_marked_text(raw: str) -> Iterable[str]:
    # Marker is a boundary marker between sentence-like chunks.
    parts = raw.split(SENT_MARKER)
    for part in parts:
        s = (part or "").strip()
        if s:
            yield s


def _build_record(
    sentences: list[str],
    segment_fn,
    pos_overlay_fn,
    pos_fallback: str,
) -> Record:
    if not sentences:
        raise ValueError("No sentences in record")

    tokens: list[str] = []
    marker_positions: list[int] = [0]  # leading marker always present in output
    sent_end_after: list[int] = []

    for si, sent in enumerate(sentences):
        segs = segment_fn(sent) or []
        segs = [t for t in segs if t and not t.isspace()]
        tokens.extend(segs)

        sent_end_after.extend([0] * len(segs))

        # Boundary markers appear between sentences only (not after the last).
        if si != len(sentences) - 1 and segs:
            sent_end_after[len(sent_end_after) - 1] = 1
            marker_positions.append(len(tokens))

    # Construct `text` with leading marker and between-sentence markers.
    text = f"{SENT_MARKER} " + f" {SENT_MARKER} ".join(sentences)

    overlay = pos_overlay_fn(tokens) or {}
    pos: list[dict] = []
    for i, tok in enumerate(tokens):
        info = overlay.get(i) or {}
        upos = (info.get("upos") or info.get("pos") or "").strip()
        tag = (info.get("tag") or upos or "").strip()
        if not upos:
            upos = pos_fallback
        if not tag:
            tag = pos_fallback
        pos.append({"i": i, "tok": tok, "upos": upos, "tag": tag})

    return Record(
        text=text,
        tokens=tokens,
        pos=pos,
        sent_end_after=sent_end_after,
        doc_breaks={"leading_marker": True, "marker_positions_in_raw": marker_positions},
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        type=Path,
        default=Path(__file__).with_name("tagged_strict.txt"),
        help="Path to tagged_strict.txt",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).with_name("corpus").joinpath("tagged_strict_crf.jsonl"),
        help="Output JSONL path",
    )
    parser.add_argument(
        "--sentences-per-record",
        type=int,
        default=50,
        help="How many <SENT_END>-delimited sentences per JSONL record",
    )
    parser.add_argument(
        "--pos-mode",
        choices=["spacy", "mypos"],
        default="spacy",
        help="Which newserver POS overlay to use",
    )
    parser.add_argument(
        "--pos-fallback",
        default="X",
        help="UPOS/TAG value used when the POS overlay has no entry for a token",
    )
    args = parser.parse_args()

    # Make sure we can import newserver from this folder.
    sys.path.insert(0, str(Path(__file__).parent))

    import newserver  # type: ignore

    # Ensure dictionaries + POS tagger are loaded (this mirrors server startup).
    newserver.load_dictionary()

    # Force the segmentation pipeline selection via env var (newserver reads this).
    # Default is neural_then_dict_greedy.
    os.environ.setdefault("SEGMENTATION_PIPELINE", "neural_then_dict_greedy")

    segment_fn = newserver.segment_with_pipeline
    if args.pos_mode == "spacy":
        pos_overlay_fn = newserver.build_spacy_pos_overlay_for_segments
    else:
        pos_overlay_fn = newserver.build_pos_overlay_for_segments

    raw = args.input.read_text(encoding="utf-8")
    all_sents = list(_iter_sentences_from_marked_text(raw))

    if not all_sents:
        raise RuntimeError("No sentences found (missing <SENT_END> markers?)")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    total = len(all_sents)
    rec_i = 0

    with args.output.open("w", encoding="utf-8") as f:
        for start in range(0, total, args.sentences_per_record):
            batch = all_sents[start : start + args.sentences_per_record]
            rec = _build_record(
                batch,
                segment_fn=segment_fn,
                pos_overlay_fn=pos_overlay_fn,
                pos_fallback=args.pos_fallback,
            )
            f.write(
                json.dumps(
                    {
                        "text": rec.text,
                        "tokens": rec.tokens,
                        "pos": rec.pos,
                        "sent_end_after": rec.sent_end_after,
                        "doc_breaks": rec.doc_breaks,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
            rec_i += 1
            if rec_i % 5 == 0 or start == 0:
                done = min(start + args.sentences_per_record, total)
                print(f"[{rec_i}] sentences {done}/{total}", flush=True)

    print(f"Wrote {rec_i} records to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

