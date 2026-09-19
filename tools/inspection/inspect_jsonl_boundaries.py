#!/usr/bin/env python3
import json, argparse
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in_jsonl", required=True)
    ap.add_argument("--n_show", type=int, default=3)
    args = ap.parse_args()

    n_rec = 0
    n_tok = 0
    n_bnd = 0
    n_upos_known = 0
    n_upos_total = 0
    examples = 0

    with open(args.in_jsonl, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            toks = rec.get("tokens") or []
            y = rec.get("sent_end_after") or []
            pos = rec.get("pos") or []

            if not toks:
                continue

            n_rec += 1
            n_tok += len(toks)
            n_bnd += sum(1 for v in y if int(v) == 1)

            for p in pos:
                u = (p.get("upos") or "").strip()
                n_upos_total += 1
                if u and u != "X":
                    n_upos_known += 1

            if examples < args.n_show and y:
                idxs = [i for i, v in enumerate(y) if int(v) == 1]
                if idxs:
                    i = idxs[0]
                    left = " ".join(toks[max(0, i - 8) : i + 1])
                    right = " ".join(toks[i + 1 : i + 9])
                    print(f"\nExample boundary @ {i}:")
                    print(left, " <SENT_END> ", right)
                    examples += 1

    print("\n--- SUMMARY ---")
    print("records:", n_rec)
    print("tokens:", n_tok)
    print("boundaries:", n_bnd)
    print("boundary_rate:", (n_bnd / n_tok) if n_tok else 0.0)
    print("upos_known_rate:", (n_upos_known / n_upos_total) if n_upos_total else 0.0)


if __name__ == "__main__":
    main()
