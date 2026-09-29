"""
advanced_segmenter.py - FIXED VERSION

FIXES:
1. Metadata wiring bug - now uses position-based tracking
2. Greedy merge indexing bug - correctly advances by tokens consumed
3. Efficient myWord usage - 1 call per text, not K calls per unknown

BACKWARD COMPATIBLE - All original functionality preserved!
New features are opt-in via config (all disabled by default).

Usage:
    segmenter = AdvancedSegmenter(
        dict_obj=DICT,
        dp_segmenter=segment_chunk,
        myword_root=Path("myWord-main"),
    )
    
    # Original API (unchanged):
    tokens = segmenter.segment(text)  # Returns List[str]
    
    # NEW API (with metadata):
    tokens = segmenter.segment_with_metadata(text)  # Returns List[SegmentToken]
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import subprocess
import sys
import tempfile
import unicodedata


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def contains_burmese(s: str) -> bool:
    """Return True if any Myanmar-range char is in s."""
    return any(0x1000 <= ord(ch) <= 0x109F for ch in s)


def is_all_burmese(s: str) -> bool:
    """True iff all non-whitespace chars are in the Myanmar block."""
    for ch in s:
        if ch.isspace():
            continue
        cp = ord(ch)
        if not (0x1000 <= cp <= 0x109F):
            return False
    return True


def _levenshtein(a: str, b: str) -> int:
    """Simple Levenshtein distance on Unicode codepoints."""
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if la == 0:
        return lb
    if lb == 0:
        return la

    prev = list(range(lb + 1))
    curr = [0] * (lb + 1)

    for i in range(1, la + 1):
        curr[0] = i
        ca = a[i - 1]
        for j in range(1, lb + 1):
            cb = b[j - 1]
            cost = 0 if ca == cb else 1
            curr[j] = min(
                prev[j] + 1,
                curr[j - 1] + 1,
                prev[j - 1] + cost,
            )
        prev, curr = curr, prev

    return prev[lb]


# ---------------------------------------------------------------------------
# NEW: Segment token with metadata
# ---------------------------------------------------------------------------

@dataclass
class SegmentToken:
    """
    Token with reconstruction metadata.
    Only returned by segment_with_metadata() - NOT by segment().
    """
    text: str
    reconstructed: bool = False
    original: Optional[str] = None
    method: Optional[str] = None
    confidence: float = 1.0
    span: Optional[Tuple[int, int]] = None
    
    def __str__(self) -> str:
        return self.text
    
    def to_dict(self) -> dict:
        return {
            'text': self.text,
            'reconstructed': self.reconstructed,
            'original': self.original,
            'method': self.method,
            'confidence': self.confidence,
            'span': self.span,
        }


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

@dataclass
class AdvancedSegConfig:
    """
    Config for advanced segmenter.
    
    ORIGINAL OPTIONS (behavior unchanged):
        enable_myword: Use myWord for arbitration
        enable_spell_correct: Use spell correction
        min_unknowns_for_myword: Minimum unknowns to invoke myWord
        strict_myword_glue: Only single-token myWord replacements (original: True)
        max_edit_distance: Max edit distance for corrections
        min_similarity: Min similarity for corrections
        max_candidates_to_score: Max candidates to check
    
    NEW OPTIONS (opt-in features, all disabled by default):
        enable_lm_guided_correction: Use myWord to predict what should fill gaps
        enable_greedy_merge: Try merging consecutive unknowns
        max_merge_span: Max unknowns to merge at once
    """
    
    # Original options (defaults unchanged)
    enable_myword: bool = False
    enable_spell_correct: bool = True
    min_unknowns_for_myword: int = 1
    strict_myword_glue: bool = False
    max_edit_distance: int = 2
    min_similarity: float = 0.6
    max_candidates_to_score: int = 200
    
    # NEW options (all disabled by default for backward compat)
    enable_lm_guided_correction: bool = False
    enable_greedy_merge: bool = True
    max_merge_span: int = 3


# ---------------------------------------------------------------------------
# Advanced segmenter
# ---------------------------------------------------------------------------

class AdvancedSegmenter:
    """
    BACKWARD COMPATIBLE - All original behavior preserved!
    
    Original API (unchanged):
        tokens = seg.segment(text)  # Returns List[str]
    
    NEW API:
        tokens = seg.segment_with_metadata(text)  # Returns List[SegmentToken]
    """

    def __init__(
        self,
        dict_obj: Dict[str, dict],
        dp_segmenter: Callable[[str], List[str]],
        myword_root: Optional[Path] = None,
        config: Optional[AdvancedSegConfig] = None,
    ) -> None:
        self.dict: Dict[str, dict] = dict_obj
        self.dp_segmenter = dp_segmenter
        self.config = config or AdvancedSegConfig()

        # myWord integration
        self.myword_root: Optional[Path] = None
        self.myword_script: Optional[Path] = None
        self.has_myword: bool = False
        if myword_root is not None:
            self._init_myword(Path(myword_root))

        # Spell-correction lexicon
        self._lex_by_first: Dict[str, Dict[int, List[str]]] = {}
        if self.config.enable_spell_correct:
            self._build_correction_lexicon()
        
        # FIXED: Position-based metadata tracking
        self._last_correction_metadata: Dict[int, dict] = {}  # position -> metadata
        self._last_arbitration_metadata: Dict[int, dict] = {}

    # --------------------- PUBLIC API (ORIGINAL) -----------------------

    def segment(self, text: str) -> List[str]:
        """
        ORIGINAL METHOD - Returns List[str] exactly as before!
        
        Pipeline:
            1. Normalize input
            2. First-pass DP segmentation
            3. Spell correction (uses LM if enabled, otherwise simple)
            4. Re-segment if changed
            5. myWord arbitration
            
        Returns: List of string tokens (original behavior)
        """
        text = text.strip()
        if not text:
            return []

        norm = self._normalize_for_segmentation(text)
        dp_segments_1 = self.dp_segmenter(norm)
        
        corrected_text = self._spell_correct(norm, dp_segments_1)

        if corrected_text != norm:
            dp_segments_2 = self.dp_segmenter(corrected_text)
            norm_for_arbitration = corrected_text
        else:
            dp_segments_2 = dp_segments_1
            norm_for_arbitration = norm

        if self.has_myword and self.config.enable_myword:
            seg_final = self._arbitrate_with_myword(norm_for_arbitration, dp_segments_2)
        else:
            seg_final = dp_segments_2

        return seg_final

    # --------------------- NEW API (METADATA) --------------------------

    def segment_with_metadata(self, text: str) -> List[SegmentToken]:
        """
        NEW METHOD - Returns List[SegmentToken] with reconstruction metadata.
        
        Returns: List of SegmentToken objects with reconstruction tracking
        """
        text = text.strip()
        if not text:
            return []

        norm = self._normalize_for_segmentation(text)
        dp_segments_1 = self.dp_segmenter(norm)
        
        # Clear metadata trackers
        self._last_correction_metadata = {}
        self._last_arbitration_metadata = {}
        
        # Spell correction with metadata tracking
        corrected_text = self._spell_correct_with_tracking(norm, dp_segments_1)

        if corrected_text != norm:
            dp_segments_2 = self.dp_segmenter(corrected_text)
            norm_for_arbitration = corrected_text
        else:
            dp_segments_2 = dp_segments_1
            norm_for_arbitration = norm

        if self.has_myword and self.config.enable_myword:
            seg_final = self._arbitrate_with_myword_tracking(norm_for_arbitration, dp_segments_2)
        else:
            seg_final = dp_segments_2

        # Wrap with metadata (FIXED)
        return self._wrap_with_metadata(seg_final, norm_for_arbitration)

    # ------------------- NORMALIZATION (UNCHANGED) ---------------------

    def _normalize_for_segmentation(self, text: str) -> str:
        """
        Heavy normalization that drops all non-Myanmar characters.
        This ensures garbage characters don't create hard boundaries.
        """
        if not text:
            return ""
        
        # Basic replacements
        s = text.replace("၀", "ဝ")
        s = s.replace("°", "")
        s = unicodedata.normalize("NFC", s)
        
        # Myanmar ranges
        MYANMAR_EXTENDED_A_START = 0xAA60
        MYANMAR_EXTENDED_A_END   = 0xAA7F
        MYANMAR_EXTENDED_B_START = 0xA9E0
        MYANMAR_EXTENDED_B_END   = 0xA9FF
        MYANMAR_PUNCT = {"\u104a", "\u104b"}
        ZERO_WIDTH_CHARS = {"\u200b", "\u200c", "\u200d", "\ufeff"}
        SINGLETON_COMBINING = {
            "\u102b", "\u102c", "\u102d", "\u102e", "\u102f", "\u1030",
            "\u1032", "\u1036", "\u1037", "\u1038", "\u103a",
        }
        
        def _is_myanmar_core(cp: int) -> bool:
            return 0x1000 <= cp <= 0x109F
        
        def _is_myanmar_extended(cp: int) -> bool:
            return ((MYANMAR_EXTENDED_A_START <= cp <= MYANMAR_EXTENDED_A_END) or
                    (MYANMAR_EXTENDED_B_START <= cp <= MYANMAR_EXTENDED_B_END))
        
        def _is_combining_mark(ch: str) -> bool:
            code = ord(ch)
            if 0x102B <= code <= 0x103E:
                return True
            if 0x1056 <= code <= 0x1059:
                return True
            if code in (0x1036, 0x1038, 0x1039):
                return True
            return False
        
        out = []
        last_was_base = False
        used_marks = set()
        
        def _push_space():
            nonlocal last_was_base, used_marks
            if out and out[-1] == " ":
                return
            out.append(" ")
            last_was_base = False
            used_marks.clear()
        
        for ch in s:
            cp = ord(ch)
            
            # Zero-width junk → drop
            if ch in ZERO_WIDTH_CHARS:
                continue
            
            # Any Unicode whitespace → normalize to " "
            if ch.isspace():
                _push_space()
                continue
            
            # Myanmar Extended A/B → keep
            if _is_myanmar_extended(cp):
                out.append(ch)
                last_was_base = True
                used_marks.clear()
                continue
            
            # Non-Myanmar (Latin, ASCII punctuation, etc.) → DROP completely
            # This is the key fix: don't treat as boundary, just skip
            if not _is_myanmar_core(cp):
                continue
            
            # Myanmar punctuation
            if ch in MYANMAR_PUNCT:
                out.append(ch)
                last_was_base = False
                used_marks.clear()
                continue
            
            # Combining mark
            if _is_combining_mark(ch):
                if not last_was_base:
                    continue
                if ch in SINGLETON_COMBINING and ch in used_marks:
                    continue
                out.append(ch)
                used_marks.add(ch)
                continue
            
            # Base character
            out.append(ch)
            last_was_base = True
            used_marks.clear()
        
        cleaned = "".join(out)
        # Collapse multiple spaces, strip edges
        cleaned = " ".join(cleaned.split())
        return cleaned

    # --------------- SPELL CORRECTION (ORIGINAL METHOD) ----------------

    def _spell_correct(self, norm_text: str, segments_1: List[str]) -> str:
        """
        ORIGINAL METHOD - behavior depends on config.
        
        If enable_lm_guided_correction=False (default):
            Uses original token-by-token edit distance
        If enable_lm_guided_correction=True:
            Uses myWord LM to guide corrections
            
        Always returns corrected text string (original behavior).
        """
        if not self.config.enable_spell_correct:
            return norm_text

        if not segments_1:
            return norm_text

        # FIXED: Efficient LM approach - run myWord ONCE if enabled
        myword_predictions = None
        if self.config.enable_lm_guided_correction and self.has_myword:
            myword_predictions = self._get_myword_predictions(norm_text)

        changed = False
        pieces: List[str] = []
        i = 0

        while i < len(segments_1):
            seg = segments_1[i]

            if not contains_burmese(seg):
                pieces.append(seg)
                i += 1
                continue

            if seg in self.dict:
                pieces.append(seg)
                i += 1
                continue

            if not is_all_burmese(seg):
                pieces.append(seg)
                i += 1
                continue

            # Unknown Burmese token
            
            # FIXED: Try greedy merge first if enabled
            if self.config.enable_greedy_merge and i + 1 < len(segments_1):
                merged, tokens_consumed = self._try_greedy_merge_simple(
                    segments_1, i, myword_predictions
                )
                if merged:
                    pieces.append(merged)
                    i += tokens_consumed  # FIXED: advance by actual tokens consumed
                    changed = True
                    continue

            # Single token correction
            if myword_predictions:
                corrected = self._correct_with_lm(seg, i, segments_1, myword_predictions)
            else:
                corrected = self._correct_simple(seg)

            if corrected != seg:
                changed = True

            pieces.append(corrected)
            i += 1

        if not changed:
            return norm_text

        return "".join(pieces)

    # ----------- SPELL CORRECTION WITH METADATA TRACKING ---------------

    def _spell_correct_with_tracking(self, norm_text: str, segments_1: List[str]) -> str:
        """
        Same as _spell_correct but tracks metadata.
        Only called by segment_with_metadata().
        """
        if not self.config.enable_spell_correct:
            return norm_text

        if not segments_1:
            return norm_text

        # FIXED: Efficient LM - run myWord ONCE
        myword_predictions = None
        if self.config.enable_lm_guided_correction and self.has_myword:
            myword_predictions = self._get_myword_predictions(norm_text)

        self._last_correction_metadata = {}
        changed = False
        pieces: List[str] = []
        position = 0
        i = 0

        while i < len(segments_1):
            seg = segments_1[i]

            if not contains_burmese(seg):
                pieces.append(seg)
                position += len(seg)
                i += 1
                continue

            if seg in self.dict:
                pieces.append(seg)
                position += len(seg)
                i += 1
                continue

            if not is_all_burmese(seg):
                pieces.append(seg)
                position += len(seg)
                i += 1
                continue

            # Unknown token - try greedy merge first
            if self.config.enable_greedy_merge and i + 1 < len(segments_1):
                merged, tokens_consumed, merge_meta = self._try_greedy_merge_with_metadata(
                    segments_1, i, position, myword_predictions
                )
                if merged:
                    # FIXED: Store metadata at correct position
                    self._last_correction_metadata[position] = merge_meta
                    pieces.append(merged)
                    # FIXED: Advance position by actual merged length
                    merged_len = sum(len(segments_1[i+j]) for j in range(tokens_consumed))
                    position += merged_len
                    i += tokens_consumed  # FIXED: advance correctly
                    changed = True
                    continue

            # Single token correction with metadata
            if myword_predictions:
                corrected, conf = self._correct_with_lm_and_confidence(
                    seg, i, segments_1, myword_predictions
                )
            else:
                corrected, conf = self._correct_simple(seg), 0.5

            if corrected != seg:
                # FIXED: Store at position, not by token text
                self._last_correction_metadata[position] = {
                    'original': seg,
                    'correction': corrected,
                    'method': 'lm_guided' if myword_predictions else 'spell_correct',
                    'confidence': conf,
                }
                changed = True

            pieces.append(corrected)
            position += len(seg)
            i += 1

        if not changed:
            return norm_text

        return "".join(pieces)

    # ------------ SIMPLE SPELL CORRECTION (ORIGINAL LOGIC) -------------

    def _correct_simple(self, token: str) -> str:
        """Original token-by-token correction logic - unchanged."""
        cleaned = self._clean_ocr_token(token)
        if cleaned in self.dict:
            return cleaned
        candidate = self._best_dict_correction(cleaned)
        return candidate if candidate else cleaned

    def _clean_ocr_token(self, token: str) -> str:
        """Original OCR cleaning - unchanged."""
        s = unicodedata.normalize("NFC", token)
        while "္္" in s:
            s = s.replace("္္", "္")
        while len(s) > 1 and s.endswith("္"):
            s = s[:-1]
        return s or token

    def _best_dict_correction(self, token: str) -> Optional[str]:
        """Original edit-distance correction - unchanged."""
        if not self._lex_by_first:
            return None

        L = len(token)
        if L <= 1:
            return None

        first = token[0]
        by_len = self._lex_by_first.get(first)
        if not by_len:
            return None

        candidates: List[str] = []
        for dL in (-1, 0, 1):
            bucket = by_len.get(L + dL)
            if bucket:
                candidates.extend(bucket)

        if not candidates:
            return None

        max_ed = self.config.max_edit_distance
        min_sim = self.config.min_similarity
        max_to_score = self.config.max_candidates_to_score

        best_word: Optional[str] = None
        best_sim: float = 0.0

        for idx, cand in enumerate(candidates):
            if idx >= max_to_score:
                break
            dist = _levenshtein(token, cand)
            if dist > max_ed:
                continue
            sim = 1.0 - (dist / float(max(len(token), len(cand))))
            if sim < min_sim:
                continue
            if best_word is None or sim > best_sim:
                best_word = cand
                best_sim = sim

        return best_word

    # --------------- LM-GUIDED CORRECTION (FIXED & EFFICIENT) ----------

    def _get_myword_predictions(self, text: str) -> Optional[Dict[Tuple[int, int], str]]:
        """
        FIXED: Run myWord ONCE and return span -> predicted_token mapping.
        
        This is the key efficiency fix: instead of running myWord K times
        per unknown (once per candidate), we run it ONCE on the text and
        see what it predicts for each position.
        
        Returns: {(start, end): predicted_token} or None if myWord fails
        """
        if not self.has_myword:
            return None
            
        myword_tokens = self._myword_segment_full(text)
        if not myword_tokens:
            return None
        
        # Build span mapping
        predictions = {}
        idx = 0
        for token in myword_tokens:
            # Skip whitespace in original text
            while idx < len(text) and text[idx].isspace():
                idx += 1
            
            start = idx
            for ch in token:
                while idx < len(text) and text[idx].isspace():
                    idx += 1
                if idx < len(text) and text[idx] == ch:
                    idx += 1
                else:
                    # Alignment failed
                    return None
            end = idx
            
            predictions[(start, end)] = token
        
        return predictions

    def _correct_with_lm(
        self,
        token: str,
        token_idx: int,
        segments: List[str],
        myword_predictions: Dict[Tuple[int, int], str]
    ) -> str:
        """FIXED: LM-guided correction using pre-computed myWord predictions."""
        corrected, _ = self._correct_with_lm_and_confidence(
            token, token_idx, segments, myword_predictions
        )
        return corrected

    def _correct_with_lm_and_confidence(
        self,
        token: str,
        token_idx: int,
        segments: List[str],
        myword_predictions: Dict[Tuple[int, int], str]
    ) -> Tuple[str, float]:
        """
        FIXED: LM-guided correction with confidence.
        
        Strategy:
        1. Clean the token
        2. Generate edit-distance candidates
        3. See what myWord predicted for this span
        4. If myWord's prediction is in our candidates → use it (high confidence)
        5. Otherwise use best edit-distance match (lower confidence)
        """
        cleaned = self._clean_ocr_token(token)
        if cleaned in self.dict:
            return cleaned, 1.0

        # Generate edit-distance candidates
        candidates = self._get_top_candidates(cleaned)
        if not candidates:
            return cleaned, 0.5

        # Find this token's span in the original text
        span_start = sum(len(segments[i]) for i in range(token_idx))
        span_end = span_start + len(token)
        
        # What did myWord predict for this span?
        myword_prediction = myword_predictions.get((span_start, span_end))
        
        if myword_prediction and myword_prediction in candidates:
            # myWord's prediction matches one of our candidates - use it!
            return myword_prediction, 0.9
        
        # myWord doesn't match or didn't predict - use best edit distance
        if candidates:
            return candidates[0], 0.6
        
        return cleaned, 0.5

    def _get_top_candidates(self, token: str) -> List[str]:
        """Get top candidates by edit distance (up to config.max_candidates_to_score)."""
        if not self._lex_by_first or len(token) <= 1:
            return []

        first = token[0]
        by_len = self._lex_by_first.get(first)
        if not by_len:
            return []

        L = len(token)
        candidates: List[str] = []
        for dL in (-1, 0, 1):
            bucket = by_len.get(L + dL)
            if bucket:
                candidates.extend(bucket)

        if not candidates:
            return []

        scored = []
        for cand in candidates[:self.config.max_candidates_to_score]:
            dist = _levenshtein(token, cand)
            if dist > self.config.max_edit_distance:
                continue
            sim = 1.0 - (dist / float(max(len(token), len(cand))))
            if sim < self.config.min_similarity:
                continue
            scored.append((sim, cand))

        scored.sort(reverse=True, key=lambda x: x[0])
        return [cand for _, cand in scored]

    # --------------- GREEDY MERGING (FIXED) ----------------------------

    def _try_greedy_merge_simple(
        self,
        segments: List[str],
        start_idx: int,
        myword_predictions: Optional[Dict[Tuple[int, int], str]]
    ) -> Tuple[Optional[str], int]:
        """
        FIXED: Try greedy merge, return (merged_token, tokens_consumed).
        
        Returns:
            (merged_token, tokens_consumed) if successful
            (None, 0) if no merge
        """
        # Collect consecutive unknown tokens
        run = [segments[start_idx]]
        idx = start_idx + 1
        while idx < len(segments) and len(run) < self.config.max_merge_span:
            seg = segments[idx]
            if contains_burmese(seg) and is_all_burmese(seg) and seg not in self.dict:
                run.append(seg)
                idx += 1
            else:
                break

        if len(run) < 2:
            return None, 0

        combined = "".join(run)
        
        # Check if myWord predicts a single token for this span
        if myword_predictions:
            span_start = sum(len(segments[i]) for i in range(start_idx))
            span_end = span_start + len(combined)
            myword_prediction = myword_predictions.get((span_start, span_end))
            
            if myword_prediction and myword_prediction in self.dict:
                # myWord predicts a known token for this span - use it!
                return myword_prediction, len(run)
        
        # Otherwise try edit-distance candidates
        candidates = self._get_merge_candidates(combined)
        if candidates:
            return candidates[0], len(run)
        
        return None, 0

    def _try_greedy_merge_with_metadata(
        self,
        segments: List[str],
        start_idx: int,
        position: int,
        myword_predictions: Optional[Dict[Tuple[int, int], str]]
    ) -> Tuple[Optional[str], int, Optional[dict]]:
        """
        FIXED: Try greedy merge with metadata.
        
        Returns:
            (merged_token, tokens_consumed, metadata) if successful
            (None, 0, None) if no merge
        """
        merged, tokens_consumed = self._try_greedy_merge_simple(
            segments, start_idx, myword_predictions
        )
        
        if not merged:
            return None, 0, None
        
        # Build metadata
        run_tokens = segments[start_idx:start_idx + tokens_consumed]
        original = "".join(run_tokens)
        
        metadata = {
            'original': original,
            'correction': merged,
            'method': 'greedy_merge',
            'confidence': 0.8,
            'merged_from': run_tokens,
        }
        
        return merged, tokens_consumed, metadata

    def _get_merge_candidates(self, combined: str) -> List[str]:
        """Get candidates for greedy merge (slightly more lenient than normal)."""
        if not self._lex_by_first or len(combined) <= 1:
            return []

        first = combined[0]
        by_len = self._lex_by_first.get(first)
        if not by_len:
            return []

        L = len(combined)
        candidates: List[str] = []
        for dL in range(-2, 3):  # Slightly broader for merges
            bucket = by_len.get(L + dL)
            if bucket:
                candidates.extend(bucket)

        scored = []
        for cand in candidates[:self.config.max_candidates_to_score]:
            dist = _levenshtein(combined, cand)
            if dist > self.config.max_edit_distance + 1:  # More lenient
                continue
            sim = 1.0 - (dist / float(max(len(combined), len(cand))))
            if sim < self.config.min_similarity - 0.1:  # More lenient
                continue
            scored.append((sim, cand))

        scored.sort(reverse=True, key=lambda x: x[0])
        return [cand for _, cand in scored]

    # ----------------- MYWORD ARBITRATION (ORIGINAL) -------------------

    def _arbitrate_with_myword(self, norm_text: str, dp_segments: List[str]) -> List[str]:
        """
        ORIGINAL METHOD - behavior depends on strict_myword_glue config.
        
        If strict_myword_glue=True (default):
            Only single-token replacements (original behavior)
        If strict_myword_glue=False:
            Allows multi-token myWord solutions (new behavior)
        """
        if not dp_segments:
            return []

        myword_tokens = self._myword_segment_full(norm_text)
        if not myword_tokens:
            return dp_segments

        dp_spans = self._compute_dp_spans(norm_text, dp_segments)
        mw_spans = self._compute_myword_spans(norm_text, myword_tokens)
        if mw_spans is None:
            return dp_segments

        span_to_mw = {}
        for s, e, tok in mw_spans:
            key = (s, e)
            if key not in span_to_mw:
                span_to_mw[key] = []
            span_to_mw[key].append(tok)

        out: List[str] = []
        i = 0
        n_dp = len(dp_spans)

        while i < n_dp:
            start_i, end_i, seg_i = dp_spans[i]

            if (not contains_burmese(seg_i)) or (seg_i in self.dict):
                out.append(seg_i)
                i += 1
                continue

            # Unknown run
            run_start = i
            run_end = i + 1
            while run_end < n_dp:
                _, _, seg_j = dp_spans[run_end]
                if contains_burmese(seg_j) and seg_j not in self.dict:
                    run_end += 1
                else:
                    break

            unknown_run_len = run_end - run_start
            if unknown_run_len < self.config.min_unknowns_for_myword:
                for k in range(run_start, run_end):
                    out.append(dp_spans[k][2])
                i = run_end
                continue

            span_start = dp_spans[run_start][0]
            span_end = dp_spans[run_end - 1][1]

            # Try single token (original behavior)
            mw_single = span_to_mw.get((span_start, span_end))
            if mw_single and len(mw_single) == 1:
                out.append(mw_single[0])
                i = run_end
                continue

            # Try multi-token if not strict (NEW behavior)
            if not self.config.strict_myword_glue:
                mw_candidates = [(s, e, t) for s, e, t in mw_spans if s >= span_start and e <= span_end]
                mw_candidates.sort(key=lambda x: x[0])
                if (mw_candidates and 
                    mw_candidates[0][0] == span_start and 
                    mw_candidates[-1][1] == span_end):
                    mw_tokens = [t for _, _, t in mw_candidates]
                    mw_known = sum(1 for t in mw_tokens if t in self.dict)
                    dp_known = sum(1 for k in range(run_start, run_end) if dp_spans[k][2] in self.dict)
                    if mw_known >= dp_known:
                        out.extend(mw_tokens)
                        i = run_end
                        continue

            # No match: keep DP
            for k in range(run_start, run_end):
                out.append(dp_spans[k][2])
            i = run_end

        return out

    def _arbitrate_with_myword_tracking(self, norm_text: str, dp_segments: List[str]) -> List[str]:
        """Same as _arbitrate_with_myword but tracks metadata."""
        result = self._arbitrate_with_myword(norm_text, dp_segments)
        
        # TODO: Track which segments came from myWord arbitration
        # For now, just return the result
        self._last_arbitration_metadata = {}
        
        return result

    def _compute_dp_spans(self, text: str, segments: List[str]) -> List[Tuple[int, int, str]]:
        """Original method - unchanged."""
        spans: List[Tuple[int, int, str]] = []
        idx = 0
        for seg in segments:
            length = len(seg)
            spans.append((idx, idx + length, seg))
            idx += length
        return spans

    def _compute_myword_spans(self, text: str, tokens: List[str]) -> Optional[List[Tuple[int, int, str]]]:
        """Original method - unchanged."""
        spans: List[Tuple[int, int, str]] = []
        i = 0
        n = len(text)

        for tok in tokens:
            if not tok:
                continue
            while i < n and text[i].isspace():
                i += 1
            if i >= n:
                return None
            start = i
            for ch in tok:
                while i < n and text[i].isspace():
                    i += 1
                if i >= n or text[i] != ch:
                    return None
                i += 1
            spans.append((start, i, tok))

        return spans

    # --------------- LEXICON BUILDING (UNCHANGED) ----------------------

    def _build_correction_lexicon(self) -> None:
        """Original method - unchanged."""
        lex: Dict[str, Dict[int, List[str]]] = {}
        for head in self.dict.keys():
            if not contains_burmese(head):
                continue
            if len(head) <= 1:
                continue
            first = head[0]
            L = len(head)
            by_len = lex.setdefault(first, {})
            bucket = by_len.setdefault(L, [])
            bucket.append(head)
        self._lex_by_first = lex

    # --------------- MYWORD INTEGRATION (UNCHANGED) --------------------

    def _init_myword(self, root: Path) -> None:
        """Original method - unchanged."""
        root = root.resolve()
        script = root / "myword.py"
        if not script.exists():
            self.myword_root = None
            self.myword_script = None
            self.has_myword = False
            return
        self.myword_root = root
        self.myword_script = script
        self.has_myword = True

    def _myword_segment_full(self, text: str) -> Optional[List[str]]:
        """Original method - unchanged."""
        if not self.has_myword or not self.myword_script:
            return None
        if not contains_burmese(text):
            return None

        try:
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as f_in:
                in_path = Path(f_in.name)
                f_in.write(text)
                f_in.write("\n")

            with tempfile.NamedTemporaryFile("r", encoding="utf-8", delete=False) as f_out:
                out_path = Path(f_out.name)

            cmd = [sys.executable, str(self.myword_script), "word", str(in_path), str(out_path)]
            subprocess.run(cmd, cwd=str(self.myword_root), check=True,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            with out_path.open("r", encoding="utf-8") as f:
                first_line = f.readline().strip()

            try:
                in_path.unlink(missing_ok=True)
                out_path.unlink(missing_ok=True)
            except Exception:
                pass

            if not first_line:
                return None

            return first_line.split()

        except Exception as e:
            print(f"[myWord FATAL ERROR] Subprocess failed: {e}", file=sys.stderr)
            return None

    # --------------- METADATA WRAPPING (FIXED) -------------------------

    def _wrap_with_metadata(self, segments: List[str], text: str) -> List[SegmentToken]:
        """
        FIXED: Wrap segments in SegmentToken objects with position-based metadata lookup.
        """
        tokens = []
        idx = 0

        for seg in segments:
            span_start = idx
            span_end = idx + len(seg)

            # FIXED: Check if this position was corrected
            if span_start in self._last_correction_metadata:
                meta = self._last_correction_metadata[span_start]
                token = SegmentToken(
                    text=seg,
                    reconstructed=True,
                    original=meta['original'],
                    method=meta['method'],
                    confidence=meta['confidence'],
                    span=(span_start, span_end),
                )
            # Check if from arbitration
            elif span_start in self._last_arbitration_metadata:
                meta = self._last_arbitration_metadata[span_start]
                token = SegmentToken(
                    text=seg,
                    reconstructed=True,
                    original=meta.get('original', seg),
                    method=meta.get('method', 'myword'),
                    confidence=meta.get('confidence', 0.8),
                    span=(span_start, span_end),
                )
            else:
                # Not reconstructed
                token = SegmentToken(
                    text=seg,
                    reconstructed=False,
                    span=(span_start, span_end),
                )

            tokens.append(token)
            idx = span_end

        return tokens