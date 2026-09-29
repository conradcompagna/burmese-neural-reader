# crf_sentence_app.py
# Flask app for testing the new Burmese sentence boundary CRF model
#
# This model:
#   - Identifies sentence-final particles in OCR-corrupted chronicle text
#   - Works on continuous token streams (no POS tags required)
#   - Uses SENT_END label to mark sentence boundaries
#
# Install:
#   pip install flask requests sklearn-crfsuite
#
# Run:
#   python crf_sentence_app.py
# Then open: http://127.0.0.1:5055

from __future__ import annotations

import json
import pickle
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from flask import Flask, jsonify, request, render_template_string

app = Flask(__name__)

# Punctuation patterns
PUNCT_RE = re.compile(r"^[\.\,\!\?\:\;\-\(\)\[\]\{\}\'\"`|/\\]+$")
MYANMAR_SENT_PUNCT = {"\u104a", "\u104b", "။", "၊"}
ASCII_PUNCT = set(r""".,;:!?()[]{}"'`|/\-""")
ZERO_WIDTH = {"\u200b", "\u200c", "\u200d", "\ufeff"}


def is_myanmar(s: str) -> bool:
    """Check if string contains Myanmar characters."""
    return any("\u1000" <= ch <= "\u109F" for ch in s)


def _is_myanmar_letter(ch: str) -> bool:
    """Check if character is a Myanmar letter."""
    o = ord(ch)
    return (0x1000 <= o <= 0x109F) or (0xA9E0 <= o <= 0xA9FF) or (0xAA60 <= o <= 0xAA7F)


def _strip_zw(s: str) -> str:
    """Strip zero-width characters."""
    s = s or ""
    for zw in ZERO_WIDTH:
        s = s.replace(zw, "")
    return s


def strip_punct_edges(tok: str) -> str:
    """Strip punctuation from token edges."""
    tok = _strip_zw(tok).strip()
    if not tok:
        return ""

    def is_strip_char(ch: str) -> bool:
        return ch in ASCII_PUNCT or ch in MYANMAR_SENT_PUNCT

    start, end = 0, len(tok)
    while start < end and is_strip_char(tok[start]):
        start += 1
    while end > start and is_strip_char(tok[end - 1]):
        end -= 1
    return tok[start:end].strip()


def is_punct_token(tok: str) -> bool:
    """Check if token is pure punctuation."""
    tok = _strip_zw(tok).strip()
    if not tok:
        return True
    if tok in MYANMAR_SENT_PUNCT or tok in ASCII_PUNCT:
        return True
    if PUNCT_RE.match(tok):
        return True
    return strip_punct_edges(tok) == ""


def keep_token(tok: str) -> bool:
    """Decide if token should be kept for processing."""
    if not tok:
        return False
    if is_punct_token(tok):
        return False
    n = strip_punct_edges(tok)
    if not n:
        return False
    # Require some Myanmar content after normalization.
    return any(_is_myanmar_letter(ch) for ch in n)


def strip_non_burmese_punct(tok: str) -> str:
    """
    Remove any non-Myanmar punctuation characters anywhere in the token.

    This is stricter than `strip_punct_edges()` (which only trims edges) and
    prevents ASCII/Unicode punctuation from leaking into features.
    """
    tok = _strip_zw(tok).strip()
    if not tok:
        return ""

    out = []
    for ch in tok:
        # Keep Myanmar letters and digits; drop punctuation/symbols.
        if _is_myanmar_letter(ch) or ch.isdigit():
            out.append(ch)
            continue
        cat = unicodedata.category(ch)
        if cat.startswith("P") or cat.startswith("S"):
            continue
        # Drop ASCII punctuation too (some may not be classified as P/S in weird cases)
        if ch in ASCII_PUNCT:
            continue
        # Everything else (Latin letters etc.) is not useful for this model.
        # Drop it to match your "normalize out non-Burmese punctuation/junk" requirement.
        continue

    return "".join(out).strip()

def has_myanmar(text: str) -> bool:
    return any(_is_myanmar_letter(ch) for ch in (text or ""))


# =============================================================================
# FEATURE EXTRACTION
# =============================================================================

def get_char_ngrams(word: str, n: int = 3) -> List[str]:
    """Get character n-grams from a word."""
    if len(word) < n:
        return [word]
    return [word[i:i+n] for i in range(len(word) - n + 1)]


def word2features(tokens: List[str], i: int) -> Dict[str, Any]:
    """
    Extract features for a token at position i.
    Must match the feature extraction in train_sentence_crf.py exactly.
    """
    word = tokens[i]

    features = {
        'bias': 1.0,
        'word': word,
        'word.lower()': word.lower(),
        'word.len': len(word),
        'word.isdigit': word.isdigit() or bool(re.match(r'^[၀-၉]+$', word)),

        # Character suffixes (important for Burmese particles)
        'word[-1:]': word[-1:] if word else '',
        'word[-2:]': word[-2:] if len(word) >= 2 else word,
        'word[-3:]': word[-3:] if len(word) >= 3 else word,
        'word[-4:]': word[-4:] if len(word) >= 4 else word,

        # Character prefixes
        'word[:1]': word[:1] if word else '',
        'word[:2]': word[:2] if len(word) >= 2 else word,

        # Specific character features for Burmese
        'ends_with_သည်': word.endswith('သည်'),
        'ends_with_မည်': word.endswith('မည်'),
        'ends_with_ခြင်း': word.endswith('ခြင်း'),
        'ends_with_ကြောင်း': word.endswith('ကြောင်း'),
        'ends_with_စေ': word.endswith('စေ'),
        'ends_with_ပါ': word.endswith('ပါ'),
        'ends_with_ပြီ': word.endswith('ပြီ'),
        'ends_with_လေ': word.endswith('လေ'),
        'ends_with_၏': word.endswith('၏'),
        'ends_with_တယ်': word.endswith('တယ်'),
        'ends_with_ရက်': word.endswith('ရက်'),

        # Contains certain characters
        'has_virama': '်' in word,  # Burmese virama
    }

    # Add character trigrams
    for j, ngram in enumerate(get_char_ngrams(word, 3)[:5]):  # limit to 5
        features[f'char_trigram_{j}'] = ngram

    # Context features: previous tokens
    if i > 0:
        word1 = tokens[i-1]
        features.update({
            '-1:word': word1,
            '-1:word[-2:]': word1[-2:] if len(word1) >= 2 else word1,
            '-1:word[-3:]': word1[-3:] if len(word1) >= 3 else word1,
        })
    else:
        features['BOS'] = True  # Beginning of sequence

    if i > 1:
        word2 = tokens[i-2]
        features.update({
            '-2:word': word2,
            '-2:word[-2:]': word2[-2:] if len(word2) >= 2 else word2,
        })

    # Context features: next tokens
    # NOTE: No EOS feature (we don't know where sequences end in real data)
    if i < len(tokens) - 1:
        word1 = tokens[i+1]
        features.update({
            '+1:word': word1,
            '+1:word[:2]': word1[:2] if len(word1) >= 2 else word1,
        })

    if i < len(tokens) - 2:
        word2 = tokens[i+2]
        features.update({
            '+2:word': word2,
        })

    return features


def make_features(tokens: List[str]) -> List[Dict[str, Any]]:
    """Extract features for all tokens in sequence."""
    return [word2features(tokens, i) for i in range(len(tokens))]


# --- Features for pycrfsuite models trained by train_sentence_final_particle_crf_pooled_v3.py ---

def token_shape(tok: str) -> str:
    out: List[str] = []
    for ch in tok:
        if _is_myanmar_letter(ch):
            out.append("M")
        elif ch.isdigit():
            out.append("D")
        elif ch.isalpha():
            out.append("A")
        else:
            out.append("P")
    return "".join(out[:16])


def fp_word_features(tokens: List[str], i: int, win: int) -> Dict[str, str]:
    tok = tokens[i]
    feats: Dict[str, str] = {
        "bias": "1",
        "shape": token_shape(tok),
        "len": str(min(len(tok), 12)),
        "suf1": tok[-1:] if len(tok) >= 1 else tok,
        "suf2": tok[-2:] if len(tok) >= 2 else tok,
        "suf3": tok[-3:] if len(tok) >= 3 else tok,
        "pre1": tok[:1] if len(tok) >= 1 else tok,
        "pre2": tok[:2] if len(tok) >= 2 else tok,
    }

    for k in range(1, win + 1):
        if i - k >= 0:
            prev = tokens[i - k]
            feats[f"-{k}:suf2"] = prev[-2:] if len(prev) >= 2 else prev
        else:
            feats[f"BOS{k}"] = "1"

        if i + k < len(tokens):
            nxt = tokens[i + k]
            feats[f"+{k}:suf2"] = nxt[-2:] if len(nxt) >= 2 else nxt
        else:
            feats[f"EOS{k}"] = "1"

    return feats


def fp_make_features(tokens: List[str], win: int) -> List[Dict[str, str]]:
    return [fp_word_features(tokens, i, win) for i in range(len(tokens))]

def _bc_is_garbage_token(token: str) -> bool:
    """
    Match `train_boundary_crf.py:is_garbage_token` closely.
    "Garbage" here is anything that looks like OCR separators/noise between Myanmar islands.
    """
    token = (token or "").strip()
    if not token:
        return True

    # Pure numbers (ASCII or Myanmar digits), optionally mixed with basic separators.
    if re.match(r"^[\d\u1040-\u1049\u104a\u104b\.\,\-\/]+$", token):
        return True

    # If it has no Myanmar letters and is very short, it's almost certainly separator garbage.
    if not has_myanmar(token) and len(token) <= 3:
        return True

    # Single non-Myanmar char.
    if len(token) == 1 and not has_myanmar(token):
        return True

    # Pure punctuation/symbols.
    if all(unicodedata.category(c).startswith(("P", "S")) or c.isspace() for c in token):
        return True

    return False


def _bc_categorize_garbage(token: str) -> str:
    token = (token or "").strip()
    if not token:
        return "empty"

    if token in {"\u104a", "\u104b", "။", "၊"}:
        return "my_punct"

    if any(c.isdigit() or ("\u1040" <= c <= "\u1049") for c in token):
        return "number"

    cats = {unicodedata.category(c)[:1] for c in token if c and not c.isspace()}
    if "P" in cats:
        return "punct"
    if "S" in cats:
        return "symbol"

    return "other"


def _bc_extract_gap_features(
    tokens: List[str],
    i: int,
    extra_features: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, str]:
    """
    Gap-focused features (boundary_crf).
    Designed to be compatible with the pickled sklearn-crfsuite model in `corpus/boundary_crf.pkl`.
    """
    token = tokens[i]
    feats: Dict[str, str] = {
        "bias": "1",
        "is_myanmar": str(has_myanmar(token)),
        "is_garbage": str(_bc_is_garbage_token(token)),
        "token_len": str(min(len(token), 10)),
    }

    if i < len(tokens) - 1:
        nxt = tokens[i + 1]
        feats["next_is_garbage"] = str(_bc_is_garbage_token(nxt))
        feats["next_is_myanmar"] = str(has_myanmar(nxt))
        if _bc_is_garbage_token(nxt):
            feats["next_garbage_type"] = _bc_categorize_garbage(nxt)
    else:
        feats["EOS"] = "1"

    if i < len(tokens) - 2:
        nxt2 = tokens[i + 2]
        feats["next2_is_garbage"] = str(_bc_is_garbage_token(nxt2))
        feats["next2_is_myanmar"] = str(has_myanmar(nxt2))

    if i > 0:
        prv = tokens[i - 1]
        feats["prev_is_garbage"] = str(_bc_is_garbage_token(prv))
        feats["prev_is_myanmar"] = str(has_myanmar(prv))
    else:
        feats["BOS"] = "1"

    if extra_features and i < len(extra_features):
        ef = extra_features[i] or {}
        feats["is_last_in_line"] = str(bool(ef.get("is_last_in_line", False)))
        feats["line_is_short"] = str(bool(ef.get("line_is_short", False)))

        lcc = int(ef.get("line_cluster_count", 0) or 0)
        if lcc <= 2:
            feats["line_cluster_bin"] = "very_short"
        elif lcc <= 4:
            feats["line_cluster_bin"] = "short"
        elif lcc <= 7:
            feats["line_cluster_bin"] = "medium"
        else:
            feats["line_cluster_bin"] = "long"

    return feats


def _bc_sent2features(tokens: List[str], extras: Optional[List[Dict[str, Any]]]) -> List[Dict[str, str]]:
    return [_bc_extract_gap_features(tokens, i, extras) for i in range(len(tokens))]


def tokenize_boundary_text(text: str, short_line_ratio: float = 0.6) -> Tuple[List[str], List[Dict[str, Any]]]:
    """
    Tokenize raw OCR-ish text into whitespace-delimited tokens while preserving line boundaries
    as per-token extras (`is_last_in_line`, `line_is_short`, `line_cluster_count`).
    """
    lines = (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")

    per_line_tokens: List[List[str]] = []
    for line in lines:
        toks = [t for t in line.split() if t]
        per_line_tokens.append(toks)

    nonempty_counts = [len(toks) for toks in per_line_tokens if toks]
    med = 0.0
    if nonempty_counts:
        srt = sorted(nonempty_counts)
        mid = len(srt) // 2
        med = float(srt[mid]) if len(srt) % 2 == 1 else (srt[mid - 1] + srt[mid]) / 2.0

    tokens: List[str] = []
    extras: List[Dict[str, Any]] = []

    for toks in per_line_tokens:
        if not toks:
            # Represent empty line as a garbage-ish separator so the model can fire a boundary.
            tokens.append("|")
            extras.append({"is_last_in_line": True, "line_is_short": True, "line_cluster_count": 0})
            continue

        lcc = len(toks)
        is_short = bool(med and (lcc < med * short_line_ratio))
        for j, tok in enumerate(toks):
            tokens.append(tok)
            extras.append(
                {
                    "is_last_in_line": j == (lcc - 1),
                    "line_is_short": is_short,
                    "line_cluster_count": lcc,
                }
            )

    return tokens, extras


# =============================================================================
# MODEL LOADING
# =============================================================================

@dataclass
class LoadedModel:
    path: str
    kind: str  # "pickle" | "crfsuite"
    model: Any
    win: int = 0
    opts: Dict[str, Any] = field(default_factory=dict)
    meta: Dict[str, Any] = field(default_factory=dict)


_MODEL_CACHE: Optional[LoadedModel] = None
_SPACY_NLP_CACHE: Dict[str, Any] = {}


def load_spacy_ud_model(model_path: str):
    """
    Load a spaCy pipeline from a local path (e.g. ./model-best) and cache it.
    """
    p = str(Path(model_path).expanduser().resolve())
    if p in _SPACY_NLP_CACHE:
        return _SPACY_NLP_CACHE[p]
    import spacy  # type: ignore

    nlp = spacy.load(p)
    _SPACY_NLP_CACHE[p] = nlp
    return nlp


def spacy_ud_sentence_segment(text: str, *, spacy_model_path: str, newserver_url: Optional[str]) -> Dict[str, Any]:
    """
    Segment using spaCy UD parser pipeline and return sentence boundaries.

    We explicitly try to let spaCy determine sentence boundaries:
      - Build a Doc from tokenized words
      - Set doc[0].is_sent_start = True and others = None before parsing
      - Read doc.sents / Token.is_sent_start after parsing
    """
    raw = (text or "").strip()
    if not raw:
        return {
            "tokens": [],
            "labels": [],
            "boundaries": [],
            "sentences": [],
            "marked_text": "",
            "debug": {"mode": "spacy_ud", "spacy_model_path": spacy_model_path},
        }

    # Prefer your newserver tokenizer so tokens match what the UD model expects.
    if newserver_url:
        tokens = call_newserver(newserver_url, raw)
    else:
        tokens = [t for t in raw.split() if t]

    if not tokens:
        return {
            "tokens": [],
            "labels": [],
            "boundaries": [],
            "sentences": [],
            "marked_text": "",
            "debug": {"mode": "spacy_ud", "spacy_model_path": spacy_model_path, "note": "no_tokens"},
        }

    nlp = load_spacy_ud_model(spacy_model_path)

    try:
        from spacy.tokens import Doc  # type: ignore
    except Exception as e:
        raise RuntimeError(f"spacy_unavailable:{type(e).__name__}:{e}")

    spaces = [True] * (len(tokens) - 1) + [False]
    doc = Doc(nlp.vocab, words=tokens, spaces=spaces)

    # Explicitly allow sentence boundary prediction by clearing existing starts.
    for t in doc:
        t.is_sent_start = None
    doc[0].is_sent_start = True

    doc = nlp(doc)

    # Get sentence ends as token indices (end-1)
    boundaries: List[int] = []
    sentences: List[str] = []
    try:
        for s in doc.sents:
            end_i = int(s.end) - 1
            if end_i >= 0:
                boundaries.append(end_i)
            txt = s.text.strip()
            if txt:
                sentences.append(txt)
    except Exception:
        # Fallback: derive from is_sent_start flags
        start = 0
        for i, t in enumerate(doc):
            if i == 0:
                continue
            if bool(t.is_sent_start):
                boundaries.append(i - 1)
                sentences.append(" ".join(tokens[start:i]).strip())
                start = i
        if start < len(tokens):
            sentences.append(" ".join(tokens[start:]).strip())
            boundaries.append(len(tokens) - 1)

    # Build marked text
    boundary_set = set(boundaries)
    marked_parts: List[str] = []
    for i, tok in enumerate(tokens):
        marked_parts.append(tok)
        if i in boundary_set:
            marked_parts.append("<SENT_END>")
    marked_text = " ".join(marked_parts).strip()

    return {
        "tokens": tokens,
        "labels": [("SENT_END" if i in boundary_set else "O") for i in range(len(tokens))],
        "boundaries": boundaries,
        "sentences": [s for s in sentences if s],
        "marked_text": marked_text,
        "debug": {
            "mode": "spacy_ud",
            "spacy_model_path": str(Path(spacy_model_path)),
            "pipeline": list(getattr(nlp, "pipe_names", [])),
            "n_tokens": len(tokens),
            "n_boundaries": len(boundaries),
        },
    }


def load_model(model_path: str) -> LoadedModel:
    """Load CRF model (.pkl sklearn-crfsuite or .crfsuite pycrfsuite)."""
    global _MODEL_CACHE
    model_path = str(Path(model_path).expanduser().resolve())

    if _MODEL_CACHE is not None and _MODEL_CACHE.path == model_path:
        return _MODEL_CACHE

    p = Path(model_path)
    if not p.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")

    if p.suffix.lower() == ".crfsuite":
        import pycrfsuite

        tagger = pycrfsuite.Tagger()
        tagger.open(str(p))

        # Optional meta files produced by our trainers:
        # - <model>.crfsuite.meta.pkl
        # - <model>.crfsuite.meta.json
        win = 3
        meta_p = Path(str(p) + ".meta.pkl")
        meta: Dict[str, Any] = {}
        if meta_p.exists():
            try:
                meta = pickle.loads(meta_p.read_bytes())
                win = int(meta.get("win", win))
            except Exception:
                meta = {}
                win = win
        else:
            meta_json_p = Path(str(p) + ".meta.json")
            if meta_json_p.exists():
                try:
                    meta = json.loads(meta_json_p.read_text(encoding="utf-8", errors="replace"))
                except Exception:
                    meta = {}

        _MODEL_CACHE = LoadedModel(path=model_path, kind="crfsuite", model=tagger, win=win, meta=meta or {})
        return _MODEL_CACHE

    # Load pickled sklearn_crfsuite model
    with open(p, "rb") as f:
        model = pickle.load(f)

    meta: Dict[str, Any] = {}
    meta_p = p.with_suffix(".meta.pkl")
    if meta_p.exists():
        try:
            meta = pickle.loads(meta_p.read_bytes())
        except Exception:
            meta = {}

    _MODEL_CACHE = LoadedModel(path=model_path, kind="pickle", model=model, win=0, meta=meta or {})
    return _MODEL_CACHE


# =============================================================================
# NEWSERVER INTEGRATION
# =============================================================================

def call_newserver(newserver_url: str, text: str, timeout_s: int = 120) -> List[str]:
    """
    Call newserver to get tokens.
    Returns just the token list (no POS tags needed for this model).
    """
    url = newserver_url.rstrip("/") + "/debug_ud_parser"
    r = requests.post(url, json={"text": text, "raw": False}, timeout=timeout_s)

    ct = (r.headers.get("content-type") or "").lower()
    if "application/json" not in ct:
        raise RuntimeError(f"newserver returned non-JSON ({r.status_code}): {r.text[:300]}")

    data = r.json()
    if not data.get("ok", True) and "tokens" not in data:
        raise RuntimeError(f"newserver ok=false: {data}")

    tokens = []
    for t in data.get("tokens", []):
        tok = t.get("text", "")
        if tok:
            tokens.append(tok)

    return tokens


# =============================================================================
# SENTENCE SEGMENTATION
# =============================================================================

def preprocess_tokens(tokens: List[str]) -> Tuple[List[str], List[int]]:
    """
    Filter tokens to keep only Myanmar tokens (matching training behavior).
    Returns: (kept_tokens, kept2orig_index)
    """
    kept_tokens, kept2orig = [], []
    for i, tok in enumerate(tokens):
        if not keep_token(tok):
            continue
        # Normalize:
        # - strip punctuation edges
        # - strip all non-Myanmar punctuation anywhere in the token
        norm = strip_non_burmese_punct(strip_punct_edges(tok))
        if not norm:
            continue
        kept_tokens.append(norm)
        kept2orig.append(i)

    return kept_tokens, kept2orig


def crf_segment(model: LoadedModel, tokens: List[str]) -> Dict[str, Any]:
    """
    Segment tokens into sentences using CRF model.

    Returns:
        Dictionary with:
        - tokens: original token list
        - labels: CRF label for each original token
        - boundaries: indices of sentence-final tokens
        - sentences: list of sentence strings
        - marked_text: text with <SENT_END> markers
    """
    if not tokens:
        return {
            "tokens": [],
            "labels": [],
            "boundaries": [],
            "sentences": [],
            "marked_text": ""
        }

    # Preprocess: keep only Myanmar tokens
    kept_tokens, kept2orig = preprocess_tokens(tokens)

    if not kept_tokens:
        # No Myanmar tokens found - return as single sentence
        return {
            "tokens": tokens,
            "labels": ["O"] * len(tokens),
            "boundaries": [],
            "sentences": [" ".join(tokens)],
            "marked_text": " ".join(tokens)
        }

    # Predict
    pe = []
    if model.kind == "crfsuite":
        X = fp_make_features(kept_tokens, win=int(model.win or 3))
        predictions = list(model.model.tag(X))
        end_label = "E"

        # No-retrain ways to reduce "too many cuts":
        # - probability threshold: keep E only if P(E|x) >= threshold
        # - minimum gap: don't allow boundaries too close together
        p_threshold = float(model.opts.get("p_threshold", 0.0) or 0.0)
        min_gap = int(model.opts.get("min_gap", 0) or 0)

        pe = [float(model.model.marginal("E", i)) for i in range(len(kept_tokens))]

        if p_threshold > 0.0:
            for i in range(len(predictions)):
                if pe[i] < p_threshold:
                    predictions[i] = "O"

        if min_gap > 0:
            last_e = -10**9
            for i in range(len(predictions)):
                if predictions[i] != "E":
                    continue
                if i - last_e <= min_gap:
                    predictions[i] = "O"
                else:
                    last_e = i

    else:
        X = make_features(kept_tokens)
        predictions = model.model.predict([X])[0]  # Get first (and only) sequence
        end_label = "SENT_END"

    # Map predictions back to original token indices
    labels = ["O"] * len(tokens)
    boundaries = []

    for kept_idx, pred_label in enumerate(predictions):
        orig_idx = kept2orig[kept_idx]
        labels[orig_idx] = pred_label
        if pred_label == end_label:
            boundaries.append(orig_idx)

    # Build sentences
    sentences = []
    start = 0
    for boundary_idx in boundaries:
        sentence_tokens = tokens[start:boundary_idx + 1]
        sentences.append(" ".join(sentence_tokens))
        start = boundary_idx + 1

    # Add remaining tokens as final sentence
    if start < len(tokens):
        sentences.append(" ".join(tokens[start:]))

    # Create marked text for UI
    marked_parts = []
    boundary_set = set(boundaries)
    for i, tok in enumerate(tokens):
        marked_parts.append(tok)
        if i in boundary_set:
            marked_parts.append("<SENT_END>")
    marked_text = " ".join(marked_parts)

    return {
        "tokens": tokens,
        "labels": labels,
        "boundaries": boundaries,
        "sentences": sentences,
        "marked_text": marked_text,
        # Debug: what the model actually saw (post-normalization)
        "debug": {
            "kept_tokens": kept_tokens,
            "kept_predictions": list(predictions),
            "kept_pE": pe,
            "kept2orig": kept2orig,
            "model_kind": model.kind,
            "model_win": model.win,
            "end_label": end_label,
        },
    }

def boundary_crf_segment(model: LoadedModel, text: str) -> Dict[str, Any]:
    """
    Segment raw OCR-ish text using the gap-based boundary_crf model (sklearn-crfsuite .pkl).
    This path does NOT require newserver and MUST NOT filter out garbage tokens.
    """
    tokens, extras = tokenize_boundary_text(text)
    if not tokens:
        return {
            "tokens": [],
            "labels": [],
            "boundaries": [],
            "sentences": [],
            "marked_text": "",
            "debug": {
                "model_kind": model.kind,
                "model_type": model.meta.get("model_type"),
                "end_label": "SENT_END",
            },
        }

    X = _bc_sent2features(tokens, extras)
    predictions = model.model.predict([X])[0]
    end_label = "SENT_END"

    labels = list(predictions)
    boundaries = [i for i, lab in enumerate(predictions) if lab == end_label]

    sentences: List[str] = []
    start = 0
    for boundary_idx in boundaries:
        sent = " ".join(tokens[start:boundary_idx + 1]).strip()
        if sent:
            sentences.append(sent)
        start = boundary_idx + 1
    if start < len(tokens):
        sent = " ".join(tokens[start:]).strip()
        if sent:
            sentences.append(sent)

    marked_parts: List[str] = []
    boundary_set = set(boundaries)
    for i, tok in enumerate(tokens):
        marked_parts.append(tok)
        if i in boundary_set:
            marked_parts.append("<SENT_END>")
    marked_text = " ".join(marked_parts)

    return {
        "tokens": tokens,
        "labels": labels,
        "boundaries": boundaries,
        "sentences": sentences,
        "marked_text": marked_text,
        "debug": {
            "model_kind": model.kind,
            "model_type": model.meta.get("model_type"),
            "end_label": end_label,
            "n_tokens": len(tokens),
        },
    }

def boundary_crf_segment_crfsuite(model: LoadedModel, text: str) -> Dict[str, Any]:
    """
    Segment raw OCR-ish text using a pycrfsuite model trained for boundary detection.
    Supports labels including SENT_END and PARA_END.
    """
    tokens, extras = tokenize_boundary_text(text)
    if not tokens:
        return {
            "tokens": [],
            "labels": [],
            "boundaries": [],
            "sentences": [],
            "marked_text": "",
            "debug": {
                "model_kind": model.kind,
                "model_type": model.meta.get("model_type"),
                "end_labels": ["SENT_END", "PARA_END"],
            },
        }

    X = _bc_sent2features(tokens, extras)
    predictions = list(model.model.tag(X))

    end_labels = {"SENT_END", "PARA_END"}
    boundaries = [i for i, lab in enumerate(predictions) if lab in end_labels]

    sentences: List[str] = []
    start = 0
    for boundary_idx in boundaries:
        sent = " ".join(tokens[start:boundary_idx + 1]).strip()
        if sent:
            sentences.append(sent)
        start = boundary_idx + 1
    if start < len(tokens):
        sent = " ".join(tokens[start:]).strip()
        if sent:
            sentences.append(sent)

    marked_parts: List[str] = []
    for tok, lab in zip(tokens, predictions):
        marked_parts.append(tok)
        if lab == "SENT_END":
            marked_parts.append("<SENT_END>")
        elif lab == "PARA_END":
            marked_parts.append("<PARA_END>")
    marked_text = " ".join(marked_parts)

    return {
        "tokens": tokens,
        "labels": predictions,
        "boundaries": boundaries,
        "sentences": sentences,
        "marked_text": marked_text,
        "debug": {
            "model_kind": model.kind,
            "model_type": model.meta.get("model_type"),
            "end_labels": sorted(end_labels),
            "n_tokens": len(tokens),
            "n_sent_end": sum(1 for x in predictions if x == "SENT_END"),
            "n_para_end": sum(1 for x in predictions if x == "PARA_END"),
        },
    }

def _is_ocr_structure_boundary_model(model: LoadedModel) -> bool:
    """
    Heuristic detection for the OCR-structure boundary CRFs trained by
    `train_ocr_structure_boundary_crf.py`.
    """
    name = Path(model.path).name.lower()
    if "ocr_boundary_struct" in name:
        return True
    mt = ((model.meta or {}).get("model_type") or "").strip().lower()
    return mt in {"ocr_structure_boundary", "ocr_boundary_struct"}


def ocr_structure_boundary_segment_crfsuite(model: LoadedModel, text: str) -> Dict[str, Any]:
    """
    Segment raw OCR-ish text using the *boundary-position* CRF trained by
    `train_ocr_structure_boundary_crf.py`.

    Note: This model labels boundary positions (after islands[i]), so there are
    (len(islands)-1) labels, not len(islands).
    """
    import train_ocr_structure_boundary_crf as ocr

    raw = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    ig = ocr.islands_and_gaps(raw)
    islands = ig.islands
    gaps = ig.gaps

    if len(islands) < 2:
        marked = (ig.leading_ws + (islands[0] if islands else "")).rstrip()
        return {
            "tokens": islands,
            "labels": [],
            "boundaries": [],
            "sentences": [marked] if marked else [],
            "marked_text": marked,
            "debug": {
                "model_kind": model.kind,
                "model_type": (model.meta or {}).get("model_type"),
                "label_scheme": "boundary_positions",
                "n_islands": len(islands),
            },
        }

    stats = ocr.compute_doc_stats(islands, gaps)
    X = [ocr.boundary_features(islands, gaps, stats, i) for i in range(len(islands) - 1)]
    predictions = list(model.model.tag(X))

    p_threshold = float(model.opts.get("p_threshold", 0.0) or 0.0)
    min_gap = int(model.opts.get("min_gap", 0) or 0)

    # Optional post-filtering: keep a boundary only if P(SENT_END)+P(PARA_END) >= threshold.
    if p_threshold > 0.0:
        for i in range(len(predictions)):
            p_any = float(model.model.marginal("SENT_END", i)) + float(model.model.marginal("PARA_END", i))
            if p_any < p_threshold:
                predictions[i] = "O"

    # Optional post-filtering: suppress boundaries that are too close together.
    if min_gap > 0:
        last_b = -10**9
        for i in range(len(predictions)):
            if predictions[i] not in ("SENT_END", "PARA_END"):
                continue
            if i - last_b <= min_gap:
                predictions[i] = "O"
            else:
                last_b = i

    boundaries = [i for i, lab in enumerate(predictions) if lab in ("SENT_END", "PARA_END")]

    # Build sentences (simple: join islands with spaces).
    sentences: List[str] = []
    buf: List[str] = []
    for idx, tok in enumerate(islands):
        buf.append(tok)
        if idx < len(predictions) and predictions[idx] in ("SENT_END", "PARA_END"):
            sent = " ".join(buf).strip()
            if sent:
                sentences.append(sent)
            buf = []
    if buf:
        sent = " ".join(buf).strip()
        if sent:
            sentences.append(sent)

    # Reconstruct marked text while preserving original whitespace/newlines.
    out_parts: List[str] = []
    if ig.leading_ws:
        out_parts.append(ig.leading_ws)
    for i, tok in enumerate(islands):
        out_parts.append(tok)
        if i < len(predictions):
            lab = predictions[i]
            if lab == "SENT_END":
                out_parts.append(" <SENT_END>")
            elif lab == "PARA_END":
                out_parts.append(" <PARA_END>")
        if i < len(gaps):
            out_parts.append(gaps[i])
    marked_text = "".join(out_parts).rstrip()

    return {
        "tokens": islands,
        "labels": predictions,  # boundary-position labels, length=len(islands)-1
        "boundaries": boundaries,
        "sentences": sentences,
        "marked_text": marked_text,
        "debug": {
            "model_kind": model.kind,
            "model_type": (model.meta or {}).get("model_type"),
            "label_scheme": "boundary_positions",
            "p_threshold": p_threshold,
            "min_gap": min_gap,
            "n_islands": len(islands),
            "n_boundaries": len(boundaries),
        },
    }


# =============================================================================
# WEB UI
# =============================================================================

INDEX_HTML = r"""
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Burmese Sentence Boundary CRF Tester</title>
  <style>
    body {
      font-family: sans-serif;
      margin: 20px;
      max-width: 1200px;
    }
    h1 { color: #333; }
    textarea {
      width: 100%;
      height: 150px;
      font-family: 'Myanmar Text', sans-serif;
      font-size: 16px;
    }
    input[type=text] {
      width: 100%;
      padding: 8px;
      font-size: 14px;
    }
    .row {
      margin-bottom: 15px;
    }
    .label {
      font-size: 14px;
      color: #555;
      margin-bottom: 5px;
      font-weight: bold;
    }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      background: #f6f6f6;
      padding: 15px;
      border-radius: 4px;
      border: 1px solid #ddd;
      font-family: 'Myanmar Text', monospace;
      line-height: 1.6;
    }
    button {
      background: #4CAF50;
      color: white;
      padding: 12px 24px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 16px;
    }
    button:hover {
      background: #45a049;
    }
    .error {
      background: #ffebee;
      color: #c62828;
      border: 1px solid #ef5350;
    }
    .sent_end {
      color: #d32f2f;
      font-weight: bold;
      background: #ffcdd2;
      padding: 2px 6px;
      border-radius: 3px;
      margin: 0 3px;
    }
    .info {
      background: #e3f2fd;
      padding: 10px;
      border-radius: 4px;
      margin-bottom: 20px;
      border-left: 4px solid #2196F3;
    }
  </style>
</head>
<body>
  <h1>🔤 Burmese Sentence Boundary CRF Tester</h1>

  <div class="info">
    <strong>Model info:</strong> This CRF tagger identifies sentence-final particles in OCR-corrupted
    Burmese chronicle text. It works on continuous token streams without requiring POS tags.
  </div>

  <div class="row">
    <div class="label">Newserver URL</div>
    <input id="newserver_url" type="text" value="http://127.0.0.1:5000"/>
  </div>

  <div class="row">
    <div class="label">CRF Model Path (.pkl or .crfsuite)</div>
    <input id="model_path" type="text"
           placeholder="corpus/burmese_sentence_finalparticle_v3_forcezhaa.crfsuite"
           value="corpus/burmese_sentence_finalparticle_v3_forcezhaa.crfsuite"/>
  </div>

  <div class="row">
    <div class="label">spaCy UD Sentence Segmentation (optional)</div>
    <label style="display:block; font-size:14px; color:#333; margin-bottom:6px;">
      <input id="use_spacy_ud" type="checkbox"/>
      Use spaCy UD model for sentence boundaries (ignores CRF model)
    </label>
    <label style="display:block; font-size:14px; color:#333;">
      spaCy model path:
      <input id="spacy_model_path" type="text" value="model-best" style="width:100%; max-width:700px; margin-top:6px;"/>
    </label>
    <div style="font-size:12px; color:#666; margin-top:6px;">
      Tries to return boundaries via <code>doc.sents</code> / <code>Token.is_sent_start</code>.
    </div>
  </div>

  <div class="row">
    <div class="label">Input Text (Burmese)</div>
    <textarea id="text" placeholder="Paste Burmese text here..."></textarea>
  </div>

  <div class="row">
    <div class="label">Inference Controls (no retraining)</div>
    <label style="display:block; font-size:14px; color:#333; margin-bottom:6px;">
      Boundary probability threshold (CRFsuite only):
      <input id="p_threshold" type="number" min="0" max="1" step="0.05" value="0.00" style="width:110px; margin-left:8px;"/>
      <span style="color:#666;">(0 disables; try 0.60–0.85 to reduce splitting)</span>
    </label>
    <label style="display:block; font-size:14px; color:#333;">
      Min gap between boundaries (tokens):
      <input id="min_gap" type="number" min="0" max="50" step="1" value="0" style="width:110px; margin-left:8px;"/>
      <span style="color:#666;">(e.g. 2 prevents back-to-back splits)</span>
    </label>
  </div>

  <div class="row">
    <button onclick="run()">🔍 Segment Sentences</button>
  </div>

  <div class="row">
    <div class="label">Output (with &lt;SENT_END&gt; markers)</div>
    <pre id="marked"></pre>
  </div>

  <div class="row">
    <div class="label">Sentences (numbered)</div>
    <pre id="sentences"></pre>
  </div>

  <div class="row">
    <div class="label">Errors / Status</div>
    <pre id="errors"></pre>
  </div>

<script>
async function run() {
  const errEl = document.getElementById("errors");
  const markedEl = document.getElementById("marked");
  const sentEl = document.getElementById("sentences");

  errEl.textContent = "Processing...";
  errEl.className = "";
  markedEl.textContent = "";
  sentEl.textContent = "";

  const payload = {
    newserver_url: document.getElementById("newserver_url").value.trim(),
    model_path: document.getElementById("model_path").value.trim(),
    use_spacy_ud: document.getElementById("use_spacy_ud").checked,
    spacy_model_path: document.getElementById("spacy_model_path").value.trim(),
    text: document.getElementById("text").value,
    p_threshold: parseFloat(document.getElementById("p_threshold").value || "0") || 0.0,
    min_gap: parseInt(document.getElementById("min_gap").value || "0") || 0
  };

  try {
    const resp = await fetch("/api/segment", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    });

    const data = await resp.json();

    if (!resp.ok) {
      errEl.textContent = (data && data.error) ? data.error : "Request failed";
      errEl.className = "error";
      return;
    }

    // Display marked text
    markedEl.innerHTML = (data.marked_text || "")
      .replace(/<SENT_END>/g, '<span class="sent_end">&lt;SENT_END&gt;</span>');

    // Display numbered sentences
    const sentences = data.sentences || [];
    sentEl.textContent = sentences.map((s,i) => `${i+1}. ${s}`).join("\n\n");

    // Success message
    errEl.textContent = `✓ Found ${sentences.length} sentence(s) with ${data.boundaries.length} boundary marker(s)`;
    errEl.className = "";

  } catch (e) {
    errEl.textContent = "Error: " + String(e);
    errEl.className = "error";
  }
}
</script>
</body>
</html>
"""


@app.get("/")
def index():
    """Serve the main UI."""
    return render_template_string(INDEX_HTML)


@app.post("/api/segment")
def api_segment():
    """API endpoint for sentence segmentation."""
    try:
        payload = request.get_json(force=True)
        text = (payload.get("text") or "").strip()
        newserver_url = (payload.get("newserver_url") or "").strip()
        model_path = (payload.get("model_path") or "").strip()
        use_spacy_ud = bool(payload.get("use_spacy_ud", False))
        spacy_model_path = (payload.get("spacy_model_path") or "").strip()
        p_threshold = float(payload.get("p_threshold", 0.0) or 0.0)
        min_gap = int(payload.get("min_gap", 0) or 0)

        if not text:
            return jsonify({"error": "Empty text"}), 400
        if use_spacy_ud:
            if not spacy_model_path:
                return jsonify({"error": "Missing spacy_model_path"}), 400
        elif not model_path:
            return jsonify({"error": "Missing model_path"}), 400

        if use_spacy_ud:
            # Sentence boundaries from spaCy UD model.
            # newserver_url is optional but recommended for consistent tokenization.
            result = spacy_ud_sentence_segment(
                text,
                spacy_model_path=spacy_model_path,
                newserver_url=newserver_url or None,
            )
            return jsonify(result)

        # Load model
        model = load_model(model_path)
        model.opts["p_threshold"] = p_threshold
        model.opts["min_gap"] = min_gap

        model_type = (model.meta or {}).get("model_type") or ""
        if model_type == "boundary_crf":
            result = boundary_crf_segment(model, text)
        elif model.kind == "crfsuite":
            # Heuristic: boundary CRFs generally emit SENT_END/PARA_END (and don't need newserver tokens).
            try:
                lbls = set(model.model.labels())
            except Exception:
                lbls = set()
            if "SENT_END" in lbls or "PARA_END" in lbls:
                if _is_ocr_structure_boundary_model(model):
                    result = ocr_structure_boundary_segment_crfsuite(model, text)
                else:
                    result = boundary_crf_segment_crfsuite(model, text)
            else:
                if not newserver_url:
                    return jsonify({"error": "Missing newserver_url"}), 400
                tokens = call_newserver(newserver_url, text)
                result = crf_segment(model, tokens)
        else:
            if not newserver_url:
                return jsonify({"error": "Missing newserver_url"}), 400
            tokens = call_newserver(newserver_url, text)
            result = crf_segment(model, tokens)

        return jsonify(result)

    except Exception as e:
        import traceback
        return jsonify({
            "error": repr(e),
            "traceback": traceback.format_exc()
        }), 500


if __name__ == "__main__":
    # Run on port 5055 to avoid collision with newserver on 5000
    print("="*60)
    print("Burmese Sentence Boundary CRF Tester")
    print("="*60)
    print("Starting server on http://127.0.0.1:5055")
    print("Make sure newserver is running on http://127.0.0.1:5000")
    print("="*60)
    app.run(host="127.0.0.1", port=5055, debug=True)
