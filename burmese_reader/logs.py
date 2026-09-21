"""Burmese reader: logs."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from . import settings as settings_service


def _write_jsonl(path: Path, rec: dict):
    """Append one JSON record as a single line to a JSONL file."""
    try:
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception as e:
        print(f"Log error for {path.name}:", e)


def log_lookup(q: str, segments: list, results: list):
    """
    Append one JSON line to lookup_log.jsonl with:
    - time
    - q (raw query)
    - segments (list of segments from segmenter)
    - results (list of dictionary entries actually returned)
    """
    rec = {
        "time": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "q": q,
        "segments": segments,
        "results": results,
    }
    _write_jsonl(settings_service.LOG_PATH, rec)


def log_miss(q: str, segments: list):
    """
    Append one JSON line to lookup_miss_log.jsonl for lookups
    that produced no dictionary results (or only unknowns).
    """
    rec = {
        "time": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "q": q,
        "segments": segments,
    }
    _write_jsonl(settings_service.MISS_LOG_PATH, rec)


def log_unknown_segment(q: str, segment: str, kind: str):
    """
    Log segments that are not in the dictionary.
    kind is just a tag, e.g. "primary".
    """
    rec = {
        "time": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "q": q,
        "segment": segment,
        "kind": kind,
    }
    _write_jsonl(settings_service.UNKNOWN_SEG_LOG_PATH, rec)
