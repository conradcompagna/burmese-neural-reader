"""Hand-written public fixtures verify conversion, not model quality."""
import json
import pytest
from research.pipeline.corpus.make_crf_windows_from_conllu import (
    iter_conllu_sentences, sentences_to_windows, qa_and_write,
)


def fixture_sentences(tmp_path):
    path = tmp_path / "synthetic.conllu"
    path.write_text(
        "# sent_id = fixture-1\n1-2\tcompound\t_\t_\t_\t_\t_\t_\t_\t_\n"
        "1\tသူ\t_\tPRON\t_\t_\t2\tnsubj\t_\t_\n"
        "2\tဖတ်သည်\t_\tVERB\tVB\t_\t0\troot\t_\t_\n"
        "2.1\tempty\t_\tX\t_\t_\t_\t_\t_\t_\n\n"
        "# sent_id = fixture-2\n1\tစာ\t_\tNOUN\tNN\t_\t0\troot\t_\t_\n", encoding="utf-8")
    return list(iter_conllu_sentences(path))


def test_unicode_pos_and_boundaries_survive_conversion(tmp_path):
    sentences = fixture_sentences(tmp_path)
    windows = list(sentences_to_windows(sentences, max_len=4, source="myudtree"))
    assert windows[0]["tokens"] == ["သူ", "ဖတ်သည်", "စာ"]
    assert windows[0]["sent_end_after"] == [0, 1, 1]
    assert [p["tag"] for p in windows[0]["pos"]] == ["PRON", "VB", "NN"]
    output = tmp_path / "nested" / "windows.jsonl"
    qa_and_write(windows, output)
    assert json.loads(output.read_text(encoding="utf-8")) == windows[0]
    before = output.read_bytes()
    qa_and_write(windows, output)
    assert output.read_bytes() == before


def test_long_sentence_is_not_cut_at_window_boundary(tmp_path):
    windows = list(sentences_to_windows(fixture_sentences(tmp_path), max_len=1, source="alt"))
    assert [len(w["tokens"]) for w in windows] == [2, 1]
    assert windows[0]["sent_end_after"] == [0, 1]
    with pytest.raises(ValueError, match="positive"):
        list(sentences_to_windows([], max_len=0, source="alt"))


@pytest.mark.parametrize("damage", ["alignment", "label"])
def test_invalid_training_records_fail(tmp_path, damage):
    window = next(sentences_to_windows(fixture_sentences(tmp_path), max_len=4, source="alt"))
    if damage == "alignment":
        window["pos"][0]["i"] = 2
    else:
        window["sent_end_after"][0] = 7
    with pytest.raises(ValueError):
        qa_and_write([window], tmp_path / "bad.jsonl")
