import csv
import re
import sys
import json
from typing import Dict, Any, List

# Myanmar (basic + extended-A)
MYANMAR_RE = re.compile(r'[\u1000-\u109F\uAA60-\uAA7F]')

def has_myanmar(text: str) -> bool:
    return bool(MYANMAR_RE.search(text or ""))

def is_ascii_only(text: str) -> bool:
    return bool(text) and not has_myanmar(text)

def strip_suffix(headword: str) -> str:
    """
    If the headword starts with Myanmar letters/spaces and then has a
    non-Myanmar suffix with no Myanmar characters at all, strip that suffix.

    Examples:
      "ထောင် J"         -> "ထောင်"
      "သောင်း °"        -> "သောင်း"
      "ကားစင် m ... "   -> "ကားစင်"
    """
    if not headword:
        return headword

    s = headword
    prefix_chars: List[str] = []

    for ch in s:
        # Keep Myanmar and whitespace in the prefix
        if re.match(r'[\u1000-\u109F\uAA60-\uAA7F\s]', ch):
            prefix_chars.append(ch)
        else:
            break

    prefix = "".join(prefix_chars)
    if prefix and prefix != s:
        suffix = s[len(prefix):]
        # Only strip if the suffix has no Myanmar at all
        if not has_myanmar(suffix):
            return prefix.strip()

    return headword

def identify_numeric_correction(row: Dict[str, Any]) -> str:
    """
    Spot a few specific OCR'd numeric lemmas whose headwords are garbage
    but whose romanization/definition clearly identify them.

    Returns a corrected Burmese headword (e.g. "ဆယ်", "လေး", "ရာ"),
    or "" if no correction should be applied.
    """
    hw = (row.get("headword") or "").strip()
    roma = (row.get("romanization") or "").strip()
    defin = (row.get("definition") or "").strip()

    # Only try to "repair" totally non-Myanmar headwords
    if not is_ascii_only(hw):
        return ""

    # 1) ဆယ် (ten)
    # e.g. headword "2005°", roma "hse", definition "ten."
    if re.fullmatch(r'(7\s*)?ten\.', defin, flags=re.IGNORECASE):
        if roma in ("hse", "hsei", "hce"):
            return "ဆယ်"

    # 2) လေး (four)
    # e.g. headword "coon", roma "lei:", definition "7 four. 434 လေး"
    if "four." in defin.lower() and "လေး" in defin:
        if roma in ("lei:", "le:"):
            return "လေး"

    # 3) ရာ (hundred)
    # e.g. headword "6p4", roma "ja", definition "7 hundred."
    if "hundred." in defin.lower():
        return "ရာ"

    return ""

# Very simple POS whitelist; we mainly clean completely crazy POS like "cocoa."
POS_WHITELIST_RE = re.compile(
    r'^(n|v|adj|adv|num|pron|aux|prep|postp|conj|interj|part|m|nm)\b',
    re.I,
)

def normalize_pos(pos: str) -> str:
    pos = (pos or "").strip()
    if not pos:
        return ""
    if not POS_WHITELIST_RE.match(pos):
        return ""
    return pos

BRACKETED_RE = re.compile(r'\[[^]]*\]')

def clean_definition(defin: str) -> str:
    """
    Light-weight cleaning of the definition field:
    - remove bracketed metadata: [Pali ...], [Mon ...], etc.
    - strip leading "7", "7#", "7:", "72" markup
    - drop "See illus at ..." trailers
    - collapse whitespace
    """
    s = defin or ""

    # Drop bracketed notes
    s = BRACKETED_RE.sub(" ", s)

    # Strip leading 7/7#/72 etc. (BLC sense markers)
    s = re.sub(r'^\s*7[#\d:]*\s*', ' ', s)

    # Drop "See illus at ..." trailing notes
    s = re.sub(r'\bSee illus at.*$', ' ', s, flags=re.IGNORECASE)

    # Collapse whitespace
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def clean_file(in_path: str, out_path: str, report_path: str) -> None:
    with open(in_path, "r", encoding="utf-8", newline="") as inf:
        reader = csv.DictReader(inf, delimiter="\t")
        fieldnames = reader.fieldnames

        if not fieldnames:
            raise RuntimeError("No header row found in input TSV.")

        # We only care about these four; if the file has more columns,
        # they will be ignored and definition extended below if needed.
        required = ["headword", "romanization", "pos", "definition"]
        for col in required:
            if col not in fieldnames:
                raise RuntimeError(f"Required column '{col}' not found in TSV header: {fieldnames}")

        rows = list(reader)

    cleaned_rows: List[Dict[str, Any]] = []
    changes: List[Dict[str, Any]] = []
    attached_orphans: List[Dict[str, Any]] = []
    dropped_orphans: List[Dict[str, Any]] = []
    ascii_headwords: List[Dict[str, Any]] = []

    last_lemma_idx = None  # index in cleaned_rows of last "real" Burmese headword

    for idx, row in enumerate(rows):
        orig_head = (row.get("headword") or "").strip()
        roman = (row.get("romanization") or "").strip()
        pos = (row.get("pos") or "").strip()
        defin = (row.get("definition") or "").strip()

        # 1) strip non-Myanmar suffixes from headword
        hw = strip_suffix(orig_head)
        if hw != orig_head:
            changes.append({
                "index": idx,
                "type": "strip_suffix",
                "old_headword": orig_head,
                "new_headword": hw,
            })

        # 2) attempt numeric headword repair if headword is still non-Myanmar
        numeric_fix = identify_numeric_correction({
            "headword": hw,
            "romanization": roman,
            "definition": defin,
        })
        if numeric_fix:
            if numeric_fix != hw:
                changes.append({
                    "index": idx,
                    "type": "numeric_fix",
                    "old_headword": hw,
                    "new_headword": numeric_fix,
                })
                hw = numeric_fix
            # POS: upgrade to num if it's missing or nouny
            if not pos or pos.lower().startswith("n"):
                pos = "num"

        # 3) clean POS and definition
        pos = normalize_pos(pos)
        defin_clean = clean_definition(defin)

        # track ASCII-only headwords (even after all fixes) for manual inspection
        if is_ascii_only(hw):
            ascii_headwords.append({
                "index": idx,
                "headword": hw,
                "romanization": roman,
                "pos": pos,
                "definition": defin,
            })

        # Decide if this row is a lemma (real Burmese headword) or an "orphan" continuation.
        if has_myanmar(hw):
            # lemma row
            row_out = {
                "headword": hw,
                "romanization": roman,
                "pos": pos,
                "definition": defin_clean,
            }

            cleaned_rows.append(row_out)
            last_lemma_idx = len(cleaned_rows) - 1

        else:
            # No Burmese in headword AFTER all attempts to fix: treat as orphan/continuation.
            if last_lemma_idx is not None and defin_clean:
                lemma = cleaned_rows[last_lemma_idx]

                # Merge romanization if it's actually new
                if roman:
                    old_r = lemma.get("romanization", "").strip()
                    if roman not in (r.strip() for r in old_r.split("/") if r.strip()):
                        lemma["romanization"] = " / ".join(
                            [x for x in [old_r, roman] if x]
                        )

                # Merge POS only if lemma has none and this row has something
                if not lemma.get("pos") and pos:
                    lemma["pos"] = pos

                # Append definition
                old_def = lemma.get("definition", "")
                if old_def:
                    lemma["definition"] = (old_def + " " + defin_clean).strip()
                else:
                    lemma["definition"] = defin_clean

                attached_orphans.append({
                    "index": idx,
                    "attached_to_headword": lemma["headword"],
                    "original_headword": orig_head,
                    "romanization": roman,
                    "pos": pos,
                    "definition": defin,
                })
            else:
                # orphan with no preceding lemma, or no usable definition -> drop
                if orig_head or defin_clean:
                    dropped_orphans.append({
                        "index": idx,
                        "headword": orig_head,
                        "romanization": roman,
                        "pos": pos,
                        "definition": defin,
                    })
                # nothing added to cleaned_rows for this row

    # Write cleaned TSV
    with open(out_path, "w", encoding="utf-8", newline="") as outf:
        writer = csv.DictWriter(outf, fieldnames=["headword", "romanization", "pos", "definition"], delimiter="\t")
        writer.writeheader()
        for row in cleaned_rows:
            writer.writerow(row)

    # Write JSON report of what happened
    report = {
        "changes": changes,
        "attached_orphans": attached_orphans,
        "dropped_orphans": dropped_orphans,
        "ascii_only_headwords": ascii_headwords,
        "input_rows": len(rows),
        "output_rows": len(cleaned_rows),
    }
    with open(report_path, "w", encoding="utf-8") as repf:
        json.dump(report, repf, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python clean_mmd.py IN_TSV OUT_TSV REPORT_JSON", file=sys.stderr)
        sys.exit(1)
    clean_file(sys.argv[1], sys.argv[2], sys.argv[3])
