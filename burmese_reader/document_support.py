"""Burmese reader: document support."""

from __future__ import annotations

try:
    import pdfplumber  # pip install pdfplumber
except ImportError:
    pdfplumber = None


try:
    import docx as python_docx  # pip install python-docx
except ImportError:
    python_docx = None
