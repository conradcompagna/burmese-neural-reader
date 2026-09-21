"""Burmese reader: dictionary loaders."""

from __future__ import annotations

import csv
from pathlib import Path

from . import (
    dictionary_types as dictionary_types_service,
    normalization as normalization_service,
    pos_labels as pos_service,
    pronunciation as pronunciation_service,
)


def load_wiktionary_dict(
    path: Path, layer: dictionary_types_service.DictionaryLayer
) -> int:
    """
    Load the Kaikki-based Wiktionary TSV into a dictionary layer.
    Expected format (with header row):
        headword    romanization    pos    definition
    """
    if not path.exists():
        print(f"[WARN] Wiktionary TSV not found: {path}")
        return 0
    print(f"Loading Wiktionary TSV from {path} ...")
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            raw_head = (row.get("headword") or "").strip()
            if not raw_head:
                continue
            head = normalization_service.normalize_headword(raw_head)
            if not head or not normalization_service.contains_burmese(head):
                continue
            roman = (row.get("romanization") or "").strip()
            pos = pos_service.normalize_pos(row.get("pos") or "")
            definition = (row.get("definition") or "").strip()
            # Store a tab-separated line so the frontend renderer can show columns
            sense_line = "\t".join([head, roman, pos, definition])
            layer.add_entry(head, roman, pos, senses=[sense_line])
    print(f"[WIKI] loaded {len(layer.entries)} headwords.")
    return len(layer.entries)


def load_user_dict(path: Path, layer: dictionary_types_service.DictionaryLayer) -> int:
    """
    Load the per-user custom dictionary TSV into a dictionary layer.
    Format is the same 4-column layout as the Wiktionary TSV:
    headword, romanization, pos, definition.
    """
    if not path.exists():
        print(f"[USERDICT] no user dictionary found at {path} (starting empty).")
        return 0
    print(f"[USERDICT] loading user dictionary TSV from {path} ...")
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            raw_head = (row.get("headword") or "").strip()
            if not raw_head:
                continue
            head = normalization_service.normalize_headword(raw_head)
            if not head or not normalization_service.contains_burmese(head):
                continue
            roman = (row.get("romanization") or "").strip()
            pos = pos_service.normalize_pos(row.get("pos") or "")
            definition = (row.get("definition") or "").strip()
            sense_line = "\t".join([head, roman, pos, definition])
            layer.add_entry(head, roman, pos, senses=[sense_line])
    print(f"[USERDICT] loaded {len(layer.entries)} headwords from user dictionary.")
    return len(layer.entries)


def load_user_text_overrides(path: Path) -> list[tuple[str, str]]:
    """
    Load user-provided text normalization overrides (raw -> normalized).
    TSV format: raw<TAB>normalized
    """
    overrides: list[tuple[str, str]] = []
    if not path.exists():
        print(f"[USEROVERRIDE] no overrides found at {path} (starting empty).")
        return overrides
    print(f"[USEROVERRIDE] loading overrides TSV from {path} ...")
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            raw = (row.get("raw") or "").strip()
            normalized = (row.get("normalized") or "").strip()
            if not raw or not normalized:
                continue
            if not normalization_service.contains_burmese(normalized):
                continue
            overrides.append((raw, normalized))
    print(f"[USEROVERRIDE] loaded {len(overrides)} overrides.")
    return overrides


def load_mmd_dict(path: Path, layer: dictionary_types_service.DictionaryLayer) -> int:
    """
    Load MMD_clean.tsv and handle embedded POS tags within definitions.
    Some TSV rows have multiple POSs in the definition field:
        headword\troman\tpron\t1 sense \n 2 sense \n part \n 1 sense \n 2 sense
    This parser detects standalone POS tags and groups senses correctly.
    """
    import re
    from collections import defaultdict

    temp_struct = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    raw_headwords = {}
    if not path.exists():
        print(f"[WARN] MMD TSV not found: {path}")
        return 0
    print(f"Loading MMD from {path} ...")
    # Common POS tags that might appear in definitions
    POS_TAGS = {
        "n",
        "v",
        "adj",
        "adv",
        "pron",
        "part",
        "particle",
        "conj",
        "prep",
        "postp",
        "ppm",
        "interj",
        "aux",
        "num",
        "det",
        "prefix",
        "suffix",
        "m",
        "nm",
    }
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        for row in reader:
            raw_head = (row.get("headword") or "").strip()
            if not raw_head:
                continue
            head = normalization_service.normalize_headword(raw_head)
            if not head or not normalization_service.contains_burmese(head):
                continue
            if head not in raw_headwords:
                raw_headwords[head] = raw_head
            roman = (row.get("romanization") or "").strip()
            initial_pos = (row.get("pos") or "").strip()
            definition_raw = (row.get("definition") or "").strip()
            if not definition_raw:
                continue
            # Split on both literal "\n" and real newlines
            def_for_split = definition_raw.replace("\\n", "\n")
            lines = [seg.strip() for seg in def_for_split.split("\n") if seg.strip()]
            if not lines:
                continue
            # Parse lines to detect embedded POS tags
            current_pos = initial_pos
            current_senses = []
            for line in lines:
                stripped = line.strip()
                # Is this a new POS tag? (standalone word that's a known POS)
                # Must not start with a digit (to avoid matching numbered senses)
                if stripped.lower() in POS_TAGS and not re.match(r"^\d", stripped):
                    # Save previous POS and its senses
                    if current_pos and current_senses:
                        temp_struct[head][roman][current_pos].extend(current_senses)
                    # Start new POS
                    current_pos = stripped
                    current_senses = []
                else:
                    # This is a sense line, add to current POS
                    current_senses.append(line)
            # Don't forget the last POS
            if current_pos and current_senses:
                temp_struct[head][roman][current_pos].extend(current_senses)
    # Convert to 4-column table format for frontend
    for head in temp_struct:
        sense_lines = []
        raw_head = raw_headwords.get(head, head)
        # FIXED: Don't use sorted() - preserve insertion order from TSV
        for roman in temp_struct[head].keys():
            first_pos_in_roman = True
            # FIXED: Don't use sorted() - preserve insertion order from TSV
            for pos in temp_struct[head][roman].keys():
                senses = temp_struct[head][roman][pos]
                # ADDED: Skip empty sense lists
                if not senses:
                    continue
                if first_pos_in_roman:
                    # headword\troman\tpos\tsense1
                    sense_lines.append(f"{raw_head}\t{roman}\t{pos}\t{senses[0]}")
                    first_pos_in_roman = False
                else:
                    # \t\tpos\tsense1 (new POS under same roman)
                    sense_lines.append(f"\t\t{pos}\t{senses[0]}")
                # \t\t\tsense (additional senses)
                for sense in senses[1:]:
                    if sense:  # ADDED: Skip empty senses
                        sense_lines.append(f"\t\t\t{sense}")
        # ADDED: Skip entries with no valid sense lines
        if not sense_lines:
            continue
        first_roman = next(iter(temp_struct[head].keys()))
        first_pos = next(iter(temp_struct[head][first_roman].keys()))
        layer.entries[head] = dictionary_types_service.DictionaryEntry(
            headword=head,
            romanization=first_roman,
            pos=first_pos,
            senses=sense_lines,
            source=layer.source_name or layer.name,
            priority=layer.priority,
        )
    print(f"[MMD] loaded {len(layer.entries)} headwords.")
    return len(layer.entries)


def load_pali_dict(path: Path, layer: dictionary_types_service.DictionaryLayer) -> int:
    """
    Load the 4-column PaliÃÂ¢Ã¢âÂ¬Ã¢â¬ÅMyanmarÃÂ¢Ã¢âÂ¬Ã¢â¬ÅEnglish TSV (peu.tsv):
        headword\tpronunciation\tpart_of_speech\tsenses
    and produce MMD-style hierarchical sense lines so the frontend
    renderSenseLines() can display them correctly.
    """
    from collections import defaultdict

    if not path.exists():
        print(f"[WARN] Pali TSV not found: {path}")
        return 0
    print(f"Loading Pali TSV from {path} ...")
    # temp_struct[head][roman][pos] -> list[sense_line]
    temp_struct: dict[str, dict[str, dict[str, list[str]]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(list))
    )
    raw_headwords: dict[str, str] = {}
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f, delimiter="\t")
        first_row = True
        for row in reader:
            if not row:
                continue
            # Skip header row if present
            if first_row:
                first_row = False
                if (row[0] or "").strip().lower() == "headword":
                    continue
            raw_head = (row[0] or "").strip()
            if not raw_head:
                continue
            head = normalization_service.normalize_headword(raw_head)
            if not head or not normalization_service.contains_burmese(head):
                continue
            roman = (row[1] if len(row) > 1 else "").strip()
            # NEW: if the Pali TSV doesn't give a romanization, fall back to
            # the backend's approximate pronunciation helper.
            if not roman and normalization_service.contains_burmese(head):
                roman = pronunciation_service._infer_pronunciation(head)
            pos = (row[2] if len(row) > 2 else "").strip()
            definition_raw = (row[3] if len(row) > 3 else "").strip()
            if not definition_raw:
                continue
            # Remember the "pretty" headword for display (with parentheses etc.)
            if head not in raw_headwords:
                raw_headwords[head] = raw_head
            # Split on both literal "\n" and real newlines
            def_for_split = definition_raw.replace("\\n", "\n")
            lines = [seg.strip() for seg in def_for_split.split("\n") if seg.strip()]
            if not lines:
                continue
            temp_struct[head][roman][pos].extend(lines)
    # Convert to 4-column hierarchical sense lines per headword
    for head in temp_struct:
        sense_lines: list[str] = []
        raw_head = raw_headwords.get(head, head)
        # Preserve insertion order of roman + pos
        for roman in temp_struct[head].keys():
            first_pos_for_roman = True
            for pos in temp_struct[head][roman].keys():
                senses = temp_struct[head][roman][pos]
                if not senses:
                    continue
                # First sense for this POS
                first_sense = senses[0]
                if first_pos_for_roman:
                    # headword\troman\tpos\tsense1
                    sense_lines.append(f"{raw_head}\t{roman}\t{pos}\t{first_sense}")
                    first_pos_for_roman = False
                else:
                    # \t\tpos\tsense1 (new POS under same roman)
                    sense_lines.append(f"\t\t{pos}\t{first_sense}")
                # Additional senses as \t\t\tsense
                for sense in senses[1:]:
                    sense = sense.strip()
                    if not sense:
                        continue
                    sense_lines.append(f"\t\t\t{sense}")
        if not sense_lines:
            continue
        # Pick a representative roman/pos for the entry (first seen)
        first_roman = next(iter(temp_struct[head].keys()))
        first_pos_map = temp_struct[head][first_roman]
        first_pos = next(iter(first_pos_map.keys()))
        layer.entries[head] = dictionary_types_service.DictionaryEntry(
            headword=head,
            romanization=first_roman,
            pos=first_pos,
            senses=sense_lines,
            source=layer.source_name or layer.name,
            priority=layer.priority,
        )
    print(f"[PALI] loaded {len(layer.entries)} headwords.")
    return len(layer.entries)
