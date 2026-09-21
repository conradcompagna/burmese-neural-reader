"""The unknown-word inventory retains its records and rank order."""
import json
from pathlib import Path

from research.artifacts import reconstruct


def test_ranked_inventory_reconstruction():
    manifest = Path(__file__).resolve().parents[1] / 'research/pipeline/dictionaries/chronicle-unknown-words/manifest.json'
    records = json.loads(reconstruct(manifest))
    assert len(records) == 3702
    assert list(records.values()) == sorted(records.values(), reverse=True)
