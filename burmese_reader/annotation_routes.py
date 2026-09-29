"""Burmese reader: annotation routes."""

from __future__ import annotations

from flask import (
    Blueprint,
    jsonify,
    request,
)

bp = Blueprint("annotation_routes", __name__)


@bp.route("/annotation", methods=["GET", "POST"])
def annotation_endpoint():
    """
    GET /annotation?head=...  -> {ok, head, note}
    POST /annotation        -> {ok}  (JSON body: {head, note})

    DISABLED FOR DEPLOYMENT: Comments/annotations require user accounts.
    Returns empty notes and ignores saves.
    """
    # DEPLOYMENT: Annotations disabled - return empty notes, ignore saves
    if request.method == "GET":
        head = (request.args.get("head") or "").strip()
        if not head:
            return jsonify({"ok": False, "error": "missing head"}), 400
        # Return empty note (annotations disabled)
        return jsonify({"ok": True, "head": head, "note": ""})
    # POST - silently ignore saves
    return jsonify({"ok": True})
