"""Burmese reader: ner."""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any

from . import normalization as normalization_service, settings as settings_service
from .runtime import feature_state, get_runtime

STANDALONE_NER_MODEL_PATH = Path(
    os.environ.get(
        "STANDALONE_NER_MODEL_PATH",
        str(settings_service.APP_ROOT / "standalonener" / "model-best"),
    )
)


STANZA_RESOURCES_DIR = os.environ.get(
    "STANZA_RESOURCES_DIR",
    os.environ.get(
        "STANZA_RESOURCES",
        str((settings_service.APP_ROOT / "stanza_resources").resolve()),
    ),
)


def init_standalone_ner():
    """Standalone NER disabled."""
    return None


def init_stanza_ner():
    """Lazy-load stanza NER pipeline (raw-text)."""
    if state.STANZA_NER is not None:
        return state.STANZA_NER
    if state.STANZA_NER_ERROR:
        return None
    if not get_runtime().allow_model_loading:
        return None
    try:
        import stanza  # type: ignore

        state.STANZA_NER = stanza.Pipeline(
            lang="my",
            processors="tokenize,ner",
            dir=STANZA_RESOURCES_DIR,
            tokenize_no_ssplit=True,
            verbose=False,
        )
        print(f"[INFO] Stanza NER loaded from {STANZA_RESOURCES_DIR}")
        return state.STANZA_NER
    except Exception as e:
        state.STANZA_NER_ERROR = f"{type(e).__name__}: {e}"
        print(f"[WARN] stanza NER disabled: {state.STANZA_NER_ERROR}")
        return None


def init_stanza_tokenizer():
    """Stanza tokenizer-only pipeline disabled."""
    return None


def _build_segment_char_spans(
    text: str, segments: list[str]
) -> list[tuple[int, int] | None]:
    """Map segments to character spans in the raw text."""
    spans: list[tuple[int, int] | None] = []
    if not text:
        return [None] * len(segments)
    idx = 0
    for seg in segments:
        if not seg:
            spans.append(None)
            continue
        pos = text.find(seg, idx)
        if pos < 0:
            spans.append(None)
            continue
        start = pos
        end = pos + len(seg)
        spans.append((start, end))
        idx = end
    return spans


def _stanza_ents_to_segments(
    text: str, segments: list[str], ents: list[Any]
) -> list[dict]:
    """Convert stanza char-offset ents to segment-index spans."""
    if not ents:
        return []
    seg_spans = _build_segment_char_spans(text, segments)
    out: list[dict] = []
    for ent in ents:
        start_char = getattr(ent, "start_char", None)
        end_char = getattr(ent, "end_char", None)
        if start_char is None or end_char is None:
            continue
        seg_start = None
        seg_end = None
        for i, span in enumerate(seg_spans):
            if not span:
                continue
            s, e = span
            if e <= start_char or s >= end_char:
                continue
            if seg_start is None:
                seg_start = i
            seg_end = i
        if seg_start is None:
            continue
        label = getattr(ent, "type", "") or getattr(ent, "label", "") or ""
        out.append(
            {
                "start": seg_start,
                "end": seg_end + 1,
                "label": label,
                "text": getattr(ent, "text", "") or "",
            }
        )
    return out


def _is_myanmar_word_char(ch: str) -> bool:
    cp = ord(ch)
    if normalization_service._is_myanmar_core(
        cp
    ) or normalization_service._is_myanmar_extended(cp):
        return ch not in normalization_service.MYANMAR_PUNCT
    return False


def _is_myanmar_word_token(token: str) -> bool:
    if not token or token in normalization_service.MYANMAR_PUNCT:
        return False
    for ch in token:
        if not _is_myanmar_word_char(ch):
            return False
    return True


def _split_myanmar_runs(text: str, start: int, end: int) -> list[tuple[str, int, int]]:
    out: list[tuple[str, int, int]] = []
    if not text or start >= end:
        return out
    start = max(start, 0)
    end = min(end, len(text))
    run_start: int | None = None
    for i in range(start, end):
        if _is_myanmar_word_char(text[i]):
            if run_start is None:
                run_start = i
        else:
            if run_start is not None and i > run_start:
                out.append((text[run_start:i], run_start, i))
            run_start = None
    if run_start is not None and end > run_start:
        out.append((text[run_start:end], run_start, end))
    return out


def _collect_myanmar_punct_tokens(text: str) -> list[tuple[str, int, int]]:
    """Return Myanmar punctuation tokens with spans (kept for UD sentence boundaries)."""
    return [
        (ch, i, i + 1)
        for i, ch in enumerate(text or "")
        if ch in normalization_service.MYANMAR_PUNCT
    ]


def _segment_text_stanza_ner_with_spans(text: str) -> list[tuple[str, int, int]] | None:
    """Tokenize with stanza NER pipeline and cache the doc for reuse."""
    text = text or ""
    if not text:
        return []
    nlp = init_stanza_ner()
    if nlp is None:
        return None
    try:
        doc = nlp(text)
        with state._STANZA_NER_DOC_CACHE_LOCK:
            state._STANZA_NER_DOC_CACHE[text] = doc
    except Exception as e:
        print(f"[WARN] stanza NER tokenization failed: {e}")
        return None
    out: list[tuple[str, int, int]] = []
    for sent in getattr(doc, "sentences", []) or []:
        for tok in getattr(sent, "tokens", []) or []:
            start = getattr(tok, "start_char", None)
            end = getattr(tok, "end_char", None)
            if start is None or end is None or start >= end:
                continue
            out.extend(_split_myanmar_runs(text, int(start), int(end)))
    if not out and any(_is_myanmar_word_char(ch) for ch in text):
        return None
    out.sort(key=lambda t: t[1])
    return out


def _sentence_spans_from_segments(segments: list[str]) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    if not segments:
        return spans
    start = 0
    for i, tok in enumerate(segments):
        if tok == "\u104b":  # Myanmar period
            spans.append((start, i + 1))
            start = i + 1
    if start < len(segments):
        spans.append((start, len(segments)))
    return spans


def _build_island_spans_from_segments(segments: list[str]) -> list[tuple[int, int]]:
    island_spans: list[tuple[int, int]] = []
    if not segments:
        return island_spans
    island_start: int | None = None
    for i, seg in enumerate(segments):
        if not seg or not _is_myanmar_word_token(seg):
            if island_start is not None:
                island_spans.append((island_start, i))
                island_start = None
            continue
        if island_start is None:
            island_start = i
    if island_start is not None:
        island_spans.append((island_start, len(segments)))
    return island_spans


def _build_island_spans_from_token_spans(
    segments: list[str],
    spans: list[tuple[int, int]],
) -> list[tuple[int, int]]:
    island_spans: list[tuple[int, int]] = []
    if not segments:
        return island_spans
    island_start: int | None = None
    prev_end: int | None = None
    for i, (seg, span) in enumerate(zip(segments, spans)):
        if not span or not _is_myanmar_word_token(seg):
            if island_start is not None:
                island_spans.append((island_start, i))
                island_start = None
            prev_end = None
            continue
        s, e = span
        if island_start is None:
            island_start = i
        elif prev_end is not None and s != prev_end:
            island_spans.append((island_start, i))
            island_start = i
        prev_end = e
    if island_start is not None:
        island_spans.append((island_start, len(segments)))
    return island_spans


def _filter_ner_entities_excluding_last_islands(
    segments: list[str],
    island_spans: list[tuple[int, int]] | None,
    ner_entities: list[dict] | None,
) -> list[dict]:
    """Drop NER spans that touch the last island in a sentence."""
    if not ner_entities or not segments:
        return []
    islands = island_spans or _build_island_spans_from_segments(segments)
    if not islands:
        return [ent for ent in ner_entities if isinstance(ent, dict)]
    sentence_spans = _sentence_spans_from_segments(segments)
    if not sentence_spans:
        sentence_spans = [(0, len(segments))]

    last_islands: list[tuple[int, int, tuple[int, int] | None]] = []
    island_idx = 0
    for sent_start, sent_end in sentence_spans:
        last: tuple[int, int] | None = None
        while island_idx < len(islands) and islands[island_idx][1] <= sent_start:
            island_idx += 1
        j = island_idx
        while j < len(islands):
            i_start, i_end = islands[j]
            if i_start >= sent_end:
                break
            last = (i_start, i_end)
            j += 1
        last_islands.append((sent_start, sent_end, last))
        island_idx = j

    def _last_island_for_start(idx: int) -> tuple[int, int] | None:
        for sent_start, sent_end, last in last_islands:
            if idx >= sent_start and idx < sent_end:
                return last
        return None

    filtered: list[dict] = []
    for ent in ner_entities:
        if not isinstance(ent, dict):
            continue
        start_idx = ent.get("start")
        end_idx = ent.get("end")
        if (
            not isinstance(start_idx, int)
            or not isinstance(end_idx, int)
            or end_idx <= start_idx
        ):
            filtered.append(ent)
            continue
        last_island = _last_island_for_start(start_idx)
        if last_island is None:
            filtered.append(ent)
            continue
        island_start, island_end = last_island
        if start_idx < island_end and end_idx > island_start:
            continue
        filtered.append(ent)
    return filtered


def _run_stanza_ner_early(
    text: str,
    segments: list[str],
    fills_by_seg: list[dict | None],
    island_spans: list[tuple[int, int]] | None = None,
) -> tuple[list, list[dict]]:
    """
    Run stanza NER on original text early in the pipeline.

    Returns:
        Tuple of (raw_stanza_entities, segment_mapped_entities).
        Raw entities are needed for re-mapping after dict fill splitting.
        Also modifies fills_by_seg in-place to mark ner_protected/ner_label.

    If the NER doc was already cached by _segment_text_stanza_ner_with_spans,
    reuses that doc instead of running NER again (avoiding redundant tokenization).
    """
    # Check cache first - reuse doc from tokenization phase if available
    doc = None
    with state._STANZA_NER_DOC_CACHE_LOCK:
        doc = state._STANZA_NER_DOC_CACHE.pop(text, None)

    # If no cache hit, run NER now
    if doc is None:
        ner_nlp = init_stanza_ner()
        if ner_nlp is None:
            return [], []
        try:
            doc = ner_nlp(text)
        except Exception as e:
            print(f"[WARN] Stanza NER early processing failed: {e}")
            return [], []

    try:
        ents = getattr(doc, "ents", []) or []
        if not ents:
            return [], []

        # Convert entity char spans to segment indices
        ent_segments = _stanza_ents_to_segments(text, segments, ents)
        if ent_segments:
            ent_segments = _filter_ner_entities_excluding_last_islands(
                segments, island_spans, ent_segments
            )

        # Mark fills for segments in NER entities
        for ent_info in ent_segments:
            start_idx = ent_info.get("start")
            end_idx = ent_info.get("end")
            label = ent_info.get("label", "")

            if start_idx is None or end_idx is None:
                continue

            # Mark all segments in this entity span
            for seg_idx in range(start_idx, end_idx):
                if seg_idx >= len(fills_by_seg):
                    continue
                if fills_by_seg[seg_idx] is None:
                    fills_by_seg[seg_idx] = {}
                fills_by_seg[seg_idx]["ner_protected"] = True
                fills_by_seg[seg_idx]["ner_label"] = label

        # Return both raw entities and initially mapped entities
        return ents, ent_segments
    except Exception as e:
        print(f"[WARN] Stanza NER early processing failed: {e}")
        return [], []


def _apply_ner_entities_to_fills(
    fills_by_seg: list[dict | None],
    ner_entities: list[dict] | None,
) -> None:
    """Apply NER spans to fills_by_seg, clearing any stale NER flags first."""
    if not fills_by_seg:
        return
    for fill in fills_by_seg:
        if fill:
            fill.pop("ner_protected", None)
            fill.pop("ner_label", None)
    if not ner_entities:
        return
    for ent in ner_entities:
        start_idx = ent.get("start")
        end_idx = ent.get("end")
        label = ent.get("label", "") or ""
        if not isinstance(start_idx, int) or not isinstance(end_idx, int):
            continue
        if end_idx <= start_idx:
            continue
        for seg_idx in range(start_idx, min(end_idx, len(fills_by_seg))):
            if fills_by_seg[seg_idx] is None:
                fills_by_seg[seg_idx] = {}
            fills_by_seg[seg_idx]["ner_protected"] = True
            if label:
                fills_by_seg[seg_idx]["ner_label"] = label


def _new_state():
    from types import SimpleNamespace

    return SimpleNamespace(
        STANDALONE_NER=None,
        STANDALONE_NER_ERROR="",
        STANZA_NER=None,
        STANZA_NER_ERROR="",
        STANZA_TOKENIZER=None,
        STANZA_TOKENIZER_ERROR="",
        _STANZA_NER_DOC_CACHE={},
        _STANZA_NER_DOC_CACHE_LOCK=threading.Lock(),
    )


state = feature_state("ner", _new_state)
