"""Inspect spaCy UD overlay for a short text span.

Given a text string, this script tokenizes it with the specified spaCy model,
converts the parse to the same overlay structure used in `ud_overlay.py`, and
saves the result as JSON for quick inspection.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List

import spacy


def doc_to_overlay(doc) -> Dict[str, Any]:
    """Convert a spaCy Doc to the UD overlay JSON shape."""
    tokens: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []
    roots: List[int] = []

    doc2seg = list(range(len(doc)))  # identity mapping when using spaCy tokens as segments
    seg2doc = list(range(len(doc)))

    for t in doc:
        i = int(t.i)
        head_i = int(t.head.i)
        dep = t.dep_
        upos = t.pos_
        tag = t.tag_

        tokens.append(
            {
                "i": i,  # original segment index (same as doc index here)
                "doc_i": i,  # index in spaCy doc
                "text": t.text,
                "upos": upos,  # coarse POS
                "tag": tag,  # fine POS tag (if model provides)
                "dep": dep,  # UD dependency relation
                "head": head_i,  # head token index (segment index)
            }
        )

        if dep == "ROOT" or head_i == i:
            roots.append(i)
        else:
            edges.append(
                {
                    "from": head_i,
                    "to": i,
                    "dep": dep,
                    "upos": upos,
                }
            )

    return {
        "ok": True,
        "tokens": tokens,
        "edges": edges,
        "roots": roots,
        "doc2seg": doc2seg,
        "seg2doc": seg2doc,
        "error": None,
        "text": doc.text,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build UD overlay JSON for a text span.")
    parser.add_argument("--text", help="Text span to parse (optional if --text-file is provided).")
    parser.add_argument("--text-file", help="Path to a UTF-8 text file to parse.")
    parser.add_argument("--model", default="model-best", help="spaCy model path or name.")
    parser.add_argument("--output", default="ud_span_output.json", help="Output JSON path.")
    args = parser.parse_args()

    if not args.text and not args.text_file:
        parser.error("Provide --text or --text-file")

    if args.text_file:
        text = Path(args.text_file).read_text(encoding="utf-8")
    else:
        text = args.text or ""

    nlp = spacy.load(args.model)
    nlp.max_length = max(getattr(nlp, "max_length", 1_000_000), 2_000_000)

    doc = nlp(text)
    overlay = doc_to_overlay(doc)

    out_path = Path(args.output)
    out_path.write_text(json.dumps(overlay, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved overlay to {out_path}")


if __name__ == "__main__":
    main()
