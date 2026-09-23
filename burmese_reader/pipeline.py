"""Burmese reader: pipeline."""

from __future__ import annotations

from typing import Any

from . import fill as fill_service, lexicon as lexicon_service, ner as ner_service


def segment_with_pipeline(q: str) -> list[str]:
    """
    Return canonical DP-resegmented tokens using the fixed pipeline:
    stanza NER tokenizer -> DP resegmentation -> unknown merge.
    """
    if not q:
        return []
    initial_segments, island_spans = segment_with_pipeline_and_islands(q)
    if not initial_segments:
        return []
    segments, fills_by_seg, island_spans, _ = _dp_resegment_with_ner_protection(
        q, initial_segments, [], island_spans
    )
    segments, _ = _merge_consecutive_unknown_segments(
        segments, fills_by_seg, island_spans
    )
    return segments


def segment_with_pipeline_and_islands(
    q: str,
) -> tuple[list[str], list[tuple[int, int]]]:
    """
    Initial tokenization for the fixed pipeline: stanza NER tokenizer with spans.
    Returns stanza tokens plus island spans for DP resegmentation.
    """
    if not q:
        return [], []

    full = ner_service._segment_text_stanza_ner_with_spans(q)
    if full is None:
        # Fallback: DP segmentation over the whole text if stanza is unavailable.
        segs, _fills, island_spans = _dp_segment_text_only(q)
        return segs, island_spans

    tokens_with_spans = list(full) + ner_service._collect_myanmar_punct_tokens(q)
    if not tokens_with_spans:
        return [], []
    tokens_with_spans.sort(key=lambda t: t[1])
    segments = [tok for tok, _, _ in tokens_with_spans]
    spans = [(start, end) for _, start, end in tokens_with_spans]
    island_spans = ner_service._build_island_spans_from_token_spans(segments, spans)
    return segments, island_spans


def _dp_resegment_with_ner_protection(
    text: str,
    stanza_tokens: list[str],
    ner_entities: list[Any],
    island_spans: list[tuple[int, int]],
) -> tuple[list[str], list[dict | None], list[tuple[int, int]], list[str]]:
    """
    Full DP resegmentation over each island.

    - DP resegments everything, including inside NER spans
    - NER spans are applied after resegmentation in the caller
    - Original stanza tokens returned for fuzzy matching boundaries
    """
    if not stanza_tokens:
        return [], [], [], []

    seg_inst = lexicon_service.get_segmenter_instance()

    new_segments: list[str] = []
    new_fills: list[dict | None] = []
    new_island_spans: list[tuple[int, int]] = []
    idx = 0
    for island_start, island_end in island_spans:
        if idx < island_start:
            for tok in stanza_tokens[idx:island_start]:
                new_segments.append(tok)
                new_fills.append(None)
            idx = island_start
        island_new_start = len(new_segments)

        island_tokens = stanza_tokens[island_start:island_end]
        island_text = "".join(island_tokens)
        # Run DP across the whole island (NER is applied after resegmentation).
        dp_segments = seg_inst.segment(island_text)
        pos = 0
        for seg in dp_segments:
            seg_start = pos
            seg_end = pos + len(seg)
            pos = seg_end
            _ = seg_start, seg_end
            fill = fill_service._fill_token_with_dict_for_ui(seg)
            fill["mode"] = "dp_resegment"
            new_segments.append(seg)
            new_fills.append(fill)

        island_new_end = len(new_segments)
        if island_new_end > island_new_start:
            new_island_spans.append((island_new_start, island_new_end))
        idx = island_end

    if idx < len(stanza_tokens):
        for tok in stanza_tokens[idx:]:
            new_segments.append(tok)
            new_fills.append(None)

    return new_segments, new_fills, new_island_spans, list(stanza_tokens)


def _dp_segment_text_only(
    text: str,
) -> tuple[list[str], list[dict | None], list[tuple[int, int]]]:
    """
    Pure DP segmentation on raw text, without any neural/stanza pre-pass or NLP overlays.
    Returns (segments, fills_by_seg, island_spans).
    """
    if not text:
        return [], [], []
    seg_inst = lexicon_service.get_segmenter_instance()
    dp_segments = seg_inst.segment(text)
    fills_by_seg: list[dict | None] = []
    for seg in dp_segments:
        fill = fill_service._fill_token_with_dict_for_ui(seg)
        fill["mode"] = "dp_only"
        fills_by_seg.append(fill)
    island_spans = ner_service._build_island_spans_from_segments(dp_segments)
    return dp_segments, fills_by_seg, island_spans


def _merge_consecutive_unknown_segments(
    segments: list[str],
    fills_by_seg: list[dict | None],
    island_spans: list[tuple[int, int]] | None = None,
) -> tuple[list[str], list[dict | None]]:
    """
    Merge consecutive unknown-only segments into a single token.
    Unknown-only means: has_known == False and has_unknown == True.
    """
    if not segments:
        return [], []
    out_segments: list[str] = []
    out_fills: list[dict | None] = []

    if not island_spans:
        # No islands provided: preserve input as-is.
        return list(segments), list(fills_by_seg)

    cur = 0
    for s, e in island_spans:
        # Copy any non-island prefix unchanged.
        while cur < s and cur < len(segments):
            out_segments.append(segments[cur])
            out_fills.append(fills_by_seg[cur] if cur < len(fills_by_seg) else None)
            cur += 1

        i = s
        while i < e and i < len(segments):
            seg = segments[i]
            fill = fills_by_seg[i] if i < len(fills_by_seg) else None
            has_known = bool((fill or {}).get("has_known"))
            has_unknown = bool((fill or {}).get("has_unknown"))
            is_unknown_only = (not has_known) and has_unknown

            if not is_unknown_only:
                out_segments.append(seg)
                out_fills.append(fill)
                i += 1
                continue

            merged = [seg]
            j = i + 1
            while j < e and j < len(segments):
                f2 = fills_by_seg[j] if j < len(fills_by_seg) else None
                hk2 = bool((f2 or {}).get("has_known"))
                hu2 = bool((f2 or {}).get("has_unknown"))
                if hk2 or not hu2:
                    break
                merged.append(segments[j])
                j += 1

            merged_text = "".join(merged)
            merged_fill = fill_service._fill_token_with_dict_for_ui(merged_text)
            merged_fill["mode"] = "unknown_merge"
            out_segments.append(merged_text)
            out_fills.append(merged_fill)
            i = j

        cur = e

    # Copy any trailing suffix unchanged.
    while cur < len(segments):
        out_segments.append(segments[cur])
        out_fills.append(fills_by_seg[cur] if cur < len(fills_by_seg) else None)
        cur += 1

    return out_segments, out_fills


def _build_segment_offsets(
    text: str, segments: list[str]
) -> list[tuple[int, int]] | None:
    if not segments:
        return []
    if not text:
        return None
    offsets: list[tuple[int, int]] = []
    idx = 0
    for seg in segments:
        if not seg:
            return None
        pos = text.find(seg, idx)
        if pos < 0:
            return None
        end = pos + len(seg)
        offsets.append((pos, end))
        idx = end
    return offsets
