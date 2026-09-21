"""Burmese reader: text extraction."""

from __future__ import annotations

import io

from flask import (
    Blueprint,
    jsonify,
    request,
)

from . import document_support as document_support_service

bp = Blueprint("text_extraction", __name__)


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
        if (
            current_char_count > 0
            and current_char_count + line_len + 1 > CHARS_PER_PAGE
        ):
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
    if document_support_service.python_docx is None:
        raise RuntimeError("python-docx not installed")

    doc = document_support_service.python_docx.Document(io.BytesIO(docx_bytes))
    text_parts: list[str] = []
    for para in doc.paragraphs:
        if para.text:
            text_parts.append(para.text)
    return "\n".join(text_parts)


@bp.route("/api/extract_text_simple", methods=["POST"])
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


@bp.route("/api/extract_text_simple_from_text", methods=["POST"])
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
