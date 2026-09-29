"""Burmese reader: pdf cache."""

from __future__ import annotations

import tempfile
import threading
import time
import uuid as _uuid
from pathlib import Path

from flask import (
    Blueprint,
    jsonify,
    request,
    send_file,
)

from .runtime import feature_state

bp = Blueprint("pdf_cache", __name__)


_PDF_CACHE_TTL = 1800  # 30 minutes in seconds


def _cleanup_stale_pdf_cache() -> None:
    """Remove cached PDFs that haven't been accessed in _PDF_CACHE_TTL seconds."""
    now = time.time()
    with state._PDF_CACHE_LOCK:
        for cid in list(state._PDF_CACHE.keys()):
            entry = state._PDF_CACHE[cid]
            last_touch = entry.get("accessed", entry.get("created", 0))
            if now - last_touch > _PDF_CACHE_TTL:
                state._PDF_CACHE.pop(cid, None)
                if entry.get("path"):
                    try:
                        Path(entry["path"]).unlink(missing_ok=True)
                    except Exception:
                        pass


def _evict_cached_pdf(cache_id: str) -> None:
    """Remove a single cached PDF by its cache_id."""
    with state._PDF_CACHE_LOCK:
        entry = state._PDF_CACHE.pop(cache_id, None)
    if entry and entry.get("path"):
        try:
            Path(entry["path"]).unlink(missing_ok=True)
        except Exception:
            pass


def _cache_pdf_to_disk(data: bytes) -> str:
    """Write PDF bytes to a temp file, return a cache_id."""
    cache_id = str(_uuid.uuid4())
    tmp = tempfile.NamedTemporaryFile(
        delete=False, suffix=".pdf", prefix="burmese_cache_"
    )
    tmp.write(data)
    tmp.close()
    _cleanup_stale_pdf_cache()  # Only remove PDFs older than 30 min
    now = time.time()
    with state._PDF_CACHE_LOCK:
        state._PDF_CACHE[cache_id] = {"path": tmp.name, "created": now, "accessed": now}
    return cache_id


def _get_cached_pdf_path(cache_id: str) -> str | None:
    """Return the file path for a cached PDF, or None. Updates access time."""
    with state._PDF_CACHE_LOCK:
        entry = state._PDF_CACHE.get(cache_id)
        if entry:
            entry["accessed"] = time.time()
    if entry and entry.get("path") and Path(entry["path"]).exists():
        return entry["path"]
    return None


@bp.route("/api/close_pdf", methods=["POST"])
def api_close_pdf():
    """Evict a single cached PDF when the user closes it."""
    jdata = request.get_json(silent=True) or {}
    cache_id = jdata.get("cache_id", "").strip()
    if not cache_id:
        return jsonify({"ok": False, "error": "missing cache_id"}), 400
    _evict_cached_pdf(cache_id)
    return jsonify({"ok": True})


@bp.route("/api/serve_pdf/<cache_id>", methods=["GET"])
def api_serve_pdf(cache_id):
    """Serve a cached PDF file for PDF.js to render in the browser."""
    cache_id = (cache_id or "").strip()
    if not cache_id:
        return jsonify({"ok": False, "error": "missing cache_id"}), 400
    pdf_path = _get_cached_pdf_path(cache_id)
    if not pdf_path:
        return jsonify({"ok": False, "error": "cache_expired"}), 410
    return send_file(pdf_path, mimetype="application/pdf")


def _new_state():
    from types import SimpleNamespace

    return SimpleNamespace(
        _PDF_CACHE_LOCK=threading.Lock(),
        _PDF_CACHE={},
    )


state = feature_state("pdf_cache", _new_state)
