"""Burmese reader: debug segmentation."""

from __future__ import annotations

import html
import json

from flask import (
    Blueprint,
    Response,
    jsonify,
    request,
)

from . import (
    dictionary_dp as dictionary_dp_service,
    lexicon as lexicon_service,
    normalization as normalization_service,
    pipeline as pipeline_service,
)

bp = Blueprint("debug_segmentation", __name__)


@bp.route("/segment_text", methods=["GET"])
def segment_text():
    """
    HTML segmentation endpoint for quick debugging.
    Takes the FULL q string, drops non-Myanmar with
    normalize_burmese_for_segmentation, and segments it.
    Unknown tokens are highlighted (red + bracketed),
    and any whitespace is removed before segmentation.
    """
    raw_q = request.args.get("q", "")
    if raw_q is None:
        return Response(
            "ERROR: missing query parameter 'q'\n",
            status=400,
            mimetype="text/plain; charset=utf-8",
        )
    extended_hits = set()
    q = normalization_service.normalize_burmese_for_segmentation(
        raw_q, extended_hits=extended_hits
    )
    # After normalization + stripping, if there's literally no Myanmar left, complain
    if not q:
        return Response(
            "ERROR: query contains no Burmese text after normalization\n",
            status=400,
            mimetype="text/plain; charset=utf-8",
        )
    segments = pipeline_service.segment_with_pipeline(q)
    # Build HTML with red + bracketed unknowns
    pieces = []
    for i, seg in enumerate(segments):
        if i > 0:
            pieces.append('<span class="seg-sep"> | </span>')
        escaped = html.escape(seg)
        if normalization_service.normalize_headword(seg) in lexicon_service.DICT:
            # known token: normal
            pieces.append(f'<span class="seg-known">{escaped}</span>')
        else:
            # unknown token: bracketed + red
            pieces.append(f'<span class="seg-unknown">[[{escaped}]]</span>')
    body_html = "".join(pieces)
    page_html = f"""<!DOCTYPE html>
<html lang="my">
<head>
  <meta charset="utf-8">
  <title>Segmentation Debug</title>
  <style>
    body {{
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.6;
      padding: 16px;
      white-space: pre-wrap;
    }}
    .seg-known {{
      color: inherit;
    }}
    .seg-unknown {{
      color: #c00000;  /* red, no underline */
    }}
    .seg-sep {{
      color: #888888;
    }}
  </style>
</head>
<body>
  <div>{body_html}</div>
</body>
</html>
"""
    return Response(page_html, mimetype="text/html; charset=utf-8")


@bp.route("/segment_debug", methods=["GET"])
def segment_debug():
    """
    Debug endpoint: run the new segmenter and return cost breakdown.
    """
    raw_q = request.args.get("q", "").strip()
    if not raw_q:
        return jsonify({"ok": False, "error": "missing query parameter 'q'"}), 400
    q = normalization_service.normalize_burmese_for_segmentation(raw_q)
    if not q or not normalization_service.contains_burmese(q):
        return jsonify(
            {"ok": False, "error": "query contains no Burmese text after normalization"}
        ), 400
    debug_data = dictionary_dp_service._segment_by_clusters_dp_debug(q)
    payload = {
        "ok": True,
        "q": q,
        "segments": debug_data["segments"],
        "clusters": debug_data["clusters"],
        "starts": debug_data["starts"],
        "cluster_ends": debug_data["cluster_ends"],
        "dp_cost": debug_data["dp_cost"],
        "next_idx": debug_data["next_idx"],
        "first_word": debug_data["first_word"],
        "events": debug_data["events"],
        "candidates": debug_data.get("candidates", []),
    }
    return Response(
        json.dumps(payload, ensure_ascii=False),
        mimetype="application/json; charset=utf-8",
    )


@bp.route("/debug/dict_check", methods=["GET"])
def debug_dict_check():
    """
    Debug endpoint: inspect codepoints + dictionary visibility for a string.
    Params:
        q: input text
    """
    raw = request.args.get("q", "") or ""
    seg_inst = lexicon_service.get_segmenter_instance()

    def _uinfo(s: str) -> dict:
        return {
            "text": s,
            "unicode_escape": s.encode("unicode_escape").decode("ascii"),
            "codepoints": [f"U+{ord(c):04X}" for c in s],
        }

    norm = normalization_service.normalize_headword(raw)
    norm_info = _uinfo(norm)

    dp_segments = seg_inst.segment(raw) if raw else []
    dp_info = []
    for seg in dp_segments:
        entry = seg_inst.dictionary.lookup(seg)
        dp_info.append(
            {
                **_uinfo(seg),
                "dict_known": bool(entry),
                "dict_source": entry.source if entry else None,
            }
        )

    # Try the full pipeline (stanza -> DP -> merge). Falls back if stanza unavailable.
    try:
        pipe_segments = pipeline_service.segment_with_pipeline(raw) if raw else []
    except Exception:
        pipe_segments = []
    pipe_info = [_uinfo(seg) for seg in pipe_segments]

    out = {
        "raw": _uinfo(raw),
        "normalized_headword": norm_info,
        "normalized_in_dict": bool(norm and norm in lexicon_service.DICT),
        "dp_segments": dp_info,
        "pipeline_segments": pipe_info,
    }
    return jsonify(out)
