"""Burmese reader: memory."""

from __future__ import annotations

import html
import os
import sys
import threading
import time
import tracemalloc
from collections import deque
from datetime import datetime
from typing import Optional

from flask import (
    Blueprint,
    Response,
    g,
    jsonify,
    request,
)

from . import (
    grammar as grammar_service,
    lexicon as lexicon_service,
    lm_runtime as lm_runtime_service,
    ner as ner_service,
    normalization as normalization_service,
    pos as pos_service,
    srs as srs_service,
    ud as ud_service,
)
from .runtime import feature_state

bp = Blueprint("memory", __name__)


MEM_TRACE_ENABLED = False


MEM_TRACE_PY = False  # set True to track Python alloc peaks via tracemalloc


MEM_TRACE_PATHS = {"/lookup", "/lookup_dp_only"}


def _human_bytes(num: Optional[int]) -> str:
    if num is None:
        return "n/a"
    step = 1024.0
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(num)
    for unit in units:
        if size < step:
            return f"{size:.2f} {unit}"
        size /= step
    return f"{size:.2f} PB"


def _get_process_memory() -> dict:
    # Try psutil if available
    try:
        import psutil  # type: ignore

        p = psutil.Process(os.getpid())
        m = p.memory_info()
        out = {
            "rss_bytes": int(getattr(m, "rss", 0)),
            "vms_bytes": int(getattr(m, "vms", 0)),
        }
        if hasattr(m, "shared"):
            out["shared_bytes"] = int(getattr(m, "shared", 0))
        if hasattr(m, "private"):
            out["private_bytes"] = int(getattr(m, "private", 0))
        return out
    except Exception:
        pass
    # Windows fallback via ctypes
    if os.name == "nt":
        try:
            import ctypes
            import ctypes.wintypes as wintypes

            class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
                _fields_ = [
                    ("cb", wintypes.DWORD),
                    ("PageFaultCount", wintypes.DWORD),
                    ("PeakWorkingSetSize", ctypes.c_size_t),
                    ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t),
                    ("PeakPagefileUsage", ctypes.c_size_t),
                    ("PrivateUsage", ctypes.c_size_t),
                ]

            counters = PROCESS_MEMORY_COUNTERS_EX()
            counters.cb = ctypes.sizeof(counters)
            handle = ctypes.windll.kernel32.GetCurrentProcess()
            if ctypes.windll.psapi.GetProcessMemoryInfo(
                handle, ctypes.byref(counters), counters.cb
            ):
                return {
                    "rss_bytes": int(counters.WorkingSetSize),
                    "rss_peak_bytes": int(counters.PeakWorkingSetSize),
                    "pagefile_bytes": int(counters.PagefileUsage),
                    "pagefile_peak_bytes": int(counters.PeakPagefileUsage),
                    "private_bytes": int(counters.PrivateUsage),
                }
        except Exception:
            pass
    return {}


def _ensure_tracemalloc() -> None:
    if MEM_TRACE_PY and not tracemalloc.is_tracing():
        try:
            tracemalloc.start(25)
        except Exception:
            pass


def _deep_getsizeof(obj, max_items: int = 20000) -> tuple[int, bool, int]:
    seen: set[int] = set()
    truncated = False

    def sizeof(o) -> int:
        nonlocal truncated
        oid = id(o)
        if oid in seen:
            return 0
        seen.add(oid)
        size = sys.getsizeof(o)
        if isinstance(o, dict):
            for idx, (k, v) in enumerate(o.items()):
                if idx >= max_items:
                    truncated = True
                    break
                size += sizeof(k)
                size += sizeof(v)
        elif isinstance(o, (list, tuple, set, frozenset)):
            for idx, item in enumerate(o):
                if idx >= max_items:
                    truncated = True
                    break
                size += sizeof(item)
        elif hasattr(o, "__dict__"):
            size += sizeof(getattr(o, "__dict__", {}))
        return size

    return sizeof(obj), truncated, len(seen)


def _object_summary(
    name: str,
    obj,
    deep: bool = False,
    max_items: int = 20000,
    count: Optional[int] = None,
    note: Optional[str] = None,
) -> dict:
    present = obj is not None
    if count is None:
        try:
            count = len(obj)
        except Exception:
            count = None
    approx_bytes = None
    truncated = False
    if obj is not None:
        if deep:
            try:
                approx_bytes, truncated, _ = _deep_getsizeof(obj, max_items=max_items)
            except Exception:
                approx_bytes = None
        else:
            try:
                approx_bytes = sys.getsizeof(obj)
            except Exception:
                approx_bytes = None
    out = {
        "name": name,
        "present": present,
        "count": count,
        "approx_bytes": approx_bytes,
        "approx_human": _human_bytes(approx_bytes),
        "deep": bool(deep),
        "truncated": bool(truncated),
    }
    if note:
        out["note"] = note
    return out


def _collect_latent_memory(deep: bool = False, max_items: int = 20000) -> list[dict]:
    components: list[dict] = []

    seg = lexicon_service.state.SEGMENTER_INSTANCE
    if seg is not None:
        d = seg.dictionary
        components.append(
            _object_summary(
                "segmenter._all_words", getattr(d, "_all_words", None), deep, max_items
            )
        )
        for lname, layer in d.layers.items():
            components.append(
                _object_summary(
                    f"segmenter.layer.{lname}",
                    layer.entries,
                    deep,
                    max_items,
                    count=len(layer.entries),
                )
            )
    else:
        components.append(
            _object_summary("segmenter", None, note="segmenter not initialized")
        )

    components.append(
        _object_summary(
            "grammar_lexicon", grammar_service.state.GRAMMAR_LEXICON, deep, max_items
        )
    )
    components.append(
        _object_summary(
            "user_text_overrides",
            normalization_service.state.USER_TEXT_OVERRIDES,
            deep,
            max_items,
        )
    )
    components.append(
        _object_summary(
            "manual_text_overrides",
            normalization_service.state.MANUAL_TEXT_OVERRIDES,
            deep,
            max_items,
        )
    )
    components.append(
        _object_summary(
            "dict_pos_lookup", pos_service.state.DICT_POS_LOOKUP, deep, max_items
        )
    )

    if srs_service.state.READING_SRS is not None:
        srs_count = (
            len(srs_service.state.READING_SRS.cards)
            if getattr(srs_service.state.READING_SRS, "_loaded", False)
            else 0
        )
        components.append(
            _object_summary(
                "reading_srs.cards",
                srs_service.state.READING_SRS.cards,
                deep,
                max_items,
                count=srs_count,
            )
        )
    else:
        components.append(_object_summary("reading_srs", None))

    components.append(
        _object_summary(
            "stanza_ner",
            ner_service.state.STANZA_NER,
            deep=False,
            note="pipeline object"
            if ner_service.state.STANZA_NER is not None
            else None,
        )
    )
    components.append(
        _object_summary(
            "ud_parser",
            ud_service.state.UD_PARSER,
            deep=False,
            note="pipeline object" if ud_service.state.UD_PARSER is not None else None,
        )
    )
    components.append(
        _object_summary(
            "pos_tagger",
            pos_service.state.POS_TAGGER,
            deep=False,
            note="pipeline object"
            if pos_service.state.POS_TAGGER is not None
            else None,
        )
    )

    # LM brain tables (if loaded)
    try:
        import lmbrain  # type: ignore

        components.append(
            _object_summary(
                "lmbrain.unigram_cost",
                getattr(lmbrain, "UNIGRAM_COST", None),
                deep,
                max_items,
            )
        )
        components.append(
            _object_summary(
                "lmbrain.bigram_cost",
                getattr(lmbrain, "BIGRAM_COST", None),
                deep,
                max_items,
            )
        )
    except Exception:
        components.append(_object_summary("lmbrain", None, note="lmbrain not loaded"))

    # AdvancedSegmenter internals (BK-tree / caches)
    adv = lm_runtime_service.state.ADVANCED_SEGMENTER
    if adv is not None:
        components.append(
            _object_summary(
                "advsegmenter.bk_tree", getattr(adv, "_bk_tree", None), deep, max_items
            )
        )
        components.append(
            _object_summary(
                "advsegmenter.spell_morph_cache",
                getattr(adv, "_spell_morph_cache", None),
                deep,
                max_items,
            )
        )
        components.append(
            _object_summary(
                "advsegmenter.spell_vocab_size",
                getattr(adv, "_spell_vocab_size", None),
                deep=False,
            )
        )
    else:
        components.append(
            _object_summary(
                "advsegmenter", None, note="advanced segmenter not initialized"
            )
        )

    return components


def _mem_trace_start(
    path: str, query_len: Optional[int] = None, lite: Optional[bool] = None
) -> Optional[dict]:
    if not MEM_TRACE_ENABLED:
        return None
    _ensure_tracemalloc()
    ctx = {
        "ts": datetime.utcnow().isoformat() + "Z",
        "path": path,
        "query_len": query_len,
        "lite": lite,
        "t0": time.perf_counter(),
        "mem_before": _get_process_memory(),
    }
    if MEM_TRACE_PY and tracemalloc.is_tracing():
        cur, peak = tracemalloc.get_traced_memory()
        ctx["py_before"] = {"current": cur, "peak": peak}
    return ctx


def _mem_trace_end(ctx: Optional[dict], status_code: Optional[int] = None) -> None:
    if not ctx:
        return
    t1 = time.perf_counter()
    mem_after = _get_process_memory()
    entry = {
        "ts": ctx.get("ts"),
        "path": ctx.get("path"),
        "query_len": ctx.get("query_len"),
        "lite": ctx.get("lite"),
        "duration_ms": round((t1 - ctx.get("t0", t1)) * 1000.0, 3),
        "status_code": status_code,
        "mem_before": ctx.get("mem_before", {}),
        "mem_after": mem_after,
    }
    try:
        rss_before = ctx.get("mem_before", {}).get("rss_bytes")
        rss_after = mem_after.get("rss_bytes")
        if rss_before is not None and rss_after is not None:
            entry["rss_delta_bytes"] = int(rss_after) - int(rss_before)
    except Exception:
        pass
    if MEM_TRACE_PY and tracemalloc.is_tracing():
        cur_after, peak_after = tracemalloc.get_traced_memory()
        py_before = ctx.get("py_before") or {}
        cur_before = py_before.get("current")
        peak_before = py_before.get("peak")
        entry["py_after"] = {"current": cur_after, "peak": peak_after}
        if cur_before is not None:
            entry["py_current_delta"] = cur_after - cur_before
        if peak_before is not None:
            entry["py_peak_delta"] = peak_after - peak_before
    with state._MEM_TRACE_LOCK:
        state.MEM_SPIKE_LOG.append(entry)


def _mem_trace_before_request():
    if request.path not in MEM_TRACE_PATHS:
        return None
    q = request.args.get("q") or ""
    lite = str(request.args.get("lite") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    g._mem_trace_ctx = _mem_trace_start(request.path, query_len=len(q), lite=lite)
    return None


def _mem_trace_after_request(response):
    ctx = getattr(g, "_mem_trace_ctx", None)
    if ctx is not None:
        _mem_trace_end(ctx, status_code=response.status_code)
    return response


def _build_memory_snapshot(deep: bool, max_items: int) -> tuple[dict, dict, list[dict]]:
    proc = _get_process_memory()
    components = _collect_latent_memory(deep=deep, max_items=max_items)
    approx_total = 0
    for c in components:
        if isinstance(c.get("approx_bytes"), int):
            approx_total += int(c["approx_bytes"])
    py_cur = None
    py_peak = None
    if MEM_TRACE_PY and tracemalloc.is_tracing():
        py_cur, py_peak = tracemalloc.get_traced_memory()

    snapshot = {
        "ok": True,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "process": proc,
        "process_human": {k: _human_bytes(v) for k, v in proc.items()},
        "python": {
            "tracemalloc_enabled": bool(MEM_TRACE_PY and tracemalloc.is_tracing()),
            "current_bytes": py_cur,
            "peak_bytes": py_peak,
            "current_human": _human_bytes(py_cur),
            "peak_human": _human_bytes(py_peak),
        },
        "latent": {
            "components": components,
            "approx_total_bytes": approx_total,
            "approx_total_human": _human_bytes(approx_total),
            "note": "component sizes are approximate; totals won't match RSS",
        },
        "spikes": {
            "enabled": bool(MEM_TRACE_ENABLED),
            "count": len(state.MEM_SPIKE_LOG),
            "entries": list(state.MEM_SPIKE_LOG),
        },
    }
    return snapshot, proc, components


def _render_memory_html(
    proc: dict, components: list[dict], spikes: list[dict]
) -> Response:
    rows = []
    rows.append("<table border='1' cellpadding='6' cellspacing='0'>")
    rows.append(
        "<tr><th>Component</th><th>Count</th><th>Approx Size</th><th>Note</th></tr>"
    )
    for c in components:
        rows.append(
            "<tr>"
            f"<td>{html.escape(str(c.get('name')))}</td>"
            f"<td>{html.escape(str(c.get('count')))}</td>"
            f"<td>{html.escape(str(c.get('approx_human')))}</td>"
            f"<td>{html.escape(str(c.get('note') or ''))}</td>"
            "</tr>"
        )
    rows.append("</table>")

    spike_rows = []
    spike_rows.append("<table border='1' cellpadding='6' cellspacing='0'>")
    spike_rows.append(
        "<tr><th>Time</th><th>Path</th><th>Duration (ms)</th><th>RSS Δ</th><th>RSS Before</th><th>RSS After</th></tr>"
    )
    for e in spikes:
        rss_delta = e.get("rss_delta_bytes")
        rss_before = (e.get("mem_before") or {}).get("rss_bytes")
        rss_after = (e.get("mem_after") or {}).get("rss_bytes")
        spike_rows.append(
            "<tr>"
            f"<td>{html.escape(str(e.get('ts') or ''))}</td>"
            f"<td>{html.escape(str(e.get('path') or ''))}</td>"
            f"<td>{html.escape(str(e.get('duration_ms') or ''))}</td>"
            f"<td>{html.escape(_human_bytes(rss_delta) if isinstance(rss_delta, int) else 'n/a')}</td>"
            f"<td>{html.escape(_human_bytes(rss_before) if isinstance(rss_before, int) else 'n/a')}</td>"
            f"<td>{html.escape(_human_bytes(rss_after) if isinstance(rss_after, int) else 'n/a')}</td>"
            "</tr>"
        )
    spike_rows.append("</table>")

    header = (
        "<h2>Process Memory</h2>"
        f"<p>RSS: {html.escape(_human_bytes(proc.get('rss_bytes')))}"
        f" &nbsp; Private: {html.escape(_human_bytes(proc.get('private_bytes')))}</p>"
        "<h2>Latent Memory Components</h2>"
    )
    spike_header = "<h2>Lookup Memory Spikes</h2>"
    body = header + "\n".join(rows) + spike_header + "\n".join(spike_rows)
    return Response(body, mimetype="text/html; charset=utf-8")


@bp.route("/debug/memory", methods=["GET"])
def debug_memory():
    """
    Debug endpoint returning both latent memory summary and per-lookup spike log.
    Query params:
      - enable=1/0 to toggle spike logging
      - py=1/0 to toggle Python tracemalloc tracking
      - deep=1 to compute deep (slower) size estimates
      - max_items=INT to cap deep traversal
      - format=html for a simple table
    """
    global MEM_TRACE_ENABLED, MEM_TRACE_PY
    enable_raw = str(request.args.get("enable") or "").strip().lower()
    if enable_raw in {"1", "true", "yes", "on"}:
        MEM_TRACE_ENABLED = True
    elif enable_raw in {"0", "false", "no", "off"}:
        MEM_TRACE_ENABLED = False
    py_raw = str(request.args.get("py") or "").strip().lower()
    if py_raw in {"1", "true", "yes", "on"}:
        MEM_TRACE_PY = True
        _ensure_tracemalloc()
    elif py_raw in {"0", "false", "no", "off"}:
        MEM_TRACE_PY = False

    deep = str(request.args.get("deep") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    try:
        max_items = int(request.args.get("max_items") or "20000")
    except Exception:
        max_items = 20000

    snapshot, proc, components = _build_memory_snapshot(deep=deep, max_items=max_items)

    fmt = str(request.args.get("format") or "").strip().lower()
    if fmt == "html":
        return _render_memory_html(proc, components, snapshot["spikes"]["entries"])
    return jsonify(snapshot)


@bp.route("/debug/memory_ui", methods=["GET"])
def debug_memory_ui():
    """
    HTML view for memory diagnostics (same data as /debug/memory).
    """
    global MEM_TRACE_ENABLED, MEM_TRACE_PY
    enable_raw = str(request.args.get("enable") or "").strip().lower()
    if enable_raw in {"1", "true", "yes", "on"}:
        MEM_TRACE_ENABLED = True
    elif enable_raw in {"0", "false", "no", "off"}:
        MEM_TRACE_ENABLED = False
    py_raw = str(request.args.get("py") or "").strip().lower()
    if py_raw in {"1", "true", "yes", "on"}:
        MEM_TRACE_PY = True
        _ensure_tracemalloc()
    elif py_raw in {"0", "false", "no", "off"}:
        MEM_TRACE_PY = False

    deep = str(request.args.get("deep") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    try:
        max_items = int(request.args.get("max_items") or "20000")
    except Exception:
        max_items = 20000

    snapshot, proc, components = _build_memory_snapshot(deep=deep, max_items=max_items)
    return _render_memory_html(proc, components, snapshot["spikes"]["entries"])


def _new_state():
    from types import SimpleNamespace

    return SimpleNamespace(
        MEM_SPIKE_LOG=deque(maxlen=200),
        _MEM_TRACE_LOCK=threading.Lock(),
    )


state = feature_state("memory", _new_state)
