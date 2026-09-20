import sys
import numpy as np
import spacy
from conllu import parse_incr
from spacy.tokens import DocBin
from spacy.attrs import HEAD, DEP, TAG, POS


def conllu_to_docbin(in_path: str, out_path: str) -> None:
    nlp = spacy.blank("xx")
    docbin = DocBin(store_user_data=True)

    with open(in_path, "r", encoding="utf-8") as f:
        for sent in parse_incr(f):
            rows = []
            for t in sent:
                # skip multiword tokens / empty nodes
                if t["id"] is None or isinstance(t["id"], tuple):
                    continue
                rows.append(t)

            if not rows:
                continue

            words = [t["form"] for t in rows]
            upos = [t["upos"] for t in rows]
            deprel = [t["deprel"] for t in rows]
            head_abs = [t["head"] for t in rows]  # 1-based, 0 for root

            # Force tokenization to match UD tokens exactly
            doc = spacy.tokens.Doc(nlp.vocab, words=words)

            # Convert absolute heads to spaCy HEAD offsets (relative)
            head_offsets = []
            for i, h in enumerate(head_abs):
                if h == 0 or h is None:
                    head_offsets.append(0)  # root points to self
                else:
                    head_i = h - 1  # UD is 1-based
                    head_offsets.append(head_i - i)

            # Ensure strings exist in vocab
            dep_hashes = [nlp.vocab.strings.add(d) for d in deprel]
            # Use UPOS for both POS and TAG so spaCy tagger has labels
            pos_hashes = [nlp.vocab.strings.add(p) for p in upos]
            tag_hashes = [nlp.vocab.strings.add(p) for p in upos]

            attrs = [HEAD, DEP, POS, TAG]
            arr = np.zeros((len(doc), len(attrs)), dtype="uint64")
            arr[:, 0] = np.array(head_offsets, dtype="int64").astype("uint64")
            arr[:, 1] = np.array(dep_hashes, dtype="uint64")
            arr[:, 2] = np.array(pos_hashes, dtype="uint64")
            arr[:, 3] = np.array(tag_hashes, dtype="uint64")

            doc.from_array(attrs, arr)
            docbin.add(doc)

    docbin.to_disk(out_path)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python conllu_to_docbin.py input.conllu output.spacy")
        sys.exit(1)
    conllu_to_docbin(sys.argv[1], sys.argv[2])
