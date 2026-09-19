from __future__ import annotations

import json
import os
import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import spacy
from flask import Flask, Response, jsonify, render_template_string, request
from spacy.tokens import Doc

import newserver as ns


MODEL_PATH = os.environ.get("SPACY_MODEL_PATH", r"C:\spacy_models\burmese_boundary_bilu_v2\model-best")
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "5002"))

_RUN_RE = re.compile(r"\s+|\S+")
MODE_NEURAL = "neural"
MODE_DICT_THEN_NEURAL = "dict_then_neural"
MODE_NEURAL_THEN_DICT = "neural_then_dict"
MODE_NEURAL_THEN_DICT_GREEDY = "neural_then_dict_greedy"
MODES = (MODE_NEURAL, MODE_DICT_THEN_NEURAL, MODE_NEURAL_THEN_DICT, MODE_NEURAL_THEN_DICT_GREEDY)


@dataclass(frozen=True)
class ModelInfo:
    ok: bool
    path: str
    pipe_names: list[str]
    error: str


def _load_model(model_path: str) -> tuple[Optional[Any], ModelInfo]:
    try:
        nlp = spacy.load(model_path)
    except Exception as e:  # noqa: BLE001
        return None, ModelInfo(ok=False, path=model_path, pipe_names=[], error=f"{type(e).__name__}: {e}")
    return nlp, ModelInfo(ok=True, path=model_path, pipe_names=list(nlp.pipe_names), error="")


NLP, MODEL = _load_model(MODEL_PATH)


NEWSERVER_LOADED = False
NEWSERVER_ERROR = ""


def _ensure_newserver_resources_loaded() -> None:
    """
    Ensure the dictionaries + LM-backed segmenter are initialized the same way as
    when running `newserver.py` as the web server.
    """
    global NEWSERVER_LOADED, NEWSERVER_ERROR
    if NEWSERVER_LOADED or NEWSERVER_ERROR:
        return
    try:
        # Loads legacy dict sources into `newserver.DICT`, then pushes them into the embedded segmenter.
        ns.load_dictionary()

        # Mirror server startup: grammar TSV is loaded separately.
        try:
            ns.load_grammar_lexicon_tsv(ns.TSV_GRAMMAR_PATH)
            ns.inject_grammar_heads_into_dict()
        except Exception:
            pass

        NEWSERVER_LOADED = True
    except Exception as e:  # noqa: BLE001
        NEWSERVER_ERROR = f"{type(e).__name__}: {e}"


def _clusters_for_chunk(text: str) -> list[str]:
    clusters, _starts = ns._build_grapheme_clusters(text)  # noqa: SLF001
    return [c for c in clusters if c and not c.isspace()]


def _predict_bilu(nlp: Any, clusters: list[str]) -> list[str]:
    if not clusters:
        return []
    spaces = [False] * len(clusters)
    doc = Doc(nlp.vocab, words=clusters, spaces=spaces)
    doc = nlp(doc)
    return [t.tag_ for t in doc]


def _bilu_merge(clusters: list[str], tags: list[str]) -> list[str]:
    out: list[str] = []
    cur: list[str] = []

    def flush() -> None:
        nonlocal cur
        if cur:
            out.append("".join(cur))
            cur = []

    for c, t in zip(clusters, tags):
        if t == "U":
            flush()
            out.append(c)
            continue
        if t == "B":
            flush()
            cur = [c]
            continue
        if t == "I":
            if not cur:
                cur = [c]
            else:
                cur.append(c)
            continue
        if t == "L":
            if not cur:
                out.append(c)
            else:
                cur.append(c)
                flush()
            continue

        # Unknown tag: treat as its own token.
        flush()
        out.append(c)

    flush()
    return out


def _bilu_segment_to_tokens(text: str) -> tuple[list[str], list[str], list[str], list[list[str]]]:
    clusters = _clusters_for_chunk(text)
    if MODEL.ok and NLP is not None:
        tags = _predict_bilu(NLP, clusters)
    else:
        tags = []
    if len(tags) != len(clusters):
        tags = ["U"] * len(clusters)
    tokens = _bilu_merge(clusters, tags)
    pairs = [[c, t] for c, t in zip(clusters, tags)]
    return clusters, tags, tokens, pairs


def _is_myanmar_letter(ch: str) -> bool:
    cp = ord(ch)
    if not (ns._is_myanmar_core(cp) or ns._is_myanmar_extended(cp)):  # noqa: SLF001
        return False
    if ch in ns.MYANMAR_PUNCT:
        return False
    return True


def _segment_newserver_with_info(run_text: str) -> list[dict[str, Any]]:
    """
    Segment a no-whitespace "island" using newserver's dictionary+LM segmenter,
    while preserving punctuation/symbols as their own tokens so output is readable.
    """
    seg_items: list[dict[str, Any]] = []
    current: list[str] = []

    def flush() -> None:
        nonlocal current, seg_items
        if not current:
            return
        island = "".join(current)
        current = []
        for it in ns.segmenter_segment_with_info(island):
            seg_items.append(
                {
                    "text": it.get("text", ""),
                    "in_dict": bool(it.get("in_dict")),
                    "in_lm": bool(it.get("in_lm")),
                    "cost": it.get("cost"),
                }
            )

    for ch in run_text or "":
        if _is_myanmar_letter(ch):
            current.append(ch)
            continue

        flush()
        seg_items.append(
            {
                "text": ch,
                "kind": "punct" if ch in ns.MYANMAR_PUNCT else "sym",
                "in_dict": True,  # treat punctuation/symbols as fixed boundaries
            }
        )

    flush()
    return seg_items


def _boundaries_from_tokens(tokens: list[str]) -> set[int]:
    pos = 0
    bounds = {0}
    for t in tokens:
        pos += len(t)
        bounds.add(pos)
    return bounds


def _forced_boundaries(text: str) -> set[int]:
    """
    Force boundaries around punctuation/symbol characters so they don't get merged
    into word tokens even if a segmenter predicts it.
    """
    bounds = {0, len(text)}
    for i, ch in enumerate(text):
        if ch in ns.MYANMAR_PUNCT:
            bounds.add(i)
            bounds.add(i + 1)
            continue
        cat0 = unicodedata.category(ch)[:1]
        if cat0 in {"P", "S"}:
            bounds.add(i)
            bounds.add(i + 1)
    return bounds


def _merge_longer_wins(run_text: str, dict_tokens: list[str], neural_tokens: list[str]) -> list[str]:
    """
    Combine dictionary segmentation + neural segmentation by keeping a boundary only
    where BOTH segmenters agree on it. If either segmenter merges across a boundary,
    the longer token "wins" and the boundary is dropped.

    Punctuation/symbol boundaries are forced (always kept).
    """
    dict_bounds = _boundaries_from_tokens(dict_tokens)
    neural_bounds = _boundaries_from_tokens(neural_tokens)

    if dict_bounds and max(dict_bounds) != len(run_text):
        # Fallback: if dict segmentation didn't cover the run, ignore it for merging.
        dict_bounds = {0, len(run_text)}
    if neural_bounds and max(neural_bounds) != len(run_text):
        neural_bounds = {0, len(run_text)}

    bounds = (dict_bounds & neural_bounds) | _forced_boundaries(run_text)
    bounds = {b for b in bounds if 0 <= b <= len(run_text)}
    sorted_bounds = sorted(bounds)

    merged: list[str] = []
    for s, e in zip(sorted_bounds, sorted_bounds[1:]):
        if s >= e:
            continue
        merged.append(run_text[s:e])
    return merged


def _merge_neural_then_dict(run_text: str, seg_items: list[dict[str, Any]], neural_tokens: list[str]) -> list[str]:
    """
    Start from the neural segmentation, then allow the dictionary segmenter to MERGE
    adjacent neural tokens when it proposes a larger dictionary word that aligns to
    existing neural boundaries.

    This mode never introduces new splits: it only removes (non-forced) boundaries.
    Punctuation/symbol boundaries are always forced.
    """
    forced = _forced_boundaries(run_text)
    neural_bounds = _boundaries_from_tokens(neural_tokens)

    if neural_bounds and max(neural_bounds) != len(run_text):
        neural_bounds = {0, len(run_text)}

    bounds = {b for b in (neural_bounds | forced) if 0 <= b <= len(run_text)}

    pos = 0
    for it in seg_items:
        t = it.get("text", "")
        if not t:
            continue
        start = pos
        end = pos + len(t)
        pos = end

        # Only use true dictionary entries for merges (not LM-only chunks, not punctuation).
        if not it.get("in_dict"):
            continue
        if it.get("kind") in {"punct", "sym"}:
            continue

        # Can only merge if the dict span aligns to the current boundary set.
        if start not in bounds or end not in bounds:
            continue

        # Never merge across forced boundaries (shouldn't happen, but be safe).
        if any(start < b < end for b in forced):
            continue

        internal = {b for b in bounds if start < b < end and b not in forced}
        if internal:
            bounds -= internal

    sorted_bounds = sorted(b for b in bounds if 0 <= b <= len(run_text))
    merged: list[str] = []
    for s, e in zip(sorted_bounds, sorted_bounds[1:]):
        if s >= e:
            continue
        merged.append(run_text[s:e])
    return merged


def _merge_neural_then_dict_greedy(run_text: str, neural_tokens: list[str]) -> list[str]:
    """
    Greedy dictionary merge pass over the neural segmentation.

    - Starts from the neural boundaries.
    - Splits out punctuation/symbols via forced boundaries.
    - Then does maximum-munch merges using *dictionary membership only* (no LM/DP).
    - Never introduces new splits; only merges adjacent pieces.
    """

    def _is_mergeable_piece(piece: str) -> bool:
        if not piece:
            return False
        for ch in piece:
            if ch in ns.MYANMAR_PUNCT:
                return False
            if unicodedata.category(ch)[:1] in {"P", "S"}:
                return False
            cp = ord(ch)
            if not (0x1000 <= cp <= 0x109F):
                return False
        return True

    def _in_dict(candidate: str) -> bool:
        if not candidate:
            return False
        # Prevent accidental matches where normalize_headword drops non-Myanmar.
        for ch in candidate:
            cp = ord(ch)
            if not (0x1000 <= cp <= 0x109F):
                return False
        norm = ns.normalize_headword(candidate)
        if not norm:
            return False
        return bool(ns.DICT.get(norm))

    forced = _forced_boundaries(run_text)
    neural_bounds = _boundaries_from_tokens(neural_tokens)
    if neural_bounds and max(neural_bounds) != len(run_text):
        neural_bounds = {0, len(run_text)}

    bounds = {b for b in (neural_bounds | forced) if 0 <= b <= len(run_text)}
    sorted_bounds = sorted(bounds)

    pieces: list[str] = []
    for s, e in zip(sorted_bounds, sorted_bounds[1:]):
        if s >= e:
            continue
        pieces.append(run_text[s:e])

    out: list[str] = []
    i = 0
    max_join = 16
    n = len(pieces)
    while i < n:
        if not _is_mergeable_piece(pieces[i]):
            out.append(pieces[i])
            i += 1
            continue

        best_end: Optional[int] = None
        best_text: Optional[str] = None
        cand = pieces[i]
        j = i + 1
        while j < n and (j - i) < max_join:
            nxt = pieces[j]
            if not _is_mergeable_piece(nxt):
                break
            cand = cand + nxt
            if _in_dict(cand):
                best_end = j + 1
                best_text = cand
            j += 1

        if best_end is not None and best_text is not None:
            out.append(best_text)
            i = best_end
            continue

        out.append(pieces[i])
        i += 1

    return out


def analyze_text(text: str, mode: str = MODE_NEURAL) -> dict[str, Any]:
    runs: list[dict[str, Any]] = []
    pairs: list[list[str]] = []
    token_count = 0
    cluster_count = 0

    mode = (mode or MODE_NEURAL).strip().lower()
    if mode not in MODES:
        mode = MODE_NEURAL

    for m in _RUN_RE.finditer(text or ""):
        run_text = m.group(0)
        if not run_text:
            continue
        if run_text.isspace():
            runs.append({"type": "ws", "text": run_text})
            continue

        if mode == MODE_NEURAL:
            clusters, tags, tokens, run_pairs = _bilu_segment_to_tokens(run_text)
            cluster_count += len(clusters)
            token_count += len(tokens)
            runs.append({"type": "chunk", "raw": run_text, "clusters": clusters, "tags": tags, "tokens": tokens})
            pairs.extend(run_pairs)
            continue

        # Hybrid modes that consult newserver's dictionary segmenter.
        _ensure_newserver_resources_loaded()
        if not NEWSERVER_LOADED:
            # Hard fallback: if newserver resources didn't load, still show neural-only output.
            clusters, tags, neural_tokens, run_pairs = _bilu_segment_to_tokens(run_text)
            cluster_count += len(clusters)
            token_count += len(neural_tokens)
            runs.append(
                {
                    "type": "chunk",
                    "raw": run_text,
                    "clusters": clusters,
                    "tags": tags,
                    "tokens": neural_tokens,
                    "dict_tokens": [],
                    "neural_tokens": neural_tokens,
                    "newserver_error": NEWSERVER_ERROR,
                }
            )
            pairs.extend(run_pairs)
            continue

        clusters, tags, neural_tokens, run_pairs = _bilu_segment_to_tokens(run_text)
        dict_tokens: list[str] = []
        if mode == MODE_NEURAL_THEN_DICT_GREEDY:
            merged_tokens = _merge_neural_then_dict_greedy(run_text, neural_tokens)
        else:
            seg_items = _segment_newserver_with_info(run_text)
            dict_tokens = [it.get("text", "") for it in seg_items if it.get("text")]
            if mode == MODE_DICT_THEN_NEURAL:
                merged_tokens = _merge_longer_wins(run_text, dict_tokens, neural_tokens)
            else:
                merged_tokens = _merge_neural_then_dict(run_text, seg_items, neural_tokens)

        cluster_count += len(clusters)
        token_count += len(merged_tokens)
        runs.append(
            {
                "type": "chunk",
                "raw": run_text,
                "tokens": merged_tokens,
                "dict_tokens": dict_tokens,
                "neural_tokens": neural_tokens,
                "clusters": clusters,
                "tags": tags,
            }
        )
        pairs.extend(run_pairs)

    tokenized_text = "".join(r["text"] if r["type"] == "ws" else " ".join(r["tokens"]) for r in runs)
    dict_tokenized_text: Optional[str] = None
    neural_tokenized_text: Optional[str] = None
    if mode in {MODE_DICT_THEN_NEURAL, MODE_NEURAL_THEN_DICT}:
        dict_tokenized_text = "".join(
            r["text"] if r["type"] == "ws" else " ".join(r.get("dict_tokens") or []) for r in runs
        )
    if mode in {MODE_DICT_THEN_NEURAL, MODE_NEURAL_THEN_DICT, MODE_NEURAL_THEN_DICT_GREEDY}:
        neural_tokenized_text = "".join(
            r["text"] if r["type"] == "ws" else " ".join(r.get("neural_tokens") or []) for r in runs
        )

    return {
        "ok": True,
        "mode": mode,
        "model": {
            "ok": MODEL.ok,
            "path": MODEL.path,
            "pipe_names": MODEL.pipe_names,
            "error": MODEL.error,
        },
        "newserver": {
            "loaded": NEWSERVER_LOADED,
            "error": NEWSERVER_ERROR,
        },
        "input": text,
        "stats": {"clusters": cluster_count, "tokens": token_count},
        "pairs": pairs,  # training-like: [cluster, B/I/L/U]
        "runs": runs,  # whitespace-preserving
        "tokenized": tokenized_text,
        "dict_tokenized": dict_tokenized_text,
        "neural_tokenized": neural_tokenized_text,
    }


_PAGE_TMPL = r"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BILU Tokenizer Debug</title>
    <style>
      :root { color-scheme: light dark; }
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 20px; }
      textarea { width: 100%; min-height: 180px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      pre { white-space: pre-wrap; word-break: break-word; }
      .row { display: grid; grid-template-columns: 1fr; gap: 14px; }
      .meta { font-size: 0.95rem; opacity: 0.9; }
      .bad { color: #b00020; }
      .ok { color: #0b6; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border-bottom: 1px solid rgba(127,127,127,.35); padding: 6px 8px; vertical-align: top; }
      th { text-align: left; position: sticky; top: 0; background: Canvas; }
      .small { font-size: 0.92rem; }
      .scroll { max-height: 55vh; overflow: auto; border: 1px solid rgba(127,127,127,.35); border-radius: 8px; }
      .btns { display: flex; gap: 10px; flex-wrap: wrap; }
      button { padding: 8px 12px; }
      a { color: inherit; }
    </style>
  </head>
  <body>
    <h1>BILU Tokenizer Debug</h1>
    <div class="meta">
      <div>Model: <code>{{ model.path }}</code></div>
      {% if model.ok %}
        <div class="ok">Loaded. Pipes: <code>{{ model.pipe_names|join(", ") }}</code></div>
      {% else %}
        <div class="bad">Failed to load: <code>{{ model.error }}</code></div>
      {% endif %}
    </div>

    <form method="get" action="{{ url_for('debug_bilu') }}">
      <div class="row">
        <div>
          <label for="q">Text</label>
          <textarea id="q" name="q" spellcheck="false">{{ q }}</textarea>
        </div>
        <div class="meta">
          <label for="mode">Mode</label>
          <select id="mode" name="mode">
            <option value="neural" {% if mode == "neural" %}selected{% endif %}>Neural only</option>
            <option value="dict_then_neural" {% if mode == "dict_then_neural" %}selected{% endif %}>Dict + neural (longer wins)</option>
            <option value="neural_then_dict" {% if mode == "neural_then_dict" %}selected{% endif %}>Neural → dict merge (DP, merges only)</option>
            <option value="neural_then_dict_greedy" {% if mode == "neural_then_dict_greedy" %}selected{% endif %}>Neural → dict merge (greedy, no LM)</option>
          </select>
          <div>
            newserver:
            {% if newserver.loaded %}<span class="ok">loaded</span>{% else %}<span class="bad">not loaded</span>{% endif %}
            {% if newserver.error %}<span class="bad"> - {{ newserver.error }}</span>{% endif %}
          </div>
        </div>
        <div class="btns">
          <button type="submit">Analyze</button>
          <a href="{{ url_for('debug_bilu') }}">Clear</a>
          {% if q %}
            <a href="{{ url_for('api_bilu') }}?q={{ q|urlencode }}&mode={{ mode }}">JSON</a>
          {% endif %}
        </div>
      </div>
    </form>

    {% if result %}
      <h2>Tokenized Output</h2>
      <pre>{{ result.tokenized }}</pre>
      <div class="meta">Clusters: {{ result.stats.clusters }} · Tokens: {{ result.stats.tokens }}</div>

      {% if result.dict_tokenized %}
        <h2>Dictionary-First Segments</h2>
        <pre>{{ result.dict_tokenized }}</pre>
      {% endif %}

      {% if result.neural_tokenized %}
        <h2>Neural-Only Segments</h2>
        <pre>{{ result.neural_tokenized }}</pre>
      {% endif %}

      {% if result.pairs %}
        <h2>Cluster Tags (B/I/L/U)</h2>
        <div class="scroll">
          <table class="small">
            <thead>
              <tr>
                <th>#</th>
                <th>Cluster</th>
                <th>Tag</th>
              </tr>
            </thead>
            <tbody>
              {% for c, t in result.pairs %}
                <tr>
                  <td>{{ loop.index0 }}</td>
                  <td>{{ c }}</td>
                  <td><code>{{ t }}</code></td>
                </tr>
              {% endfor %}
            </tbody>
          </table>
        </div>
      {% endif %}
    {% endif %}
  </body>
</html>
"""


app = Flask(__name__)


@app.get("/")
def debug_bilu() -> Response:
    q = request.args.get("q", "")
    mode = (request.args.get("mode", MODE_NEURAL) or MODE_NEURAL).strip().lower()
    if mode not in MODES:
        mode = MODE_NEURAL
    result = analyze_text(q, mode=mode) if q else None
    return Response(
        render_template_string(
            _PAGE_TMPL,
            q=q,
            mode=mode,
            model=MODEL,
            newserver={"loaded": NEWSERVER_LOADED, "error": NEWSERVER_ERROR},
            result=result,
        ),
        content_type="text/html; charset=utf-8",
    )


@app.get("/debug/bilu")
def debug_bilu_alias() -> Response:
    return debug_bilu()


@app.get("/api/bilu")
def api_bilu() -> Response:
    q = request.args.get("q", "")
    mode = request.args.get("mode", MODE_NEURAL)
    payload = analyze_text(q, mode=mode)
    return jsonify(payload)


@app.post("/api/bilu")
def api_bilu_post() -> Response:
    data = request.get_json(force=True) or {}
    text = data.get("text", "")
    mode = data.get("mode", MODE_NEURAL)
    payload = analyze_text(text, mode=mode)
    return jsonify(payload)


if __name__ == "__main__":
    app.run(host=HOST, port=PORT, debug=True)
