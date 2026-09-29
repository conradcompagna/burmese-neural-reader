"""Burmese reader: srs routes."""

from __future__ import annotations

from flask import (
    Blueprint,
    jsonify,
)

bp = Blueprint("srs_routes", __name__)


@bp.route("/api/reading_srs/next_card", methods=["GET"])
def api_reading_srs_next_card():
    """DISABLED FOR DEPLOYMENT: SRS requires per-user state."""
    return jsonify({"ok": False, "error": "disabled"}), 403


@bp.route("/api/reading_srs/grade", methods=["POST"])
def api_reading_srs_grade():
    """DISABLED FOR DEPLOYMENT: SRS requires per-user state."""
    return jsonify({"ok": False, "error": "disabled"}), 403
