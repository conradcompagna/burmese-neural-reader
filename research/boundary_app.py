# boundary_app.py
import os
import re
import html
import requests
from flask import Flask, request, Response

app = Flask(__name__)

NEWSERVER_BASE_URL = os.environ.get("NEWSERVER_BASE_URL", "http://127.0.0.1:5000")
REQUEST_TIMEOUT = float(os.environ.get("REQUEST_TIMEOUT", "30"))

# Myanmar punctuation
MYANMAR_COMMA = "၊"
MYANMAR_PERIOD = "။"

SENT_MARKER = "⟨SENT_END⟩"
PHRASE_MARKER = "⟨PHRASE⟩"

# Sentence-final phrase particles (Stc~) from burmese_grammar_dictionary.tsv (hard-coded list)
SENTENCE_FINAL_PARTICLES = {
    "စ",
    "ပါ",
    "ပေ",
    "ပဲ",
    "လေ",
    "လဲ",
    "ဟာ",
    "ကပဲ",
    "စုံ",
    "နော",
    "ပင်",
    "ပါ့",
    "ပုံ",
    "ရယ်",
    "လား",
    "လော",
    "ကိုး",
    "တကား",
    "တည်း",
    "တုံး",
    "နည်း",
    "နော်",
    "နှော",
    "ပေါ့",
    "သကော",
    "ချည့်",
    "ချည်း",
    "တမုံ့",
    "ပုံစံ",
    "ဥစ္စာ",
    "ပုံစံမျိုး",
}

ZW_CHARS = {"\u200b", "\u200c", "\u200d", "\ufeff"}

# -----------------------------
# Myanmar char detection + normalization
# -----------------------------
def is_myanmar_char(ch: str) -> bool:
    cp = ord(ch)
    return (
        0x1000 <= cp <= 0x109F
        or 0xA9E0 <= cp <= 0xA9FF
        or 0xAA60 <= cp <= 0xAA7F
    )

def normalize_keep_newlines(text: str) -> str:
    """
    Keep:
      - Myanmar block chars
      - Myanmar comma/period
      - whitespace + newlines
    Everything else -> space
    """
    out = []
    for ch in text:
        if ch == "\r":
            continue
        if ch == "\n":
            out.append("\n")
            continue
        if is_myanmar_char(ch) or ch in (MYANMAR_COMMA, MYANMAR_PERIOD):
            out.append(ch)
        elif ch.isspace():
            out.append(" ")
        else:
            out.append(" ")
    return "".join(out)

def collapse_spaces_preserve_newlines(s: str) -> str:
    lines = []
    for line in s.split("\n"):
        line = re.sub(r"[ \t]+", " ", line).strip()
        lines.append(line)
    return "\n".join(lines).strip()

# -----------------------------
# newserver /segment
# -----------------------------
def newserver_segment(text_myanmar: str):
    r = requests.get(
        f"{NEWSERVER_BASE_URL}/segment",
        params={"q": text_myanmar},
        timeout=REQUEST_TIMEOUT,
    )
    r.raise_for_status()
    data = r.json()
    if not data.get("ok"):
        raise RuntimeError(data.get("error") or "newserver /segment returned ok=false")
    return data.get("segments") or []

def split_myanmar_punct_from_token(tok: str):
    """
    Ensure '၊' and '။' become standalone tokens even if newserver returns them attached.
    """
    out = []
    buf = []
    for ch in tok:
        if ch in (MYANMAR_COMMA, MYANMAR_PERIOD):
            if buf:
                out.append("".join(buf))
                buf = []
            out.append(ch)
        else:
            buf.append(ch)
    if buf:
        out.append("".join(buf))
    return [t for t in out if t]

def segment_text_with_paragraphs(text: str):
    """
    Split paragraphs on 1+ newlines, segment each paragraph, reinsert paragraph breaks as None markers.
    """
    norm = collapse_spaces_preserve_newlines(normalize_keep_newlines(text))
    paras = [p for p in re.split(r"\n+", norm) if p is not None]
    tokens = []
    first = True
    for p in paras:
        p = p.strip()
        if not p:
            continue
        if not first:
            tokens.append(None)  # paragraph break (hard boundary)
        first = False
        segs = newserver_segment(p)
        for seg in segs:
            for t in split_myanmar_punct_from_token(seg):
                tokens.append(t)
    return tokens

# -----------------------------
# Orthographic syllable clustering (cluster-safe)
# -----------------------------
COMBINING_RANGES = [
    (0x102B, 0x103E),  # vowel signs, medials, anusvara, asat, virama, etc.
    (0x1056, 0x1059),
    (0x105E, 0x1060),
    (0x1071, 0x1074),
    (0x1082, 0x108D),
    (0x109D, 0x109D),
]
VIRAMA = "\u1039"  # stacked consonant marker

def is_combining_mark(ch: str) -> bool:
    cp = ord(ch)
    for a, b in COMBINING_RANGES:
        if a <= cp <= b:
            return True
    return False

def is_base_letter(ch: str) -> bool:
    if ch in (MYANMAR_COMMA, MYANMAR_PERIOD):
        return False
    if ch in ZW_CHARS:
        return False
    if not is_myanmar_char(ch):
        return False
    if is_combining_mark(ch):
        return False
    return True

def split_orthographic_syllables(tok: str):
    """
    Split token into orthographic syllable clusters conservatively:
      - start a new cluster on a new base letter
      - BUT if previous char was VIRAMA (U+1039), the next base letter is part of same stack -> do NOT split
    """
    if not tok:
        return []
    t = "".join(ch for ch in tok if ch not in ZW_CHARS)

    clusters = []
    buf = []
    prev = ""

    for ch in t:
        if ch in (MYANMAR_COMMA, MYANMAR_PERIOD):
            if buf:
                clusters.append("".join(buf))
                buf = []
            clusters.append(ch)
            prev = ch
            continue

        if is_base_letter(ch) and buf and prev != VIRAMA:
            clusters.append("".join(buf))
            buf = [ch]
        else:
            buf.append(ch)

        prev = ch

    if buf:
        clusters.append("".join(buf))

    return [c for c in clusters if c]

# -----------------------------
# Particle matching on cluster sequences (greedy ANYWHERE in token)
# -----------------------------
def particle_to_clusters(p: str):
    return [c for c in split_orthographic_syllables(p) if c not in (MYANMAR_COMMA, MYANMAR_PERIOD)]

PARTICLE_SEQS = []
for p in SENTENCE_FINAL_PARTICLES:
    seq = particle_to_clusters(p)
    if seq:
        PARTICLE_SEQS.append((p, seq))

# longest-first by (#clusters, #chars)
PARTICLE_SEQS.sort(key=lambda x: (len(x[1]), len(x[0])), reverse=True)

def greedy_particles_anywhere_from_clusters(clusters):
    """
    Greedy scan left-to-right over orthographic clusters.
    If any sentence-final particle sequence matches starting at position i,
    isolate it as its own chunk and trigger SENT_END.
    Returns: list of ("TEXT", str) and ("PART", particle_str) chunks in order.
    """
    chunks = []
    i = 0
    n = len(clusters)
    buf = []

    while i < n:
        matched = None
        matched_len = 0

        for p, seq in PARTICLE_SEQS:
            k = len(seq)
            if k and i + k <= n and clusters[i:i + k] == seq:
                matched = p
                matched_len = k
                break

        if matched is not None:
            if buf:
                chunks.append(("TEXT", "".join(buf)))
                buf = []
            chunks.append(("PART", matched))
            i += matched_len
        else:
            buf.append(clusters[i])
            i += 1

    if buf:
        chunks.append(("TEXT", "".join(buf)))

    return chunks

# -----------------------------
# Rendering
# -----------------------------
def render(tokens):
    out = []
    need_space = False

    def emit(s: str):
        nonlocal need_space
        if not s:
            return
        if s in (MYANMAR_COMMA, MYANMAR_PERIOD):
            if out and out[-1].endswith(" "):
                out[-1] = out[-1][:-1]
            out.append(s)
            need_space = True
            return
        if need_space and out and not out[-1].endswith(("\n", " ")):
            out.append(" ")
        out.append(s)
        need_space = True

    for tok in tokens:
        if tok is None:
            out.append("\n\n")  # paragraph break = hard boundary
            need_space = False
            continue
        if not tok:
            continue

        # punctuation tokens
        if tok == MYANMAR_COMMA:
            emit(tok)
            out.append(f" {PHRASE_MARKER} ")
            need_space = False
            continue

        if tok == MYANMAR_PERIOD:
            emit(tok)
            out.append(f" {SENT_MARKER}\n")
            need_space = False
            continue

        clusters = split_orthographic_syllables(tok)
        # strip punctuation if any slipped through
        clusters = [c for c in clusters if c not in (MYANMAR_COMMA, MYANMAR_PERIOD)]
        if not clusters:
            continue

        chunks = greedy_particles_anywhere_from_clusters(clusters)
        for kind, val in chunks:
            if kind == "TEXT":
                emit(val)
            else:  # PART
                emit(val)
                out.append(f" {SENT_MARKER}\n")
                need_space = False

    s = "".join(out)
    s = re.sub(r"[ \t]+\n", "\n", s)
    s = re.sub(r"[ \t]{2,}", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()

# -----------------------------
# UI
# -----------------------------
PAGE = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Myanmar sentence-final particles (cluster-safe, anywhere)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; padding: 16px; line-height: 1.4; }
    textarea { width: 100%; height: 320px; font-size: 16px; }
    button { padding: 10px 14px; font-size: 15px; cursor: pointer; }
    pre { white-space: pre-wrap; word-break: break-word; background: #f6f6f6; padding: 12px; border-radius: 6px; }
    .row { margin: 10px 0; }
    .small { color: #555; font-size: 13px; }
    code { background: #f0f0f0; padding: 1px 4px; border-radius: 4px; }
  </style>
</head>
<body>
  <h2>Myanmar sentence-final particles (cluster-safe, anywhere)</h2>
  <div class="small">
    Segmentation: <code>__BASE__/segment</code>.<br>
    Sentence stops: <code>။</code> + greedy detection of sentence-final particles anywhere inside a token,
    but only on orthographic clusters (won’t split inside syllables like <code>နှစ်</code>).<br>
    Phrase marker: <code>၊</code>. Paragraph breaks are hard boundaries.
  </div>
  <div class="row">
    <textarea id="txt" placeholder="Paste Burmese text. Non-Myanmar punctuation is ignored."></textarea>
  </div>
  <div class="row">
    <button id="run">Segment + Mark</button>
    <span class="small" id="status"></span>
  </div>
  <h3>Output</h3>
  <pre id="out"></pre>
<script>
  const run = document.getElementById("run");
  const txt = document.getElementById("txt");
  const out = document.getElementById("out");
  const status = document.getElementById("status");

  run.onclick = async () => {
    status.textContent = "Running...";
    out.textContent = "";
    try {
      const resp = await fetch("/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: txt.value })
      });
      const data = await resp.json();
      if (!data.ok) {
        status.textContent = "Error";
        out.textContent = JSON.stringify(data, null, 2);
        return;
      }
      status.textContent = `OK (tokens: ${data.token_count})`;
      out.textContent = data.output;
    } catch (e) {
      status.textContent = "Error";
      out.textContent = String(e);
    }
  };
</script>
</body>
</html>
"""

@app.get("/")
def index():
    page = PAGE.replace("__BASE__", html.escape(NEWSERVER_BASE_URL))
    return Response(page, mimetype="text/html; charset=utf-8")

@app.post("/analyze")
def analyze():
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "")
    if not text.strip():
        return {"ok": False, "error": "missing text"}, 400
    try:
        toks = segment_text_with_paragraphs(text)
        output = render(toks)
        return {"ok": True, "token_count": len([t for t in toks if t is not None]), "output": output}
    except requests.exceptions.RequestException as e:
        return {"ok": False, "error": f"Failed to reach newserver at {NEWSERVER_BASE_URL}: {e}"}, 502
    except Exception as e:
        return {"ok": False, "error": str(e)}, 500

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=True)
