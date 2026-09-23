"""Burmese reader: grammar."""

from __future__ import annotations

import csv
from pathlib import Path

from . import (
    dictionary_dp as dictionary_dp_service,
    lexicon as lexicon_service,
    normalization as normalization_service,
    pos as pos_service,
)
from .runtime import feature_state

GRAMMAR_CATEGORY_TO_TYPE: dict[str, str] = {
    "Clauses and verb attributes (Stc~, Phr~)": "CLAUSE_ATTR",
    "Common elements in compound nouns (N~, V~)": "COMPOUND_NOUN_ELEM",
    "Common elements in compound verbs (V~)": "COMPOUND_VERB_ELEM",
    "Common numeratives (classifiers, NÃâÃÂº~)": "CLASSIFIER",
    "Common pre-verbs (~V)": "PREVERB",
    "Coordinate markers (NÃâÃÂ¹~NÃâÃÂ², NÃâÃÂ¹~NÃâÃÂ²~)": "COORDINATOR",
    "Location nouns": "LOCATION_NOUN",
    "Miscellaneous function-like items": "MISC_FUNC",
    "Noun attribute markers (N~N)": "NOUN_ATTR_MARKER",
    "Noun markers (case/postposition, N~)": "NOUN_MARKER",
    "Noun modifiers (N~)": "NOUN_MODIFIER",
    "Negation markers (V~)": "NEGATION_MARKER",
    "Selectives (demonstratives / interrogatives, ~, ~N, ~sfx)": "SELECTIVE",
    "Sentence markers (V~, N~)": "SENTENCE_MARKER",
    "Sentence-medial phrase particles (Phr~)": "SENTENCE_MEDIAL_PART",
    "Sentence-final phrase particles (Stc~)": "SENTENCE_FINAL_PART",
    "Special head nouns / nominalizers (V~)": "HEAD_NOUN",
    "Subordinate clause markers (V~, N~)": "SUBORDINATE_CLAUSE_MARKER",
    "Subordinate sentence markers (VA~)": "SUBORDINATE_SENTENCE_MARKER",
    "Verb attribute markers (V~N)": "VERB_ATTR_MARKER",
    "Verb modifiers / auxiliaries (V~)": "VERB_MODIFIER",
}


GRAMMAR_LINK_RULES: dict[str, dict] = {
    # Case markers and postpositions typically follow an NP (noun or pronoun)
    "NOUN_MARKER": {
        "role": "case/postposition",
        "direction": "LEFT",
        "target_coarse_pos": {"N", "PRON"},
        "max_distance": 1,
    },
    # Noun modifiers (plural markers, focus markers for NPs, etc.) also follow an NP
    "NOUN_MODIFIER": {
        "role": "noun-modifier",
        "direction": "LEFT",
        "target_coarse_pos": {"N", "PRON"},
        "max_distance": 1,
    },
    # NounÃÂ¢Ã¢âÂ¬Ã¢â¬Ånoun attribute markers usually sit between nouns; link to the following N
    "NOUN_ATTR_MARKER": {
        "role": "noun-attribute-link",
        "direction": "RIGHT",
        "target_coarse_pos": {"N", "PRON"},
        "max_distance": 1,
    },
    # Classifiers most often follow a numeral or a noun; we treat them as attaching left
    "CLASSIFIER": {
        "role": "classifier",
        "direction": "LEFT",
        "target_coarse_pos": {"NUM", "N", "PRON"},
        "max_distance": 1,
    },
    # Selectives (demonstratives / interrogatives) behave like noun modifiers
    "SELECTIVE": {
        "role": "selective",
        "direction": "LEFT",
        "target_coarse_pos": {"N", "PRON"},
        "max_distance": 1,
    },
    # Location nouns usually follow an NP they localise
    "LOCATION_NOUN": {
        "role": "location-noun",
        "direction": "LEFT",
        "target_coarse_pos": {"N", "PRON"},
        "max_distance": 1,
    },
    # Verb modifiers / auxiliaries follow a main verb stem
    "VERB_MODIFIER": {
        "role": "verb-modifier",
        "direction": "LEFT",
        "target_coarse_pos": {"V"},
        "max_distance": 1,
    },
    # Negation markers typically precede the verb they negate
    "NEGATION_MARKER": {
        "role": "negation",
        "direction": "RIGHT",
        "target_coarse_pos": {"V"},
        "max_distance": 1,
    },
    # Verb attribute markers link a preceding verb to a following nominal
    "VERB_ATTR_MARKER": {
        "role": "verb-attribute-link",
        "direction": "BOTH",  # expects V on the left; we enforce left=V
        "target_coarse_pos": {"V"},
        "max_distance": 1,
    },
    # Common pre-verbs precede the main verb
    "PREVERB": {
        "role": "pre-verb",
        "direction": "RIGHT",
        "target_coarse_pos": {"V"},
        "max_distance": 1,
    },
    # Elements that form compound verbs attach to a preceding verb stem
    "COMPOUND_VERB_ELEM": {
        "role": "compound-verb-element",
        "direction": "LEFT",
        "target_coarse_pos": {"V"},
        "max_distance": 1,
    },
    # Elements that form compound nouns usually attach to a preceding N
    "COMPOUND_NOUN_ELEM": {
        "role": "compound-noun-element",
        "direction": "LEFT",
        "target_coarse_pos": {"N", "PRON"},
        "max_distance": 1,
    },
    # Special head nouns often nominalise a preceding verb phrase
    "HEAD_NOUN": {
        "role": "head-noun/nominalizer",
        "direction": "LEFT",
        "target_coarse_pos": {"V"},
        "max_distance": 1,
    },
    # Coordinate markers sit between two NPs; here we treat them as linking left NP
    "COORDINATOR": {
        "role": "coordinator",
        "direction": "LEFT",
        "target_coarse_pos": {"N", "PRON"},
        "max_distance": 1,
    },
    # Sentence markers, sentence-medial particles, clause markers etc. operate at clause level.
    # We annotate them but do not draw specific tokenÃÂ¢Ã¢âÂ¬Ã¢â¬Åtoken links.
    "SENTENCE_MARKER": {
        "role": "sentence-marker",
        "direction": "NONE",
        "target_coarse_pos": set(),
        "max_distance": 0,
    },
    "SENTENCE_MEDIAL_PART": {
        "role": "sentence-medial-particle",
        "direction": "NONE",
        "target_coarse_pos": set(),
        "max_distance": 0,
    },
    "SENTENCE_FINAL_PART": {
        "role": "sentence-final-particle",
        "direction": "NONE",
        "target_coarse_pos": set(),
        "max_distance": 0,
    },
    "SUBORDINATE_CLAUSE_MARKER": {
        "role": "subordinate-clause-marker",
        "direction": "NONE",
        "target_coarse_pos": set(),
        "max_distance": 0,
    },
    "SUBORDINATE_SENTENCE_MARKER": {
        "role": "subordinate-sentence-marker",
        "direction": "NONE",
        "target_coarse_pos": set(),
        "max_distance": 0,
    },
    "CLAUSE_ATTR": {
        "role": "clause/verb-attribute",
        "direction": "NONE",
        "target_coarse_pos": set(),
        "max_distance": 0,
    },
    # Miscellaneous items: annotate but do not assume any particular head
    "MISC_FUNC": {
        "role": "misc-function-word",
        "direction": "NONE",
        "target_coarse_pos": set(),
        "max_distance": 0,
    },
}


def load_grammar_lexicon_tsv(path: Path) -> None:
    """
    Load the hand-curated grammar lexicon TSV.
    Expected columns (tab-separated, UTF-8):
        burmese    category    gloss
    Populates the global GRAMMAR_LEXICON mapping:
        form -> [ { "category": str, "type": str, "gloss": str }, ... ]
    """
    lex: dict[str, list[dict]] = {}
    with path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            form = normalization_service.normalize_burmese(
                (row.get("burmese") or "").strip()
            )
            category = (row.get("category") or "").strip()
            gloss = (row.get("gloss") or "").strip()
            if not form or not category:
                continue
            coarse_type = GRAMMAR_CATEGORY_TO_TYPE.get(category, "UNKNOWN")
            entry = {
                "category": category,
                "type": coarse_type,
                "gloss": gloss,
            }
            lex.setdefault(form, []).append(entry)
    state.GRAMMAR_LEXICON = lex
    dictionary_dp_service.rebuild_grammar_forms_cache()


def inject_grammar_heads_into_dict() -> None:
    """
    Ensure grammar-only heads are present in the segmenter so it can pick them.
    If a grammar form is missing, inject a minimal entry.
    """
    if not state.GRAMMAR_LEXICON:
        return
    seg = lexicon_service.get_segmenter_instance()
    layer = seg.dictionary.get_layer("grammar") or seg.dictionary.add_layer(
        "grammar",
        priority=lexicon_service.DICT_PRIORITIES.get("grammar", 50),
        source_name="GRAMMAR",
    )
    for form, entries in state.GRAMMAR_LEXICON.items():
        if form in seg.dictionary:
            continue
        gloss = ""
        if entries:
            gloss = entries[0].get("gloss", "") or ""
        layer.add_entry(form, "", "grammar", senses=[gloss or "[grammar item]"])
    seg.dictionary.rebuild_cache()
    dictionary_dp_service.rebuild_grammar_forms_cache()


def build_grammar_overlay_for_segments(segments: list[str], dict_obj: dict) -> dict:
    """
    Given a list of segmented tokens, build a grammar overlay structure that
    can be sent directly to the UI.
    Input:
        segments  ÃÂ¢Ã¢âÂ¬Ã¢â¬Å list of token strings in sentence order
        dict_obj  ÃÂ¢Ã¢âÂ¬Ã¢â¬Å the merged dictionary (usually DICT)
    Output structure:
        {
          "tokens": [
            {
              "token": "...",
              "coarse_pos": ["N", "V", ...],
              "grammar": [
                {
                  "category": str,       # full category label from TSV
                  "type": str,           # coarse type (NOUN_MARKER, VERB_MODIFIER, ...)
                  "gloss": str,          # English gloss from TSV
                  "active": bool,        # True when the rule fires in this context
                  "link_target": int?,   # index of the head token, if any
                  "link_direction": str? # "left" / "right" or None
                },
                ...
              ],
            },
            ...
          ],
          "links": [
            {
              "from": int,       # index of function word
              "to": int,         # index of head token
              "role": str,       # short role label from GRAMMAR_LINK_RULES
              "category": str,   # original category string
              "type": str,       # coarse type
            },
            ...
          ],
        }
    """
    n = len(segments)
    if n == 0:
        return {"tokens": [], "links": []}
    # Pre-compute coarse POS for every token once
    coarse_pos_seq: list[set[str]] = []
    for tok in segments:
        coarse_pos_seq.append(pos_service._infer_coarse_pos_for_token(tok, dict_obj))
    tokens_overlay: list[dict] = []
    links: list[dict] = []
    for i, tok in enumerate(segments):
        grammar_entries: list[dict] = []
        # Look up grammar lexicon entries for this form
        lex_entries = state.GRAMMAR_LEXICON.get(
            normalization_service.normalize_burmese(tok)
        )
        if lex_entries:
            for lex_entry in lex_entries:
                category = lex_entry.get("category", "")
                coarse_type = lex_entry.get("type", "UNKNOWN")
                gloss = lex_entry.get("gloss", "")
                rule = GRAMMAR_LINK_RULES.get(coarse_type)
                active = False
                link_target = None
                link_dir_str = None
                if rule and rule.get("direction") != "NONE":
                    direction = rule["direction"]
                    target_pos = rule.get("target_coarse_pos", set())
                    max_dist = int(rule.get("max_distance", 1))
                    for j in pos_service._iter_neighbor_indices(
                        i, n, direction, max_dist
                    ):
                        neighbor_types = coarse_pos_seq[j]
                        # Special-case "NUM" requirement: we allow UNKNOWN here as well,
                        # because numerals are not strongly tagged in the dictionary.
                        if target_pos:
                            if "NUM" in target_pos and neighbor_types & {"UNKNOWN"}:
                                match = True
                            else:
                                match = bool(neighbor_types & target_pos)
                        else:
                            match = True
                        if match:
                            active = True
                            link_target = j
                            link_dir_str = "left" if j < i else "right"
                            link = {
                                "from": i,
                                "to": j,
                                "role": rule.get("role", ""),
                                "category": category,
                                "type": coarse_type,
                            }
                            # Avoid duplicate links for the same (from, to, type, category)
                            if link not in links:
                                links.append(link)
                            # Only draw a single link per grammar entry for now
                            break
                grammar_entries.append(
                    {
                        "category": category,
                        "type": coarse_type,
                        "gloss": gloss,
                        "active": active,
                        "link_target": link_target,
                        "link_direction": link_dir_str,
                    }
                )
        tokens_overlay.append(
            {
                "token": tok,
                "coarse_pos": sorted(coarse_pos_seq[i]),
                "grammar": grammar_entries,
            }
        )
    return {"tokens": tokens_overlay, "links": links}


def _new_state():
    from types import SimpleNamespace

    return SimpleNamespace(
        GRAMMAR_LEXICON={},
    )


state = feature_state("grammar", _new_state)
