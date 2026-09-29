#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Convert one or more CoNLL-U files into spaCy DocBin training data for
joint POS + DEP + sentence segmentation learning.

Key property:
  - Sentences are concatenated into continuous token streams within each Doc.
  - There are NO blank-line / document-boundary cues between sentences inside a Doc.
  - Gold sentence starts are provided by setting SENT_START=1 on the first token
    of each original sentence, and 0 elsewhere.

This matches your plan: the model can't "see" sentence boundaries from whitespace,
but can learn them from gold SENT_START supervision and the parser.
"""

from __future__ import annotations

import argparse
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator, List, Optional, Sequence, Tuple


@dataclass(frozen=True)
class ConlluTok:
    form: str
    upos: str
    head: int  # 0=root else 1..n
    deprel: str


def iter_conllu_sentences(path: Path) -> Iterator[List[ConlluTok]]:
    sent: List[ConlluTok] = []
    with path.open("r", encoding="utf-8", errors="replace") as f:
        for raw in f:
            line = raw.rstrip("\n")
            if not line.strip():
                if sent:
                    yield sent
                    sent = []
                continue
            if line.startswith("#"):
                continue
            cols = line.split("\t")
            if len(cols) < 8:
                continue
            tid = cols[0]
            if "-" in tid or "." in tid:
                continue
            try:
                _ = int(tid)
            except Exception:
                continue

            form = cols[1]
            upos = cols[3] if cols[3] and cols[3] != "_" else "X"
            head = int(cols[6]) if cols[6] and cols[6].isdigit() else 0
            deprel = cols[7] if cols[7] and cols[7] != "_" else "dep"
            sent.append(ConlluTok(form=form, upos=upos, head=head, deprel=deprel))
    if sent:
        yield sent


def iter_all_sentences(paths: Sequence[Path]) -> Iterator[List[ConlluTok]]:
    for p in paths:
        yield from iter_conllu_sentences(p)


def chunk_sentences_to_docs(
    sentences: Iterable[List[ConlluTok]],
    *,
    max_tokens_per_doc: int,
) -> Iterator[List[List[ConlluTok]]]:
    """
    Group sentences into documents, only cutting at sentence boundaries.
    """
    cur: List[List[ConlluTok]] = []
    cur_len = 0
    for sent in sentences:
        if not sent:
            continue
        if cur and (cur_len + len(sent) > max_tokens_per_doc):
            yield cur
            cur = []
            cur_len = 0
        cur.append(sent)
        cur_len += len(sent)
    if cur:
        yield cur


def build_docbin(
    docs_sents: Sequence[Sequence[List[ConlluTok]]],
    *,
    store_user_data: bool,
):
    import numpy as np  # type: ignore
    import spacy  # type: ignore
    from spacy.attrs import DEP, HEAD, POS, SENT_START  # type: ignore
    from spacy.tokens import Doc, DocBin  # type: ignore

    nlp = spacy.blank("xx")  # vocab container only
    db = DocBin(store_user_data=store_user_data)

    for doc_sents in docs_sents:
        # Flatten tokens
        tokens: List[ConlluTok] = []
        sent_starts_local: List[int] = []
        for sent in doc_sents:
            if not sent:
                continue
            sent_starts_local.append(len(tokens))
            tokens.extend(sent)

        if not tokens:
            continue

        words = [t.form for t in tokens]
        spaces = [True] * (len(words) - 1) + [False]
        doc = Doc(nlp.vocab, words=words, spaces=spaces)

        # Build gold arrays.
        # spaCy expects HEAD as *relative* head offset (head_index - token_index).
        heads: List[int] = []
        deps: List[int] = []
        poss: List[int] = []
        sent_start_attr: List[int] = [0] * len(tokens)

        sent_start_set = set(sent_starts_local)
        for i, tok in enumerate(tokens):
            if i in sent_start_set:
                sent_start_attr[i] = 1

            poss.append(nlp.vocab.strings.add(tok.upos))
            deps.append(nlp.vocab.strings.add(tok.deprel))

            if tok.head == 0:
                heads.append(0)  # root offset is 0
            else:
                # tok.head is 1-based within its sentence; convert to absolute index within doc
                # by adding the sentence start offset.
                # First determine which sentence this token belongs to.
                # We can find the last sent_start <= i.
                # (doc sizes are moderate; linear scan is fine.)
                sent0 = 0
                for s0 in sent_starts_local:
                    if s0 <= i:
                        sent0 = s0
                    else:
                        break
                head_abs = sent0 + (tok.head - 1)
                heads.append(head_abs - i)

        attrs = [HEAD, DEP, POS, SENT_START]
        # spaCy's Doc.from_array expects uint64 arrays for string-hash attrs (DEP/POS),
        # but HEAD and SENT_START are signed ints. Use uint64 storage and view-cast.
        arr = np.zeros((len(tokens), len(attrs)), dtype="uint64")
        arr[:, 0] = np.asarray(heads, dtype="int64").view("uint64")
        arr[:, 1] = np.asarray(deps, dtype="uint64")
        arr[:, 2] = np.asarray(poss, dtype="uint64")
        arr[:, 3] = np.asarray(sent_start_attr, dtype="int64").view("uint64")

        doc.from_array(attrs, arr)
        db.add(doc)

    return db


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in_conllu", action="append", required=True, help="Repeatable. Input CoNLL-U path(s).")
    ap.add_argument("--out_dir", required=True)
    ap.add_argument("--train_ratio", type=float, default=0.90)
    ap.add_argument("--seed", type=int, default=1337)
    ap.add_argument("--max_tokens_per_doc", type=int, default=5000)
    ap.add_argument("--store_user_data", action="store_true")
    args = ap.parse_args()

    paths = [Path(p) for p in args.in_conllu]
    for p in paths:
        if not p.exists():
            raise SystemExit(f"Missing input: {p}")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_train = out_dir / "train.spacy"
    out_dev = out_dir / "dev.spacy"

    sents = list(iter_all_sentences(paths))
    rng = random.Random(int(args.seed))
    rng.shuffle(sents)

    n_train = int(round(len(sents) * float(args.train_ratio)))
    train_sents = sents[:n_train]
    dev_sents = sents[n_train:]

    train_docs = list(chunk_sentences_to_docs(train_sents, max_tokens_per_doc=int(args.max_tokens_per_doc)))
    dev_docs = list(chunk_sentences_to_docs(dev_sents, max_tokens_per_doc=int(args.max_tokens_per_doc)))

    db_train = build_docbin(train_docs, store_user_data=bool(args.store_user_data))
    db_dev = build_docbin(dev_docs, store_user_data=bool(args.store_user_data))

    db_train.to_disk(out_train)
    db_dev.to_disk(out_dev)

    print(f"WROTE {out_train} (docs={len(train_docs)} sents={len(train_sents)})")
    print(f"WROTE {out_dev} (docs={len(dev_docs)} sents={len(dev_sents)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
