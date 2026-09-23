"""Burmese reader: pdf extraction."""

from __future__ import annotations

import io

from . import (
    document_conversion as document_conversion_service,
    document_support as document_support_service,
)


def _extract_pdf_pages_and_dims_from_bytes(
    data: bytes,
) -> tuple[list[str], list[dict], dict | None]:
    """Return per-page text + per-page dimensions + average dimensions."""
    if not data:
        empty_dim = document_conversion_service._make_pdf_page_dim(0, 0)
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
            page_dims.append(
                document_conversion_service._make_pdf_page_dim(rect.width, rect.height)
            )
        doc.close()
        if pages:
            print(f"[INFO] PDF extracted with PyMuPDF: {len(pages)} pages")
            return (
                pages,
                page_dims,
                document_conversion_service._average_pdf_page_dims(page_dims),
            )
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
                    if (
                        box is not None
                        and hasattr(box, "width")
                        and hasattr(box, "height")
                    ):
                        dim = document_conversion_service._make_pdf_page_dim(
                            box.width, box.height
                        )
                    elif box is not None:
                        dim = document_conversion_service._make_pdf_page_dim(
                            float(getattr(box, "right", 0))
                            - float(getattr(box, "left", 0)),
                            float(getattr(box, "top", 0))
                            - float(getattr(box, "bottom", 0)),
                        )
                except Exception:
                    dim = None
                page_dims.append(
                    dim or document_conversion_service._make_pdf_page_dim(0, 0)
                )
            if pages:
                print(f"[INFO] PDF extracted with {mod}: {len(pages)} pages")
                return (
                    pages,
                    page_dims,
                    document_conversion_service._average_pdf_page_dims(page_dims),
                )
        except ImportError:
            errors.append(f"{mod} not installed")
        except Exception as e:
            errors.append(f"{mod} error: {e}")

    # 3) pdfplumber (only if installed)
    try:
        if document_support_service.pdfplumber is not None:
            pages: list[str] = []
            page_dims: list[dict] = []
            with document_support_service.pdfplumber.open(io.BytesIO(data)) as pdf:
                for p in pdf.pages:
                    try:
                        pages.append(p.extract_text() or "")
                    except Exception:
                        pages.append("")
                    page_dims.append(
                        document_conversion_service._make_pdf_page_dim(
                            getattr(p, "width", 0), getattr(p, "height", 0)
                        )
                    )
            if pages:
                print(f"[INFO] PDF extracted with pdfplumber: {len(pages)} pages")
                return (
                    pages,
                    page_dims,
                    document_conversion_service._average_pdf_page_dims(page_dims),
                )
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
        if document_support_service.pdfplumber is not None:
            pages: list[str] = []
            with document_support_service.pdfplumber.open(io.BytesIO(data)) as pdf:
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
        if document_support_service.pdfplumber is not None:
            with document_support_service.pdfplumber.open(io.BytesIO(data)) as pdf:
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
