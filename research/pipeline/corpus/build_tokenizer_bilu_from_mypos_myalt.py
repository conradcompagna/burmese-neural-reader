from __future__ import annotations

import argparse
import random
import re
from dataclasses import dataclass
from pathlib import Path

import spacy
from spacy.tokens import Doc, DocBin

import newserver as ns


_ALT_LEAF_RE = re.compile(r"\([^\s()]+\s+([^\s()]+)\)")


def _bilu_tags(n: int) -> list[str]:
    if n <= 0:
        return []
    if n == 1:
        return ["U"]
    if n == 2:
        return ["B", "L"]
    return ["B"] + ["I"] * (n - 2) + ["L"]


def _grapheme_clusters(token: str) -> list[str]:
    if not token:
        return []
    clusters, _starts = ns._build_grapheme_clusters(token)  # noqa: SLF001
    return [c for c in clusters if c and not c.isspace()]


def _words_from_mypos_line(line: str) -> list[str]:
    """
    Parse a single myPOS line into a list of surface 'words'.

    myPOS format looks like:
      WORD/POS WORD/POS ...
    and sometimes internal segmentation alternatives are written with '|', e.g.:
      ပြော/v|ခြင်း/part
    We treat '|' as additional word boundaries and keep only the surface forms.
    """
    words: list[str] = []
    for chunk in (line or "").strip().split():
        if not chunk:
            continue
        for part in chunk.split("|"):
            part = part.strip()
            if not part:
                continue
            if "/" in part:
                surface, _pos = part.rsplit("/", 1)
            else:
                surface = part
            surface = surface.strip()
            if surface:
                words.append(surface)
    return words


def _words_from_alt_line(line: str) -> list[str]:
    """
    Parse a single ALT line:
      SNT.<id>.<n>\\t(<tree...>)
    and return the leaf words in order.
    """
    line = (line or "").rstrip("\n")
    if not line:
        return []
    if "\t" not in line:
        return []
    _sent_id, tree = line.split("\t", 1)
    words = _ALT_LEAF_RE.findall(tree)
    return [w for w in words if w]


def _sentence_to_bilu(words: list[str]) -> tuple[list[str], list[str]]:
    """
    Expand word tokens into grapheme clusters, tagging each cluster with B/I/L/U
    to mark word boundaries.
    """
    toks: list[str] = []
    tags: list[str] = []
    for w in words:
        clusters = _grapheme_clusters(w)
        if not clusters:
            continue
        bilu = _bilu_tags(len(clusters))
        toks.extend(clusters)
        tags.extend(bilu)
    return toks, tags


@dataclass
class BuildStats:
    sents_total: int = 0
    sents_train: int = 0
    sents_dev: int = 0
    toks_train: int = 0
    toks_dev: int = 0


def _write_conll_sentence(f, toks: list[str], tags: list[str]) -> None:
    for t, tag in zip(toks, tags):
        f.write(f"{t}\t{tag}\n")
    f.write("\n")


def _doc_from_tokens(nlp, toks: list[str], tags: list[str]) -> Doc:
    spaces = [True] * len(toks)
    if spaces:
        spaces[-1] = False
    doc = Doc(nlp.vocab, words=toks, spaces=spaces)
    for token, tag in zip(doc, tags):
        token.tag_ = tag
    return doc


def main() -> int:
    ap = argparse.ArgumentParser(
        description=(
            "Build a BILU-tagged syllable/grapheme dataset for spaCy tokenizer training\n"
            "from (1) mypos-ver.3.0.txt and (2) ALT treebank 'data' (my-alt-190530/data).\n"
            "Outputs both .conll (token\\tBILU) and .spacy (DocBin) train/dev splits."
        )
    )
    ap.add_argument(
        "--mypos",
        type=Path,
        default=Path("mypos-ver.3.0.txt"),
        help="Path to mypos-ver.3.0.txt",
    )
    ap.add_argument(
        "--myalt",
        type=Path,
        default=Path(r"data/New folder/my-alt-190530/data"),
        help="Path to ALT file named 'data' (from my-alt-190530)",
    )
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=Path("data/tokenizer_bilu_mypos_myalt"),
        help="Output directory for train/dev .conll + .spacy",
    )
    ap.add_argument("--dev-ratio", type=float, default=0.1, help="Dev split ratio (default: 0.1)")
    ap.add_argument("--seed", type=int, default=1234, help="RNG seed for splitting")
    ap.add_argument("--max-sents", type=int, default=0, help="Optional cap (0 = no cap)")
    args = ap.parse_args()

    if not args.mypos.exists():
        raise FileNotFoundError(f"mypos not found: {args.mypos}")
    if not args.myalt.exists():
        raise FileNotFoundError(f"myalt not found: {args.myalt}")
    if not (0.0 < args.dev_ratio < 1.0):
        raise ValueError("--dev-ratio must be between 0 and 1")

    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    train_conll = out_dir / "train.conll"
    dev_conll = out_dir / "dev.conll"
    train_spacy = out_dir / "train.spacy"
    dev_spacy = out_dir / "dev.spacy"

    rng = random.Random(args.seed)
    nlp = spacy.blank("xx")
    db_train = DocBin(store_user_data=True)
    db_dev = DocBin(store_user_data=True)
    stats = BuildStats()

    def _handle_sentence(words: list[str]) -> None:
        nonlocal stats
        if not words:
            return
        toks, tags = _sentence_to_bilu(words)
        if not toks:
            return
        if len(toks) != len(tags):
            raise RuntimeError("Token/tag length mismatch")

        stats.sents_total += 1
        is_dev = rng.random() < args.dev_ratio

        if is_dev:
            stats.sents_dev += 1
            stats.toks_dev += len(toks)
            _write_conll_sentence(f_dev, toks, tags)
            db_dev.add(_doc_from_tokens(nlp, toks, tags))
        else:
            stats.sents_train += 1
            stats.toks_train += len(toks)
            _write_conll_sentence(f_train, toks, tags)
            db_train.add(_doc_from_tokens(nlp, toks, tags))

        if args.max_sents and stats.sents_total >= args.max_sents:
            raise StopIteration

    # Write both conll files in one pass
    with train_conll.open("w", encoding="utf-8", newline="\n") as f_train, dev_conll.open(
        "w", encoding="utf-8", newline="\n"
    ) as f_dev:
        # myPOS: one sentence per line
        try:
            with args.mypos.open("r", encoding="utf-8") as f:
                for raw in f:
                    line = raw.strip()
                    if not line:
                        continue
                    words = _words_from_mypos_line(line)
                    _handle_sentence(words)
        except StopIteration:
            pass

        # ALT: one sentence per line (tab-delimited id + tree)
        if not args.max_sents or stats.sents_total < args.max_sents:
            try:
                with args.myalt.open("r", encoding="utf-8") as f:
                    for raw in f:
                        line = raw.strip()
                        if not line:
                            continue
                        words = _words_from_alt_line(line)
                        _handle_sentence(words)
            except StopIteration:
                pass

    db_train.to_disk(train_spacy)
    db_dev.to_disk(dev_spacy)

    print(f"Wrote {train_conll} ({stats.sents_train} docs, {stats.toks_train} tokens)")
    print(f"Wrote {dev_conll} ({stats.sents_dev} docs, {stats.toks_dev} tokens)")
    print(f"Wrote {train_spacy}")
    print(f"Wrote {dev_spacy}")
    print(f"Total docs: {stats.sents_total} (seed={args.seed}, dev_ratio={args.dev_ratio})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

