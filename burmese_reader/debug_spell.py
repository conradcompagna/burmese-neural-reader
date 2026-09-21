"""Burmese reader: debug spell."""

from __future__ import annotations

import html

from flask import (
    Blueprint,
    Response,
    request,
)

from . import (
    lexicon as lexicon_service,
    lm_runtime as lm_runtime_service,
    normalization as normalization_service,
    pipeline as pipeline_service,
)

bp = Blueprint("debug_spell", __name__)


@bp.route("/debug/spell", methods=["GET", "POST"])
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
    q = normalization_service.normalize_burmese_for_segmentation(
        raw_q, extended_hits=extended_hits
    )
    if not q:
        return Response(
            "ERROR: query contains no Burmese after normalization\n",
            status=400,
            mimetype="text/plain; charset=utf-8",
        )
    # 3) Segment whole input once (for unknown counting + context)
    segments = pipeline_service.segment_with_pipeline(q)
    # 4) Unknown counting (DICT-based)
    unknown_counts: dict[str, int] = {}
    first_index: dict[str, int] = {}
    for idx, w in enumerate(segments):
        if not w or not normalization_service.contains_burmese(w):
            continue
        w_key = normalization_service.normalize_headword(w)
        if w_key in lexicon_service.DICT:
            continue
        unknown_counts[w] = unknown_counts.get(w, 0) + 1
        if w not in first_index:
            first_index[w] = idx
    unknown_set = set(unknown_counts.keys())
    # 5) Phrase splitting: runs of Burmese between whitespace or Myanmar comma/period
    phrases: list[str] = []
    current_chars: list[str] = []
    for ch in q:
        if ch.isspace() or ch in normalization_service.MYANMAR_PUNCT:
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
        return pipeline_service.segment_with_pipeline(phrase)

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
                seg_html_tokens.append(
                    f'<span class="seg-phrase-sep"> {PHRASE_SEP} </span>'
                )
            phrase_segs = segment_phrase(phrase)
            n_segs = len(phrase_segs)
            for t_idx, seg in enumerate(phrase_segs):
                if not seg or not normalization_service.contains_burmese(seg):
                    continue
                esc = html.escape(seg)
                if seg in unknown_set:
                    seg_html_tokens.append(
                        f'<span class="seg-unknown">[[{esc}]]</span>'
                    )
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
        html_parts.append(
            '<div class="section-title">Unknown tokens + suggestions:</div>'
        )
        if not unknown_counts:
            html_parts.append("<p>[no unknown Burmese tokens in this input]</p>")
            html_parts.append("</body></html>")
            return Response(
                "\n".join(html_parts),
                mimetype="text/html; charset=utf-8",
            )
        if lm_runtime_service.state.ADVANCED_SEGMENTER is None:
            html_parts.append(
                "<p>[spell] ADVANCED_SEGMENTER not initialised (no suggestions)</p>"
            )
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
                suggs = (
                    lm_runtime_service.state.ADVANCED_SEGMENTER.suggest_spellings_dict(
                        w, prev_word=prev_word, next_word=next_word
                    )
                )
            except Exception as e:
                unknown_lines.append(
                    f"UNKNOWN ({count}ÃÆÃ¢â¬â): {w}  -> [spell error: {e}]"
                )
                continue
            if not suggs:
                unknown_lines.append(
                    f"UNKNOWN ({count}ÃÆÃ¢â¬â): {w}  -> [no suggestions]"
                )
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
            if not seg or not normalization_service.contains_burmese(seg):
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
    if lm_runtime_service.state.ADVANCED_SEGMENTER is None:
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
            suggs = lm_runtime_service.state.ADVANCED_SEGMENTER.suggest_spellings_dict(
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
                lines.append(
                    f"UNKNOWN ({count}ÃÆÃ¢â¬â): {w}  -> " + ", ".join(cand_words)
                )
            else:
                lines.append(
                    f"UNKNOWN ({count}ÃÆÃ¢â¬â): {w}  -> [no candidate strings]"
                )
    return Response(
        "\n".join(lines) + "\n",
        mimetype="text/plain; charset=utf-8",
    )
