"""Burmese reader: lookup."""

from __future__ import annotations

from flask import (
    Blueprint,
    jsonify,
    request,
)

from . import (
    fill as fill_service,
    grammar as grammar_service,
    lexicon as lexicon_service,
    ner as ner_service,
    normalization as normalization_service,
    pipeline as pipeline_service,
    pos as pos_service,
    pronunciation as pronunciation_service,
    ud as ud_service,
)

bp = Blueprint("lookup", __name__)


def merge_token_overlays(
    idx: int,
    base: dict,
    coarse_pos_overlay: dict,
    spacy_pos_overlay: dict,
) -> dict:
    out = dict(base)

    if idx in coarse_pos_overlay:
        out.update(coarse_pos_overlay[idx])

    if idx in spacy_pos_overlay:
        out.update(spacy_pos_overlay[idx])

    return out


@bp.route("/lookup")
def lookup():
    raw_q = request.args.get("q", "")
    raw_q = raw_q.strip()
    # Production guard: reject excessively long inputs before running the heavy NLP pipeline
    if len(raw_q) > 8000:
        return jsonify({"ok": False, "error": "Input too long (max 8000 chars)."}), 400
    lite_param = str(request.args.get("lite") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    # ==========================================================================
    # HARDCODED SEGMENTATION PIPELINE (as of 2025-01)
    # ==========================================================================
    # The tokenization pipeline is now fixed to a single path:
    #   1. Stanza NER tokenizer (stanza_ner_param=True)
    #      - Uses Stanza's NER model for initial tokenization
    #      - Caches the Stanza doc for later NER entity extraction
    #   2. DP resegmentation (dp_resegment_param=True)
    #      - Re-segments each island using dynamic programming
    #      - Protects NER entity boundaries during resegmentation
    #   3. Collapse NER spans for UD parse (collapse_ner_param=True)
    #      - Multi-token NER entities are collapsed into single parse tokens
    #   4. Dictionary POS override (pos_override_param=True)
    #      - Dictionary-defined POS tags override morphologizer output
    #
    # These were previously configurable via UI toggles. Legacy code paths
    # for other configurations are commented out below but preserved for
    # reference. See the "LEGACY" comments in this function.
    # ==========================================================================
    pos_override_param = True
    stanza_ner_param = True
    collapse_ner_param = True
    dp_resegment_param = True
    use_raw = str(request.args.get("raw") or "").lower() in {"1", "true", "yes", "raw"}
    exact_only = str(request.args.get("exact") or "").lower() in {
        "1",
        "true",
        "yes",
        "exact",
    }
    extended_hits = set()
    # DISABLED FOR DEPLOYMENT: do not allow remote LM weight tuning
    # _apply_lm_weight_overrides(request.args)
    if use_raw:
        q = raw_q
        if not q:
            return jsonify({"ok": False, "error": "empty"}), 400
        q_norm = normalization_service.normalize_headword(q)
        if exact_only:
            entry = None
            if q_norm and q_norm in lexicon_service.DICT:
                base = lexicon_service.DICT[q_norm]
                entry = {
                    "head": q,
                    "roman": base.get("roman", ""),
                    "pos": base.get("pos", ""),
                    "meta_pos": pos_service.get_meta_pos(base.get("pos", "")),
                    "senses": base.get("senses", []),
                    "source": base.get("source", "DICT"),
                    "g2p": pronunciation_service.g2p_explain_for_ui(q),
                    "dict_fill": [],
                    "dict_fill_has_known": True,
                    "dict_fill_has_unknown": False,
                    "dict_fill_mode": "exact",
                }
            return jsonify(
                {
                    "ok": True,
                    "display_text": q,
                    "q": q,
                    "segments": [q],
                    "segment_offsets": [(0, len(q))],
                    "results": [entry] if entry else [],
                    "results_by_seg": [entry] if entry else [],
                    "lm_overlay": {"tokens": [], "edges": [], "phrases": []},
                    "pos_overlay": {"tokens": []},
                    "pos_overlay_spacy": {},
                    "grammar_overlay": {"tokens": []},
                    "ud_overlay": {
                        "ok": False,
                        "tokens": [],
                        "edges": [],
                        "roots": [],
                        "doc2seg": [],
                        "seg2doc": [-1],
                        "error": "exact_only",
                    },
                }
            )
        segments = [q]
        island_spans = [(0, 1)]
    else:
        q = normalization_service.normalize_burmese_for_segmentation(
            raw_q, extended_hits=extended_hits
        )
        if not q:
            return jsonify({"ok": False, "error": "empty"}), 400
        q_norm = normalization_service.normalize_burmese(q)
        if extended_hits:
            # Just log for now so you can inspect which Extended chars appear
            print(
                "[INFO] Extended Myanmar chars in /lookup:",
                "".join(sorted(extended_hits)),
            )
        # 1) Initial stanza tokenization (fixed pipeline).
        segments, island_spans = pipeline_service.segment_with_pipeline_and_islands(q)
    # 1a) LM-informed cosmetic dictionary fill per-segment (context-aware inside islands).
    # Use precomputed fills from LM veto where available to avoid redundant computation.
    stanza_raw_ents = []
    stanza_ner_entities: list[dict] = []

    # DP RESEGMENTATION PIPELINE (dp_resegment_param is always True):
    # Step 1: Run NER on stanza tokens first (before any resegmentation)
    # stanza_ner_param is always True, so we always run NER early
    temp_fills: list[dict | None] = [None] * len(segments)
    stanza_raw_ents, stanza_ner_entities = ner_service._run_stanza_ner_early(
        q, segments, temp_fills, island_spans
    )

    # Step 2: Full DP resegmentation with NER protection
    segments, fills_by_seg, island_spans, original_stanza_tokens = (
        pipeline_service._dp_resegment_with_ner_protection(
            q, segments, stanza_raw_ents, island_spans
        )
    )
    # original_stanza_tokens preserved for fuzzy matching boundaries
    # Merge consecutive unknown-only tokens (postpass) within islands only
    segments, fills_by_seg = pipeline_service._merge_consecutive_unknown_segments(
        segments, fills_by_seg, island_spans
    )

    # Step 3: Re-map NER entities to new segments after resegmentation
    if stanza_raw_ents:
        stanza_ner_entities = ner_service._stanza_ents_to_segments(
            q, segments, stanza_raw_ents
        )
        stanza_ner_entities = ner_service._filter_ner_entities_excluding_last_islands(
            segments, island_spans, stanza_ner_entities
        )
        ner_service._apply_ner_entities_to_fills(fills_by_seg, stanza_ner_entities)

    segment_offsets = pipeline_service._build_segment_offsets(q, segments)
    if segment_offsets is None:
        segment_offsets = []
    # myPOS overlay is disabled; keep empty for merge_token_overlays() compatibility.
    pos_overlay = {}

    # 1d) Build grammar overlay (hand-built function word lexicon)
    grammar_overlay = (
        {"tokens": [], "links": []}
        if lite_param
        else grammar_service.build_grammar_overlay_for_segments(
            segments, lexicon_service.DICT
        )
    )
    # 1e) Build UD dependency overlay (spaCy-based parser)
    ud_overlay = (
        {
            "ok": False,
            "tokens": [],
            "edges": [],
            "roots": [],
            "doc2seg": [],
            "seg2doc": [],
            "error": "lite",
        }
        if lite_param
        else ud_service.build_ud_overlay_for_segments(
            segments,
            dict_fills=fills_by_seg,
            original_text=q,
            pos_override=pos_override_param,
            stanza_ner=stanza_ner_param,
            precomputed_ner_ents=stanza_ner_entities if stanza_ner_param else None,
            collapse_ner_spans=collapse_ner_param,
            island_spans=island_spans,
        )
    )
    # Build POS overlay from the UD overlay (single spaCy pass).
    spacy_pos_overlay = (
        {} if lite_param else pos_service.build_spacy_pos_overlay_from_ud(ud_overlay)
    )
    # 1f) Record dictionary-known tokens for spaced-repetition flashcards
    # DISABLED FOR DEPLOYMENT: SRS observe_tokens writes shared state without per-user isolation
    # if (not lite_param) and READING_SRS is not None:
    #     try:
    #         known_for_srs = []
    #         for w in segments:
    #             if contains_burmese(w) and w in DICT:
    #                 known_for_srs.append(w)
    #         if known_for_srs:
    #             READING_SRS.observe_tokens(known_for_srs, autosave=True)
    #     except Exception as e:
    #         print("[WARN] reading SRS observe_tokens failed:", e)
    results = []
    results_by_seg: list[dict | None] = [None] * len(segments)
    first_non_punct_entry = None

    # 1.5) Walk segments in order and build results_by_seg for all segments
    # but only return the first non-punctuation entry in results list
    for idx, w in enumerate(segments):
        # Don't try to dictionary-lookup Myanmar punctuation; keep it only for rendering/UD boundaries.
        if w in normalization_service.MYANMAR_PUNCT:
            continue
        # Cosmetic dictionary fill for UI (does not affect canonical segmentation)
        fill = fills_by_seg[idx] or fill_service._fill_token_with_dict_for_ui(w)
        fill_mode = fill.get("mode") or "greedy"
        fill_entries = fill.get("fills") or []
        fill_has_known = bool(fill.get("has_known"))
        fill_has_unknown = bool(fill.get("has_unknown"))

        w_key = normalization_service.normalize_headword(w)
        if w_key and w_key in lexicon_service.DICT:
            base = lexicon_service.DICT[w_key]
            pos = base.get("pos", "")
            entry = {
                "head": w,
                "roman": base.get("roman", ""),
                "pos": pos,
                "meta_pos": pos_service.get_meta_pos(pos),
                "senses": base.get("senses", []),
                "source": base.get("source", "DICT"),
                "g2p": pronunciation_service.g2p_explain_for_ui(w),
            }
        elif fill_has_known and not fill_has_unknown:
            # Token isn't a single dict head, but it can be fully covered by dict fills.
            entry = {
                "head": w,
                "roman": "",
                "pos": "composite",
                "meta_pos": "composite",
                "senses": [],
                "source": "COMPOSITE",
                "g2p": pronunciation_service.g2p_explain_for_ui(w),
            }
        else:
            # Base unknown entry (use your helper if you have one)
            try:
                entry = fill_service._make_unknown_entry(w)
            except NameError:
                entry = {
                    "head": w,
                    "roman": "",
                    "pos": "unknown",
                    "senses": ["[no dictionary entry found for this segment]"],
                }
            entry.setdefault("meta_pos", "unknown")
            entry.setdefault("source", "UNKNOWN")
            if normalization_service.contains_burmese(w):
                entry["g2p"] = pronunciation_service.g2p_explain_for_ui(w)

        entry["dict_fill_mode"] = fill_mode
        entry["dict_fill"] = fill_entries
        entry["dict_fill_has_known"] = fill_has_known
        entry["dict_fill_has_unknown"] = fill_has_unknown
        entry["seg_i"] = idx

        results_by_seg[idx] = merge_token_overlays(
            idx,
            entry,
            pos_overlay,
            spacy_pos_overlay,
        )

        # Only add the first non-punctuation entry to results for panel display
        if first_non_punct_entry is None:
            first_non_punct_entry = entry
            results.append(entry)
            # Logging disabled
    # 3) Logging disabled for performance (lookup/miss/unknowns)
    return jsonify(
        {
            "ok": True,
            "display_text": q,
            "q": q,
            "segments": segments,
            "segment_offsets": segment_offsets,
            "island_spans": island_spans,  # NEW: island boundaries for fuzzy matching
            "results": results,
            "results_by_seg": results_by_seg,
            "grammar_overlay": grammar_overlay,  # NEW: function-word overlay
            "ud_overlay": ud_overlay,  # UD dependency parse overlay
        }
    )


@bp.route("/lookup_dp_only")
def lookup_dp_only():
    """
    DP-only segmentation (no neural/stanza pre-pass, no NLP overlays).
    Intended for lightweight dictionary/side-panel segmentation.
    """
    raw_q = request.args.get("q", "")
    raw_q = raw_q.strip()
    if not raw_q:
        return jsonify({"ok": False, "error": "empty"}), 400
    q = normalization_service.normalize_burmese_for_segmentation(raw_q)
    if not q:
        return jsonify({"ok": False, "error": "empty"}), 400

    segments, fills_by_seg, island_spans = pipeline_service._dp_segment_text_only(q)
    segment_offsets = pipeline_service._build_segment_offsets(q, segments) or []
    results = []
    results_by_seg: list[dict | None] = [None] * len(segments)
    first_non_punct_entry = None

    for idx, w in enumerate(segments):
        if w in normalization_service.MYANMAR_PUNCT:
            continue
        fill = fills_by_seg[idx] or fill_service._fill_token_with_dict_for_ui(w)
        fill_mode = fill.get("mode") or "greedy"
        fill_entries = fill.get("fills") or []
        fill_has_known = bool(fill.get("has_known"))
        fill_has_unknown = bool(fill.get("has_unknown"))

        w_key = normalization_service.normalize_headword(w)
        if w_key and w_key in lexicon_service.DICT:
            base = lexicon_service.DICT[w_key]
            pos = base.get("pos", "")
            entry = {
                "head": w,
                "roman": base.get("roman", ""),
                "pos": pos,
                "meta_pos": pos_service.get_meta_pos(pos),
                "senses": base.get("senses", []),
                "source": base.get("source", "DICT"),
                "g2p": pronunciation_service.g2p_explain_for_ui(w),
            }
        elif fill_has_known and not fill_has_unknown:
            entry = {
                "head": w,
                "roman": "",
                "pos": "composite",
                "meta_pos": "composite",
                "senses": [],
                "source": "COMPOSITE",
                "g2p": pronunciation_service.g2p_explain_for_ui(w),
            }
        else:
            try:
                entry = fill_service._make_unknown_entry(w)
            except NameError:
                entry = {
                    "head": w,
                    "roman": "",
                    "pos": "unknown",
                    "senses": ["[no dictionary entry found for this segment]"],
                }
            entry.setdefault("meta_pos", "unknown")
            entry.setdefault("source", "UNKNOWN")
            if normalization_service.contains_burmese(w):
                entry["g2p"] = pronunciation_service.g2p_explain_for_ui(w)

        entry["dict_fill_mode"] = fill_mode
        entry["dict_fill"] = fill_entries
        entry["dict_fill_has_known"] = fill_has_known
        entry["dict_fill_has_unknown"] = fill_has_unknown
        entry["seg_i"] = idx

        results_by_seg[idx] = merge_token_overlays(idx, entry, {}, {})

        if first_non_punct_entry is None:
            first_non_punct_entry = entry
            results.append(entry)

    return jsonify(
        {
            "ok": True,
            "display_text": q,
            "q": q,
            "segments": segments,
            "segment_offsets": segment_offsets,
            "island_spans": island_spans,
            "results": results,
            "results_by_seg": results_by_seg,
        }
    )


@bp.route("/segment", methods=["GET"])
def segment_only():
    """
    Lightweight endpoint: just return how the segmenter tokenized the input.
    No definitions, no fuzzy stuff ÃÂ¢Ã¢âÂ¬Ã¢â¬Å just the segments in order.
    """
    raw_q = request.args.get("q", "").strip()
    if not raw_q:
        return jsonify({"ok": False, "error": "missing query parameter 'q'"}), 400
    extended_hits = set()
    q = normalization_service.normalize_burmese_for_segmentation(
        raw_q, extended_hits=extended_hits
    )
    if not q:
        return jsonify({"ok": False, "error": "query contains no Burmese text"}), 400
    if not normalization_service.contains_burmese(q):
        return jsonify({"ok": False, "error": "query contains no Burmese text"}), 400
    if extended_hits:
        print(
            "[INFO] Extended Myanmar chars in /segment:", "".join(sorted(extended_hits))
        )
    segments = pipeline_service.segment_with_pipeline(q)
    return jsonify(
        {
            "ok": True,
            "q": q,
            "segments": segments,
            "joined": " | ".join(segments),  # quick human-readable string
        }
    )


@bp.route("/subsegments", methods=["GET"])
def subsegments():
    """
    Lazily decompose a single word into inner pieces.
    Used by the UI when the user hovers a word in the popup.
    Params:
        token: the Burmese word/segment to decompose
    """
    raw = request.args.get("token", "") or ""
    token = normalization_service.normalize_burmese(raw.strip())
    if not token:
        return jsonify({"ok": False, "error": "missing token"}), 400
    if not normalization_service.contains_burmese(token):
        return jsonify({"ok": False, "error": "token contains no Burmese"}), 400
    token_norm = normalization_service.normalize_headword(token)
    # Decide which splitter to use
    if token_norm in lexicon_service.DICT:
        mode = "known"
        subs = fill_service._decompose_known_head_into_subwords(token)
    else:
        mode = "unknown"
        subs = fill_service._split_unknown_into_subsegments(token)
        # If empty (single-syllable unknown), create a minimal entry with g2p
        if not subs:
            g2p_data = pronunciation_service.g2p_explain_for_ui(token)
            roman = ""
            if g2p_data and g2p_data.get("syllables"):
                roman = " ".join(
                    s.get("roman", "") for s in g2p_data["syllables"] if s.get("roman")
                )
            subs = [
                {
                    "head": token,
                    "roman": roman,
                    "pos": "unknown",
                    "senses": ["[no dictionary entry found for this segment]"],
                    "g2p": g2p_data,
                }
            ]
    return jsonify(
        {
            "ok": True,
            "mode": mode,
            "head": token,
            "subsegments": subs or [],  # list of {head, roman, pos, senses, g2p}
        }
    )
