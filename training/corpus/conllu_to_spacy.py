from conllu import parse_incr
import json
import sys


def convert(infile, outfile):
    examples = []

    with open(infile, "r", encoding="utf-8") as f:
        for sent in parse_incr(f):
            tokens = []
            pos = []
            heads = []
            deps = []

            for t in sent:
                if t["id"] is None or isinstance(t["id"], tuple):
                    continue
                tokens.append(t["form"])
                pos.append(t["upos"])
                heads.append(t["head"] - 1 if t["head"] > 0 else -1)
                deps.append(t["deprel"])

            examples.append({"tokens": tokens, "pos": pos, "heads": heads, "deps": deps})

    with open(outfile, "w", encoding="utf-8") as out:
        json.dump(examples, out, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    convert(sys.argv[1], sys.argv[2])
