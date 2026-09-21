"""Golden contracts captured from the published server before extraction."""

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from burmese_reader import (
    graphemes,
    lexicon,
    ner,
    normalization,
    pipeline,
    pos,
    settings,
    ud,
)
from burmese_reader.application import create_app

FIXTURES = Path(__file__).parent / "fixtures"


def read_fixture(name):
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


def fixture_ner(text):
    return SimpleNamespace(
        sentences=[
            SimpleNamespace(tokens=[SimpleNamespace(start_char=0, end_char=len(text))])
        ],
        ents=[],
    )


@pytest.fixture
def app(tmp_path, monkeypatch):
    for name in [
        "LOG_PATH",
        "MISS_LOG_PATH",
        "UNKNOWN_SEG_LOG_PATH",
        "ANNOTATIONS_PATH",
    ]:
        monkeypatch.setattr(settings, name, tmp_path / name)
    app = create_app({"TESTING": True}, load_resources=False, stanza_ner=fixture_ner)
    with app.app_context():
        segmenter = lexicon.init_new_segmenter()
        lexicon.state.DICT_LOADED = True
        for layer, word, definition in [
            ("wiktionary", "စာ", "text"),
            ("wiktionary", "မြန်မာ", "Burmese"),
            ("wiktionary", "ဖတ်", "read"),
            ("mmd", "စာ", "letter"),
            ("user", "စာ", "custom text"),
        ]:
            segmenter.dictionary.get_layer(layer).add_entry(word, "", "n", [definition])
        segmenter.dictionary.rebuild_cache()
    yield app


@pytest.mark.parametrize("row", read_fixture("segmentation"))
def test_surface_normalization_graphemes_and_dp(app, row):
    text = row["text"]
    with app.app_context():
        assert (
            normalization.normalize_burmese_for_segmentation(text) == row["normalized"]
        )
        assert normalization.normalize_headword(text) == row["headword"]
        assert (
            json.loads(json.dumps(graphemes._build_grapheme_clusters(text)))
            == row["graphemes"]
        )
        assert (
            json.loads(json.dumps(graphemes._build_clusters(text))) == row["clusters"]
        )
        assert lexicon.get_segmenter_instance().segment(text) == row["dp"]
        assert pipeline.segment_with_pipeline(text) == row["pipeline"]


@pytest.mark.parametrize("row", read_fixture("overlays"))
def test_offsets_islands_and_effective_pos_overlay(app, row):
    with app.app_context():
        actual = {
            "offsets": pipeline._build_segment_offsets(row["text"], row["segments"]),
            "char_spans": ner._build_segment_char_spans(row["text"], row["segments"]),
            "islands": ner._build_island_spans_from_segments(row["segments"]),
            "pos": pos.build_pos_overlay_for_segments(row["segments"]),
        }
        assert json.loads(json.dumps(actual)) == {k: row[k] for k in actual}


@pytest.mark.parametrize(
    "name,url",
    [
        ("exact", "/lookup?q=စာ&raw=1&exact=1"),
        ("dp", "/lookup_dp_only?q=မြန်မာစာဖတ်"),
        ("full", "/lookup?q=မြန်မာစာဖတ်"),
    ],
)
def test_original_lookup_response(app, name, url):
    response = app.test_client().get(url)
    assert response.status_code == 200
    assert response.json == read_fixture(f"lookup-{name}")


def test_factory_isolates_models_and_dictionary_state(app):
    second = create_app({"TESTING": True}, load_resources=False)
    with app.app_context():
        segmenter = lexicon.get_segmenter_instance()
        assert ner.init_stanza_ner() is fixture_ner
        assert lexicon.DICT["စာ"]["source"] == "USER"
    with second.app_context():
        assert lexicon.state.SEGMENTER_INSTANCE is None
        assert not lexicon.state.DICT_LOADED
        assert ner.init_stanza_ner() is None
        assert ud.init_ud_parser() is None
    with app.app_context():
        assert lexicon.get_segmenter_instance() is segmenter


def test_routes_and_disabled_features_remain_compatible(app):
    rules = {rule.rule: rule for rule in app.url_map.iter_rules()}
    for old in read_fixture("routes"):
        assert set(old["methods"]) <= rules[old["rule"]].methods
        assert rules[old["rule"]].endpoint.rsplit(".", 1)[-1] == old["endpoint"]
    client = app.test_client()
    assert client.get("/").status_code == 302
    assert client.get("/reader").status_code == 200
    assert client.get("/debug/pos").status_code == 404
    assert client.get("/api/reading_srs/next_card").status_code == 403
    assert client.get("/annotation?head=စာ").json["note"] == ""
    assert client.get("/lookup?q=" + "x" * 8001).status_code == 400
