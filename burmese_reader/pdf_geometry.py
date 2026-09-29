"""Burmese reader: pdf geometry."""

from __future__ import annotations


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
