#!/usr/bin/env python3
import argparse, json
from pathlib import Path

SENT_MARK = "<SENT_END>"


def clean_text(s: str) -> str:
    return s.replace(SENT_MARK, " ").replace("  ", " ").strip()


def main(in_path: str, out_path: str, max_len: int, stride: int, keep_text: bool):
    out = Path(out_path).open("w", encoding="utf-8")
    n_in = n_out = 0

    with Path(in_path).open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            n_in += 1
            rec = json.loads(line)

            tokens = rec["tokens"]
            pos = rec["pos"]
            y = rec["sent_end_after"]
            assert len(tokens) == len(pos) == len(y), "length mismatch"

            text = rec.get("text", None)
            if text is not None:
                text = clean_text(text)

            for start in range(0, len(tokens), stride):
                end = min(len(tokens), start + max_len)
                if end - start < 5:
                    break

                sub = {
                    "tokens": tokens[start:end],
                    "pos": [
                        {
                            "i": i - start,
                            "tok": pos[i].get("tok", tokens[i]),
                            "upos": pos[i].get("upos", ""),
                            "tag": pos[i].get("tag", ""),
                        }
                        for i in range(start, end)
                    ],
                    "sent_end_after": y[start:end],
                }

                if keep_text and text is not None:
                    sub["text"] = text

                out.write(json.dumps(sub, ensure_ascii=False) + "\n")
                n_out += 1

                if end == len(tokens):
                    break

    out.close()
    print(f"WROTE {out_path} (in_records={n_in}, out_records={n_out})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--in_jsonl", required=True)
    ap.add_argument("--out_jsonl", required=True)
    ap.add_argument("--max_len", type=int, default=400)
    ap.add_argument("--stride", type=int, default=200)
    ap.add_argument("--keep_text", action="store_true")
    args = ap.parse_args()
    main(args.in_jsonl, args.out_jsonl, args.max_len, args.stride, args.keep_text)
