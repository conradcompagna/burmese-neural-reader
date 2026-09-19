#!/usr/bin/env python
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path
import json
from typing import List, Tuple, Dict

import newserver

MAX_PHRASE_LEN = 4  # max tokens per phrase span (for phrase unigrams)
PHRASE_INVENTORY_MIN_COUNT = 1  # min count for a span to be treated as a phrase in inventory


def iter_phrases_from_text(raw_text: str) -> List[str]:
    """
    Normalize and split into 'islands' exactly like the server:
    contiguous Myanmar text between spaces / Myanmar punctuation.
    """
    q = newserver.normalize_burmese_for_segmentation(raw_text)
    if not q:
        return []

    phrases: List[str] = []
    current: List[str] = []

    for ch in q:
        if ch.isspace() or ch in newserver.MYANMAR_PUNCT:
            if current:
                phrases.append("".join(current))
                current = []
        else:
            current.append(ch)

    if current:
        phrases.append("".join(current))

    return phrases


def filter_known_tokens(tokens: List[str], unknown_counts: Counter[str] | None = None) -> List[str]:
    """
    Keep only tokens that:
      - contain at least one Myanmar char, and
      - are present in newserver.DICT.

    If unknown_counts is provided, unknown tokens (Myanmar but not in DICT)
    are counted there.
    """
    known: List[str] = []
    for t in tokens:
        if not t:
            continue
        if not newserver.contains_burmese(t):
            continue
        if t in newserver.DICT:
            known.append(t)
        else:
            if unknown_counts is not None:
                unknown_counts[t] += 1
    return known


def update_counts_for_tokens(
    tokens: List[str],
    uni: Counter[str],
    bi: Counter[Tuple[str, str]],
    phrase_uni: Counter[str],
    unknown_counts: Counter[str],
    max_phrase_len: int = MAX_PHRASE_LEN,
) -> None:
    """
    First-pass counting:
      - update word unigrams / bigrams from known tokens
      - update phrase unigrams for all contiguous spans length 2..max_phrase_len
      - log unknown tokens in unknown_counts
    """
    if not tokens:
        return

    tokens = filter_known_tokens(tokens, unknown_counts=unknown_counts)
    n = len(tokens)
    if n == 0:
        return

    # Word unigrams
    for w in tokens:
        uni[w] += 1

    # Word bigrams
    for i in range(n - 1):
        bi[(tokens[i], tokens[i + 1])] += 1

    # Phrase unigrams: contiguous spans of length 2..max_phrase_len
    for length in range(2, max_phrase_len + 1):
        if length > n:
            break
        for i in range(n - length + 1):
            span = tokens[i : i + length]
            phrase_key = "_".join(span)
            phrase_uni[phrase_key] += 1


def process_file_first_pass(
    path: Path,
    uni: Counter[str],
    bi: Counter[Tuple[str, str]],
    phrase_uni: Counter[str],
    unknown_counts: Counter[str],
) -> None:
    text = path.read_text(encoding="utf-8")
    phrases = iter_phrases_from_text(text)

    for ph in phrases:
        if not ph:
            continue
        seg_tokens = newserver.segment_with_pipeline(ph)
        if not seg_tokens:
            continue
        update_counts_for_tokens(seg_tokens, uni, bi, phrase_uni, unknown_counts)


def build_phrase_inventory(
    phrase_unigram_counts: Counter[str],
    min_count: int = PHRASE_INVENTORY_MIN_COUNT,
    max_tokens: int = MAX_PHRASE_LEN,
) -> Tuple[Dict[Tuple[str, ...], str], Dict[Tuple[str, ...], int], int]:
    """
    Build a phrase inventory similar to lmbrain.load_phrase_unigram_lm:

      - phrase_by_tokens[(w1,...,wL)] = "w1_w2_..._wL"
      - phrase_token_counts[(w1,...,wL)] = count

    only for multi-word phrases with count >= min_count and len(tokens) <= max_tokens.
    Returns (phrase_by_tokens, phrase_token_counts, phrase_max_tokens).
    """
    phrase_by_tokens: Dict[Tuple[str, ...], str] = {}
    phrase_token_counts: Dict[Tuple[str, ...], int] = {}

    for phrase_key, count in phrase_unigram_counts.items():
        if count < min_count:
            continue
        tokens = phrase_key.split("_")
        if len(tokens) < 2:
            continue
        if max_tokens is not None and len(tokens) > max_tokens:
            continue
        tup = tuple(tokens)
        prev = phrase_token_counts.get(tup)
        if prev is None or count > prev:
            phrase_token_counts[tup] = count
            phrase_by_tokens[tup] = phrase_key

    if phrase_token_counts:
        phrase_max_tokens = max(len(t) for t in phrase_token_counts.keys())
    else:
        phrase_max_tokens = 1

    return phrase_by_tokens, phrase_token_counts, phrase_max_tokens


def detect_phrase_tokens_for_sequence(
    tokens: List[str],
    phrase_by_tokens: Dict[Tuple[str, ...], str],
    phrase_max_tokens: int,
) -> List[str]:
    """
    Greedy longest-match phrase detection over a list of known word tokens.

    Returns a list of phrase keys (strings), where:
      - multi-word phrases use underscore-joined keys from phrase_by_tokens
      - unmatched single words are passed through as themselves
    """
    n = len(tokens)
    if n == 0:
        return []

    if not phrase_by_tokens or phrase_max_tokens <= 1:
        # No multiword phrases in inventory: each token is its own "phrase"
        return list(tokens)

    result: List[str] = []
    i = 0

    while i < n:
        best_phrase_key: str | None = None
        best_len = 0

        limit = min(phrase_max_tokens, n - i)
        # Only consider multi-word phrase candidates
        for L in range(limit, 1, -1):
            tup = tuple(tokens[i : i + L])
            phrase_key = phrase_by_tokens.get(tup)
            if phrase_key is not None:
                best_phrase_key = phrase_key
                best_len = L
                break

        if best_phrase_key is not None:
            result.append(best_phrase_key)
            i += best_len
        else:
            # Fallback: single word as its own phrase
            result.append(tokens[i])
            i += 1

    return result


def process_file_second_pass_phrase_bigrams(
    path: Path,
    phrase_bigram_counts: Counter[Tuple[str, str]],
    phrase_by_tokens: Dict[Tuple[str, ...], str],
    phrase_max_tokens: int,
) -> None:
    """
    Second pass: re-segment text, filter known tokens, then derive a phrase
    token sequence via greedy phrase detection and accumulate phrase bigrams.
    """
    text = path.read_text(encoding="utf-8")
    phrases = iter_phrases_from_text(text)

    for ph in phrases:
        if not ph:
            continue
        seg_tokens = newserver.segment_with_pipeline(ph)
        if not seg_tokens:
            continue
        tokens = filter_known_tokens(seg_tokens, unknown_counts=None)
        if not tokens:
            continue

        phrase_tokens = detect_phrase_tokens_for_sequence(
            tokens, phrase_by_tokens, phrase_max_tokens
        )
        m = len(phrase_tokens)
        if m < 2:
            continue
        for i in range(m - 1):
            p1 = phrase_tokens[i]
            p2 = phrase_tokens[i + 1]
            phrase_bigram_counts[(p1, p2)] += 1


def write_unigram_file(counts: Counter[str], out_path: Path) -> None:
    # <word>\t<count>
    with out_path.open("w", encoding="utf-8") as f:
        for word, c in sorted(counts.items(), key=lambda x: (-x[1], x[0])):
            f.write(f"{word}\t{c}\n")


def write_bigram_file(counts: Counter[Tuple[str, str]], out_path: Path) -> None:
    # ('w1', 'w2')\t<count>
    with out_path.open("w", encoding="utf-8") as f:
        for (w1, w2), c in sorted(
            counts.items(), key=lambda x: (-x[1], x[0][0], x[0][1])
        ):
            f.write(f"({w1!r}, {w2!r})\t{c}\n")


def write_phrase_unigram_file(counts: Counter[str], out_path: Path) -> None:
    # phrase_with_underscores\t<count>
    with out_path.open("w", encoding="utf-8") as f:
        for phrase, c in sorted(counts.items(), key=lambda x: (-x[1], x[0])):
            f.write(f"{phrase}\t{c}\n")


def write_phrase_bigram_file(counts: Counter[Tuple[str, str]], out_path: Path) -> None:
    # ('phrase1', 'phrase2')\t<count>   — matches myWord bigramphrase format
    with out_path.open("w", encoding="utf-8") as f:
        for (p1, p2), c in sorted(
            counts.items(), key=lambda x: (-x[1], x[0][0], x[0][1])
        ):
            f.write(f"({p1!r}, {p2!r})\t{c}\n")


def write_unknowns_json(counts: Counter[str], out_path: Path) -> None:
    """
    Unknown token log, e.g.:
      {
        "ဿ": 131,
        "weird_token": 17,
        ...
      }
    """
    items = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    data = {tok: cnt for tok, cnt in items}
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build chronicle n-gram counts using newserver's segmenter."
    )
    parser.add_argument(
        "files",
        nargs="+",
        help="Chronicle text files (UTF-8) to process",
    )
    parser.add_argument(
        "--out-dir",
        default="chronicle_ngrams",
        help="Output directory for LM files (default: chronicle_ngrams)",
    )
    args = parser.parse_args()

    in_paths = [Path(p) for p in args.files]
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Initialise dictionary + LM brain just like the server
    newserver.load_dictionary()
    newserver.init_advanced_segmenter()

    unigram_counts: Counter[str] = Counter()
    bigram_counts: Counter[Tuple[str, str]] = Counter()
    phrase_unigram_counts: Counter[str] = Counter()
    phrase_bigram_counts: Counter[Tuple[str, str]] = Counter()
    unknown_counts: Counter[str] = Counter()

    # First pass: word unigrams/bigrams, phrase unigrams, unknown log
    for p in in_paths:
        print(f"First pass (counts) for {p} ...")
        process_file_first_pass(p, unigram_counts, bigram_counts, phrase_unigram_counts, unknown_counts)

    # Build phrase inventory from phrase_unigram_counts
    phrase_by_tokens, phrase_token_counts, phrase_max_tokens = build_phrase_inventory(
        phrase_unigram_counts,
        min_count=PHRASE_INVENTORY_MIN_COUNT,
        max_tokens=MAX_PHRASE_LEN,
    )
    print(f"Phrase inventory size (multiword): {len(phrase_token_counts)}")
    print(f"Max phrase length in inventory: {phrase_max_tokens}")

    # Second pass: phrase bigrams over phrase token sequences
    for p in in_paths:
        print(f"Second pass (phrase bigrams) for {p} ...")
        process_file_second_pass_phrase_bigrams(
            p, phrase_bigram_counts, phrase_by_tokens, phrase_max_tokens
        )

    # Write LM files
    write_unigram_file(unigram_counts, out_dir / "chronicle-unigram-word.txt")
    write_bigram_file(bigram_counts, out_dir / "chronicle-bigram-word.txt")
    write_phrase_unigram_file(phrase_unigram_counts, out_dir / "chronicle-unigram-phrase.txt")
    write_phrase_bigram_file(phrase_bigram_counts, out_dir / "chronicle-bigram-phrase.txt")
    write_unknowns_json(unknown_counts, out_dir / "chronicle-unknown-words.json")

    print("Done.")
    print(f"  Known-word unigram types:      {len(unigram_counts)}")
    print(f"  Known-word bigram types:       {len(bigram_counts)}")
    print(f"  Phrase unigram types:          {len(phrase_unigram_counts)}")
    print(f"  Phrase bigram types:           {len(phrase_bigram_counts)}")
    print(f"  Unknown token types (Myanmar): {len(unknown_counts)}")


if __name__ == "__main__":
    main()
