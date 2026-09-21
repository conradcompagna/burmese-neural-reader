"""Burmese reader: debug assets."""

from __future__ import annotations

import threading

from flask import (
    Blueprint,
    Response,
    jsonify,
)

from . import settings as settings_service
from .runtime import feature_state

bp = Blueprint("debug_assets", __name__)


WHITESPACE_BOUNDARY_JS_PATH = settings_service.APP_ROOT.joinpath(
    "whitespace_boundaries.js"
)


MYUDTREE_CONLLU_PATH = (
    settings_service.APP_ROOT.joinpath("randomdata") / "myUDTree_ver1.0.conllu.pred"
)


def _build_myudtree_index():
    if not MYUDTREE_CONLLU_PATH.exists():
        return None
    offsets = []
    start = None
    pos = 0
    with MYUDTREE_CONLLU_PATH.open("rb") as f:
        for line in f:
            if line.strip():
                if start is None:
                    start = pos
            else:
                if start is not None:
                    offsets.append((start, pos))
                    start = None
            pos += len(line)
    if start is not None:
        offsets.append((start, pos))
    return offsets


def _get_myudtree_index():
    if state._MYUDTREE_INDEX is not None:
        return state._MYUDTREE_INDEX
    with state._MYUDTREE_INDEX_LOCK:
        if state._MYUDTREE_INDEX is None:
            state._MYUDTREE_INDEX = _build_myudtree_index()
    return state._MYUDTREE_INDEX


@bp.route("/whitespace_boundaries.js", methods=["GET"])
def whitespace_boundaries_js():
    try:
        js = WHITESPACE_BOUNDARY_JS_PATH.read_text(encoding="utf-8")
    except Exception:
        js = "// whitespace_boundaries.js not found"
    return Response(js, mimetype="application/javascript; charset=utf-8")


@bp.route("/myudtree.conllu", methods=["GET"])
def myudtree_conllu():
    """DISABLED FOR DEPLOYMENT: File-based UD tree disabled - use live mode only."""
    return Response("", mimetype="text/plain; charset=utf-8")


@bp.route("/myudtree.meta", methods=["GET"])
def myudtree_meta():
    """DISABLED FOR DEPLOYMENT: File-based UD tree disabled - use live mode only."""
    return jsonify({"ok": True, "total": 0})


@bp.route("/myudtree.sentence", methods=["GET"])
def myudtree_sentence():
    """DISABLED FOR DEPLOYMENT: File-based UD tree disabled - use live mode only."""
    return Response("", mimetype="text/plain; charset=utf-8")


def _new_state():
    from types import SimpleNamespace

    return SimpleNamespace(
        _MYUDTREE_INDEX=None,
        _MYUDTREE_INDEX_LOCK=threading.Lock(),
    )


state = feature_state("debug_assets", _new_state)
