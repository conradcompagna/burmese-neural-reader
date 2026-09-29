# retokenize_conll_for_app.py
# Usage:
#   python retokenize_conll_for_app.py in.conll out.conll
#
# Expected input columns (tab-separated):
#   TOKEN   POS   NER
# Sentence boundaries are blank lines.

from __future__ import annotations

import sys
from typing import List

# Import the app so we reuse the *exact* segmenter + helpers.
# This assumes this script sits next to newserver.py (or newserver is on PYTHONPATH).
import newserver as ns  # noqa: E402


def _is_burmese_token(tok: str) -> bool:
    return bool(tok) and ns.contains_burmese(tok)


_SEGGER = None
_SEG_CACHE: dict[str, List[str]] = {}
_INITIALIZED = False


def _get_segmenter():
    global _SEGGER
    if _SEGGER is None:
        # newserver.py exposes the singleton via get_segmenter_instance().
        _SEGGER = ns.get_segmenter_instance()
    return _SEGGER


def _init_newserver_pipeline() -> None:
    """
    Match newserver.py startup as closely as possible (without starting Flask).

    Important: importing `newserver` does NOT run `load_dictionary()` because it's
    guarded by `if __name__ == "__main__"`. Without this init, the segmenter will
    be LM-only and will look like syllable splitting.
    """
    global _INITIALIZED, _SEGGER
    if _INITIALIZED:
        return
    # This is the exact startup path used by `python newserver.py` (minus app.run).
    ns.load_dictionary()
    try:
        ns.load_grammar_lexicon_tsv(ns.TSV_GRAMMAR_PATH)
        ns.inject_grammar_heads_into_dict()
    except Exception:
        # Grammar lexicon isn't required for segmentation, so keep going.
        pass
    _SEGGER = ns.get_segmenter_instance()
    _SEG_CACHE.clear()
    _INITIALIZED = True


def _segment_for_app(tok: str) -> List[str]:
    """
    Segment a single token into app-style segments.
    - If Burmese: use the embedded DP segmenter from newserver.py.
    """
    tok = tok or ""
    cached = _SEG_CACHE.get(tok)
    if cached is not None:
        return cached

    if not _is_burmese_token(tok):
        _SEG_CACHE[tok] = [tok]
        return [tok]

    segger = _get_segmenter()
    parts = segger.segment(tok)

    _SEG_CACHE[tok] = parts
    return parts


def _split_bioes(tag: str, k: int) -> List[str]:
    """
    Expand a BIOES tag over a token into k tags over k subtokens.

    Rules (keeps span semantics consistent):
      O            -> O * k
      S-X (k>1)    -> B-X, I-X*(k-2), E-X
      B-X          -> B-X, I-X*(k-1)
      I-X          -> I-X * k
      E-X          -> I-X*(k-1), E-X

    If k==1: return [tag] unchanged.
    """
    tag = (tag or "O").strip()
    if k <= 1:
        return [tag]

    if tag == "O" or tag == "":
        return ["O"] * k

    if "-" not in tag:
        # Unknown scheme; conservatively replicate.
        return [tag] * k

    pref, typ = tag.split("-", 1)
    pref = pref.strip().upper()
    typ = typ.strip()

    if pref == "S":
        if k == 2:
            return [f"B-{typ}", f"E-{typ}"]
        return [f"B-{typ}"] + [f"I-{typ}"] * (k - 2) + [f"E-{typ}"]
    if pref == "B":
        return [f"B-{typ}"] + [f"I-{typ}"] * (k - 1)
    if pref == "I":
        return [f"I-{typ}"] * k
    if pref == "E":
        return [f"I-{typ}"] * (k - 1) + [f"E-{typ}"]

    return [tag] * k


def retokenize_lines(lines: List[str]) -> List[str]:
    out: List[str] = []
    for raw in lines:
        line = raw.rstrip("\n")
        if not line.strip():
            out.append("")  # sentence break
            continue

        cols = line.split("\t")
        if len(cols) < 1:
            out.append(line)
            continue

        tok = cols[0]
        pos = cols[1] if len(cols) > 1 else ""
        ner = cols[2] if len(cols) > 2 else "O"
        rest = cols[3:] if len(cols) > 3 else []

        segs = _segment_for_app(tok)
        tags = _split_bioes(ner, len(segs))

        # POS: replicate (you can later retag POS if desired).
        for s, t in zip(segs, tags):
            new_cols = [s]
            if len(cols) > 1:
                new_cols.append(pos)
            if len(cols) > 2:
                new_cols.append(t)
            if rest:
                new_cols.extend(rest)
            out.append("\t".join(new_cols))
    return [l + "\n" for l in out]


def main(argv: List[str]) -> int:
    if len(argv) != 3:
        print("Usage: python retokenize_conll_for_app.py in.conll out.conll", file=sys.stderr)
        return 2

    _init_newserver_pipeline()

    in_path, out_path = argv[1], argv[2]
    with open(in_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    out_lines = retokenize_lines(lines)

    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.writelines(out_lines)

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
