"""Burmese reader: custom entries."""

from __future__ import annotations

import csv
from pathlib import Path

from . import (
    dictionary_loaders as dictionary_loaders_service,
    lexicon as lexicon_service,
    normalization as normalization_service,
    pos as pos_service,
    settings as settings_service,
)


def add_user_dict_entry(raw_headword, romanization, pos_raw, definition):
    """
    Append a single entry to the per-user TSV on disk and update the
    segmenter's user layer so the change is visible immediately.
    Returns the normalized headword key.
    """
    raw_headword = (raw_headword or "").strip()
    definition = (definition or "").strip()
    if not raw_headword:
        raise ValueError("Headword is required.")
    head = normalization_service.normalize_headword(raw_headword)
    if not head or not normalization_service.contains_burmese(head):
        raise ValueError("Headword must contain Burmese script.")
    roman = (romanization or "").strip()
    pos = pos_service.normalize_pos(pos_raw or "")
    # Ensure TSV exists and append new row
    file_exists = settings_service.TSV_USER_PATH.exists()
    mode = "a" if file_exists else "w"
    with settings_service.TSV_USER_PATH.open(mode, encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        if not file_exists:
            writer.writerow(["headword", "romanization", "pos", "definition"])
        writer.writerow([head, roman, pos, definition])
    # Update the new segmenter dictionary directly
    try:
        seg = lexicon_service.get_segmenter_instance()
        layer = seg.dictionary.get_layer("user") or seg.dictionary.add_layer(
            "user",
            priority=lexicon_service.DICT_PRIORITIES.get("user", 10),
            source_name="USER",
        )
        sense_line = "\t".join([head, roman, pos, definition])
        layer.add_entry(head, roman, pos, senses=[sense_line])
        seg.dictionary.rebuild_cache()
    except Exception as e:
        print("[WARN] Failed to update segmenter user dictionary:", e)
    return head


def add_user_text_override(raw: str, normalized: str) -> tuple[str, str]:
    """
    Append a single text override (raw -> normalized) to TSV and update in-memory overrides.
    Returns the normalized pair.
    """
    raw = (raw or "").strip()
    normalized = (normalized or "").strip()
    if not raw or not normalized:
        raise ValueError("Raw and normalized forms are required.")
    if not normalization_service.contains_burmese(normalized):
        raise ValueError("Normalized form must contain Burmese script.")

    file_exists = normalization_service.TSV_USER_TEXT_OVERRIDE_PATH.exists()
    mode = "a" if file_exists else "w"
    with normalization_service.TSV_USER_TEXT_OVERRIDE_PATH.open(
        mode, encoding="utf-8", newline=""
    ) as f:
        writer = csv.writer(f, delimiter="\t")
        if not file_exists:
            writer.writerow(["raw", "normalized"])
        writer.writerow([raw, normalized])

    # Update in-memory overrides (replace any existing raw match).
    normalization_service.state.USER_TEXT_OVERRIDES = [
        (r, n) for (r, n) in normalization_service.state.USER_TEXT_OVERRIDES if r != raw
    ]
    normalization_service.state.USER_TEXT_OVERRIDES.append((raw, normalized))
    normalization_service.state.MANUAL_TEXT_OVERRIDES = list(
        normalization_service.state.USER_TEXT_OVERRIDES
    )
    return raw, normalized


def _read_user_dict_rows(path: Path) -> list[dict]:
    rows: list[dict] = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        row_id = 0
        for row in reader:
            head = (row.get("headword") or "").strip()
            roman = (row.get("romanization") or "").strip()
            pos = (row.get("pos") or "").strip()
            definition = (row.get("definition") or "").strip()
            if not head and not roman and not pos and not definition:
                continue
            rows.append(
                {
                    "id": row_id,
                    "headword": head,
                    "romanization": roman,
                    "pos": pos,
                    "definition": definition,
                }
            )
            row_id += 1
    return rows


def _write_user_dict_rows(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        writer.writerow(["headword", "romanization", "pos", "definition"])
        for row in rows:
            writer.writerow(
                [
                    row.get("headword", ""),
                    row.get("romanization", ""),
                    row.get("pos", ""),
                    row.get("definition", ""),
                ]
            )


def _rebuild_user_dict_from_rows(rows: list[dict]) -> None:
    try:
        seg = lexicon_service.get_segmenter_instance()
        layer = seg.dictionary.get_layer("user") or seg.dictionary.add_layer(
            "user",
            priority=lexicon_service.DICT_PRIORITIES.get("user", 10),
            source_name="USER",
        )
        layer.entries.clear()
        for row in rows:
            head = (row.get("headword") or "").strip()
            if not head:
                continue
            head_norm = normalization_service.normalize_headword(head)
            if not head_norm:
                continue
            roman = (row.get("romanization") or "").strip()
            pos = (row.get("pos") or "").strip()
            definition = (row.get("definition") or "").strip()
            sense_line = "\t".join([head_norm, roman, pos, definition])
            layer.add_entry(head_norm, roman, pos, senses=[sense_line])
        seg.dictionary.rebuild_cache()
    except Exception as e:
        print("[WARN] Failed to rebuild user dictionary layer:", e)


def _read_text_override_rows(path: Path) -> list[dict]:
    rows: list[dict] = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        row_id = 0
        for row in reader:
            raw = (row.get("raw") or "").strip()
            normalized = (row.get("normalized") or "").strip()
            if not raw and not normalized:
                continue
            rows.append(
                {
                    "id": row_id,
                    "raw": raw,
                    "normalized": normalized,
                }
            )
            row_id += 1
    return rows


def _write_text_override_rows(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        writer.writerow(["raw", "normalized"])
        for row in rows:
            writer.writerow([row.get("raw", ""), row.get("normalized", "")])


def _reload_text_overrides_from_file() -> None:
    normalization_service.state.USER_TEXT_OVERRIDES = (
        dictionary_loaders_service.load_user_text_overrides(
            normalization_service.TSV_USER_TEXT_OVERRIDE_PATH
        )
    )
    normalization_service.state.MANUAL_TEXT_OVERRIDES = list(
        normalization_service.state.USER_TEXT_OVERRIDES
    )
