"""Burmese reader: settings."""

from __future__ import annotations

import os
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]


ENV_DATA_ROOT = os.environ.get("BURMESE_DATA_ROOT", "")


DATA_ROOT = Path(ENV_DATA_ROOT) if ENV_DATA_ROOT else APP_ROOT


TSV_WIKI_PATH = DATA_ROOT / "Burmese-English Wiktionary dictionary.tsv"


TSV_MMD_PATH = DATA_ROOT / "MMD_clean.tsv"


TSV_PALI_PATH = DATA_ROOT / "peu.tsv"


TSV_GRAMMAR_PATH = DATA_ROOT / "burmese_grammar_dictionary.tsv"


TSV_USER_PATH = TSV_WIKI_PATH.with_name("user_custom_dictionary.tsv")


LOG_PATH = TSV_MMD_PATH.with_name("lookup_log.jsonl")


MISS_LOG_PATH = TSV_MMD_PATH.with_name("lookup_miss_log.jsonl")


UNKNOWN_SEG_LOG_PATH = TSV_MMD_PATH.with_name("lookup_unknown_segment_log.jsonl")


ANNOTATIONS_PATH = TSV_MMD_PATH.with_name("annotations.json")


MYPOS_CORPUS_PATH = DATA_ROOT / "mypos-ver.3.0.txt"


DATA_DIR = TSV_WIKI_PATH.parent


MYWORD_UNIGRAM_PATH = DATA_DIR / "myWord-main" / "unigram-word.txt"


MYWORD_BIGRAM_PATH = DATA_DIR / "myWord-main" / "bigram-word.txt"
