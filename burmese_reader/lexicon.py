"""Burmese reader: lexicon."""

from __future__ import annotations

import threading
from typing import Optional

from . import (
    dictionary_loaders as dictionary_loaders_service,
    dictionary_types as dictionary_types_service,
    lm_runtime as lm_runtime_service,
    normalization as normalization_service,
    segmentation as segmentation_service,
    segmentation_config as segmentation_config_service,
    settings as settings_service,
)
from .runtime import feature_state

SEGMENTER_CONFIG = segmentation_config_service.SegmenterConfig(
    OOV_SYLLABLE_PENALTY=10.0,
    DICT_NO_LM_DISCOUNT=1.0,
    UNIGRAM_WEIGHT=0.2,
    KNOWN_WORD_BASE_COST=1.0,
    UNKNOWN_WORD_BASE_COST=5.0,
    BIGRAM_WEIGHT=0.1,
    MAX_WORD_CLUSTERS=16,
    BEAM_WIDTH=4,
    UNIGRAM_ALPHA=1.0,
)


USE_EMBEDDED_LM = False


DICT_PRIORITIES = {
    "user": 1,
    "chronicle": 99,
    "pali": 5,
    "wiktionary": 3,
    "mmd": 2,
    "grammar": 4,
    "lm_vocab": 99,
}


DICT_LAYER_SOURCES = {
    "user": "USER",
    "wiktionary": "WIKI",
    "mmd": "MMD",
    "pali": "PALI",
    "chronicle": "CHRONICLE",
    "grammar": "GRAMMAR",
    "lm_vocab": "LM",
}


def init_new_segmenter() -> segmentation_service.BurmeseSegmenter:
    """
    Initialize the embedded segmenter (dictionaries only; LM handled by lmbrain).
    """
    print("\n=== Initializing Burmese Segmenter (embedded) ===\n")
    state.SEGMENTER_INSTANCE = segmentation_service.BurmeseSegmenter(SEGMENTER_CONFIG)
    # Set up dictionary layers with proper priorities
    for name, priority in DICT_PRIORITIES.items():
        layer = state.SEGMENTER_INSTANCE.dictionary.get_layer(name)
        if layer:
            layer.priority = priority
            layer.source_name = DICT_LAYER_SOURCES.get(name, layer.source_name or name)
        else:
            state.SEGMENTER_INSTANCE.dictionary.add_layer(
                name,
                priority=priority,
                source_name=DICT_LAYER_SOURCES.get(name, name),
            )
    # Load language model (disabled when lmbrain handles LM costs)
    if USE_EMBEDDED_LM:
        if settings_service.MYWORD_UNIGRAM_PATH.exists():
            bigram_path = (
                settings_service.MYWORD_BIGRAM_PATH
                if settings_service.MYWORD_BIGRAM_PATH.exists()
                else None
            )
            state.SEGMENTER_INSTANCE.load_lm(
                settings_service.MYWORD_UNIGRAM_PATH, bigram_path
            )
        else:
            print(f"[WARN] No LM found at {settings_service.MYWORD_UNIGRAM_PATH}")
    else:
        print("[INFO] Embedded LM disabled; lmbrain will supply unigram/bigram costs.")
    return state.SEGMENTER_INSTANCE


def get_segmenter_instance() -> segmentation_service.BurmeseSegmenter:
    """Get the global segmenter, initializing if needed."""
    if state.SEGMENTER_INSTANCE is None or not state.DICT_LOADED:
        if state.DICT_LOADING:
            return state.SEGMENTER_INSTANCE or init_new_segmenter()
        load_dictionary()
    return state.SEGMENTER_INSTANCE


def _get_master_dictionary() -> Optional[dictionary_types_service.StackedDictionary]:
    seg = get_segmenter_instance()
    return seg.dictionary if seg is not None else None


DICT = dictionary_types_service.DictView(_get_master_dictionary)


def segmenter_segment_text(text: str) -> list[str]:
    """Segment text into words (wrapper)."""
    seg = get_segmenter_instance()
    return seg.segment(text)


def segmenter_segment_with_info(text: str) -> list[dict]:
    """Segment text and return detailed info for each segment (wrapper)."""
    seg = get_segmenter_instance()
    return seg.segment_with_info(text)


def segmenter_segment_with_trace(text: str) -> dict:
    """Segment text and return DP trace (wrapper for debug)."""
    seg = get_segmenter_instance()
    return seg.segment_with_trace(text)


def segmenter_add_user_word(
    headword: str, romanization: str = "", pos: str = "", definition: str = ""
) -> bool:
    """Add a word to the user dictionary layer."""
    seg = get_segmenter_instance()
    user_layer = seg.dictionary.get_layer("user")
    if not user_layer:
        return False
    sense_line = "\t".join([headword, romanization or "", pos or "", definition or ""])
    user_layer.add_entry(headword, romanization, pos, senses=[sense_line])
    seg.dictionary.rebuild_cache()
    return True


DICT_SOURCE_CONFIG = [
    {
        "name": "USER",
        "layer": "user",
        "loader": dictionary_loaders_service.load_user_dict,
        "path": settings_service.TSV_USER_PATH,
    },
    {
        "name": "WIKI",
        "layer": "wiktionary",
        "loader": dictionary_loaders_service.load_wiktionary_dict,
        "path": settings_service.TSV_WIKI_PATH,
    },
    {
        "name": "MMD",
        "layer": "mmd",
        "loader": dictionary_loaders_service.load_mmd_dict,
        "path": settings_service.TSV_MMD_PATH,
    },
    {
        "name": "PALI",
        "layer": "pali",
        "loader": dictionary_loaders_service.load_pali_dict,
        "path": settings_service.TSV_PALI_PATH,
    },
]


def load_dictionary():
    """
    Load dictionaries directly into the segmenter's layered dictionary.
    """
    with state.DICT_LOAD_LOCK:
        if state.DICT_LOADED and state.SEGMENTER_INSTANCE is not None:
            return state.SEGMENTER_INSTANCE
        state.DICT_LOADING = True
        try:
            seg = init_new_segmenter()
            # Load user text overrides and rebuild override list
            normalization_service.state.USER_TEXT_OVERRIDES = (
                dictionary_loaders_service.load_user_text_overrides(
                    normalization_service.TSV_USER_TEXT_OVERRIDE_PATH
                )
            )
            normalization_service.state.MANUAL_TEXT_OVERRIDES = list(
                normalization_service.state.USER_TEXT_OVERRIDES
            )
            # 1) Load each source dict directly into its layer
            counts: list[tuple[str, int]] = []
            for cfg in DICT_SOURCE_CONFIG:
                layer_name = cfg["layer"]
                priority = DICT_PRIORITIES.get(layer_name, 50)
                layer = seg.dictionary.get_layer(layer_name)
                if layer:
                    layer.priority = priority
                    layer.source_name = cfg["name"]
                else:
                    layer = seg.dictionary.add_layer(
                        layer_name, priority=priority, source_name=cfg["name"]
                    )
                layer.entries.clear()
                try:
                    count = cfg["loader"](cfg["path"], layer)
                except Exception as e:
                    print(f"[WARN] Failed to load {cfg['name']} dictionary: {e}")
                    count = 0
                counts.append((cfg["name"], count))
            seg.dictionary.rebuild_cache()
            print(
                "[DEBUG] Dictionaries loaded into segmenter layers, initializing advanced segmenter (lmbrain)..."
            )
            # 3b) Initialise optional lmbrain-backed advanced segmenter for LM + spellcheck
            lm_runtime_service.init_advanced_segmenter()
            # 4) Logging / stats
            if counts:
                print(
                    "[DICT layers] "
                    + ", ".join(f"{name}={cnt} heads" for name, cnt in counts)
                )
            print(f"[COMBINED] {seg.dictionary.word_count()} heads.")
            print(f"Logging all lookups to {settings_service.LOG_PATH}")
            print(f"Logging misses (no results) to {settings_service.MISS_LOG_PATH}")
            print(
                f"Logging unknown segments to {settings_service.UNKNOWN_SEG_LOG_PATH}"
            )
            state.DICT_LOADED = True
            return seg
        finally:
            state.DICT_LOADING = False


def _new_state():
    from types import SimpleNamespace

    return SimpleNamespace(
        SEGMENTER_INSTANCE=None,
        DICT_LOADED=False,
        DICT_LOADING=False,
        DICT_LOAD_LOCK=threading.Lock(),
    )


state = feature_state("lexicon", _new_state)
