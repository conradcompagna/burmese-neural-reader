$script = @'
import math, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

def levenshtein(a, b):
    if a == b: return 0
    la, lb = len(a), len(b)
    if la == 0: return lb
    if lb == 0: return la
    if la > lb:
        a, b = b, a
        la, lb = lb, la
    prev = list(range(lb + 1))
    curr = [0] * (lb + 1)
    for i in range(1, la + 1):
        curr[0] = i
        ca = a[i - 1]
        for j in range(1, lb + 1):
            cb = b[j - 1]
            cost = 0 if ca == cb else 1
            curr[j] = min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
        prev, curr = curr, prev
    return prev[lb]

def read_vocab():
    vocab = set()
    root = Path("myWord-main")
    with open(root / "unigram-word.txt", "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                w, _ = line.split("\t", 1)
            except Exception:
                continue
            vocab.add(w)
    return vocab

target = "ဓြေ"
correct = "မြေ"
max_edit = 3
vocab = read_vocab()
len_t = len(target)
cands = []
for w in vocab:
    if abs(len(w) - len_t) > max_edit:
        continue
    d = levenshtein(target, w)
    if d == 0 or d > max_edit:
        continue
    cands.append((d, w))

cands.sort(key=lambda x: (x[0], x[1]))
top = cands[:50]

print(f"total candidates after filter: {len(cands)}")
print(f"top 50 contains correct? {'yes' if any(w == correct for _, w in top) else 'no'}")
print("top 20:")
for d, w in top[:20]:
    print(f"{d}\t{w}")
'@

Set-Content tmp_spell.py -Value $script -Encoding UTF8
python -X utf8 tmp_spell.py
Remove-Item tmp_spell.py
