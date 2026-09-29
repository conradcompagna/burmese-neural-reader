"""Compare identical unique vocabularies; timings are observations, not test gates.

Run from the repository root: python -m research.evaluation.benchmark_bktree
"""
import argparse
import json
import random
import statistics
import time

from lmbrain import BKTree, levenshtein_distance


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--words", type=int, default=2000)
    parser.add_argument("--queries", type=int, default=12)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--seed", type=int, default=1729)
    args = parser.parse_args()
    if not (1 <= args.words <= 100000 and 1 <= args.queries <= args.words and args.repeats > 0):
        parser.error("Require 1 <= queries <= words <= 100000 and repeats > 0")
    rng = random.Random(args.seed)
    words = set()
    while len(words) < args.words:
        words.add("".join(rng.choices("ကခဂငစဆညတနမယရလဝသ", k=rng.randint(4, 10))))
    words = sorted(words)
    queries = [word[:-1] for word in rng.sample(words, args.queries)]
    tree = BKTree(levenshtein_distance)
    tree.build(words)

    def exhaustive(query):
        return [(word, d) for word in words if (d := levenshtein_distance(query, word)) <= 1]

    for query in queries:
        if sorted(tree.query(query, 1)) != sorted(exhaustive(query)):
            raise AssertionError("Tree and exhaustive results differ")

    def measure(search):
        samples = []
        for _ in range(args.repeats):
            start = time.perf_counter_ns()
            for query in queries:
                search(query)
            samples.append((time.perf_counter_ns() - start) / len(queries) / 1e6)
        return statistics.median(samples)

    tree_ms = measure(lambda query: tree.query(query, 1))
    scan_ms = measure(exhaustive)
    print(json.dumps({"seed": args.seed, "unique_words": tree.size, "queries": len(queries),
                      "repeats": args.repeats, "radius": 1, "tree_median_ms": tree_ms,
                      "scan_median_ms": scan_ms, "speedup": scan_ms / tree_ms if tree_ms else None}, indent=2))


if __name__ == "__main__":
    main()
