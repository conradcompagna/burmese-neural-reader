"""Burmese reader: fuzzy."""

from __future__ import annotations
from . import fill as fill_service

import burmese_transliteration as g2p_engine
from flask import (
    Blueprint,
    jsonify,
    request,
)

from . import (
    lexicon as lexicon_service,
    lm_runtime as lm_runtime_service,
    normalization as normalization_service,
)

bp = Blueprint("fuzzy", __name__)


@bp.route("/api/fuzzy_smart", methods=["POST"])
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
    base_token = (
        data.get("base_token") or data.get("token") or data.get("q") or ""
    ).strip()
    unknown_piece = (data.get("unknown_piece") or "").strip()
    force_whole_token = bool(
        data.get("force_whole_token") or data.get("forceWholeToken")
    )
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

    if lm_runtime_service.state.ADVANCED_SEGMENTER is None:
        return jsonify(
            {
                "ok": False,
                "error": "advanced_segmenter_unavailable",
                "base_token": base_token,
            }
        ), 503
    if not normalization_service.contains_burmese(base_token):
        return jsonify(
            {"ok": False, "error": "non_burmese", "base_token": base_token}
        ), 400

    # Get island tokens for island-level matching
    island_tokens = data.get("island_tokens") or []
    token_idx_in_island = data.get("token_idx_in_island")
    try:
        token_idx_in_island = (
            int(token_idx_in_island) if token_idx_in_island is not None else -1
        )
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
                lm_runtime_service.state.ADVANCED_SEGMENTER.suggest_spellings_distance_first(
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
            base = lexicon_service.DICT.get(cand, {})
            roman = base.get("roman", "")
            pos = base.get("pos", "") or "unknown"
            senses = base.get("senses", []) or []
            if not base:
                senses = ["[no dictionary entry found for this candidate]"]
                try:
                    g2p_result = g2p_engine.get_g2p_data(cand)
                    if g2p_result and g2p_result.get("syllables"):
                        roman = " ".join(
                            s.get("roman", "")
                            for s in g2p_result["syllables"]
                            if s.get("roman")
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
        island_fills = [
            fill_service._fill_token_with_dict_for_ui(t) for t in island_tokens
        ]
        if 0 <= token_idx_in_island < len(island_tokens):
            fill = island_fills[token_idx_in_island]
    if not fill:
        fill = fill_service._fill_token_with_dict_for_ui(base_token)
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
        token_fills = [
            fill_service._fill_token_with_dict_for_ui(t) for t in token_units
        ]

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
                _token_contains_unknown_piece(
                    token_fills[token_idx_in_island], unknown_piece
                )
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

    def _find_unknown_run(
        pieces: list[dict], target_idx: int
    ) -> tuple[int, int] | None:
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
        pieces[i].get("head")
        for i in range(run_start, run_end + 1)
        if pieces[i].get("head")
    ]

    expanded_matches: list[dict] = []
    attempts: list[dict] = []
    island_attempts: list[dict] = []
    final_raw: list[dict] = []

    n_pieces = len(pieces)

    initial_span_pieces = pieces[run_start : run_end + 1]
    initial_span_heads = [
        pc.get("head") for pc in initial_span_pieces if pc.get("head")
    ]
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
        bk = getattr(lm_runtime_service.state.ADVANCED_SEGMENTER, "_bk_tree", None)
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
            pieces[i].get("head")
            for i in range(span_start, run_start)
            if pieces[i].get("head")
        )
        right = "".join(
            pieces[i].get("head")
            for i in range(run_end + 1, span_end + 1)
            if pieces[i].get("head")
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
            pieces[i].get("head")
            for i in range(span_start, span_end + 1)
            if pieces[i].get("head")
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
                    if callable(lm_runtime_service.state.get_unigram_cost):
                        try:
                            return float(
                                lm_runtime_service.state.get_unigram_cost(word)
                            )
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
            key=lambda g: (int(g.get("span_len") or 0), len(g.get("span_text") or "")),
            reverse=True,
        )
        # Global cap across all groups: prefer longer spans, then unigram cost within each.
        remaining = (
            max_suggestions
            if isinstance(max_suggestions, int) and max_suggestions > 0
            else 10
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
