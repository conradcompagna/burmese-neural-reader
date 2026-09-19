#!/usr/bin/env python3
import json
import sys
import re

def clean_text(s: str) -> str:
    """Collapse whitespace and remove tabs/newlines."""
    s = s or ""
    s = s.replace("\t", " ").replace("\n", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()

def extract_roman(forms):
    """Pick the first form tagged as a romanization."""
    if not isinstance(forms, list):
        return ""
    for f in forms:
        if not isinstance(f, dict):
            continue
        form = f.get("form", "")
        tags = f.get("tags", []) or []
        if "romanization" in tags and form:
            return form
    return ""

def main(in_path: str, out_path: str):
    count_entries = 0
    count_rows = 0

    with open(in_path, "r", encoding="utf-8") as inf, \
         open(out_path, "w", encoding="utf-8", newline="") as outf:

        # header compatible with your backend
        outf.write("headword\tromanization\tpos\tdefinition\n")

        for line in inf:
            line = line.strip()
            if not line:
                continue

            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            # Make sure it's Burmese
            if obj.get("lang") not in ("Burmese",) and obj.get("lang_code") not in ("my",):
                continue

            head = clean_text(obj.get("word", ""))
            if not head:
                continue

            roman = clean_text(extract_roman(obj.get("forms", [])))
            pos = clean_text(obj.get("pos", ""))

            senses = obj.get("senses", [])
            if not isinstance(senses, list) or not senses:
                continue

            count_entries += 1

            for sense in senses:
                if not isinstance(sense, dict):
                    continue

                glosses = sense.get("glosses") or sense.get("raw_glosses") or []
                if isinstance(glosses, str):
                    glosses = [glosses]
                if not glosses:
                    continue

                gloss_text = "; ".join(clean_text(g) for g in glosses if clean_text(g))
                if not gloss_text:
                    continue

                row = "\t".join([
                    head,
                    roman,
                    pos,
                    gloss_text,
                ])
                outf.write(row + "\n")
                count_rows += 1

    print(f"Done. Entries processed: {count_entries}, TSV rows written: {count_rows}")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python kaikki_to_tsv.py kaikki.org-dictionary-Burmese.jsonl out.tsv")
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
