from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import spacy
from spacy.tokens import Doc

import app as ns


_RUN_RE = re.compile(r"\s+|\S+")


def _grapheme_clusters(text: str) -> list[str]:
    clusters, _starts = ns._build_grapheme_clusters(text)  # noqa: SLF001
    return [c for c in clusters if c and not c.isspace()]


def _predict_bilu(nlp, clusters: list[str]) -> list[str]:
    if not clusters:
        return []
    spaces = [True] * len(clusters)
    spaces[-1] = False
    doc = Doc(nlp.vocab, words=clusters, spaces=spaces)
    doc = nlp(doc)
    return [t.tag_ for t in doc]


def main() -> int:
    ap = argparse.ArgumentParser(
        description=(
            "Split text into grapheme clusters (syllable-level shards) and run a spaCy\n"
            "BILU boundary tagger over each non-whitespace run.\n"
            "Writes JSON with tokens+tags and optional .conll output."
        )
    )
    ap.add_argument(
        "--model",
        default=r"C:\spacy_models\burmese_boundary_bilu\model-best",
        help="Path/name of the spaCy BILU tagger model",
    )
    ap.add_argument("--in", dest="inp", type=Path, required=True, help="Input UTF-8 text file")
    ap.add_argument("--out", dest="out", type=Path, required=True, help="Output JSON file")
    ap.add_argument(
        "--conll-out",
        dest="conll_out",
        type=Path,
        default=None,
        help="Optional token<TAB>tag .conll output (newlines become sentence breaks)",
    )
    args = ap.parse_args()

    raw = args.inp.read_text(encoding="utf-8")

    nlp = spacy.load(args.model)
    if "tagger" not in nlp.pipe_names:
        raise ValueError(f"Model has no tagger: pipes={nlp.pipe_names}")

    flat_pairs: list[list[str]] = []
    runs: list[dict] = []

    for m in _RUN_RE.finditer(raw):
        run = m.group(0)
        if not run:
            continue

        if run.isspace():
            runs.append({"type": "ws", "text": run})
            continue

        clusters = _grapheme_clusters(run)
        tags = _predict_bilu(nlp, clusters)

        # Safety: align lengths (should match unless model failed to set tags)
        if len(tags) != len(clusters):
            # fallback: mark everything as U
            tags = ["U"] * len(clusters)

        runs.append(
            {
                "type": "chunk",
                "raw": run,
                "clusters": clusters,
                "tags": tags,
            }
        )
        flat_pairs.extend([[c, t] for c, t in zip(clusters, tags)])

    out_obj = {
        "ok": True,
        "model": args.model,
        "input": raw,
        "pairs": flat_pairs,  # training-data-like: [token, B/I/L/U]
        "runs": runs,  # preserves whitespace runs verbatim
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out_obj, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.conll_out is not None:
        args.conll_out.parent.mkdir(parents=True, exist_ok=True)
        with args.conll_out.open("w", encoding="utf-8", newline="\n") as f:
            for r in runs:
                if r["type"] == "ws":
                    # preserve paragraph/line breaks as sentence separators
                    nl_count = r["text"].count("\n")
                    for _ in range(nl_count):
                        f.write("\n")
                    continue
                if r["type"] == "chunk":
                    for tok, tag in zip(r["clusters"], r["tags"]):
                        f.write(f"{tok}\t{tag}\n")
        # ensure trailing newline
        with args.conll_out.open("a", encoding="utf-8", newline="\n") as f:
            f.write("\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
