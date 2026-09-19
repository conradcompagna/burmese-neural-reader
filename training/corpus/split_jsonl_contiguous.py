#!/usr/bin/env python3
import argparse
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in_jsonl", required=True)
    ap.add_argument("--train_out", required=True)
    ap.add_argument("--dev_out", required=True)
    ap.add_argument("--test_out", required=True)
    ap.add_argument("--train_ratio", type=float, default=0.8)
    ap.add_argument("--dev_ratio", type=float, default=0.1)
    ap.add_argument("--test_ratio", type=float, default=0.1)
    args = ap.parse_args()

    lines = Path(args.in_jsonl).read_text(encoding="utf-8").splitlines()
    n = len(lines)
    n_train = int(n * args.train_ratio)
    n_dev = int(n * args.dev_ratio)
    n_test = n - n_train - n_dev

    train = lines[:n_train]
    dev = lines[n_train : n_train + n_dev]
    test = lines[n_train + n_dev :]

    Path(args.train_out).write_text("\n".join(train) + ("\n" if train else ""), encoding="utf-8")
    Path(args.dev_out).write_text("\n".join(dev) + ("\n" if dev else ""), encoding="utf-8")
    Path(args.test_out).write_text("\n".join(test) + ("\n" if test else ""), encoding="utf-8")

    print(f"Split {args.in_jsonl}: train={len(train)} dev={len(dev)} test={len(test)}")


if __name__ == "__main__":
    main()
