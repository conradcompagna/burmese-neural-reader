"""Burmese reader: debug unknowns."""

from __future__ import annotations

import json

from flask import (
    Blueprint,
    Response,
)

from . import normalization as normalization_service, settings as settings_service

bp = Blueprint("debug_unknowns", __name__)


MAX_UNKNOWN_TOKEN_BURMESE_LEN = 30  # start generous; tweak later


def _burmese_len(s: str) -> int:
    """
    Count how many characters in s are in the core Myanmar block.
    Used to filter out too-long junk segments.
    """
    if not s:
        return 0
    return sum(1 for ch in s if "\u1000" <= ch <= "\u109f")


@bp.route("/debug/unknowns_summary", methods=["GET"])
def debug_unknowns_summary():
    """
    Summarize unknown segments logged in lookup_unknown_segment_log.jsonl.
    Assumes JSONL format, one JSON object per line, e.g.:
        {"time": "...", "q": "...", "segment": "??????", "kind": "primary"}
    Rules:
      - token = rec["segment"] (fallback rec["token"])
      - must contain Burmese chars
      - Burmese length must be <= MAX_UNKNOWN_TOKEN_BURMESE_LEN
      - NO DICT FILTERING (we show everything that meets the above)
    Output (plain text):
        total_records: ...
        kept_tokens: ...
        skipped_no_token: ...
        skipped_non_burmese: ...
        skipped_zero_burmese: ...
        skipped_too_long (> N Burmese chars): ...
            42    ??????
            37    ??????????
             7    ??????
    """
    counts: dict[str, int] = {}
    total_records = 0
    skipped_no_token = 0
    skipped_non_burmese = 0
    skipped_zero_burmese = 0
    skipped_too_long = 0
    # Make sure the file exists
    if not settings_service.UNKNOWN_SEG_LOG_PATH.exists():
        return Response(
            f"[no file at {settings_service.UNKNOWN_SEG_LOG_PATH}]\n",
            mimetype="text/plain; charset=utf-8",
        )
    # Read JSONL in binary, decode each line with errors="ignore"
    with settings_service.UNKNOWN_SEG_LOG_PATH.open("rb") as f:
        for raw in f:
            try:
                line = raw.decode("utf-8", errors="ignore").strip()
            except Exception:
                continue
            if not line:
                continue
            total_records += 1
            try:
                rec = json.loads(line)
            except Exception:
                # If a line is corrupt JSON, just skip it
                continue
            if not isinstance(rec, dict):
                continue
            # Prefer old JSONL "segment", fall back to "token"
            token = (rec.get("segment") or rec.get("token") or "").strip()
            if not token:
                skipped_no_token += 1
                continue
            # Skip non-Burmese
            if not normalization_service.contains_burmese(token):
                skipped_non_burmese += 1
                continue
            blen = _burmese_len(token)
            if blen == 0:
                skipped_zero_burmese += 1
                continue
            # Max-length filter for paragraph/sentence junk
            if blen > MAX_UNKNOWN_TOKEN_BURMESE_LEN:
                skipped_too_long += 1
                continue
            # Count: 1 per record (we're just aggregating occurrences)
            counts[token] = counts.get(token, 0) + 1
    header_lines = [
        f"total_records: {total_records}",
        f"kept_tokens: {len(counts)}",
        f"skipped_no_token: {skipped_no_token}",
        f"skipped_non_burmese: {skipped_non_burmese}",
        f"skipped_zero_burmese: {skipped_zero_burmese}",
        f"skipped_too_long (> {MAX_UNKNOWN_TOKEN_BURMESE_LEN} Burmese chars): {skipped_too_long}",
        "",
    ]
    if not counts:
        return Response(
            "\n".join(header_lines) + "[no tokens passed filters]\n",
            mimetype="text/plain; charset=utf-8",
        )
    # Sort by count desc, then token
    items = sorted(
        counts.items(),
        key=lambda kv: (kv[1], kv[0]),
        reverse=True,
    )
    lines = header_lines + [f"{count:5d}\t{token}" for token, count in items]
    return Response(
        "\n".join(lines) + "\n",
        mimetype="text/plain; charset=utf-8",
    )
