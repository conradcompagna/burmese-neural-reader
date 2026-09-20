from math import log
from collections import defaultdict
from enum import Enum
from word_breaker.Rabbit import zg2uni
from word_breaker.myparser import MyParser

import os


class WordSegment:
    """
    Lightweight word segmenter for Myanmar text.

    This is a cleaned-up, non-recursive version of the original
    `word_segment_v5` implementation.  The public API is preserved:

        * class attribute `SegmentationMethod`
        * method `break_words(text, segmentation_method)`
        * method `normalize_break(text, encoding, segmentation_method)`
        * method `break_text_into_syllables(text)`

    Internally we avoid the unbounded recursive search that previously
    caused `RecursionError` and per-instance state leakage across calls.
    """

    # Word Segmentation Ways
    SegmentationMethod = Enum(
        "SegmentationMethod",
        "all_possible_combination sub_word_possibility",
    )

    # Paths relative to this file
    APP_ROOT = os.path.dirname(os.path.abspath(__file__))
    APP_DICTIONARY = os.path.join(APP_ROOT, "dictionary")
    APP_CORPUS = os.path.join(APP_ROOT, "corpus")

    # Load resources once at import time
    _dict_words = open(
        os.path.join(APP_DICTIONARY, "dict-words.txt"),
        "r",
        encoding="utf-8",
    ).read().splitlines()

    _stop_words = open(
        os.path.join(APP_DICTIONARY, "stopwords.txt"),
        "r",
        encoding="utf-8",
    ).read().splitlines()

    # These are kept for compatibility, though this simplified build
    # does not rely heavily on n-gram scores.
    _mypos_corpus = open(
        os.path.join(APP_CORPUS, "mypos-dver.1.0.cword.txt"),
        "r",
        encoding="utf-8",
    ).read()

    _total_unigram_count = 341685
    _total_bigram_count = 170843

    def __init__(self) -> None:
        # Per-instance caches
        self._not_found_words = set()
        self._found_words = set()

        # Working buffer for candidate segmentations
        self._possible_combos = []

        # Maximum word length in syllables for greedy search
        self._maxlen = 6

        # Syllable parser
        self.m = MyParser()

    # ------------------------------------------------------------------
    # Dictionary / cache helpers
    # ------------------------------------------------------------------
    def _check_in_dicts(self, word: str) -> bool:
        """
        Return True if *word* is known (dictionary or stopword list).
        Uses simple positive / negative caches for speed.
        """
        if word in self._found_words:
            return True
        if word in self._not_found_words:
            return False

        if word in self._dict_words or word in self._stop_words:
            self._found_words.add(word)
            return True

        self._not_found_words.add(word)
        return False

    # ------------------------------------------------------------------
    # Optional n-gram helpers (kept for API compatibility)
    # ------------------------------------------------------------------
    def _make_ngrams(self, sequence, n: int = 2):
        """
        Yield n-grams from *sequence* as tuples.
        """
        if not isinstance(sequence, (tuple, list)):
            sequence = list(sequence)

        L = len(sequence)
        if L <= n:
            if L:
                yield tuple(sequence)
            return

        # First n-gram
        yield tuple(sequence[0:n])

        for i in range(n, L):
            yield tuple(sequence[(i - n) + 1 : i + 1])

    def _unigram_log_probability(self, unigram: str) -> float:
        """
        Very small helper used only when we need to break ties between
        multiple shortest candidates.  Reads from `_mypos_corpus`.
        """
        tokens = unigram.split()
        if not tokens:
            return 0.0

        def count_words(text, n):
            counts = defaultdict(int)
            words = text.split()
            for ng in self._make_ngrams(words, n):
                counts[ng] += 1
            return counts

        counts = count_words(self._mypos_corpus, len(tokens))
        total = sum(counts.values())
        if total == 0:
            return 0.0

        # log2(freq / total_unigram_count)
        return log(total / max(self._total_unigram_count, 1), 2)

    def _bigram_log_probability(self, w1: str, w2: str) -> float:
        """
        Bigram score; like the original code, but simplified.
        """
        words = [w1, w2]

        def count_words(text, n):
            counts = defaultdict(int)
            ws = text.split()
            for ng in self._make_ngrams(ws, n):
                counts[ng] += 1
            return counts

        counts = count_words(self._mypos_corpus, 2)
        total = sum(counts.values())
        if total == 0:
            return 0.0

        return log(total / max(self._total_bigram_count, 1), 2)

    def _calculate_sentence_collocation_strength(self, sentences):
        """
        Given a list of candidate tokenised sentences, attach a simple
        collocation strength score to each:

            [[score, sentence_tokens], ...]
        """
        results = []

        for sent in sentences:
            ngrams = list(self._make_ngrams(sent, 2))
            if not ngrams:
                results.append([0.0, sent])
                continue

            colloc_sum = 0.0
            start = True
            prev_uni_log = 0.0

            for w1, w2 in ngrams:
                if start:
                    uni1 = self._unigram_log_probability(w1)
                    start = False
                else:
                    uni1 = prev_uni_log

                uni2 = self._unigram_log_probability(w2)
                prev_uni_log = uni2

                bi = self._bigram_log_probability(w1, w2)
                colloc_sum += bi - (uni1 + uni2)

            results.append([colloc_sum, sent])

        return results

    # ------------------------------------------------------------------
    # Core segmentation logic
    # ------------------------------------------------------------------
    def break_text_into_syllables(self, text: str):
        """
        Public helper: just return the list of syllables for *text*.
        """
        return self.m.syllable(text)

    def _left_to_right_segment(self, syllables, maxlen: int = 5):
        """
        Simple greedy left-to-right (forward maximum match) segmentation
        over a list of syllables.
        """
        maxlen = min(maxlen, len(syllables))
        length = len(syllables)
        offset = 0
        combo = []

        while length > 0:
            matched = False
            for i in range(maxlen, 0, -1):
                if length < i:
                    continue

                end = offset + i
                word = "".join(syllables[offset:end])

                # Accept longest known word; if nothing known, i==1
                if self._check_in_dicts(word) or i == 1:
                    combo.append(word)
                    offset = end
                    length -= i
                    matched = True
                    break

            if not matched:
                # Safety: shouldn't normally hit this, but we guard
                # against infinite loops anyway.
                combo.append("".join(syllables[offset : offset + 1]))
                offset += 1
                length -= 1

        return combo

    def _generate_all_combinations(self, syllables, maxlen: int = 5):
        """
        A lighter, non-recursive replacement for the original
        `_make_combinations` logic.  It breadth-first builds all
        segmentations where each token is at most *maxlen* syllables.
        """
        maxlen = min(maxlen, len(syllables))
        results = []

        # Each item: (position_index, [tokens_so_far])
        frontier = [(0, [])]

        L = len(syllables)

        while frontier:
            pos, tokens = frontier.pop()
            if pos >= L:
                results.append(tokens)
                continue

            for i in range(maxlen, 0, -1):
                if pos + i > L:
                    continue
                cand = "".join(syllables[pos : pos + i])

                # For exhaustive search, we still prefer dictionary words,
                # but allow unknowns at length 1 so that everything
                # remains segmentable.
                if self._check_in_dicts(cand) or i == 1:
                    frontier.append((pos + i, tokens + [cand]))

        return results

    def filter_minimum_combination(self, combos):
        """
        From a list of tokenised sentences (each is a list of strings),
        retain only those with the minimum token count.
        """
        if not combos:
            return []

        min_len = min(len(c) for c in combos)
        return [c for c in combos if len(c) == min_len]

    def break_words(self, text, segmentation_method):
        """
        Segment a Myanmar Unicode string into words.

        Parameters
        ----------
        text : str
            Raw Myanmar text (single sentence or phrase).
        segmentation_method : SegmentationMethod
            Controls the search strategy.

        Returns
        -------
        list[str]
            A single best tokenisation for the input.
        """
        # 1) Split into syllables
        syllables = self.m.syllable(text)

        # 2) Always reset candidate buffer for this call
        self._possible_combos = []

        # 3) Generate candidate segmentations
        if segmentation_method == self.SegmentationMethod.all_possible_combination:
            self._possible_combos = self._generate_all_combinations(
                syllables, self._maxlen
            )
        elif segmentation_method == self.SegmentationMethod.sub_word_possibility:
            # For robustness we only use greedy left-to-right here.
            combo = self._left_to_right_segment(syllables, self._maxlen)
            self._possible_combos.append(combo)
        else:
            combo = self._left_to_right_segment(syllables, self._maxlen)
            self._possible_combos.append(combo)

        # 4) Keep only shortest candidates
        min_filtered = self.filter_minimum_combination(self._possible_combos)

        if not min_filtered:
            # Fallback: no segmentation, just return the raw text
            return ["".join(syllables)]

        # 5) If more than one shortest candidate, choose by collocation
        if len(min_filtered) > 1:
            scored = self._calculate_sentence_collocation_strength(min_filtered)
            # each element is [score, sentence]
            best_score, best_sent = max(scored, key=lambda x: x[0])
            return best_sent

        return min_filtered[0]

    # ------------------------------------------------------------------
    # Public normalisation + segmentation interface
    # ------------------------------------------------------------------
    def normalize_break(self, input_text, encoding, segmentation_method=None):
        """
        Normalise and segment a string.

        Parameters
        ----------
        input_text : str
            Raw text, possibly Zawgyi or Unicode.
        encoding : {"zawgyi", "unicode"}
            Input encoding hint.
        segmentation_method : SegmentationMethod or None
            If None, defaults to `sub_word_possibility`.

        Returns
        -------
        list[list[str]]
            A list of segmented sentences; each sentence is a
            list of tokens.
        """
        if encoding == "zawgyi":
            input_text = zg2uni(input_text)

        if segmentation_method is None:
            segmentation_method = self.SegmentationMethod.sub_word_possibility

        # Remove spaces and split on Burmese sentence period
        input_text = input_text.replace(" ", "")
        sentences = [s for s in input_text.split("။") if s]

        outputs = []
        for sent in sentences:
            tokens = self.break_words(sent, segmentation_method)
            outputs.append(tokens)

        return outputs
