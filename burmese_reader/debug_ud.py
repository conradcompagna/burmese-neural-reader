"""Burmese reader: debug ud."""

from __future__ import annotations
from .templating import render_debug_template

import html

from flask import (
    Blueprint,
    Response,
    jsonify,
    request,
)

from . import (
    fill as fill_service,
    normalization as normalization_service,
    pipeline as pipeline_service,
    ud as ud_service,
)

bp = Blueprint("debug_ud", __name__)


@bp.route("/debug_ud_parser", methods=["POST"])
def debug_ud_parser():
    """
    Debug the UD parser. By default, mirrors /lookup normalization + segmentation.
    Payload JSON:
      { "text": "...", "raw": false }  # raw=true bypasses segmentation and parses raw text
    Response: per-token POS/TAG/DEP with heads/children, plus segments used.
    """
    return jsonify({"ok": False, "error": "debug_disabled"}), 404
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    use_raw = bool(data.get("raw"))
    model_override = (data.get("model") or "").strip()
    merge_greedy_param = (data.get("merge_greedy") or "").strip().lower()
    stanza_seg_param = str(data.get("stanza_segmenter") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if not text:
        return jsonify({"ok": False, "error": "empty text"}), 400

    parser = None
    override_nlp = None
    override_err = None
    if model_override:
        try:
            import spacy  # type: ignore

            global _DEBUG_SPACY_MODEL_CACHE  # type: ignore
            try:
                _DEBUG_SPACY_MODEL_CACHE  # type: ignore[name-defined]
            except Exception:
                _DEBUG_SPACY_MODEL_CACHE = {}  # type: ignore[name-defined]

            cache = _DEBUG_SPACY_MODEL_CACHE  # type: ignore[name-defined]
            if model_override not in cache:
                cache[model_override] = spacy.load(model_override)
            override_nlp = cache[model_override]
        except Exception as e:
            override_err = f"spacy_load_failed:{type(e).__name__}:{e}"
    else:
        parser = ud_service.init_ud_parser()
        if parser is None:
            return jsonify({"ok": False, "error": "ud_disabled"}), 503

    segments = None
    segments_used = None
    doc2seg = None
    mode = "raw" if use_raw else "segments"
    original_text_for_overlay = text

    if use_raw:
        if override_nlp is not None:
            doc = override_nlp(text)
        else:
            doc = parser.nlp(text)
    else:
        norm = normalization_service.normalize_burmese_for_segmentation(text)
        if not norm:
            return jsonify(
                {"ok": False, "error": "query contains no Burmese after normalization"}
            ), 400
        segments, island_spans = pipeline_service.segment_with_pipeline_and_islands(
            norm
        )
        fills_by_seg: list[dict | None] = [None] * len(segments)
        for s, e in island_spans:
            island_tokens = segments[s:e]
            filled = [
                fill_service._fill_token_with_dict_for_ui(t) for t in island_tokens
            ]
            for i, f in enumerate(filled):
                fills_by_seg[s + i] = f
        kept_words: list[str] = []
        doc2seg = []
        for si, tok in enumerate(segments):
            if normalization_service._is_spacy_clean_token(tok):
                doc2seg.append(si)
                kept_words.append(tok)
        segments_used = kept_words
        spaces = [True] * (len(kept_words) - 1) + [False] if kept_words else []
        if override_nlp is not None:
            from spacy.tokens import Doc  # type: ignore

            doc = Doc(override_nlp.vocab, words=kept_words, spaces=spaces)
            dict_fills_for_kept = (
                [fills_by_seg[si] for si in doc2seg] if doc2seg is not None else []
            )
            for tok, fill_data in zip(doc, dict_fills_for_kept):
                if fill_data is not None:
                    tok._.dict_fills = fill_data
            doc = override_nlp(doc)
        else:
            doc = parser._Doc(parser.nlp.vocab, words=kept_words, spaces=spaces)
            dict_fills_for_kept = (
                [fills_by_seg[si] for si in doc2seg] if doc2seg is not None else []
            )
            for tok, fill_data in zip(doc, dict_fills_for_kept):
                if fill_data is not None:
                    tok._.dict_fills = fill_data
            doc = parser.nlp(doc)

    tokens_out = []
    for t in doc:
        seg_i = doc2seg[int(t.i)] if doc2seg is not None else None
        head_doc_i = int(t.head.i)
        head_seg_i = doc2seg[head_doc_i] if doc2seg is not None else None
        tokens_out.append(
            {
                "i": int(t.i),
                "seg_i": seg_i,
                "text": t.text,
                "lemma": t.lemma_,
                "upos": t.pos_,
                "tag": t.tag_,
                "dep": t.dep_,
                "head": {"i": head_doc_i, "seg_i": head_seg_i, "text": t.head.text},
                "children": [int(ch.i) for ch in t.children],
                "is_sent_start": bool(t.is_sent_start),
            }
        )

    sents_out = []
    try:
        for si, sent in enumerate(doc.sents):
            start_i = int(sent.start)
            end_i = int(sent.end)  # exclusive
            seg_start_i = (
                doc2seg[start_i]
                if doc2seg is not None and start_i < len(doc2seg)
                else None
            )
            seg_end_i = (
                doc2seg[end_i - 1]
                if doc2seg is not None and end_i - 1 < len(doc2seg)
                else None
            )
            sents_out.append(
                {
                    "i": int(si),
                    "start": start_i,
                    "end": end_i,
                    "seg_start": seg_start_i,
                    "seg_end": seg_end_i,
                    "text": sent.text,
                }
            )
    except Exception:
        sents_out = []

    return jsonify(
        {
            "ok": True,
            "mode": mode,
            "input_text": text,
            "model": model_override or None,
            "model_error": override_err,
            "segments": segments,
            "segments_used": segments_used,
            "doc2seg": doc2seg,
            "token_count": len(tokens_out),
            "tokens": tokens_out,
            "sentences": sents_out,
        }
    )


@bp.route("/debug_ud_parser_ui", methods=["GET"])
def debug_ud_parser_ui():
    """
    Simple web UI for /debug_ud_parser. Enter text, choose raw vs segmented,
    see the JSON response rendered below.
    """
    return Response("debug_disabled", mimetype="text/plain; charset=utf-8")
    html_page = render_debug_template("debug/debug-ud-parser-ui.html", [])
    return Response(html_page, mimetype="text/html; charset=utf-8")


@bp.route("/debug/parser", methods=["GET"])
def debug_parser_route():
    return Response("debug_disabled", mimetype="text/plain; charset=utf-8")
    """
    Debug the UD parser via a simple GET endpoint.
    Mirrors normalization + segmentation from /lookup unless raw=1.
    Query params:
      q=...            (required)
      raw=1            (optional, bypass segmentation and parse raw text)
      stanza_segmenter=1 (optional, use stanza tokenizer)
      (format ignored; always HTML)
    """
    raw_q = (request.args.get("q") or "").strip()
    if not raw_q:
        return jsonify({"ok": False, "error": "missing query parameter 'q'"}), 400
    merge_greedy_param = (request.args.get("merge_greedy") or "").strip().lower()
    stanza_seg_param = str(
        request.args.get("stanza_segmenter") or ""
    ).strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }

    model_override = (request.args.get("model") or "").strip()

    parser = None
    override_nlp = None
    override_err = None
    if model_override:
        try:
            import spacy  # type: ignore

            global _DEBUG_SPACY_MODEL_CACHE  # type: ignore
            try:
                _DEBUG_SPACY_MODEL_CACHE  # type: ignore[name-defined]
            except Exception:
                _DEBUG_SPACY_MODEL_CACHE = {}  # type: ignore[name-defined]

            cache = _DEBUG_SPACY_MODEL_CACHE  # type: ignore[name-defined]
            if model_override not in cache:
                cache[model_override] = spacy.load(model_override)
            override_nlp = cache[model_override]
        except Exception as e:
            override_err = f"spacy_load_failed:{type(e).__name__}:{e}"
            return jsonify({"ok": False, "error": override_err}), 400
    else:
        parser = ud_service.init_ud_parser()
        if parser is None:
            return jsonify({"ok": False, "error": "ud_disabled"}), 503

    use_raw = str(request.args.get("raw") or "").lower() in {"1", "true", "yes", "raw"}

    segments = None
    segments_used = None
    doc2seg = None
    mode = "raw" if use_raw else "segments"

    if use_raw:
        if override_nlp is not None:
            doc = override_nlp(raw_q)
        else:
            doc = parser.nlp(raw_q)
    else:
        extended_hits = set()
        norm = normalization_service.normalize_burmese_for_segmentation(
            raw_q, extended_hits=extended_hits
        )
        if not norm:
            return jsonify(
                {"ok": False, "error": "query contains no Burmese after normalization"}
            ), 400
        original_text_for_overlay = norm
        segments, island_spans = pipeline_service.segment_with_pipeline_and_islands(
            norm
        )
        fills_by_seg: list[dict | None] = [None] * len(segments)
        for s, e in island_spans:
            island_tokens = segments[s:e]
            filled = [
                fill_service._fill_token_with_dict_for_ui(t) for t in island_tokens
            ]
            for i, f in enumerate(filled):
                fills_by_seg[s + i] = f
        kept_words: list[str] = []
        doc2seg = []
        for si, tok in enumerate(segments):
            if normalization_service._is_spacy_clean_token(tok):
                doc2seg.append(si)
                kept_words.append(tok)
        segments_used = kept_words
        spaces = [True] * (len(kept_words) - 1) + [False] if kept_words else []
        if override_nlp is not None:
            from spacy.tokens import Doc  # type: ignore

            doc = Doc(override_nlp.vocab, words=kept_words, spaces=spaces)
            dict_fills_for_kept = (
                [fills_by_seg[si] for si in doc2seg] if doc2seg is not None else []
            )
            for tok, fill_data in zip(doc, dict_fills_for_kept):
                if fill_data is not None:
                    tok._.dict_fills = fill_data
            doc = override_nlp(doc)
        else:
            # Capture morphologizer output BEFORE dict_pos_override runs
            morphologizer_output = None
            if parser is not None and "morphologizer" in parser.nlp.pipe_names:
                try:
                    # Run just tok2vec + morphologizer to get original POS
                    temp_doc = parser._Doc(
                        parser.nlp.vocab, words=kept_words, spaces=spaces
                    )
                    tok2vec = parser.nlp.get_pipe("tok2vec")
                    morph = parser.nlp.get_pipe("morphologizer")
                    temp_doc = tok2vec(temp_doc)
                    temp_doc = morph(temp_doc)
                    morphologizer_output = [t.pos_ for t in temp_doc]
                except Exception:
                    pass

            # Now run the FULL pipeline (including dict_pos_override)
            doc = parser._Doc(parser.nlp.vocab, words=kept_words, spaces=spaces)

            # Compute dictionary fills for each kept word and set them on tokens
            dict_fills_for_kept = (
                [fills_by_seg[si] for si in doc2seg] if doc2seg is not None else []
            )
            for tok, fill_data in zip(doc, dict_fills_for_kept):
                if fill_data is not None:
                    tok._.dict_fills = fill_data

            doc = parser.nlp(doc)

    tokens_out = []

    # Ensure morphologizer_output is defined for all code paths
    try:
        morphologizer_output
    except NameError:
        morphologizer_output = None

    for t_idx, t in enumerate(doc):
        seg_i = doc2seg[int(t.i)] if doc2seg is not None else None
        head_doc_i = int(t.head.i)
        head_seg_i = doc2seg[head_doc_i] if doc2seg is not None else None
        tokens_out.append(
            {
                "i": int(t.i),
                "seg_i": seg_i,
                "text": t.text,
                "lemma": t.lemma_,
                "upos": t.pos_,
                "upos_original": morphologizer_output[t_idx]
                if morphologizer_output and t_idx < len(morphologizer_output)
                else None,
                "tag": t.tag_,
                "dep": t.dep_,
                "head": {"i": head_doc_i, "seg_i": head_seg_i, "text": t.head.text},
                "children": [int(ch.i) for ch in t.children],
            }
        )

    import urllib.parse

    rows = []
    for tok in tokens_out:
        children_str = ", ".join(str(c) for c in tok["children"])
        # Show if POS was constrained by dict_pos_override (changed from original)
        upos_display = html.escape(tok["upos"])
        upos_original = tok.get("upos_original")
        if upos_original and upos_original != tok["upos"]:
            # Highlight when POS was constrained by dict_pos_override
            upos_display = f"<strong style='color: green;'>{upos_display}</strong> <em style='color: gray;'>(was: {html.escape(upos_original)})</em>"

        rows.append(
            f"<tr><td>{tok['i']}</td><td>{'' if tok['seg_i'] is None else tok['seg_i']}</td><td>{html.escape(tok['text'])}</td>"
            f"<td>{upos_display}</td>"
            f"<td>{html.escape(tok['tag'])}</td>"
            f"<td>{html.escape(tok['dep'])}</td>"
            f"<td>{tok['head']['i']} / {'' if tok['head']['seg_i'] is None else tok['head']['seg_i']} ({html.escape(tok['head']['text'])})</td>"
            f"<td>{children_str}</td></tr>"
        )
    segs_html = ""
    if segments is not None:
        segs_html = (
            "<p><strong>Segments:</strong> "
            + " | ".join(html.escape(s) for s in segments)
            + "</p>"
        )
        if segments_used is not None and segments_used != segments:
            segs_html += (
                "<p><strong>Segments used for spaCy:</strong> "
                + " | ".join(html.escape(s) for s in segments_used)
                + "</p>"
            )

    # Sentence boundaries as predicted by spaCy (doc.sents).
    # Note: if the loaded model wasn't trained/configured for sentence segmentation,
    # it may return a single sentence spanning the whole doc.
    sents_html = ""
    try:
        sent_lines = []
        sents = list(doc.sents)
        for si, sent in enumerate(sents):
            start_i = int(sent.start)
            end_i = int(sent.end)  # exclusive
            seg_start_i = (
                doc2seg[start_i]
                if doc2seg is not None and start_i < len(doc2seg)
                else None
            )
            seg_end_i = (
                doc2seg[end_i - 1]
                if doc2seg is not None and end_i - 1 < len(doc2seg)
                else None
            )
            seg_part = ""
            if seg_start_i is not None or seg_end_i is not None:
                seg_part = f" (seg {'' if seg_start_i is None else seg_start_i}..{'' if seg_end_i is None else seg_end_i})"
            sent_lines.append(
                f"<li><strong>{si + 1}.</strong> [{start_i},{end_i}){seg_part} {html.escape(sent.text)}</li>"
            )

        note = ""
        if len(sents) <= 1:
            note = (
                "<p><em>Note: spaCy model returned 1 sentence for this input.</em></p>"
            )

        if sent_lines:
            sents_html = (
                "<h3>Sentence Segmentation (spaCy)</h3>"
                + note
                + "<ol>"
                + "".join(sent_lines)
                + "</ol>"
            )
        else:
            sents_html = (
                "<h3>Sentence Segmentation (spaCy)</h3><p>(no sentences returned)</p>"
            )
    except Exception:
        sents_html = (
            "<h3>Sentence Segmentation</h3><p>(sentence segmentation unavailable)</p>"
        )

    vis_url = "/debug/displacy?q=" + urllib.parse.quote_plus(raw_q)
    if use_raw:
        vis_url += "&raw=1"
    if stanza_seg_param:
        vis_url += "&stanza_segmenter=1"
    if merge_greedy_param:
        vis_url += "&merge_greedy=" + urllib.parse.quote_plus(merge_greedy_param)
    if model_override:
        vis_url += "&model=" + urllib.parse.quote_plus(model_override)
    vis_html = f'<p><a href="{html.escape(vis_url)}" target="_blank" rel="noopener">Open displaCy dependency visualization</a></p>'
    # Dict POS override calculations (if available)
    override_html = ""
    try:
        override_nlp_for_debug = override_nlp or (
            parser.nlp if parser is not None else None
        )
        if (
            override_nlp_for_debug is not None
            and "dict_pos_override" in override_nlp_for_debug.pipe_names
        ):
            override_pipe = override_nlp_for_debug.get_pipe("dict_pos_override")
            calc_rows = []
            for t in doc:
                try:
                    dbg = override_pipe.debug_token(t)  # type: ignore[attr-defined]
                except Exception:
                    dbg = {}
                allowed = dbg.get("allowed") or []
                subword_scores = dbg.get("subword_scores") or {}
                spacy_raw_scaled = (
                    dbg.get("spacy_raw_scaled") or {}
                )  # ALL POS scaled by max
                spacy_scaled_scores = (
                    dbg.get("spacy_scaled_scores") or {}
                )  # Filtered to allowed
                blended_scores = dbg.get("blended_scores") or {}
                constraint_type = dbg.get("constraint_type", "hard")
                source = dbg.get("source") or ""
                fills = dbg.get("fills") or []
                subwords = dbg.get("subwords") or []
                subwords2 = dbg.get("subwords_level2") or []
                sub_debug = dbg.get("subword_debug") or []
                subword_context = dbg.get("subword_context") or {}
                context_prev = subword_context.get("prev") or ""
                context_next = subword_context.get("next") or ""
                context_str = ""
                if context_prev or context_next:
                    context_str = f"{context_prev} | {context_next}"

                # Format all score types
                allowed_str = ", ".join(allowed) if allowed else ""
                constraint_str = constraint_type

                # spaCy raw scaled (ALL POS, max=1.0 for debugging)
                if spacy_raw_scaled:
                    parts = [
                        f"{k}:{spacy_raw_scaled[k]:.3f}"
                        for k in sorted(spacy_raw_scaled.keys())
                    ]
                    spacy_raw_str = " | ".join(parts)
                else:
                    spacy_raw_str = "(none)"

                # spaCy scaled scores (filtered to allowed, NO second scaling)
                if spacy_scaled_scores:
                    parts = [
                        f"{k}:{spacy_scaled_scores[k]:.3f}"
                        for k in sorted(spacy_scaled_scores.keys())
                    ]
                    spacy_scaled_str = " | ".join(parts)
                else:
                    spacy_scaled_str = "(none)"

                # Subword scores (from decomposition, scaled max=1.0)
                if subword_scores:
                    parts = [
                        f"{k}:{subword_scores[k]:.3f}"
                        for k in sorted(subword_scores.keys())
                    ]
                    subword_str = " | ".join(parts)
                else:
                    subword_str = "(none)"

                # Blended scores (50/50 blend for multi-component, else = spaCy scaled)
                if blended_scores:
                    parts = [
                        f"{k}:{blended_scores[k]:.3f}"
                        for k in sorted(blended_scores.keys())
                    ]
                    blended_str = " | ".join(parts)
                else:
                    blended_str = "(none)"

                # Only show fills/subwords for multi-fill or decomposed cases
                # Skip for single exact matches (trust spaCy's morphologizer)
                show_breakdown = (
                    len(fills) > 1  # Multiple dictionary fills
                    or subwords  # Decomposition occurred
                    or "decomposed" in source  # Explicitly decomposed (e.g., Pali word)
                    or "multi_fill"
                    in source  # Compound with all valid POS (50/50 blend)
                )

                if show_breakdown and fills:
                    fparts = [
                        f"{html.escape(f.get('head', ''))}:{html.escape(f.get('pos', ''))}"
                        for f in fills
                    ]
                    fills_str = " | ".join(fparts)
                else:
                    fills_str = ""
                if show_breakdown and subwords:
                    sparts = [
                        f"{html.escape(s.get('head', ''))}:{html.escape(s.get('pos', ''))}"
                        for s in subwords
                    ]
                    subwords_str = " | ".join(sparts)
                else:
                    subwords_str = ""
                if show_breakdown and subwords2:
                    sparts2 = [
                        f"{html.escape(s.get('head', ''))}:{html.escape(s.get('pos', ''))}"
                        for s in subwords2
                    ]
                    subwords2_str = " | ".join(sparts2)
                else:
                    subwords2_str = ""
                # Color-code constraint type
                constraint_color = "green" if constraint_str == "hard" else "orange"
                constraint_display = f"<span style='color:{constraint_color};font-weight:bold;'>{constraint_str}</span>"

                calc_rows.append(
                    f"<tr><td>{t.i}</td><td>{html.escape(t.text)}</td>"
                    f"<td>{html.escape(source)}</td>"
                    f"<td>{constraint_display}</td>"
                    f"<td>{html.escape(allowed_str)}</td>"
                    f"<td>{html.escape(spacy_raw_str)}</td>"
                    f"<td>{html.escape(spacy_scaled_str)}</td>"
                    f"<td>{html.escape(subword_str)}</td>"
                    f"<td>{html.escape(blended_str)}</td>"
                    f"<td>{html.escape(fills_str)}</td>"
                    f"<td>{html.escape(subwords_str)}</td>"
                    f"<td>{html.escape(context_str)}</td></tr>"
                )
                # Only show detailed subword debug when breakdown is relevant
                if show_breakdown and sub_debug:
                    sub_rows = []
                    for sd in sub_debug:
                        s_allowed = ", ".join(sd.get("allowed") or [])
                        s_pos_scores = sd.get("pos_scores") or {}

                        if s_pos_scores:
                            # Decomposed: show individual morphologizer scores for each subword
                            score_parts = [
                                f"{k}:{s_pos_scores[k]:.3f}"
                                for k in sorted(s_pos_scores.keys())
                            ]
                            s_scores_str = " | ".join(score_parts)
                        else:
                            # Single component: just show allowed
                            s_scores_str = ""

                        sub_rows.append(
                            f"<tr><td>{html.escape(sd.get('text', ''))}</td>"
                            f"<td>{html.escape(s_allowed)}</td>"
                            f"<td>{html.escape(s_scores_str)}</td></tr>"
                        )

                    # Column header depends on whether we have individual scores
                    has_pos_scores = any(sd.get("pos_scores") for sd in sub_debug)
                    col_header = (
                        "pos_scores (morphologizer)" if has_pos_scores else "allowed"
                    )

                    subtable = (
                        "<table>"
                        "<tr><th>subword</th><th>allowed</th><th>"
                        + col_header
                        + "</th></tr>"
                        + "".join(sub_rows)
                        + "</table>"
                    )
                    calc_rows.append(f'<tr><td colspan="12">{subtable}</td></tr>')
            if calc_rows:
                override_html = (
                    "<h3>Dict POS Override Calculations</h3>"
                    "<p><em><strong>Hard constraints</strong>: All tokens use hard constraints (must be in allowed set).<br>"
                    "<strong>Single-component</strong>: spaCy raw logits scaled once (max=1.0), filtered to allowed POS without re-scaling.<br>"
                    "<strong>Multi-component</strong>: Fixed 50/50 blend of spaCy (filtered, not re-scaled) + subword scaled. No softmax, no normalization after blending.</em></p>"
                    "<table style='font-size:12px;'>"
                    "<tr><th>doc_i</th><th>text</th><th>source</th><th>constraint</th><th>allowed</th><th>spacy_raw_all</th><th>spacy_filtered</th><th>subword_scaled</th><th>blended</th><th>fills</th><th>subwords</th><th>subword_ctx</th></tr>"
                    + "".join(calc_rows)
                    + "</table>"
                )
    except Exception:
        override_html = ""

    html_page = f"""<!DOCTYPE html>
<html lang="my">
<head>
  <meta charset="utf-8">
  <title>UD Parser Debug</title>
  <style>
    body {{ font-family: system-ui, sans-serif; padding: 16px; line-height: 1.5; }}
    input[type=text] {{ width: 100%; font-size: 16px; padding: 6px; }}
    table {{ border-collapse: collapse; width: 100%; }}
    th, td {{ border: 1px solid #ddd; padding: 6px; text-align: left; }}
    th {{ background: #f4f4f4; }}
  </style>
</head>
<body>
  <h2>UD Parser Debug</h2>
  <p><strong>Mode:</strong> {mode}</p>
  <form method="get" action="/debug/parser">
    <label><strong>q</strong></label><br>
    <input type="text" name="q" value="{html.escape(raw_q)}"/><br><br>
    <label><strong>model</strong> (optional spaCy name/path)</label><br>
    <input type="text" name="model" value="{html.escape(model_override)}"/><br><br>
    <label><input type="checkbox" name="raw" value="1" {"checked" if use_raw else ""}/> raw</label><br>
    <label><input type="checkbox" name="stanza_segmenter" value="1" {"checked" if stanza_seg_param else ""}/> use stanza tokenizer</label><br>
    <button type="submit">Run</button>
  </form>
  <p><strong>Model:</strong> {html.escape(model_override) if model_override else "(default UD parser)"}{" <em>(" + html.escape(override_err) + ")</em>" if override_err else ""}</p>
  {vis_html}
  {segs_html}
  {sents_html}
  <table>
    <tr><th>doc_i</th><th>seg_i</th><th>text</th><th>upos</th><th>tag</th><th>dep</th><th>head (doc/seg)</th><th>children</th></tr>
    {"".join(rows)}
  </table>
  {override_html}
</body>
</html>"""
    return Response(html_page, mimetype="text/html; charset=utf-8")


@bp.route("/debug/displacy", methods=["GET"])
def debug_displacy_route():
    return jsonify({"ok": False, "error": "debug_disabled"}), 404
    """
    Render spaCy's displaCy dependency visualizer for a query string.
    Mirrors /lookup normalization + segmentation unless raw=1.
    Always returns HTML.
    Query params:
      q=...   (required)
      raw=1   (optional, bypass segmentation and parse raw text)
      stanza_segmenter=1 (optional, use stanza tokenizer)
    """
    raw_q = (request.args.get("q") or "").strip()
    if not raw_q:
        return jsonify({"ok": False, "error": "missing query parameter 'q'"}), 400

    merge_greedy_param = (request.args.get("merge_greedy") or "").strip().lower()
    stanza_seg_param = str(
        request.args.get("stanza_segmenter") or ""
    ).strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    model_override = (request.args.get("model") or "").strip()

    parser = None
    override_nlp = None
    if model_override:
        try:
            import spacy  # type: ignore

            global _DEBUG_SPACY_MODEL_CACHE  # type: ignore
            try:
                _DEBUG_SPACY_MODEL_CACHE  # type: ignore[name-defined]
            except Exception:
                _DEBUG_SPACY_MODEL_CACHE = {}  # type: ignore[name-defined]

            cache = _DEBUG_SPACY_MODEL_CACHE  # type: ignore[name-defined]
            if model_override not in cache:
                cache[model_override] = spacy.load(model_override)
            override_nlp = cache[model_override]
        except Exception as e:
            return jsonify(
                {"ok": False, "error": f"spacy_load_failed:{type(e).__name__}:{e}"}
            ), 400
    else:
        parser = ud_service.init_ud_parser()
        if parser is None:
            return jsonify({"ok": False, "error": "ud_disabled"}), 503

    use_raw = str(request.args.get("raw") or "").lower() in {"1", "true", "yes", "raw"}

    # Build docs (one sentence at a time) so the visualization doesn't cross sentence boundaries.
    docs = []
    segments = None
    segments_used = None

    try:
        from spacy import displacy  # type: ignore
    except Exception as e:
        return jsonify(
            {"ok": False, "error": f"spacy_displacy_unavailable:{type(e).__name__}:{e}"}
        ), 500

    if use_raw:
        if override_nlp is not None:
            doc = override_nlp(raw_q)
        else:
            doc = parser.nlp(raw_q)
        docs = list(doc.sents) or [doc]
    else:
        norm = normalization_service.normalize_burmese_for_segmentation(raw_q)
        segments = pipeline_service.segment_with_pipeline(norm)

        kept_words: list[str] = []
        for tok in segments:
            if normalization_service._is_spacy_clean_token(tok):
                kept_words.append(tok)
        segments_used = kept_words

        if override_nlp is not None:
            from spacy.tokens import Doc  # type: ignore

            doc = Doc(
                override_nlp.vocab,
                words=kept_words,
                spaces=[True] * (len(kept_words) - 1) + [False] if kept_words else [],
            )
            if len(doc):
                doc[0].is_sent_start = True
            doc = override_nlp(doc)
        else:
            doc = parser._Doc(
                parser.nlp.vocab,
                words=kept_words,
                spaces=[True] * (len(kept_words) - 1) + [False] if kept_words else [],
            )
            if len(doc):
                doc[0].is_sent_start = True
            doc = parser.nlp(doc)

        docs = list(doc.sents) or [doc]

    if not docs:
        msg = "<p>No tokens were passed to spaCy (all tokens were filtered out).</p>"
        return Response(
            "<!doctype html><meta charset='utf-8'><title>displaCy</title>" + msg,
            mimetype="text/html; charset=utf-8",
        )

    options = {
        "compact": True,
        "distance": 90,
        "bg": "#ffffff",
        "color": "#111827",
        "font": "Noto Sans Myanmar, Myanmar Text, system-ui, sans-serif",
    }

    # Render HTML fragment and wrap in a simple page that includes the segments used.
    rendered = displacy.render(docs, style="dep", options=options, page=False)

    segs_html = ""
    if segments is not None:
        segs_html = "<details open><summary><strong>Segments</strong></summary><div style='margin-top:6px;font-size:12px;line-height:1.6;white-space:pre-wrap;'>"
        segs_html += html.escape(" | ".join(segments))
        segs_html += "</div></details>"
        if segments_used is not None:
            segs_html += "<details><summary><strong>Segments used for spaCy</strong></summary><div style='margin-top:6px;font-size:12px;line-height:1.6;white-space:pre-wrap;'>"
            segs_html += html.escape(" | ".join(segments_used))
            segs_html += "</div></details>"

    page = f"""<!DOCTYPE html>
<html lang="my">
<head>
  <meta charset="utf-8">
  <title>displaCy Dependencies</title>
  <style>
    body {{ font-family: system-ui, sans-serif; padding: 16px; }}
    details {{ margin: 10px 0; }}
    summary {{ cursor: pointer; }}
  </style>
</head>
<body>
  <h2>displaCy Dependencies</h2>
  {segs_html}
  <div style="margin-top:14px;">{rendered}</div>
</body>
</html>"""
    return Response(page, mimetype="text/html; charset=utf-8")
