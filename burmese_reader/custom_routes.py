"""Burmese reader: custom routes."""

from __future__ import annotations

from flask import (
    Blueprint,
    jsonify,
    request,
)

from . import (
    custom_entries as custom_entries_service,
    normalization as normalization_service,
    pos as pos_service,
    settings as settings_service,
)

bp = Blueprint("custom_routes", __name__)


@bp.route("/api/user_dict/add", methods=["POST"])
def api_add_user_dict_entry():
    """
    Add or update a single entry in the per-user custom dictionary.
    DISABLED FOR DEPLOYMENT: no per-user accounts.
    """
    return jsonify({"ok": False, "error": "disabled"}), 403
    data = request.get_json(silent=True) or {}
    headword = (data.get("headword") or "").strip()
    definition = (data.get("definition") or data.get("gloss") or "").strip()
    romanization = (data.get("romanization") or "").strip()
    pos = (data.get("pos") or "").strip()
    if not headword:
        return jsonify({"ok": False, "error": "Headword is required."}), 400
    try:
        normalized = custom_entries_service.add_user_dict_entry(
            headword, romanization, pos, definition
        )
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        print(f"[USERDICT] error while adding entry: {e}")
        return jsonify(
            {"ok": False, "error": "Internal error while saving entry."}
        ), 500
    return jsonify({"ok": True, "head": normalized})


@bp.route("/api/text_override/add", methods=["POST"])
def api_add_text_override():
    """
    Add a text normalization override (raw -> normalized).
    DISABLED FOR DEPLOYMENT: no per-user accounts.
    """
    return jsonify({"ok": False, "error": "disabled"}), 403
    data = request.get_json(silent=True) or {}
    raw = (data.get("raw") or "").strip()
    normalized = (data.get("normalized") or "").strip()
    if not raw or not normalized:
        return jsonify({"ok": False, "error": "Raw and normalized are required."}), 400
    try:
        raw_out, normalized_out = custom_entries_service.add_user_text_override(
            raw, normalized
        )
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        print(f"[USEROVERRIDE] error while adding override: {e}")
        return jsonify(
            {"ok": False, "error": "Internal error while saving override."}
        ), 500
    return jsonify({"ok": True, "raw": raw_out, "normalized": normalized_out})


@bp.route("/api/custom_entries/list", methods=["GET"])
def api_list_custom_entries():
    """
    DISABLED FOR DEPLOYMENT: Custom entries require user accounts.
    Returns empty entries list.
    """
    # DEPLOYMENT: Custom entries disabled - return empty list
    return jsonify({"ok": True, "entries": []})


@bp.route("/api/user_dict/update", methods=["POST"])
def api_update_user_dict_entry():
    # DISABLED FOR DEPLOYMENT: no per-user accounts.
    return jsonify({"ok": False, "error": "disabled"}), 403
    data = request.get_json(silent=True) or {}
    row_id = data.get("id")
    try:
        row_id = int(row_id)
    except Exception:
        return jsonify({"ok": False, "error": "Invalid entry id."}), 400
    rows = custom_entries_service._read_user_dict_rows(settings_service.TSV_USER_PATH)
    if row_id < 0 or row_id >= len(rows):
        return jsonify({"ok": False, "error": "Entry not found."}), 404
    headword = (data.get("headword") or "").strip()
    romanization = (data.get("romanization") or "").strip()
    pos_raw = (data.get("pos") or "").strip()
    definition = (data.get("definition") or "").strip()
    if not headword:
        return jsonify({"ok": False, "error": "Headword is required."}), 400
    headword_norm = normalization_service.normalize_headword(headword)
    if not headword_norm or not normalization_service.contains_burmese(headword_norm):
        return jsonify(
            {"ok": False, "error": "Headword must contain Burmese script."}
        ), 400
    pos_norm = pos_service.normalize_pos(pos_raw or "")
    rows[row_id] = {
        "id": row_id,
        "headword": headword_norm,
        "romanization": romanization,
        "pos": pos_norm,
        "definition": definition,
    }
    custom_entries_service._write_user_dict_rows(settings_service.TSV_USER_PATH, rows)
    custom_entries_service._rebuild_user_dict_from_rows(rows)
    return jsonify({"ok": True, "head": headword_norm})


@bp.route("/api/user_dict/delete", methods=["POST"])
def api_delete_user_dict_entry():
    # DISABLED FOR DEPLOYMENT: no per-user accounts.
    return jsonify({"ok": False, "error": "disabled"}), 403
    data = request.get_json(silent=True) or {}
    row_id = data.get("id")
    try:
        row_id = int(row_id)
    except Exception:
        return jsonify({"ok": False, "error": "Invalid entry id."}), 400
    rows = custom_entries_service._read_user_dict_rows(settings_service.TSV_USER_PATH)
    if row_id < 0 or row_id >= len(rows):
        return jsonify({"ok": False, "error": "Entry not found."}), 404
    rows.pop(row_id)
    custom_entries_service._write_user_dict_rows(settings_service.TSV_USER_PATH, rows)
    custom_entries_service._rebuild_user_dict_from_rows(rows)
    return jsonify({"ok": True})


@bp.route("/api/text_override/update", methods=["POST"])
def api_update_text_override():
    # DISABLED FOR DEPLOYMENT: no per-user accounts.
    return jsonify({"ok": False, "error": "disabled"}), 403
    data = request.get_json(silent=True) or {}
    row_id = data.get("id")
    try:
        row_id = int(row_id)
    except Exception:
        return jsonify({"ok": False, "error": "Invalid rule id."}), 400
    rows = custom_entries_service._read_text_override_rows(
        normalization_service.TSV_USER_TEXT_OVERRIDE_PATH
    )
    if row_id < 0 or row_id >= len(rows):
        return jsonify({"ok": False, "error": "Rule not found."}), 404
    raw = (data.get("raw") or "").strip()
    normalized = (data.get("normalized") or "").strip()
    if not raw or not normalized:
        return jsonify({"ok": False, "error": "Raw and normalized are required."}), 400
    if not normalization_service.contains_burmese(normalized):
        return jsonify(
            {"ok": False, "error": "Normalized form must contain Burmese script."}
        ), 400
    rows[row_id] = {"id": row_id, "raw": raw, "normalized": normalized}
    custom_entries_service._write_text_override_rows(
        normalization_service.TSV_USER_TEXT_OVERRIDE_PATH, rows
    )
    custom_entries_service._reload_text_overrides_from_file()
    return jsonify({"ok": True, "raw": raw, "normalized": normalized})


@bp.route("/api/text_override/delete", methods=["POST"])
def api_delete_text_override():
    # DISABLED FOR DEPLOYMENT: no per-user accounts.
    return jsonify({"ok": False, "error": "disabled"}), 403
    data = request.get_json(silent=True) or {}
    row_id = data.get("id")
    try:
        row_id = int(row_id)
    except Exception:
        return jsonify({"ok": False, "error": "Invalid rule id."}), 400
    rows = custom_entries_service._read_text_override_rows(
        normalization_service.TSV_USER_TEXT_OVERRIDE_PATH
    )
    if row_id < 0 or row_id >= len(rows):
        return jsonify({"ok": False, "error": "Rule not found."}), 404
    rows.pop(row_id)
    custom_entries_service._write_text_override_rows(
        normalization_service.TSV_USER_TEXT_OVERRIDE_PATH, rows
    )
    custom_entries_service._reload_text_overrides_from_file()
    return jsonify({"ok": True})
