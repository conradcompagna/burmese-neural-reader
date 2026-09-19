# compare_segmentation_and_sentence_chunkers.py
#
# Simple Flask UI:
# 1) Input text
# 2) Output: word-segmented text (spaces between words; original punctuation/whitespace/paragraphs preserved)
# 3) Output: sentence boundaries from TWO spaCy sentence models, side-by-side (run on the segmented text)
#
# Assumptions:
# - Run this tool as a module from the repository root.
# - Your environment already runs app.py successfully (so its imports/deps exist).

from __future__ import annotations

import re
import traceback
from typing import Optional, Tuple, List

from flask import Flask, request, render_template_string, jsonify

import spacy

import app as ns  # uses your existing segmenter code

# ---- Configure your spaCy sentence models here ----
SENTER_MODEL_1 = r"C:\spacy_models\mysentence_senter\sentencechunkermodel-best"
SENTER_MODEL_2 = r"C:\spacy_models\mysentence_senter\alt_finetune\model-best"


# ---------------- Sentence model loading (lazy) ----------------
_NLP1 = None
_NLP2 = None
_NLP_ERR1 = ""
_NLP_ERR2 = ""


def _load_sentence_models() -> Tuple[Optional["spacy.Language"], Optional["spacy.Language"]]:
    global _NLP1, _NLP2, _NLP_ERR1, _NLP_ERR2
    if _NLP1 is None and not _NLP_ERR1:
        try:
            _NLP1 = spacy.load(SENTER_MODEL_1)
        except Exception as e:
            _NLP_ERR1 = f"{type(e).__name__}: {e}"
            _NLP1 = None
    if _NLP2 is None and not _NLP_ERR2:
        try:
            _NLP2 = spacy.load(SENTER_MODEL_2)
        except Exception as e:
            _NLP_ERR2 = f"{type(e).__name__}: {e}"
            _NLP2 = None
    return _NLP1, _NLP2


# ---------------- Core: segmentation while preserving layout ----------------
def _is_myanmar_letter_like(ch: str) -> bool:
    """
    Match newserver.segment_with_pipeline's 'is_myanmar_letter' behavior:
    - Myanmar core OR extended blocks
    - excludes Myanmar punctuation (၊/။)
    """
    cp = ord(ch)
    if not (ns._is_myanmar_core(cp) or ns._is_myanmar_extended(cp)):
        return False
    if ch in ns.MYANMAR_PUNCT:
        return False
    return True


def segment_text_preserve_layout(text: str) -> str:
    """
    Preserve EVERYTHING except inserting spaces between segmented words inside Myanmar islands.
    - Keeps all original whitespace (including newlines) and punctuation exactly.
    - Uses newserver's segmentation pipeline for each Myanmar "island".
    """
    if not text:
        return ""

    out: List[str] = []
    island: List[str] = []

    def flush_island() -> None:
        nonlocal island
        if not island:
            return
        raw_island = "".join(island)
        island = []
        segs = ns.segment_with_pipeline(raw_island)  # uses dp OR neural_then_dict_greedy internally
        out.append(" ".join(segs))

    for ch in text:
        if _is_myanmar_letter_like(ch):
            island.append(ch)
        else:
            flush_island()
            out.append(ch)  # keep char byte-identical (spaces/newlines/punct/latin/etc.)

    flush_island()
    return "".join(out)


# ---------------- Sentence formatting (runs on segmented text) ----------------
_PARASEP_RE = re.compile(r"(\n[ \t]*\n+)")


def sentence_split_preserve_paragraphs(nlp: "spacy.Language", segmented_text: str) -> str:
    """
    Splits into paragraphs on blank lines and runs the sentence model per paragraph.
    Output: each sentence separated by a blank line, with original paragraph separators preserved.
    """
    if not segmented_text:
        return ""

    parts = _PARASEP_RE.split(segmented_text)
    out_parts: List[str] = []

    for part in parts:
        if not part:
            continue
        if _PARASEP_RE.fullmatch(part):
            # keep paragraph separators exactly
            out_parts.append(part)
            continue

        doc = nlp(part)
        sents = [s.text for s in doc.sents]
        # Make sentence boundaries obvious without adding symbols: blank line between sentences.
        out_parts.append("\n\n".join(sents))

    return "".join(out_parts)


# ---------------- Flask app ----------------
app = Flask(__name__)
app.config["JSON_AS_ASCII"] = False


TEMPLATE = r"""
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Segment + Compare Sentence Chunkers</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 18px; }
    textarea { width: 100%; height: 220px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .row { display: flex; gap: 14px; align-items: flex-start; }
    .col { flex: 1; min-width: 0; }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      padding: 12px;
      border: 1px solid #ddd;
      border-radius: 8px;
      background: #fafafa;
      min-height: 220px;
      margin: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
      line-height: 1.35;
    }
    .meta { color: #555; font-size: 12px; margin-top: 6px; }
    .err { color: #b00020; font-weight: 600; white-space: pre-wrap; }
    button { padding: 10px 14px; font-weight: 600; }
    h2 { margin: 18px 0 10px; }
    h3 { margin: 0 0 8px; }
    .small { font-size: 12px; color: #666; }
    .topbar { display: flex; gap: 10px; align-items: center; }
    .topbar .small { margin-left: auto; }
  </style>
</head>
<body>
  <div class="topbar">
    <form method="post" style="width:100%;">
      <h2>Input</h2>
      <textarea name="text" spellcheck="false">{{ text }}</textarea>
      <div style="margin-top:10px;">
        <button type="submit">Analyze</button>
        <span class="small">Runs: newserver segmenter → then both sentence models on the segmented text.</span>
      </div>
    </form>
  </div>

  {% if err %}
    <h2>Error</h2>
    <div class="err">{{ err }}</div>
  {% endif %}

  {% if segmented is not none %}
    <h2>Word-segmented output (spaces only; original layout preserved)</h2>
    <pre>{{ segmented }}</pre>
  {% endif %}

  {% if s1 is not none or s2 is not none %}
    <h2>Sentence comparison (side-by-side)</h2>
    <div class="row">
      <div class="col">
        <h3>Model 1</h3>
        <div class="meta">{{ model1 }}</div>
        {% if s1_err %}<div class="err">{{ s1_err }}</div>{% endif %}
        <pre>{{ s1 or "" }}</pre>
      </div>
      <div class="col">
        <h3>Model 2</h3>
        <div class="meta">{{ model2 }}</div>
        {% if s2_err %}<div class="err">{{ s2_err }}</div>{% endif %}
        <pre>{{ s2 or "" }}</pre>
      </div>
    </div>
  {% endif %}
</body>
</html>
"""


@app.route("/", methods=["GET", "POST"])
def index():
    text = request.form.get("text", "") if request.method == "POST" else ""
    segmented = None
    s1 = None
    s2 = None
    err = ""
    s1_err = ""
    s2_err = ""

    if request.method == "POST":
        try:
            segmented = segment_text_preserve_layout(text)

            nlp1, nlp2 = _load_sentence_models()

            if nlp1 is None:
                s1_err = f"Failed to load Model 1: {_NLP_ERR1}"
            else:
                s1 = sentence_split_preserve_paragraphs(nlp1, segmented)

            if nlp2 is None:
                s2_err = f"Failed to load Model 2: {_NLP_ERR2}"
            else:
                s2 = sentence_split_preserve_paragraphs(nlp2, segmented)

        except Exception:
            err = traceback.format_exc()

    return render_template_string(
        TEMPLATE,
        text=text,
        segmented=segmented,
        s1=s1,
        s2=s2,
        err=err,
        s1_err=s1_err,
        s2_err=s2_err,
        model1=SENTER_MODEL_1,
        model2=SENTER_MODEL_2,
    )


@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    payload = request.get_json(force=True, silent=True) or {}
    text = payload.get("text", "") or ""
    segmented = segment_text_preserve_layout(text)

    nlp1, nlp2 = _load_sentence_models()
    out = {
        "ok": True,
        "segmented": segmented,
        "model1_path": SENTER_MODEL_1,
        "model2_path": SENTER_MODEL_2,
        "model1_loaded": nlp1 is not None,
        "model2_loaded": nlp2 is not None,
        "model1_error": _NLP_ERR1,
        "model2_error": _NLP_ERR2,
        "model1_sentence_view": sentence_split_preserve_paragraphs(nlp1, segmented) if nlp1 else "",
        "model2_sentence_view": sentence_split_preserve_paragraphs(nlp2, segmented) if nlp2 else "",
    }
    return jsonify(out)


if __name__ == "__main__":
    # Use 127.0.0.1 so Windows firewall prompts are minimized.
    app.run(host="127.0.0.1", port=5111, debug=True)
