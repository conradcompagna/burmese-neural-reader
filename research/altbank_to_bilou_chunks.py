from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple, Union
import re
import sys


# -------------------------
# Tree structures
# -------------------------


@dataclass
class Node:
    label: str
    children: List["Tree"]


@dataclass
class Leaf:
    token: str


Tree = Union[Node, Leaf]


# -------------------------
# Parsing
# -------------------------


TOK_RE = re.compile(r"""\(|\)|[^\s()]+""", re.UNICODE)


def parse_sexpr(s: str) -> Node:
    toks = TOK_RE.findall(s)
    i = 0

    def parse() -> Tree:
        nonlocal i
        if toks[i] != "(":
            t = toks[i]
            i += 1
            return Leaf(t)

        i += 1
        label = toks[i]
        i += 1
        children: List[Tree] = []
        while i < len(toks) and toks[i] != ")":
            children.append(parse())
        if i >= len(toks) or toks[i] != ")":
            raise ValueError("Unbalanced parentheses")
        i += 1
        return Node(label, children)

    tree = parse()
    if not isinstance(tree, Node):
        raise ValueError("Top-level must be a Node")
    if i != len(toks):
        raise ValueError("Extra tokens after parse")
    return tree


# -------------------------
# Chunking
# -------------------------


PRETERMINALS = {
    "noun",
    "noun-adp",
    "verb",
    "part",
    "adp",
    "num",
    "det",
    "conj",
    "adv",
    "adj",
    "punct",
    "pron",
    "pron-adp",
    "x",
}

PHRASE_LABELS = {"NOUN", "VERB", "ADJ", "ADV"}
LABEL_MAP = {
    "NOUN": "NP",
    "VERB": "VP",
    "ADJ": "ADJP",
    "ADV": "ADVP",
}


@dataclass
class Term:
    idx: int
    form: str
    pretag: str


@dataclass
class Span:
    start: int
    end: int
    label: str


def is_preterminal(n: Node) -> bool:
    return n.label in PRETERMINALS and len(n.children) == 1 and isinstance(n.children[0], Leaf)


def collect_terms(tree: Node) -> List[Term]:
    out: List[Term] = []

    def walk(t: Tree):
        if isinstance(t, Leaf):
            return
        n: Node = t
        if is_preterminal(n):
            form = n.children[0].token  # type: ignore
            out.append(Term(len(out) + 1, form, n.label))
        else:
            for c in n.children:
                walk(c)

    walk(tree)
    return out


def compute_spans(tree: Node, terms: List[Term]) -> Dict[int, Tuple[int, int]]:
    cursor = 1
    spans: Dict[int, Tuple[int, int]] = {}

    def walk(t: Tree) -> Tuple[int, int]:
        nonlocal cursor
        if isinstance(t, Leaf):
            raise ValueError("Unexpected bare Leaf")
        n: Node = t
        if is_preterminal(n):
            s = cursor
            e = cursor
            cursor += 1
            spans[id(n)] = (s, e)
            return s, e
        child_nodes = [c for c in n.children if isinstance(c, Node)]
        if not child_nodes:
            spans[id(n)] = (cursor, cursor - 1)
            return cursor, cursor - 1
        s0, e0 = walk(child_nodes[0])
        s = s0
        e = e0
        for c in child_nodes[1:]:
            cs, ce = walk(c)
            s = min(s, cs)
            e = max(e, ce)
        spans[id(n)] = (s, e)
        return s, e

    walk(tree)
    if cursor != len(terms) + 1:
        raise ValueError("Terminal mismatch")
    return spans


def extract_base_chunks(tree_str: str) -> Tuple[List[Tuple[str, str]], List[Span]]:
    toks = TOK_RE.findall(tree_str)
    leaves: List[Tuple[str, str]] = []
    stack: List[Tuple[str, int, List[Span]]] = []
    root_spans: List[Span] = []

    i = 0
    while i < len(toks):
        t = toks[i]
        if t == "(":
            label = toks[i + 1]
            # preterminal: (pos tok)
            if i + 3 < len(toks) and toks[i + 2] not in ("(", ")") and toks[i + 3] == ")":
                pos = label
                tok = toks[i + 2]
                leaves.append((pos, tok))
                i += 4
                continue
            stack.append((label, len(leaves), []))
            i += 2
        elif t == ")":
            label, start, spans = stack.pop()
            end = len(leaves)
            # propagate child spans upward
            if stack:
                plabel, pstart, pspans = stack[-1]
                pspans.extend(spans)
                stack[-1] = (plabel, pstart, pspans)

            if label in PHRASE_LABELS and end > start:
                spans.append(Span(start, end, LABEL_MAP[label]))

            if stack:
                plabel, pstart, pspans = stack[-1]
                pspans.extend(spans)
                stack[-1] = (plabel, pstart, pspans)
            else:
                root_spans = spans
            i += 1
        else:
            i += 1

    # base chunks: keep spans that do NOT contain another span of same label
    spans_by_label: Dict[str, List[Span]] = {}
    for s in root_spans:
        spans_by_label.setdefault(s.label, []).append(s)

    base_spans: List[Span] = []
    for lab, ss in spans_by_label.items():
        for s in ss:
            contains_inner = False
            for o in ss:
                if o is s:
                    continue
                if s.start <= o.start and o.end <= s.end and (o.start > s.start or o.end < s.end):
                    contains_inner = True
                    break
            if not contains_inner:
                base_spans.append(s)

    # resolve overlaps deterministically: prefer NP > VP > ADJP > ADVP, then shorter span
    pref = {"NP": 0, "VP": 1, "ADJP": 2, "ADVP": 3}
    base_spans.sort(key=lambda x: (x.start, pref.get(x.label, 9), x.end - x.start))
    chosen: List[Span] = []
    occupied = set()
    for s in base_spans:
        if any(i in occupied for i in range(s.start, s.end)):
            continue
        chosen.append(s)
        for i in range(s.start, s.end):
            occupied.add(i)

    return leaves, chosen


def fallback_chunk_label(pretag: str) -> str:
    if pretag in {"verb", "part"}:
        return "VP"
    if pretag in {"adj"}:
        return "ADJP"
    if pretag in {"adv"}:
        return "ADVP"
    # noun/pron/num/det/adp/conj/punct/x -> NP
    return "NP"


def assign_bilou(leaves: List[Tuple[str, str]], chunks: List[Span]) -> List[str]:
    n_tokens = len(leaves)
    tags = [""] * n_tokens

    # Build a coverage map for initial chunks.
    cover = [None] * n_tokens  # span index
    for idx, c in enumerate(chunks):
        for i in range(c.start, c.end):
            cover[i] = idx

    # Roll uncovered non-punct tokens into the preceding chunk.
    for i, (pos, _tok) in enumerate(leaves):
        if cover[i] is not None:
            continue
        if pos == "punct":
            continue
        # Find nearest preceding covered token.
        j = i - 1
        while j >= 0 and cover[j] is None:
            j -= 1
        if j >= 0 and cover[j] is not None:
            cidx = cover[j]
            c = chunks[cidx]
            # Extend chunk span to include this token.
            if i < c.start:
                c.start = i
            if i >= c.end:
                c.end = i + 1
            cover[i] = cidx
        else:
            # No preceding chunk: create a singleton chunk.
            lab = fallback_chunk_label(pos)
            chunks.append(Span(i, i + 1, lab))
            cover[i] = len(chunks) - 1

    # Render BILOU tags from final chunk spans.
    for c in chunks:
        ln = c.end - c.start
        if ln == 1:
            tags[c.start] = f"U-{c.label}"
        else:
            tags[c.start] = f"B-{c.label}"
            for i in range(c.start + 1, c.end - 1):
                tags[i] = f"I-{c.label}"
            tags[c.end - 1] = f"L-{c.label}"

    # Any remaining punctuation or gaps become O.
    for i, (pos, _tok) in enumerate(leaves):
        if not tags[i]:
            if pos == "punct":
                tags[i] = "O"
            else:
                lab = fallback_chunk_label(pos)
                tags[i] = f"U-{lab}"
    return tags


def convert_line(line: str) -> Tuple[str, List[Tuple[str, str]]]:
    if "\t" not in line:
        raise ValueError("Expected TAB between sent-id and tree")
    sid, tree_str = line.split("\t", 1)
    leaves, chunks = extract_base_chunks(tree_str.strip())
    tags = assign_bilou(leaves, chunks)
    return sid, [(tok, tags[i]) for i, (_pos, tok) in enumerate(leaves)]


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("Usage: python altbank_to_bilou_chunks.py <altbank> <out.tsv>")
    in_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2])

    with in_path.open("r", encoding="utf-8") as fin, out_path.open(
        "w", encoding="utf-8"
    ) as fout:
        for line in fin:
            line = line.strip()
            if not line:
                continue
            sid, pairs = convert_line(line)
            fout.write(sid + "\n")
            for tok, tag in pairs:
                fout.write(f"{tok}\t{tag}\n")
            fout.write("\n")


if __name__ == "__main__":
    main()
