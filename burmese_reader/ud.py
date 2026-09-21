"""Burmese reader: ud."""

from __future__ import annotations

from ud_overlay import UDParser, overlay_to_json

from . import (
    ner as ner_service,
    normalization as normalization_service,
    settings as settings_service,
)
from .runtime import feature_state, get_runtime

UD_MODEL_PATH = settings_service.DATA_ROOT / "model-best"


def init_ud_parser():
    """Initialize the UD spaCy parser (lazy load on first use)."""
    if state.UD_PARSER is not None:
        return state.UD_PARSER
    if not get_runtime().allow_model_loading:
        return None
    try:
        state.UD_PARSER = UDParser(str(UD_MODEL_PATH))
        print(f"[INFO] UD parser loaded from {UD_MODEL_PATH}")
        return state.UD_PARSER
    except Exception as e:
        print(f"[WARN] UD parser disabled: {e}")
        state.UD_PARSER = None
        return None


def build_ud_overlay_for_segments(
    segments: list[str],
    dict_fills: list[dict | None] | None = None,
    original_text: str | None = None,
    pos_override: bool = True,
    stanza_ner: bool = False,
    precomputed_ner_ents: list[dict] | None = None,
    collapse_ner_spans: bool = False,
    island_spans: list[tuple[int, int]] | None = None,
) -> dict:
    """
    Build UD dependency overlay for a list of segments.

    Args:
        segments: Token segments
        dict_fills: Dictionary fill data per segment
        original_text: Original raw text (for NER if needed)
        pos_override: Enable dictionary POS override
        stanza_ner: Enable stanza NER (only used if precomputed_ner_ents is None)
        precomputed_ner_ents: Pre-computed NER entities from early pipeline stage
        collapse_ner_spans: If True, collapse NER spans into single tokens for parsing
        island_spans: Optional island spans for filtering NER spans
    """
    parser = init_ud_parser()
    if parser is None:
        return {
            "ok": False,
            "tokens": [],
            "edges": [],
            "roots": [],
            "doc2seg": [],
            "seg2doc": [-1] * len(segments),
            "error": "ud_disabled",
        }
    try:
        # For analysis only: drop stray combining-mark tokens, but keep the original
        # `segments` for UI alignment/mapping.
        if precomputed_ner_ents is not None:
            precomputed_ner_ents = (
                ner_service._filter_ner_entities_excluding_last_islands(
                    segments, island_spans, precomputed_ner_ents
                )
            )
        overlay = parser.build_overlay(
            segments,
            keep_fn=normalization_service._spacy_keep_fn,
            dict_fills=dict_fills,
            original_text=original_text,
            pos_override=pos_override,
            precomputed_ner_ents=precomputed_ner_ents,
            collapse_ner_spans=collapse_ner_spans,
        )
        overlay_json = overlay_to_json(overlay)
        if overlay_json.get("ok"):
            # Use precomputed NER entities if provided (avoids redundant NER call)
            if precomputed_ner_ents is not None:
                overlay_json["ents"] = precomputed_ner_ents
            else:
                # Fall back to running NER here if not precomputed
                stanza_ran = False
                if stanza_ner:
                    text_for_ner = original_text or ""
                    if text_for_ner:
                        ner_nlp = ner_service.init_stanza_ner()
                        if ner_nlp is not None:
                            try:
                                doc = ner_nlp(text_for_ner)
                                ents = getattr(doc, "ents", []) or []
                                overlay_json["ents"] = (
                                    ner_service._stanza_ents_to_segments(
                                        text_for_ner, segments, ents
                                    )
                                )
                                stanza_ran = True
                            except Exception as e:
                                print(f"[WARN] stanza NER failed: {e}")
                    else:
                        overlay_json["ents"] = []
                        stanza_ran = True

                # If stanza wasn't used, fall back to standalone spaCy NER.
                if not stanza_ran and not parser.nlp.has_pipe("ner"):
                    ner_nlp = ner_service.init_standalone_ner()
                    if ner_nlp is not None:
                        from spacy.tokens import Doc  # type: ignore

                        spaces = (
                            [True] * (len(segments) - 1) + [False] if segments else []
                        )
                        doc = Doc(ner_nlp.vocab, words=segments, spaces=spaces)
                        doc = ner_nlp(doc)
                        ents_out = []
                        for ent in getattr(doc, "ents", []):
                            if ent is None:
                                continue
                            ents_out.append(
                                {
                                    "start": int(ent.start),
                                    "end": int(ent.end),
                                    "label": ent.label_ or "",
                                    "text": ent.text or "",
                                }
                            )
                        overlay_json["ents"] = ents_out
            if overlay_json.get("ents") is not None:
                overlay_json["ents"] = (
                    ner_service._filter_ner_entities_excluding_last_islands(
                        segments, island_spans, overlay_json["ents"]
                    )
                )
        return overlay_json
    except Exception as e:
        return {
            "ok": False,
            "tokens": [],
            "edges": [],
            "roots": [],
            "doc2seg": [],
            "seg2doc": [-1] * len(segments),
            "error": str(e),
        }


def _new_state():
    from types import SimpleNamespace

    return SimpleNamespace(
        UD_PARSER=None,
    )


state = feature_state("ud", _new_state)
