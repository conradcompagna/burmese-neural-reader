from __future__ import annotations

import argparse
from pathlib import Path

import app as ns


def _ensure_server_resources_loaded() -> None:
    """
    Ensure the dictionaries + LM-backed segmenter are initialized the same way as
    when running `app.py` as an app.
    """
    # `load_dictionary()` also initializes the embedded segmenter and injects all
    # legacy dictionary sources into it (so segmentation matches the app).
    if not getattr(ns, "DICT", None):
        ns.load_dictionary()

    # Mirror server startup: grammar TSV is loaded separately (these forms are for
    # UI/lookup; segmentation itself is dictionary-layer-driven).
    if not getattr(ns, "GRAMMAR_LEXICON", None):
        try:
            ns.load_grammar_lexicon_tsv(ns.TSV_GRAMMAR_PATH)
            ns.inject_grammar_heads_into_dict()
        except Exception:
            # Grammar resources are optional for segmentation output.
            pass


def segment_line_for_app(line: str) -> list[str]:
    """
    Segment a single line using the *same* wrapper the HTTP API uses.
    This preserves Myanmar punctuation tokens (`၊` / `။`) as standalone segments.
    """
    return ns.segment_with_pipeline(line)


def main() -> int:
    ap = argparse.ArgumentParser(
        description=(
            "Segment a UTF-8 text file using newserver's segmenter pipeline.\n"
            "Writes one tokenized line per input line."
        )
    )
    ap.add_argument("input", type=Path, help="Input UTF-8 text file")
    ap.add_argument("output", type=Path, help="Output UTF-8 tokenized text file")
    ap.add_argument(
        "--sep",
        default=" ",
        help="Token separator to use in output (default: space)",
    )
    args = ap.parse_args()

    _ensure_server_resources_loaded()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with (
        args.input.open("r", encoding="utf-8") as f_in,
        args.output.open("w", encoding="utf-8", newline="\n") as f_out,
    ):
        for raw in f_in:
            line = raw.rstrip("\n")
            if not line.strip():
                f_out.write("\n")
                continue

            segs = segment_line_for_app(line)
            f_out.write(args.sep.join(segs) + "\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
