"""Burmese reader: annotations."""

from __future__ import annotations

import json

from . import normalization as normalization_service, settings as settings_service
from .runtime import feature_state


def _annotation_key(head: str) -> str:
    """Normalize a headword for use as an annotation key."""
    return normalization_service.normalize_headword(head or "")


def load_annotations() -> None:
    """Load annotations from disk into memory."""
    state.ANNOTATIONS = {}
    try:
        if settings_service.ANNOTATIONS_PATH.exists():
            with settings_service.ANNOTATIONS_PATH.open("r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                tmp: dict[str, str] = {}
                for k, v in data.items():
                    key = _annotation_key(str(k))
                    if key:
                        tmp[key] = str(v)
                state.ANNOTATIONS = tmp
            else:
                state.ANNOTATIONS = {}
        else:
            state.ANNOTATIONS = {}
    except Exception as e:
        print("[WARN] Could not load annotations:", e)
        state.ANNOTATIONS = {}


def get_annotation(head: str) -> str:
    """Return current note (or '') for a headword."""
    if not head:
        return ""
    if not state.ANNOTATIONS and settings_service.ANNOTATIONS_PATH.exists():
        load_annotations()
    key = _annotation_key(head)
    if not key:
        return ""
    return state.ANNOTATIONS.get(key, "")


def set_annotation(head: str, note: str) -> None:
    """Set or clear an annotation, and write to disk."""
    if not head:
        return
    if not state.ANNOTATIONS and settings_service.ANNOTATIONS_PATH.exists():
        load_annotations()
    key = _annotation_key(head)
    if not key:
        return
    note = (note or "").rstrip("\n")
    if not note.strip():
        if key in state.ANNOTATIONS:
            state.ANNOTATIONS.pop(key, None)
    else:
        state.ANNOTATIONS[key] = note
    try:
        with settings_service.ANNOTATIONS_PATH.open("w", encoding="utf-8") as f:
            json.dump(state.ANNOTATIONS, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print("[WARN] Failed to write annotations file:", e)


def _new_state():
    from types import SimpleNamespace

    return SimpleNamespace(
        ANNOTATIONS={},
    )


state = feature_state("annotations", _new_state)
