"""Burmese reader: document conversion."""

from __future__ import annotations

import io
import math
import tempfile
import textwrap
from pathlib import Path
from typing import Any

from . import (
    document_support as document_support_service,
    pdf_extraction as pdf_extraction_service,
)


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


def _extract_docx_text_direct(docx_bytes: bytes) -> list[str]:
    """
    Extract text directly from DOCX using python-docx.
    Returns list of page-like chunks based on section/page breaks or character heuristic.
    """
    if document_support_service.python_docx is None:
        raise RuntimeError("python-docx not installed. Run: pip install python-docx")

    # Load DOCX from bytes
    doc = document_support_service.python_docx.Document(io.BytesIO(docx_bytes))

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
    return pdf_extraction_service._extract_pdf_pages_from_bytes(pdf_bytes)


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
    return pdf_extraction_service._extract_pdf_pages_from_bytes(pdf_bytes)
