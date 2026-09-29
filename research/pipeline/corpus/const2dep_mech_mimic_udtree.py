# -*- coding: utf-8 -*-
"""
const2dep_mech_mimic_udtree.py

Mechanical constituency → dependency conversion constrained to myUDTree.

Key points:
- UPOS/DEPREL restricted to myUDTree tagsets.
- Lexeme stats from myUDTree drive majority UPOS and (for function tokens) DEPREL.
- Head selection favors content heads over trailing particles.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple, Union
from collections import Counter, defaultdict
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
# Allowed myUDTree tagsets
# -------------------------

ALLOWED_UPOS = {
    "ADJ",
    "ADP",
    "ADV",
    "CCONJ",
    "INTJ",
    "NOUN",
    "NUM",
    "PART",
    "PRON",
    "PROPN",
    "PUNCT",
    "SCONJ",
    "SYM",
    "VERB",
}
ALLOWED_DEPREL = {
    "acl",
    "advmod",
    "amod",
    "aux",
    "case",
    "compound",
    "mark",
    "nmod",
    "nummod",
    "obl",
    "punct",
    "root",
}

# Constituency preterminal labels we expect
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

# Conservative fallback UPOS mapping (only used when FORM is unseen in myUDTree)
FALLBACK_UPOS = {
    "noun": "NOUN",
    "noun-adp": "NOUN",
    "verb": "VERB",
    "part": "PART",
    "adp": "ADP",
    "num": "NUM",
    "det": "ADJ",  # myUDTree treats determiners as ADJ/PRON; default ADJ
    "conj": "CCONJ",
    "adv": "ADV",
    "adj": "ADJ",
    "punct": "PUNCT",
    "pron": "PRON",
    "pron-adp": "PRON",
    "x": "SYM",
}

FUNCTION_UPOS = {"ADP", "PART", "CCONJ", "SCONJ"}

# If FORM unseen, we still need a case/mark decision for function-like tokens
MARK_LEXEMES_FALLBACK = {
    "ရန်",
    "စေရန်",
    "ပြီးနောက်",
    "ပြီးတဲ့နောက်",
    "စဉ်",
    "သောအခါ",
    "သော်လည်း",
    "ဖို့",
}

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


def is_preterminal(n: Node) -> bool:
    return n.label in PRETERMINALS and len(n.children) == 1 and isinstance(n.children[0], Leaf)


# -------------------------
# myUDTree lexeme stats
# -------------------------


def load_udtree_lexeme_stats(conllu_path: str) -> Tuple[Dict[str, str], Dict[str, str]]:
    """
    Returns:
      form2upos: FORM -> majority UPOS
      form2deprel: FORM -> majority DEPREL
    (computed over all tokens in the reference file)
    """
    up_counts: Dict[str, Counter] = defaultdict(Counter)
    rel_counts: Dict[str, Counter] = defaultdict(Counter)

    with open(conllu_path, "r", encoding="utf-8") as f:
        for ln in f:
            ln = ln.rstrip("\n")
            if not ln or ln.startswith("#"):
                continue
            cols = ln.split("\t")
            if len(cols) < 8:
                continue
            tid = cols[0]
            if "-" in tid or "." in tid:
                continue
            form = cols[1]
            upos = cols[3]
            rel = cols[7]
            if upos in ALLOWED_UPOS:
                up_counts[form][upos] += 1
            if rel in ALLOWED_DEPREL:
                rel_counts[form][rel] += 1

    form2upos = {f: c.most_common(1)[0][0] for f, c in up_counts.items() if c}
    form2deprel = {f: c.most_common(1)[0][0] for f, c in rel_counts.items() if c}
    return form2upos, form2deprel


# -------------------------
# Terminals
# -------------------------


@dataclass
class Term:
    idx: int
    form: str
    pretag: str
    upos: str


def collect_terms(tree: Node, form2upos: Dict[str, str]) -> List[Term]:
    out: List[Term] = []

    compat = {
        "noun": {"NOUN", "PROPN", "PRON", "ADJ", "NUM", "PART", "ADP"},
        "noun-adp": {"NOUN", "PROPN", "PRON", "ADJ", "NUM", "PART", "ADP"},
        "verb": {"VERB"},
        "adj": {"ADJ", "VERB"},
        "adv": {"ADV"},
        "det": {"ADJ", "PRON"},
        "pron": {"PRON", "NOUN"},
        "pron-adp": {"PRON", "NOUN"},
        "part": {"PART", "ADP", "SCONJ", "CCONJ"},
        "adp": {"ADP", "PART", "SCONJ"},
        "conj": {"CCONJ", "SCONJ", "ADV"},
        "num": {"NUM"},
        "punct": {"PUNCT"},
        "x": {"SYM"},
    }

    def upos_compatible(pretag: str, upos: str) -> bool:
        key = pretag.lower()
        if key not in compat:
            return True
        return upos in compat[key]

    def decide_upos(pretag: str, form: str) -> str:
        # strict mimic: if FORM seen in myUDTree, use that UPOS
        if form in form2upos:
            up = form2upos[form]
            if upos_compatible(pretag, up):
                return up
        # else fallback but restricted
        up = FALLBACK_UPOS.get(pretag, "NOUN")
        if up not in ALLOWED_UPOS:
            up = "NOUN"
        return up

    def walk(t: Tree):
        if isinstance(t, Leaf):
            return
        n: Node = t
        if is_preterminal(n):
            pretag = n.label
            form = n.children[0].token  # type: ignore
            upos = decide_upos(pretag, form)
            out.append(Term(len(out) + 1, form, pretag, upos))
        else:
            for c in n.children:
                walk(c)

    walk(tree)
    return out


def contains_any_pretag(n: Node, pretags: set[str]) -> bool:
    if is_preterminal(n):
        return n.label in pretags
    for c in n.children:
        if isinstance(c, Node) and contains_any_pretag(c, pretags):
            return True
    return False


# -------------------------
# Head percolation (coarse; structure-first)
# -------------------------


@dataclass
class SpanInfo:
    start: int
    end: int
    head: int


def head_percolate(tree: Node, terms: List[Term]) -> Dict[int, SpanInfo]:
    cursor = 1
    span: Dict[int, SpanInfo] = {}

    def pick_head(label: str, child_infos: List[SpanInfo], child_nodes: List[Node]) -> int:
        def head_upos(ci: SpanInfo) -> str:
            return terms[ci.head - 1].upos

        label_key = label.lower()

        # ROOT: last verb-containing child else rightmost
        if label_key == "root":
            for cn, ci in reversed(list(zip(child_nodes, child_infos))):
                if head_upos(ci) == "VERB":
                    return ci.head
            return child_infos[-1].head

        # VERB/verb: prefer last verb-containing child else rightmost
        if label_key == "verb":
            for cn, ci in reversed(list(zip(child_nodes, child_infos))):
                if head_upos(ci) == "VERB":
                    return ci.head
            for cn, ci in reversed(list(zip(child_nodes, child_infos))):
                if head_upos(ci) not in FUNCTION_UPOS and head_upos(ci) != "PUNCT":
                    return ci.head
            return child_infos[-1].head

        # NOUN/noun: prefer last noun/pron/adj-containing child else rightmost
        if label_key == "noun":
            for cn, ci in reversed(list(zip(child_nodes, child_infos))):
                if head_upos(ci) in {"NOUN", "PROPN", "PRON", "ADJ", "NUM"}:
                    return ci.head
            return child_infos[-1].head

        # default: rightmost
        return child_infos[-1].head

    def walk(t: Tree) -> SpanInfo:
        nonlocal cursor
        if isinstance(t, Leaf):
            raise ValueError("Unexpected bare Leaf")

        n: Node = t

        if is_preterminal(n):
            s = cursor
            e = cursor
            h = cursor
            cursor += 1
            info = SpanInfo(s, e, h)
            span[id(n)] = info
            return info

        child_nodes = [c for c in n.children if isinstance(c, Node)]
        child_infos: List[SpanInfo] = []
        for c in child_nodes:
            child_infos.append(walk(c))

        if not child_infos:
            info = SpanInfo(cursor, cursor - 1, max(1, cursor - 1))
            span[id(n)] = info
            return info

        s = child_infos[0].start
        e = child_infos[-1].end
        h = pick_head(n.label, child_infos, child_nodes)
        info = SpanInfo(s, e, h)
        span[id(n)] = info
        return info

    walk(tree)
    if cursor != len(terms) + 1:
        raise ValueError(f"Terminal mismatch: saw {cursor - 1}, expected {len(terms)}")
    return span


# -------------------------
# Dependency attachment (restricted to myUDTree rel set)
# -------------------------


@dataclass
class DepArc:
    head: int
    dep: int
    rel: str


def fallback_case_mark(form: str) -> str:
    return "mark" if form in MARK_LEXEMES_FALLBACK else "case"


def attach_rel(
    parent_label: str,
    dep_term: Term,
    form2deprel: Dict[str, str],
) -> str:
    parent_key = parent_label.lower()

    # If FORM has a majority relation in myUDTree, prefer it for function tokens.
    if dep_term.form in form2deprel and dep_term.upos in FUNCTION_UPOS:
        r = form2deprel[dep_term.form]
        if r in ALLOWED_DEPREL:
            return r

    # Structural fallback rules (allowed rels only)
    if dep_term.upos == "PUNCT":
        return "punct"
    if dep_term.upos == "NUM":
        return "nummod"

    if dep_term.upos in FUNCTION_UPOS:
        return fallback_case_mark(dep_term.form)

    if parent_key == "noun":
        if dep_term.upos in {"NOUN", "PROPN", "PRON"}:
            return "compound"
        if dep_term.upos == "ADJ":
            return "amod"
        if dep_term.upos == "ADV":
            return "advmod"
        if dep_term.upos == "VERB":
            return "acl"
        return "compound"

    if parent_key == "verb":
        if dep_term.upos == "VERB":
            return "acl"
        if dep_term.upos == "ADJ":
            return "amod"
        if dep_term.upos == "ADV":
            return "advmod"
        if dep_term.upos in {"NOUN", "PROPN", "PRON"}:
            return "obl"
        return "obl"

    # default
    if dep_term.upos == "VERB":
        return "acl"
    if dep_term.upos == "ADJ":
        return "amod"
    if dep_term.upos == "ADV":
        return "advmod"
    if dep_term.upos == "NUM":
        return "nummod"
    if dep_term.upos in {"NOUN", "PROPN", "PRON"}:
        return "obl"
    return "obl"


def build_arcs(
    tree: Node,
    terms: List[Term],
    spans: Dict[int, SpanInfo],
    form2deprel: Dict[str, str],
) -> List[DepArc]:
    assigned: Dict[int, Tuple[int, str]] = {}

    def set_arc(dep: int, head: int, rel: str):
        if rel not in ALLOWED_DEPREL:
            rel = "obl"
        if dep in assigned:
            return
        assigned[dep] = (head, rel)

    def walk(n: Node):
        if is_preterminal(n):
            return
        info = spans[id(n)]
        parent_head = info.head

        child_nodes = [c for c in n.children if isinstance(c, Node)]
        for c in child_nodes:
            ci = spans[id(c)]
            if ci.head != parent_head:
                dep_term = terms[ci.head - 1]
                rel = attach_rel(n.label, dep_term, form2deprel)
                set_arc(ci.head, parent_head, rel)
            walk(c)

    walk(tree)

    root_head = spans[id(tree)].head
    assigned.setdefault(root_head, (0, "root"))

    out: List[DepArc] = []
    for t in terms:
        if t.idx == root_head:
            out.append(DepArc(0, t.idx, "root"))
        else:
            h, r = assigned.get(t.idx, (root_head, "obl"))
            out.append(DepArc(h, t.idx, r))
    out.sort(key=lambda a: a.dep)
    return out


def render_conllu(terms: List[Term], arcs: List[DepArc]) -> str:
    arc_by_dep = {a.dep: a for a in arcs}
    lines = []
    for t in terms:
        a = arc_by_dep[t.idx]
        upos = t.upos if t.upos in ALLOWED_UPOS else "NOUN"
        rel = a.rel if a.rel in ALLOWED_DEPREL else "obl"
        lines.append(f"{t.idx}\t{t.form}\t_\t{upos}\t_\t_\t{a.head}\t{rel}\t_\t_")
    return "\n".join(lines)


# -------------------------
# Public API / CLI
# -------------------------


def convert_one(
    line: str, form2upos: Dict[str, str], form2deprel: Dict[str, str]
) -> Tuple[str, str]:
    if "\t" not in line:
        raise ValueError("Expected TAB between sent-id and tree")
    sid, tree_str = line.split("\t", 1)
    tree = parse_sexpr(tree_str.strip())
    terms = collect_terms(tree, form2upos)
    spans = head_percolate(tree, terms)
    arcs = build_arcs(tree, terms, spans, form2deprel)
    return sid, render_conllu(terms, arcs)


def main():
    # Usage:
    #   python const2dep_mech_mimic_udtree.py --udtree path/to/myUDTree.conllu < input.txt > out.conllu
    args = sys.argv[1:]
    udtree_path = None
    if "--udtree" in args:
        j = args.index("--udtree")
        if j + 1 >= len(args):
            raise SystemExit("Missing value after --udtree")
        udtree_path = args[j + 1]

    if not udtree_path:
        raise SystemExit("Must pass --udtree path/to/myUDTree.conllu (used to mimic tag scheme)")

    form2upos, form2deprel = load_udtree_lexeme_stats(udtree_path)

    data = [ln for ln in sys.stdin.read().splitlines() if ln.strip()]
    for k, ln in enumerate(data):
        sid, conllu = convert_one(ln, form2upos, form2deprel)
        print(sid)
        print(conllu)
        if k != len(data) - 1:
            print()


if __name__ == "__main__":
    main()
