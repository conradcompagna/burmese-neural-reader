"""Burmese reader: document routes."""

from __future__ import annotations

import json

from flask import (
    Blueprint,
    Response,
    jsonify,
    request,
)

from . import (
    document_conversion as document_conversion_service,
    pdf_cache as pdf_cache_service,
    pdf_extraction as pdf_extraction_service,
    pdf_geometry as pdf_geometry_service,
)

bp = Blueprint("document_routes", __name__)


@bp.route("/api/pdf_page_text", methods=["POST"])
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

    pdf_path = pdf_cache_service._get_cached_pdf_path(cache_id)
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
        result = pdf_geometry_service._extract_page_words_and_blocks(page, scale=1.0)
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


@bp.route("/api/extract_text", methods=["POST"])
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
            page_count = pdf_extraction_service._extract_pdf_page_count_from_bytes(data)
            if page_count < 1:
                page_count = 1
            meta = {
                "pages": page_count,
                "backend": "pdf",
            }
        except Exception as e:
            return jsonify({"ok": False, "error": str(e) or "pdf_extract_failed"}), 500
        # Cache the PDF to disk for page rendering (avoids re-upload)
        cache_id = pdf_cache_service._cache_pdf_to_disk(data)
        meta["pdf_cache_id"] = cache_id
        return jsonify({"ok": True, "pages": [], "text": "", "meta": meta})

    elif filename.endswith(".docx"):
        try:
            pages = document_conversion_service._extract_docx_pages_from_bytes(data)
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


@bp.route("/api/extract_text_from_text", methods=["POST"])
def api_extract_text_from_text():
    data = request.get_json(silent=True) or {}
    text = data.get("text")
    text = "" if text is None else str(text)
    meta = {"backend": "text"}
    return jsonify({"ok": True, "text": text, "meta": meta})


@bp.route("/api/docx_to_pdf", methods=["POST"])
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
        pdf_bytes = document_conversion_service._convert_docx_to_pdf_bytes(data)
        # Return PDF as bytes with proper content-type
        return Response(pdf_bytes, mimetype="application/pdf")
    except Exception as e:
        return jsonify({"ok": False, "error": str(e) or "docx_to_pdf_failed"}), 500


@bp.route("/api/render_pdf_pages", methods=["POST"])
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
        pdf_path = pdf_cache_service._get_cached_pdf_path(cache_id)
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
            _wb = pdf_geometry_service._extract_page_words_and_blocks(page, scale=scale)
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
                    x0, y0, x1, y1, block_text, block_no = (
                        b[0],
                        b[1],
                        b[2],
                        b[3],
                        b[4],
                        b[5],
                    )
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
                    elif (
                        right_margin < margin_threshold
                        and left_margin > margin_threshold * 2
                    ):
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
