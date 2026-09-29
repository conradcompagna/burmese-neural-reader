#!/usr/bin/env python3
import argparse, json
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in_jsonl", required=True)
    ap.add_argument("--out_jsonl", required=True)
    ap.add_argument("--nth", type=int, default=2)
    ap.add_argument("--offset", type=int, default=0)
    args = ap.parse_args()

    inp = Path(args.in_jsonl).open("r", encoding="utf-8")
    out = Path(args.out_jsonl).open("w", encoding="utf-8")

    kept = total = 0
    for idx, line in enumerate(inp):
        total += 1
        if (idx - args.offset) % args.nth == 0:
            obj = json.loads(line)
            out.write(json.dumps(obj, ensure_ascii=False) + "\n")
            kept += 1

    inp.close()
    out.close()
    print(f"WROTE {args.out_jsonl} (kept {kept}/{total})")


if __name__ == "__main__":
    main()

