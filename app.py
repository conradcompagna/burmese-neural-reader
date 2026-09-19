from pathlib import Path
import os
import csv
import html
import re
import json
import math
import sys
import subprocess
import textwrap
import tempfile
import shutil
import time
import tracemalloc
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import io  # NEW: for in-memory PDF reading
import threading
import unicodedata
from typing import Optional, Callable, Dict, List, Any
from flask import Flask, request, jsonify, Response, render_template, redirect, g, send_file
from flask_cors import CORS

# Import the new Burmese transliteration/G2P engine
import burmese_transliteration as g2p_engine

# POS tagger (phrase_chunker) disconnected in this build.
POS_COLORS: dict = {}
POS_DISPLAY_LABELS: dict = {}
# Colors for spaCy UPOS shading (fallback to light gray if missing)
SPACY_UPOS_COLORS = {
    "ADJ": "#fde68a",
    "ADP": "#e0f2fe",
    "ADV": "#fee2e2",
    "AUX": "#e0e7ff",
    "CCONJ": "#cffafe",
    "DET": "#f1f5f9",
    "INTJ": "#fcd34d",
    "NOUN": "#bbf7d0",
    "NUM": "#f5d0fe",
    "PART": "#f4f4f5",
    "PRON": "#e2e8f0",
    "PROPN": "#c7d2fe",
    "PUNCT": "#e5e7eb",
    "SCONJ": "#bae6fd",
    "SYM": "#f3e8ff",
    "VERB": "#fda4af",
    "X": "#d1d5db",
}
# Import UD dependency parser overlay
from ud_overlay import UDParser, overlay_to_json

# PDF text extraction (optional, fail-safe if not installed)
try:
    import pdfplumber  # pip install pdfplumber
except ImportError:
    pdfplumber = None

# DOCX direct text extraction (fallback if PDF conversion unavailable)
try:
    import docx as python_docx  # pip install python-docx
except ImportError:
    python_docx = None
# ---------------------------------------------------------
# CONFIG: adjust these paths on your machine if needed
# ---------------------------------------------------------
APP_ROOT = Path(__file__).resolve().parent
ENV_DATA_ROOT = os.environ.get("BURMESE_DATA_ROOT", "")
DATA_ROOT = Path(ENV_DATA_ROOT) if ENV_DATA_ROOT else APP_ROOT
# Wiktionary Burmese TSV (Kaikki-based, 4 columns with header)
TSV_WIKI_PATH = DATA_ROOT / "Burmese-English Wiktionary dictionary.tsv"
# MMD cleaned TSV (secondary / fallback dictionary)
TSV_MMD_PATH = DATA_ROOT / "MMD_clean.tsv"
# NEW: Pali / classical dictionary TSV (StarDict ? TSV export)
TSV_PALI_PATH = DATA_ROOT / "peu.tsv"
# Grammar lexicon TSV (function words / particles etc.)
TSV_GRAMMAR_PATH = DATA_ROOT / "burmese_grammar_dictionary.tsv"
# Per-user custom dictionary TSV (dynamically created from the web UI)
TSV_USER_PATH = TSV_WIKI_PATH.with_name("user_custom_dictionary.tsv")
# Log files (JSONL) will sit next to the MMD TSV
LOG_PATH = TSV_MMD_PATH.with_name("lookup_log.jsonl")
MISS_LOG_PATH = TSV_MMD_PATH.with_name("lookup_miss_log.jsonl")
UNKNOWN_SEG_LOG_PATH = TSV_MMD_PATH.with_name("lookup_unknown_segment_log.jsonl")
# Persistent per-headword annotations
ANNOTATIONS_PATH = TSV_MMD_PATH.with_name("annotations.json")
ANNOTATIONS: dict[str, str] = {}
# myPOS corpus for POS tagging
MYPOS_CORPUS_PATH = DATA_ROOT / "mypos-ver.3.0.txt"
# Global POS tagger instance (disabled)
POS_TAGGER = None
DICT_POS_LOOKUP: dict[str, set[str]] = {}


def _annotation_key(head: str) -> str:
    """Normalize a headword for use as an annotation key."""
    return normalize_headword(head or "")


def load_annotations() -> None:
    """Load annotations from disk into memory."""
    global ANNOTATIONS
    ANNOTATIONS = {}
    try:
        if ANNOTATIONS_PATH.exists():
            with ANNOTATIONS_PATH.open("r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                tmp: dict[str, str] = {}
                for k, v in data.items():
                    key = _annotation_key(str(k))
                    if key:
                        tmp[key] = str(v)
                ANNOTATIONS = tmp
            else:
                ANNOTATIONS = {}
        else:
            ANNOTATIONS = {}
    except Exception as e:
        print("[WARN] Could not load annotations:", e)
        ANNOTATIONS = {}


def get_annotation(head: str) -> str:
    """Return current note (or '') for a headword."""
    if not head:
        return ""
    if not ANNOTATIONS and ANNOTATIONS_PATH.exists():
        load_annotations()
    key = _annotation_key(head)
    if not key:
        return ""
    return ANNOTATIONS.get(key, "")


def set_annotation(head: str, note: str) -> None:
    """Set or clear an annotation, and write to disk."""
    global ANNOTATIONS
    if not head:
        return
    if not ANNOTATIONS and ANNOTATIONS_PATH.exists():
        load_annotations()
    key = _annotation_key(head)
    if not key:
        return
    note = (note or "").rstrip("\n")
    if not note.strip():
        if key in ANNOTATIONS:
            ANNOTATIONS.pop(key, None)
    else:
        ANNOTATIONS[key] = note
    try:
        with ANNOTATIONS_PATH.open("w", encoding="utf-8") as f:
            json.dump(ANNOTATIONS, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print("[WARN] Failed to write annotations file:", e)


app = Flask(__name__)
CORS(app)
app.config["JSON_AS_ASCII"] = False  # <-- critical
app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024  # 500 MB
# Production: cache static files for 1 hour
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 3600

# ---------------- Debug endpoint gating ----------------
# Disable debug endpoints by default for production. Enable with:
#   set ENABLE_DEBUG_ENDPOINTS=1
DEBUG_ENDPOINTS_ENABLED = str(os.environ.get("ENABLE_DEBUG_ENDPOINTS", "")).strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
_DEBUG_PATHS = {
    "/segment_debug",
    "/segment_text",
    "/debug_ud_parser",
    "/debug_ud_parser_ui",
    "/debug/parser",
    "/debug/displacy",
    "/debug/dict_check",
    "/debug/pos",
    "/debug/spell",
    "/debug/unknowns_summary",
    "/dep_tree_view.js",
    "/whitespace_boundaries.js",
    "/myudtree.conllu",
    "/myudtree.meta",
    "/myudtree.sentence",
}


@app.before_request
def _block_debug_endpoints():
    if DEBUG_ENDPOINTS_ENABLED:
        return None
    path = request.path or ""
    if path.startswith("/debug") or path in _DEBUG_PATHS:
        # Hide debug endpoints in production.
        return jsonify({"ok": False, "error": "debug_disabled"}), 404


# ---------------- Memory tracking (debug) ----------------
MEM_TRACE_ENABLED = False
MEM_TRACE_PY = False  # set True to track Python alloc peaks via tracemalloc
MEM_TRACE_PATHS = {"/lookup", "/lookup_dp_only"}
MEM_SPIKE_LOG = deque(maxlen=200)
_MEM_TRACE_LOCK = threading.Lock()


# Dictionary storage is centralized in the segmenter's StackedDictionary.
# No per-source globals or merged copies are kept in memory.
# ---------------------- helpers --------------------------
def contains_burmese(s: str) -> bool:
    """Return True if any Myanmar-range char is in s."""
    return any(0x1000 <= ord(ch) <= 0x109F for ch in s)


def burmese_char_count(s: str) -> int:
    """Count Myanmar-range characters in s."""
    return sum(1 for ch in s if 0x1000 <= ord(ch) <= 0x109F)


def clean_html(s: str) -> str:
    """Strip basic HTML tags and normalize whitespace."""
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def normalize_burmese(s: str) -> str:
    """
    Simple normalization for Burmese text for INTERNAL use only
    (dictionary / LM / grammar keys). Currently: NFC.
    IMPORTANT: do NOT call this on the page text that you send
    back to the frontend for segmentation; that must stay
    byte-identical so the browser can map segments to DOM text.
    """
    if not s:
        return s
    s = unicodedata.normalize("NFC", s)
    return s


def normalize_headword(s: str) -> str:
    """
    Normalize a headword for dictionary keying:
    - apply basic Burmese normalization,
    - KEEP ONLY Myanmar-range characters (drop stray ASCII like ')' etc.)
    """
    s = normalize_burmese(s)
    s = "".join(ch for ch in s if 0x1000 <= ord(ch) <= 0x109F)
    return s.strip()


# ---------------------- Reading SRS (flashcard engine) --------------------------
@dataclass
class TokenStats:
    head: str
    display: str
    total_seen: int = 0
    first_seen: Optional[datetime] = None
    last_seen: Optional[datetime] = None

    def to_dict(self) -> dict:
        return {
            "head": self.head,
            "display": self.display,
            "total_seen": self.total_seen,
            "first_seen": self.first_seen.isoformat() if self.first_seen else None,
            "last_seen": self.last_seen.isoformat() if self.last_seen else None,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "TokenStats":
        def _dt(val):
            if not val:
                return None
            try:
                return datetime.fromisoformat(val)
            except Exception:
                return None

        return cls(
            head=data.get("head", "") or "",
            display=data.get("display", "") or "",
            total_seen=int(data.get("total_seen") or 0),
            first_seen=_dt(data.get("first_seen")),
            last_seen=_dt(data.get("last_seen")),
        )


@dataclass
class ReviewState:
    repetitions: int = 0
    interval_days: float = 0.0
    ease_factor: float = 2.5
    due: Optional[datetime] = None
    last_review: Optional[datetime] = None

    def to_dict(self) -> dict:
        return {
            "repetitions": self.repetitions,
            "interval_days": self.interval_days,
            "ease_factor": self.ease_factor,
            "due": self.due.isoformat() if self.due else None,
            "last_review": self.last_review.isoformat() if self.last_review else None,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "ReviewState":
        def _dt(val):
            if not val:
                return None
            try:
                return datetime.fromisoformat(val)
            except Exception:
                return None

        return cls(
            repetitions=int(data.get("repetitions") or 0),
            interval_days=float(data.get("interval_days") or 0.0),
            ease_factor=float(data.get("ease_factor") or 2.5),
            due=_dt(data.get("due")),
            last_review=_dt(data.get("last_review")),
        )


@dataclass
class CardState:
    head: str
    stats: TokenStats
    review: ReviewState

    def to_dict(self) -> dict:
        return {
            "head": self.head,
            "stats": self.stats.to_dict(),
            "review": self.review.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "CardState":
        head = data.get("head", "") or ""
        stats_data = data.get("stats") or {}
        review_data = data.get("review") or {}
        stats = TokenStats.from_dict(stats_data)
        review = ReviewState.from_dict(review_data)
        return cls(head=head, stats=stats, review=review)


class ReadingSRS:
    """On-disk spaced-repetition engine keyed by normalized Burmese headwords."""

    def __init__(self, state_path: Path):
        self.state_path = Path(state_path)
        self.cards: dict[str, CardState] = {}
        self._loaded = False

    # ---- persistence -----------------------------------------------------
    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        if self.state_path.exists():
            try:
                raw = self.state_path.read_text("utf-8")
                data = json.loads(raw)
                if isinstance(data, dict):
                    for head, cdata in data.items():
                        try:
                            self.cards[head] = CardState.from_dict(cdata)
                        except Exception as e:
                            print("[WARN] bad SRS card for", head, ":", e)
            except Exception as e:
                print("[WARN] Failed to load reading SRS state:", e)
                self.cards = {}
        self._loaded = True

    def _save(self) -> None:
        if not self._loaded:
            return
        if not READING_SRS_SAVE_ENABLED:
            return
        try:
            payload = {head: card.to_dict() for head, card in self.cards.items()}
            self.state_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as e:
            print("[WARN] Failed to save reading SRS state:", e)

    # ---- core operations -------------------------------------------------
    def _normalize(self, token: str) -> str:
        """Use the same normalization as dictionary headwords."""
        return normalize_headword(token or "")

    def observe_tokens(self, tokens, autosave: bool = True) -> None:
        """Record raw exposure counts from whatever the user has read.
        `tokens` should already be dictionary-known segments/headwords.
        """
        self._ensure_loaded()
        if not tokens:
            return
        now = datetime.utcnow()
        for t in tokens:
            head = self._normalize(t)
            if not head:
                continue
            card = self.cards.get(head)
            if card is None:
                stats = TokenStats(
                    head=head,
                    display=t,
                    total_seen=1,
                    first_seen=now,
                    last_seen=now,
                )
                review = ReviewState()
                card = CardState(head=head, stats=stats, review=review)
                self.cards[head] = card
            else:
                card.stats.total_seen += 1
                card.stats.last_seen = now
                card.stats.display = t  # keep latest surface form
        if autosave:
            self._save()

    # ---- scheduling ------------------------------------------------------
    def _select_next_card(self, now: Optional[datetime] = None) -> Optional[CardState]:
        self._ensure_loaded()
        if now is None:
            now = datetime.utcnow()
        due: list[CardState] = []
        new: list[CardState] = []
        fallback: list[CardState] = []
        for card in self.cards.values():
            rs = card.review
            st = card.stats
            if rs.repetitions > 0 and rs.due is not None:
                if rs.due <= now:
                    due.append(card)
                else:
                    fallback.append(card)
            else:
                new.append(card)
        if due:
            due.sort(key=lambda c: (c.review.due, -(c.stats.total_seen or 0)))
            return due[0]
        if new:
            new.sort(
                key=lambda c: (
                    -(c.stats.total_seen or 0),
                    c.stats.first_seen or now,
                )
            )
            return new[0]
        if fallback:
            fallback.sort(key=lambda c: c.review.due or now)
            return fallback[0]
        return None

    def get_next_card(self) -> Optional[dict]:
        card = self._select_next_card()
        if card is None:
            return None
        return {
            "head": card.head,
            "display": card.stats.display,
            "is_new": card.review.repetitions == 0,
            "stats": card.stats.to_dict(),
            "review": card.review.to_dict(),
        }

    # ---- grading ---------------------------------------------------------
    def _update_sm2(
        self, review: ReviewState, quality: int, now: Optional[datetime] = None
    ) -> None:
        """SM-2 style update.
        quality: 0ÃÂ¢Ã¢âÂ¬Ã¢â¬Å5, where <3 = failure, =3 = success.
        Here we only use 4 (knew) or 2 (didn't know).
        """
        if now is None:
            now = datetime.utcnow()
        q = max(0, min(5, int(quality)))
        if q < 3:
            review.repetitions = 0
            review.interval_days = 1.0
        else:
            if review.repetitions == 0:
                review.interval_days = 1.0
            elif review.repetitions == 1:
                review.interval_days = 3.0
            else:
                review.interval_days = review.interval_days * review.ease_factor
            review.repetitions += 1
        ef = review.ease_factor
        ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
        if ef < 1.3:
            ef = 1.3
        review.ease_factor = ef
        review.last_review = now
        review.due = now + timedelta(days=review.interval_days)

    def grade_card(self, head: str, knew: bool, autosave: bool = True) -> None:
        self._ensure_loaded()
        norm = self._normalize(head)
        if not norm:
            return
        card = self.cards.get(norm)
        if card is None:
            return
        quality = 4 if knew else 2
        self._update_sm2(card.review, quality)
        if autosave:
            self._save()


# On-disk state file for the reading SRS
READING_SRS_STATE_PATH = Path("reading_srs_state.json")
# Disable persistence to reading_srs_state.json (set True to re-enable).
READING_SRS_SAVE_ENABLED = False
READING_SRS = ReadingSRS(READING_SRS_STATE_PATH)

# ================== UD DEPENDENCY PARSER ====================
UD_MODEL_PATH = DATA_ROOT / "model-best"
UD_PARSER = None
STANDALONE_NER_MODEL_PATH = Path(
    os.environ.get(
        "STANDALONE_NER_MODEL_PATH",
        str(Path(__file__).parent / "standalonener" / "model-best"),
    )
)
STANDALONE_NER = None
STANDALONE_NER_ERROR = ""
STANZA_RESOURCES_DIR = os.environ.get(
    "STANZA_RESOURCES_DIR",
    os.environ.get("STANZA_RESOURCES", str((APP_ROOT / "stanza_resources").resolve())),
)
STANZA_NER = None
STANZA_NER_ERROR = ""
STANZA_TOKENIZER = None
STANZA_TOKENIZER_ERROR = ""
# Cache for NER doc to avoid redundant tokenization when NER is enabled
# Keyed by text so multiple concurrent lookups don't overwrite each other
_STANZA_NER_DOC_CACHE: dict[str, object] = {}  # text -> doc
_STANZA_NER_DOC_CACHE_LOCK = threading.Lock()


def init_ud_parser():
    """Initialize the UD spaCy parser (lazy load on first use)."""
    global UD_PARSER
    if UD_PARSER is not None:
        return UD_PARSER
    try:
        UD_PARSER = UDParser(str(UD_MODEL_PATH))
        print(f"[INFO] UD parser loaded from {UD_MODEL_PATH}")
        return UD_PARSER
    except Exception as e:
        print(f"[WARN] UD parser disabled: {e}")
        UD_PARSER = None
        return None


def build_ud_overlay_for_segments(
    segments: list[str],
    dict_fills: list[dict | None] | None = None,
    original_text: str | None = None,
    pos_override: bool = True,
    stanza_ner: bool = False,
    precomputed_ner_ents: list[dict] | None = None,
    collapse_ner_spans: bool = False,
    island_spans: list[tuple[int, int]] | None = None,
) -> dict:
    """
    Build UD dependency overlay for a list of segments.

    Args:
        segments: Token segments
        dict_fills: Dictionary fill data per segment
        original_text: Original raw text (for NER if needed)
        pos_override: Enable dictionary POS override
        stanza_ner: Enable stanza NER (only used if precomputed_ner_ents is None)
        precomputed_ner_ents: Pre-computed NER entities from early pipeline stage
        collapse_ner_spans: If True, collapse NER spans into single tokens for parsing
        island_spans: Optional island spans for filtering NER spans
    """
    parser = init_ud_parser()
    if parser is None:
        return {
            "ok": False,
            "tokens": [],
            "edges": [],
            "roots": [],
            "doc2seg": [],
            "seg2doc": [-1] * len(segments),
            "error": "ud_disabled",
        }
    try:
        # For analysis only: drop stray combining-mark tokens, but keep the original
        # `segments` for UI alignment/mapping.
        if precomputed_ner_ents is not None:
            precomputed_ner_ents = _filter_ner_entities_excluding_last_islands(
                segments, island_spans, precomputed_ner_ents
            )
        overlay = parser.build_overlay(
            segments,
            keep_fn=_spacy_keep_fn,
            dict_fills=dict_fills,
            original_text=original_text,
            pos_override=pos_override,
            precomputed_ner_ents=precomputed_ner_ents,
            collapse_ner_spans=collapse_ner_spans,
        )
        overlay_json = overlay_to_json(overlay)
        if overlay_json.get("ok"):
            # Use precomputed NER entities if provided (avoids redundant NER call)
            if precomputed_ner_ents is not None:
                overlay_json["ents"] = precomputed_ner_ents
            else:
                # Fall back to running NER here if not precomputed
                stanza_ran = False
                if stanza_ner:
                    text_for_ner = original_text or ""
                    if text_for_ner:
                        ner_nlp = init_stanza_ner()
                        if ner_nlp is not None:
                            try:
                                doc = ner_nlp(text_for_ner)
                                ents = getattr(doc, "ents", []) or []
                                overlay_json["ents"] = _stanza_ents_to_segments(
                                    text_for_ner, segments, ents
                                )
                                stanza_ran = True
                            except Exception as e:
                                print(f"[WARN] stanza NER failed: {e}")
                    else:
                        overlay_json["ents"] = []
                        stanza_ran = True

                # If stanza wasn't used, fall back to standalone spaCy NER.
                if not stanza_ran and not parser.nlp.has_pipe("ner"):
                    ner_nlp = init_standalone_ner()
                    if ner_nlp is not None:
                        from spacy.tokens import Doc  # type: ignore

                        spaces = [True] * (len(segments) - 1) + [False] if segments else []
                        doc = Doc(ner_nlp.vocab, words=segments, spaces=spaces)
                        doc = ner_nlp(doc)
                        ents_out = []
                        for ent in getattr(doc, "ents", []):
                            if ent is None:
                                continue
                            ents_out.append(
                                {
                                    "start": int(ent.start),
                                    "end": int(ent.end),
                                    "label": ent.label_ or "",
                                    "text": ent.text or "",
                                }
                            )
                        overlay_json["ents"] = ents_out
            if overlay_json.get("ents") is not None:
                overlay_json["ents"] = _filter_ner_entities_excluding_last_islands(
                    segments, island_spans, overlay_json["ents"]
                )
        return overlay_json
    except Exception as e:
        return {
            "ok": False,
            "tokens": [],
            "edges": [],
            "roots": [],
            "doc2seg": [],
            "seg2doc": [-1] * len(segments),
            "error": str(e),
        }


def init_standalone_ner():
    """Standalone NER disabled."""
    return None


def init_stanza_ner():
    """Lazy-load stanza NER pipeline (raw-text)."""
    global STANZA_NER, STANZA_NER_ERROR
    if STANZA_NER is not None:
        return STANZA_NER
    if STANZA_NER_ERROR:
        return None
    try:
        import stanza  # type: ignore

        STANZA_NER = stanza.Pipeline(
            lang="my",
            processors="tokenize,ner",
            dir=STANZA_RESOURCES_DIR,
            tokenize_no_ssplit=True,
            verbose=False,
        )
        print(f"[INFO] Stanza NER loaded from {STANZA_RESOURCES_DIR}")
        return STANZA_NER
    except Exception as e:
        STANZA_NER_ERROR = f"{type(e).__name__}: {e}"
        print(f"[WARN] stanza NER disabled: {STANZA_NER_ERROR}")
        return None


def init_stanza_tokenizer():
    """Stanza tokenizer-only pipeline disabled."""
    return None


def _build_segment_char_spans(text: str, segments: list[str]) -> list[tuple[int, int] | None]:
    """Map segments to character spans in the raw text."""
    spans: list[tuple[int, int] | None] = []
    if not text:
        return [None] * len(segments)
    idx = 0
    for seg in segments:
        if not seg:
            spans.append(None)
            continue
        pos = text.find(seg, idx)
        if pos < 0:
            spans.append(None)
            continue
        start = pos
        end = pos + len(seg)
        spans.append((start, end))
        idx = end
    return spans


def _stanza_ents_to_segments(text: str, segments: list[str], ents: list[Any]) -> list[dict]:
    """Convert stanza char-offset ents to segment-index spans."""
    if not ents:
        return []
    seg_spans = _build_segment_char_spans(text, segments)
    out: list[dict] = []
    for ent in ents:
        start_char = getattr(ent, "start_char", None)
        end_char = getattr(ent, "end_char", None)
        if start_char is None or end_char is None:
            continue
        seg_start = None
        seg_end = None
        for i, span in enumerate(seg_spans):
            if not span:
                continue
            s, e = span
            if e <= start_char or s >= end_char:
                continue
            if seg_start is None:
                seg_start = i
            seg_end = i
        if seg_start is None:
            continue
        label = getattr(ent, "type", "") or getattr(ent, "label", "") or ""
        out.append(
            {
                "start": seg_start,
                "end": seg_end + 1,
                "label": label,
                "text": getattr(ent, "text", "") or "",
            }
        )
    return out


def _is_myanmar_word_char(ch: str) -> bool:
    cp = ord(ch)
    if _is_myanmar_core(cp) or _is_myanmar_extended(cp):
        return ch not in MYANMAR_PUNCT
    return False


def _is_myanmar_word_token(token: str) -> bool:
    if not token or token in MYANMAR_PUNCT:
        return False
    for ch in token:
        if not _is_myanmar_word_char(ch):
            return False
    return True


def _split_myanmar_runs(text: str, start: int, end: int) -> list[tuple[str, int, int]]:
    out: list[tuple[str, int, int]] = []
    if not text or start >= end:
        return out
    start = max(start, 0)
    end = min(end, len(text))
    run_start: int | None = None
    for i in range(start, end):
        if _is_myanmar_word_char(text[i]):
            if run_start is None:
                run_start = i
        else:
            if run_start is not None and i > run_start:
                out.append((text[run_start:i], run_start, i))
            run_start = None
    if run_start is not None and end > run_start:
        out.append((text[run_start:end], run_start, end))
    return out


def _collect_myanmar_punct_tokens(text: str) -> list[tuple[str, int, int]]:
    """Return Myanmar punctuation tokens with spans (kept for UD sentence boundaries)."""
    return [(ch, i, i + 1) for i, ch in enumerate(text or "") if ch in MYANMAR_PUNCT]


def _segment_text_stanza_ner_with_spans(text: str) -> list[tuple[str, int, int]] | None:
    """Tokenize with stanza NER pipeline and cache the doc for reuse."""
    text = text or ""
    if not text:
        return []
    nlp = init_stanza_ner()
    if nlp is None:
        return None
    try:
        doc = nlp(text)
        with _STANZA_NER_DOC_CACHE_LOCK:
            _STANZA_NER_DOC_CACHE[text] = doc
    except Exception as e:
        print(f"[WARN] stanza NER tokenization failed: {e}")
        return None
    out: list[tuple[str, int, int]] = []
    for sent in getattr(doc, "sentences", []) or []:
        for tok in getattr(sent, "tokens", []) or []:
            start = getattr(tok, "start_char", None)
            end = getattr(tok, "end_char", None)
            if start is None or end is None or start >= end:
                continue
            out.extend(_split_myanmar_runs(text, int(start), int(end)))
    if not out and any(_is_myanmar_word_char(ch) for ch in text):
        return None
    out.sort(key=lambda t: t[1])
    return out


def _sentence_spans_from_segments(segments: list[str]) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    if not segments:
        return spans
    start = 0
    for i, tok in enumerate(segments):
        if tok == "\u104b":  # Myanmar period
            spans.append((start, i + 1))
            start = i + 1
    if start < len(segments):
        spans.append((start, len(segments)))
    return spans


def _build_island_spans_from_segments(segments: list[str]) -> list[tuple[int, int]]:
    island_spans: list[tuple[int, int]] = []
    if not segments:
        return island_spans
    island_start: int | None = None
    for i, seg in enumerate(segments):
        if not seg or not _is_myanmar_word_token(seg):
            if island_start is not None:
                island_spans.append((island_start, i))
                island_start = None
            continue
        if island_start is None:
            island_start = i
    if island_start is not None:
        island_spans.append((island_start, len(segments)))
    return island_spans


def _build_island_spans_from_token_spans(
    segments: list[str],
    spans: list[tuple[int, int]],
) -> list[tuple[int, int]]:
    island_spans: list[tuple[int, int]] = []
    if not segments:
        return island_spans
    island_start: int | None = None
    prev_end: int | None = None
    for i, (seg, span) in enumerate(zip(segments, spans)):
        if not span or not _is_myanmar_word_token(seg):
            if island_start is not None:
                island_spans.append((island_start, i))
                island_start = None
            prev_end = None
            continue
        s, e = span
        if island_start is None:
            island_start = i
        elif prev_end is not None and s != prev_end:
            island_spans.append((island_start, i))
            island_start = i
        prev_end = e
    if island_start is not None:
        island_spans.append((island_start, len(segments)))
    return island_spans


def _filter_ner_entities_excluding_last_islands(
    segments: list[str],
    island_spans: list[tuple[int, int]] | None,
    ner_entities: list[dict] | None,
) -> list[dict]:
    """Drop NER spans that touch the last island in a sentence."""
    if not ner_entities or not segments:
        return []
    islands = island_spans or _build_island_spans_from_segments(segments)
    if not islands:
        return [ent for ent in ner_entities if isinstance(ent, dict)]
    sentence_spans = _sentence_spans_from_segments(segments)
    if not sentence_spans:
        sentence_spans = [(0, len(segments))]

    last_islands: list[tuple[int, int, tuple[int, int] | None]] = []
    island_idx = 0
    for sent_start, sent_end in sentence_spans:
        last: tuple[int, int] | None = None
        while island_idx < len(islands) and islands[island_idx][1] <= sent_start:
            island_idx += 1
        j = island_idx
        while j < len(islands):
            i_start, i_end = islands[j]
            if i_start >= sent_end:
                break
            last = (i_start, i_end)
            j += 1
        last_islands.append((sent_start, sent_end, last))
        island_idx = j

    def _last_island_for_start(idx: int) -> tuple[int, int] | None:
        for sent_start, sent_end, last in last_islands:
            if idx >= sent_start and idx < sent_end:
                return last
        return None

    filtered: list[dict] = []
    for ent in ner_entities:
        if not isinstance(ent, dict):
            continue
        start_idx = ent.get("start")
        end_idx = ent.get("end")
        if not isinstance(start_idx, int) or not isinstance(end_idx, int) or end_idx <= start_idx:
            filtered.append(ent)
            continue
        last_island = _last_island_for_start(start_idx)
        if last_island is None:
            filtered.append(ent)
            continue
        island_start, island_end = last_island
        if start_idx < island_end and end_idx > island_start:
            continue
        filtered.append(ent)
    return filtered


def _run_stanza_ner_early(
    text: str,
    segments: list[str],
    fills_by_seg: list[dict | None],
    island_spans: list[tuple[int, int]] | None = None,
) -> tuple[list, list[dict]]:
    """
    Run stanza NER on original text early in the pipeline.

    Returns:
        Tuple of (raw_stanza_entities, segment_mapped_entities).
        Raw entities are needed for re-mapping after dict fill splitting.
        Also modifies fills_by_seg in-place to mark ner_protected/ner_label.

    If the NER doc was already cached by _segment_text_stanza_ner_with_spans,
    reuses that doc instead of running NER again (avoiding redundant tokenization).
    """
    # Check cache first - reuse doc from tokenization phase if available
    doc = None
    with _STANZA_NER_DOC_CACHE_LOCK:
        doc = _STANZA_NER_DOC_CACHE.pop(text, None)

    # If no cache hit, run NER now
    if doc is None:
        ner_nlp = init_stanza_ner()
        if ner_nlp is None:
            return [], []
        try:
            doc = ner_nlp(text)
        except Exception as e:
            print(f"[WARN] Stanza NER early processing failed: {e}")
            return [], []

    try:
        ents = getattr(doc, "ents", []) or []
        if not ents:
            return [], []

        # Convert entity char spans to segment indices
        ent_segments = _stanza_ents_to_segments(text, segments, ents)
        if ent_segments:
            ent_segments = _filter_ner_entities_excluding_last_islands(
                segments, island_spans, ent_segments
            )

        # Mark fills for segments in NER entities
        for ent_info in ent_segments:
            start_idx = ent_info.get("start")
            end_idx = ent_info.get("end")
            label = ent_info.get("label", "")

            if start_idx is None or end_idx is None:
                continue

            # Mark all segments in this entity span
            for seg_idx in range(start_idx, end_idx):
                if seg_idx >= len(fills_by_seg):
                    continue
                if fills_by_seg[seg_idx] is None:
                    fills_by_seg[seg_idx] = {}
                fills_by_seg[seg_idx]["ner_protected"] = True
                fills_by_seg[seg_idx]["ner_label"] = label

        # Return both raw entities and initially mapped entities
        return ents, ent_segments
    except Exception as e:
        print(f"[WARN] Stanza NER early processing failed: {e}")
        return [], []


def _apply_ner_entities_to_fills(
    fills_by_seg: list[dict | None],
    ner_entities: list[dict] | None,
) -> None:
    """Apply NER spans to fills_by_seg, clearing any stale NER flags first."""
    if not fills_by_seg:
        return
    for fill in fills_by_seg:
        if fill:
            fill.pop("ner_protected", None)
            fill.pop("ner_label", None)
    if not ner_entities:
        return
    for ent in ner_entities:
        start_idx = ent.get("start")
        end_idx = ent.get("end")
        label = ent.get("label", "") or ""
        if not isinstance(start_idx, int) or not isinstance(end_idx, int):
            continue
        if end_idx <= start_idx:
            continue
        for seg_idx in range(start_idx, min(end_idx, len(fills_by_seg))):
            if fills_by_seg[seg_idx] is None:
                fills_by_seg[seg_idx] = {}
            fills_by_seg[seg_idx]["ner_protected"] = True
            if label:
                fills_by_seg[seg_idx]["ner_label"] = label


# Segmentation pipeline is fixed: stanza NER tokenizer -> DP resegmentation.

# ---------------- Strict Burmese normalization for segmentation ----------------
MYANMAR_EXTENDED_A_START = 0xAA60
MYANMAR_EXTENDED_A_END = 0xAA7F
MYANMAR_EXTENDED_B_START = 0xA9E0
MYANMAR_EXTENDED_B_END = 0xA9FF
# Burmese section punctuation (?, ?)
MYANMAR_PUNCT = {"\u104a", "\u104b"}
# ASCII punctuation frequently found in OCR / romanized streams. We keep these as
# standalone tokens during segmentation so boundary models can learn from them.
ASCII_PUNCT = set(".,;:!?()[]{}\"'`|/\\-")
# Zero-width junk that often appears in OCR / copied text
ZERO_WIDTH_CHARS = {"\u200b", "\u200c", "\u200d", "\ufeff"}
# Combining marks that should only appear once per syllable
SINGLETON_COMBINING = {
    "\u102b",
    "\u102c",  # tall AA, AA
    "\u102d",
    "\u102e",  # i, ii
    "\u102f",
    "\u1030",  # u, uu
    "\u1032",  # ai
    "\u1036",  # anusvara
    "\u1037",  # dot below
    "\u1038",  # visarga
    "\u103a",  # asat
}


def _is_myanmar_core(cp: int) -> bool:
    """Core Myanmar block U+1000ÃÂ¢Ã¢âÂ¬Ã¢â¬ÅU+109F."""
    return 0x1000 <= cp <= 0x109F


def _is_myanmar_extended(cp: int) -> bool:
    """Myanmar Extended-A/B."""
    return (MYANMAR_EXTENDED_A_START <= cp <= MYANMAR_EXTENDED_A_END) or (
        MYANMAR_EXTENDED_B_START <= cp <= MYANMAR_EXTENDED_B_END
    )


USER_TEXT_OVERRIDES: list[tuple[str, str]] = []
MANUAL_TEXT_OVERRIDES: list[tuple[str, str]] = []

TSV_USER_TEXT_OVERRIDE_PATH = TSV_WIKI_PATH.with_name("user_text_overrides.tsv")


def _apply_manual_text_overrides(text: str) -> str:
    for src, dst in MANUAL_TEXT_OVERRIDES:
        if src in text:
            text = text.replace(src, dst)
    return text


def normalize_burmese_for_segmentation(
    text: str,
    extended_hits: set[str] | None = None,
) -> str:
    """
    Identity transform so that segmentation operates on raw page text.
    We keep this separate from `normalize_burmese` so that we can
    freely change internal NFC/cleanup behaviour without ever
    touching the bytes the frontend sees.

    DISABLED (2026-01-20): Disabled manual overrides, zero-width filtering,
    and combining mark validation to diagnose normalization desync issues.
    """
    if not text:
        return text

    # DISABLED: text = _apply_manual_text_overrides(text)

    out: list[str] = []
    in_cluster = False  # have we seen a Myanmar base in the current cluster?
    chars = list(text)
    n = len(chars)
    for idx, ch in enumerate(chars):
        # DISABLED: if ch in ZERO_WIDTH_CHARS:
        #     continue
        cp = ord(ch)
        if extended_hits is not None and 0xAA60 <= cp <= 0xAA7F:
            extended_hits.add(ch)

        if ch in MYANMAR_PUNCT:
            out.append(ch)
            in_cluster = False
            continue

        if _is_myanmar_core(cp) or _is_myanmar_extended(cp):
            # DISABLED: if is_combining_mark(ch):
            #     if in_cluster:
            #         out.append(ch)
            #     # else: drop stray combining mark
            #     continue
            out.append(ch)
            in_cluster = True
            continue

        # Non-Myanmar resets cluster state but is preserved for UI alignment.
        out.append(ch)
        in_cluster = False

    return "".join(out)


POS_WHITELIST_RE = re.compile(
    r"^(n|v|adj|adv|num|pron|aux|prep|postp|conj|interj|part|m|nm)\b",
    re.I,
)


def normalize_pos(pos: str) -> str:
    pos = (pos or "").strip()
    if not pos:
        return ""
    if not POS_WHITELIST_RE.match(pos):
        # junk like "cocoa.", "domino", etc ? drop
        return ""
    return pos


def is_combining_mark(ch: str) -> bool:
    """
    IMPROVED: Enhanced detection of Burmese combining marks.
    """
    code = ord(ch)
    # Burmese combining vowels/medials/signs
    if 0x102B <= code <= 0x103E:
        return True
    if 0x1056 <= code <= 0x1059:
        return True
    if 0x105E <= code <= 0x1060:
        return True
    if 0x1062 <= code <= 0x1064:
        return True
    if 0x1067 <= code <= 0x106D:
        return True
    if 0x1071 <= code <= 0x1074:
        return True
    if 0x1082 <= code <= 0x108D:
        return True
    if code == 0x108F:
        return True
    if code == 0x1094:
        return True
    if 0x109A <= code <= 0x109D:
        return True
    # Additional marks: anusvara (?), visarga (?), virama (?)
    if code in (0x1036, 0x1038, 0x1039):
        return True
    return False


# ---------------- spaCy input hygiene (analysis-only) ----------------
# Characters that can serve as syllable bases (not modifiers)
_MYANMAR_BASE_CONSONANTS = set("ကခဂဃငစဆဇဈဉညဋဌဍဎဏတထဒဓနပဖဗဘမယရလဝသဟဠအ")
_MYANMAR_INDEPENDENT_VOWELS = set("ဣဤဥဦဧဩဪ")
_MYANMAR_BASE_CHARS = _MYANMAR_BASE_CONSONANTS | _MYANMAR_INDEPENDENT_VOWELS
_MYANMAR_NUMERALS = set("၀၁၂၃၄၅၆၇၈၉")
_MYANMAR_ABBREVIATIONS = set("၌၍၎၏")
_VIRAMA = "\u1039"  # ္ - stacker that makes following consonant a modifier


def _has_base_consonant(tok: str) -> bool:
    """
    Return True if the token has at least one BASE consonant or independent vowel.

    A base consonant is one that is NOT immediately preceded by virama (္).
    Stacked consonants (after virama) are modifiers, not bases.

    Examples:
      - "ကား" → True (က is a base consonant)
      - "္ဖ္ယ" → False (both ဖ and ယ are preceded by virama, so no base)
      - "သင်္ဘော" → True (သ and င are bases, ္ဘ is stacked)
      - "ိုး" → False (only combining marks, no consonant at all)
    """
    if not tok:
        return False
    for i, ch in enumerate(tok):
        if ch in _MYANMAR_BASE_CHARS:
            # Check if preceded by virama (making it a stacked consonant, not a base)
            if i > 0 and tok[i - 1] == _VIRAMA:
                continue  # This is a stacked consonant, skip it
            return True  # Found a base consonant
    return False


def _has_combining_marks(tok: str) -> bool:
    """Return True if the token contains any combining marks (diacritics)."""
    if not tok:
        return False
    for ch in tok:
        if is_combining_mark(ch):
            return True
    return False


def _is_spacy_clean_token(tok: str) -> bool:
    """
    Return True if a segment should be passed to spaCy for POS/UD analysis.

    DISABLED (2026-02): Previously filtered out combining-mark-only tokens,
    but this created gaps in dependency parses. Now allows all tokens through
    so the NLP pipeline sees complete sentences, even with OCR-damaged tokens.

    Old behavior (for reference):
      - Filtered: tokens with only combining marks (bare diacritics)
      - Filtered: tokens where all consonants are stacked (preceded by virama)
      - Allowed: normal words, numerals, abbreviations, punctuation
    """
    tok = tok or ""
    if not tok:
        return False
    # Allow all non-empty tokens through to NLP pipeline
    return True


def _spacy_keep_fn(tok: str) -> bool:
    # Allow all tokens through to NLP pipeline, including combining-mark-only tokens.
    # These "broken" tokens are often part of sentences (OCR damage) and gaps in the
    # dependency parse are more confusing than letting the model see them.
    return True


def _write_jsonl(path: Path, rec: dict):
    """Append one JSON record as a single line to a JSONL file."""
    try:
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception as e:
        print(f"Log error for {path.name}:", e)


def log_lookup(q: str, segments: list, results: list):
    """
    Append one JSON line to lookup_log.jsonl with:
    - time
    - q (raw query)
    - segments (list of segments from segmenter)
    - results (list of dictionary entries actually returned)
    """
    rec = {
        "time": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "q": q,
        "segments": segments,
        "results": results,
    }
    _write_jsonl(LOG_PATH, rec)


def log_miss(q: str, segments: list):
    """
    Append one JSON line to lookup_miss_log.jsonl for lookups
    that produced no dictionary results (or only unknowns).
    """
    rec = {
        "time": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "q": q,
        "segments": segments,
    }
    _write_jsonl(MISS_LOG_PATH, rec)


def log_unknown_segment(q: str, segment: str, kind: str):
    """
    Log segments that are not in the dictionary.
    kind is just a tag, e.g. "primary".
    """
    rec = {
        "time": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "q": q,
        "segment": segment,
        "kind": kind,
    }
    _write_jsonl(UNKNOWN_SEG_LOG_PATH, rec)


POS_WHITELIST_RE = re.compile(
    r"^(n|noun|v|verb|adj|adjective|adv|adverb|num|number|pron|pronoun|aux|auxiliary|prep|preposition|postp|postposition|conj|conjunction|interj|interjection|part|particle|det|determiner|prefix|suffix|m|nm)\b",
    re.I,
)


def normalize_pos(pos: str) -> str:
    pos = (pos or "").strip()
    if not pos:
        return ""
    if not POS_WHITELIST_RE.match(pos):
        # junk like "cocoa.", "domino", etc ? drop
        return ""
    return pos


# ---- NEW: map raw POS -> CASE / VPART / LINK / BOUND ----
def get_meta_pos(pos: str) -> str:
    """
    Collapse raw POS into four meta-classes:
    CASE  - postpositions / preposition-like case markers
    VPART ÃÂ¢Ã¢âÂ¬Ã¢â¬Å particles (verbal / clausal)
    LINK  ÃÂ¢Ã¢âÂ¬Ã¢â¬Å conjunctions, determiners
    BOUND ÃÂ¢Ã¢âÂ¬Ã¢â¬Å prefix / suffix (bound morphology)
    """
    p = (pos or "").lower()
    if not p:
        return ""
    # CASE markers
    if p.startswith("postp") or p.startswith("prep"):
        return "CASE"
    # particles: MMD 'Part/part', WIKI 'particle'
    if p.startswith("part"):
        return "VPART"
    # linkers: conj, det
    if p.startswith("conj") or p.startswith("det"):
        return "LINK"
    # bound morphemes
    if p.startswith("prefix") or p.startswith("suffix"):
        return "BOUND"
    return ""


# ============================================================================
# EMBEDDED SEGMENTER (from segmenter.py + config/server_integration)
# ============================================================================
# Aliases to reuse existing helpers
def _normalize_burmese(s: str) -> str:
    return normalize_burmese(s)


def _normalize_headword(s: str) -> str:
    return normalize_headword(s)


def _is_combining_mark(ch: str) -> bool:
    return is_combining_mark(ch)


def _contains_burmese(s: str) -> bool:
    return contains_burmese(s)


def build_syllable_clusters(text: str) -> tuple[list[str], list[int]]:
    """
    Wrapper over the local syllable cluster builder used by the new segmenter.
    """
    clusters, starts, _ = _build_clusters(text)
    return clusters, starts


def count_syllables(text: str) -> int:
    """Count syllable clusters in text."""
    if not text or not _contains_burmese(text):
        return len(text) if text else 0
    clusters, _ = build_syllable_clusters(text)
    return len(clusters)


def _get_unigram_cost(norm_word: str, fallback_lm=None) -> tuple[float | None, bool]:
    """
    Try lmbrain's get_unigram_cost first (if available), else fall back to the
    embedded segmenter's LM. Returns (cost, known_flag) where known_flag only
    reflects true LM membership, not the existence of a default cost.
    """
    if get_unigram_cost:
        try:
            c = get_unigram_cost(norm_word)
        except Exception:
            c = None
        lm_known = False
        try:
            from lmbrain import UNIGRAM_COST  # type: ignore

            if UNIGRAM_COST:
                lm_known = norm_word in UNIGRAM_COST
        except Exception:
            lm_known = False
        if c is not None:
            try:
                return float(c), lm_known
            except Exception:
                pass
    if fallback_lm is not None:
        try:
            return fallback_lm.get_unigram_cost(norm_word), fallback_lm.in_lm(norm_word)
        except Exception:
            pass
    return None, False


def _get_bigram_cost(left: str, right: str, fallback_lm=None) -> tuple[float | None, bool]:
    """
    Try lmbrain's get_bigram_cost first (if available), else fall back to the
    embedded segmenter's LM. Returns (cost, known_flag) where known_flag is true
    only if the pair was seen in the LM.
    """
    if get_bigram_cost:
        try:
            c = get_bigram_cost(left, right)
        except Exception:
            c = None
        lm_known = False
        try:
            from lmbrain import BIGRAM_COST  # type: ignore

            if BIGRAM_COST:
                lm_known = (left, right) in BIGRAM_COST
        except Exception:
            lm_known = False
        if c is not None:
            try:
                return float(c), lm_known
            except Exception:
                pass
    if fallback_lm is not None:
        try:
            c = fallback_lm.get_bigram_cost(left, right)
            if c is not None:
                return c, True
        except Exception:
            c = None
    return None, False


# Scale factor to turn bigram -logP into a meaningful reward.
# Higher = stronger effect for observed bigrams (common pairs get larger bonus).
BIGRAM_SCORE_SCALE: float = 40.0


@dataclass
class SegmenterConfig:
    """
    Configuration for the segmenter. Only 3 main tuning parameters.
    OOV_SYLLABLE_PENALTY: Extra cost per syllable for completely unknown words
    DICT_NO_LM_DISCOUNT: Multiplier for words in dictionary but not in LM
    BIGRAM_WEIGHT: How much bigram context influences segmentation
    KNOWN_WORD_BASE_COST: Per-word base cost anchor for known tokens
    UNKNOWN_WORD_BASE_COST: Per-word base cost anchor for unknown/LM-only tokens
    UNIGRAM_WEIGHT: Scale for how much unigram LM cost contributes
    """

    # Core tuning parameters
    OOV_SYLLABLE_PENALTY: float = 2.0
    DICT_NO_LM_DISCOUNT: float = 0.7  # Generous to specialized dicts
    BIGRAM_WEIGHT: float = 0.1
    KNOWN_WORD_BASE_COST: float = 1.0
    UNKNOWN_WORD_BASE_COST: float = 5.0
    UNIGRAM_WEIGHT: float = 1.0
    # Structural parameters (rarely need adjustment)
    MAX_WORD_CLUSTERS: int = 16  # Max syllables to consider as single word
    BEAM_WIDTH: int = 4  # For bigram-aware Viterbi (0 = no beam, pure DP)
    # Laplace smoothing for LM (matches myWord approach)
    UNIGRAM_ALPHA: float = 1.0


@dataclass
class DictionaryEntry:
    """A single dictionary entry with metadata."""

    headword: str
    romanization: str = ""
    pos: str = ""
    senses: list[str] = field(default_factory=list)
    source: str = ""  # Which dictionary this came from
    priority: int = 0  # Lower = higher priority


@dataclass
class DictionaryLayer:
    """
    A single dictionary layer in the stack.
    Layers are checked in priority order (lowest priority number first).
    """

    name: str
    entries: dict[str, DictionaryEntry] = field(default_factory=dict)
    priority: int = 100  # Default: low priority
    enabled: bool = True
    source_name: str = ""  # Display/source label for entries

    def add_entry(
        self,
        headword: str,
        romanization: str = "",
        pos: str = "",
        senses: list[str] | None = None,
        definition: str = "",
    ) -> None:
        """Add or update an entry in this layer."""
        norm = _normalize_headword(headword)
        if not norm:
            return
        entry = self.entries.get(norm)
        if entry is None:
            entry = DictionaryEntry(
                headword=headword,
                romanization=romanization or "",
                pos=pos or "",
                senses=list(senses) if senses else ([] if not definition else [definition]),
                source=getattr(self, "source_name", self.name),
                priority=self.priority,
            )
            self.entries[norm] = entry
            return
        # Merge/augment existing entry
        if romanization and not entry.romanization:
            entry.romanization = romanization
        if pos:
            if not entry.pos:
                entry.pos = pos
            elif pos not in entry.pos.split("|"):
                entry.pos = f"{entry.pos}|{pos}"
        if senses:
            for s in senses:
                if s and s not in entry.senses:
                    entry.senses.append(s)
        elif definition and definition not in entry.senses:
            entry.senses.append(definition)

    def __contains__(self, key: str) -> bool:
        return _normalize_headword(key) in self.entries

    def get(self, key: str) -> Optional[DictionaryEntry]:
        return self.entries.get(_normalize_headword(key))


class StackedDictionary:
    """
    Multi-layer dictionary with priority-based lookup.
    """

    def __init__(self):
        self.layers: dict[str, DictionaryLayer] = {}
        self._sorted_layers: list[DictionaryLayer] = []
        self._all_words: set[str] = set()  # Cache for fast membership

    def add_layer(
        self, name: str, priority: int = 100, source_name: str | None = None
    ) -> DictionaryLayer:
        """Create and add a new dictionary layer."""
        layer = DictionaryLayer(name=name, priority=priority, source_name=source_name or name)
        self.layers[name] = layer
        self._rebuild_sorted()
        return layer

    def get_layer(self, name: str) -> Optional[DictionaryLayer]:
        """Get a layer by name."""
        return self.layers.get(name)

    def remove_layer(self, name: str) -> bool:
        """Remove a layer by name."""
        if name in self.layers:
            del self.layers[name]
            self._rebuild_sorted()
            return True
        return False

    def _rebuild_sorted(self) -> None:
        """Rebuild sorted layer list and word cache."""
        self._sorted_layers = sorted(
            [l for l in self.layers.values() if l.enabled], key=lambda x: x.priority
        )
        self._all_words = set()
        for layer in self._sorted_layers:
            self._all_words.update(layer.entries.keys())

    def rebuild_cache(self) -> None:
        """Manually rebuild caches (call after bulk modifications)."""
        self._rebuild_sorted()

    def __contains__(self, key: str) -> bool:
        """Check if word exists in any enabled layer."""
        return _normalize_headword(key) in self._all_words

    def lookup(self, key: str) -> Optional[DictionaryEntry]:
        """
        Look up a word, returning the highest-priority match.
        Returns None if not found in any layer.
        """
        norm = _normalize_headword(key)
        for layer in self._sorted_layers:
            if norm in layer.entries:
                return layer.entries[norm]
        return None

    def lookup_all(self, key: str) -> list[DictionaryEntry]:
        """Look up a word in all layers, returning all matches."""
        norm = _normalize_headword(key)
        results = []
        for layer in self._sorted_layers:
            if norm in layer.entries:
                results.append(layer.entries[norm])
        return results

    def get_entry(self, key: str) -> Optional[DictionaryEntry]:
        """Return the highest-priority entry (or None)."""
        return self.lookup(key)

    def keys(self) -> set[str]:
        """Return the set of normalized headwords."""
        return self._all_words

    def items(self):
        """Yield (headword, entry) pairs in arbitrary order."""
        for head in self._all_words:
            entry = self.lookup(head)
            if entry is not None:
                yield head, entry

    def word_count(self) -> int:
        """Total unique words across all enabled layers."""
        return len(self._all_words)


def _entry_to_legacy_dict(entry: DictionaryEntry) -> dict:
    """Convert a DictionaryEntry to the legacy DICT-style payload."""
    return {
        "roman": entry.romanization or "",
        "pos": entry.pos or "",
        "senses": entry.senses if entry.senses else [],
        "source": entry.source or "",
    }


class DictView:
    """Lightweight view over the segmenter's StackedDictionary (no duplication)."""

    def __init__(self, dict_getter: Callable[[], Optional[StackedDictionary]]):
        self._dict_getter = dict_getter

    def _dict(self) -> Optional[StackedDictionary]:
        try:
            return self._dict_getter()
        except Exception:
            return None

    def __contains__(self, key: str) -> bool:
        d = self._dict()
        return (key in d) if d else False

    def __getitem__(self, key: str) -> dict:
        d = self._dict()
        if not d:
            raise KeyError(key)
        entry = d.get_entry(key)
        if entry is None:
            raise KeyError(key)
        return _entry_to_legacy_dict(entry)

    def get(self, key: str, default=None) -> Optional[dict]:
        d = self._dict()
        if not d:
            return default
        entry = d.get_entry(key)
        return _entry_to_legacy_dict(entry) if entry else default

    def __iter__(self):
        d = self._dict()
        return iter(d.keys()) if d else iter(())

    def items(self):
        d = self._dict()
        if not d:
            return iter(())
        for head, entry in d.items():
            yield head, _entry_to_legacy_dict(entry)

    def keys(self):
        d = self._dict()
        return d.keys() if d else set()

    def __len__(self) -> int:
        d = self._dict()
        return d.word_count() if d else 0


class LanguageModel:
    """
    Simple unigram + bigram language model using -log P as cost.
    Loads from myWord-format files:
        unigram: word<TAB>count
        bigram:  ('word1', 'word2')<TAB>count  (or word1<TAB>word2<TAB>count)
    """

    def __init__(self, config: SegmenterConfig):
        self.config = config
        # Unigram data
        self.unigram_counts: dict[str, int] = {}
        self.unigram_total: int = 0
        self.unigram_cost: dict[str, float] = {}
        self.unigram_default_cost: float = 15.0  # For truly unseen words
        # Bigram data
        self.bigram_counts: dict[tuple[str, str], int] = {}
        self.bigram_left_total: dict[str, int] = {}
        self.bigram_cost: dict[tuple[str, str], float] = {}
        # Stats for diagnostics
        self.unigram_min_cost: float = 0.0
        self.unigram_max_cost: float = 15.0

    def load_unigram(self, path: str | Path) -> int:
        """
        Load unigram frequencies from file.
        Returns number of entries loaded.
        Format: word<TAB>count (one per line)
        """
        self.unigram_counts.clear()
        self.unigram_cost.clear()
        self.unigram_total = 0
        path = Path(path)
        if not path.exists():
            print(f"[WARN] Unigram file not found: {path}")
            return 0
        count = 0
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                parts = line.split("\t")
                if len(parts) >= 2:
                    word = parts[0].strip()
                    try:
                        freq = int(parts[-1])
                    except ValueError:
                        continue
                else:
                    # Try space-separated fallback
                    try:
                        word, freq_str = line.rsplit(maxsplit=1)
                        freq = int(freq_str)
                    except (ValueError, IndexError):
                        continue
                word = word.replace("\ufeff", "").strip()
                if not word:
                    continue
                # Normalize for consistent lookup
                norm = _normalize_burmese(word)
                self.unigram_counts[norm] = self.unigram_counts.get(norm, 0) + freq
                self.unigram_total += freq
                count += 1
        # Compute -log P costs with Laplace smoothing
        vocab_size = len(self.unigram_counts)
        self._compute_unigram_costs()
        print(f"[INFO] Loaded {count} unigram entries, vocab={vocab_size}")
        return count

    def _compute_unigram_costs(self) -> None:
        """Compute -log P for all unigrams with Laplace smoothing."""
        if not self.unigram_counts:
            self.unigram_default_cost = 15.0
            return
        V = len(self.unigram_counts)
        alpha = self.config.UNIGRAM_ALPHA
        denom = self.unigram_total + alpha * V
        min_cost = float("inf")
        max_cost = 0.0
        for word, freq in self.unigram_counts.items():
            p = (freq + alpha) / denom
            cost = -math.log(p)
            self.unigram_cost[word] = cost
            min_cost = min(min_cost, cost)
            max_cost = max(max_cost, cost)
        # Default cost for unseen = treat as if count=0 with smoothing
        p0 = alpha / denom
        self.unigram_default_cost = -math.log(p0)
        self.unigram_min_cost = min_cost if min_cost != float("inf") else 0.0
        self.unigram_max_cost = max_cost
        # Drop raw counts to save memory (runtime only needs costs).
        self.unigram_counts.clear()
        print(
            f"[INFO] Unigram costs: min={min_cost:.2f}, max={max_cost:.2f}, default={self.unigram_default_cost:.2f}"
        )

    def load_bigram(self, path: str | Path) -> int:
        """
        Load bigram frequencies from file.
        Returns number of entries loaded.
        Format options:
            ('word1', 'word2')<TAB>count  (myWord format)
            word1<TAB>word2<TAB>count     (simple format)
        """
        import ast

        self.bigram_counts.clear()
        self.bigram_left_total.clear()
        self.bigram_cost.clear()
        path = Path(path)
        if not path.exists():
            print(f"[WARN] Bigram file not found: {path}")
            return 0
        count = 0
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                w1, w2, freq = None, None, None
                # Try myWord tuple format first: ('word1', 'word2')\tcount
                if line.startswith("("):
                    try:
                        pair_str, freq_str = line.rsplit("\t", 1)
                        w1, w2 = ast.literal_eval(pair_str.strip())
                        freq = int(freq_str.strip())
                    except Exception:
                        pass
                # Try simple tab-separated: word1\tword2\tcount
                if w1 is None:
                    parts = line.split("\t")
                    if len(parts) >= 3:
                        try:
                            w1 = parts[0].strip()
                            w2 = parts[1].strip()
                            freq = int(parts[2].strip())
                        except Exception:
                            pass
                if w1 is None or w2 is None or freq is None:
                    continue
                w1 = _normalize_burmese(w1.replace("\ufeff", "").strip())
                w2 = _normalize_burmese(w2.replace("\ufeff", "").strip())
                if not w1 or not w2:
                    continue
                key = (w1, w2)
                self.bigram_counts[key] = self.bigram_counts.get(key, 0) + freq
                count += 1
        # Compute left-word totals and costs
        self._compute_bigram_costs()
        print(f"[INFO] Loaded {count} bigram entries")
        return count

    def _compute_bigram_costs(self) -> None:
        """Compute -log P(w2|w1) for all bigrams."""
        if not self.bigram_counts:
            return
        # Sum counts for each left word
        for (w1, w2), freq in self.bigram_counts.items():
            self.bigram_left_total[w1] = self.bigram_left_total.get(w1, 0) + freq
        # Compute conditional probabilities
        for (w1, w2), freq in self.bigram_counts.items():
            left_total = self.bigram_left_total[w1]
            p = freq / left_total
            self.bigram_cost[(w1, w2)] = -math.log(p)
        # Drop raw counts to save memory (runtime only needs costs).
        self.bigram_counts.clear()
        self.bigram_left_total.clear()

    def get_unigram_cost(self, word: str) -> float:
        """
        Get -log P(word) from unigram model.
        Returns default cost if word not in LM.
        """
        norm = _normalize_burmese(word)
        return self.unigram_cost.get(norm, self.unigram_default_cost)

    def get_bigram_cost(self, w1: str, w2: str) -> Optional[float]:
        """
        Get -log P(w2|w1) from bigram model.
        Returns None if bigram not observed (caller should back off to unigram).
        """
        key = (_normalize_burmese(w1), _normalize_burmese(w2))
        return self.bigram_cost.get(key)

    def in_lm(self, word: str) -> bool:
        """Check if word was observed in training data."""
        return _normalize_burmese(word) in self.unigram_cost


class BurmeseSegmenter:
    """
    Simplified log-probability Burmese word segmenter.
    """

    def __init__(self, config: Optional[SegmenterConfig] = None):
        self.config = config or SegmenterConfig()
        self.lm = LanguageModel(self.config)
        self.dictionary = StackedDictionary()
        # Add default layers (can be populated later)
        self.dictionary.add_layer("user", priority=10)  # Highest priority
        self.dictionary.add_layer("pali", priority=30)  # Historical/classical
        self.dictionary.add_layer("chronicle", priority=40)  # Domain-specific
        self.dictionary.add_layer("wiktionary", priority=50)
        self.dictionary.add_layer("mmd", priority=60)
        self.dictionary.add_layer("lm_vocab", priority=100)  # Auto-populated from LM

    def load_lm(self, unigram_path: str | Path, bigram_path: Optional[str | Path] = None) -> None:
        """Load language model files."""
        self.lm.load_unigram(unigram_path)
        if bigram_path:
            self.lm.load_bigram(bigram_path)

    def load_dictionary_tsv(
        self, path: str | Path, layer_name: str, has_header: bool = True
    ) -> int:
        """
        Load a TSV dictionary file into a layer.
        Expected columns: headword, romanization, pos, definition
        (Missing columns are OK - will use defaults)
        Returns number of entries loaded.
        """
        layer = self.dictionary.get_layer(layer_name)
        if not layer:
            layer = self.dictionary.add_layer(layer_name, priority=50)
        path = Path(path)
        if not path.exists():
            print(f"[WARN] Dictionary file not found: {path}")
            return 0
        count = 0
        with open(path, "r", encoding="utf-8") as f:
            for i, line in enumerate(f):
                if i == 0 and has_header:
                    continue
                line = line.strip()
                if not line:
                    continue
                parts = line.split("\t")
                if not parts:
                    continue
                headword = parts[0].strip() if len(parts) > 0 else ""
                roman = parts[1].strip() if len(parts) > 1 else ""
                pos = parts[2].strip() if len(parts) > 2 else ""
                defn = parts[3].strip() if len(parts) > 3 else ""
                if not headword:
                    continue
                layer.add_entry(headword, roman, pos, defn)
                count += 1
        self.dictionary.rebuild_cache()
        print(f"[INFO] Loaded {count} entries into '{layer_name}' layer")
        return count

    def segment_cost(self, seg_text: str, prev_word: Optional[str] = None) -> float:
        """
        Compute the cost for a candidate segment.
        """
        cfg = self.config
        norm = _normalize_burmese(seg_text)
        entry = self.dictionary.lookup(norm)
        fallback_default = getattr(self.lm, "unigram_default_cost", 15.0)
        lm_cost, lm_known = _get_unigram_cost(norm, self.lm)
        if entry and (entry.source or "").lower() == "user":
            # Treat user entries as LM-known to avoid discounting penalties.
            lm_known = True
            if lm_cost is None:
                lm_cost = fallback_default
        # === BASE COST ===
        if entry and (entry.source or "").lower() not in {"lm_vocab", "lm"}:
            # Case 1: In a real dictionary layer (user/mmd/pali/etc.)
            if lm_known and lm_cost is not None:
                lm_val = min(lm_cost, fallback_default)
            else:
                lm_val = fallback_default * cfg.DICT_NO_LM_DISCOUNT
            base_cost = cfg.KNOWN_WORD_BASE_COST + cfg.UNIGRAM_WEIGHT * lm_val
        elif lm_known:
            # Case 2: LM-only word (not in our dictionaries) - treat near OOV
            num_syllables = count_syllables(seg_text)
            lm_val = fallback_default  # stopgap only; don't let LM-only beat dict splits
            base_cost = (
                cfg.UNKNOWN_WORD_BASE_COST
                + cfg.UNIGRAM_WEIGHT * lm_val
                + (num_syllables - 1) * cfg.OOV_SYLLABLE_PENALTY
            )
        else:
            # Case 3: True OOV - unknown to both LM and dictionaries
            num_syllables = count_syllables(seg_text)
            base_cost = (
                cfg.UNKNOWN_WORD_BASE_COST
                + cfg.UNIGRAM_WEIGHT * fallback_default
                + (num_syllables - 1) * cfg.OOV_SYLLABLE_PENALTY
            )
        # === BIGRAM ADJUSTMENT (ONE DIRECTION ONLY) ===
        bigram_adj = 0.0
        if prev_word and cfg.BIGRAM_WEIGHT > 0 and (norm in self.dictionary or lm_known):
            # DP runs right-to-left; prev_word here is the next token in text order.
            bc_next, _ = _get_bigram_cost(norm, prev_word, self.lm)
            if bc_next is not None:
                bigram_score_next = BIGRAM_SCORE_SCALE / (bc_next + 1e-9)
                bigram_adj = -cfg.BIGRAM_WEIGHT * bigram_score_next
        return base_cost + bigram_adj

    def segment(self, text: str) -> list[str]:
        """Segment Burmese text into words using DP."""
        if not text:
            return []
        clusters, starts = build_syllable_clusters(text)
        n = len(clusters)
        if n == 0:
            return [text] if text else []
        cluster_ends = [s + len(c) for s, c in zip(starts, clusters)]
        max_clusters = self.config.MAX_WORD_CLUSTERS

        dp_cost = [float("inf")] * (n + 1)
        next_idx = [0] * (n + 1)
        first_word: list[str] = [""] * (n + 1)
        dp_cost[n] = 0.0
        # Fill DP table right-to-left
        for i in range(n - 1, -1, -1):
            best_cost = float("inf")
            best_j = i + 1
            start_char = starts[i]
            max_j = min(n, i + max_clusters)
            for j in range(i + 1, max_j + 1):
                end_char = cluster_ends[j - 1]
                seg_text = text[start_char:end_char]
                # Get previous word for bigram context (from what follows this segment)
                prev_word = first_word[j] if j < n else None
                seg_cost = self.segment_cost(seg_text, prev_word)
                total_cost = seg_cost + dp_cost[j]
                if total_cost < best_cost:
                    best_cost = total_cost
                    best_j = j
            if best_cost == float("inf"):
                # No dict-only candidate found (should be rare) - fall back to first cluster.
                best_j = i + 1
            dp_cost[i] = best_cost
            next_idx[i] = best_j
            # Record first word of best path from i
            best_end = cluster_ends[best_j - 1]
            first_word[i] = text[start_char:best_end]
        # Reconstruct path
        segments: list[str] = []
        i = 0
        while i < n:
            j = next_idx[i]
            if j <= i or j > n:
                segments.append(text[starts[i] :])
                break
            start_char = starts[i]
            end_char = cluster_ends[j - 1]
            segments.append(text[start_char:end_char])
            i = j
        return segments

    def segment_with_info(self, text: str) -> list[dict]:
        """
        Segment text and return detailed info for each segment.
        """
        if not text:
            return []
        clusters, starts = build_syllable_clusters(text)
        n = len(clusters)
        if n == 0:
            return [
                {
                    "text": text,
                    "start": 0,
                    "end": len(text),
                    "in_dict": False,
                    "in_lm": False,
                    "cost": 0.0,
                    "entry": None,
                }
            ]
        segments = self.segment(text)
        results = []
        pos = 0
        prev_word = None
        for seg in segments:
            norm = _normalize_burmese(seg)
            start = text.find(seg, pos)
            if start == -1:
                start = pos
            end = start + len(seg)
            entry = self.dictionary.lookup(seg)
            in_lm = self.lm.in_lm(norm)
            cost = self.segment_cost(seg, prev_word)
            results.append(
                {
                    "text": seg,
                    "start": start,
                    "end": end,
                    "in_dict": entry is not None,
                    "in_lm": in_lm,
                    "cost": cost,
                    "entry": entry,
                }
            )
            pos = end
            prev_word = seg
        return results

    def segment_with_trace(self, text: str) -> dict:
        """
        Segment text and return DP trace for debugging:
          - segments (best path)
          - dp_cost, next_idx, first_word arrays
          - candidates considered at each start position with proper prev_word context
        """
        if not text:
            return {
                "segments": [],
                "dp_cost": [],
                "next_idx": [],
                "first_word": [],
                "candidates": [],
            }
        clusters, starts = build_syllable_clusters(text)
        n = len(clusters)
        if n == 0:
            return {
                "segments": [text],
                "dp_cost": [0.0],
                "next_idx": [],
                "first_word": [text],
                "candidates": [],
            }
        cluster_ends = [s + len(c) for s, c in zip(starts, clusters)]
        dp_cost = [float("inf")] * (n + 1)
        next_idx = [0] * (n + 1)
        first_word: list[str] = [""] * (n + 1)
        candidates_trace: list[list[dict]] = [[] for _ in range(n)]
        dp_cost[n] = 0.0
        max_clusters = self.config.MAX_WORD_CLUSTERS

        def _is_dict_segment(seg_text: str) -> bool:
            entry = self.dictionary.lookup(seg_text)
            return bool(entry and (entry.source or "").lower() not in {"lm_vocab", "lm"})

        def _compute_breakdown(seg_text: str, prev_word: Optional[str]) -> dict:
            cfg = self.config
            norm = _normalize_burmese(seg_text)
            entry = self.dictionary.lookup(norm)
            lm_cost, lm_known = _get_unigram_cost(norm, self.lm)
            fallback_default = getattr(self.lm, "unigram_default_cost", 15.0)
            if entry and (entry.source or "").lower() == "user":
                lm_known = True
                if lm_cost is None:
                    lm_cost = fallback_default
            syllables = count_syllables(seg_text)
            if entry and (entry.source or "").lower() not in {"lm_vocab", "lm"}:
                if lm_known and lm_cost is not None:
                    lm_val = min(lm_cost, fallback_default)
                else:
                    lm_val = fallback_default * cfg.DICT_NO_LM_DISCOUNT
                base_cost = cfg.KNOWN_WORD_BASE_COST + cfg.UNIGRAM_WEIGHT * lm_val
                branch = "dict"
                source = entry.source
            elif lm_known:
                lm_val = fallback_default
                base_cost = (
                    cfg.UNKNOWN_WORD_BASE_COST
                    + cfg.UNIGRAM_WEIGHT * lm_val
                    + (syllables - 1) * cfg.OOV_SYLLABLE_PENALTY
                )
                branch = "lm_only"
                source = "lm_only"
            else:
                lm_val = fallback_default
                base_cost = (
                    cfg.UNKNOWN_WORD_BASE_COST
                    + cfg.UNIGRAM_WEIGHT * lm_val
                    + (syllables - 1) * cfg.OOV_SYLLABLE_PENALTY
                )
                branch = "oov"
                source = "oov"
            bigram_adj = 0.0
            bigram_cost_prev = None
            bigram_cost_next = None
            bigram_known = False
            bigram_reward = 0.0
            bigram_score_prev = 0.0
            bigram_score_next = 0.0
            if prev_word and cfg.BIGRAM_WEIGHT > 0 and (norm in self.dictionary or lm_known):
                # Text-order only: current -> next word in text (prev_word in DP context)
                bigram_cost_next, known_next = _get_bigram_cost(norm, prev_word, self.lm)
                bigram_known = bool(known_next and bigram_cost_next is not None)
                if bigram_cost_next is not None:
                    bigram_score_next = BIGRAM_SCORE_SCALE / (bigram_cost_next + 1e-9)
                    bigram_reward = bigram_score_next
                    bigram_adj = -cfg.BIGRAM_WEIGHT * bigram_reward
            total = base_cost + bigram_adj
            return {
                "total": float(total),
                "base": float(base_cost),
                "bigram_adj": float(bigram_adj),
                "lm_cost": float(lm_cost) if lm_cost is not None else float(fallback_default),
                "lm_known": bool(lm_known),
                "bigram_cost": float(bigram_cost_next) if bigram_cost_next is not None else None,
                "bigram_known": bool(bigram_known),
                "source": source,
                "branch": branch,
                "syllables": syllables,
                "components": {
                    "known_word_base": cfg.KNOWN_WORD_BASE_COST if branch == "dict" else 0.0,
                    "unknown_word_base": cfg.UNKNOWN_WORD_BASE_COST
                    if branch in ("lm_only", "oov")
                    else 0.0,
                    "lm_unigram": float(lm_val),
                    "lm_unigram_weighted": cfg.UNIGRAM_WEIGHT * float(lm_val),
                    "unigram_weight": cfg.UNIGRAM_WEIGHT,
                    "dict_discount": cfg.DICT_NO_LM_DISCOUNT
                    if branch == "dict" and not lm_known
                    else None,
                    "oov_penalty": (syllables - 1) * cfg.OOV_SYLLABLE_PENALTY
                    if branch in ("lm_only", "oov")
                    else 0.0,
                    "bigram_score": bigram_score_next if bigram_cost_next is not None else 0.0,
                    "bigram_reward": bigram_reward,
                    "bigram_reward_weighted": cfg.BIGRAM_WEIGHT * bigram_reward
                    if bigram_reward
                    else 0.0,
                },
            }

        for i in range(n - 1, -1, -1):
            best_cost = float("inf")
            best_j = i + 1
            start_char = starts[i]
            max_j = min(n, i + max_clusters)
            cand_list = []
            for j in range(i + 1, max_j + 1):
                end_char = cluster_ends[j - 1]
                seg_text = text[start_char:end_char]
                is_dict = _is_dict_segment(seg_text)
                prev_word = first_word[j] if j < n else None
                seg_cost = self.segment_cost(seg_text, prev_word)
                total_cost = seg_cost + dp_cost[j]
                breakdown = _compute_breakdown(seg_text, prev_word)
                cand_list.append(
                    {
                        "text": seg_text,
                        "start_char": start_char,
                        "end_char": end_char,
                        "clusters": j - i,
                        "seg_cost": float(seg_cost),
                        "total_cost": float(total_cost),
                        "next_idx": j,
                        "prev_word": prev_word,
                        "is_dict": bool(is_dict),
                        "cost_breakdown": breakdown,
                    }
                )
                if total_cost < best_cost:
                    best_cost = total_cost
                    best_j = j
            if best_cost == float("inf"):
                best_j = i + 1
            dp_cost[i] = best_cost
            next_idx[i] = best_j
            best_end = cluster_ends[best_j - 1]
            first_word[i] = text[start_char:best_end]
            cand_list.sort(key=lambda c: c["total_cost"])
            candidates_trace[i] = cand_list
        segments: list[str] = []
        i = 0
        while i < n:
            j = next_idx[i]
            if j <= i or j > n:
                segments.append(text[starts[i] :])
                break
            start_char = starts[i]
            end_char = cluster_ends[j - 1]
            segments.append(text[start_char:end_char])
            i = j
        return {
            "segments": segments,
            "dp_cost": dp_cost,
            "next_idx": next_idx,
            "first_word": first_word,
            "candidates": candidates_trace,
            "clusters": clusters,
            "starts": starts,
            "cluster_ends": cluster_ends,
        }


# ============================================================================
# CONFIG (inlined from config.py)
# ============================================================================
DATA_DIR = TSV_WIKI_PATH.parent
MYWORD_UNIGRAM_PATH = DATA_DIR / "myWord-main" / "unigram-word.txt"
MYWORD_BIGRAM_PATH = DATA_DIR / "myWord-main" / "bigram-word.txt"
SEGMENTER_CONFIG = SegmenterConfig(
    OOV_SYLLABLE_PENALTY=10.0,
    DICT_NO_LM_DISCOUNT=1.0,
    UNIGRAM_WEIGHT=0.2,
    KNOWN_WORD_BASE_COST=1.0,
    UNKNOWN_WORD_BASE_COST=5.0,
    BIGRAM_WEIGHT=0.1,
    MAX_WORD_CLUSTERS=16,
    BEAM_WIDTH=4,
    UNIGRAM_ALPHA=1.0,
)
# LM costs should come from lmbrain to avoid duplicate LM loads.
USE_EMBEDDED_LM = False
DICT_PRIORITIES = {
    "user": 1,
    "chronicle": 99,
    "pali": 5,
    "wiktionary": 3,
    "mmd": 2,
    "grammar": 4,
    "lm_vocab": 99,
}
DICT_LAYER_SOURCES = {
    "user": "USER",
    "wiktionary": "WIKI",
    "mmd": "MMD",
    "pali": "PALI",
    "chronicle": "CHRONICLE",
    "grammar": "GRAMMAR",
    "lm_vocab": "LM",
}
# ============================================================================
# SERVER INTEGRATION (inlined)
# ============================================================================
SEGMENTER_INSTANCE: Optional[BurmeseSegmenter] = None
DICT_LOADED = False
DICT_LOADING = False
DICT_LOAD_LOCK = threading.Lock()


def init_new_segmenter() -> BurmeseSegmenter:
    """
    Initialize the embedded segmenter (dictionaries only; LM handled by lmbrain).
    """
    global SEGMENTER_INSTANCE
    print("\n=== Initializing Burmese Segmenter (embedded) ===\n")
    SEGMENTER_INSTANCE = BurmeseSegmenter(SEGMENTER_CONFIG)
    # Set up dictionary layers with proper priorities
    for name, priority in DICT_PRIORITIES.items():
        layer = SEGMENTER_INSTANCE.dictionary.get_layer(name)
        if layer:
            layer.priority = priority
            layer.source_name = DICT_LAYER_SOURCES.get(name, layer.source_name or name)
        else:
            SEGMENTER_INSTANCE.dictionary.add_layer(
                name,
                priority=priority,
                source_name=DICT_LAYER_SOURCES.get(name, name),
            )
    # Load language model (disabled when lmbrain handles LM costs)
    if USE_EMBEDDED_LM:
        if MYWORD_UNIGRAM_PATH.exists():
            bigram_path = MYWORD_BIGRAM_PATH if MYWORD_BIGRAM_PATH.exists() else None
            SEGMENTER_INSTANCE.load_lm(MYWORD_UNIGRAM_PATH, bigram_path)
        else:
            print(f"[WARN] No LM found at {MYWORD_UNIGRAM_PATH}")
    else:
        print("[INFO] Embedded LM disabled; lmbrain will supply unigram/bigram costs.")
    return SEGMENTER_INSTANCE


def get_segmenter_instance() -> BurmeseSegmenter:
    """Get the global segmenter, initializing if needed."""
    global SEGMENTER_INSTANCE
    if SEGMENTER_INSTANCE is None or not DICT_LOADED:
        if DICT_LOADING:
            return SEGMENTER_INSTANCE or init_new_segmenter()
        load_dictionary()
    return SEGMENTER_INSTANCE


def _get_master_dictionary() -> Optional[StackedDictionary]:
    seg = get_segmenter_instance()
    return seg.dictionary if seg is not None else None


# Global dictionary view backed by the segmenter's StackedDictionary.
DICT = DictView(_get_master_dictionary)

# ---------------- ADVANCED SEGMENTER HOOK (lmbrain) ----------------
ADVANCED_SEGMENTER = None
get_unigram_cost = None
get_bigram_cost = None
UNIGRAM_DEFAULT_COST = None
UNIGRAM_MIN_COST = None
UNIGRAM_MAX_COST = None
BIGRAM_MIN_COST = None
BIGRAM_MAX_COST = None


def init_advanced_segmenter() -> None:
    """
    Optional hook: if lmbrain.py (LM brain) is present, initialize it.
    Loads unigram/bigram LMs inside lmbrain for DP scoring.
    """
    global ADVANCED_SEGMENTER, get_unigram_cost, get_bigram_cost
    global UNIGRAM_DEFAULT_COST, UNIGRAM_MIN_COST, UNIGRAM_MAX_COST
    global BIGRAM_MIN_COST, BIGRAM_MAX_COST
    try:
        import lmbrain
        from lmbrain import AdvancedSegmenter, LMConfig, get_unigram_cost, get_bigram_cost
    except ModuleNotFoundError:
        print("[INFO] lmbrain.py not found; using base DP segmenter only.")
        ADVANCED_SEGMENTER = None
        get_unigram_cost = None
        get_bigram_cost = None
        UNIGRAM_DEFAULT_COST = None
        UNIGRAM_MIN_COST = None
        UNIGRAM_MAX_COST = None
        BIGRAM_MIN_COST = None
        BIGRAM_MAX_COST = None
        return
    except Exception as e:
        print("[WARN] Could not import AdvancedSegmenter / LMConfig:", e)
        ADVANCED_SEGMENTER = None
        get_unigram_cost = None
        get_bigram_cost = None
        UNIGRAM_DEFAULT_COST = None
        UNIGRAM_MIN_COST = None
        UNIGRAM_MAX_COST = None
        BIGRAM_MIN_COST = None
        BIGRAM_MAX_COST = None
        return
    try:
        word_uni_path = MYWORD_UNIGRAM_PATH if MYWORD_UNIGRAM_PATH.exists() else None
        word_bi_path = MYWORD_BIGRAM_PATH if MYWORD_BIGRAM_PATH.exists() else None
        if word_uni_path is None:
            print(f"[WARN] No LM found at {MYWORD_UNIGRAM_PATH}")
        # Configure LMConfig with word unigram/bigram only
        lm_cfg = LMConfig(
            word_unigram_path=word_uni_path,
            word_bigram_path=word_bi_path,
            phrase_unigram_path=None,
            phrase_bigram_path=None,
            lambda_unigram=1.0,
            lambda_bigram=0.10,
            lambda_phrase_unigram=0.0,
            lambda_phrase_bigram=0.0,
            enable_word_unigram=bool(word_uni_path),
            enable_word_bigram=bool(word_bi_path),
            enable_phrase_unigram=False,
            enable_phrase_bigram=False,
            enable_phrase_inventory=False,
        )
        ADVANCED_SEGMENTER = AdvancedSegmenter(
            dict_obj=DICT,
            dp_segmenter=segmenter_segment_text,
            myword_root=None,
            config=lm_cfg,
        )
        # Compute global unigram cost bounds for rarity scores
        try:
            uni_cost_table = getattr(lmbrain, "UNIGRAM_COST", {})
            if uni_cost_table:
                min_c = min(uni_cost_table.values())
                max_c = max(uni_cost_table.values())
                UNIGRAM_MIN_COST = float(min_c)
                UNIGRAM_MAX_COST = float(max_c)
                if UNIGRAM_MAX_COST > UNIGRAM_MIN_COST:
                    print(
                        f"[LM] Unigram cost bounds: "
                        f"min={UNIGRAM_MIN_COST:.3f}, max={UNIGRAM_MAX_COST:.3f}"
                    )
                else:
                    print(
                        f"[LM] Unigram costs all equal at {UNIGRAM_MIN_COST:.3f}; "
                        "rarity will be effectively flat."
                    )
            else:
                UNIGRAM_MIN_COST = None
                UNIGRAM_MAX_COST = None
                print("[LM] UNIGRAM_COST empty; no global rarity scaling.")
        except Exception as e_bounds:
            UNIGRAM_MIN_COST = None
            UNIGRAM_MAX_COST = None
            print("[WARN] Failed to compute global unigram bounds:", e_bounds)
        BIGRAM_MIN_COST = None
        BIGRAM_MAX_COST = None
        print("[LM] AdvancedSegmenter initialised with LMConfig.")
    except Exception as e:
        print("[WARN] Failed to initialise AdvancedSegmenter:", e)
        ADVANCED_SEGMENTER = None
        get_unigram_cost = None
        get_bigram_cost = None
        UNIGRAM_DEFAULT_COST = None
        UNIGRAM_MIN_COST = None
        UNIGRAM_MAX_COST = None
        BIGRAM_MIN_COST = None
        BIGRAM_MAX_COST = None
        return


def segmenter_segment_text(text: str) -> list[str]:
    """Segment text into words (wrapper)."""
    seg = get_segmenter_instance()
    return seg.segment(text)


def segmenter_segment_with_info(text: str) -> list[dict]:
    """Segment text and return detailed info for each segment (wrapper)."""
    seg = get_segmenter_instance()
    return seg.segment_with_info(text)


def segmenter_segment_with_trace(text: str) -> dict:
    """Segment text and return DP trace (wrapper for debug)."""
    seg = get_segmenter_instance()
    return seg.segment_with_trace(text)


def segmenter_add_user_word(
    headword: str, romanization: str = "", pos: str = "", definition: str = ""
) -> bool:
    """Add a word to the user dictionary layer."""
    seg = get_segmenter_instance()
    user_layer = seg.dictionary.get_layer("user")
    if not user_layer:
        return False
    sense_line = "\t".join([headword, romanization or "", pos or "", definition or ""])
    user_layer.add_entry(headword, romanization, pos, senses=[sense_line])
    seg.dictionary.rebuild_cache()
    return True


# ---------------------------------------------------------------------------
# Pronunciation Engine (G2P) - using burmese_transliteration module
# ---------------------------------------------------------------------------
# The comprehensive G2P engine is now in burmese_transliteration.py.
# These are thin wrappers for backwards compatibility with the rest of the server.
# Re-export constants from the new engine for any code that might use them
MYANMAR_CONSONANTS = g2p_engine.MYANMAR_CONSONANTS
MYANMAR_INDEPENDENT_VOWELS = g2p_engine.MYANMAR_INDEPENDENT_VOWELS
MYANMAR_MEDIALS = g2p_engine.MYANMAR_MEDIALS
CONSONANT_ROMAN = g2p_engine.CONSONANT_ROMAN
MEDIAL_ROMAN = g2p_engine.MEDIAL_ROMAN
DIACRITIC_LABELS = g2p_engine.DIACRITIC_LABELS


def _split_into_syllables_for_g2p(text: str) -> list[str]:
    """Split Burmese text into orthographic syllables for G2P processing."""
    return g2p_engine._split_into_syllables(text)


def _romanize_syllable(syl: str) -> str:
    """Romanize a single Burmese syllable."""
    return g2p_engine.romanize_syllable(syl)


def _infer_pronunciation(text: str) -> str:
    """
    Romanize a whole Burmese string as hyphen-separated syllables.
    Example:
      '??????' -> 'myan-ma'
    """
    return g2p_engine.romanize(text, separator="-")


def g2p_explain_for_ui(text: str) -> dict:
    """
    Full pronunciation + breakdown for UI display.
    Returns:
      {
        "overall_roman": "myan-ma",
        "syllables": [
           {
             "orth": "????",
             "roman": "myan",
             "is_burmese": True,
             "is_minor": False,
             "tone": "checked",
             "base": {"ch": "?", "roman": "m", "label": "consonant"},
             "medials": [{"ch": "?", "roman": "y", "label": "? medial"}],
             "vowels": [...],
             "finals": [...],
             "marks": [...],
             "components": [...],  # detailed component breakdown
           },
           ...
        ]
      }
    """
    return g2p_engine.get_g2p_data(text)


def _make_unknown_entry(w: str) -> dict:
    """
    Build a standard 'unknown' entry, including an inferred pronunciation
    (roman_inferred) when possible.
    """
    inferred = _infer_pronunciation(w) if contains_burmese(w) else ""
    senses = ["[no dictionary entry found for this segment]"]
    if inferred:
        senses.append(f"[approximate pronunciation: {inferred}]")
    entry = {
        "head": w,
        # keep this empty so "real" dict roman stays visually distinct
        "roman": "",
        "pos": "unknown",
        "senses": senses,
    }
    if inferred:
        entry["roman_inferred"] = inferred
    return entry


# ---------------- dictionary loading ---------------------
def load_wiktionary_dict(path: Path, layer: DictionaryLayer) -> int:
    """
    Load the Kaikki-based Wiktionary TSV into a dictionary layer.
    Expected format (with header row):
        headword    romanization    pos    definition
    """
    if not path.exists():
        print(f"[WARN] Wiktionary TSV not found: {path}")
        return 0
    print(f"Loading Wiktionary TSV from {path} ...")
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            raw_head = (row.get("headword") or "").strip()
            if not raw_head:
                continue
            head = normalize_headword(raw_head)
            if not head or not contains_burmese(head):
                continue
            roman = (row.get("romanization") or "").strip()
            pos = normalize_pos(row.get("pos") or "")
            definition = (row.get("definition") or "").strip()
            # Store a tab-separated line so the frontend renderer can show columns
            sense_line = "\t".join([head, roman, pos, definition])
            layer.add_entry(head, roman, pos, senses=[sense_line])
    print(f"[WIKI] loaded {len(layer.entries)} headwords.")
    return len(layer.entries)


def load_user_dict(path: Path, layer: DictionaryLayer) -> int:
    """
    Load the per-user custom dictionary TSV into a dictionary layer.
    Format is the same 4-column layout as the Wiktionary TSV:
    headword, romanization, pos, definition.
    """
    if not path.exists():
        print(f"[USERDICT] no user dictionary found at {path} (starting empty).")
        return 0
    print(f"[USERDICT] loading user dictionary TSV from {path} ...")
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            raw_head = (row.get("headword") or "").strip()
            if not raw_head:
                continue
            head = normalize_headword(raw_head)
            if not head or not contains_burmese(head):
                continue
            roman = (row.get("romanization") or "").strip()
            pos = normalize_pos(row.get("pos") or "")
            definition = (row.get("definition") or "").strip()
            sense_line = "\t".join([head, roman, pos, definition])
            layer.add_entry(head, roman, pos, senses=[sense_line])
    print(f"[USERDICT] loaded {len(layer.entries)} headwords from user dictionary.")
    return len(layer.entries)


def load_user_text_overrides(path: Path) -> list[tuple[str, str]]:
    """
    Load user-provided text normalization overrides (raw -> normalized).
    TSV format: raw<TAB>normalized
    """
    overrides: list[tuple[str, str]] = []
    if not path.exists():
        print(f"[USEROVERRIDE] no overrides found at {path} (starting empty).")
        return overrides
    print(f"[USEROVERRIDE] loading overrides TSV from {path} ...")
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            raw = (row.get("raw") or "").strip()
            normalized = (row.get("normalized") or "").strip()
            if not raw or not normalized:
                continue
            if not contains_burmese(normalized):
                continue
            overrides.append((raw, normalized))
    print(f"[USEROVERRIDE] loaded {len(overrides)} overrides.")
    return overrides


def load_mmd_dict(path: Path, layer: DictionaryLayer) -> int:
    """
    Load MMD_clean.tsv and handle embedded POS tags within definitions.
    Some TSV rows have multiple POSs in the definition field:
        headword\troman\tpron\t1 sense \n 2 sense \n part \n 1 sense \n 2 sense
    This parser detects standalone POS tags and groups senses correctly.
    """
    from collections import defaultdict
    import re

    temp_struct = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    raw_headwords = {}
    if not path.exists():
        print(f"[WARN] MMD TSV not found: {path}")
        return 0
    print(f"Loading MMD from {path} ...")
    # Common POS tags that might appear in definitions
    POS_TAGS = {
        "n",
        "v",
        "adj",
        "adv",
        "pron",
        "part",
        "particle",
        "conj",
        "prep",
        "postp",
        "ppm",
        "interj",
        "aux",
        "num",
        "det",
        "prefix",
        "suffix",
        "m",
        "nm",
    }
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        for row in reader:
            raw_head = (row.get("headword") or "").strip()
            if not raw_head:
                continue
            head = normalize_headword(raw_head)
            if not head or not contains_burmese(head):
                continue
            if head not in raw_headwords:
                raw_headwords[head] = raw_head
            roman = (row.get("romanization") or "").strip()
            initial_pos = (row.get("pos") or "").strip()
            definition_raw = (row.get("definition") or "").strip()
            if not definition_raw:
                continue
            # Split on both literal "\n" and real newlines
            def_for_split = definition_raw.replace("\\n", "\n")
            lines = [seg.strip() for seg in def_for_split.split("\n") if seg.strip()]
            if not lines:
                continue
            # Parse lines to detect embedded POS tags
            current_pos = initial_pos
            current_senses = []
            for line in lines:
                stripped = line.strip()
                # Is this a new POS tag? (standalone word that's a known POS)
                # Must not start with a digit (to avoid matching numbered senses)
                if stripped.lower() in POS_TAGS and not re.match(r"^\d", stripped):
                    # Save previous POS and its senses
                    if current_pos and current_senses:
                        temp_struct[head][roman][current_pos].extend(current_senses)
                    # Start new POS
                    current_pos = stripped
                    current_senses = []
                else:
                    # This is a sense line, add to current POS
                    current_senses.append(line)
            # Don't forget the last POS
            if current_pos and current_senses:
                temp_struct[head][roman][current_pos].extend(current_senses)
    # Convert to 4-column table format for frontend
    for head in temp_struct:
        sense_lines = []
        raw_head = raw_headwords.get(head, head)
        # FIXED: Don't use sorted() - preserve insertion order from TSV
        for roman in temp_struct[head].keys():
            first_pos_in_roman = True
            # FIXED: Don't use sorted() - preserve insertion order from TSV
            for pos in temp_struct[head][roman].keys():
                senses = temp_struct[head][roman][pos]
                # ADDED: Skip empty sense lists
                if not senses:
                    continue
                if first_pos_in_roman:
                    # headword\troman\tpos\tsense1
                    sense_lines.append(f"{raw_head}\t{roman}\t{pos}\t{senses[0]}")
                    first_pos_in_roman = False
                else:
                    # \t\tpos\tsense1 (new POS under same roman)
                    sense_lines.append(f"\t\t{pos}\t{senses[0]}")
                # \t\t\tsense (additional senses)
                for sense in senses[1:]:
                    if sense:  # ADDED: Skip empty senses
                        sense_lines.append(f"\t\t\t{sense}")
        # ADDED: Skip entries with no valid sense lines
        if not sense_lines:
            continue
        first_roman = next(iter(temp_struct[head].keys()))
        first_pos = next(iter(temp_struct[head][first_roman].keys()))
        layer.entries[head] = DictionaryEntry(
            headword=head,
            romanization=first_roman,
            pos=first_pos,
            senses=sense_lines,
            source=layer.source_name or layer.name,
            priority=layer.priority,
        )
    print(f"[MMD] loaded {len(layer.entries)} headwords.")
    return len(layer.entries)


def load_pali_dict(path: Path, layer: DictionaryLayer) -> int:
    """
    Load the 4-column PaliÃÂ¢Ã¢âÂ¬Ã¢â¬ÅMyanmarÃÂ¢Ã¢âÂ¬Ã¢â¬ÅEnglish TSV (peu.tsv):
        headword\tpronunciation\tpart_of_speech\tsenses
    and produce MMD-style hierarchical sense lines so the frontend
    renderSenseLines() can display them correctly.
    """
    from collections import defaultdict

    if not path.exists():
        print(f"[WARN] Pali TSV not found: {path}")
        return 0
    print(f"Loading Pali TSV from {path} ...")
    # temp_struct[head][roman][pos] -> list[sense_line]
    temp_struct: dict[str, dict[str, dict[str, list[str]]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(list))
    )
    raw_headwords: dict[str, str] = {}
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f, delimiter="\t")
        first_row = True
        for row in reader:
            if not row:
                continue
            # Skip header row if present
            if first_row:
                first_row = False
                if (row[0] or "").strip().lower() == "headword":
                    continue
            raw_head = (row[0] or "").strip()
            if not raw_head:
                continue
            head = normalize_headword(raw_head)
            if not head or not contains_burmese(head):
                continue
            roman = (row[1] if len(row) > 1 else "").strip()
            # NEW: if the Pali TSV doesn't give a romanization, fall back to
            # the backend's approximate pronunciation helper.
            if not roman and contains_burmese(head):
                roman = _infer_pronunciation(head)
            pos = (row[2] if len(row) > 2 else "").strip()
            definition_raw = (row[3] if len(row) > 3 else "").strip()
            if not definition_raw:
                continue
            # Remember the "pretty" headword for display (with parentheses etc.)
            if head not in raw_headwords:
                raw_headwords[head] = raw_head
            # Split on both literal "\n" and real newlines
            def_for_split = definition_raw.replace("\\n", "\n")
            lines = [seg.strip() for seg in def_for_split.split("\n") if seg.strip()]
            if not lines:
                continue
            temp_struct[head][roman][pos].extend(lines)
    # Convert to 4-column hierarchical sense lines per headword
    for head in temp_struct:
        sense_lines: list[str] = []
        raw_head = raw_headwords.get(head, head)
        # Preserve insertion order of roman + pos
        for roman in temp_struct[head].keys():
            first_pos_for_roman = True
            for pos in temp_struct[head][roman].keys():
                senses = temp_struct[head][roman][pos]
                if not senses:
                    continue
                # First sense for this POS
                first_sense = senses[0]
                if first_pos_for_roman:
                    # headword\troman\tpos\tsense1
                    sense_lines.append(f"{raw_head}\t{roman}\t{pos}\t{first_sense}")
                    first_pos_for_roman = False
                else:
                    # \t\tpos\tsense1 (new POS under same roman)
                    sense_lines.append(f"\t\t{pos}\t{first_sense}")
                # Additional senses as \t\t\tsense
                for sense in senses[1:]:
                    sense = sense.strip()
                    if not sense:
                        continue
                    sense_lines.append(f"\t\t\t{sense}")
        if not sense_lines:
            continue
        # Pick a representative roman/pos for the entry (first seen)
        first_roman = next(iter(temp_struct[head].keys()))
        first_pos_map = temp_struct[head][first_roman]
        first_pos = next(iter(first_pos_map.keys()))
        layer.entries[head] = DictionaryEntry(
            headword=head,
            romanization=first_roman,
            pos=first_pos,
            senses=sense_lines,
            source=layer.source_name or layer.name,
            priority=layer.priority,
        )
    print(f"[PALI] loaded {len(layer.entries)} headwords.")
    return len(layer.entries)


# --- dictionary loader config ---
DICT_SOURCE_CONFIG = [
    {"name": "USER", "layer": "user", "loader": load_user_dict, "path": TSV_USER_PATH},
    {"name": "WIKI", "layer": "wiktionary", "loader": load_wiktionary_dict, "path": TSV_WIKI_PATH},
    {"name": "MMD", "layer": "mmd", "loader": load_mmd_dict, "path": TSV_MMD_PATH},
    {"name": "PALI", "layer": "pali", "loader": load_pali_dict, "path": TSV_PALI_PATH},
]


def load_dictionary():
    """
    Load dictionaries directly into the segmenter's layered dictionary.
    """
    global USER_TEXT_OVERRIDES, MANUAL_TEXT_OVERRIDES, DICT_LOADED, DICT_LOADING
    with DICT_LOAD_LOCK:
        if DICT_LOADED and SEGMENTER_INSTANCE is not None:
            return SEGMENTER_INSTANCE
        DICT_LOADING = True
        try:
            seg = init_new_segmenter()
            # Load user text overrides and rebuild override list
            USER_TEXT_OVERRIDES = load_user_text_overrides(TSV_USER_TEXT_OVERRIDE_PATH)
            MANUAL_TEXT_OVERRIDES = list(USER_TEXT_OVERRIDES)
            # 1) Load each source dict directly into its layer
            counts: list[tuple[str, int]] = []
            for cfg in DICT_SOURCE_CONFIG:
                layer_name = cfg["layer"]
                priority = DICT_PRIORITIES.get(layer_name, 50)
                layer = seg.dictionary.get_layer(layer_name)
                if layer:
                    layer.priority = priority
                    layer.source_name = cfg["name"]
                else:
                    layer = seg.dictionary.add_layer(
                        layer_name, priority=priority, source_name=cfg["name"]
                    )
                layer.entries.clear()
                try:
                    count = cfg["loader"](cfg["path"], layer)
                except Exception as e:
                    print(f"[WARN] Failed to load {cfg['name']} dictionary: {e}")
                    count = 0
                counts.append((cfg["name"], count))
            seg.dictionary.rebuild_cache()
            print(
                "[DEBUG] Dictionaries loaded into segmenter layers, initializing advanced segmenter (lmbrain)..."
            )
            # 3b) Initialise optional lmbrain-backed advanced segmenter for LM + spellcheck
            init_advanced_segmenter()
            # 4) Logging / stats
            if counts:
                print("[DICT layers] " + ", ".join(f"{name}={cnt} heads" for name, cnt in counts))
            print(f"[COMBINED] {seg.dictionary.word_count()} heads.")
            print(f"Logging all lookups to {LOG_PATH}")
            print(f"Logging misses (no results) to {MISS_LOG_PATH}")
            print(f"Logging unknown segments to {UNKNOWN_SEG_LOG_PATH}")
            DICT_LOADED = True
            return seg
        finally:
            DICT_LOADING = False
    # 5) POS tagger disabled.
    # init_pos_tagger()


def init_pos_tagger():
    """POS tagger disabled (phrase_chunker removed)."""
    return None


def add_user_dict_entry(raw_headword, romanization, pos_raw, definition):
    """
    Append a single entry to the per-user TSV on disk and update the
    segmenter's user layer so the change is visible immediately.
    Returns the normalized headword key.
    """
    raw_headword = (raw_headword or "").strip()
    definition = (definition or "").strip()
    if not raw_headword:
        raise ValueError("Headword is required.")
    head = normalize_headword(raw_headword)
    if not head or not contains_burmese(head):
        raise ValueError("Headword must contain Burmese script.")
    roman = (romanization or "").strip()
    pos = normalize_pos(pos_raw or "")
    # Ensure TSV exists and append new row
    file_exists = TSV_USER_PATH.exists()
    mode = "a" if file_exists else "w"
    with TSV_USER_PATH.open(mode, encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        if not file_exists:
            writer.writerow(["headword", "romanization", "pos", "definition"])
        writer.writerow([head, roman, pos, definition])
    # Update the new segmenter dictionary directly
    try:
        seg = get_segmenter_instance()
        layer = seg.dictionary.get_layer("user") or seg.dictionary.add_layer(
            "user",
            priority=DICT_PRIORITIES.get("user", 10),
            source_name="USER",
        )
        sense_line = "\t".join([head, roman, pos, definition])
        layer.add_entry(head, roman, pos, senses=[sense_line])
        seg.dictionary.rebuild_cache()
    except Exception as e:
        print("[WARN] Failed to update segmenter user dictionary:", e)
    return head


def add_user_text_override(raw: str, normalized: str) -> tuple[str, str]:
    """
    Append a single text override (raw -> normalized) to TSV and update in-memory overrides.
    Returns the normalized pair.
    """
    global USER_TEXT_OVERRIDES, MANUAL_TEXT_OVERRIDES
    raw = (raw or "").strip()
    normalized = (normalized or "").strip()
    if not raw or not normalized:
        raise ValueError("Raw and normalized forms are required.")
    if not contains_burmese(normalized):
        raise ValueError("Normalized form must contain Burmese script.")

    file_exists = TSV_USER_TEXT_OVERRIDE_PATH.exists()
    mode = "a" if file_exists else "w"
    with TSV_USER_TEXT_OVERRIDE_PATH.open(mode, encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        if not file_exists:
            writer.writerow(["raw", "normalized"])
        writer.writerow([raw, normalized])

    # Update in-memory overrides (replace any existing raw match).
    USER_TEXT_OVERRIDES = [(r, n) for (r, n) in USER_TEXT_OVERRIDES if r != raw]
    USER_TEXT_OVERRIDES.append((raw, normalized))
    MANUAL_TEXT_OVERRIDES = list(USER_TEXT_OVERRIDES)
    return raw, normalized


def _read_user_dict_rows(path: Path) -> list[dict]:
    rows: list[dict] = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        row_id = 0
        for row in reader:
            head = (row.get("headword") or "").strip()
            roman = (row.get("romanization") or "").strip()
            pos = (row.get("pos") or "").strip()
            definition = (row.get("definition") or "").strip()
            if not head and not roman and not pos and not definition:
                continue
            rows.append(
                {
                    "id": row_id,
                    "headword": head,
                    "romanization": roman,
                    "pos": pos,
                    "definition": definition,
                }
            )
            row_id += 1
    return rows


def _write_user_dict_rows(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        writer.writerow(["headword", "romanization", "pos", "definition"])
        for row in rows:
            writer.writerow(
                [
                    row.get("headword", ""),
                    row.get("romanization", ""),
                    row.get("pos", ""),
                    row.get("definition", ""),
                ]
            )


def _rebuild_user_dict_from_rows(rows: list[dict]) -> None:
    try:
        seg = get_segmenter_instance()
        layer = seg.dictionary.get_layer("user") or seg.dictionary.add_layer(
            "user",
            priority=DICT_PRIORITIES.get("user", 10),
            source_name="USER",
        )
        layer.entries.clear()
        for row in rows:
            head = (row.get("headword") or "").strip()
            if not head:
                continue
            head_norm = normalize_headword(head)
            if not head_norm:
                continue
            roman = (row.get("romanization") or "").strip()
            pos = (row.get("pos") or "").strip()
            definition = (row.get("definition") or "").strip()
            sense_line = "\t".join([head_norm, roman, pos, definition])
            layer.add_entry(head_norm, roman, pos, senses=[sense_line])
        seg.dictionary.rebuild_cache()
    except Exception as e:
        print("[WARN] Failed to rebuild user dictionary layer:", e)


def _read_text_override_rows(path: Path) -> list[dict]:
    rows: list[dict] = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        row_id = 0
        for row in reader:
            raw = (row.get("raw") or "").strip()
            normalized = (row.get("normalized") or "").strip()
            if not raw and not normalized:
                continue
            rows.append(
                {
                    "id": row_id,
                    "raw": raw,
                    "normalized": normalized,
                }
            )
            row_id += 1
    return rows


def _write_text_override_rows(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        writer.writerow(["raw", "normalized"])
        for row in rows:
            writer.writerow([row.get("raw", ""), row.get("normalized", "")])


def _reload_text_overrides_from_file() -> None:
    global USER_TEXT_OVERRIDES, MANUAL_TEXT_OVERRIDES
    USER_TEXT_OVERRIDES = load_user_text_overrides(TSV_USER_TEXT_OVERRIDE_PATH)
    MANUAL_TEXT_OVERRIDES = list(USER_TEXT_OVERRIDES)


# ---------------- segmentation (no ML) -------------------
def _build_grapheme_clusters(text: str) -> tuple[list[str], list[int]]:
    """
    Build low-level grapheme clusters for Myanmar text.
    A cluster is:
      - one base character, followed by
      - any number of combining marks (vowel signs, medials, tones, asat, etc.)
      - if the last mark was virama (?), include the stacked consonant + its marks
    """
    clusters: list[str] = []
    starts: list[int] = []
    n = len(text)
    i = 0
    while i < n:
        start = i
        ch = text[i]
        i += 1
        # Myanmar base + following combining marks
        if 0x1000 <= ord(ch) <= 0x109F and not (0x1040 <= ord(ch) <= 0x1049):
            # Collect all combining marks after the base
            while i < n and is_combining_mark(text[i]):
                i += 1
            # Handle stacked consonants (virama + consonant) - LOOP for multiple levels
            # Pali/Sanskrit words can have multiple consecutive stacks (e.g. င်္ဂ္ပ)
            while i > 0 and i < n and ord(text[i - 1]) == 0x1039:  # previous char was virama
                # Check if next char is a Myanmar consonant
                next_cp = ord(text[i])
                if 0x1000 <= next_cp <= 0x1021:  # Myanmar consonant range
                    i += 1  # Include the stacked consonant
                    # Collect any combining marks on the stacked consonant
                    while i < n and is_combining_mark(text[i]):
                        i += 1
                else:
                    break  # Next char isn't a stackable consonant, stop
        else:
            # Non-Myanmar base; just keep contiguous run of non-combining
            # non-Myanmar chars together. This keeps Latin / punctuation as
            # their own small clusters.
            while (
                i < n and not is_combining_mark(text[i]) and not (0x1000 <= ord(text[i]) <= 0x109F)
            ):
                i += 1
        # Append the cluster we just built (this is OUTSIDE both if/else)
        clusters.append(text[start:i])
        starts.append(start)
    return clusters, starts


# ---------------- TRUE SYLLABLE-ISH CLUSTERING ----------------
# consonants commonly used as codas (nasals + stops)
_CODA_INITIALS = set("ကတပစငံမယရလဉနည")
_ASAT = "\u103a"
# Medials that should *not* appear in pure codas
_CODA_BLOCKING_MEDIALS = {"?", "?", "?", "?"}
# Full vowel signs ÃÂ¢Ã¢âÂ¬Ã¢â¬Å shared between coda/tail heuristics.
_FULL_VOWEL_SIGNS = {
    "\u102b",  # tall AA
    "\u102c",  # AA
    "\u102d",  # I
    "\u102e",  # II
    "\u102f",  # U
    "\u1030",  # UU
    "\u1031",  # E
    "\u1032",  # AI
}


def _looks_like_coda_cluster(cluster: str) -> bool:
    """
    Heuristic: does this grapheme cluster *look* like a coda that should attach
    to the previous syllable, rather than start a new one?
    We now require:
      - starts with one of ? / ? / ? / ? / ? / ? / ? / ? / ? / ?
      - contains U+103A (asat)
      - does *not* contain any full vowel signs (?, ?, ...)
      - does *not* contain medials (?, ?, ?, ?)
    """
    if not cluster:
        return False
    first = cluster[0]
    if first not in _CODA_INITIALS:
        return False
    # must have asat (the "kill" mark)
    if _ASAT not in cluster:
        return False
    # NEW: if the cluster has any medials, treat it as a full syllable,
    # not as a coda. This stops "???" etc. from gluing.
    for ch in cluster:
        if ch in _CODA_BLOCKING_MEDIALS:
            return False
    # If there's a full vowel sign, treat as an independent syllable.
    for ch in cluster:
        if ch in _FULL_VOWEL_SIGNS:
            return False
    return True


def _can_attach_coda_to_prev(prev_cluster: str) -> bool:
    """
    Only attach a coda-looking cluster to the previous cluster if that previous
    cluster actually looks like a Myanmar syllable (not space/punctuation/etc.).
    """
    if not prev_cluster:
        return False
    last = prev_cluster[-1]
    # Don't glue onto whitespace
    if last.isspace():
        return False
    cp = ord(last)
    # Non-Myanmar: don't attach
    if not (0x1000 <= cp <= 0x109F):
        return False
    # Myanmar digits
    if 0x1040 <= cp <= 0x1049:
        return False
    # Myanmar punctuation (? ? ? etc.)
    if 0x104A <= cp <= 0x104F:
        return False
    return True


def _build_clusters(text: str) -> tuple[list[str], list[int], list[int]]:
    """
    Build *syllable-ish* clusters for the DP segmenter.
    Steps:
      1. Build raw grapheme clusters (_build_grapheme_clusters).
      2. Post-process them so that coda-shaped clusters (e.g. "??", "???", "??")
         are merged into the previous cluster, giving syllable-like units:
             ? | ???   ->  ????
             ?? | ??   ->  ????
             ? | ??   ->  ???

    Re-enabled (2026-01-31): Coda attachment enabled for syllable-like clusters.
    """
    base_clusters, base_starts = _build_grapheme_clusters(text)
    clusters: list[str] = []
    starts: list[int] = []
    for cluster, start in zip(base_clusters, base_starts):
        # Coda attachment disabled again: keep raw grapheme clusters.
        # if (
        #     clusters
        #     and _looks_like_coda_cluster(cluster)
        #     and _can_attach_coda_to_prev(clusters[-1])
        # ):
        #     # Merge into previous cluster
        #     clusters[-1] += cluster
        #     continue
        clusters.append(cluster)
        starts.append(start)
    # Build char -> cluster index map
    char_to_cluster = [-1] * len(text)
    for ci, start in enumerate(starts):
        end = start + len(clusters[ci])
        for j in range(start, end):
            char_to_cluster[j] = ci
    return clusters, starts, char_to_cluster


# ---------------- DP SEGMENTATION ----------------
_MAX_WORD_CLUSTERS = 16  # max clusters to consider for a single word
GRAMMAR_FORMS_SORTED: list[str] = []


def rebuild_grammar_forms_cache() -> None:
    """Refresh cached grammar forms (sorted list only; no duplicate set)."""
    global GRAMMAR_FORMS_SORTED
    try:
        GRAMMAR_FORMS_SORTED = sorted(GRAMMAR_LEXICON.keys(), key=len, reverse=True)
    except Exception:
        GRAMMAR_FORMS_SORTED = []


def _segment_by_clusters_dp_debug(text: str) -> dict:
    """
    Debug helper for the new segmenter: returns segment-level info.
    """
    if not text:
        return {
            "segments": [],
            "clusters": [],
            "starts": [],
            "cluster_ends": [],
            "dp_cost": [],
            "next_idx": [],
            "first_word": [],
            "events": [],
        }
    seg_inst = get_segmenter_instance()
    trace = segmenter_segment_with_trace(text)
    info = segmenter_segment_with_info(text)
    clusters = trace.get("clusters", [])
    starts = trace.get("starts", [])
    cluster_ends = trace.get("cluster_ends", [])

    # Cost breakdown helper so we can see where the cost comes from
    def _compute_cost_breakdown(seg_text: str, prev_word: str | None) -> dict:
        cfg = seg_inst.config
        norm = _normalize_burmese(seg_text)
        entry = seg_inst.dictionary.lookup(norm)
        lm_cost, lm_known = _get_unigram_cost(norm, seg_inst.lm)
        fallback_default = getattr(seg_inst.lm, "unigram_default_cost", 15.0)
        if entry and (entry.source or "").lower() == "user":
            lm_known = True
            if lm_cost is None:
                lm_cost = fallback_default
        syllables = count_syllables(seg_text)
        # Base cost
        if entry and (entry.source or "").lower() not in {"lm_vocab", "lm"}:
            if lm_known and lm_cost is not None:
                lm_val = min(lm_cost, fallback_default)
            else:
                lm_val = fallback_default * cfg.DICT_NO_LM_DISCOUNT
            base_cost = cfg.KNOWN_WORD_BASE_COST + cfg.UNIGRAM_WEIGHT * lm_val
            source = entry.source
            branch = "dict"
        elif lm_known:
            num_syllables = count_syllables(seg_text)
            lm_val = fallback_default
            base_cost = (
                cfg.UNKNOWN_WORD_BASE_COST
                + cfg.UNIGRAM_WEIGHT * lm_val
                + (num_syllables - 1) * cfg.OOV_SYLLABLE_PENALTY
            )
            source = "lm_only"
            branch = "lm_only"
        else:
            num_syllables = count_syllables(seg_text)
            base_cost = (
                cfg.UNKNOWN_WORD_BASE_COST
                + cfg.UNIGRAM_WEIGHT * fallback_default
                + (num_syllables - 1) * cfg.OOV_SYLLABLE_PENALTY
            )
            source = "oov"
            branch = "oov"
        # Bigram adjustment (one direction: current -> next in text order)
        bigram_adj = 0.0
        bigram_cost_prev = None
        bigram_cost_next = None
        bigram_known = False
        bigram_reward = 0.0
        bigram_score_prev = 0.0
        bigram_score_next = 0.0
        if prev_word and cfg.BIGRAM_WEIGHT > 0 and (norm in seg_inst.dictionary or lm_known):
            bigram_cost_next, known_next = _get_bigram_cost(norm, prev_word, seg_inst.lm)
            bigram_known = bool(known_next and bigram_cost_next is not None)
            if bigram_cost_next is not None:
                bigram_score_next = BIGRAM_SCORE_SCALE / (bigram_cost_next + 1e-9)
                bigram_reward = bigram_score_next
                bigram_adj = -cfg.BIGRAM_WEIGHT * bigram_reward
        total = base_cost + bigram_adj
        return {
            "total": float(total),
            "base": float(base_cost),
            "bigram_adj": float(bigram_adj),
            "lm_cost": float(lm_cost) if lm_cost is not None else float(fallback_default),
            "lm_known": bool(lm_known),
            "bigram_cost": float(bigram_cost_next) if bigram_cost_next is not None else None,
            "bigram_known": bool(bigram_known),
            "source": source,
            "branch": branch,
            "syllables": syllables,
            "components": {
                "known_word_base": cfg.KNOWN_WORD_BASE_COST if branch == "dict" else 0.0,
                "unknown_word_base": cfg.UNKNOWN_WORD_BASE_COST
                if branch in ("lm_only", "oov")
                else 0.0,
                "lm_unigram": float(lm_val if (lm_known or branch == "dict") else fallback_default),
                "lm_unigram_weighted": cfg.UNIGRAM_WEIGHT
                * float(lm_val if (lm_known or branch == "dict") else fallback_default),
                "unigram_weight": cfg.UNIGRAM_WEIGHT,
                "dict_discount": cfg.DICT_NO_LM_DISCOUNT
                if branch == "dict" and not lm_known
                else None,
                "oov_penalty": (syllables - 1) * cfg.OOV_SYLLABLE_PENALTY
                if branch in ("lm_only", "oov")
                else 0.0,
                "bigram_score": bigram_score_next if bigram_cost_next is not None else 0.0,
                "bigram_reward": bigram_reward,
                "bigram_reward_weighted": cfg.BIGRAM_WEIGHT * bigram_reward
                if bigram_reward
                else 0.0,
            },
        }

    # JSON-safe events (convert DictionaryEntry to plain dict) + breakdowns
    events = []
    prev_word = None
    for seg in info:
        entry = seg.get("entry")
        if entry:
            seg = dict(seg)
            seg["entry"] = {
                "headword": entry.headword,
                "romanization": entry.romanization,
                "pos": entry.pos,
                "definition": "\n".join(entry.senses) if entry.senses else "",
                "source": entry.source,
            }
        seg["cost_breakdown"] = _compute_cost_breakdown(seg.get("text", ""), prev_word)
        prev_word = seg.get("text", "")
        events.append(seg)
    return {
        "segments": [seg.get("text", "") for seg in info],
        "clusters": clusters,
        "starts": starts,
        "cluster_ends": cluster_ends,
        "dp_cost": trace.get("dp_cost", []),
        "next_idx": trace.get("next_idx", []),
        "first_word": trace.get("first_word", []),
        "events": events,
        "candidates": trace.get("candidates", []),
    }


# ------------- SECOND-PASS SPLITTER FOR UNKNOWN WORDS -------------
def _split_unknown_into_subsegments(seg: str) -> list[dict]:
    """
    For an unknown Burmese segment `seg`, break it into subsegments using
    greedy left-to-right longest dictionary match over syllable-ish clusters.
    - Uses _build_clusters(seg) for syllable-ish units.
    - At each cluster position, takes the longest substring (up to
      _MAX_WORD_CLUSTERS clusters) that is in DICT.
    - If nothing starting at that position is in DICT, it emits a
      single-cluster shard as an unknown subsegment.
    - No dedup: repeated subsegments are kept, so the sequence of
      heads fully covers `seg` and can be phonetically reconstructed.
    """
    seg = normalize_burmese(seg)
    if not seg or not contains_burmese(seg):
        return []
    clusters, starts, _ = _build_clusters(seg)
    n = len(clusters)
    if n <= 1:
        # Single-syllable unknown; the top-level unknown entry is enough.
        return []
    # End character index for each cluster
    cluster_ends = [s + len(c) for s, c in zip(starts, clusters)]
    sub_entries: list[dict] = []
    i = 0
    while i < n:
        start_char = starts[i]
        max_j = min(n, i + _MAX_WORD_CLUSTERS)
        best_piece = None
        best_piece_norm = None
        best_j = i + 1  # fallback: one cluster
        # Greedy longest-first search for a dictionary word starting at i
        for j in range(max_j, i, -1):
            end_char = cluster_ends[j - 1]
            piece = seg[start_char:end_char]
            piece_norm = normalize_headword(piece)
            if piece_norm in DICT:
                best_piece = piece
                best_piece_norm = piece_norm
                best_j = j
                break
        if best_piece is not None and best_piece_norm is not None:
            entry = DICT[best_piece_norm]
            sub_entries.append(
                {
                    "head": best_piece,
                    "roman": entry.get("roman", ""),
                    "pos": entry.get("pos", ""),
                    "senses": entry.get("senses", []),
                    "g2p": g2p_explain_for_ui(best_piece),
                }
            )
            i = best_j
        else:
            # No dictionary hit from this position: emit a 1-cluster shard
            end_char = cluster_ends[i]
            shard = seg[start_char:end_char]
            # Compute g2p romanization for unknown subsegments
            g2p_data = g2p_explain_for_ui(shard)
            roman = ""
            if g2p_data and g2p_data.get("syllables"):
                roman = " ".join(
                    s.get("roman", "") for s in g2p_data["syllables"] if s.get("roman")
                )
            sub_entries.append(
                {
                    "head": shard,
                    "roman": roman,
                    "pos": "unknown",
                    "senses": ["[no dictionary entry found for this subsegment]"],
                    "g2p": g2p_data,
                }
            )
            i += 1
    return sub_entries


def _decompose_known_head_into_subwords(head: str) -> list[dict]:
    """
    For a known dictionary head (e.g. 'မြန်မာ'), try to break it into
    smaller known subwords using the same cluster logic and a greedy
    longest-first search.
    - Uses _build_clusters(head), same as _split_unknown_into_subsegments.
    - Skips the trivial decomposition where the only piece is the whole head.
    - Returns a list of subentries {head, roman, pos, senses} in order.
      If we don't find at least two known subwords, returns [].
    """
    head = normalize_burmese(head)
    if not head or not contains_burmese(head):
        return []
    clusters, starts, _ = _build_clusters(head)
    n = len(clusters)
    if n <= 1:
        # Single-syllable head: nothing interesting to decompose.
        return []
    # End character index for each cluster
    cluster_ends = [s + len(c) for s, c in zip(starts, clusters)]
    sub_entries: list[dict] = []
    known_count = 0
    i = 0
    while i < n:
        start_char = starts[i]
        max_j = min(n, i + _MAX_WORD_CLUSTERS)
        best_piece = None
        best_piece_norm = None
        best_j = i + 1  # fallback: one cluster
        # Greedy longest-first search for a dictionary word starting at i
        for j in range(max_j, i, -1):
            end_char = cluster_ends[j - 1]
            piece = head[start_char:end_char]
            # Don't use the *entire* head as a sub-piece (we already know it)
            if piece == head and i == 0 and j == n:
                continue
            piece_norm = normalize_headword(piece)
            if piece_norm in DICT:
                best_piece = piece
                best_piece_norm = piece_norm
                best_j = j
                break
        if best_piece is not None and best_piece_norm is not None:
            entry = DICT[best_piece_norm]
            sub_entries.append(
                {
                    "head": best_piece,
                    "roman": entry.get("roman", ""),
                    "pos": entry.get("pos", ""),
                    "senses": entry.get("senses", []),
                    "g2p": g2p_explain_for_ui(best_piece),
                }
            )
            known_count += 1
            i = best_j
        else:
            # No dictionary hit from this position: just emit a 1-cluster shard,
            # but mark it unknown. This lets you see "gap" pieces if needed.
            end_char = cluster_ends[i]
            shard = head[start_char:end_char]
            # Compute g2p romanization for unknown subsegments
            g2p_data = g2p_explain_for_ui(shard)
            roman = ""
            if g2p_data and g2p_data.get("syllables"):
                roman = " ".join(
                    s.get("roman", "") for s in g2p_data["syllables"] if s.get("roman")
                )
            sub_entries.append(
                {
                    "head": shard,
                    "roman": roman,
                    "pos": "unknown",
                    "senses": ["[no dictionary entry found for this subsegment]"],
                    "g2p": g2p_data,
                }
            )
            i += 1
    # If we didn't actually find at least 2 known subwords, don't show anything.
    if known_count < 2:
        return []
    return sub_entries


def _dict_entry_payload(head: str, entry: dict) -> dict:
    pos = entry.get("pos", "") or ""
    return {
        "head": head,
        "roman": entry.get("roman", ""),
        "pos": pos,
        "meta_pos": get_meta_pos(pos),
        "senses": entry.get("senses", []),
        "source": entry.get("source", "DICT"),
        "g2p": g2p_explain_for_ui(head),
    }


def _unknown_subpart_payload(text: str) -> dict:
    g2p_data = g2p_explain_for_ui(text) if contains_burmese(text) else None
    return {
        "head": text,
        "roman": "",
        "pos": "unknown",
        "meta_pos": "unknown",
        "senses": ["[no dictionary entry found for this subpart]"],
        "source": "UNKNOWN_SUBPART",
        "g2p": g2p_data,
    }


def _fill_token_with_dict_for_ui(token: str) -> dict:
    """
    Cosmetic-only dictionary fill for a *single* token.
    Exact-match only: either one dictionary entry or unknown.
    """
    token = token or ""
    if not token:
        return {"mode": "unknown", "fills": [], "has_known": False, "has_unknown": False}

    token_key = normalize_headword(token)
    if token_key and token_key in DICT:
        entry = DICT[token_key]
        return {
            "mode": "exact",
            "fills": [_dict_entry_payload(token, entry)],
            "has_known": True,
            "has_unknown": False,
        }

    return {
        "mode": "unknown",
        "fills": [_unknown_subpart_payload(token)],
        "has_known": False,
        "has_unknown": True,
    }


def segment_with_pipeline(q: str) -> list[str]:
    """
    Return canonical DP-resegmented tokens using the fixed pipeline:
    stanza NER tokenizer -> DP resegmentation -> unknown merge.
    """
    if not q:
        return []
    initial_segments, island_spans = segment_with_pipeline_and_islands(q)
    if not initial_segments:
        return []
    segments, fills_by_seg, island_spans, _ = _dp_resegment_with_ner_protection(
        q, initial_segments, [], island_spans
    )
    segments, _ = _merge_consecutive_unknown_segments(segments, fills_by_seg, island_spans)
    return segments


def segment_with_pipeline_and_islands(
    q: str,
) -> tuple[list[str], list[tuple[int, int]]]:
    """
    Initial tokenization for the fixed pipeline: stanza NER tokenizer with spans.
    Returns stanza tokens plus island spans for DP resegmentation.
    """
    if not q:
        return [], []

    full = _segment_text_stanza_ner_with_spans(q)
    if full is None:
        # Fallback: DP segmentation over the whole text if stanza is unavailable.
        segs, _fills, island_spans = _dp_segment_text_only(q)
        return segs, island_spans

    tokens_with_spans = list(full) + _collect_myanmar_punct_tokens(q)
    if not tokens_with_spans:
        return [], []
    tokens_with_spans.sort(key=lambda t: t[1])
    segments = [tok for tok, _, _ in tokens_with_spans]
    spans = [(start, end) for _, start, end in tokens_with_spans]
    island_spans = _build_island_spans_from_token_spans(segments, spans)
    return segments, island_spans


# ==================== DP RESEGMENTATION (NER APPLIED AFTERWARD) ====================
def _dp_resegment_with_ner_protection(
    text: str,
    stanza_tokens: list[str],
    ner_entities: list[Any],
    island_spans: list[tuple[int, int]],
) -> tuple[list[str], list[dict | None], list[tuple[int, int]], list[str]]:
    """
    Full DP resegmentation over each island.

    - DP resegments everything, including inside NER spans
    - NER spans are applied after resegmentation in the caller
    - Original stanza tokens returned for fuzzy matching boundaries
    """
    if not stanza_tokens:
        return [], [], [], []

    seg_inst = get_segmenter_instance()

    new_segments: list[str] = []
    new_fills: list[dict | None] = []
    new_island_spans: list[tuple[int, int]] = []
    idx = 0
    for island_start, island_end in island_spans:
        if idx < island_start:
            for tok in stanza_tokens[idx:island_start]:
                new_segments.append(tok)
                new_fills.append(None)
            idx = island_start
        island_new_start = len(new_segments)

        island_tokens = stanza_tokens[island_start:island_end]
        island_text = "".join(island_tokens)
        # Run DP across the whole island (NER is applied after resegmentation).
        dp_segments = seg_inst.segment(island_text)
        pos = 0
        for seg in dp_segments:
            seg_start = pos
            seg_end = pos + len(seg)
            pos = seg_end
            _ = seg_start, seg_end
            fill = _fill_token_with_dict_for_ui(seg)
            fill["mode"] = "dp_resegment"
            new_segments.append(seg)
            new_fills.append(fill)

        island_new_end = len(new_segments)
        if island_new_end > island_new_start:
            new_island_spans.append((island_new_start, island_new_end))
        idx = island_end

    if idx < len(stanza_tokens):
        for tok in stanza_tokens[idx:]:
            new_segments.append(tok)
            new_fills.append(None)

    return new_segments, new_fills, new_island_spans, list(stanza_tokens)


def _dp_segment_text_only(text: str) -> tuple[list[str], list[dict | None], list[tuple[int, int]]]:
    """
    Pure DP segmentation on raw text, without any neural/stanza pre-pass or NLP overlays.
    Returns (segments, fills_by_seg, island_spans).
    """
    if not text:
        return [], [], []
    seg_inst = get_segmenter_instance()
    dp_segments = seg_inst.segment(text)
    fills_by_seg: list[dict | None] = []
    for seg in dp_segments:
        fill = _fill_token_with_dict_for_ui(seg)
        fill["mode"] = "dp_only"
        fills_by_seg.append(fill)
    island_spans = _build_island_spans_from_segments(dp_segments)
    return dp_segments, fills_by_seg, island_spans


def _merge_consecutive_unknown_segments(
    segments: list[str],
    fills_by_seg: list[dict | None],
    island_spans: list[tuple[int, int]] | None = None,
) -> tuple[list[str], list[dict | None]]:
    """
    Merge consecutive unknown-only segments into a single token.
    Unknown-only means: has_known == False and has_unknown == True.
    """
    if not segments:
        return [], []
    out_segments: list[str] = []
    out_fills: list[dict | None] = []

    if not island_spans:
        # No islands provided: preserve input as-is.
        return list(segments), list(fills_by_seg)

    cur = 0
    for s, e in island_spans:
        # Copy any non-island prefix unchanged.
        while cur < s and cur < len(segments):
            out_segments.append(segments[cur])
            out_fills.append(fills_by_seg[cur] if cur < len(fills_by_seg) else None)
            cur += 1

        i = s
        while i < e and i < len(segments):
            seg = segments[i]
            fill = fills_by_seg[i] if i < len(fills_by_seg) else None
            has_known = bool((fill or {}).get("has_known"))
            has_unknown = bool((fill or {}).get("has_unknown"))
            is_unknown_only = (not has_known) and has_unknown

            if not is_unknown_only:
                out_segments.append(seg)
                out_fills.append(fill)
                i += 1
                continue

            merged = [seg]
            j = i + 1
            while j < e and j < len(segments):
                f2 = fills_by_seg[j] if j < len(fills_by_seg) else None
                hk2 = bool((f2 or {}).get("has_known"))
                hu2 = bool((f2 or {}).get("has_unknown"))
                if hk2 or not hu2:
                    break
                merged.append(segments[j])
                j += 1

            merged_text = "".join(merged)
            merged_fill = _fill_token_with_dict_for_ui(merged_text)
            merged_fill["mode"] = "unknown_merge"
            out_segments.append(merged_text)
            out_fills.append(merged_fill)
            i = j

        cur = e

    # Copy any trailing suffix unchanged.
    while cur < len(segments):
        out_segments.append(segments[cur])
        out_fills.append(fills_by_seg[cur] if cur < len(fills_by_seg) else None)
        cur += 1

    return out_segments, out_fills


def _build_segment_offsets(text: str, segments: list[str]) -> list[tuple[int, int]] | None:
    if not segments:
        return []
    if not text:
        return None
    offsets: list[tuple[int, int]] = []
    idx = 0
    for seg in segments:
        if not seg:
            return None
        pos = text.find(seg, idx)
        if pos < 0:
            return None
        end = pos + len(seg)
        offsets.append((pos, end))
        idx = end
    return offsets


# -------------------------------------------------------------------
# POS DISAMBIGUATION / GRAMMAR HINTING OVERLAY (myPOS-driven)
# -------------------------------------------------------------------
# Goal:
#   Given a list of segmented Burmese tokens (one clause/sentence),
#   use dictionary POS information + statistics from the myPOS corpus
#   to select a "most likely" POS for each token.
#
# myPOS is used *only* to weight probabilities:
#   - lexical priors P(tag | token)
#   - tag bigram transitions P(tag_i | tag_{i-1})
#
# Candidate POS tags for each token still come only from DICT.
#
# Output:
#   {
#     "tokens": [
#       {
#         "text": "???",
#         "pos_candidates": ["ppm", "part"],
#         "best_pos": "ppm",
#         "confidence": 0.9,   # 0.0ÃÂ¢Ã¢âÂ¬Ã¢â¬Å1.0
#       },
#       ...
#     ]
#   }
from math import inf as _INF
import math
import os
from collections import defaultdict

# -------------------------------------------------------------------
# Config
# -------------------------------------------------------------------
# Path to myPOS corpus (adjust if needed)
# (reuses MYPOS_CORPUS_PATH from the main config section)
# Coarse tag set we collapse everything into for the algorithm.
# These align with your actual tags:
#   adj, adv, conj, exp, int, kjano, n, part, pos, ppm, pron, v
_COARSE_POS_TAGS = {
    "adj",
    "adv",
    "conj",
    "exp",
    "int",
    "kjano",
    "n",
    "part",
    "pos",
    "ppm",
    "pron",
    "v",
}
# Weights / smoothing for myPOS-based scoring
_LEXICAL_WEIGHT = 1.0  # strength of lexical prior log P(tag | token)
_BIGRAM_WEIGHT = 0.7  # strength of transition log P(tag_i | tag_{i-1})
_LEX_SMOOTH = 0.0  # add-one etc; leave 0 for now (we clamp to eps)
_TRANS_SMOOTH = 0.1  # small smoothing for unseen bigrams
_MIN_LEX_PROB = 1e-4  # floor for lexical probability
_MIN_TRANS_PROB = 1e-4  # floor for transition probability
# Globals for myPOS statistics
_MYPOS_STATS_LOADED = False
_TOKEN_TAG_COUNTS: dict[str, dict[str, int]] = {}
_TAG_UNIGRAM_COUNTS: dict[str, int] = {}
_TAG_BIGRAM_COUNTS: dict[tuple[str, str], int] = {}
_LEXICAL_TAG_PRIORS: dict[str, dict[str, float]] = {}
_TAG_TRANSITION_LOGPROBS: dict[tuple[str, str], float] = {}


# -------------------------------------------------------------------
# Tag normalisation
# -------------------------------------------------------------------
def _coarse_pos_tag(raw_pos: str) -> str:
    """
    Map raw POS strings (dict or myPOS) into your coarse tag set.
    We only use coarse tags internally; the UI can still show the
    original fine-grained POS labels.
    """
    p = (raw_pos or "").strip().lower()
    if not p:
        return ""
    # Core tags first
    if p.startswith("adj"):
        return "adj"
    if p.startswith("adv"):
        return "adv"
    if p.startswith("pron"):
        return "pron"
    if p.startswith("conj"):
        return "conj"
    if p.startswith("exp"):
        return "exp"
    if p.startswith("int") or p.startswith("interj"):
        return "int"
    if p.startswith("pos"):  # possessive etc.
        return "pos"
    # Numerals / classifiers / measure words
    if p.startswith("kjano") or p.startswith("num") or p in {"m", "nm", "tn"}:
        return "kjano"
    # Postpositions / case markers
    if p.startswith("ppm") or p.startswith("postp") or p.startswith("prep"):
        return "ppm"
    # Particles (verbal / clausal / sentence-final)
    if p.startswith("part") or p.startswith("particle"):
        return "part"
    # Nouns (including proper)
    if p.startswith("n"):
        return "n"
    # Verbs / auxiliaries
    if p.startswith("v") or p.startswith("aux"):
        return "v"
    # myPOS extras we don't explicitly model: fw, sb, abb, punc etc.
    # These will map to "" and be ignored.
    return p if p in _COARSE_POS_TAGS else ""


# -------------------------------------------------------------------
# Dictionary ? POS candidate extraction (unchanged logic)
# -------------------------------------------------------------------
def _extract_pos_candidates_from_entry(entry: dict) -> list[str]:
    """
    Given a DICT[head] entry, collect all POS tags that appear
    for this headword (main pos + any embedded POS in sense lines),
    then collapse them to coarse tags.
    Returns a *sorted* list of unique coarse tags.
    """
    candidates: set[str] = set()
    # 1) Primary pos on the entry
    main_pos = _coarse_pos_tag(entry.get("pos", ""))
    if main_pos:
        candidates.add(main_pos)
    # 2) Embedded POS in hierarchical sense lines (MMD/PALI style)
    senses = entry.get("senses", []) or []
    for line in senses:
        parts = line.split("\t")
        if len(parts) >= 3:
            raw_pos = (parts[2] or "").strip()
            if raw_pos:
                p = _coarse_pos_tag(raw_pos)
                if p:
                    candidates.add(p)
    out = sorted(candidates)
    return out


def _get_pos_candidates_for_token(token: str) -> list[str]:
    """
    Wrapper to fetch all plausible coarse POS tags for a single token.
    If DICT has no entry, returns [].
    """
    if not token or not contains_burmese(token):
        return []
    head = normalize_burmese(token)
    entry = DICT.get(head)
    if not entry:
        return []
    return _extract_pos_candidates_from_entry(entry)


# -------------------------------------------------------------------
# myPOS statistics loading
# -------------------------------------------------------------------
def _ensure_mypos_stats_loaded() -> None:
    global _MYPOS_STATS_LOADED
    if _MYPOS_STATS_LOADED:
        return
    if not MYPOS_CORPUS_PATH or not os.path.exists(MYPOS_CORPUS_PATH):
        # Fail gracefully: fall back to heuristic-only behaviour
        _MYPOS_STATS_LOADED = True
        return
    _load_mypos_statistics(MYPOS_CORPUS_PATH)
    _MYPOS_STATS_LOADED = True


def _load_mypos_statistics(path: str) -> None:
    """
    One-time pass over myPOS corpus to fill:
      - _TOKEN_TAG_COUNTS[token][tag]
      - _TAG_UNIGRAM_COUNTS[tag]
      - _TAG_BIGRAM_COUNTS[(tag_prev, tag_cur)]
    Then compute:
      - _LEXICAL_TAG_PRIORS[token][tag] = P(tag|token)
      - _TAG_TRANSITION_LOGPROBS[(t_prev, t_cur)] = log P(t_cur|t_prev)
    """
    global _TOKEN_TAG_COUNTS, _TAG_UNIGRAM_COUNTS, _TAG_BIGRAM_COUNTS
    global _LEXICAL_TAG_PRIORS, _TAG_TRANSITION_LOGPROBS
    token_tag_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    tag_unigrams: dict[str, int] = defaultdict(int)
    tag_bigrams: dict[tuple[str, str], int] = defaultdict(int)
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            # Sentence-level: reset previous tag at each new line
            prev_tag: str | None = None
            # myPOS: tokens separated by spaces; compounds use "|"
            for tok in line.split():
                # Split compound word notation: "?????/n|????????/n"
                for chunk in tok.split("|"):
                    if "/" not in chunk:
                        continue
                    # split on last "/" to be safe
                    word, raw_tag = chunk.rsplit("/", 1)
                    word = normalize_burmese(word)
                    coarse_tag = _coarse_pos_tag(raw_tag)
                    # Ignore things we don't model (punc, fw, sb, etc.)
                    if not coarse_tag or coarse_tag not in _COARSE_POS_TAGS:
                        prev_tag = None
                        continue
                    # Lexical counts
                    token_tag_counts[word][coarse_tag] += 1
                    # Tag unigram
                    tag_unigrams[coarse_tag] += 1
                    # Tag bigram (skip if no previous tag in this sentence)
                    if prev_tag is not None:
                        tag_bigrams[(prev_tag, coarse_tag)] += 1
                    prev_tag = coarse_tag
    # Store raw counts
    _TOKEN_TAG_COUNTS = {w: dict(cnts) for w, cnts in token_tag_counts.items()}
    _TAG_UNIGRAM_COUNTS = dict(tag_unigrams)
    _TAG_BIGRAM_COUNTS = dict(tag_bigrams)
    # Derive lexical priors P(tag|token)
    lexical_priors: dict[str, dict[str, float]] = {}
    for w, tag_counts in _TOKEN_TAG_COUNTS.items():
        total = sum(tag_counts.values())
        if total <= 0:
            continue
        inner: dict[str, float] = {}
        # simple MLE; smoothing is via clamping to _MIN_LEX_PROB at scoring time
        for tag, c in tag_counts.items():
            p = c / total
            inner[tag] = p
        lexical_priors[w] = inner
    _LEXICAL_TAG_PRIORS = lexical_priors
    # Derive transition log-probs log P(tag_cur | tag_prev)
    tags_seen = set(tag_unigrams.keys())
    num_tags = max(1, len(tags_seen))
    trans_logprobs: dict[tuple[str, str], float] = {}
    for (t_prev, t_cur), c_bigram in _TAG_BIGRAM_COUNTS.items():
        total_prev = tag_unigrams.get(t_prev, 0)
        if total_prev <= 0:
            continue
        # add small smoothing for unseen continuations
        p = (c_bigram + _TRANS_SMOOTH) / (total_prev + _TRANS_SMOOTH * num_tags)
        if p <= 0.0:
            p = _MIN_TRANS_PROB
        trans_logprobs[(t_prev, t_cur)] = math.log(p)
    _TAG_TRANSITION_LOGPROBS = trans_logprobs


# -------------------------------------------------------------------
# Scoring functions (now myPOS-driven)
# -------------------------------------------------------------------
def _tag_bigram_score(t_prev: str, t_cur: str) -> float:
    """
    Pairwise tag compatibility score using myPOS bigram statistics.
    """
    if not t_prev or not t_cur:
        return 0.0
    # If stats failed to load, just return 0
    if not _TAG_TRANSITION_LOGPROBS:
        return 0.0
    key = (t_prev, t_cur)
    logp = _TAG_TRANSITION_LOGPROBS.get(key)
    if logp is None:
        # unseen: back off to small floor
        logp = math.log(_MIN_TRANS_PROB)
    return _BIGRAM_WEIGHT * logp


def _local_pos_score(token: str, tag: str, candidates: list[str]) -> float:
    """
    Local score for assigning 'tag' to 'token', ignoring neighbours.
    Now driven primarily by lexical priors from myPOS:
      - P(tag | token) from corpus
      - small stabiliser for single-candidate tokens
      - light numeric / classifier bias
    No hand-coded grammar hint list any more.
    """
    if not tag:
        return -5.0
    # If this tag isn't even a candidate (shouldn't happen), nuke it.
    if candidates and tag not in candidates:
        return -20.0
    score = 0.0
    # Lexical prior from myPOS: P(tag | token)
    priors = _LEXICAL_TAG_PRIORS.get(token)
    if priors:
        p = priors.get(tag, _MIN_LEX_PROB)
        if p <= 0.0:
            p = _MIN_LEX_PROB
        score += _LEXICAL_WEIGHT * math.log(p)
    else:
        # Unknown token to myPOS: neutral (let context + dict handle it)
        score += 0.0
    # Single candidate: stabilise a bit so sequence model doesn't flip it
    if len(candidates) == 1 and tag == candidates[0]:
        score += 0.5
    # Numeric-ish tokens: prefer kjano/n very lightly
    if any(ch.isdigit() for ch in token):
        if tag in {"kjano", "n"}:
            score += 0.5
        elif tag in {"v", "adj"}:
            score -= 0.5
    return score


# -------------------------------------------------------------------
# Viterbi decoding + public API
# -------------------------------------------------------------------
def _viterbi_pos_sequence(tokens: list[str]) -> tuple[list[str], list[dict[str, float]]]:
    """
    Core POS sequence decoder.
    Input:
      tokens: list of segmented Burmese words (one clause / sentence).
    Output:
      (best_tags, local_scores_per_position)
      best_tags[i] is the chosen coarse POS for tokens[i].
      local_scores_per_position[i] is a dict {tag -> local_score}
      that we later use to derive a "confidence" strength.
    """
    # Ensure myPOS stats are available before scoring
    _ensure_mypos_stats_loaded()
    n = len(tokens)
    if n == 0:
        return [], []
    # Build candidate tag sets and local scores
    C: list[list[str]] = []
    local_scores: list[dict[str, float]] = []
    for tok in tokens:
        cand = _get_pos_candidates_for_token(tok)
        if not cand:
            cand = []
        C.append(cand)
        ls: dict[str, float] = {}
        for t in cand:
            ls[t] = _local_pos_score(tok, t, cand)
        local_scores.append(ls)
    # If everything is unknown / has no tags, bail out
    if all(len(c) == 0 for c in C):
        return ["" for _ in tokens], local_scores
    # Viterbi DP: dp[i][tag] = best score up to position i if position i has tag
    dp: list[dict[str, float]] = []
    back: list[dict[str, str]] = []
    for i in range(n):
        dp.append({})
        back.append({})
        tok = tokens[i]
        cand_i = C[i]
        # If no candidates, propagate previous best without change
        if not cand_i:
            if i == 0:
                dp[i][""] = 0.0
                back[i][""] = ""
            else:
                best_prev_tag = max(dp[i - 1], key=lambda t: dp[i - 1][t])
                dp[i][""] = dp[i - 1][best_prev_tag]
                back[i][""] = best_prev_tag
            continue
        for t in cand_i:
            loc = local_scores[i].get(t, 0.0)
            best_score = -_INF
            best_prev = ""
            if i == 0:
                # No previous tag
                best_score = loc
                best_prev = ""
            else:
                for t_prev, prev_score in dp[i - 1].items():
                    pair = _tag_bigram_score(t_prev, t)
                    s = prev_score + loc + pair
                    if s > best_score:
                        best_score = s
                        best_prev = t_prev
            dp[i][t] = best_score
            back[i][t] = best_prev
    # Choose best final tag
    last_idx = n - 1
    if not dp[last_idx]:
        return ["" for _ in tokens], local_scores
    last_tag = max(dp[last_idx], key=lambda t: dp[last_idx][t])
    best_tags = [""] * n
    best_tags[last_idx] = last_tag
    for i in range(n - 1, 0, -1):
        best_tags[i - 1] = back[i].get(best_tags[i], "")
    return best_tags, local_scores


def _confidence_from_local_scores(local_scores_i: dict[str, float], best_tag: str) -> float:
    """
    Turn local score differences into a crude confidence value in [0, 1].
    Uses only local scores (lexical priors), not sequence scores.
    """
    if not local_scores_i or not best_tag:
        return 0.0
    best = local_scores_i.get(best_tag, 0.0)
    if len(local_scores_i) == 1:
        return 1.0
    second = -_INF
    for t, s in local_scores_i.items():
        if t == best_tag:
            continue
        if s > second:
            second = s
    if second == -_INF:
        return 1.0
    diff = best - second
    if diff >= 4.0:
        return 1.0
    if diff >= 2.0:
        return 0.85
    if diff >= 1.0:
        return 0.6
    if diff >= 0.5:
        return 0.4
    return 0.25


def build_pos_overlay_for_segments(segments: list[str]) -> dict:
    """
    Public entry point: given a list of segmented Burmese tokens
    (one clause or sentence), return a POS overlay structure.
    The UI can use:
      - pos_candidates  -> which POS the dict knows about
      - best_pos        -> which one is most likely active in context
      - confidence      -> how strongly to highlight that POS (0ÃÂ¢Ã¢âÂ¬Ã¢â¬Å1)
    """
    tokens = [normalize_burmese(s) for s in (segments or []) if s]
    if not tokens:
        return {"tokens": []}
    best_tags, local_scores = _viterbi_pos_sequence(tokens)
    out_tokens: list[dict] = []
    for i, tok in enumerate(tokens):
        cand = _get_pos_candidates_for_token(tok)
        best = best_tags[i] if i < len(best_tags) else ""
        conf = _confidence_from_local_scores(
            local_scores[i] if i < len(local_scores) else {},
            best,
        )
        out_tokens.append(
            {
                "text": tok,
                "pos_candidates": cand,
                "best_pos": best,
                "confidence": float(conf),
            }
        )
    return {"tokens": out_tokens}


# ---------------- LM OVERLAY FOR UI ----------------
def build_lm_overlay_for_segments(segments: list[str]) -> dict:
    """
    Build a lightweight LM overlay for a *single* segmented query, to drive the UI.
    Returns a dict:
      {
        "tokens": [
          {
            "text": "...",
            "unigram_cost": <float or None>,
            "rarity_score": <float in [0,1] or None>,  # 0 = very common, 1 = very rare
            "dict_known": <bool>,
            "lm_known": <bool>,
            "ok_for_lm": <bool>,  # used to gate collocs/phrases
          },
          ...
        ],
        "edges": [
          {
            "i": <int>,            # left index in segments
            "j": <int>,            # right index in segments (= i+1)
            "bigram": "w_i w_j",
            "strength": <float in (0,1]>,  # normalized collocation strength
          },
          ...
        ],
        "phrases": [
          {
            "start": <int>,        # inclusive
            "end": <int>,          # exclusive
            "phrase": "<string>",
            "tokens": [ ... ],     # from LM
            "count": <int>,
            "unigram_cost": <float>,
          },
          ...
        ],
      }
    """
    overlay: dict = {
        "tokens": [],
        "edges": [],
        "phrases": [],
    }
    if not segments:
        return overlay
    n = len(segments)
    tokens: list[dict] = []
    use_for_lm: list[bool] = [False] * n
    # Which LM helpers do we actually have?
    has_unigram_lm = get_unigram_cost is not None
    has_bigram_lm = get_bigram_cost is not None
    has_phrase_lm = ADVANCED_SEGMENTER is not None
    # Lazily derive global unigram cost bounds (for rarity) if possible.
    # This is safe even if UNIGRAM_MIN_COST / MAX were never defined before.
    g = globals()
    min_cost = g.get("UNIGRAM_MIN_COST")
    max_cost = g.get("UNIGRAM_MAX_COST")
    if min_cost is None or max_cost is None:
        try:
            from lmbrain import UNIGRAM_COST  # type: ignore
        except Exception:
            min_cost = None
            max_cost = None
        else:
            try:
                if UNIGRAM_COST:
                    costs = list(UNIGRAM_COST.values())
                    min_cost = float(min(costs))
                    max_cost = float(max(costs))
                else:
                    min_cost = None
                    max_cost = None
            except Exception:
                min_cost = None
                max_cost = None
        g["UNIGRAM_MIN_COST"] = min_cost
        g["UNIGRAM_MAX_COST"] = max_cost
    have_global_bounds = min_cost is not None and max_cost is not None and max_cost > min_cost
    # 1) Per-token info + global-ish rarity score
    for idx, w in enumerate(segments):
        info = {
            "text": w,
            "unigram_cost": None,
            "rarity_score": None,
            "dict_known": False,
            "lm_known": False,
            "ok_for_lm": False,
        }
        # Dictionary knowledge
        norm_w = normalize_burmese(w)
        dict_key = normalize_headword(w)
        dict_known = dict_key in DICT
        info["dict_known"] = dict_known
        # If it's not Burmese or empty/garbage, don't try LM on it
        if not has_unigram_lm or not contains_burmese(w) or len(w.strip()) == 0:
            tokens.append(info)
            continue
        cost = None
        try:
            c = float(get_unigram_cost(norm_w))
            if math.isfinite(c):
                cost = c
        except Exception:
            cost = None
        lm_known = cost is not None
        info["lm_known"] = lm_known
        # Only allow into collocs/phrases if:
        #   (a) in DICT, AND
        #   (b) LM has a usable unigram cost.
        ok_for_lm = bool(dict_known and lm_known)
        info["ok_for_lm"] = ok_for_lm
        if ok_for_lm:
            use_for_lm[idx] = True
        if lm_known:
            info["unigram_cost"] = cost
            # Prefer global bounds if we have them; otherwise fall back
            # to a logistic mapping of cost.
            rarity = None
            if have_global_bounds:
                try:
                    span = max(max_cost - min_cost, 1e-6)
                    rarity = (cost - min_cost) / span
                    rarity = max(0.0, min(1.0, rarity))
                except Exception:
                    rarity = None
            if rarity is None:
                # Fallback: cost ~ -log P, map to [0,1] via logistic.
                # Center at ~8 with moderate slope.
                try:
                    rarity = 1.0 / (1.0 + math.exp(-(cost - 8.0) / 3.0))
                    rarity = max(0.0, min(1.0, rarity))
                except Exception:
                    rarity = None
            info["rarity_score"] = rarity
        tokens.append(info)
    overlay["tokens"] = tokens
    # 2) Bigram edges (collocations) between successive tokens.
    #    IMPORTANT: only between tokens we marked ok_for_lm on BOTH sides,
    #    so you do NOT get collocs inside unknown blobs like ??? + ???.
    edges: list[dict] = []
    if has_bigram_lm:
        for i in range(n - 1):
            # Skip any pair touching a token we decided is not ok_for_lm
            if not (use_for_lm[i] and use_for_lm[i + 1]):
                continue
            w_i = segments[i]
            w_j = segments[i + 1]
            bigram = f"{w_i} {w_j}"
            try:
                cost = float(get_bigram_cost(w_i, w_j))
            except Exception:
                continue
            if not math.isfinite(cost):
                continue
            # Strong collocations = low bigram cost.
            # Map cost (roughly -log P) into (0,1] strength.
            try:
                # Shift & scale so that:
                #   cost <= 5  ? strength ~ 1.0
                #   cost  ~ 8  ? strength ~ 0.37
                #   cost >= 14 ? strength ~ 0.05
                shifted = max(cost - 5.0, 0.0)
                strength = math.exp(-shifted / 3.0)
            except Exception:
                strength = 0.0
            # Drop extremely weak links
            if strength <= 0.02:
                continue
            edges.append(
                {
                    "i": i,
                    "j": i + 1,
                    "bigram": bigram,
                    "strength": strength,
                }
            )
    overlay["edges"] = edges
    # 3) Phrase detection: skip any span that contains a token
    #    we marked as not ok_for_lm, so no phrases over unknown blobs.
    phrases: list[dict] = []
    if has_phrase_lm:
        try:
            phrase_hits = ADVANCED_SEGMENTER.detect_phrases(segments)
        except Exception:
            phrase_hits = []
        for ph in phrase_hits or []:
            span = ph.get("span")
            if not span or len(span) != 2:
                continue
            try:
                start, end = int(span[0]), int(span[1])
            except Exception:
                continue
            if start < 0 or end <= start or end > n:
                continue
            # Drop phrases that touch unknown / out-of-LM tokens
            if not all(use_for_lm[k] for k in range(start, end)):
                continue
            phrases.append(
                {
                    "start": start,
                    "end": end,
                    "phrase": ph.get("phrase", ""),
                    "tokens": ph.get("tokens", []),
                    "count": ph.get("count", 0),
                    "unigram_cost": ph.get("unigram_cost", 0.0),
                }
            )
    overlay["phrases"] = phrases
    return overlay
    # --- GRAMMAR LEXICON METADATA (Candier-style function words) --------------


GRAMMAR_LEXICON = {}  # type: dict[str, list[dict]]
GRAMMAR_CATEGORY_TO_TYPE: dict[str, str] = {
    "Clauses and verb attributes (Stc~, Phr~)": "CLAUSE_ATTR",
    "Common elements in compound nouns (N~, V~)": "COMPOUND_NOUN_ELEM",
    "Common elements in compound verbs (V~)": "COMPOUND_VERB_ELEM",
    "Common numeratives (classifiers, NÃâÃÂº~)": "CLASSIFIER",
    "Common pre-verbs (~V)": "PREVERB",
    "Coordinate markers (NÃâÃÂ¹~NÃâÃÂ², NÃâÃÂ¹~NÃâÃÂ²~)": "COORDINATOR",
    "Location nouns": "LOCATION_NOUN",
    "Miscellaneous function-like items": "MISC_FUNC",
    "Noun attribute markers (N~N)": "NOUN_ATTR_MARKER",
    "Noun markers (case/postposition, N~)": "NOUN_MARKER",
    "Noun modifiers (N~)": "NOUN_MODIFIER",
    "Negation markers (V~)": "NEGATION_MARKER",
    "Selectives (demonstratives / interrogatives, ~, ~N, ~sfx)": "SELECTIVE",
    "Sentence markers (V~, N~)": "SENTENCE_MARKER",
    "Sentence-medial phrase particles (Phr~)": "SENTENCE_MEDIAL_PART",
    "Sentence-final phrase particles (Stc~)": "SENTENCE_FINAL_PART",
    "Special head nouns / nominalizers (V~)": "HEAD_NOUN",
    "Subordinate clause markers (V~, N~)": "SUBORDINATE_CLAUSE_MARKER",
    "Subordinate sentence markers (VA~)": "SUBORDINATE_SENTENCE_MARKER",
    "Verb attribute markers (V~N)": "VERB_ATTR_MARKER",
    "Verb modifiers / auxiliaries (V~)": "VERB_MODIFIER",
}
# For each coarse grammar type we define how it usually attaches to neighbours.
# direction: "LEFT" (looks left), "RIGHT" (looks right), "BOTH", "NONE" (no explicit head)
# target_coarse_pos: set of coarse POS labels the head is expected to have.
# max_distance: how many tokens away we are willing to look for a head.
GRAMMAR_LINK_RULES: dict[str, dict] = {
    # Case markers and postpositions typically follow an NP (noun or pronoun)
    "NOUN_MARKER": {
        "role": "case/postposition",
        "direction": "LEFT",
        "target_coarse_pos": {"N", "PRON"},
        "max_distance": 1,
    },
    # Noun modifiers (plural markers, focus markers for NPs, etc.) also follow an NP
    "NOUN_MODIFIER": {
        "role": "noun-modifier",
        "direction": "LEFT",
        "target_coarse_pos": {"N", "PRON"},
        "max_distance": 1,
    },
    # NounÃÂ¢Ã¢âÂ¬Ã¢â¬Ånoun attribute markers usually sit between nouns; link to the following N
    "NOUN_ATTR_MARKER": {
        "role": "noun-attribute-link",
        "direction": "RIGHT",
        "target_coarse_pos": {"N", "PRON"},
        "max_distance": 1,
    },
    # Classifiers most often follow a numeral or a noun; we treat them as attaching left
    "CLASSIFIER": {
        "role": "classifier",
        "direction": "LEFT",
        "target_coarse_pos": {"NUM", "N", "PRON"},
        "max_distance": 1,
    },
    # Selectives (demonstratives / interrogatives) behave like noun modifiers
    "SELECTIVE": {
        "role": "selective",
        "direction": "LEFT",
        "target_coarse_pos": {"N", "PRON"},
        "max_distance": 1,
    },
    # Location nouns usually follow an NP they localise
    "LOCATION_NOUN": {
        "role": "location-noun",
        "direction": "LEFT",
        "target_coarse_pos": {"N", "PRON"},
        "max_distance": 1,
    },
    # Verb modifiers / auxiliaries follow a main verb stem
    "VERB_MODIFIER": {
        "role": "verb-modifier",
        "direction": "LEFT",
        "target_coarse_pos": {"V"},
        "max_distance": 1,
    },
    # Negation markers typically precede the verb they negate
    "NEGATION_MARKER": {
        "role": "negation",
        "direction": "RIGHT",
        "target_coarse_pos": {"V"},
        "max_distance": 1,
    },
    # Verb attribute markers link a preceding verb to a following nominal
    "VERB_ATTR_MARKER": {
        "role": "verb-attribute-link",
        "direction": "BOTH",  # expects V on the left; we enforce left=V
        "target_coarse_pos": {"V"},
        "max_distance": 1,
    },
    # Common pre-verbs precede the main verb
    "PREVERB": {
        "role": "pre-verb",
        "direction": "RIGHT",
        "target_coarse_pos": {"V"},
        "max_distance": 1,
    },
    # Elements that form compound verbs attach to a preceding verb stem
    "COMPOUND_VERB_ELEM": {
        "role": "compound-verb-element",
        "direction": "LEFT",
        "target_coarse_pos": {"V"},
        "max_distance": 1,
    },
    # Elements that form compound nouns usually attach to a preceding N
    "COMPOUND_NOUN_ELEM": {
        "role": "compound-noun-element",
        "direction": "LEFT",
        "target_coarse_pos": {"N", "PRON"},
        "max_distance": 1,
    },
    # Special head nouns often nominalise a preceding verb phrase
    "HEAD_NOUN": {
        "role": "head-noun/nominalizer",
        "direction": "LEFT",
        "target_coarse_pos": {"V"},
        "max_distance": 1,
    },
    # Coordinate markers sit between two NPs; here we treat them as linking left NP
    "COORDINATOR": {
        "role": "coordinator",
        "direction": "LEFT",
        "target_coarse_pos": {"N", "PRON"},
        "max_distance": 1,
    },
    # Sentence markers, sentence-medial particles, clause markers etc. operate at clause level.
    # We annotate them but do not draw specific tokenÃÂ¢Ã¢âÂ¬Ã¢â¬Åtoken links.
    "SENTENCE_MARKER": {
        "role": "sentence-marker",
        "direction": "NONE",
        "target_coarse_pos": set(),
        "max_distance": 0,
    },
    "SENTENCE_MEDIAL_PART": {
        "role": "sentence-medial-particle",
        "direction": "NONE",
        "target_coarse_pos": set(),
        "max_distance": 0,
    },
    "SENTENCE_FINAL_PART": {
        "role": "sentence-final-particle",
        "direction": "NONE",
        "target_coarse_pos": set(),
        "max_distance": 0,
    },
    "SUBORDINATE_CLAUSE_MARKER": {
        "role": "subordinate-clause-marker",
        "direction": "NONE",
        "target_coarse_pos": set(),
        "max_distance": 0,
    },
    "SUBORDINATE_SENTENCE_MARKER": {
        "role": "subordinate-sentence-marker",
        "direction": "NONE",
        "target_coarse_pos": set(),
        "max_distance": 0,
    },
    "CLAUSE_ATTR": {
        "role": "clause/verb-attribute",
        "direction": "NONE",
        "target_coarse_pos": set(),
        "max_distance": 0,
    },
    # Miscellaneous items: annotate but do not assume any particular head
    "MISC_FUNC": {
        "role": "misc-function-word",
        "direction": "NONE",
        "target_coarse_pos": set(),
        "max_distance": 0,
    },
}


def load_grammar_lexicon_tsv(path: Path) -> None:
    """
    Load the hand-curated grammar lexicon TSV.
    Expected columns (tab-separated, UTF-8):
        burmese    category    gloss
    Populates the global GRAMMAR_LEXICON mapping:
        form -> [ { "category": str, "type": str, "gloss": str }, ... ]
    """
    global GRAMMAR_LEXICON
    lex: dict[str, list[dict]] = {}
    with path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            form = normalize_burmese((row.get("burmese") or "").strip())
            category = (row.get("category") or "").strip()
            gloss = (row.get("gloss") or "").strip()
            if not form or not category:
                continue
            coarse_type = GRAMMAR_CATEGORY_TO_TYPE.get(category, "UNKNOWN")
            entry = {
                "category": category,
                "type": coarse_type,
                "gloss": gloss,
            }
            lex.setdefault(form, []).append(entry)
    GRAMMAR_LEXICON = lex
    rebuild_grammar_forms_cache()


def inject_grammar_heads_into_dict() -> None:
    """
    Ensure grammar-only heads are present in the segmenter so it can pick them.
    If a grammar form is missing, inject a minimal entry.
    """
    if not GRAMMAR_LEXICON:
        return
    seg = get_segmenter_instance()
    layer = seg.dictionary.get_layer("grammar") or seg.dictionary.add_layer(
        "grammar",
        priority=DICT_PRIORITIES.get("grammar", 50),
        source_name="GRAMMAR",
    )
    for form, entries in GRAMMAR_LEXICON.items():
        if form in seg.dictionary:
            continue
        gloss = ""
        if entries:
            gloss = entries[0].get("gloss", "") or ""
        layer.add_entry(form, "", "grammar", senses=[gloss or "[grammar item]"])
    seg.dictionary.rebuild_cache()
    rebuild_grammar_forms_cache()


# --- GRAMMAR LEXICON ANALYTICAL ENGINE ------------------------------------
# Map atomic POS labels from the main dictionary into coarse POS classes.
COARSE_POS_MAP: dict[str, str] = {
    "n": "N",
    "pron": "PRON",
    "v": "V",
    "adj": "ADJ",
    "adv": "ADV",
    "ppm": "POSTP",
    "conj": "CONJ",
    "part": "PART",
    "exp": "PART",
    "int": "PART",
    "kjano": "PART",
}


def _split_atomic_pos(raw_pos: str) -> list[str]:
    if not raw_pos:
        return []
    token = raw_pos
    for sep in [",", ";", "+", "/"]:
        token = token.replace(sep, " ")
    return [p for p in token.split() if p]


def _infer_coarse_pos_from_dict_entry(entry: dict) -> set[str]:
    """
    Given a single dictionary entry from DICT[head], return a set of coarse POS labels.
    """
    raw_pos = (entry.get("pos") or "").strip()
    if not raw_pos:
        return {"UNKNOWN"}
    coarse: set[str] = set()
    for part in _split_atomic_pos(raw_pos):
        label = COARSE_POS_MAP.get(part.lower())
        if label is None:
            coarse.add("UNKNOWN")
        else:
            coarse.add(label)
    return coarse or {"UNKNOWN"}


def _infer_coarse_pos_for_token(token: str, dict_obj: dict) -> set[str]:
    """
    Look up the token in DICT and infer a set of coarse POS labels.
    Falls back to simple heuristics when the token is unknown.
    """
    entry = dict_obj.get(normalize_headword(token))
    if not entry:
        # Very crude numeric detection for classifiers: treat bare digits as NUM
        if token.isdigit():
            return {"NUM"}
        return {"UNKNOWN"}
    # In the merged dictionary, each head maps to a single entry dict.
    return _infer_coarse_pos_from_dict_entry(entry)


def _iter_neighbor_indices(i: int, n_tokens: int, direction: str, max_distance: int):
    if direction in ("LEFT", "BOTH"):
        for offset in range(1, max_distance + 1):
            j = i - offset
            if j < 0:
                break
            yield j
    if direction in ("RIGHT", "BOTH"):
        for offset in range(1, max_distance + 1):
            j = i + offset
            if j >= n_tokens:
                break
            yield j


def build_pos_overlay_for_segments(segments: list[str]) -> dict:
    """
    Build POS overlay for a list of segmented tokens using the POS tagger.
    Input:
        segments - list of token strings in sentence order
    Output structure:
        {
            i: {
                "pos": str,              # best guess POS tag (myPOS format)
                "pos_label": str,        # display label (e.g., "Noun", "Verb")
                "pos_color": str,        # background color for UI
                "pos_probs": {           # all candidate probabilities
                    "n": 0.75,
                    "v": 0.25,
                    ...
                },
                "pos_source": str,       # "dict", "corpus", "guess", or "unknown"
                "pos_confidence": int,   # 0-100 confidence percentage
            },
            ...
        }
    The dict is keyed by token index (as string for JSON compatibility).
    """
    if not segments or POS_TAGGER is None:
        return {}
    # Build token list for tagger
    tokens = []
    for seg in segments:
        seg_norm = normalize_burmese(seg)
        # Get POS from dictionary if available
        dict_entry = DICT.get(seg_norm, {})
        dict_pos = dict_entry.get("pos", "")
        tokens.append(
            {
                "word": seg,
                "pos": dict_pos,
            }
        )
    # Run POS tagger
    tagged = POS_TAGGER.tag_tokens(tokens, DICT_POS_LOOKUP)
    # Build overlay structure
    result = {}
    for i, t in enumerate(tagged):
        pos = t.get("pos")
        pos_probs = t.get("pos_probs", {})
        pos_source = t.get("pos_source", "unknown")
        if pos:
            # Calculate confidence as the probability of the best guess
            confidence = int(pos_probs.get(pos, 1.0) * 100)
            result[i] = {
                "coarse_pos": pos,
                "coarse_pos_label": POS_DISPLAY_LABELS.get(pos, pos.upper()),
                "coarse_pos_color": POS_COLORS.get(pos, "#f5f5f5"),
                "coarse_pos_probs": {k: round(v, 3) for k, v in pos_probs.items()},
                "coarse_pos_source": pos_source,
                "coarse_pos_confidence": confidence,
            }
        else:
            # No POS determined
            result[i] = {
                "coarse_pos": None,
                "coarse_pos_label": "?",
                "coarse_pos_color": "transparent",
                "coarse_pos_probs": {},
                "coarse_pos_source": "unknown",
                "coarse_pos_confidence": 0,
            }
    return result


def build_spacy_pos_overlay_for_segments(
    segments: list[str],
    dict_fills: list[dict | None] | None = None,
) -> dict:
    """
    Build a POS overlay using the spaCy UD parser model (UPOS/TAG).
    Returns the same shape as build_pos_overlay_for_segments.
    """
    parser = init_ud_parser()
    if parser is None or not segments:
        return {}
    try:
        # For analysis only: filter junk tokens (e.g., stray combining marks) out of spaCy input,
        # while returning an overlay keyed by ORIGINAL segment indices for UI alignment.
        #
        # Also parse 1 sentence-span at a time (split on sentence terminators) so POS/parse
        # doesn't get skewed by long paragraph-scale contexts.
        SENT_END = {"\u104b", "\u0965", "?", "!", "."}  # ။, ॥, and common ASCII fallbacks

        overlay: dict[int, dict] = {}

        def _process_span(start: int, end: int) -> None:
            kept_words: list[str] = []
            doc2seg: list[int] = []
            for si in range(start, end):
                tok = segments[si]
                if _is_spacy_clean_token(tok):
                    doc2seg.append(si)
                    kept_words.append(tok)
            if not kept_words:
                return
            spaces = [True] * (len(kept_words) - 1) + [False]
            doc = parser._Doc(parser.nlp.vocab, words=kept_words, spaces=spaces)

            # Compute dictionary fills for each kept word and set them on tokens.
            # If dict_fills is provided, use it to match /lookup behavior.
            if dict_fills is not None:
                dict_fills_for_kept = [dict_fills[si] for si in doc2seg]
            else:
                dict_fills_for_kept = [_fill_token_with_dict_for_ui(word) for word in kept_words]
            for tok, fill_data in zip(doc, dict_fills_for_kept):
                if fill_data is not None:
                    tok._.dict_fills = fill_data

            doc = parser.nlp(doc)
            for doc_i, t in enumerate(doc):
                seg_i = doc2seg[doc_i]
                # Some pipelines don't have a morphologizer, so Token.pos_ can be empty.
                # In those cases, Token.tag_ often holds UD-like coarse tags (NOUN/VERB/...).
                tag = t.tag_ or ""
                pos = t.pos_ or tag or ""
                dep = t.dep_ or ""  # Dependency relation (mark, case, nsubj, etc.)
                color = SPACY_UPOS_COLORS.get(pos, "#e5e7eb")
                overlay[seg_i] = {
                    # Coarse POS (NOUN, VERB, ADJ, etc.)
                    "upos": pos,
                    "upos_label": pos or "?",
                    "upos_color": color,
                    # Dependency relation (mark, case, nsubj, compound, etc.)
                    "dep": dep,
                    "dep_label": dep or "",
                    # Keep tag for fine-grained POS
                    "tag": tag,
                    # Fields for embedded reader POS overlay
                    "pos": pos,
                    "pos_label": pos or "?",
                    "pos_color": color,
                    "pos_confidence": 100,
                }

        start = 0
        for i, tok in enumerate(segments):
            if tok in SENT_END:
                _process_span(start, i + 1)
                start = i + 1
        if start < len(segments):
            _process_span(start, len(segments))

        return overlay
    except Exception as e:
        print("[WARN] spaCy POS overlay failed:", e)
        return {}


def build_spacy_pos_overlay_from_ud(ud_overlay: dict) -> dict:
    """
    Derive a spaCy POS overlay from an already-built UD overlay.
    This avoids running the spaCy pipeline twice per request.
    """
    if not ud_overlay or not ud_overlay.get("ok"):
        return {}
    overlay: dict[int, dict] = {}
    tokens = ud_overlay.get("tokens") or []
    for tok in tokens:
        upos = tok.get("upos") or ""
        dep = tok.get("dep") or ""
        tag = tok.get("tag") or ""
        color = SPACY_UPOS_COLORS.get(upos, "#e5e7eb")
        seg_span = tok.get("seg_span") or [tok.get("i")]
        for seg_i in seg_span:
            if seg_i is None or seg_i < 0:
                continue
            overlay[seg_i] = {
                "upos": upos,
                "upos_label": upos or "?",
                "upos_color": color,
                "dep": dep,
                "dep_label": dep or "",
                "tag": tag,
                "pos": upos,
                "pos_label": upos or "?",
                "pos_color": color,
                "pos_confidence": 100,
            }
    return overlay


def build_grammar_overlay_for_segments(segments: list[str], dict_obj: dict) -> dict:
    """
    Given a list of segmented tokens, build a grammar overlay structure that
    can be sent directly to the UI.
    Input:
        segments  ÃÂ¢Ã¢âÂ¬Ã¢â¬Å list of token strings in sentence order
        dict_obj  ÃÂ¢Ã¢âÂ¬Ã¢â¬Å the merged dictionary (usually DICT)
    Output structure:
        {
          "tokens": [
            {
              "token": "...",
              "coarse_pos": ["N", "V", ...],
              "grammar": [
                {
                  "category": str,       # full category label from TSV
                  "type": str,           # coarse type (NOUN_MARKER, VERB_MODIFIER, ...)
                  "gloss": str,          # English gloss from TSV
                  "active": bool,        # True when the rule fires in this context
                  "link_target": int?,   # index of the head token, if any
                  "link_direction": str? # "left" / "right" or None
                },
                ...
              ],
            },
            ...
          ],
          "links": [
            {
              "from": int,       # index of function word
              "to": int,         # index of head token
              "role": str,       # short role label from GRAMMAR_LINK_RULES
              "category": str,   # original category string
              "type": str,       # coarse type
            },
            ...
          ],
        }
    """
    n = len(segments)
    if n == 0:
        return {"tokens": [], "links": []}
    # Pre-compute coarse POS for every token once
    coarse_pos_seq: list[set[str]] = []
    for tok in segments:
        coarse_pos_seq.append(_infer_coarse_pos_for_token(tok, dict_obj))
    tokens_overlay: list[dict] = []
    links: list[dict] = []
    for i, tok in enumerate(segments):
        grammar_entries: list[dict] = []
        # Look up grammar lexicon entries for this form
        lex_entries = GRAMMAR_LEXICON.get(normalize_burmese(tok))
        if lex_entries:
            for lex_entry in lex_entries:
                category = lex_entry.get("category", "")
                coarse_type = lex_entry.get("type", "UNKNOWN")
                gloss = lex_entry.get("gloss", "")
                rule = GRAMMAR_LINK_RULES.get(coarse_type)
                active = False
                link_target = None
                link_dir_str = None
                if rule and rule.get("direction") != "NONE":
                    direction = rule["direction"]
                    target_pos = rule.get("target_coarse_pos", set())
                    max_dist = int(rule.get("max_distance", 1))
                    for j in _iter_neighbor_indices(i, n, direction, max_dist):
                        neighbor_types = coarse_pos_seq[j]
                        # Special-case "NUM" requirement: we allow UNKNOWN here as well,
                        # because numerals are not strongly tagged in the dictionary.
                        if target_pos:
                            if "NUM" in target_pos and neighbor_types & {"UNKNOWN"}:
                                match = True
                            else:
                                match = bool(neighbor_types & target_pos)
                        else:
                            match = True
                        if match:
                            active = True
                            link_target = j
                            link_dir_str = "left" if j < i else "right"
                            link = {
                                "from": i,
                                "to": j,
                                "role": rule.get("role", ""),
                                "category": category,
                                "type": coarse_type,
                            }
                            # Avoid duplicate links for the same (from, to, type, category)
                            if link not in links:
                                links.append(link)
                            # Only draw a single link per grammar entry for now
                            break
                grammar_entries.append(
                    {
                        "category": category,
                        "type": coarse_type,
                        "gloss": gloss,
                        "active": active,
                        "link_target": link_target,
                        "link_direction": link_dir_str,
                    }
                )
        tokens_overlay.append(
            {
                "token": tok,
                "coarse_pos": sorted(coarse_pos_seq[i]),
                "grammar": grammar_entries,
            }
        )
    return {"tokens": tokens_overlay, "links": links}


# ---------------- HTTP API -------------------------------
def merge_token_overlays(
    idx: int,
    base: dict,
    coarse_pos_overlay: dict,
    spacy_pos_overlay: dict,
) -> dict:
    out = dict(base)

    if idx in coarse_pos_overlay:
        out.update(coarse_pos_overlay[idx])

    if idx in spacy_pos_overlay:
        out.update(spacy_pos_overlay[idx])

    return out


def _apply_lm_weight_overrides(args) -> None:
    global BIGRAM_SCORE_SCALE
    if args is None:
        return

    def _set_weight(attr: str, key: str) -> None:
        raw = args.get(key)
        if raw is None or raw == "":
            return
        try:
            val = float(raw)
        except Exception:
            return
        setattr(SEGMENTER_CONFIG, attr, val)
        if (
            SEGMENTER_INSTANCE is not None
            and getattr(SEGMENTER_INSTANCE, "config", None) is not None
        ):
            setattr(SEGMENTER_INSTANCE.config, attr, val)

    _set_weight("OOV_SYLLABLE_PENALTY", "lm_oov_penalty")
    _set_weight("DICT_NO_LM_DISCOUNT", "lm_dict_no_lm_discount")
    _set_weight("UNIGRAM_WEIGHT", "lm_unigram_weight")
    _set_weight("KNOWN_WORD_BASE_COST", "lm_known_base_cost")
    _set_weight("UNKNOWN_WORD_BASE_COST", "lm_unknown_base_cost")
    _set_weight("BIGRAM_WEIGHT", "lm_bigram_weight")

    raw = args.get("lm_bigram_score_scale")
    if raw is None or raw == "":
        return
    try:
        BIGRAM_SCORE_SCALE = float(raw)
    except Exception:
        return


# ---------------- Memory tracking helpers ----------------
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

    seg = SEGMENTER_INSTANCE
    if seg is not None:
        d = seg.dictionary
        components.append(
            _object_summary("segmenter._all_words", getattr(d, "_all_words", None), deep, max_items)
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
        components.append(_object_summary("segmenter", None, note="segmenter not initialized"))

    components.append(_object_summary("grammar_lexicon", GRAMMAR_LEXICON, deep, max_items))
    components.append(_object_summary("user_text_overrides", USER_TEXT_OVERRIDES, deep, max_items))
    components.append(
        _object_summary("manual_text_overrides", MANUAL_TEXT_OVERRIDES, deep, max_items)
    )
    components.append(_object_summary("dict_pos_lookup", DICT_POS_LOOKUP, deep, max_items))

    if READING_SRS is not None:
        srs_count = len(READING_SRS.cards) if getattr(READING_SRS, "_loaded", False) else 0
        components.append(
            _object_summary(
                "reading_srs.cards", READING_SRS.cards, deep, max_items, count=srs_count
            )
        )
    else:
        components.append(_object_summary("reading_srs", None))

    components.append(
        _object_summary(
            "stanza_ner",
            STANZA_NER,
            deep=False,
            note="pipeline object" if STANZA_NER is not None else None,
        )
    )
    components.append(
        _object_summary(
            "ud_parser",
            UD_PARSER,
            deep=False,
            note="pipeline object" if UD_PARSER is not None else None,
        )
    )
    components.append(
        _object_summary(
            "pos_tagger",
            POS_TAGGER,
            deep=False,
            note="pipeline object" if POS_TAGGER is not None else None,
        )
    )

    # LM brain tables (if loaded)
    try:
        import lmbrain  # type: ignore

        components.append(
            _object_summary(
                "lmbrain.unigram_cost", getattr(lmbrain, "UNIGRAM_COST", None), deep, max_items
            )
        )
        components.append(
            _object_summary(
                "lmbrain.bigram_cost", getattr(lmbrain, "BIGRAM_COST", None), deep, max_items
            )
        )
    except Exception:
        components.append(_object_summary("lmbrain", None, note="lmbrain not loaded"))

    # AdvancedSegmenter internals (BK-tree / caches)
    adv = ADVANCED_SEGMENTER
    if adv is not None:
        components.append(
            _object_summary("advsegmenter.bk_tree", getattr(adv, "_bk_tree", None), deep, max_items)
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
                "advsegmenter.spell_vocab_size", getattr(adv, "_spell_vocab_size", None), deep=False
            )
        )
    else:
        components.append(
            _object_summary("advsegmenter", None, note="advanced segmenter not initialized")
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
    with _MEM_TRACE_LOCK:
        MEM_SPIKE_LOG.append(entry)


@app.before_request
def _mem_trace_before_request():
    if request.path not in MEM_TRACE_PATHS:
        return None
    q = request.args.get("q") or ""
    lite = str(request.args.get("lite") or "").strip().lower() in {"1", "true", "yes", "on"}
    g._mem_trace_ctx = _mem_trace_start(request.path, query_len=len(q), lite=lite)
    return None


@app.after_request
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
            "count": len(MEM_SPIKE_LOG),
            "entries": list(MEM_SPIKE_LOG),
        },
    }
    return snapshot, proc, components


def _render_memory_html(proc: dict, components: list[dict], spikes: list[dict]) -> Response:
    rows = []
    rows.append("<table border='1' cellpadding='6' cellspacing='0'>")
    rows.append("<tr><th>Component</th><th>Count</th><th>Approx Size</th><th>Note</th></tr>")
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


@app.route("/debug/memory", methods=["GET"])
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

    deep = str(request.args.get("deep") or "").strip().lower() in {"1", "true", "yes", "on"}
    try:
        max_items = int(request.args.get("max_items") or "20000")
    except Exception:
        max_items = 20000

    snapshot, proc, components = _build_memory_snapshot(deep=deep, max_items=max_items)

    fmt = str(request.args.get("format") or "").strip().lower()
    if fmt == "html":
        return _render_memory_html(proc, components, snapshot["spikes"]["entries"])
    return jsonify(snapshot)


@app.route("/debug/memory_ui", methods=["GET"])
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

    deep = str(request.args.get("deep") or "").strip().lower() in {"1", "true", "yes", "on"}
    try:
        max_items = int(request.args.get("max_items") or "20000")
    except Exception:
        max_items = 20000

    snapshot, proc, components = _build_memory_snapshot(deep=deep, max_items=max_items)
    return _render_memory_html(proc, components, snapshot["spikes"]["entries"])


@app.route("/lookup")
def lookup():
    raw_q = request.args.get("q", "")
    raw_q = raw_q.strip()
    # Production guard: reject excessively long inputs before running the heavy NLP pipeline
    if len(raw_q) > 8000:
        return jsonify({"ok": False, "error": "Input too long (max 8000 chars)."}), 400
    lite_param = str(request.args.get("lite") or "").strip().lower() in {"1", "true", "yes", "on"}
    # ==========================================================================
    # HARDCODED SEGMENTATION PIPELINE (as of 2025-01)
    # ==========================================================================
    # The tokenization pipeline is now fixed to a single path:
    #   1. Stanza NER tokenizer (stanza_ner_param=True)
    #      - Uses Stanza's NER model for initial tokenization
    #      - Caches the Stanza doc for later NER entity extraction
    #   2. DP resegmentation (dp_resegment_param=True)
    #      - Re-segments each island using dynamic programming
    #      - Protects NER entity boundaries during resegmentation
    #   3. Collapse NER spans for UD parse (collapse_ner_param=True)
    #      - Multi-token NER entities are collapsed into single parse tokens
    #   4. Dictionary POS override (pos_override_param=True)
    #      - Dictionary-defined POS tags override morphologizer output
    #
    # These were previously configurable via UI toggles. Legacy code paths
    # for other configurations are commented out below but preserved for
    # reference. See the "LEGACY" comments in this function.
    # ==========================================================================
    pos_override_param = True
    stanza_ner_param = True
    collapse_ner_param = True
    dp_resegment_param = True
    use_raw = str(request.args.get("raw") or "").lower() in {"1", "true", "yes", "raw"}
    exact_only = str(request.args.get("exact") or "").lower() in {"1", "true", "yes", "exact"}
    extended_hits = set()
    # DISABLED FOR DEPLOYMENT: do not allow remote LM weight tuning
    # _apply_lm_weight_overrides(request.args)
    if use_raw:
        q = raw_q
        if not q:
            return jsonify({"ok": False, "error": "empty"}), 400
        q_norm = normalize_headword(q)
        if exact_only:
            entry = None
            if q_norm and q_norm in DICT:
                base = DICT[q_norm]
                entry = {
                    "head": q,
                    "roman": base.get("roman", ""),
                    "pos": base.get("pos", ""),
                    "meta_pos": get_meta_pos(base.get("pos", "")),
                    "senses": base.get("senses", []),
                    "source": base.get("source", "DICT"),
                    "g2p": g2p_explain_for_ui(q),
                    "dict_fill": [],
                    "dict_fill_has_known": True,
                    "dict_fill_has_unknown": False,
                    "dict_fill_mode": "exact",
                }
            return jsonify(
                {
                    "ok": True,
                    "display_text": q,
                    "q": q,
                    "segments": [q],
                    "segment_offsets": [(0, len(q))],
                    "results": [entry] if entry else [],
                    "results_by_seg": [entry] if entry else [],
                    "lm_overlay": {"tokens": [], "edges": [], "phrases": []},
                    "pos_overlay": {"tokens": []},
                    "pos_overlay_spacy": {},
                    "grammar_overlay": {"tokens": []},
                    "ud_overlay": {
                        "ok": False,
                        "tokens": [],
                        "edges": [],
                        "roots": [],
                        "doc2seg": [],
                        "seg2doc": [-1],
                        "error": "exact_only",
                    },
                }
            )
        segments = [q]
        island_spans = [(0, 1)]
    else:
        q = normalize_burmese_for_segmentation(raw_q, extended_hits=extended_hits)
        if not q:
            return jsonify({"ok": False, "error": "empty"}), 400
        q_norm = normalize_burmese(q)
        if extended_hits:
            # Just log for now so you can inspect which Extended chars appear
            print("[INFO] Extended Myanmar chars in /lookup:", "".join(sorted(extended_hits)))
        # 1) Initial stanza tokenization (fixed pipeline).
        segments, island_spans = segment_with_pipeline_and_islands(q)
    # 1a) LM-informed cosmetic dictionary fill per-segment (context-aware inside islands).
    # Use precomputed fills from LM veto where available to avoid redundant computation.
    stanza_raw_ents = []
    stanza_ner_entities: list[dict] = []

    # DP RESEGMENTATION PIPELINE (dp_resegment_param is always True):
    # Step 1: Run NER on stanza tokens first (before any resegmentation)
    # stanza_ner_param is always True, so we always run NER early
    temp_fills: list[dict | None] = [None] * len(segments)
    stanza_raw_ents, stanza_ner_entities = _run_stanza_ner_early(
        q, segments, temp_fills, island_spans
    )

    # Step 2: Full DP resegmentation with NER protection
    segments, fills_by_seg, island_spans, original_stanza_tokens = (
        _dp_resegment_with_ner_protection(q, segments, stanza_raw_ents, island_spans)
    )
    # original_stanza_tokens preserved for fuzzy matching boundaries
    # Merge consecutive unknown-only tokens (postpass) within islands only
    segments, fills_by_seg = _merge_consecutive_unknown_segments(
        segments, fills_by_seg, island_spans
    )

    # Step 3: Re-map NER entities to new segments after resegmentation
    if stanza_raw_ents:
        stanza_ner_entities = _stanza_ents_to_segments(q, segments, stanza_raw_ents)
        stanza_ner_entities = _filter_ner_entities_excluding_last_islands(
            segments, island_spans, stanza_ner_entities
        )
        _apply_ner_entities_to_fills(fills_by_seg, stanza_ner_entities)

    segment_offsets = _build_segment_offsets(q, segments)
    if segment_offsets is None:
        segment_offsets = []
    # myPOS overlay is disabled; keep empty for merge_token_overlays() compatibility.
    pos_overlay = {}

    # 1d) Build grammar overlay (hand-built function word lexicon)
    grammar_overlay = (
        {"tokens": [], "links": []}
        if lite_param
        else build_grammar_overlay_for_segments(segments, DICT)
    )
    # 1e) Build UD dependency overlay (spaCy-based parser)
    ud_overlay = (
        {
            "ok": False,
            "tokens": [],
            "edges": [],
            "roots": [],
            "doc2seg": [],
            "seg2doc": [],
            "error": "lite",
        }
        if lite_param
        else build_ud_overlay_for_segments(
            segments,
            dict_fills=fills_by_seg,
            original_text=q,
            pos_override=pos_override_param,
            stanza_ner=stanza_ner_param,
            precomputed_ner_ents=stanza_ner_entities if stanza_ner_param else None,
            collapse_ner_spans=collapse_ner_param,
            island_spans=island_spans,
        )
    )
    # Build POS overlay from the UD overlay (single spaCy pass).
    spacy_pos_overlay = {} if lite_param else build_spacy_pos_overlay_from_ud(ud_overlay)
    # 1f) Record dictionary-known tokens for spaced-repetition flashcards
    # DISABLED FOR DEPLOYMENT: SRS observe_tokens writes shared state without per-user isolation
    # if (not lite_param) and READING_SRS is not None:
    #     try:
    #         known_for_srs = []
    #         for w in segments:
    #             if contains_burmese(w) and w in DICT:
    #                 known_for_srs.append(w)
    #         if known_for_srs:
    #             READING_SRS.observe_tokens(known_for_srs, autosave=True)
    #     except Exception as e:
    #         print("[WARN] reading SRS observe_tokens failed:", e)
    results = []
    results_by_seg: list[dict | None] = [None] * len(segments)
    first_non_punct_entry = None

    # 1.5) Walk segments in order and build results_by_seg for all segments
    # but only return the first non-punctuation entry in results list
    for idx, w in enumerate(segments):
        # Don't try to dictionary-lookup Myanmar punctuation; keep it only for rendering/UD boundaries.
        if w in MYANMAR_PUNCT:
            continue
        # Cosmetic dictionary fill for UI (does not affect canonical segmentation)
        fill = fills_by_seg[idx] or _fill_token_with_dict_for_ui(w)
        fill_mode = fill.get("mode") or "greedy"
        fill_entries = fill.get("fills") or []
        fill_has_known = bool(fill.get("has_known"))
        fill_has_unknown = bool(fill.get("has_unknown"))

        w_key = normalize_headword(w)
        if w_key and w_key in DICT:
            base = DICT[w_key]
            pos = base.get("pos", "")
            entry = {
                "head": w,
                "roman": base.get("roman", ""),
                "pos": pos,
                "meta_pos": get_meta_pos(pos),
                "senses": base.get("senses", []),
                "source": base.get("source", "DICT"),
                "g2p": g2p_explain_for_ui(w),
            }
        elif fill_has_known and not fill_has_unknown:
            # Token isn't a single dict head, but it can be fully covered by dict fills.
            entry = {
                "head": w,
                "roman": "",
                "pos": "composite",
                "meta_pos": "composite",
                "senses": [],
                "source": "COMPOSITE",
                "g2p": g2p_explain_for_ui(w),
            }
        else:
            # Base unknown entry (use your helper if you have one)
            try:
                entry = _make_unknown_entry(w)
            except NameError:
                entry = {
                    "head": w,
                    "roman": "",
                    "pos": "unknown",
                    "senses": ["[no dictionary entry found for this segment]"],
                }
            entry.setdefault("meta_pos", "unknown")
            entry.setdefault("source", "UNKNOWN")
            if contains_burmese(w):
                entry["g2p"] = g2p_explain_for_ui(w)

        entry["dict_fill_mode"] = fill_mode
        entry["dict_fill"] = fill_entries
        entry["dict_fill_has_known"] = fill_has_known
        entry["dict_fill_has_unknown"] = fill_has_unknown
        entry["seg_i"] = idx

        results_by_seg[idx] = merge_token_overlays(
            idx,
            entry,
            pos_overlay,
            spacy_pos_overlay,
        )

        # Only add the first non-punctuation entry to results for panel display
        if first_non_punct_entry is None:
            first_non_punct_entry = entry
            results.append(entry)
            # Logging disabled
    # 3) Logging disabled for performance (lookup/miss/unknowns)
    return jsonify(
        {
            "ok": True,
            "display_text": q,
            "q": q,
            "segments": segments,
            "segment_offsets": segment_offsets,
            "island_spans": island_spans,  # NEW: island boundaries for fuzzy matching
            "results": results,
            "results_by_seg": results_by_seg,
            "grammar_overlay": grammar_overlay,  # NEW: function-word overlay
            "ud_overlay": ud_overlay,  # UD dependency parse overlay
        }
    )


@app.route("/lookup_dp_only")
def lookup_dp_only():
    """
    DP-only segmentation (no neural/stanza pre-pass, no NLP overlays).
    Intended for lightweight dictionary/side-panel segmentation.
    """
    raw_q = request.args.get("q", "")
    raw_q = raw_q.strip()
    if not raw_q:
        return jsonify({"ok": False, "error": "empty"}), 400
    q = normalize_burmese_for_segmentation(raw_q)
    if not q:
        return jsonify({"ok": False, "error": "empty"}), 400

    segments, fills_by_seg, island_spans = _dp_segment_text_only(q)
    segment_offsets = _build_segment_offsets(q, segments) or []
    results = []
    results_by_seg: list[dict | None] = [None] * len(segments)
    first_non_punct_entry = None

    for idx, w in enumerate(segments):
        if w in MYANMAR_PUNCT:
            continue
        fill = fills_by_seg[idx] or _fill_token_with_dict_for_ui(w)
        fill_mode = fill.get("mode") or "greedy"
        fill_entries = fill.get("fills") or []
        fill_has_known = bool(fill.get("has_known"))
        fill_has_unknown = bool(fill.get("has_unknown"))

        w_key = normalize_headword(w)
        if w_key and w_key in DICT:
            base = DICT[w_key]
            pos = base.get("pos", "")
            entry = {
                "head": w,
                "roman": base.get("roman", ""),
                "pos": pos,
                "meta_pos": get_meta_pos(pos),
                "senses": base.get("senses", []),
                "source": base.get("source", "DICT"),
                "g2p": g2p_explain_for_ui(w),
            }
        elif fill_has_known and not fill_has_unknown:
            entry = {
                "head": w,
                "roman": "",
                "pos": "composite",
                "meta_pos": "composite",
                "senses": [],
                "source": "COMPOSITE",
                "g2p": g2p_explain_for_ui(w),
            }
        else:
            try:
                entry = _make_unknown_entry(w)
            except NameError:
                entry = {
                    "head": w,
                    "roman": "",
                    "pos": "unknown",
                    "senses": ["[no dictionary entry found for this segment]"],
                }
            entry.setdefault("meta_pos", "unknown")
            entry.setdefault("source", "UNKNOWN")
            if contains_burmese(w):
                entry["g2p"] = g2p_explain_for_ui(w)

        entry["dict_fill_mode"] = fill_mode
        entry["dict_fill"] = fill_entries
        entry["dict_fill_has_known"] = fill_has_known
        entry["dict_fill_has_unknown"] = fill_has_unknown
        entry["seg_i"] = idx

        results_by_seg[idx] = merge_token_overlays(idx, entry, {}, {})

        if first_non_punct_entry is None:
            first_non_punct_entry = entry
            results.append(entry)

    return jsonify(
        {
            "ok": True,
            "display_text": q,
            "q": q,
            "segments": segments,
            "segment_offsets": segment_offsets,
            "island_spans": island_spans,
            "results": results,
            "results_by_seg": results_by_seg,
        }
    )


@app.route("/api/fuzzy_smart", methods=["POST"])
def api_fuzzy_smart():
    """
    Distance-first fuzzy spelling suggestions (single-pass).
    Uses unigram LM as tie-breaker within same edit distance.

    Request JSON:
      {
        "base_token": "...",           # the full neural-net token
        "max_edit_distance": 3,        # optional, default 3
        "max_suggestions": 10          # optional, default 10
      }

    Response JSON:
      {
        "ok": true/false,
        "base_token": "...",
        "pieces": [{"head": "...", "known": true/false}, ...],
        "attempts": [],
        "expanded_matches": [
          { "head": "...", "pos": "...", "senses": [...] }
        ],
        "final": {
          "attempt": 0,
          "fuzzied_string": "...",
          "suggestions": [...]
        },
        "error": "..." (optional)
      }
    """
    data = request.get_json(silent=True) or {}
    base_token = (data.get("base_token") or data.get("token") or data.get("q") or "").strip()
    unknown_piece = (data.get("unknown_piece") or "").strip()
    force_whole_token = bool(data.get("force_whole_token") or data.get("forceWholeToken"))
    if not base_token:
        return jsonify({"ok": False, "error": "missing_base_token"}), 400
    if not unknown_piece and not force_whole_token:
        return jsonify(
            {"ok": False, "error": "missing_unknown_piece", "base_token": base_token}
        ), 400
    if not unknown_piece:
        unknown_piece = base_token

    # Fixed edit-distance budget: always search 1, then 2 if needed.
    max_edit_distance = 2

    max_suggestions = data.get("max_suggestions")
    try:
        max_suggestions = int(max_suggestions)
    except Exception:
        max_suggestions = 10
    if max_suggestions < 1:
        max_suggestions = 1
    if max_suggestions > 10:
        max_suggestions = 10

    if ADVANCED_SEGMENTER is None:
        return jsonify(
            {"ok": False, "error": "advanced_segmenter_unavailable", "base_token": base_token}
        ), 503
    if not contains_burmese(base_token):
        return jsonify({"ok": False, "error": "non_burmese", "base_token": base_token}), 400

    # Get island tokens for island-level matching
    island_tokens = data.get("island_tokens") or []
    token_idx_in_island = data.get("token_idx_in_island")
    try:
        token_idx_in_island = int(token_idx_in_island) if token_idx_in_island is not None else -1
    except Exception:
        token_idx_in_island = -1
    if force_whole_token:
        island_tokens = []
        token_idx_in_island = -1

    def _distance_first(part: str, use_max_ed: int) -> list[dict]:
        part = (part or "").strip()
        if not part:
            return []
        try:
            return (
                ADVANCED_SEGMENTER.suggest_spellings_distance_first(
                    word=part,
                    max_edit_distance=use_max_ed,
                    max_candidates=max_suggestions,
                )
                or []
            )
        except Exception as e:
            print(f"[FUZZY_SMART] distance_first error: {e}")
            return []

    def _best_ed_from_raw(raw: list[dict]) -> int | None:
        if not raw:
            return None
        try:
            return int(raw[0].get("edit_distance"))
        except Exception:
            return None

    def _enrich_no_scores(raw_fuzzy: list[dict]) -> list[dict]:
        enriched: list[dict] = []
        for fm in (raw_fuzzy or [])[:max_suggestions]:
            cand = (fm.get("candidate") or "").strip()
            if not cand:
                continue
            base = DICT.get(cand, {})
            roman = base.get("roman", "")
            pos = base.get("pos", "") or "unknown"
            senses = base.get("senses", []) or []
            if not base:
                senses = ["[no dictionary entry found for this candidate]"]
                try:
                    g2p_result = g2p_engine.get_g2p_data(cand)
                    if g2p_result and g2p_result.get("syllables"):
                        roman = " ".join(
                            s.get("roman", "") for s in g2p_result["syllables"] if s.get("roman")
                        )
                except Exception:
                    pass
            enriched.append(
                {
                    "head": cand,
                    "roman": roman,
                    "pos": pos,
                    "senses": senses,
                    "candidate": cand,
                    "edit_distance": fm.get("edit_distance"),
                    "edit_similarity": fm.get("edit_similarity"),
                }
            )
        return enriched

    fill = None
    island_fills = None
    if island_tokens:
        island_fills = [_fill_token_with_dict_for_ui(t) for t in island_tokens]
        if 0 <= token_idx_in_island < len(island_tokens):
            fill = island_fills[token_idx_in_island]
    if not fill:
        fill = _fill_token_with_dict_for_ui(base_token)
    fills = (fill or {}).get("fills") or []

    def _is_unknown_piece(p: dict) -> bool:
        pos = (p.get("pos") or "").lower()
        senses = p.get("senses") or []
        return pos.startswith("unknown") or (
            len(senses) == 1
            and isinstance(senses[0], str)
            and "no dictionary entry" in senses[0].lower()
        )

    def _token_is_known(fill: dict | None) -> bool:
        entries = (fill or {}).get("fills") or []
        if not entries:
            return False
        for p in entries:
            if _is_unknown_piece(p):
                return False
        return True

    def _token_contains_unknown_piece(fill: dict | None, target: str) -> bool:
        entries = (fill or {}).get("fills") or []
        for p in entries:
            if not _is_unknown_piece(p):
                continue
            head = (p.get("head") or "").strip()
            if head and head == target:
                return True
        return False

    token_units = (
        [base_token]
        if force_whole_token
        else (list(island_tokens) if island_tokens else [base_token])
    )
    token_fills = None
    if island_fills and len(island_fills) == len(token_units):
        token_fills = island_fills
    else:
        token_fills = [_fill_token_with_dict_for_ui(t) for t in token_units]

    def _build_pieces(units: list[str], fills: list[dict]) -> list[dict]:
        out: list[dict] = []
        for tok, tfill in zip(units, fills):
            out.append({"head": tok, "known": _token_is_known(tfill)})
        return out or [{"head": base_token, "known": False}]

    pieces = _build_pieces(token_units, token_fills)

    target_token_idx = None
    if force_whole_token:
        target_token_idx = 0
    else:
        if 0 <= token_idx_in_island < len(token_units):
            if (
                _token_contains_unknown_piece(token_fills[token_idx_in_island], unknown_piece)
                or token_units[token_idx_in_island] == unknown_piece
            ):
                target_token_idx = token_idx_in_island
        if target_token_idx is None:
            for i, tfill in enumerate(token_fills):
                if _token_contains_unknown_piece(tfill, unknown_piece):
                    target_token_idx = i
                    break
        if target_token_idx is None:
            for i, tok in enumerate(token_units):
                if tok == unknown_piece:
                    target_token_idx = i
                    break

    def _find_unknown_run(pieces: list[dict], target_idx: int) -> tuple[int, int] | None:
        if target_idx < 0 or target_idx >= len(pieces):
            return None
        if pieces[target_idx].get("known"):
            return None
        left = target_idx
        while left - 1 >= 0 and not pieces[left - 1].get("known"):
            left -= 1
        right = target_idx
        while right + 1 < len(pieces) and not pieces[right + 1].get("known"):
            right += 1
        return (left, right)

    if target_token_idx is None:
        return jsonify(
            {"ok": False, "error": "unknown_piece_not_found", "base_token": base_token}
        ), 400

    if force_whole_token:
        run_bounds = (0, len(pieces) - 1)
    else:
        run_bounds = _find_unknown_run(pieces, target_token_idx)
    if run_bounds is None:
        return jsonify(
            {"ok": False, "error": "unknown_piece_not_found", "base_token": base_token}
        ), 400
    run_start, run_end = run_bounds
    run_len = run_end - run_start + 1
    run_heads = [
        pieces[i].get("head") for i in range(run_start, run_end + 1) if pieces[i].get("head")
    ]

    expanded_matches: list[dict] = []
    attempts: list[dict] = []
    island_attempts: list[dict] = []
    final_raw: list[dict] = []

    n_pieces = len(pieces)

    initial_span_pieces = pieces[run_start : run_end + 1]
    initial_span_heads = [pc.get("head") for pc in initial_span_pieces if pc.get("head")]
    initial_span_str = "".join(initial_span_heads)
    final_span_str = initial_span_str
    final_kept_pieces = initial_span_heads or run_heads

    run_str = "".join(run_heads) if run_heads else (unknown_piece or base_token)

    bk_cache: dict[tuple[str, int], list[dict]] = {}

    def _bk_query_all(span_str: str, target_ed: int) -> list[dict]:
        span_str = (span_str or "").strip()
        if not span_str:
            return []
        cache_key = (span_str, target_ed)
        if cache_key in bk_cache:
            return bk_cache[cache_key]
        bk = getattr(ADVANCED_SEGMENTER, "_bk_tree", None)
        if bk is None:
            bk_cache[cache_key] = []
            return []
        hits = bk.query(span_str, target_ed) or []
        out: list[dict] = []
        len_span = len(span_str)
        for cand, d in hits:
            if d != target_ed or d == 0:
                continue
            max_len = max(len_span, len(cand))
            edit_sim = 1.0 - (d / max_len) if max_len > 0 else 0.0
            out.append(
                {
                    "candidate": cand,
                    "edit_distance": d,
                    "edit_similarity": edit_sim,
                }
            )
        bk_cache[cache_key] = out
        return out

    def _try_span_search(
        span_start: int,
        span_end: int,
        target_ed: int,
        attempt_log: list[dict],
    ) -> list[dict]:
        left = "".join(
            pieces[i].get("head") for i in range(span_start, run_start) if pieces[i].get("head")
        )
        right = "".join(
            pieces[i].get("head") for i in range(run_end + 1, span_end + 1) if pieces[i].get("head")
        )
        span_str = left + run_str + right
        raw = _bk_query_all(span_str, target_ed)
        combined: list[dict] = []
        for fm in raw:
            cand = (fm.get("candidate") or "").strip()
            if not cand:
                continue
            if left and not cand.startswith(left):
                continue
            if right and not cand.endswith(right):
                continue
            if len(cand) < (len(left) + len(right)):
                continue
            mid_start = len(left)
            mid_end = len(cand) - len(right) if right else len(cand)
            if mid_end < mid_start:
                continue
            mid = cand[mid_start:mid_end]
            if not mid:
                continue
            combined.append(
                {
                    "candidate": cand,
                    "edit_distance": fm.get("edit_distance"),
                    "edit_similarity": fm.get("edit_similarity"),
                    "span_len": (span_end - span_start + 1),
                }
            )
        attempt_log.append(
            {
                "fuzzied_string": span_str,
                "best_edit_distance": target_ed if combined else None,
                "found_match": bool(combined),
            }
        )
        return combined

    def _iter_span_combos() -> list[tuple[int, int]]:
        spans: list[tuple[int, int]] = [(run_start, run_end)]
        for size in range(run_len + 1, n_pieces + 1):
            for start in range(0, n_pieces - size + 1):
                end = start + size - 1
                if start > run_start or end < run_end:
                    continue
                spans.append((start, end))
        return spans

    span_combos = _iter_span_combos()

    def _build_span_tokens(span_start: int, span_end: int) -> list[str]:
        return [
            pieces[i].get("head") for i in range(span_start, span_end + 1) if pieces[i].get("head")
        ]

    def _collect_groups(target_ed: int) -> list[dict]:
        groups: list[dict] = []
        for start, end in span_combos:
            candidates = _try_span_search(start, end, target_ed, attempts)
            if not candidates:
                continue
            span_tokens = _build_span_tokens(start, end)
            span_text = "".join(span_tokens)
            span_len = end - start + 1
            seen: set[str] = set()
            dedup: list[dict] = []
            for fm in candidates:
                cand = (fm.get("candidate") or "").strip()
                if not cand or cand in seen:
                    continue
                seen.add(cand)
                dedup.append(fm)
            if dedup:

                def _cost(entry: dict) -> float:
                    word = (entry.get("candidate") or "").strip()
                    if not word:
                        return float("inf")
                    if callable(get_unigram_cost):
                        try:
                            return float(get_unigram_cost(word))
                        except Exception:
                            return float("inf")
                    return float("inf")

                dedup.sort(key=lambda e: (_cost(e), (e.get("candidate") or "")))
            groups.append(
                {
                    "span_start": start,
                    "span_end": end,
                    "span_len": span_len,
                    "span_tokens": span_tokens,
                    "span_text": span_text,
                    "candidates": dedup,
                }
            )
        groups.sort(
            key=lambda g: (int(g.get("span_len") or 0), len(g.get("span_text") or "")), reverse=True
        )
        # Global cap across all groups: prefer longer spans, then unigram cost within each.
        remaining = (
            max_suggestions if isinstance(max_suggestions, int) and max_suggestions > 0 else 10
        )
        trimmed: list[dict] = []
        for g in groups:
            if remaining <= 0:
                break
            cand_list = g.get("candidates") or []
            if not cand_list:
                continue
            if len(cand_list) > remaining:
                cand_list = cand_list[:remaining]
            g["candidates"] = cand_list
            trimmed.append(g)
            remaining -= len(cand_list)
        return trimmed

    groups = _collect_groups(1)
    distance_used = 1 if groups else 2
    if not groups:
        groups = _collect_groups(2)

    expanded_matches = []

    def _flatten_groups(group_list: list[dict]) -> list[dict]:
        out: list[dict] = []
        for g in group_list:
            for fm in g.get("candidates") or []:
                out.append(fm)
        return out

    flat_candidates = _flatten_groups(groups)

    final_result = {
        "attempt": 0,
        "level": "full_scan_ed1_then_ed2",
        "fuzzied_string": final_span_str,
        "kept_pieces": final_kept_pieces,
        "suggestions": _enrich_no_scores(flat_candidates),
        "best_edit_distance": _best_ed_from_raw(flat_candidates),
    }

    group_payload = []
    for g in groups:
        group_payload.append(
            {
                "span_start": g.get("span_start"),
                "span_end": g.get("span_end"),
                "span_len": g.get("span_len"),
                "span_tokens": g.get("span_tokens") or [],
                "span_text": g.get("span_text") or "",
                "entries": _enrich_no_scores(g.get("candidates") or []),
            }
        )

    return jsonify(
        {
            "ok": True,
            "base_token": base_token,
            "island_tokens": island_tokens,
            "pieces": pieces,
            "attempts": attempts,
            "island_attempts": island_attempts,
            "expanded_matches": expanded_matches,
            "distance_used": distance_used,
            "groups": group_payload,
            "final": final_result,
        }
    )


@app.route("/api/user_dict/add", methods=["POST"])
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
        normalized = add_user_dict_entry(headword, romanization, pos, definition)
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        print(f"[USERDICT] error while adding entry: {e}")
        return jsonify({"ok": False, "error": "Internal error while saving entry."}), 500
    return jsonify({"ok": True, "head": normalized})


@app.route("/api/text_override/add", methods=["POST"])
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
        raw_out, normalized_out = add_user_text_override(raw, normalized)
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        print(f"[USEROVERRIDE] error while adding override: {e}")
        return jsonify({"ok": False, "error": "Internal error while saving override."}), 500
    return jsonify({"ok": True, "raw": raw_out, "normalized": normalized_out})


@app.route("/api/custom_entries/list", methods=["GET"])
def api_list_custom_entries():
    """
    DISABLED FOR DEPLOYMENT: Custom entries require user accounts.
    Returns empty entries list.
    """
    # DEPLOYMENT: Custom entries disabled - return empty list
    return jsonify({"ok": True, "entries": []})


@app.route("/api/user_dict/update", methods=["POST"])
def api_update_user_dict_entry():
    # DISABLED FOR DEPLOYMENT: no per-user accounts.
    return jsonify({"ok": False, "error": "disabled"}), 403
    data = request.get_json(silent=True) or {}
    row_id = data.get("id")
    try:
        row_id = int(row_id)
    except Exception:
        return jsonify({"ok": False, "error": "Invalid entry id."}), 400
    rows = _read_user_dict_rows(TSV_USER_PATH)
    if row_id < 0 or row_id >= len(rows):
        return jsonify({"ok": False, "error": "Entry not found."}), 404
    headword = (data.get("headword") or "").strip()
    romanization = (data.get("romanization") or "").strip()
    pos_raw = (data.get("pos") or "").strip()
    definition = (data.get("definition") or "").strip()
    if not headword:
        return jsonify({"ok": False, "error": "Headword is required."}), 400
    headword_norm = normalize_headword(headword)
    if not headword_norm or not contains_burmese(headword_norm):
        return jsonify({"ok": False, "error": "Headword must contain Burmese script."}), 400
    pos_norm = normalize_pos(pos_raw or "")
    rows[row_id] = {
        "id": row_id,
        "headword": headword_norm,
        "romanization": romanization,
        "pos": pos_norm,
        "definition": definition,
    }
    _write_user_dict_rows(TSV_USER_PATH, rows)
    _rebuild_user_dict_from_rows(rows)
    return jsonify({"ok": True, "head": headword_norm})


@app.route("/api/user_dict/delete", methods=["POST"])
def api_delete_user_dict_entry():
    # DISABLED FOR DEPLOYMENT: no per-user accounts.
    return jsonify({"ok": False, "error": "disabled"}), 403
    data = request.get_json(silent=True) or {}
    row_id = data.get("id")
    try:
        row_id = int(row_id)
    except Exception:
        return jsonify({"ok": False, "error": "Invalid entry id."}), 400
    rows = _read_user_dict_rows(TSV_USER_PATH)
    if row_id < 0 or row_id >= len(rows):
        return jsonify({"ok": False, "error": "Entry not found."}), 404
    rows.pop(row_id)
    _write_user_dict_rows(TSV_USER_PATH, rows)
    _rebuild_user_dict_from_rows(rows)
    return jsonify({"ok": True})


@app.route("/api/text_override/update", methods=["POST"])
def api_update_text_override():
    # DISABLED FOR DEPLOYMENT: no per-user accounts.
    return jsonify({"ok": False, "error": "disabled"}), 403
    data = request.get_json(silent=True) or {}
    row_id = data.get("id")
    try:
        row_id = int(row_id)
    except Exception:
        return jsonify({"ok": False, "error": "Invalid rule id."}), 400
    rows = _read_text_override_rows(TSV_USER_TEXT_OVERRIDE_PATH)
    if row_id < 0 or row_id >= len(rows):
        return jsonify({"ok": False, "error": "Rule not found."}), 404
    raw = (data.get("raw") or "").strip()
    normalized = (data.get("normalized") or "").strip()
    if not raw or not normalized:
        return jsonify({"ok": False, "error": "Raw and normalized are required."}), 400
    if not contains_burmese(normalized):
        return jsonify({"ok": False, "error": "Normalized form must contain Burmese script."}), 400
    rows[row_id] = {"id": row_id, "raw": raw, "normalized": normalized}
    _write_text_override_rows(TSV_USER_TEXT_OVERRIDE_PATH, rows)
    _reload_text_overrides_from_file()
    return jsonify({"ok": True, "raw": raw, "normalized": normalized})


@app.route("/api/text_override/delete", methods=["POST"])
def api_delete_text_override():
    # DISABLED FOR DEPLOYMENT: no per-user accounts.
    return jsonify({"ok": False, "error": "disabled"}), 403
    data = request.get_json(silent=True) or {}
    row_id = data.get("id")
    try:
        row_id = int(row_id)
    except Exception:
        return jsonify({"ok": False, "error": "Invalid rule id."}), 400
    rows = _read_text_override_rows(TSV_USER_TEXT_OVERRIDE_PATH)
    if row_id < 0 or row_id >= len(rows):
        return jsonify({"ok": False, "error": "Rule not found."}), 404
    rows.pop(row_id)
    _write_text_override_rows(TSV_USER_TEXT_OVERRIDE_PATH, rows)
    _reload_text_overrides_from_file()
    return jsonify({"ok": True})


@app.route("/segment", methods=["GET"])
def segment_only():
    """
    Lightweight endpoint: just return how the segmenter tokenized the input.
    No definitions, no fuzzy stuff ÃÂ¢Ã¢âÂ¬Ã¢â¬Å just the segments in order.
    """
    raw_q = request.args.get("q", "").strip()
    if not raw_q:
        return jsonify({"ok": False, "error": "missing query parameter 'q'"}), 400
    extended_hits = set()
    q = normalize_burmese_for_segmentation(raw_q, extended_hits=extended_hits)
    if not q:
        return jsonify({"ok": False, "error": "query contains no Burmese text"}), 400
    if not contains_burmese(q):
        return jsonify({"ok": False, "error": "query contains no Burmese text"}), 400
    if extended_hits:
        print("[INFO] Extended Myanmar chars in /segment:", "".join(sorted(extended_hits)))
    segments = segment_with_pipeline(q)
    return jsonify(
        {
            "ok": True,
            "q": q,
            "segments": segments,
            "joined": " | ".join(segments),  # quick human-readable string
        }
    )


# ------------------------------
# Document import: PDF / DOCX
# ------------------------------


def _convert_docx_to_pdf_bytes(docx_bytes: bytes) -> bytes:
    """Convert DOCX bytes to PDF bytes using docx2pdf only."""
    if not docx_bytes:
        raise RuntimeError("docx_empty")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        docx_path = tmp_path / "input.docx"
        pdf_path = tmp_path / "input.pdf"
        docx_path.write_bytes(docx_bytes)

        try:
            from docx2pdf import convert as docx2pdf_convert  # type: ignore
        except Exception:
            docx2pdf_convert = None

        if docx2pdf_convert is not None:
            try:
                docx2pdf_convert(str(docx_path), str(pdf_path))
                if pdf_path.exists():
                    return pdf_path.read_bytes()
            except Exception:
                pass

        # DISABLED (2026-01-20): Removed LibreOffice fallback to use only docx2pdf
        # soffice = (
        #     shutil.which("soffice")
        #     or shutil.which("soffice.exe")
        #     or shutil.which("libreoffice")
        #     or shutil.which("libreoffice.exe")
        # )
        # if soffice:
        #     try:
        #         subprocess.run(
        #             [soffice, "--headless", "--convert-to", "pdf", "--outdir", tmpdir, str(docx_path)],
        #             check=True,
        #             stdout=subprocess.DEVNULL,
        #             stderr=subprocess.DEVNULL,
        #         )
        #         if pdf_path.exists():
        #             return pdf_path.read_bytes()
        #     except Exception:
        #         pass

    raise RuntimeError("docx_to_pdf_failed")


def _make_pdf_page_dim(width: Any, height: Any) -> dict:
    """Return a safe {width,height} dict with non-negative finite floats."""
    try:
        w = float(width)
    except Exception:
        w = 0.0
    try:
        h = float(height)
    except Exception:
        h = 0.0
    if not math.isfinite(w) or w <= 0:
        w = 0.0
    if not math.isfinite(h) or h <= 0:
        h = 0.0
    return {"width": w, "height": h}


def _average_pdf_page_dims(page_dims: list[dict]) -> dict | None:
    valid = []
    for d in page_dims or []:
        if not isinstance(d, dict):
            continue
        w = float(d.get("width") or 0.0)
        h = float(d.get("height") or 0.0)
        if w > 0 and h > 0 and math.isfinite(w) and math.isfinite(h):
            valid.append((w, h))
    if not valid:
        return None
    sum_w = sum(w for w, _ in valid)
    sum_h = sum(h for _, h in valid)
    n = float(len(valid))
    return {"width": sum_w / n, "height": sum_h / n}


def _extract_pdf_pages_and_dims_from_bytes(
    data: bytes,
) -> tuple[list[str], list[dict], dict | None]:
    """Return per-page text + per-page dimensions + average dimensions."""
    if not data:
        empty_dim = _make_pdf_page_dim(0, 0)
        return [""], [empty_dim], None

    errors = []

    # 1) PyMuPDF (fitz) - best page fidelity
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(stream=data, filetype="pdf")
        pages: list[str] = []
        page_dims: list[dict] = []
        for p in doc:
            pages.append(p.get_text("text") or "")
            rect = p.rect
            page_dims.append(_make_pdf_page_dim(rect.width, rect.height))
        doc.close()
        if pages:
            print(f"[INFO] PDF extracted with PyMuPDF: {len(pages)} pages")
            return pages, page_dims, _average_pdf_page_dims(page_dims)
    except ImportError:
        errors.append("PyMuPDF (fitz) not installed")
    except Exception as e:
        errors.append(f"PyMuPDF error: {e}")

    # 2) pypdf / PyPDF2
    for mod in ("pypdf", "PyPDF2"):
        try:
            if mod == "pypdf":
                from pypdf import PdfReader
            else:
                from PyPDF2 import PdfReader
            reader = PdfReader(io.BytesIO(data))
            pages: list[str] = []
            page_dims: list[dict] = []
            for page in reader.pages:
                try:
                    pages.append(page.extract_text() or "")
                except Exception:
                    pages.append("")

                dim = None
                try:
                    box = getattr(page, "mediabox", None)
                    if box is not None and hasattr(box, "width") and hasattr(box, "height"):
                        dim = _make_pdf_page_dim(box.width, box.height)
                    elif box is not None:
                        dim = _make_pdf_page_dim(
                            float(getattr(box, "right", 0)) - float(getattr(box, "left", 0)),
                            float(getattr(box, "top", 0)) - float(getattr(box, "bottom", 0)),
                        )
                except Exception:
                    dim = None
                page_dims.append(dim or _make_pdf_page_dim(0, 0))
            if pages:
                print(f"[INFO] PDF extracted with {mod}: {len(pages)} pages")
                return pages, page_dims, _average_pdf_page_dims(page_dims)
        except ImportError:
            errors.append(f"{mod} not installed")
        except Exception as e:
            errors.append(f"{mod} error: {e}")

    # 3) pdfplumber (only if installed)
    try:
        if pdfplumber is not None:
            pages: list[str] = []
            page_dims: list[dict] = []
            with pdfplumber.open(io.BytesIO(data)) as pdf:
                for p in pdf.pages:
                    try:
                        pages.append(p.extract_text() or "")
                    except Exception:
                        pages.append("")
                    page_dims.append(
                        _make_pdf_page_dim(getattr(p, "width", 0), getattr(p, "height", 0))
                    )
            if pages:
                print(f"[INFO] PDF extracted with pdfplumber: {len(pages)} pages")
                return pages, page_dims, _average_pdf_page_dims(page_dims)
        else:
            errors.append("pdfplumber not installed")
    except Exception as e:
        errors.append(f"pdfplumber error: {e}")

    # If nothing worked, fail with diagnostic info
    error_msg = "PDF extraction failed. Tried: " + "; ".join(errors)
    print(f"[ERROR] {error_msg}")
    raise RuntimeError(error_msg)


def _extract_pdf_pages_from_bytes(data: bytes) -> list[str]:
    """Return per-page text. Never invent page breaks."""
    if not data:
        return [""]

    errors = []

    # 1) PyMuPDF (fitz) - best page fidelity
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(stream=data, filetype="pdf")
        pages: list[str] = []
        for p in doc:
            pages.append(p.get_text("text") or "")
        doc.close()
        if pages:
            print(f"[INFO] PDF extracted with PyMuPDF: {len(pages)} pages")
            return pages
    except ImportError:
        errors.append("PyMuPDF (fitz) not installed")
    except Exception as e:
        errors.append(f"PyMuPDF error: {e}")

    # 2) pypdf / PyPDF2
    for mod in ("pypdf", "PyPDF2"):
        try:
            if mod == "pypdf":
                from pypdf import PdfReader
            else:
                from PyPDF2 import PdfReader
            reader = PdfReader(io.BytesIO(data))
            pages: list[str] = []
            for page in reader.pages:
                try:
                    pages.append(page.extract_text() or "")
                except Exception:
                    pages.append("")
            if pages:
                print(f"[INFO] PDF extracted with {mod}: {len(pages)} pages")
                return pages
        except ImportError:
            errors.append(f"{mod} not installed")
        except Exception as e:
            errors.append(f"{mod} error: {e}")

    # 3) pdfplumber (only if installed)
    try:
        if pdfplumber is not None:
            pages: list[str] = []
            with pdfplumber.open(io.BytesIO(data)) as pdf:
                for p in pdf.pages:
                    try:
                        pages.append(p.extract_text() or "")
                    except Exception:
                        pages.append("")
            if pages:
                print(f"[INFO] PDF extracted with pdfplumber: {len(pages)} pages")
                return pages
        else:
            errors.append("pdfplumber not installed")
    except Exception as e:
        errors.append(f"pdfplumber error: {e}")

    # If nothing worked, fail with diagnostic info
    error_msg = "PDF extraction failed. Tried: " + "; ".join(errors)
    print(f"[ERROR] {error_msg}")
    raise RuntimeError(error_msg)


def _extract_docx_text_direct(docx_bytes: bytes) -> list[str]:
    """
    Extract text directly from DOCX using python-docx.
    Returns list of page-like chunks based on section/page breaks or character heuristic.
    """
    if python_docx is None:
        raise RuntimeError("python-docx not installed. Run: pip install python-docx")

    # Load DOCX from bytes
    doc = python_docx.Document(io.BytesIO(docx_bytes))

    # Collect all text, respecting page breaks where we can detect them
    pages: list[str] = []
    current_page_lines: list[str] = []

    # Approximate chars per page (typical US Letter page, ~3000 chars)
    CHARS_PER_PAGE = 3000

    def flush_page():
        nonlocal current_page_lines
        if current_page_lines:
            page_text = "\n".join(current_page_lines)
            pages.append(page_text)
            current_page_lines = []

    current_char_count = 0

    for para in doc.paragraphs:
        para_text = para.text or ""

        # Check for explicit page break in paragraph's XML
        has_page_break = False
        try:
            # Check for page breaks in the paragraph's runs
            for run in para.runs:
                if run._element is not None:
                    # Look for w:br with w:type="page"
                    for br in run._element.findall(
                        ".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}br"
                    ):
                        br_type = br.get(
                            "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}type"
                        )
                        if br_type == "page":
                            has_page_break = True
                            break
                if has_page_break:
                    break
        except Exception:
            pass

        # If page break detected, flush current page first
        if has_page_break and current_page_lines:
            flush_page()
            current_char_count = 0

        # Add paragraph text
        if para_text.strip():
            current_page_lines.append(para_text)
            current_char_count += len(para_text) + 1  # +1 for newline

        # If we've accumulated enough text, consider it a page
        if current_char_count >= CHARS_PER_PAGE:
            flush_page()
            current_char_count = 0

    # Flush any remaining content
    flush_page()

    # If no pages were created, return at least one empty page
    if not pages:
        pages = [""]

    print(f"[INFO] DOCX extracted directly: {len(pages)} pages")
    return pages


def _extract_docx_pages_from_bytes(docx_bytes: bytes) -> list[str]:
    """Return per-page text with real pagination (DOCX rendered -> PDF -> extract)."""
    pdf_bytes = _convert_docx_to_pdf_bytes(docx_bytes)  # must succeed or we error
    return _extract_pdf_pages_from_bytes(pdf_bytes)


def _convert_text_to_pdf_bytes(text: str) -> bytes:
    """Render plain text into an A4 PDF and return bytes."""
    try:
        import fitz  # PyMuPDF
    except Exception as e:
        raise RuntimeError("PyMuPDF (fitz) not installed") from e

    text = text or ""
    doc = fitz.open()
    try:
        if hasattr(fitz, "paper_size"):
            page_w, page_h = fitz.paper_size("a4")
        else:
            page_w, page_h = (595, 842)

        margin = 36
        font_size = 12
        line_height = int(font_size * 1.4)
        max_width = max(10, int(page_w - 2 * margin))
        max_lines = max(1, int((page_h - 2 * margin) / line_height))
        max_chars = max(10, int(max_width / (font_size * 0.55)))

        lines: list[str] = []
        for para in text.splitlines():
            if para == "":
                lines.append("")
                continue
            wrapped = textwrap.wrap(
                para,
                width=max_chars,
                replace_whitespace=False,
                drop_whitespace=False,
            )
            lines.extend(wrapped if wrapped else [""])

        idx = 0
        if not lines:
            doc.new_page(width=page_w, height=page_h)
        while idx < len(lines):
            page = doc.new_page(width=page_w, height=page_h)
            y = margin
            for _ in range(max_lines):
                if idx >= len(lines):
                    break
                line = lines[idx]
                page.insert_text((margin, y), line, fontsize=font_size, fontname="helv")
                y += line_height
                idx += 1

        return doc.write()
    finally:
        doc.close()


def _extract_text_pages_from_text(text: str) -> list[str]:
    """Return per-page text via PDF rendering for plain text."""
    pdf_bytes = _convert_text_to_pdf_bytes(text or "")
    return _extract_pdf_pages_from_bytes(pdf_bytes)


# ---- PDF disk cache (per-document, with 30-minute TTL) ----
import uuid as _uuid

_PDF_CACHE_LOCK = threading.Lock()
_PDF_CACHE: dict = {}  # cache_id -> {"path": Path, "created": float, "accessed": float}
_PDF_CACHE_TTL = 1800  # 30 minutes in seconds


def _cleanup_stale_pdf_cache() -> None:
    """Remove cached PDFs that haven't been accessed in _PDF_CACHE_TTL seconds."""
    now = time.time()
    with _PDF_CACHE_LOCK:
        for cid in list(_PDF_CACHE.keys()):
            entry = _PDF_CACHE[cid]
            last_touch = entry.get("accessed", entry.get("created", 0))
            if now - last_touch > _PDF_CACHE_TTL:
                _PDF_CACHE.pop(cid, None)
                if entry.get("path"):
                    try:
                        Path(entry["path"]).unlink(missing_ok=True)
                    except Exception:
                        pass


def _evict_cached_pdf(cache_id: str) -> None:
    """Remove a single cached PDF by its cache_id."""
    with _PDF_CACHE_LOCK:
        entry = _PDF_CACHE.pop(cache_id, None)
    if entry and entry.get("path"):
        try:
            Path(entry["path"]).unlink(missing_ok=True)
        except Exception:
            pass


def _cache_pdf_to_disk(data: bytes) -> str:
    """Write PDF bytes to a temp file, return a cache_id."""
    cache_id = str(_uuid.uuid4())
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf", prefix="burmese_cache_")
    tmp.write(data)
    tmp.close()
    _cleanup_stale_pdf_cache()  # Only remove PDFs older than 30 min
    now = time.time()
    with _PDF_CACHE_LOCK:
        _PDF_CACHE[cache_id] = {"path": tmp.name, "created": now, "accessed": now}
    return cache_id


def _get_cached_pdf_path(cache_id: str) -> str | None:
    """Return the file path for a cached PDF, or None. Updates access time."""
    with _PDF_CACHE_LOCK:
        entry = _PDF_CACHE.get(cache_id)
        if entry:
            entry["accessed"] = time.time()
    if entry and entry.get("path") and Path(entry["path"]).exists():
        return entry["path"]
    return None


@app.route("/api/close_pdf", methods=["POST"])
def api_close_pdf():
    """Evict a single cached PDF when the user closes it."""
    jdata = request.get_json(silent=True) or {}
    cache_id = jdata.get("cache_id", "").strip()
    if not cache_id:
        return jsonify({"ok": False, "error": "missing cache_id"}), 400
    _evict_cached_pdf(cache_id)
    return jsonify({"ok": True})


@app.route("/api/serve_pdf/<cache_id>", methods=["GET"])
def api_serve_pdf(cache_id):
    """Serve a cached PDF file for PDF.js to render in the browser."""
    cache_id = (cache_id or "").strip()
    if not cache_id:
        return jsonify({"ok": False, "error": "missing cache_id"}), 400
    pdf_path = _get_cached_pdf_path(cache_id)
    if not pdf_path:
        return jsonify({"ok": False, "error": "cache_expired"}), 410
    return send_file(pdf_path, mimetype="application/pdf")


def _extract_page_words_and_blocks(page, scale=1.0):
    """Extract words with bounding boxes and structured blocks from a single PDF page.

    Returns dict with keys: words, structured_blocks.
    """
    words = []
    structured_blocks = []
    raw = page.get_text("rawdict")
    raw_blocks = raw.get("blocks", []) if isinstance(raw, dict) else []
    page_rect = page.rect
    page_w = page_rect.width

    word_idx = 0

    for bno, block in enumerate(raw_blocks):
        if block.get("type", 0) != 0:
            continue
        lines = block.get("lines") or []
        if not lines:
            continue

        block_min_x = float("inf")
        block_max_x = 0.0
        block_min_y = float("inf")
        lines_out = []
        first_line_x = None
        second_line_x = None

        for lno, line in enumerate(lines):
            spans = line.get("spans") or []
            line_runs = []
            pending_space = False
            run_text = ""
            run_x0 = run_y0 = run_x1 = run_y1 = None
            run_font_sizes = []
            run_fonts = []
            run_gap_before = 0.0
            run_space_before = False
            prev_x1 = None
            word_no = 0

            def flush_run():
                nonlocal \
                    run_text, \
                    run_x0, \
                    run_y0, \
                    run_x1, \
                    run_y1, \
                    run_font_sizes, \
                    run_fonts, \
                    run_gap_before, \
                    run_space_before, \
                    word_idx, \
                    word_no
                if (
                    not run_text
                    or run_x0 is None
                    or run_y0 is None
                    or run_x1 is None
                    or run_y1 is None
                ):
                    run_text = ""
                    run_x0 = run_y0 = run_x1 = run_y1 = None
                    run_font_sizes = []
                    run_fonts = []
                    run_gap_before = 0.0
                    run_space_before = False
                    return
                run_h = max(0.0, run_y1 - run_y0)
                font_size = run_h
                if run_font_sizes:
                    sizes = sorted(run_font_sizes)
                    mid = len(sizes) // 2
                    if len(sizes) % 2 == 1:
                        font_size = sizes[mid]
                    else:
                        font_size = (sizes[mid - 1] + sizes[mid]) / 2
                font_name = None
                if run_fonts:
                    counts = {}
                    for fn in run_fonts:
                        counts[fn] = counts.get(fn, 0) + 1
                    font_name = max(counts.items(), key=lambda kv: kv[1])[0]
                run = {
                    "text": run_text,
                    "x": run_x0 * scale,
                    "y": run_y0 * scale,
                    "w": (run_x1 - run_x0) * scale,
                    "h": run_h * scale,
                    "fontSize": font_size * scale,
                    "font": font_name,
                    "block_no": int(bno),
                    "line_no": int(lno),
                    "word_no": int(word_no),
                    "word_idx": int(word_idx),
                    "gap_before": run_gap_before * scale,
                    "space_before": bool(run_space_before),
                }
                line_runs.append(run)
                words.append(run)
                word_idx += 1
                word_no += 1
                run_text = ""
                run_x0 = run_y0 = run_x1 = run_y1 = None
                run_font_sizes = []
                run_fonts = []
                run_gap_before = 0.0
                run_space_before = False

            for span in spans:
                span_size = span.get("size") or 0.0
                span_font = span.get("font") or ""
                chars = span.get("chars") or []
                for ch in chars:
                    c = ch.get("c")
                    bbox = ch.get("bbox") or span.get("bbox")
                    if not bbox or len(bbox) < 4:
                        continue
                    x0, y0, x1, y1 = bbox[0], bbox[1], bbox[2], bbox[3]
                    if c is None:
                        c = ""
                    if isinstance(c, str) and c.isspace():
                        if run_text:
                            flush_run()
                        pending_space = True
                        prev_x1 = x1
                        continue
                    if c == "":
                        prev_x1 = x1
                        continue

                    gap = 0.0
                    if prev_x1 is not None:
                        gap = x0 - prev_x1

                    size_raw = span_size if span_size else max(0.0, y1 - y0)
                    char_w = max(0.0, x1 - x0)
                    gap_threshold = max(1.0, size_raw * 0.2, char_w * 0.5)
                    if gap > gap_threshold:
                        if run_text:
                            flush_run()
                        pending_space = True

                    if not run_text:
                        run_space_before = pending_space
                        run_gap_before = max(0.0, gap)
                        pending_space = False
                        run_x0 = x0
                        run_y0 = y0
                        run_x1 = x1
                        run_y1 = y1
                        if size_raw > 0:
                            run_font_sizes.append(size_raw)
                        if span_font:
                            run_fonts.append(span_font)
                        run_text = str(c)
                    else:
                        run_text += str(c)
                        run_x0 = min(run_x0, x0)
                        run_y0 = min(run_y0, y0)
                        run_x1 = max(run_x1, x1)
                        run_y1 = max(run_y1, y1)
                        if size_raw > 0:
                            run_font_sizes.append(size_raw)
                        if span_font:
                            run_fonts.append(span_font)
                    prev_x1 = x1

            if run_text:
                flush_run()

            lines_out.append({"words": line_runs})
            if line_runs:
                line_first_x = line_runs[0]["x"]
                if first_line_x is None:
                    first_line_x = line_first_x
                elif second_line_x is None:
                    second_line_x = line_first_x
                for w in line_runs:
                    block_min_x = min(block_min_x, w["x"])
                    block_max_x = max(block_max_x, w["x"] + w["w"])
                    block_min_y = min(block_min_y, w["y"])

        if not lines_out or block_min_x == float("inf"):
            continue

        block_center = (block_min_x + block_max_x) / 2
        page_center = (page_w * scale) / 2
        left_margin = block_min_x
        right_margin = (page_w * scale) - block_max_x
        margin_threshold = (page_w * scale) * 0.15
        center_tolerance = (page_w * scale) * 0.1

        if (
            abs(block_center - page_center) < center_tolerance
            and left_margin > margin_threshold
            and right_margin > margin_threshold
        ):
            alignment = "center"
        elif right_margin < margin_threshold and left_margin > margin_threshold * 2:
            alignment = "right"
        else:
            alignment = "left"

        first_line_indent = 0
        if first_line_x is not None and second_line_x is not None:
            first_line_indent = max(0, first_line_x - second_line_x)

        structured_blocks.append(
            {
                "alignment": alignment,
                "left_margin": block_min_x,
                "min_y": block_min_y,
                "first_line_indent": first_line_indent,
                "lines": lines_out,
            }
        )

    return {"words": words, "structured_blocks": structured_blocks}


@app.route("/api/pdf_page_text", methods=["POST"])
def api_pdf_page_text():
    """Extract text for a specific page from a cached PDF.

    Returns both raw text and geometrically-aware layout data (words + structured_blocks).
    """
    try:
        import fitz
    except ImportError:
        return jsonify({"ok": False, "error": "PyMuPDF (fitz) not installed"}), 500

    jdata = request.get_json(silent=True) or {}
    cache_id = (jdata.get("cache_id") or "").strip()
    page_num = int(jdata.get("page", 0))

    if not cache_id:
        return jsonify({"ok": False, "error": "missing cache_id"}), 400

    pdf_path = _get_cached_pdf_path(cache_id)
    if not pdf_path:
        return jsonify({"ok": False, "error": "cache_expired"}), 410

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        return jsonify({"ok": False, "error": f"pdf_open_failed: {e}"}), 500

    total_pages = doc.page_count
    if page_num < 0 or page_num >= total_pages:
        doc.close()
        return jsonify({"ok": False, "error": "invalid_page"}), 400

    page = doc[page_num]
    raw_text = page.get_text("text") or ""
    rect = page.rect
    page_width = rect.width
    page_height = rect.height

    try:
        result = _extract_page_words_and_blocks(page, scale=1.0)
    except Exception as e:
        print(f"[WARN] Failed to extract words from page {page_num}: {e}")
        result = {"words": [], "structured_blocks": []}

    doc.close()

    return jsonify(
        {
            "ok": True,
            "raw_text": raw_text,
            "words": result["words"],
            "structured_blocks": result["structured_blocks"],
            "page": page_num,
            "total_pages": total_pages,
            "width": page_width,
            "height": page_height,
        }
    )


def _extract_pdf_page_count_from_bytes(data: bytes) -> int:
    """Return PDF page count without extracting text or page dimensions."""
    if not data:
        return 1

    errors = []

    # 1) PyMuPDF (fitz)
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(stream=data, filetype="pdf")
        count = int(getattr(doc, "page_count", 0) or 0)
        doc.close()
        if count > 0:
            return count
    except ImportError:
        errors.append("PyMuPDF (fitz) not installed")
    except Exception as e:
        errors.append(f"PyMuPDF error: {e}")

    # 2) pypdf / PyPDF2
    for mod in ("pypdf", "PyPDF2"):
        try:
            if mod == "pypdf":
                from pypdf import PdfReader
            else:
                from PyPDF2 import PdfReader
            reader = PdfReader(io.BytesIO(data))
            count = int(len(reader.pages))
            if count > 0:
                return count
        except ImportError:
            errors.append(f"{mod} not installed")
        except Exception as e:
            errors.append(f"{mod} error: {e}")

    # 3) pdfplumber
    try:
        if pdfplumber is not None:
            with pdfplumber.open(io.BytesIO(data)) as pdf:
                count = int(len(pdf.pages))
            if count > 0:
                return count
        else:
            errors.append("pdfplumber not installed")
    except Exception as e:
        errors.append(f"pdfplumber error: {e}")

    error_msg = "PDF page-count extraction failed. Tried: " + "; ".join(errors)
    print(f"[ERROR] {error_msg}")
    raise RuntimeError(error_msg)


@app.route("/api/extract_text", methods=["POST"])
def api_extract_text():
    f = request.files.get("file")
    if f is None:
        return jsonify({"ok": False, "error": "no_file"}), 400

    filename = (f.filename or "").lower().strip()
    data = f.read() or b""

    pages: list[str] = []
    meta: dict = {}

    if filename.endswith(".pdf"):
        try:
            page_count = _extract_pdf_page_count_from_bytes(data)
            if page_count < 1:
                page_count = 1
            meta = {
                "pages": page_count,
                "backend": "pdf",
            }
        except Exception as e:
            return jsonify({"ok": False, "error": str(e) or "pdf_extract_failed"}), 500
        # Cache the PDF to disk for page rendering (avoids re-upload)
        cache_id = _cache_pdf_to_disk(data)
        meta["pdf_cache_id"] = cache_id
        return jsonify({"ok": True, "pages": [], "text": "", "meta": meta})

    elif filename.endswith(".docx"):
        try:
            pages = _extract_docx_pages_from_bytes(data)
            meta = {"pages": len(pages), "backend": "docx"}
        except Exception as e:
            return jsonify({"ok": False, "error": str(e) or "docx_extract_failed"}), 500

    else:
        # Treat as plain text - no pages
        try:
            full_text = data.decode("utf-8")
        except Exception:
            full_text = data.decode("utf-8", errors="replace")
        meta = {"backend": "text"}
        return jsonify({"ok": True, "text": full_text, "meta": meta})

    # For PDF/DOCX return pages for original view mode
    full_text = "\n".join(p.rstrip("\n") for p in pages).rstrip() + "\n"
    return jsonify({"ok": True, "pages": pages, "text": full_text, "meta": meta})


@app.route("/api/extract_text_from_text", methods=["POST"])
def api_extract_text_from_text():
    data = request.get_json(silent=True) or {}
    text = data.get("text")
    text = "" if text is None else str(text)
    meta = {"backend": "text"}
    return jsonify({"ok": True, "text": text, "meta": meta})


# ============================================================
# SIMPLIFIED TEXT EXTRACTION: Word/text pages with 500-word breaks
# ============================================================


def _extract_text_pages_simple(text: str) -> list[str]:
    """
    Simple text extraction: split text into pages with synthetic page breaks
    after every 3000 characters. Preserves original line breaks and formatting.
    """
    if not text:
        return [""]

    pages: list[str] = []
    current_page_text: list[str] = []
    current_char_count = 0
    CHARS_PER_PAGE = 3000

    # Split by lines to preserve line structure
    lines = text.split("\n")

    for line in lines:
        line_len = len(line)

        # Check if adding this line would exceed 3000 characters
        # +1 accounts for the newline character
        if current_char_count > 0 and current_char_count + line_len + 1 > CHARS_PER_PAGE:
            # Finalize current page
            pages.append("\n".join(current_page_text))
            current_page_text = []
            current_char_count = 0

        # Add line to current page
        current_page_text.append(line)
        current_char_count += line_len + 1

    # Add remaining text as final page
    if current_page_text:
        pages.append("\n".join(current_page_text))

    return pages if pages else [""]


def _extract_docx_text_simple(docx_bytes: bytes) -> str:
    """Extract plain text from DOCX file (without PDF conversion)."""
    if python_docx is None:
        raise RuntimeError("python-docx not installed")

    doc = python_docx.Document(io.BytesIO(docx_bytes))
    text_parts: list[str] = []
    for para in doc.paragraphs:
        if para.text:
            text_parts.append(para.text)
    return "\n".join(text_parts)


@app.route("/api/extract_text_simple", methods=["POST"])
def api_extract_text_simple():
    """
    Simplified text extraction for .txt and .docx files.
    Returns pages for DOCX (for original view), plain text for .txt.
    """
    f = request.files.get("file")
    if f is None:
        return jsonify({"ok": False, "error": "no_file"}), 400

    filename = (f.filename or "").lower().strip()
    data = f.read() or b""

    try:
        if filename.endswith(".docx"):
            # DOCX - extract plain text only (like text file)
            # Original view conversion happens on-demand via /api/docx_to_pdf
            text = _extract_docx_text_simple(data)
            meta = {"backend": "docx"}
            return jsonify({"ok": True, "text": text, "meta": meta})
        else:
            # Plain text - no pages needed
            try:
                text = data.decode("utf-8")
            except Exception:
                text = data.decode("utf-8", errors="replace")
            meta = {"backend": "text_simple"}
            return jsonify({"ok": True, "text": text, "meta": meta})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e) or "extract_failed"}), 500


@app.route("/api/extract_text_simple_from_text", methods=["POST"])
def api_extract_text_simple_from_text():
    """
    Simplified text extraction from raw text dump.
    Returns plain text as a single continuous block.
    """
    data = request.get_json(silent=True) or {}
    text = data.get("text")
    text = "" if text is None else str(text)
    meta = {"backend": "text_simple"}
    return jsonify({"ok": True, "text": text, "meta": meta})


@app.route("/api/docx_to_pdf", methods=["POST"])
def api_docx_to_pdf():
    """
    Convert DOCX file to PDF (for original view support).
    Returns PDF bytes for rendering with /api/render_pdf_pages
    """
    f = request.files.get("file")
    if f is None:
        return jsonify({"ok": False, "error": "no_file"}), 400

    filename = (f.filename or "").lower().strip()
    data = f.read() or b""

    if not filename.endswith(".docx"):
        return jsonify({"ok": False, "error": "not_a_docx"}), 400

    try:
        pdf_bytes = _convert_docx_to_pdf_bytes(data)
        # Return PDF as bytes with proper content-type
        return Response(pdf_bytes, mimetype="application/pdf")
    except Exception as e:
        return jsonify({"ok": False, "error": str(e) or "docx_to_pdf_failed"}), 500


@app.route("/api/render_pdf_pages", methods=["POST"])
def api_render_pdf_pages():
    """
    Render PDF pages as images with text bounding boxes.
    Returns base64-encoded images and word positions for text overlay.
    Accepts either a cached PDF (cache_id in JSON/form data) or a file upload.
    """
    import base64

    try:
        import fitz  # PyMuPDF
    except ImportError:
        return jsonify({"ok": False, "error": "PyMuPDF (fitz) not installed"}), 500

    doc = None

    # Try cache_id first (lightweight page render, no re-upload)
    req_data = request.form.get("data") or ""
    cache_id = None
    if req_data:
        try:
            params = json.loads(req_data)
            cache_id = params.get("cache_id")
        except Exception:
            pass
    if not cache_id:
        # Also check JSON body
        jdata = request.get_json(silent=True) or {}
        cache_id = jdata.get("cache_id")

    if cache_id:
        pdf_path = _get_cached_pdf_path(cache_id)
        if pdf_path:
            try:
                doc = fitz.open(pdf_path)
            except Exception as e:
                return jsonify({"ok": False, "error": f"pdf_open_failed: {e}"}), 500
        else:
            return jsonify({"ok": False, "error": "cache_expired"}), 410

    # Fallback: accept file upload (for DOCX flow etc.)
    if doc is None:
        f = request.files.get("file")
        if f is None:
            return jsonify({"ok": False, "error": "no_file"}), 400
        filename = (f.filename or "").lower().strip()
        data = f.read() or b""
        if not filename.endswith(".pdf"):
            return jsonify({"ok": False, "error": "not_a_pdf"}), 400
        try:
            doc = fitz.open(stream=data, filetype="pdf")
        except Exception as e:
            return jsonify({"ok": False, "error": f"pdf_open_failed: {e}"}), 500

    # Optional: get specific page range
    req_data = request.form.get("data")
    page_start = 0
    page_end = len(doc)
    scale = 1.5  # Default scale for rendering

    if req_data:
        try:
            params = json.loads(req_data)
            page_start = int(params.get("page_start", 0))
            page_end = int(params.get("page_end", len(doc)))
            scale = float(params.get("scale", 1.5))
        except Exception:
            pass

    page_start = max(0, min(page_start, len(doc)))
    page_end = max(page_start, min(page_end, len(doc)))

    total_pages = doc.page_count
    pages_out = []
    fonts_out = {}
    font_cache = {}
    for page_idx in range(page_start, page_end):
        page = doc[page_idx]

        # Render page to image
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        img_bytes = pix.tobytes("png")
        img_b64 = base64.b64encode(img_bytes).decode("ascii")

        # Get page dimensions
        page_width = pix.width
        page_height = pix.height

        # Extract embedded fonts used on this page (for true font rendering)
        try:
            font_items = page.get_fonts(full=True)
        except Exception:
            try:
                font_items = page.get_fonts()
            except Exception:
                font_items = []
        for item in font_items or []:
            xref = None
            name_hint = None
            if isinstance(item, (list, tuple)) and len(item) > 0:
                xref = item[0]
                if len(item) > 3:
                    name_hint = item[3]
            if not xref:
                continue
            if xref not in font_cache:
                try:
                    finfo = doc.extract_font(xref)
                except Exception:
                    finfo = None
                if not finfo:
                    continue
                if isinstance(finfo, dict):
                    buf = finfo.get("buffer")
                    family = finfo.get("name") or name_hint or f"font_{xref}"
                    ext = (finfo.get("ext") or "").lower()
                elif isinstance(finfo, (list, tuple)):
                    buf = finfo[3] if len(finfo) > 3 else None
                    family = finfo[0] if len(finfo) > 0 else None
                    ext = (finfo[1] if len(finfo) > 1 else "") or ""
                    family = family or name_hint or f"font_{xref}"
                    ext = str(ext).lower()
                else:
                    continue
                if not buf:
                    continue
                if ext == "ttf":
                    mime = "font/ttf"
                elif ext == "otf":
                    mime = "font/otf"
                elif ext == "woff":
                    mime = "font/woff"
                elif ext == "woff2":
                    mime = "font/woff2"
                else:
                    mime = "application/octet-stream"
                font_cache[xref] = {
                    "family": family,
                    "ext": ext,
                    "mime": mime,
                    "data": base64.b64encode(buf).decode("ascii"),
                }
            font_entry = font_cache.get(xref)
            if font_entry and font_entry.get("family"):
                fonts_out[font_entry["family"]] = font_entry

        # Extract text with bounding boxes using shared helper
        try:
            _wb = _extract_page_words_and_blocks(page, scale=scale)
            words = _wb["words"]
            structured_blocks = _wb["structured_blocks"]
        except Exception as e:
            print(f"[WARN] Failed to extract words from page {page_idx}: {e}")
            words = []
            structured_blocks = []

        # Extract text blocks with alignment info
        # Each block has: (x0, y0, x1, y1, "text", block_no, block_type)
        # block_type: 0 = text, 1 = image
        text_blocks = []
        page_rect = page.rect  # Page dimensions (unscaled)
        page_w = page_rect.width
        try:
            blocks = page.get_text("blocks")
            for b in blocks:
                if len(b) >= 6 and b[6] == 0:  # block_type 0 = text
                    x0, y0, x1, y1, block_text, block_no = b[0], b[1], b[2], b[3], b[4], b[5]
                    # Calculate alignment based on X position
                    block_center = (x0 + x1) / 2
                    page_center = page_w / 2
                    left_margin = x0
                    right_margin = page_w - x1

                    # Determine alignment: check if block is centered, right-aligned, or left-aligned
                    margin_threshold = page_w * 0.15  # 15% of page width
                    center_tolerance = page_w * 0.1  # 10% tolerance for centering

                    if (
                        abs(block_center - page_center) < center_tolerance
                        and left_margin > margin_threshold
                        and right_margin > margin_threshold
                    ):
                        align = "center"
                    elif right_margin < margin_threshold and left_margin > margin_threshold * 2:
                        align = "right"
                    else:
                        align = "left"

                    text_blocks.append(
                        {
                            "text": block_text.rstrip(),
                            "align": align,
                            "x0": x0,
                            "x1": x1,
                            "y0": y0,
                            "y1": y1,
                        }
                    )
        except Exception as e:
            print(f"[WARN] Failed to extract blocks from page {page_idx}: {e}")

        pages_out.append(
            {
                "page": page_idx,
                "image": img_b64,
                "width": page_width,
                "height": page_height,
                "words": words,
                "structured_blocks": structured_blocks,
                "blocks": text_blocks,
            }
        )

    doc.close()

    return jsonify(
        {
            "ok": True,
            "pages": pages_out,
            "total_pages": total_pages,
            "scale": scale,
            "fonts": list(fonts_out.values()),
        }
    )


@app.route("/debug_ud_parser", methods=["POST"])
def debug_ud_parser():
    """
    Debug the UD parser. By default, mirrors /lookup normalization + segmentation.
    Payload JSON:
      { "text": "...", "raw": false }  # raw=true bypasses segmentation and parses raw text
    Response: per-token POS/TAG/DEP with heads/children, plus segments used.
    """
    return jsonify({"ok": False, "error": "debug_disabled"}), 404
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    use_raw = bool(data.get("raw"))
    model_override = (data.get("model") or "").strip()
    merge_greedy_param = (data.get("merge_greedy") or "").strip().lower()
    stanza_seg_param = str(data.get("stanza_segmenter") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if not text:
        return jsonify({"ok": False, "error": "empty text"}), 400

    parser = None
    override_nlp = None
    override_err = None
    if model_override:
        try:
            import spacy  # type: ignore

            global _DEBUG_SPACY_MODEL_CACHE  # type: ignore
            try:
                _DEBUG_SPACY_MODEL_CACHE  # type: ignore[name-defined]
            except Exception:
                _DEBUG_SPACY_MODEL_CACHE = {}  # type: ignore[name-defined]

            cache = _DEBUG_SPACY_MODEL_CACHE  # type: ignore[name-defined]
            if model_override not in cache:
                cache[model_override] = spacy.load(model_override)
            override_nlp = cache[model_override]
        except Exception as e:
            override_err = f"spacy_load_failed:{type(e).__name__}:{e}"
    else:
        parser = init_ud_parser()
        if parser is None:
            return jsonify({"ok": False, "error": "ud_disabled"}), 503

    segments = None
    segments_used = None
    doc2seg = None
    mode = "raw" if use_raw else "segments"
    original_text_for_overlay = text

    if use_raw:
        if override_nlp is not None:
            doc = override_nlp(text)
        else:
            doc = parser.nlp(text)
    else:
        norm = normalize_burmese_for_segmentation(text)
        if not norm:
            return jsonify(
                {"ok": False, "error": "query contains no Burmese after normalization"}
            ), 400
        segments, island_spans = segment_with_pipeline_and_islands(norm)
        fills_by_seg: list[dict | None] = [None] * len(segments)
        for s, e in island_spans:
            island_tokens = segments[s:e]
            filled = [_fill_token_with_dict_for_ui(t) for t in island_tokens]
            for i, f in enumerate(filled):
                fills_by_seg[s + i] = f
        kept_words: list[str] = []
        doc2seg = []
        for si, tok in enumerate(segments):
            if _is_spacy_clean_token(tok):
                doc2seg.append(si)
                kept_words.append(tok)
        segments_used = kept_words
        spaces = [True] * (len(kept_words) - 1) + [False] if kept_words else []
        if override_nlp is not None:
            from spacy.tokens import Doc  # type: ignore

            doc = Doc(override_nlp.vocab, words=kept_words, spaces=spaces)
            dict_fills_for_kept = (
                [fills_by_seg[si] for si in doc2seg] if doc2seg is not None else []
            )
            for tok, fill_data in zip(doc, dict_fills_for_kept):
                if fill_data is not None:
                    tok._.dict_fills = fill_data
            doc = override_nlp(doc)
        else:
            doc = parser._Doc(parser.nlp.vocab, words=kept_words, spaces=spaces)
            dict_fills_for_kept = (
                [fills_by_seg[si] for si in doc2seg] if doc2seg is not None else []
            )
            for tok, fill_data in zip(doc, dict_fills_for_kept):
                if fill_data is not None:
                    tok._.dict_fills = fill_data
            doc = parser.nlp(doc)

    tokens_out = []
    for t in doc:
        seg_i = doc2seg[int(t.i)] if doc2seg is not None else None
        head_doc_i = int(t.head.i)
        head_seg_i = doc2seg[head_doc_i] if doc2seg is not None else None
        tokens_out.append(
            {
                "i": int(t.i),
                "seg_i": seg_i,
                "text": t.text,
                "lemma": t.lemma_,
                "upos": t.pos_,
                "tag": t.tag_,
                "dep": t.dep_,
                "head": {"i": head_doc_i, "seg_i": head_seg_i, "text": t.head.text},
                "children": [int(ch.i) for ch in t.children],
                "is_sent_start": bool(t.is_sent_start),
            }
        )

    sents_out = []
    try:
        for si, sent in enumerate(doc.sents):
            start_i = int(sent.start)
            end_i = int(sent.end)  # exclusive
            seg_start_i = (
                doc2seg[start_i] if doc2seg is not None and start_i < len(doc2seg) else None
            )
            seg_end_i = (
                doc2seg[end_i - 1] if doc2seg is not None and end_i - 1 < len(doc2seg) else None
            )
            sents_out.append(
                {
                    "i": int(si),
                    "start": start_i,
                    "end": end_i,
                    "seg_start": seg_start_i,
                    "seg_end": seg_end_i,
                    "text": sent.text,
                }
            )
    except Exception:
        sents_out = []

    return jsonify(
        {
            "ok": True,
            "mode": mode,
            "input_text": text,
            "model": model_override or None,
            "model_error": override_err,
            "segments": segments,
            "segments_used": segments_used,
            "doc2seg": doc2seg,
            "token_count": len(tokens_out),
            "tokens": tokens_out,
            "sentences": sents_out,
        }
    )


@app.route("/debug_ud_parser_ui", methods=["GET"])
def debug_ud_parser_ui():
    """
    Simple web UI for /debug_ud_parser. Enter text, choose raw vs segmented,
    see the JSON response rendered below.
    """
    return Response("debug_disabled", mimetype="text/plain; charset=utf-8")
    html_page = """<!DOCTYPE html>
<html lang="my">
<head>
  <meta charset="utf-8">
  <title>UD Parser Debug</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 16px; line-height: 1.5; }
    textarea { width: 100%; height: 140px; font-size: 16px; }
    pre { background: #f4f4f4; padding: 12px; white-space: pre-wrap; }
    .controls { margin: 8px 0; }
  </style>
</head>
<body>
  <h2>UD Parser Debug</h2>
  <label for="inputText">Input text:</label><br>
  <textarea id="inputText" placeholder="Enter Burmese text..."></textarea>
  <div class="controls">
    <label><input type="checkbox" id="rawMode"> Parse raw (bypass segmentation)</label>
  </div>
  <div class="controls">
    <label><input type="checkbox" id="stanzaSeg"> Use Stanza tokenizer</label>
  </div>
  <div class="controls">
    <label for="modelPath">spaCy model (optional name/path):</label><br>
    <input id="modelPath" style="width:100%; font-size:16px;" placeholder="e.g. model-best or en_core_web_sm"/>
  </div>
  <button id="runBtn">Run parser</button>
  <div id="status"></div>
  <h3>Result</h3>
  <pre id="result"></pre>
  <h3>Sentence Segmentation</h3>
  <pre id="sentences"></pre>
  <script>
    const btn = document.getElementById('runBtn');
    const result = document.getElementById('result');
    const sentEl = document.getElementById('sentences');
    const status = document.getElementById('status');
    btn.onclick = async () => {
      const text = document.getElementById('inputText').value;
      const raw = document.getElementById('rawMode').checked;
      const stanzaSegmenter = document.getElementById('stanzaSeg').checked;
      const model = document.getElementById('modelPath').value;
      status.textContent = 'Running...';
      result.textContent = '';
      sentEl.textContent = '';
      try {
        const resp = await fetch('/debug_ud_parser', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, raw, model, stanza_segmenter: stanzaSegmenter })
        });
        const data = await resp.json();
        status.textContent = 'HTTP ' + resp.status;
        result.textContent = JSON.stringify(data, null, 2);
        if (data && data.sentences && Array.isArray(data.sentences)) {
          sentEl.textContent = data.sentences.map(s => `${s.i + 1}. [${s.start},${s.end}) ${s.text}`).join("\\n\\n");
        } else {
          sentEl.textContent = '(no sentence boundaries returned)';
        }
      } catch (e) {
        status.textContent = 'Error: ' + e;
      }
    };
    </script>
</body>
</html>"""
    return Response(html_page, mimetype="text/html; charset=utf-8")


@app.route("/debug/parser", methods=["GET"])
def debug_parser_route():
    return Response("debug_disabled", mimetype="text/plain; charset=utf-8")
    """
    Debug the UD parser via a simple GET endpoint.
    Mirrors normalization + segmentation from /lookup unless raw=1.
    Query params:
      q=...            (required)
      raw=1            (optional, bypass segmentation and parse raw text)
      stanza_segmenter=1 (optional, use stanza tokenizer)
      (format ignored; always HTML)
    """
    raw_q = (request.args.get("q") or "").strip()
    if not raw_q:
        return jsonify({"ok": False, "error": "missing query parameter 'q'"}), 400
    merge_greedy_param = (request.args.get("merge_greedy") or "").strip().lower()
    stanza_seg_param = str(request.args.get("stanza_segmenter") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }

    model_override = (request.args.get("model") or "").strip()

    parser = None
    override_nlp = None
    override_err = None
    if model_override:
        try:
            import spacy  # type: ignore

            global _DEBUG_SPACY_MODEL_CACHE  # type: ignore
            try:
                _DEBUG_SPACY_MODEL_CACHE  # type: ignore[name-defined]
            except Exception:
                _DEBUG_SPACY_MODEL_CACHE = {}  # type: ignore[name-defined]

            cache = _DEBUG_SPACY_MODEL_CACHE  # type: ignore[name-defined]
            if model_override not in cache:
                cache[model_override] = spacy.load(model_override)
            override_nlp = cache[model_override]
        except Exception as e:
            override_err = f"spacy_load_failed:{type(e).__name__}:{e}"
            return jsonify({"ok": False, "error": override_err}), 400
    else:
        parser = init_ud_parser()
        if parser is None:
            return jsonify({"ok": False, "error": "ud_disabled"}), 503

    use_raw = str(request.args.get("raw") or "").lower() in {"1", "true", "yes", "raw"}

    segments = None
    segments_used = None
    doc2seg = None
    mode = "raw" if use_raw else "segments"

    if use_raw:
        if override_nlp is not None:
            doc = override_nlp(raw_q)
        else:
            doc = parser.nlp(raw_q)
    else:
        extended_hits = set()
        norm = normalize_burmese_for_segmentation(raw_q, extended_hits=extended_hits)
        if not norm:
            return jsonify(
                {"ok": False, "error": "query contains no Burmese after normalization"}
            ), 400
        original_text_for_overlay = norm
        segments, island_spans = segment_with_pipeline_and_islands(norm)
        fills_by_seg: list[dict | None] = [None] * len(segments)
        for s, e in island_spans:
            island_tokens = segments[s:e]
            filled = [_fill_token_with_dict_for_ui(t) for t in island_tokens]
            for i, f in enumerate(filled):
                fills_by_seg[s + i] = f
        kept_words: list[str] = []
        doc2seg = []
        for si, tok in enumerate(segments):
            if _is_spacy_clean_token(tok):
                doc2seg.append(si)
                kept_words.append(tok)
        segments_used = kept_words
        spaces = [True] * (len(kept_words) - 1) + [False] if kept_words else []
        if override_nlp is not None:
            from spacy.tokens import Doc  # type: ignore

            doc = Doc(override_nlp.vocab, words=kept_words, spaces=spaces)
            dict_fills_for_kept = (
                [fills_by_seg[si] for si in doc2seg] if doc2seg is not None else []
            )
            for tok, fill_data in zip(doc, dict_fills_for_kept):
                if fill_data is not None:
                    tok._.dict_fills = fill_data
            doc = override_nlp(doc)
        else:
            # Capture morphologizer output BEFORE dict_pos_override runs
            morphologizer_output = None
            if parser is not None and "morphologizer" in parser.nlp.pipe_names:
                try:
                    # Run just tok2vec + morphologizer to get original POS
                    temp_doc = parser._Doc(parser.nlp.vocab, words=kept_words, spaces=spaces)
                    tok2vec = parser.nlp.get_pipe("tok2vec")
                    morph = parser.nlp.get_pipe("morphologizer")
                    temp_doc = tok2vec(temp_doc)
                    temp_doc = morph(temp_doc)
                    morphologizer_output = [t.pos_ for t in temp_doc]
                except Exception:
                    pass

            # Now run the FULL pipeline (including dict_pos_override)
            doc = parser._Doc(parser.nlp.vocab, words=kept_words, spaces=spaces)

            # Compute dictionary fills for each kept word and set them on tokens
            dict_fills_for_kept = (
                [fills_by_seg[si] for si in doc2seg] if doc2seg is not None else []
            )
            for tok, fill_data in zip(doc, dict_fills_for_kept):
                if fill_data is not None:
                    tok._.dict_fills = fill_data

            doc = parser.nlp(doc)

    tokens_out = []

    # Ensure morphologizer_output is defined for all code paths
    try:
        morphologizer_output
    except NameError:
        morphologizer_output = None

    for t_idx, t in enumerate(doc):
        seg_i = doc2seg[int(t.i)] if doc2seg is not None else None
        head_doc_i = int(t.head.i)
        head_seg_i = doc2seg[head_doc_i] if doc2seg is not None else None
        tokens_out.append(
            {
                "i": int(t.i),
                "seg_i": seg_i,
                "text": t.text,
                "lemma": t.lemma_,
                "upos": t.pos_,
                "upos_original": morphologizer_output[t_idx]
                if morphologizer_output and t_idx < len(morphologizer_output)
                else None,
                "tag": t.tag_,
                "dep": t.dep_,
                "head": {"i": head_doc_i, "seg_i": head_seg_i, "text": t.head.text},
                "children": [int(ch.i) for ch in t.children],
            }
        )

    import urllib.parse

    rows = []
    for tok in tokens_out:
        children_str = ", ".join(str(c) for c in tok["children"])
        # Show if POS was constrained by dict_pos_override (changed from original)
        upos_display = html.escape(tok["upos"])
        upos_original = tok.get("upos_original")
        if upos_original and upos_original != tok["upos"]:
            # Highlight when POS was constrained by dict_pos_override
            upos_display = f"<strong style='color: green;'>{upos_display}</strong> <em style='color: gray;'>(was: {html.escape(upos_original)})</em>"

        rows.append(
            f"<tr><td>{tok['i']}</td><td>{'' if tok['seg_i'] is None else tok['seg_i']}</td><td>{html.escape(tok['text'])}</td>"
            f"<td>{upos_display}</td>"
            f"<td>{html.escape(tok['tag'])}</td>"
            f"<td>{html.escape(tok['dep'])}</td>"
            f"<td>{tok['head']['i']} / {'' if tok['head']['seg_i'] is None else tok['head']['seg_i']} ({html.escape(tok['head']['text'])})</td>"
            f"<td>{children_str}</td></tr>"
        )
    segs_html = ""
    if segments is not None:
        segs_html = (
            "<p><strong>Segments:</strong> " + " | ".join(html.escape(s) for s in segments) + "</p>"
        )
        if segments_used is not None and segments_used != segments:
            segs_html += (
                "<p><strong>Segments used for spaCy:</strong> "
                + " | ".join(html.escape(s) for s in segments_used)
                + "</p>"
            )

    # Sentence boundaries as predicted by spaCy (doc.sents).
    # Note: if the loaded model wasn't trained/configured for sentence segmentation,
    # it may return a single sentence spanning the whole doc.
    sents_html = ""
    try:
        sent_lines = []
        sents = list(doc.sents)
        for si, sent in enumerate(sents):
            start_i = int(sent.start)
            end_i = int(sent.end)  # exclusive
            seg_start_i = (
                doc2seg[start_i] if doc2seg is not None and start_i < len(doc2seg) else None
            )
            seg_end_i = (
                doc2seg[end_i - 1] if doc2seg is not None and end_i - 1 < len(doc2seg) else None
            )
            seg_part = ""
            if seg_start_i is not None or seg_end_i is not None:
                seg_part = f" (seg {'' if seg_start_i is None else seg_start_i}..{'' if seg_end_i is None else seg_end_i})"
            sent_lines.append(
                f"<li><strong>{si + 1}.</strong> [{start_i},{end_i}){seg_part} {html.escape(sent.text)}</li>"
            )

        note = ""
        if len(sents) <= 1:
            note = "<p><em>Note: spaCy model returned 1 sentence for this input.</em></p>"

        if sent_lines:
            sents_html = (
                "<h3>Sentence Segmentation (spaCy)</h3>"
                + note
                + "<ol>"
                + "".join(sent_lines)
                + "</ol>"
            )
        else:
            sents_html = "<h3>Sentence Segmentation (spaCy)</h3><p>(no sentences returned)</p>"
    except Exception:
        sents_html = "<h3>Sentence Segmentation</h3><p>(sentence segmentation unavailable)</p>"

    vis_url = "/debug/displacy?q=" + urllib.parse.quote_plus(raw_q)
    if use_raw:
        vis_url += "&raw=1"
    if stanza_seg_param:
        vis_url += "&stanza_segmenter=1"
    if merge_greedy_param:
        vis_url += "&merge_greedy=" + urllib.parse.quote_plus(merge_greedy_param)
    if model_override:
        vis_url += "&model=" + urllib.parse.quote_plus(model_override)
    vis_html = f'<p><a href="{html.escape(vis_url)}" target="_blank" rel="noopener">Open displaCy dependency visualization</a></p>'
    # Dict POS override calculations (if available)
    override_html = ""
    try:
        override_nlp_for_debug = override_nlp or (parser.nlp if parser is not None else None)
        if (
            override_nlp_for_debug is not None
            and "dict_pos_override" in override_nlp_for_debug.pipe_names
        ):
            override_pipe = override_nlp_for_debug.get_pipe("dict_pos_override")
            calc_rows = []
            for t in doc:
                try:
                    dbg = override_pipe.debug_token(t)  # type: ignore[attr-defined]
                except Exception:
                    dbg = {}
                allowed = dbg.get("allowed") or []
                subword_scores = dbg.get("subword_scores") or {}
                spacy_raw_scaled = dbg.get("spacy_raw_scaled") or {}  # ALL POS scaled by max
                spacy_scaled_scores = dbg.get("spacy_scaled_scores") or {}  # Filtered to allowed
                blended_scores = dbg.get("blended_scores") or {}
                constraint_type = dbg.get("constraint_type", "hard")
                source = dbg.get("source") or ""
                fills = dbg.get("fills") or []
                subwords = dbg.get("subwords") or []
                subwords2 = dbg.get("subwords_level2") or []
                sub_debug = dbg.get("subword_debug") or []
                subword_context = dbg.get("subword_context") or {}
                context_prev = subword_context.get("prev") or ""
                context_next = subword_context.get("next") or ""
                context_str = ""
                if context_prev or context_next:
                    context_str = f"{context_prev} | {context_next}"

                # Format all score types
                allowed_str = ", ".join(allowed) if allowed else ""
                constraint_str = constraint_type

                # spaCy raw scaled (ALL POS, max=1.0 for debugging)
                if spacy_raw_scaled:
                    parts = [
                        f"{k}:{spacy_raw_scaled[k]:.3f}" for k in sorted(spacy_raw_scaled.keys())
                    ]
                    spacy_raw_str = " | ".join(parts)
                else:
                    spacy_raw_str = "(none)"

                # spaCy scaled scores (filtered to allowed, NO second scaling)
                if spacy_scaled_scores:
                    parts = [
                        f"{k}:{spacy_scaled_scores[k]:.3f}"
                        for k in sorted(spacy_scaled_scores.keys())
                    ]
                    spacy_scaled_str = " | ".join(parts)
                else:
                    spacy_scaled_str = "(none)"

                # Subword scores (from decomposition, scaled max=1.0)
                if subword_scores:
                    parts = [f"{k}:{subword_scores[k]:.3f}" for k in sorted(subword_scores.keys())]
                    subword_str = " | ".join(parts)
                else:
                    subword_str = "(none)"

                # Blended scores (50/50 blend for multi-component, else = spaCy scaled)
                if blended_scores:
                    parts = [f"{k}:{blended_scores[k]:.3f}" for k in sorted(blended_scores.keys())]
                    blended_str = " | ".join(parts)
                else:
                    blended_str = "(none)"

                # Only show fills/subwords for multi-fill or decomposed cases
                # Skip for single exact matches (trust spaCy's morphologizer)
                show_breakdown = (
                    len(fills) > 1  # Multiple dictionary fills
                    or subwords  # Decomposition occurred
                    or "decomposed" in source  # Explicitly decomposed (e.g., Pali word)
                    or "multi_fill" in source  # Compound with all valid POS (50/50 blend)
                )

                if show_breakdown and fills:
                    fparts = [
                        f"{html.escape(f.get('head', ''))}:{html.escape(f.get('pos', ''))}"
                        for f in fills
                    ]
                    fills_str = " | ".join(fparts)
                else:
                    fills_str = ""
                if show_breakdown and subwords:
                    sparts = [
                        f"{html.escape(s.get('head', ''))}:{html.escape(s.get('pos', ''))}"
                        for s in subwords
                    ]
                    subwords_str = " | ".join(sparts)
                else:
                    subwords_str = ""
                if show_breakdown and subwords2:
                    sparts2 = [
                        f"{html.escape(s.get('head', ''))}:{html.escape(s.get('pos', ''))}"
                        for s in subwords2
                    ]
                    subwords2_str = " | ".join(sparts2)
                else:
                    subwords2_str = ""
                # Color-code constraint type
                constraint_color = "green" if constraint_str == "hard" else "orange"
                constraint_display = f"<span style='color:{constraint_color};font-weight:bold;'>{constraint_str}</span>"

                calc_rows.append(
                    f"<tr><td>{t.i}</td><td>{html.escape(t.text)}</td>"
                    f"<td>{html.escape(source)}</td>"
                    f"<td>{constraint_display}</td>"
                    f"<td>{html.escape(allowed_str)}</td>"
                    f"<td>{html.escape(spacy_raw_str)}</td>"
                    f"<td>{html.escape(spacy_scaled_str)}</td>"
                    f"<td>{html.escape(subword_str)}</td>"
                    f"<td>{html.escape(blended_str)}</td>"
                    f"<td>{html.escape(fills_str)}</td>"
                    f"<td>{html.escape(subwords_str)}</td>"
                    f"<td>{html.escape(context_str)}</td></tr>"
                )
                # Only show detailed subword debug when breakdown is relevant
                if show_breakdown and sub_debug:
                    sub_rows = []
                    for sd in sub_debug:
                        s_allowed = ", ".join(sd.get("allowed") or [])
                        s_pos_scores = sd.get("pos_scores") or {}

                        if s_pos_scores:
                            # Decomposed: show individual morphologizer scores for each subword
                            score_parts = [
                                f"{k}:{s_pos_scores[k]:.3f}" for k in sorted(s_pos_scores.keys())
                            ]
                            s_scores_str = " | ".join(score_parts)
                        else:
                            # Single component: just show allowed
                            s_scores_str = ""

                        sub_rows.append(
                            f"<tr><td>{html.escape(sd.get('text', ''))}</td>"
                            f"<td>{html.escape(s_allowed)}</td>"
                            f"<td>{html.escape(s_scores_str)}</td></tr>"
                        )

                    # Column header depends on whether we have individual scores
                    has_pos_scores = any(sd.get("pos_scores") for sd in sub_debug)
                    col_header = "pos_scores (morphologizer)" if has_pos_scores else "allowed"

                    subtable = (
                        "<table>"
                        "<tr><th>subword</th><th>allowed</th><th>"
                        + col_header
                        + "</th></tr>"
                        + "".join(sub_rows)
                        + "</table>"
                    )
                    calc_rows.append(f'<tr><td colspan="12">{subtable}</td></tr>')
            if calc_rows:
                override_html = (
                    "<h3>Dict POS Override Calculations</h3>"
                    "<p><em><strong>Hard constraints</strong>: All tokens use hard constraints (must be in allowed set).<br>"
                    "<strong>Single-component</strong>: spaCy raw logits scaled once (max=1.0), filtered to allowed POS without re-scaling.<br>"
                    "<strong>Multi-component</strong>: Fixed 50/50 blend of spaCy (filtered, not re-scaled) + subword scaled. No softmax, no normalization after blending.</em></p>"
                    "<table style='font-size:12px;'>"
                    "<tr><th>doc_i</th><th>text</th><th>source</th><th>constraint</th><th>allowed</th><th>spacy_raw_all</th><th>spacy_filtered</th><th>subword_scaled</th><th>blended</th><th>fills</th><th>subwords</th><th>subword_ctx</th></tr>"
                    + "".join(calc_rows)
                    + "</table>"
                )
    except Exception:
        override_html = ""

    html_page = f"""<!DOCTYPE html>
<html lang="my">
<head>
  <meta charset="utf-8">
  <title>UD Parser Debug</title>
  <style>
    body {{ font-family: system-ui, sans-serif; padding: 16px; line-height: 1.5; }}
    input[type=text] {{ width: 100%; font-size: 16px; padding: 6px; }}
    table {{ border-collapse: collapse; width: 100%; }}
    th, td {{ border: 1px solid #ddd; padding: 6px; text-align: left; }}
    th {{ background: #f4f4f4; }}
  </style>
</head>
<body>
  <h2>UD Parser Debug</h2>
  <p><strong>Mode:</strong> {mode}</p>
  <form method="get" action="/debug/parser">
    <label><strong>q</strong></label><br>
    <input type="text" name="q" value="{html.escape(raw_q)}"/><br><br>
    <label><strong>model</strong> (optional spaCy name/path)</label><br>
    <input type="text" name="model" value="{html.escape(model_override)}"/><br><br>
    <label><input type="checkbox" name="raw" value="1" {"checked" if use_raw else ""}/> raw</label><br>
    <label><input type="checkbox" name="stanza_segmenter" value="1" {"checked" if stanza_seg_param else ""}/> use stanza tokenizer</label><br>
    <button type="submit">Run</button>
  </form>
  <p><strong>Model:</strong> {html.escape(model_override) if model_override else "(default UD parser)"}{" <em>(" + html.escape(override_err) + ")</em>" if override_err else ""}</p>
  {vis_html}
  {segs_html}
  {sents_html}
  <table>
    <tr><th>doc_i</th><th>seg_i</th><th>text</th><th>upos</th><th>tag</th><th>dep</th><th>head (doc/seg)</th><th>children</th></tr>
    {"".join(rows)}
  </table>
  {override_html}
</body>
</html>"""
    return Response(html_page, mimetype="text/html; charset=utf-8")


@app.route("/debug/displacy", methods=["GET"])
def debug_displacy_route():
    return jsonify({"ok": False, "error": "debug_disabled"}), 404
    """
    Render spaCy's displaCy dependency visualizer for a query string.
    Mirrors /lookup normalization + segmentation unless raw=1.
    Always returns HTML.
    Query params:
      q=...   (required)
      raw=1   (optional, bypass segmentation and parse raw text)
      stanza_segmenter=1 (optional, use stanza tokenizer)
    """
    raw_q = (request.args.get("q") or "").strip()
    if not raw_q:
        return jsonify({"ok": False, "error": "missing query parameter 'q'"}), 400

    merge_greedy_param = (request.args.get("merge_greedy") or "").strip().lower()
    stanza_seg_param = str(request.args.get("stanza_segmenter") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    model_override = (request.args.get("model") or "").strip()

    parser = None
    override_nlp = None
    if model_override:
        try:
            import spacy  # type: ignore

            global _DEBUG_SPACY_MODEL_CACHE  # type: ignore
            try:
                _DEBUG_SPACY_MODEL_CACHE  # type: ignore[name-defined]
            except Exception:
                _DEBUG_SPACY_MODEL_CACHE = {}  # type: ignore[name-defined]

            cache = _DEBUG_SPACY_MODEL_CACHE  # type: ignore[name-defined]
            if model_override not in cache:
                cache[model_override] = spacy.load(model_override)
            override_nlp = cache[model_override]
        except Exception as e:
            return jsonify({"ok": False, "error": f"spacy_load_failed:{type(e).__name__}:{e}"}), 400
    else:
        parser = init_ud_parser()
        if parser is None:
            return jsonify({"ok": False, "error": "ud_disabled"}), 503

    use_raw = str(request.args.get("raw") or "").lower() in {"1", "true", "yes", "raw"}

    # Build docs (one sentence at a time) so the visualization doesn't cross sentence boundaries.
    docs = []
    segments = None
    segments_used = None

    try:
        from spacy import displacy  # type: ignore
    except Exception as e:
        return jsonify(
            {"ok": False, "error": f"spacy_displacy_unavailable:{type(e).__name__}:{e}"}
        ), 500

    if use_raw:
        if override_nlp is not None:
            doc = override_nlp(raw_q)
        else:
            doc = parser.nlp(raw_q)
        docs = list(doc.sents) or [doc]
    else:
        norm = normalize_burmese_for_segmentation(raw_q)
        segments = segment_with_pipeline(norm)

        kept_words: list[str] = []
        for tok in segments:
            if _is_spacy_clean_token(tok):
                kept_words.append(tok)
        segments_used = kept_words

        if override_nlp is not None:
            from spacy.tokens import Doc  # type: ignore

            doc = Doc(
                override_nlp.vocab,
                words=kept_words,
                spaces=[True] * (len(kept_words) - 1) + [False] if kept_words else [],
            )
            if len(doc):
                doc[0].is_sent_start = True
            doc = override_nlp(doc)
        else:
            doc = parser._Doc(
                parser.nlp.vocab,
                words=kept_words,
                spaces=[True] * (len(kept_words) - 1) + [False] if kept_words else [],
            )
            if len(doc):
                doc[0].is_sent_start = True
            doc = parser.nlp(doc)

        docs = list(doc.sents) or [doc]

    if not docs:
        msg = "<p>No tokens were passed to spaCy (all tokens were filtered out).</p>"
        return Response(
            "<!doctype html><meta charset='utf-8'><title>displaCy</title>" + msg,
            mimetype="text/html; charset=utf-8",
        )

    options = {
        "compact": True,
        "distance": 90,
        "bg": "#ffffff",
        "color": "#111827",
        "font": "Noto Sans Myanmar, Myanmar Text, system-ui, sans-serif",
    }

    # Render HTML fragment and wrap in a simple page that includes the segments used.
    rendered = displacy.render(docs, style="dep", options=options, page=False)

    segs_html = ""
    if segments is not None:
        segs_html = "<details open><summary><strong>Segments</strong></summary><div style='margin-top:6px;font-size:12px;line-height:1.6;white-space:pre-wrap;'>"
        segs_html += html.escape(" | ".join(segments))
        segs_html += "</div></details>"
        if segments_used is not None:
            segs_html += "<details><summary><strong>Segments used for spaCy</strong></summary><div style='margin-top:6px;font-size:12px;line-height:1.6;white-space:pre-wrap;'>"
            segs_html += html.escape(" | ".join(segments_used))
            segs_html += "</div></details>"

    page = f"""<!DOCTYPE html>
<html lang="my">
<head>
  <meta charset="utf-8">
  <title>displaCy Dependencies</title>
  <style>
    body {{ font-family: system-ui, sans-serif; padding: 16px; }}
    details {{ margin: 10px 0; }}
    summary {{ cursor: pointer; }}
  </style>
</head>
<body>
  <h2>displaCy Dependencies</h2>
  {segs_html}
  <div style="margin-top:14px;">{rendered}</div>
</body>
</html>"""
    return Response(page, mimetype="text/html; charset=utf-8")


@app.route("/segment_text", methods=["GET"])
def segment_text():
    """
    HTML segmentation endpoint for quick debugging.
    Takes the FULL q string, drops non-Myanmar with
    normalize_burmese_for_segmentation, and segments it.
    Unknown tokens are highlighted (red + bracketed),
    and any whitespace is removed before segmentation.
    """
    raw_q = request.args.get("q", "")
    if raw_q is None:
        return Response(
            "ERROR: missing query parameter 'q'\n",
            status=400,
            mimetype="text/plain; charset=utf-8",
        )
    extended_hits = set()
    q = normalize_burmese_for_segmentation(raw_q, extended_hits=extended_hits)
    # After normalization + stripping, if there's literally no Myanmar left, complain
    if not q:
        return Response(
            "ERROR: query contains no Burmese text after normalization\n",
            status=400,
            mimetype="text/plain; charset=utf-8",
        )
    segments = segment_with_pipeline(q)
    # Build HTML with red + bracketed unknowns
    pieces = []
    for i, seg in enumerate(segments):
        if i > 0:
            pieces.append('<span class="seg-sep"> | </span>')
        escaped = html.escape(seg)
        if normalize_headword(seg) in DICT:
            # known token: normal
            pieces.append(f'<span class="seg-known">{escaped}</span>')
        else:
            # unknown token: bracketed + red
            pieces.append(f'<span class="seg-unknown">[[{escaped}]]</span>')
    body_html = "".join(pieces)
    page_html = f"""<!DOCTYPE html>
<html lang="my">
<head>
  <meta charset="utf-8">
  <title>Segmentation Debug</title>
  <style>
    body {{
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.6;
      padding: 16px;
      white-space: pre-wrap;
    }}
    .seg-known {{
      color: inherit;
    }}
    .seg-unknown {{
      color: #c00000;  /* red, no underline */
    }}
    .seg-sep {{
      color: #888888;
    }}
  </style>
</head>
<body>
  <div>{body_html}</div>
</body>
</html>
"""
    return Response(page_html, mimetype="text/html; charset=utf-8")


@app.route("/segment_debug", methods=["GET"])
def segment_debug():
    """
    Debug endpoint: run the new segmenter and return cost breakdown.
    """
    raw_q = request.args.get("q", "").strip()
    if not raw_q:
        return jsonify({"ok": False, "error": "missing query parameter 'q'"}), 400
    q = normalize_burmese_for_segmentation(raw_q)
    if not q or not contains_burmese(q):
        return jsonify(
            {"ok": False, "error": "query contains no Burmese text after normalization"}
        ), 400
    debug_data = _segment_by_clusters_dp_debug(q)
    payload = {
        "ok": True,
        "q": q,
        "segments": debug_data["segments"],
        "clusters": debug_data["clusters"],
        "starts": debug_data["starts"],
        "cluster_ends": debug_data["cluster_ends"],
        "dp_cost": debug_data["dp_cost"],
        "next_idx": debug_data["next_idx"],
        "first_word": debug_data["first_word"],
        "events": debug_data["events"],
        "candidates": debug_data.get("candidates", []),
    }
    return Response(
        json.dumps(payload, ensure_ascii=False),
        mimetype="application/json; charset=utf-8",
    )


@app.route("/debug/dict_check", methods=["GET"])
def debug_dict_check():
    """
    Debug endpoint: inspect codepoints + dictionary visibility for a string.
    Params:
        q: input text
    """
    raw = request.args.get("q", "") or ""
    seg_inst = get_segmenter_instance()

    def _uinfo(s: str) -> dict:
        return {
            "text": s,
            "unicode_escape": s.encode("unicode_escape").decode("ascii"),
            "codepoints": [f"U+{ord(c):04X}" for c in s],
        }

    norm = normalize_headword(raw)
    norm_info = _uinfo(norm)

    dp_segments = seg_inst.segment(raw) if raw else []
    dp_info = []
    for seg in dp_segments:
        entry = seg_inst.dictionary.lookup(seg)
        dp_info.append(
            {
                **_uinfo(seg),
                "dict_known": bool(entry),
                "dict_source": entry.source if entry else None,
            }
        )

    # Try the full pipeline (stanza -> DP -> merge). Falls back if stanza unavailable.
    try:
        pipe_segments = segment_with_pipeline(raw) if raw else []
    except Exception:
        pipe_segments = []
    pipe_info = [_uinfo(seg) for seg in pipe_segments]

    out = {
        "raw": _uinfo(raw),
        "normalized_headword": norm_info,
        "normalized_in_dict": bool(norm and norm in DICT),
        "dp_segments": dp_info,
        "pipeline_segments": pipe_info,
    }
    return jsonify(out)


@app.route("/subsegments", methods=["GET"])
def subsegments():
    """
    Lazily decompose a single word into inner pieces.
    Used by the UI when the user hovers a word in the popup.
    Params:
        token: the Burmese word/segment to decompose
    """
    raw = request.args.get("token", "") or ""
    token = normalize_burmese(raw.strip())
    if not token:
        return jsonify({"ok": False, "error": "missing token"}), 400
    if not contains_burmese(token):
        return jsonify({"ok": False, "error": "token contains no Burmese"}), 400
    token_norm = normalize_headword(token)
    # Decide which splitter to use
    if token_norm in DICT:
        mode = "known"
        subs = _decompose_known_head_into_subwords(token)
    else:
        mode = "unknown"
        subs = _split_unknown_into_subsegments(token)
        # If empty (single-syllable unknown), create a minimal entry with g2p
        if not subs:
            g2p_data = g2p_explain_for_ui(token)
            roman = ""
            if g2p_data and g2p_data.get("syllables"):
                roman = " ".join(
                    s.get("roman", "") for s in g2p_data["syllables"] if s.get("roman")
                )
            subs = [
                {
                    "head": token,
                    "roman": roman,
                    "pos": "unknown",
                    "senses": ["[no dictionary entry found for this segment]"],
                    "g2p": g2p_data,
                }
            ]
    return jsonify(
        {
            "ok": True,
            "mode": mode,
            "head": token,
            "subsegments": subs or [],  # list of {head, roman, pos, senses, g2p}
        }
    )


@app.route("/debug/pos", methods=["GET"])
def debug_pos():
    """
    Debug POS scoring for word(s).
    Query params:
        word - Single word to analyze, OR
        text - Multiple words/sentence to analyze
        prev_pos - Previous word's POS for context (only for single word)
        format - 'json' (default) or 'html'
    Examples:
        Single word:
            /debug/pos?word=က
            /debug/pos?word=က&prev_pos=n
            /debug/pos?word=မှာ&prev_pos=v&format=html
        Multiple words (sentence):
            /debug/pos?text=သူ က စား နေ တယ်
            /debug/pos?text=သူ က စား နေ တယ်&format=html
    """
    if POS_TAGGER is None:
        return jsonify({"error": "POS tagger not initialized"}), 500
    # Check if analyzing a sentence (text) or single word
    text = request.args.get("text", "").strip()
    word = request.args.get("word", "").strip()
    if not text and not word:
        return jsonify({"error": "Missing 'word' or 'text' parameter"}), 400
    output_format = request.args.get("format", "json").lower()
    # Multi-word analysis (sentence)
    if text:
        debug_info = _debug_pos_sentence(text)
        if output_format == "json":
            return jsonify(debug_info)
        elif output_format == "html":
            html = _render_pos_sentence_debug_html(debug_info)
            return Response(html, mimetype="text/html; charset=utf-8")
        else:
            return jsonify({"error": f"Unknown format: {output_format}"}), 400
    # Single word analysis
    else:
        prev_pos = request.args.get("prev_pos", "").strip() or None
        debug_info = POS_TAGGER.debug_score_word(word, prev_pos=prev_pos)
        if output_format == "json":
            return jsonify(debug_info)
        elif output_format == "html":
            html = _render_pos_debug_html(debug_info)
            return Response(html, mimetype="text/html; charset=utf-8")
        else:
            return jsonify({"error": f"Unknown format: {output_format}"}), 400


def _debug_pos_sentence(text: str) -> dict:
    """
    Analyze POS scoring for each word in a sentence.
    Returns detailed debug info showing how each word is scored
    in context of the previous word's POS.
    """
    # Split into words
    words = text.split()
    # Create tokens with POS tags from corpus/dict
    tokens = []
    for word in words:
        # Get all possible POS from corpus
        pos_tags = POS_TAGGER.stats.get_all_pos_for_word(word)
        # If not in corpus, check dictionary
        if not pos_tags and DICT_POS_LOOKUP:
            pos_tags = DICT_POS_LOOKUP.get(word, set())
        # Create token with all possible POS (pipe-separated if multiple)
        pos_str = "|".join(sorted(pos_tags)) if pos_tags else ""
        tokens.append({"word": word, "pos": pos_str})
    # Tag the sequence
    tagged = POS_TAGGER.tag_tokens(tokens, DICT_POS_LOOKUP)
    # Get detailed debug info for each word
    results = []
    prev_pos = None
    for i, token in enumerate(tagged):
        word = token["word"]
        chosen_pos = token.get("pos")
        pos_probs = token.get("pos_probs", {})
        # Get full debug breakdown
        candidates = POS_TAGGER.stats.get_all_pos_for_word(word)
        if not candidates and DICT_POS_LOOKUP:
            candidates = DICT_POS_LOOKUP.get(word, set())
        if candidates:
            debug = POS_TAGGER.debug_score_word(word, prev_pos=prev_pos, candidates=candidates)
        else:
            debug = {
                "word": word,
                "prev_pos": prev_pos,
                "error": "Word not found in corpus or dictionary",
                "candidates": [],
            }
        # Add tagging result
        debug["chosen_pos"] = chosen_pos
        debug["position"] = i
        debug["original_candidates"] = sorted(candidates) if candidates else []
        results.append(debug)
        prev_pos = chosen_pos
    return {
        "text": text,
        "words": words,
        "word_count": len(words),
        "results": results,
    }


def _render_pos_debug_html(debug_info: dict) -> str:
    """Render POS debug info as HTML."""
    if "error" in debug_info:
        return f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>POS Debug - Error</title>
            <style>
                body {{ font-family: 'Segoe UI', Arial, sans-serif; margin: 40px; background: #f5f5f5; }}
                .error {{ background: #ffebee; border: 1px solid #c62828; padding: 20px; border-radius: 4px; }}
            </style>
        </head>
        <body>
            <div class="error">
                <h2>Error</h2>
                <p>{html.escape(debug_info["error"])}</p>
            </div>
        </body>
        </html>
        """
    word = debug_info["word"]
    prev_pos = debug_info.get("prev_pos")
    # Build HTML
    html_output = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>POS Debug: {html.escape(word)}</title>
        <style>
            body {{
                font-family: 'Segoe UI', Arial, sans-serif;
                margin: 40px;
                background: #f5f5f5;
            }}
            .container {{
                max-width: 900px;
                margin: 0 auto;
                background: white;
                padding: 30px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }}
            h1 {{
                color: #1976d2;
                border-bottom: 3px solid #1976d2;
                padding-bottom: 10px;
            }}
            h2 {{
                color: #424242;
                margin-top: 30px;
                border-bottom: 1px solid #e0e0e0;
                padding-bottom: 5px;
            }}
            .word {{
                font-size: 2em;
                font-weight: bold;
                color: #d32f2f;
            }}
            .context {{
                background: #e3f2fd;
                padding: 10px 15px;
                border-left: 4px solid #1976d2;
                margin: 10px 0;
            }}
            table {{
                width: 100%;
                border-collapse: collapse;
                margin: 15px 0;
            }}
            th {{
                background: #424242;
                color: white;
                padding: 12px;
                text-align: left;
            }}
            td {{
                padding: 10px 12px;
                border-bottom: 1px solid #e0e0e0;
            }}
            .bar {{
                background: #4caf50;
                height: 20px;
                border-radius: 3px;
                display: inline-block;
            }}
            .winner {{
                background: #fff9c4;
                font-weight: bold;
            }}
            .badge {{
                display: inline-block;
                padding: 4px 8px;
                border-radius: 3px;
                font-size: 0.9em;
                font-weight: bold;
                background: #e0e0e0;
            }}
            .badge.winner {{
                background: #ffd54f;
                color: #f57c00;
            }}
            .formula {{
                background: #f5f5f5;
                padding: 10px;
                border-left: 3px solid #9e9e9e;
                font-family: monospace;
                margin: 10px 0;
            }}
            .candidates {{
                background: #e8f5e9;
                padding: 10px;
                border-radius: 4px;
                margin: 10px 0;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🔍 POS Debug Analysis</h1>
            <div style="margin: 20px 0;">
                <span class="word">{html.escape(word)}</span>
            </div>
    """
    if prev_pos:
        pos_label = POS_DISPLAY_LABELS.get(prev_pos, prev_pos.upper())
        html_output += f"""
            <div class="context">
                <strong>Context:</strong> Word appears after <strong>{prev_pos.upper()}</strong> ({pos_label})
            </div>
        """
    html_output += f"""
            <div class="candidates">
                <strong>Candidate POS tags:</strong> {", ".join(debug_info["candidates"])}
            </div>
            <h2>📊 Unigram Probabilities</h2>
            <p><em>P(pos | word) — "What POS is this word overall?"</em></p>
    """
    uni = debug_info["unigram"]
    html_output += f"<p>Total corpus occurrences: <strong>{uni['total_count']}</strong></p>"
    html_output += (
        "<table><tr><th>POS</th><th>Probability</th><th>Count</th><th>Distribution</th></tr>"
    )
    for pos, prob in sorted(uni["probabilities"].items(), key=lambda x: -x[1]):
        count = uni["raw_counts"].get(pos, 0)
        bar_width = int(prob * 300)
        pos_label = POS_DISPLAY_LABELS.get(pos, pos.upper())
        html_output += f"""
            <tr>
                <td><strong>{pos}</strong> ({pos_label})</td>
                <td>{prob:.4f} ({prob * 100:.1f}%)</td>
                <td>{count}</td>
                <td><div class="bar" style="width: {bar_width}px;"></div></td>
            </tr>
        """
    html_output += "</table>"
    # POS-Bigram section
    if debug_info.get("pos_bigram"):
        bi = debug_info["pos_bigram"]
        html_output += f"""
            <h2>📊 POS-Bigram Probabilities</h2>
            <p><em>{html.escape(bi["question"])}</em></p>
            <p>Total bigram occurrences: <strong>{bi["total_count"]}</strong></p>
        """
        if bi["probabilities"]:
            html_output += "<table><tr><th>POS</th><th>Probability</th><th>Count</th><th>Distribution</th></tr>"
            for pos, prob in sorted(bi["probabilities"].items(), key=lambda x: -x[1]):
                count = bi["raw_counts"].get(pos, 0)
                bar_width = int(prob * 300)
                pos_label = POS_DISPLAY_LABELS.get(pos, pos.upper())
                html_output += f"""
                    <tr>
                        <td><strong>{pos}</strong> ({pos_label})</td>
                        <td>{prob:.4f} ({prob * 100:.1f}%)</td>
                        <td>{count}</td>
                        <td><div class="bar" style="width: {bar_width}px;"></div></td>
                    </tr>
                """
            html_output += "</table>"
        else:
            html_output += "<p><em>(No bigram data available for this context)</em></p>"
    # Final scores
    final = debug_info["final_scores"]
    html_output += f"""
        <h2>🎯 Final Scores</h2>
        <div class="formula">Formula: {html.escape(final["formula"])}</div>
        <table>
            <tr><th>POS</th><th>Final Score</th><th>Distribution</th><th>Status</th></tr>
    """
    for pos, prob in final["probabilities"].items():
        bar_width = int(prob * 300)
        pos_label = POS_DISPLAY_LABELS.get(pos, pos.upper())
        row_class = "winner" if pos == final["winner"] else ""
        badge = '<span class="badge winner">WINNER</span>' if pos == final["winner"] else ""
        html_output += f"""
            <tr class="{row_class}">
                <td><strong>{pos}</strong> ({pos_label})</td>
                <td>{prob:.4f} ({prob * 100:.1f}%)</td>
                <td><div class="bar" style="width: {bar_width}px;"></div></td>
                <td>{badge}</td>
            </tr>
        """
    html_output += """
            </table>
            <div style="margin-top: 40px; padding: 20px; background: #f5f5f5; border-radius: 4px;">
                <h3>Try Different Contexts:</h3>
                <p>
    """
    # Add links to try different contexts
    for pos in ["n", "v", "pron", "adj", "adv", "ppm", "part"]:
        pos_label = POS_DISPLAY_LABELS.get(pos, pos.upper())
        html_output += f'<a href="/debug/pos?word={word}&prev_pos={pos}&format=html" style="margin-right: 10px; padding: 5px 10px; background: white; border: 1px solid #ccc; border-radius: 3px; text-decoration: none;">After {pos.upper()} ({pos_label})</a> '
    html_output += """
                </p>
            </div>
        </div>
    </body>
    </html>
    """
    return html_output


def _render_pos_sentence_debug_html(debug_info: dict) -> str:
    """Render sentence POS debug info as HTML."""
    text = debug_info["text"]
    results = debug_info["results"]
    html_output = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>POS Debug: {html.escape(text)}</title>
        <style>
            body {{
                font-family: 'Segoe UI', Arial, sans-serif;
                margin: 20px;
                background: #f5f5f5;
            }}
            .container {{
                max-width: 1200px;
                margin: 0 auto;
                background: white;
                padding: 30px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }}
            h1 {{
                color: #1976d2;
                border-bottom: 3px solid #1976d2;
                padding-bottom: 10px;
            }}
            .sentence {{
                font-size: 1.8em;
                padding: 20px;
                background: #e3f2fd;
                border-left: 5px solid #1976d2;
                margin: 20px 0;
                font-weight: bold;
            }}
            .word-card {{
                background: #fafafa;
                border: 1px solid #e0e0e0;
                border-radius: 6px;
                padding: 20px;
                margin: 20px 0;
                position: relative;
            }}
            .word-card.has-context {{
                border-left: 4px solid #4caf50;
            }}
            .word-header {{
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 15px;
                padding-bottom: 10px;
                border-bottom: 2px solid #e0e0e0;
            }}
            .word-text {{
                font-size: 2em;
                font-weight: bold;
                color: #d32f2f;
            }}
            .position-badge {{
                background: #757575;
                color: white;
                padding: 5px 15px;
                border-radius: 20px;
                font-size: 0.9em;
            }}
            .context-info {{
                background: #e8f5e9;
                padding: 10px 15px;
                border-left: 3px solid #4caf50;
                margin: 10px 0;
                font-size: 0.95em;
            }}
            .winner-badge {{
                display: inline-block;
                background: #ffd54f;
                color: #f57c00;
                padding: 8px 16px;
                border-radius: 4px;
                font-weight: bold;
                font-size: 1.2em;
                margin: 10px 0;
            }}
            table {{
                width: 100%;
                border-collapse: collapse;
                margin: 15px 0;
                font-size: 0.9em;
            }}
            th {{
                background: #424242;
                color: white;
                padding: 10px;
                text-align: left;
                font-size: 0.85em;
            }}
            td {{
                padding: 8px 10px;
                border-bottom: 1px solid #e0e0e0;
            }}
            .bar {{
                background: #4caf50;
                height: 18px;
                border-radius: 3px;
                display: inline-block;
            }}
            .section-title {{
                color: #1976d2;
                font-weight: bold;
                margin-top: 15px;
                margin-bottom: 8px;
                font-size: 1.1em;
            }}
            .no-data {{
                color: #757575;
                font-style: italic;
                padding: 10px;
                background: #f5f5f5;
                border-radius: 4px;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🔍 Sentence POS Analysis</h1>
            <div class="sentence">{html.escape(text)}</div>
            <p><strong>Total words:</strong> {debug_info["word_count"]}</p>
    """
    # Render each word
    for result in results:
        word = result["word"]
        position = result["position"]
        prev_pos = result.get("prev_pos")
        chosen_pos = result.get("chosen_pos")
        has_context = prev_pos is not None
        context_class = "has-context" if has_context else ""
        html_output += f"""
            <div class="word-card {context_class}">
                <div class="word-header">
                    <span class="word-text">{html.escape(word)}</span>
                    <span class="position-badge">Word #{position + 1}</span>
                </div>
        """
        if has_context:
            pos_label = POS_DISPLAY_LABELS.get(prev_pos, prev_pos.upper())
            html_output += f"""
                <div class="context-info">
                    ⚡ <strong>Context:</strong> Appears after <strong>{prev_pos.upper()}</strong> ({pos_label})
                </div>
            """
        if "error" in result:
            html_output += f"""
                <div class="no-data">❌ {html.escape(result["error"])}</div>
            """
        else:
            # Show chosen POS
            if chosen_pos:
                pos_label = POS_DISPLAY_LABELS.get(chosen_pos, chosen_pos.upper())
                html_output += f"""
                    <div class="winner-badge">
                        ✓ Tagged as: {chosen_pos.upper()} ({pos_label})
                    </div>
                """
            # Unigram probabilities
            if result.get("unigram"):
                uni = result["unigram"]
                html_output += f"""
                    <div class="section-title">📊 Unigram: P(pos | word)</div>
                    <table>
                        <tr><th>POS</th><th>Probability</th><th>Count</th><th>Distribution</th></tr>
                """
                for pos, prob in sorted(uni["probabilities"].items(), key=lambda x: -x[1])[
                    :5
                ]:  # Top 5
                    count = uni["raw_counts"].get(pos, 0)
                    bar_width = int(prob * 200)
                    pos_label = POS_DISPLAY_LABELS.get(pos, pos.upper())
                    html_output += f"""
                        <tr>
                            <td><strong>{pos}</strong> ({pos_label})</td>
                            <td>{prob:.4f}</td>
                            <td>{count}</td>
                            <td><div class="bar" style="width: {bar_width}px;"></div></td>
                        </tr>
                    """
                html_output += "</table>"
            # POS-bigram probabilities
            if result.get("pos_bigram"):
                bi = result["pos_bigram"]
                html_output += f"""
                    <div class="section-title">📊 POS-Bigram: P(pos | prev_pos, word)</div>
                    <p style="font-size: 0.9em; color: #666;"><em>{html.escape(bi["question"])}</em></p>
                """
                if bi["probabilities"]:
                    html_output += """
                        <table>
                            <tr><th>POS</th><th>Probability</th><th>Count</th><th>Distribution</th></tr>
                    """
                    for pos, prob in sorted(bi["probabilities"].items(), key=lambda x: -x[1])[
                        :5
                    ]:  # Top 5
                        count = bi["raw_counts"].get(pos, 0)
                        bar_width = int(prob * 200)
                        pos_label = POS_DISPLAY_LABELS.get(pos, pos.upper())
                        html_output += f"""
                            <tr>
                                <td><strong>{pos}</strong> ({pos_label})</td>
                                <td>{prob:.4f}</td>
                                <td>{count}</td>
                                <td><div class="bar" style="width: {bar_width}px;"></div></td>
                            </tr>
                        """
                    html_output += "</table>"
                else:
                    html_output += '<div class="no-data">No bigram data available</div>'
            # Final scores
            if result.get("final_scores"):
                final = result["final_scores"]
                html_output += f"""
                    <div class="section-title">🎯 Final Scores</div>
                    <p style="font-size: 0.9em; color: #666;"><em>Formula: {html.escape(final["formula"])}</em></p>
                    <table>
                        <tr><th>POS</th><th>Score</th><th>Distribution</th></tr>
                """
                for pos, prob in final["probabilities"].items():
                    bar_width = int(prob * 200)
                    pos_label = POS_DISPLAY_LABELS.get(pos, pos.upper())
                    winner_mark = " ✓" if pos == chosen_pos else ""
                    row_style = "background: #fff9c4;" if pos == chosen_pos else ""
                    html_output += f"""
                        <tr style="{row_style}">
                            <td><strong>{pos}</strong> ({pos_label}){winner_mark}</td>
                            <td>{prob:.4f}</td>
                            <td><div class="bar" style="width: {bar_width}px;"></div></td>
                        </tr>
                    """
                html_output += "</table>"
        html_output += "</div>"  # Close word-card
    html_output += """
        </div>
    </body>
    </html>
    """
    return html_output


@app.route("/debug/spell", methods=["GET", "POST"])
def debug_spell():
    """
    Debug endpoint with dual output:
    - Plain text (default / ?format=txt or no format):
        RAW, NORM, then one SEGMENTS line:
            tokens separated by " | "
            phrase boundaries separated by PHRASE_SEP (e.g. "--")
            unknowns as [[word]], optionally ANSI red in terminal
    - HTML (?format=html):
        RAW and NORM in <pre>, then one SEGMENTS paragraph:
            same separators, unknowns red via CSS
            then unknown list + suggestions in <pre>.
    """
    # 1) Input: POST body (for curl --data-binary "@file.txt") or ?q=
    raw_body = ""
    if request.method == "POST":
        raw_body = (request.get_data(as_text=True) or "").strip()
    if raw_body:
        raw_q = raw_body
    else:
        raw_q = (request.args.get("q", "") or "").strip()
    if not raw_q:
        msg = (
            "ERROR: missing input text. "
            'Use ?q=... or POST raw text (e.g. curl --data-binary "@file.txt").\n'
        )
        return Response(msg, status=400, mimetype="text/plain; charset=utf-8")
    # 2) Normalise for segmentation
    extended_hits = set()
    q = normalize_burmese_for_segmentation(raw_q, extended_hits=extended_hits)
    if not q:
        return Response(
            "ERROR: query contains no Burmese after normalization\n",
            status=400,
            mimetype="text/plain; charset=utf-8",
        )
    # 3) Segment whole input once (for unknown counting + context)
    segments = segment_with_pipeline(q)
    # 4) Unknown counting (DICT-based)
    unknown_counts: dict[str, int] = {}
    first_index: dict[str, int] = {}
    for idx, w in enumerate(segments):
        if not w or not contains_burmese(w):
            continue
        w_key = normalize_headword(w)
        if w_key in DICT:
            continue
        unknown_counts[w] = unknown_counts.get(w, 0) + 1
        if w not in first_index:
            first_index[w] = idx
    unknown_set = set(unknown_counts.keys())
    # 5) Phrase splitting: runs of Burmese between whitespace or Myanmar comma/period
    phrases: list[str] = []
    current_chars: list[str] = []
    for ch in q:
        if ch.isspace() or ch in MYANMAR_PUNCT:
            if current_chars:
                phrases.append("".join(current_chars))
                current_chars = []
            # ignore the delimiter itself for segmentation purposes
        else:
            current_chars.append(ch)
    if current_chars:
        phrases.append("".join(current_chars))
    # Phrase separator for both HTML + text modes
    PHRASE_SEP = "--"  # tweak this to "-", "---", etc. if you want

    # Helper to segment each phrase independently
    def segment_phrase(phrase: str) -> list[str]:
        if not phrase:
            return []
        return segment_with_pipeline(phrase)

    # 7) Decide output format
    fmt = (request.args.get("format") or "").lower()
    # =========================
    # HTML MODE (?format=html)
    # =========================
    if fmt == "html":
        seg_html_tokens: list[str] = []
        for p_idx, phrase in enumerate(phrases):
            if not phrase:
                continue
            # Phrase separator between phrases (no leading one)
            if p_idx != 0:
                seg_html_tokens.append(f'<span class="seg-phrase-sep"> {PHRASE_SEP} </span>')
            phrase_segs = segment_phrase(phrase)
            n_segs = len(phrase_segs)
            for t_idx, seg in enumerate(phrase_segs):
                if not seg or not contains_burmese(seg):
                    continue
                esc = html.escape(seg)
                if seg in unknown_set:
                    seg_html_tokens.append(f'<span class="seg-unknown">[[{esc}]]</span>')
                else:
                    seg_html_tokens.append(f'<span class="seg-known">{esc}</span>')
                # token separator inside each phrase
                if t_idx != n_segs - 1:
                    seg_html_tokens.append('<span class="seg-token-sep"> | </span>')
        html_parts: list[str] = []
        html_parts.append(
            "<!DOCTYPE html>"
            '<html lang="en">'
            "<head>"
            '<meta charset="utf-8"/>'
            "<title>Spell Debug</title>"
            "<style>"
            "body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',"
            "       system-ui, sans-serif; font-size: 14px; line-height: 1.5; padding: 12px; }"
            "pre { background: #f5f5f5; padding: 8px; border-radius: 4px; }"
            ".seg-known { color: #000; }"
            ".seg-unknown { color: #b00020; font-weight: 600; }"
            ".seg-token-sep { color: #888888; }"
            ".seg-phrase-sep { color: #00838f; font-weight: 600; margin: 0 6px; }"
            ".section-title { font-weight: 600; margin-top: 12px; margin-bottom: 4px; }"
            "</style>"
            "</head><body>"
        )
        # RAW / NORM (trimmed just in case)
        html_parts.append('<div class="section-title">RAW:</div>')
        html_parts.append("<pre>" + html.escape(raw_q[:2000]) + "</pre>")
        html_parts.append('<div class="section-title">NORM:</div>')
        html_parts.append("<pre>" + html.escape(q[:2000]) + "</pre>")
        # SEGMENTS
        html_parts.append(
            '<div class="section-title">'
            f"SEGMENTS (| = token boundary; {PHRASE_SEP} = phrase boundary; "
            "unknowns are red [[like this]]):"
            "</div>"
        )
        if seg_html_tokens:
            html_parts.append(
                '<p style="white-space: normal; word-wrap: break-word;">'
                + "".join(seg_html_tokens)
                + "</p>"
            )
        else:
            html_parts.append("<p>[none]</p>")
        # Unknowns + suggestions
        html_parts.append('<div class="section-title">Unknown tokens + suggestions:</div>')
        if not unknown_counts:
            html_parts.append("<p>[no unknown Burmese tokens in this input]</p>")
            html_parts.append("</body></html>")
            return Response(
                "\n".join(html_parts),
                mimetype="text/html; charset=utf-8",
            )
        if ADVANCED_SEGMENTER is None:
            html_parts.append("<p>[spell] ADVANCED_SEGMENTER not initialised (no suggestions)</p>")
            html_parts.append("</body></html>")
            return Response(
                "\n".join(html_parts),
                mimetype="text/html; charset=utf-8",
            )
        sorted_unknowns = sorted(first_index.items(), key=lambda kv: kv[1])
        max_suggestions = 5
        unknown_lines: list[str] = []
        for w, _pos in sorted_unknowns:
            count = unknown_counts[w]
            idx = first_index[w]
            prev_word = segments[idx - 1] if idx > 0 else None
            next_word = segments[idx + 1] if idx + 1 < len(segments) else None
            try:
                suggs = ADVANCED_SEGMENTER.suggest_spellings_dict(
                    w, prev_word=prev_word, next_word=next_word
                )
            except Exception as e:
                unknown_lines.append(f"UNKNOWN ({count}ÃÆÃ¢â¬â): {w}  -> [spell error: {e}]")
                continue
            if not suggs:
                unknown_lines.append(f"UNKNOWN ({count}ÃÆÃ¢â¬â): {w}  -> [no suggestions]")
            else:
                cand_words = [
                    (fm.get("candidate") or "").strip()
                    for fm in suggs[:max_suggestions]
                    if fm.get("candidate")
                ]
                if cand_words:
                    unknown_lines.append(
                        f"UNKNOWN ({count}ÃÆÃ¢â¬â): {w}  -> " + ", ".join(cand_words)
                    )
                else:
                    unknown_lines.append(
                        f"UNKNOWN ({count}ÃÆÃ¢â¬â): {w}  -> [no candidate strings]"
                    )
        html_parts.append("<pre>" + html.escape("\n".join(unknown_lines)) + "</pre>")
        html_parts.append("</body></html>")
        return Response(
            "\n".join(html_parts),
            mimetype="text/html; charset=utf-8",
        )
    # ======================================
    # PLAIN TEXT MODE (default / ?format=txt)
    # ======================================
    # ANSI detection for terminals ÃÂ¢Ã¢âÂ¬Ã¢â¬Å can override with ?ansi=0/1
    ua = (request.headers.get("User-Agent") or "").lower()
    ansi_param = request.args.get("ansi")
    if ansi_param == "1":
        ansi_ok = True
    elif ansi_param == "0":
        ansi_ok = False
    else:
        ansi_ok = any(s in ua for s in ("curl", "httpie", "wget", "python-requests"))
    if ansi_ok:
        RED = "\x1b[31m"
        RESET = "\x1b[0m"
    else:
        RED = ""
        RESET = ""
    lines: list[str] = []
    lines.append(f"RAW: {raw_q[:500]}")
    lines.append(f"NORM: {q[:500]}")
    lines.append("")
    lines.append(
        f"SEGMENTS (| = token boundary; {PHRASE_SEP} = phrase boundary; "
        "unknowns are [[like this]]):"
    )
    disp_tokens: list[str] = []
    for p_idx, phrase in enumerate(phrases):
        if not phrase:
            continue
        # phrase separator between phrases
        if p_idx != 0:
            disp_tokens.append(PHRASE_SEP)
        phrase_segs = segment_phrase(phrase)
        n_segs = len(phrase_segs)
        for t_idx, seg in enumerate(phrase_segs):
            if not seg or not contains_burmese(seg):
                continue
            if seg in unknown_set:
                disp_tokens.append(f"{RED}[[{seg}]]{RESET}")
            else:
                disp_tokens.append(seg)
            # token separator inside each phrase
            if t_idx != n_segs - 1:
                disp_tokens.append("|")
    if disp_tokens:
        lines.append(" ".join(disp_tokens))
    else:
        lines.append("[none]")
    lines.append("")
    # No unknowns? we're done
    if not unknown_counts:
        lines.append("[no unknown Burmese tokens in this input]")
        return Response(
            "\n".join(lines) + "\n",
            mimetype="text/plain; charset=utf-8",
        )
    # If spell-checker not ready
    if ADVANCED_SEGMENTER is None:
        lines.append("[spell] ADVANCED_SEGMENTER not initialised (no suggestions)")
        return Response(
            "\n".join(lines) + "\n",
            mimetype="text/plain; charset=utf-8",
        )
    # Unknowns + suggestions
    sorted_unknowns = sorted(first_index.items(), key=lambda kv: kv[1])
    max_suggestions = 5
    for w, _pos in sorted_unknowns:
        count = unknown_counts[w]
        idx = first_index[w]
        prev_word = segments[idx - 1] if idx > 0 else None
        next_word = segments[idx + 1] if idx + 1 < len(segments) else None
        try:
            suggs = ADVANCED_SEGMENTER.suggest_spellings_dict(
                w, prev_word=prev_word, next_word=next_word
            )
        except Exception as e:
            lines.append(f"UNKNOWN ({count}ÃÆÃ¢â¬â): {w}  -> [spell error: {e}]")
            continue
        if not suggs:
            lines.append(f"UNKNOWN ({count}ÃÆÃ¢â¬â): {w}  -> [no suggestions]")
        else:
            cand_words = [
                (fm.get("candidate") or "").strip()
                for fm in suggs[:max_suggestions]
                if fm.get("candidate")
            ]
            if cand_words:
                lines.append(f"UNKNOWN ({count}ÃÆÃ¢â¬â): {w}  -> " + ", ".join(cand_words))
            else:
                lines.append(f"UNKNOWN ({count}ÃÆÃ¢â¬â): {w}  -> [no candidate strings]")
    return Response(
        "\n".join(lines) + "\n",
        mimetype="text/plain; charset=utf-8",
    )


# ----------------------------------------------------------------------
# SIMPLE Unknown-token summary debug endpoint (JSONL + robust decode)
# ----------------------------------------------------------------------
# Max Burmese chars to treat something as a "word-like" token.
MAX_UNKNOWN_TOKEN_BURMESE_LEN = 30  # start generous; tweak later


def _burmese_len(s: str) -> int:
    """
    Count how many characters in s are in the core Myanmar block.
    Used to filter out too-long junk segments.
    """
    if not s:
        return 0
    return sum(1 for ch in s if "\u1000" <= ch <= "\u109f")


@app.route("/debug/unknowns_summary", methods=["GET"])
def debug_unknowns_summary():
    """
    Summarize unknown segments logged in lookup_unknown_segment_log.jsonl.
    Assumes JSONL format, one JSON object per line, e.g.:
        {"time": "...", "q": "...", "segment": "??????", "kind": "primary"}
    Rules:
      - token = rec["segment"] (fallback rec["token"])
      - must contain Burmese chars
      - Burmese length must be <= MAX_UNKNOWN_TOKEN_BURMESE_LEN
      - NO DICT FILTERING (we show everything that meets the above)
    Output (plain text):
        total_records: ...
        kept_tokens: ...
        skipped_no_token: ...
        skipped_non_burmese: ...
        skipped_zero_burmese: ...
        skipped_too_long (> N Burmese chars): ...
            42    ??????
            37    ??????????
             7    ??????
    """
    counts: dict[str, int] = {}
    total_records = 0
    skipped_no_token = 0
    skipped_non_burmese = 0
    skipped_zero_burmese = 0
    skipped_too_long = 0
    # Make sure the file exists
    if not UNKNOWN_SEG_LOG_PATH.exists():
        return Response(
            f"[no file at {UNKNOWN_SEG_LOG_PATH}]\n",
            mimetype="text/plain; charset=utf-8",
        )
    # Read JSONL in binary, decode each line with errors="ignore"
    with UNKNOWN_SEG_LOG_PATH.open("rb") as f:
        for raw in f:
            try:
                line = raw.decode("utf-8", errors="ignore").strip()
            except Exception:
                continue
            if not line:
                continue
            total_records += 1
            try:
                rec = json.loads(line)
            except Exception:
                # If a line is corrupt JSON, just skip it
                continue
            if not isinstance(rec, dict):
                continue
            # Prefer old JSONL "segment", fall back to "token"
            token = (rec.get("segment") or rec.get("token") or "").strip()
            if not token:
                skipped_no_token += 1
                continue
            # Skip non-Burmese
            if not contains_burmese(token):
                skipped_non_burmese += 1
                continue
            blen = _burmese_len(token)
            if blen == 0:
                skipped_zero_burmese += 1
                continue
            # Max-length filter for paragraph/sentence junk
            if blen > MAX_UNKNOWN_TOKEN_BURMESE_LEN:
                skipped_too_long += 1
                continue
            # Count: 1 per record (we're just aggregating occurrences)
            counts[token] = counts.get(token, 0) + 1
    header_lines = [
        f"total_records: {total_records}",
        f"kept_tokens: {len(counts)}",
        f"skipped_no_token: {skipped_no_token}",
        f"skipped_non_burmese: {skipped_non_burmese}",
        f"skipped_zero_burmese: {skipped_zero_burmese}",
        f"skipped_too_long (> {MAX_UNKNOWN_TOKEN_BURMESE_LEN} Burmese chars): {skipped_too_long}",
        "",
    ]
    if not counts:
        return Response(
            "\n".join(header_lines) + "[no tokens passed filters]\n",
            mimetype="text/plain; charset=utf-8",
        )
    # Sort by count desc, then token
    items = sorted(
        counts.items(),
        key=lambda kv: (kv[1], kv[0]),
        reverse=True,
    )
    lines = header_lines + [f"{count:5d}\t{token}" for token, count in items]
    return Response(
        "\n".join(lines) + "\n",
        mimetype="text/plain; charset=utf-8",
    )


@app.route("/annotation", methods=["GET", "POST"])
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


@app.route("/api/reading_srs/next_card", methods=["GET"])
def api_reading_srs_next_card():
    """DISABLED FOR DEPLOYMENT: SRS requires per-user state."""
    return jsonify({"ok": False, "error": "disabled"}), 403


@app.route("/api/reading_srs/grade", methods=["POST"])
def api_reading_srs_grade():
    """DISABLED FOR DEPLOYMENT: SRS requires per-user state."""
    return jsonify({"ok": False, "error": "disabled"}), 403


@app.route("/ping")
def ping():
    return jsonify({"ok": True, "msg": "burmese_dict_server alive"})


DEP_TREE_VIEW_PATH = Path(__file__).with_name("dep_tree_view.js")
WHITESPACE_BOUNDARY_JS_PATH = Path(__file__).with_name("whitespace_boundaries.js")
MYUDTREE_CONLLU_PATH = Path(__file__).with_name("randomdata") / "myUDTree_ver1.0.conllu.pred"
_MYUDTREE_INDEX = None
_MYUDTREE_INDEX_LOCK = threading.Lock()


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
    global _MYUDTREE_INDEX
    if _MYUDTREE_INDEX is not None:
        return _MYUDTREE_INDEX
    with _MYUDTREE_INDEX_LOCK:
        if _MYUDTREE_INDEX is None:
            _MYUDTREE_INDEX = _build_myudtree_index()
    return _MYUDTREE_INDEX


@app.route("/dep_tree_view.js", methods=["GET"])
def dep_tree_view_js():
    try:
        js = DEP_TREE_VIEW_PATH.read_text(encoding="utf-8")
    except Exception:
        js = "// dep_tree_view.js not found"
    return Response(js, mimetype="application/javascript; charset=utf-8")


@app.route("/whitespace_boundaries.js", methods=["GET"])
def whitespace_boundaries_js():
    try:
        js = WHITESPACE_BOUNDARY_JS_PATH.read_text(encoding="utf-8")
    except Exception:
        js = "// whitespace_boundaries.js not found"
    return Response(js, mimetype="application/javascript; charset=utf-8")


@app.route("/myudtree.conllu", methods=["GET"])
def myudtree_conllu():
    """DISABLED FOR DEPLOYMENT: File-based UD tree disabled - use live mode only."""
    return Response("", mimetype="text/plain; charset=utf-8")


@app.route("/myudtree.meta", methods=["GET"])
def myudtree_meta():
    """DISABLED FOR DEPLOYMENT: File-based UD tree disabled - use live mode only."""
    return jsonify({"ok": True, "total": 0})


@app.route("/myudtree.sentence", methods=["GET"])
def myudtree_sentence():
    """DISABLED FOR DEPLOYMENT: File-based UD tree disabled - use live mode only."""
    return Response("", mimetype="text/plain; charset=utf-8")


# -------------------------------------------------------------------
# BURMESE GRAMMAR READER WITH SIDE DICTIONARY PANEL - FIXED
# -------------------------------------------------------------------
# READER_HTML moved to templates/reader.html and static/reader.{css,js}


@app.route("/")
def index():
    return redirect("/reader")


@app.route("/reader", methods=["GET"])
def reader_page():
    return render_template("reader.html")


# ---------------- main -----------------------------------
if __name__ == "__main__":
    load_dictionary()
    # NEW: load the grammar lexicon once at startup
    load_grammar_lexicon_tsv(TSV_GRAMMAR_PATH)
    # inject_grammar_heads_into_dict()
    # Preload UD parser (and dict_pos_override) at server start to avoid first-request latency.
    init_ud_parser()
    # Preload Stanza tokenizer/NER to avoid first-request latency.
    init_stanza_ner()
    app.run(host="127.0.0.1", port=5000, debug=False)
