"""Burmese reader: debug pos."""

from __future__ import annotations
from .templating import render_debug_template

import html

from flask import (
    Blueprint,
    Response,
    jsonify,
    request,
)

from . import pos as pos_service

bp = Blueprint("debug_pos", __name__)


@bp.route("/debug/pos", methods=["GET"])
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
    if pos_service.state.POS_TAGGER is None:
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
        debug_info = pos_service.state.POS_TAGGER.debug_score_word(
            word, prev_pos=prev_pos
        )
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
        pos_tags = pos_service.state.POS_TAGGER.stats.get_all_pos_for_word(word)
        # If not in corpus, check dictionary
        if not pos_tags and pos_service.state.DICT_POS_LOOKUP:
            pos_tags = pos_service.state.DICT_POS_LOOKUP.get(word, set())
        # Create token with all possible POS (pipe-separated if multiple)
        pos_str = "|".join(sorted(pos_tags)) if pos_tags else ""
        tokens.append({"word": word, "pos": pos_str})
    # Tag the sequence
    tagged = pos_service.state.POS_TAGGER.tag_tokens(
        tokens, pos_service.state.DICT_POS_LOOKUP
    )
    # Get detailed debug info for each word
    results = []
    prev_pos = None
    for i, token in enumerate(tagged):
        word = token["word"]
        chosen_pos = token.get("pos")
        pos_probs = token.get("pos_probs", {})
        # Get full debug breakdown
        candidates = pos_service.state.POS_TAGGER.stats.get_all_pos_for_word(word)
        if not candidates and pos_service.state.DICT_POS_LOOKUP:
            candidates = pos_service.state.DICT_POS_LOOKUP.get(word, set())
        if candidates:
            debug = pos_service.state.POS_TAGGER.debug_score_word(
                word, prev_pos=prev_pos, candidates=candidates
            )
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
    html_output = render_debug_template(
        "debug/render-pos-debug-html.html",
        [f"{html.escape(word)}", f"{html.escape(word)}"],
    )
    if prev_pos:
        pos_label = pos_service.POS_DISPLAY_LABELS.get(prev_pos, prev_pos.upper())
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
    html_output += (
        f"<p>Total corpus occurrences: <strong>{uni['total_count']}</strong></p>"
    )
    html_output += "<table><tr><th>POS</th><th>Probability</th><th>Count</th><th>Distribution</th></tr>"
    for pos, prob in sorted(uni["probabilities"].items(), key=lambda x: -x[1]):
        count = uni["raw_counts"].get(pos, 0)
        bar_width = int(prob * 300)
        pos_label = pos_service.POS_DISPLAY_LABELS.get(pos, pos.upper())
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
                pos_label = pos_service.POS_DISPLAY_LABELS.get(pos, pos.upper())
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
        pos_label = pos_service.POS_DISPLAY_LABELS.get(pos, pos.upper())
        row_class = "winner" if pos == final["winner"] else ""
        badge = (
            '<span class="badge winner">WINNER</span>' if pos == final["winner"] else ""
        )
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
        pos_label = pos_service.POS_DISPLAY_LABELS.get(pos, pos.upper())
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
    html_output = render_debug_template(
        "debug/render-pos-sentence-debug-html.html",
        [f"{html.escape(text)}", f"{html.escape(text)}", f"{debug_info['word_count']}"],
    )
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
            pos_label = pos_service.POS_DISPLAY_LABELS.get(prev_pos, prev_pos.upper())
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
                pos_label = pos_service.POS_DISPLAY_LABELS.get(
                    chosen_pos, chosen_pos.upper()
                )
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
                for pos, prob in sorted(
                    uni["probabilities"].items(), key=lambda x: -x[1]
                )[:5]:  # Top 5
                    count = uni["raw_counts"].get(pos, 0)
                    bar_width = int(prob * 200)
                    pos_label = pos_service.POS_DISPLAY_LABELS.get(pos, pos.upper())
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
                    for pos, prob in sorted(
                        bi["probabilities"].items(), key=lambda x: -x[1]
                    )[:5]:  # Top 5
                        count = bi["raw_counts"].get(pos, 0)
                        bar_width = int(prob * 200)
                        pos_label = pos_service.POS_DISPLAY_LABELS.get(pos, pos.upper())
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
                    pos_label = pos_service.POS_DISPLAY_LABELS.get(pos, pos.upper())
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
