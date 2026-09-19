#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Endwords (spancat) viewer Flask app.

- Segments text using your app.py pipeline (normalize_burmese_for_segmentation + segment_with_pipeline).
- Runs a spaCy spancat model on the *existing* segments (no re-tokenization).
- Renders bracketed boundary tokens: [token|NOUN] [token|VERB] [token|ADJ] [token|ADV] [token|SENTENCE_END]
- UI includes a model-path input ("address box") so you can switch models without editing code.

Run:
  python pos_compare_app_endwords.py --newserver "C:\path\to\app.py"

Open:
  http://127.0.0.1:5055/
"""

from __future__ import annotations

import argparse
import importlib.util
import threading
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

from flask import Flask, Response, jsonify, request

DEFAULT_MODEL = r"C:\spacy_models\endwords_model\model-best"
DEFAULT_SPANS_KEY = "sc"

# -------- newserver loader --------


def load_newserver(newserver_py: Path):
    if not newserver_py.exists():
        raise FileNotFoundError(f"app.py not found: {newserver_py}")
    spec = importlib.util.spec_from_file_location("newserver_module", str(newserver_py))
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not create import spec for: {newserver_py}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[attr-defined]
    return mod


# -------- spaCy model cache (by path) --------

_NLP_LOCK = threading.Lock()
_NLP_CACHE: Dict[str, object] = {}
_NLP_ERROR: Dict[str, str] = {}


def get_spacy_nlp(model_path: str):
    model_path = (model_path or "").strip()
    if not model_path:
        raise ValueError("Empty model path.")

    if model_path in _NLP_CACHE:
        return _NLP_CACHE[model_path]
    if model_path in _NLP_ERROR:
        raise RuntimeError(_NLP_ERROR[model_path])

    with _NLP_LOCK:
        if model_path in _NLP_CACHE:
            return _NLP_CACHE[model_path]
        if model_path in _NLP_ERROR:
            raise RuntimeError(_NLP_ERROR[model_path])
        try:
            import spacy  # type: ignore

            p = Path(model_path)
            if not p.exists():
                raise FileNotFoundError(f"model path not found: {model_path}")
            nlp = spacy.load(model_path)
            _NLP_CACHE[model_path] = nlp
            print(f"[INFO] Loaded spaCy model: {model_path}")
            return nlp
        except Exception as e:
            _NLP_ERROR[model_path] = str(e)
            raise


# -------- label normalization --------

ALLOWED_OUT = {"NOUN", "VERB", "ADJ", "ADV", "SENTENCE_END"}


def normalize_end_label(raw: str) -> str:
    """
    Your model may emit labels like:
      NOUN_END, VERB_END, ADJ_END, ADV_END, SENT_END, SENTENCE_END, etc.
    We normalize to exactly:
      NOUN, VERB, ADJ, ADV, SENTENCE_END
    """
    s = (raw or "").strip().upper()
    if not s:
        return ""
    if "SENT" in s:
        return "SENTENCE_END"
    if "NOUN" in s:
        return "NOUN"
    if "VERB" in s:
        return "VERB"
    if "ADJ" in s:
        return "ADJ"
    if "ADV" in s:
        return "ADV"
    return ""


# -------- rendering --------


def render_bracketed(segments: List[str], token_labels: List[List[str]], punct_set: set) -> str:
    """
    Renders:
      token -> [token|LABEL] if any normalized label present
    If multiple labels exist, join with '+' (rare, but safe).
    """
    out_parts: List[str] = []
    for i, tok in enumerate(segments):
        labs = token_labels[i] if i < len(token_labels) else []
        labs_norm = [normalize_end_label(x) for x in labs]
        labs_norm = [x for x in labs_norm if x in ALLOWED_OUT]
        labs_norm = sorted(set(labs_norm))

        if labs_norm:
            lab = "+".join(labs_norm)
            out_parts.append(f"[{tok}|{lab}]")
        else:
            out_parts.append(tok)

    # Basic spacing: join by spaces. (Your segmenter already isolates punctuation tokens if desired.)
    return " ".join(out_parts)


# -------- app --------

HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Endwords (spancat) Viewer</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 16px; }
    .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    input[type="text"] { padding: 6px 8px; font-size: 13px; width: min(820px, 100%); }
    input.small { width: 110px; }
    button { padding: 7px 12px; font-size: 13px; cursor: pointer; }
    textarea { width: 100%; height: 220px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; padding: 10px; }
    pre { white-space: pre-wrap; word-break: break-word; padding: 10px; background: #f6f7f9; border: 1px solid #ddd; border-radius: 6px; }
    .meta { margin-top: 10px; font-size: 13px; color: #333; }
    .err { color: #b00020; font-weight: 600; }
    .ok  { color: #0b6; font-weight: 600; }
    .hint { font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="row" style="margin-bottom: 8px;">
    <div class="hint">Model path:</div>
    <input id="modelPath" type="text" value="" />
    <div class="hint">spans key:</div>
    <input id="spansKey" class="small" type="text" value="sc" />
    <button id="runBtn">Analyze</button>
  </div>

  <textarea id="txt" placeholder="Paste Burmese text here..."></textarea>

  <div class="meta" id="meta"></div>
  <pre id="out"></pre>

<script>
function $(id){ return document.getElementById(id); }
function esc(s){
  return (s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

async function run(){
  $("meta").innerHTML = "Running...";
  $("out").textContent = "";

  const text = $("txt").value || "";
  const model_path = ($("modelPath").value || "").trim();
  const spans_key = ($("spansKey").value || "").trim() || "sc";

  const res = await fetch("/api/endwords", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ text, model_path, spans_key })
  });

  const j = await res.json().catch(() => ({}));
  if(!res.ok || !j.ok){
    const msg = j && (j.error || j.message) ? (j.error || j.message) : ("HTTP " + res.status);
    $("meta").innerHTML = "<span class='err'>ERROR:</span> " + esc(msg);
    return;
  }

  const counts = j.label_counts || {};
  const countsStr = Object.keys(counts).sort().map(k => `${k}=${counts[k]}`).join(" | ");
  $("meta").innerHTML =
    "<span class='ok'>OK</span> " +
    `segments=${j.segments_len} | spans_key=${esc(j.spans_key_used)} | ` +
    `model=${esc(j.model_path_used)}<br>` +
    (countsStr ? ("labels: " + esc(countsStr)) : "");

  $("out").textContent = j.bracketed || "";
}

$("runBtn").addEventListener("click", run);

// Fill defaults from server
fetch("/api/defaults").then(r => r.json()).then(j => {
  if(j && j.ok){
    $("modelPath").value = j.default_model_path || "";
    $("spansKey").value = j.default_spans_key || "sc";
  }
}).catch(()=>{});
</script>
</body>
</html>
"""


def build_app(newserver_mod, default_model_path: str, default_spans_key: str) -> Flask:
    app = Flask(__name__)
    app.config["JSON_AS_ASCII"] = False

    if not hasattr(newserver_mod, "normalize_burmese_for_segmentation"):
        raise AttributeError("app.py missing normalize_burmese_for_segmentation()")
    if not hasattr(newserver_mod, "segment_with_pipeline"):
        raise AttributeError("app.py missing segment_with_pipeline()")

    normalize_burmese_for_segmentation = newserver_mod.normalize_burmese_for_segmentation
    segment_with_pipeline = newserver_mod.segment_with_pipeline
    spacy_keep_fn: Optional[Callable[[str], bool]] = getattr(newserver_mod, "_spacy_keep_fn", None)

    punct_set = set()
    if hasattr(newserver_mod, "MYANMAR_PUNCT"):
        try:
            punct_set = set(newserver_mod.MYANMAR_PUNCT)
        except Exception:
            punct_set = set()
    if not punct_set:
        punct_set = {"။", "၊", "!", "?", "；", ";", ":", "၊၊", "။။"}

    @app.get("/")
    def index():
        return Response(HTML, mimetype="text/html; charset=utf-8")

    @app.get("/api/defaults")
    def api_defaults():
        return jsonify(
            {
                "ok": True,
                "default_model_path": default_model_path,
                "default_spans_key": default_spans_key,
            }
        )

    @app.post("/api/endwords")
    def api_endwords():
        payload = request.get_json(silent=True) or {}
        raw = (payload.get("text") or "").strip()
        if not raw:
            return jsonify({"ok": False, "error": "missing text"}), 400

        model_path = (payload.get("model_path") or "").strip() or default_model_path
        spans_key_req = (payload.get("spans_key") or "").strip() or default_spans_key

        # Segment using your pipeline
        extended_hits = set()
        q = normalize_burmese_for_segmentation(raw, extended_hits=extended_hits)
        segments = segment_with_pipeline(q)

        MAX_SEGS = 12000
        if len(segments) > MAX_SEGS:
            segments = segments[:MAX_SEGS]

        # Optionally filter tokens the same way you do elsewhere (if defined)
        # For endwords detection you probably want to keep everything, but respect your keep_fn if present.
        keep_idx: List[int] = []
        toks: List[str] = []
        for i, s in enumerate(segments):
            if spacy_keep_fn is not None and not spacy_keep_fn(s):
                continue
            keep_idx.append(i)
            toks.append(s)

        if not toks:
            return jsonify(
                {
                    "ok": True,
                    "segments_len": len(segments),
                    "segments": segments,
                    "spans_key_used": spans_key_req,
                    "model_path_used": model_path,
                    "spans_keys_present": [],
                    "token_labels": [[] for _ in segments],
                    "label_counts": {},
                    "bracketed": " ".join(segments),
                }
            )

        # Run spaCy on the existing tokenization
        try:
            nlp = get_spacy_nlp(model_path)
        except Exception as e:
            return jsonify({"ok": False, "error": f"Failed to load model: {e}"}), 500

        try:
            from spacy.tokens import Doc  # type: ignore
        except Exception as e:
            return jsonify({"ok": False, "error": f"spaCy not available: {e}"}), 500

        spaces = [True] * (len(toks) - 1) + [False]
        doc = Doc(getattr(nlp, "vocab"), words=toks, spaces=spaces)
        doc = nlp(doc)

        spans_keys_present = sorted(list(getattr(doc, "spans", {}).keys()))

        # If requested spans_key doesn't exist (or is empty), try to auto-pick the first non-empty spans key.
        spans_key_used = spans_key_req
        spans_list = list(doc.spans.get(spans_key_used, [])) if hasattr(doc, "spans") else []
        if (not spans_list) and spans_keys_present:
            for k in spans_keys_present:
                cand = list(doc.spans.get(k, []))
                if cand:
                    spans_key_used = k
                    spans_list = cand
                    break

        # Token labels aligned to full "segments" list
        token_labels: List[List[str]] = [[] for _ in segments]

        # Spans are in doc token indices (0..len(toks)-1); map back to segments via keep_idx
        # Note: handle multi-token spans safely.
        for sp in spans_list:
            lab = getattr(sp, "label_", "") or ""
            for j in range(getattr(sp, "start"), getattr(sp, "end")):
                if 0 <= j < len(keep_idx):
                    seg_i = keep_idx[j]
                    token_labels[seg_i].append(lab)

        # Normalize + count
        label_counts: Dict[str, int] = {}
        for labs in token_labels:
            for lab in labs:
                norm = normalize_end_label(lab)
                if norm in ALLOWED_OUT:
                    label_counts[norm] = label_counts.get(norm, 0) + 1

        bracketed = render_bracketed(segments, token_labels, punct_set)

        return jsonify(
            {
                "ok": True,
                "segments_len": len(segments),
                "segments": segments,
                "model_path_used": model_path,
                "spans_key_requested": spans_key_req,
                "spans_key_used": spans_key_used,
                "spans_keys_present": spans_keys_present,
                "token_labels": token_labels,
                "label_counts": label_counts,
                "bracketed": bracketed,
            }
        )

    @app.get("/health")
    def health():
        return jsonify({"ok": True})

    return app


def main():
    p = argparse.ArgumentParser()
    p.add_argument(
        "--newserver",
        type=str,
        required=True,
        help=r"Path to app.py (e.g. C:\...\app.py)",
    )
    p.add_argument(
        "--model", type=str, default=DEFAULT_MODEL, help="Default spaCy endwords spancat model path"
    )
    p.add_argument(
        "--spans-key",
        type=str,
        default=DEFAULT_SPANS_KEY,
        help="Default doc.spans key for spancat output (often 'sc')",
    )
    p.add_argument("--host", type=str, default="127.0.0.1")
    p.add_argument("--port", type=int, default=5055)
    args = p.parse_args()

    ns = load_newserver(Path(args.newserver))
    app = build_app(ns, args.model, args.spans_key)

    print(f"[INFO] Serving on http://{args.host}:{args.port}/")
    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
