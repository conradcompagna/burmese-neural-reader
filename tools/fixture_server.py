"""Local browser fixture with synthetic annotations and temporary writable data."""
import os
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def create_fixture_app():
    from burmese_reader import lexicon
    from burmese_reader.application import create_app
    from flask import send_file
    from ud_overlay import UDOverlay

    def tokenize(text):
        return SimpleNamespace(sentences=[SimpleNamespace(tokens=[
            SimpleNamespace(start_char=0, end_char=len(text))
        ])], ents=[])

    class SyntheticParser:
        def build_overlay(self, segments, **options):
            root = max(0, len(segments) - 1)
            tokens = [{"i": i, "doc_i": i, "text": text, "head": root,
                       "dep": "ROOT" if i == root else "obj",
                       "upos": "VERB" if i == root else "NOUN", "tag": ""}
                      for i, text in enumerate(segments)]
            edges = [{"from": root, "to": i, "dep": "obj", "upos": "NOUN"}
                     for i in range(root)]
            return UDOverlay(True, tokens, edges, [root], [], [[0, len(segments)]],
                             list(range(len(segments))), list(range(len(segments))))

    app = create_app(load_resources=False, stanza_ner=tokenize, ud_parser=SyntheticParser())
    with app.app_context():
        segmenter = lexicon.init_new_segmenter()
        for head, definition in [("မြန်မာ", "Burmese"), ("စာ", "text"), ("ဖတ်", "read")]:
            segmenter.dictionary.get_layer("wiktionary").add_entry(head, "", "n", [f"{head}\t\tn\t{definition}"])
        segmenter.dictionary.rebuild_cache()
        lexicon.state.DICT_LOADED = True

    @app.get("/__fixtures/dependency-tree.js")
    def dependency_tree():
        return send_file(ROOT / "research/components/dep_tree_view.js", mimetype="text/javascript")

    @app.after_request
    def fixture_label(response):
        if response.mimetype == "text/html" and not response.direct_passthrough:
            response.set_data(response.get_data(as_text=True).replace(
                '<nav class="site-nav"',
                '<div style="position:fixed;bottom:0;left:0;z-index:9999;background:#111;color:#fff;padding:4px 10px;font:12px sans-serif">Local fixture · synthetic annotations</div><nav class="site-nav"'
            ))
        return response

    return app


if __name__ == "__main__":
    # Configure paths before importing application modules. No user corpora or
    # persistent annotation/custom-entry files are read or written by this demo.
    with tempfile.TemporaryDirectory(prefix="burmese-reader-fixture-") as directory:
        os.environ["BURMESE_DATA_ROOT"] = directory
        app = create_fixture_app()
        app.run(host="127.0.0.1", port=8792, debug=False, use_reloader=False)
