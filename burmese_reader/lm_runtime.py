"""Burmese reader: lm runtime."""

from __future__ import annotations

from . import (
    lexicon as lexicon_service,
    segmentation as segmentation_service,
    settings as settings_service,
)
from .runtime import feature_state


def init_advanced_segmenter() -> None:
    """
    Optional hook: if lmbrain.py (LM brain) is present, initialize it.
    Loads unigram/bigram LMs inside lmbrain for DP scoring.
    """
    try:
        import lmbrain
        from lmbrain import (
            AdvancedSegmenter,
            LMConfig,
            get_bigram_cost,
            get_unigram_cost,
        )

        state.get_unigram_cost = get_unigram_cost
        state.get_bigram_cost = get_bigram_cost
    except ModuleNotFoundError:
        print("[INFO] lmbrain.py not found; using base DP segmenter only.")
        state.ADVANCED_SEGMENTER = None
        state.get_unigram_cost = None
        state.get_bigram_cost = None
        state.UNIGRAM_DEFAULT_COST = None
        state.UNIGRAM_MIN_COST = None
        state.UNIGRAM_MAX_COST = None
        state.BIGRAM_MIN_COST = None
        state.BIGRAM_MAX_COST = None
        return
    except Exception as e:
        print("[WARN] Could not import AdvancedSegmenter / LMConfig:", e)
        state.ADVANCED_SEGMENTER = None
        state.get_unigram_cost = None
        state.get_bigram_cost = None
        state.UNIGRAM_DEFAULT_COST = None
        state.UNIGRAM_MIN_COST = None
        state.UNIGRAM_MAX_COST = None
        state.BIGRAM_MIN_COST = None
        state.BIGRAM_MAX_COST = None
        return
    try:
        word_uni_path = (
            settings_service.MYWORD_UNIGRAM_PATH
            if settings_service.MYWORD_UNIGRAM_PATH.exists()
            else None
        )
        word_bi_path = (
            settings_service.MYWORD_BIGRAM_PATH
            if settings_service.MYWORD_BIGRAM_PATH.exists()
            else None
        )
        if word_uni_path is None:
            print(f"[WARN] No LM found at {settings_service.MYWORD_UNIGRAM_PATH}")
        # Configure LMConfig with word unigram/bigram only
        lm_cfg = LMConfig(
            word_unigram_path=word_uni_path,
            word_bigram_path=word_bi_path,
            phrase_unigram_path=None,
            phrase_bigram_path=None,
            lambda_unigram=1.0,
            lambda_bigram=0.10,
            lambda_phrase_unigram=0.0,
            lambda_phrase_bigram=0.0,
            enable_word_unigram=bool(word_uni_path),
            enable_word_bigram=bool(word_bi_path),
            enable_phrase_unigram=False,
            enable_phrase_bigram=False,
            enable_phrase_inventory=False,
        )
        state.ADVANCED_SEGMENTER = AdvancedSegmenter(
            dict_obj=lexicon_service.DICT,
            dp_segmenter=lexicon_service.segmenter_segment_text,
            myword_root=None,
            config=lm_cfg,
        )
        # Compute global unigram cost bounds for rarity scores
        try:
            uni_cost_table = getattr(lmbrain, "UNIGRAM_COST", {})
            if uni_cost_table:
                min_c = min(uni_cost_table.values())
                max_c = max(uni_cost_table.values())
                state.UNIGRAM_MIN_COST = float(min_c)
                state.UNIGRAM_MAX_COST = float(max_c)
                if state.UNIGRAM_MAX_COST > state.UNIGRAM_MIN_COST:
                    print(
                        f"[LM] Unigram cost bounds: "
                        f"min={state.UNIGRAM_MIN_COST:.3f}, max={state.UNIGRAM_MAX_COST:.3f}"
                    )
                else:
                    print(
                        f"[LM] Unigram costs all equal at {state.UNIGRAM_MIN_COST:.3f}; "
                        "rarity will be effectively flat."
                    )
            else:
                state.UNIGRAM_MIN_COST = None
                state.UNIGRAM_MAX_COST = None
                print("[LM] UNIGRAM_COST empty; no global rarity scaling.")
        except Exception as e_bounds:
            state.UNIGRAM_MIN_COST = None
            state.UNIGRAM_MAX_COST = None
            print("[WARN] Failed to compute global unigram bounds:", e_bounds)
        state.BIGRAM_MIN_COST = None
        state.BIGRAM_MAX_COST = None
        print("[LM] AdvancedSegmenter initialised with LMConfig.")
    except Exception as e:
        print("[WARN] Failed to initialise AdvancedSegmenter:", e)
        state.ADVANCED_SEGMENTER = None
        state.get_unigram_cost = None
        state.get_bigram_cost = None
        state.UNIGRAM_DEFAULT_COST = None
        state.UNIGRAM_MIN_COST = None
        state.UNIGRAM_MAX_COST = None
        state.BIGRAM_MIN_COST = None
        state.BIGRAM_MAX_COST = None
        return


def _apply_lm_weight_overrides(args) -> None:
    if args is None:
        return

    def _set_weight(attr: str, key: str) -> None:
        raw = args.get(key)
        if raw is None or raw == "":
            return
        try:
            val = float(raw)
        except Exception:
            return
        setattr(lexicon_service.SEGMENTER_CONFIG, attr, val)
        if (
            lexicon_service.state.SEGMENTER_INSTANCE is not None
            and getattr(lexicon_service.state.SEGMENTER_INSTANCE, "config", None)
            is not None
        ):
            setattr(lexicon_service.state.SEGMENTER_INSTANCE.config, attr, val)

    _set_weight("OOV_SYLLABLE_PENALTY", "lm_oov_penalty")
    _set_weight("DICT_NO_LM_DISCOUNT", "lm_dict_no_lm_discount")
    _set_weight("UNIGRAM_WEIGHT", "lm_unigram_weight")
    _set_weight("KNOWN_WORD_BASE_COST", "lm_known_base_cost")
    _set_weight("UNKNOWN_WORD_BASE_COST", "lm_unknown_base_cost")
    _set_weight("BIGRAM_WEIGHT", "lm_bigram_weight")

    raw = args.get("lm_bigram_score_scale")
    if raw is None or raw == "":
        return
    try:
        segmentation_service.BIGRAM_SCORE_SCALE = float(raw)
    except Exception:
        return


def _new_state():
    from types import SimpleNamespace

    return SimpleNamespace(
        ADVANCED_SEGMENTER=None,
        get_unigram_cost=None,
        get_bigram_cost=None,
        UNIGRAM_DEFAULT_COST=None,
        UNIGRAM_MIN_COST=None,
        UNIGRAM_MAX_COST=None,
        BIGRAM_MIN_COST=None,
        BIGRAM_MAX_COST=None,
    )


state = feature_state("lm_runtime", _new_state)
