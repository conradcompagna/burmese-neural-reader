"""Burmese reader: policy."""

from __future__ import annotations

import os

from flask import (
    jsonify,
    request,
)

DEBUG_ENDPOINTS_ENABLED = str(
    os.environ.get("ENABLE_DEBUG_ENDPOINTS", "")
).strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}


_DEBUG_PATHS = {
    "/segment_debug",
    "/segment_text",
    "/debug_ud_parser",
    "/debug_ud_parser_ui",
    "/debug/parser",
    "/debug/displacy",
    "/debug/dict_check",
    "/debug/pos",
    "/debug/spell",
    "/debug/unknowns_summary",
    "/whitespace_boundaries.js",
    "/myudtree.conllu",
    "/myudtree.meta",
    "/myudtree.sentence",
}


def _block_debug_endpoints():
    if DEBUG_ENDPOINTS_ENABLED:
        return None
    path = request.path or ""
    if path.startswith("/debug") or path in _DEBUG_PATHS:
        # Hide debug endpoints in production.
        return jsonify({"ok": False, "error": "debug_disabled"}), 404
