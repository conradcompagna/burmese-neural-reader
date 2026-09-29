"""
Burmese Transliteration Engine
==============================
A comprehensive G2P (grapheme-to-phoneme) system for Burmese script.

Produces phonetic romanization at the syllable level with detailed
component breakdowns. Designed as a drop-in replacement for simpler
character-mapping approaches.

Based on: MLCTS, ALA-LC, BGN/PCGN (modified), Okell, and Wiktionary standards.

Author: Conrad (with Claude assistance)
Date: December 2025
"""

from dataclasses import dataclass, field
from typing import Optional
import re

# =============================================================================
# CHARACTER SETS
# =============================================================================

MYANMAR_CONSONANTS = set("ကခဂဃငစဆဇဈဉညဋဌဍဎဏတထဒဓနပဖဗဘမယရလဝသဟဠအ")

MYANMAR_INDEPENDENT_VOWELS = set("ဣဤဥဦဧဩဪ")

MYANMAR_MEDIALS = {"ျ", "ြ", "ွ", "ှ"}

MYANMAR_VOWEL_SIGNS = {"ါ", "ာ", "ိ", "ီ", "ု", "ူ", "ေ", "ဲ"}

# Special marks
ANUSVARA = "\u1036"  # ံ (nasalization)
ASAT = "\u103a"  # ် (kills inherent vowel)
TONE_LOW = "\u1037"  # ့ (creaky tone)
TONE_HIGH = "\u1038"  # း (high tone)
VIRAMA = "\u1039"  # ္ (stacker for conjuncts)
GREAT_SA = "\u103f"  # ဿ (Pali ssa)

# Pre-base vowel (appears before consonant in orthography)
PRE_BASE_VOWELS = {"ေ"}

# Abbreviation symbols
ABBREVIATIONS = {"၌", "၍", "၎", "၏"}

# Punctuation
PUNCTUATION = {"၊", "။"}

# Numerals
NUMERALS = set("၀၁၂၃၄၅၆၇၈၉")

# =============================================================================
# ROMANIZATION TABLES
# =============================================================================

# --- Consonant onsets (initial position) ---
CONSONANT_ROMAN = {
    # Velar (ka group)
    "က": "k",
    "ခ": "kh",
    "ဂ": "g",
    "ဃ": "gh",
    "င": "ng",
    # Palatal (ca group)
    "စ": "s",
    "ဆ": "hs",
    "ဇ": "z",
    "ဈ": "zh",
    "ဉ": "ny",
    "ည": "ny",
    # Retroflex (ṭa group - Pali)
    "ဋ": "t",
    "ဌ": "ht",
    "ဍ": "d",
    "ဎ": "dh",
    "ဏ": "n",
    # Dental (ta group)
    "တ": "t",
    "ထ": "ht",
    "ဒ": "d",
    "ဓ": "dh",
    "န": "n",
    # Labial (pa group)
    "ပ": "p",
    "ဖ": "hp",
    "ဗ": "b",
    "ဘ": "bh",
    "မ": "m",
    # Semi-vowels and approximants
    "ယ": "y",
    "ရ": "y",  # Standard Burmese; Rakhine uses "r"
    "လ": "l",
    "ဝ": "w",
    # Fricatives
    "သ": "th",  # dental fricative θ
    "ဟ": "h",
    # Other
    "ဠ": "l",
    "အ": "",  # glottal stop, usually unmarked
}

# --- Consonants as codas (final position, before asat) ---
# Maps the consonant letter to its coda realization
CODA_ROMAN = {
    # Stops – glottal stop, represented by final letter
    "က": "k",
    "ခ": "k",
    "ဂ": "k",
    "ဃ": "k",
    "စ": "t",  # -စ် rare, but exists
    "ဆ": "t",
    "ဇ": "t",
    "ဈ": "t",
    "ဋ": "t",
    "ဌ": "t",
    "ဍ": "t",
    "ဎ": "t",
    "တ": "t",
    "ထ": "t",
    "ဒ": "t",
    "ဓ": "t",
    "ပ": "p",
    "ဖ": "p",
    "ဗ": "p",
    "ဘ": "p",
    # Nasals
    "င": "ng",
    "ဏ": "n",  # archaic, rare
    "ည": "ny",  # or just "i/e" depending on context
    "န": "n",
    "မ": "m",
    # Approximants (rare as finals)
    "ယ": "y",
    "ရ": "y",
    "လ": "l",
    "ဝ": "w",
    # သ as coda is rare
    "သ": "th",
}

# --- Medials ---
MEDIAL_ROMAN = {
    "ျ": "y",  # palatal glide
    "ြ": "y",  # historically "r", now "y" in standard Burmese
    "ွ": "w",  # labial glide
    "ှ": "h",  # aspiration/breathiness (position varies)
}

# =============================================================================
# SPECIAL ONSET COMBINATIONS
# =============================================================================

# Velar palatalization: velar + ya/ra medial → palatal affricate
# These are TRUE phonetic changes, not just consonant clusters
VELAR_PALATAL_MAP = {
    # ကျ/ကြ → tɕ (romanized as "c")
    ("က", "ျ"): "c",
    ("က", "ြ"): "c",
    # ချ/ခြ → tɕʰ (romanized as "ch")
    ("ခ", "ျ"): "ch",
    ("ခ", "ြ"): "ch",
    # ဂျ/ဂြ → dʑ (romanized as "j")
    ("ဂ", "ျ"): "j",
    ("ဂ", "ြ"): "j",
    # ဃျ/ဃြ → dʑ (romanized as "j") - voiced aspirated, rare but complete
    ("ဃ", "ျ"): "j",
    ("ဃ", "ြ"): "j",
}

# NGA + palatal medial → ɲ (palatalized nasal, "ny")
# Both ငြ and ငျ produce this
NGA_PALATAL_MEDIALS = {"ျ", "ြ"}

# Additional ʃ (sh) combinations beyond ရှ/ယှ
# Format: bases that produce "sh" when combined with ျ+ှ
SH_ONSET_BASES = {"သ", "လ"}  # သျှ→sh, လျှ→sh

# Wa-medial dominance: when ွ co-occurs with ျ or ြ, the ya/ra is absorbed
# Result is just /w/, not /jw/ or /yw/
# This applies to combinations like ကျွ, ကြွ, etc.
WA_DOMINANT_MEDIALS = {"ျ", "ြ"}

# =============================================================================
# CODA CLASSES (for non-standard Pali/Sanskrit spellings)
# =============================================================================

# Miscellaneous codas: not nasal, not stop - these behave specially
# After ို vowel, these become SILENT (just /o/ remains)
MISC_CODAS = {"ယ", "ရ", "လ", "ဝ", "ဟ", "ဠ"}

# Non-standard coda mappings: Pali/Sanskrit codas → standard coda class
# These letters in coda position reduce to the standard coda sound
CODA_CLASS_K = {"က", "ခ", "ဂ", "ဃ"}  # all → /k/
CODA_CLASS_T = {
    "စ",
    "ဆ",
    "ဇ",
    "ဈ",  # palatal series → /t/
    "ဋ",
    "ဌ",
    "ဍ",
    "ဎ",  # retroflex series → /t/
    "တ",
    "ထ",
    "ဒ",
    "ဓ",  # dental series → /t/
    "သ",
}  # thh → /t/
CODA_CLASS_P = {"ပ", "ဖ", "ဗ", "ဘ"}  # all → /p/
CODA_CLASS_NASAL = {"င", "ဉ", "ည", "ဏ", "န", "မ"}  # all → /n/

# --- Independent vowels ---
INDEPENDENT_VOWEL_ROMAN = {
    "ဣ": "i",  # short i (creaky)
    "ဤ": "i",  # long i
    "ဥ": "u",  # short u (creaky)
    "ဦ": "u",  # long u
    "ဧ": "e",  # e
    "ဩ": "aw",  # open-o (high tone)
    "ဪ": "aw",  # open-o (low tone)
}

# --- Abbreviations ---
ABBREVIATION_ROMAN = {
    "၌": "ywe",  # conjunction (ရွေ့အ်)
    "၍": "hnaik",  # locative "at, in" (ဟနိုက်)
    "၎": "lanykaung",  # "that, as well as" (လည်းကောင်း) - short form
    "၏": "i",  # genitive particle (ဧအ်)
}
# Extended form with ၎င်း
ABBREVIATION_EXTENDED = "၎င်း"

# --- Numerals ---
NUMERAL_ROMAN = {
    "၀": "0",
    "၁": "1",
    "၂": "2",
    "၃": "3",
    "၄": "4",
    "၅": "5",
    "၆": "6",
    "၇": "7",
    "၈": "8",
    "၉": "9",
}

# --- Great Sa (ဿ) ---
GREAT_SA_ROMAN = "ss"

# =============================================================================
# RHYME TABLES (vowel + coda combinations)
# =============================================================================

# The "rhyme" is the vowel nucleus + coda. Burmese orthography often changes
# the vowel quality based on what coda follows. This table captures the
# phonetic output for common combinations.
#
# Key: (frozenset of vowel signs, coda consonant or None, has_anusvara)
# Value: (vowel_roman, coda_roman)
#
# We handle this more systematically below, but these are the critical
# irregular mappings where orthography ≠ pronunciation.


# Vowel sign combinations mapped to base vowel (before considering coda)
def _vowel_signs_to_base(signs: set[str], has_anusvara: bool) -> str:
    """
    Determine the base vowel from a set of vowel signs.
    Does NOT account for coda-induced changes yet.
    """
    # ေ + ာ/ါ = "aw" (အော)
    if "ေ" in signs and ("ာ" in signs or "ါ" in signs):
        return "aw"
    # ေ + ဲ = "è" (open e)
    if "ေ" in signs and "ဲ" in signs:
        return "e"
    # ေ alone = "e"
    if "ေ" in signs:
        return "ei"
    # ိ + ု/ူ = "o" (အို)
    if ("ိ" in signs or "ီ" in signs) and ("ု" in signs or "ူ" in signs):
        return "o"
    # ိ or ီ = "i"
    if "ိ" in signs or "ီ" in signs:
        return "i"
    # ု or ူ = "u"
    if "ု" in signs or "ူ" in signs:
        return "u"
    # ဲ alone = "è"
    if "ဲ" in signs:
        return "e"
    # ာ or ါ = "a" (long)
    if "ာ" in signs or "ါ" in signs:
        return "a"
    # No vowel sign = inherent "a"
    return "a"


# Rhyme mutations: when certain vowels combine with codas, the vowel shifts
# Format: {(base_vowel, coda_letter): (actual_vowel, actual_coda)}
RHYME_MUTATIONS = {
    # -ak series: inherent a + k-coda → "ek" sound
    ("a", "က"): ("e", "k"),
    ("a", "ခ"): ("e", "k"),
    ("a", "ဂ"): ("e", "k"),
    ("a", "ဃ"): ("e", "k"),
    # -ang series: inherent a + ng-coda → "in" sound!
    ("a", "င"): ("i", "n"),
    # -any series: inherent a + ny-coda → "i" or "e"
    ("a", "ဉ"): ("i", ""),
    ("a", "ည"): ("i", "n"),
    # -an series: inherent a + n-coda → "an"
    ("a", "န"): ("a", "n"),
    ("a", "ဏ"): ("a", "n"),
    # -am series: inherent a + m-coda → "an" (m → n in coda)
    ("a", "မ"): ("a", "n"),
    # -ac series: inherent a + c-coda → "it" sound
    ("a", "စ"): ("i", "t"),
    # -ik series: i + k/t/p-coda → "eik" (diphthong)
    ("i", "က"): ("ei", "k"),
    ("i", "တ"): ("ei", "t"),
    ("i", "ပ"): ("ei", "p"),
    ("i", "စ"): ("ei", "t"),
    ("i", "ဆ"): ("ei", "p"),
    # -in series: i + n-coda → "ein"
    ("i", "န"): ("ei", "n"),
    ("i", "ည"): ("ei", "n"),
    ("i", "င"): ("ei", "n"),
    # -uk series: u + k/t/p-coda → "ouk" (diphthong)
    ("u", "က"): ("ou", "k"),
    ("u", "တ"): ("ou", "t"),
    ("u", "ပ"): ("ou", "p"),
    ("u", "စ"): ("ou", "t"),
    ("u", "ဆ"): ("ou", "p"),
    # -un series: u + n-coda → "oun"
    ("u", "န"): ("ou", "n"),
    ("u", "င"): ("ou", "n"),
    # -ok series (ို + coda)
    ("o", "က"): ("ai", "k"),  # ိုက် → /aik/
    ("o", "န"): ("ai", "n"),  # ိုန် → /ain/
    ("o", "င"): ("o", "n"),  # ိုင် → /on/
    # -auk series (ော + coda)
    ("aw", "က"): ("au", "k"),  # ောက် → /auk/
    ("aw", "င"): ("au", "n"),  # ောင် → /aun/
    # -e series (ေ + coda)
    ("ei", "က"): ("ei", "k"),
    ("ei", "င"): ("ei", "n"),
}

# When ွ (wa-medial) or ဝ appears before certain codas, vowel becomes /u/
# This applies to: က်, တ်, ပ်, န်, and ံ
WA_VOWEL_SHIFT_CODAS = {"က", "တ", "ပ", "န", "င", "မ"}


# =============================================================================
# TONE MARKERS
# =============================================================================


@dataclass
class ToneInfo:
    """Represents tone marking for a syllable."""

    level: str  # "low", "high", "creaky", "checked"
    marker: str  # the diacritic that indicated it, if any


# Stop consonants that produce checked tone
STOP_CODAS = {
    "က",
    "ခ",
    "ဂ",
    "ဃ",
    "စ",
    "ဆ",
    "ဇ",
    "ဈ",
    "ဋ",
    "ဌ",
    "ဍ",
    "ဎ",
    "တ",
    "ထ",
    "ဒ",
    "ဓ",
    "ပ",
    "ဖ",
    "ဗ",
    "ဘ",
}


def _determine_tone(
    coda_consonant: str,
    has_tone_high: bool,  # း
    has_tone_low: bool,  # ့
    vowel_signs: set[str],
) -> ToneInfo:
    """
    Determine tone from diacritics and coda type.

    Burmese has 4 tones:
    - Low (unmarked long vowel): ကာ
    - High (visarga း): ကား
    - Creaky (dot below ့): ကာ့ or short vowel without း
    - Checked (glottal stop from stop coda): ကက်

    Note: Only STOP codas (k, t, p, c) produce checked tone.
    Nasal codas (ng, n, m, ny) take normal tones.
    """
    # Checked tone only for stop consonants
    if coda_consonant in STOP_CODAS:
        return ToneInfo("checked", ASAT)
    if has_tone_high:
        return ToneInfo("high", TONE_HIGH)
    if has_tone_low:
        return ToneInfo("creaky", TONE_LOW)
    # Short vowels (no ာ/ါ, no ီ/ူ) are typically creaky
    long_markers = {"ာ", "ါ", "ီ", "ူ", "ေ", "ဲ"}
    if not (vowel_signs & long_markers):
        return ToneInfo("creaky", "")
    return ToneInfo("low", "")


# =============================================================================
# SYLLABLE PARSER
# =============================================================================


@dataclass
class SyllableAnalysis:
    """Complete analysis of a single Burmese syllable."""

    # Original orthography
    orth: str

    # Is this actually Burmese script?
    is_burmese: bool = True

    # Components (in orthographic order)
    pre_vowels: list[str] = field(default_factory=list)  # e.g., ေ
    stacked_consonants: list[str] = field(default_factory=list)  # C္C sequences
    base: str = ""  # main consonant
    medials: list[str] = field(default_factory=list)  # ျ, ြ, ွ, ှ
    vowel_signs: list[str] = field(default_factory=list)  # ါ, ာ, ိ, etc.
    coda_consonant: str = ""  # consonant before ်
    final_marks: list[str] = field(default_factory=list)  # ံ, ့, း, ်

    # Derived phonetic info
    has_anusvara: bool = False  # ံ present
    has_asat: bool = False  # ် present (with coda)
    has_tone_high: bool = False  # း present
    has_tone_low: bool = False  # ့ present
    has_wa_medial: bool = False  # ွ present
    has_ha_medial: bool = False  # ှ present

    # Romanization outputs
    onset_roman: str = ""
    vowel_roman: str = ""
    coda_roman: str = ""
    tone_roman: str = ""
    roman: str = ""  # full syllable romanization

    # For detailed UI breakdown
    components: list[dict] = field(default_factory=list)

    # Tone
    tone: Optional[ToneInfo] = None

    # Is this a minor (reduced) syllable?
    is_minor: bool = False


def is_myanmar_char(ch: str) -> bool:
    """Check if character is in Myanmar Unicode block."""
    cp = ord(ch)
    return 0x1000 <= cp <= 0x109F or 0xAA60 <= cp <= 0xAA7F


def is_combining_mark(ch: str) -> bool:
    """Check if character is a combining mark (medial, vowel sign, tone, etc.)."""
    return (
        ch in MYANMAR_MEDIALS
        or ch in MYANMAR_VOWEL_SIGNS
        or ch in {ANUSVARA, ASAT, TONE_LOW, TONE_HIGH, VIRAMA}
    )


def _split_into_syllables(text: str) -> list[str]:
    """
    Split Burmese text into orthographic syllables.

    Key insight: A syllable boundary occurs BEFORE a consonant that is NOT:
    - Part of a C္C stack (virama-linked)
    - A coda consonant (followed by asat ်)

    Handles:
    - Pre-base vowels (ေ) attaching to following consonant
    - Stacked consonants (C္C)
    - Coda consonants (C်) staying with preceding vowel
    - All combining marks staying with their base
    """
    syllables: list[str] = []
    current = ""
    pending_prebase = ""
    i = 0
    n = len(text)

    def is_coda_consonant(pos: int) -> bool:
        """Check if consonant at pos is a coda (followed by asat)."""
        if pos >= n:
            return False
        if text[pos] not in MYANMAR_CONSONANTS:
            return False
        # Look ahead for asat, possibly with intervening marks
        j = pos + 1
        while j < n:
            ch = text[j]
            if ch == ASAT:
                return True
            # Allow tone marks between consonant and asat
            if ch in {TONE_HIGH, TONE_LOW, ANUSVARA}:
                j += 1
                continue
            break
        return False

    def is_stacked_consonant(pos: int) -> bool:
        """Check if consonant at pos is subscript (preceded by virama)."""
        if pos <= 0:
            return False
        return text[pos - 1] == VIRAMA

    while i < n:
        ch = text[i]

        # Check for abbreviations (single char)
        if ch in ABBREVIATIONS:
            if current:
                syllables.append(current)
                current = ""
            if pending_prebase:
                syllables.append(pending_prebase)
                pending_prebase = ""
            # Check for ၎င်း extended form
            if ch == "၎" and i + 2 < n and text[i + 1 : i + 3] == "င်း":
                syllables.append("၎င်း")
                i += 3
                continue
            syllables.append(ch)
            i += 1
            continue

        # Check for Great Sa (ဿ) - can be onset or coda
        if ch == GREAT_SA:
            if current:
                current += ch
            else:
                if pending_prebase:
                    syllables.append(pending_prebase)
                    pending_prebase = ""
                current = ch
            i += 1
            continue

        # Pre-base vowel (ေ): hold until we see the consonant
        if ch in PRE_BASE_VOWELS and not current:
            if pending_prebase:
                syllables.append(pending_prebase)
            pending_prebase = ch
            i += 1
            continue

        # Consonant handling - the critical logic
        if ch in MYANMAR_CONSONANTS or ch in MYANMAR_INDEPENDENT_VOWELS:
            # Case 1: This is a coda consonant (followed by asat)
            if ch in MYANMAR_CONSONANTS and is_coda_consonant(i):
                # Attach to current syllable as coda
                if current:
                    current += ch
                else:
                    # Orphan coda - start new syllable
                    current = pending_prebase + ch
                    pending_prebase = ""
                i += 1
                continue

            # Case 2: This is a stacked consonant (preceded by virama)
            # Already handled by virama case below, but double-check
            if is_stacked_consonant(i):
                current += ch
                i += 1
                continue

            # Case 3: New syllable onset
            if current:
                syllables.append(current)
            current = pending_prebase + ch
            pending_prebase = ""
            i += 1
            continue

        # Virama (္): stacker - next consonant is subscript
        if ch == VIRAMA:
            if i + 1 < n and text[i + 1] in MYANMAR_CONSONANTS:
                current += ch + text[i + 1]
                i += 2
                continue
            else:
                # Orphan virama
                current += ch
                i += 1
                continue

        # Combining marks attach to current syllable
        if is_combining_mark(ch):
            if current:
                current += ch
            elif pending_prebase:
                pending_prebase += ch
            else:
                # Stray mark - emit as own unit
                syllables.append(ch)
            i += 1
            continue

        # Numerals
        if ch in NUMERALS:
            if current:
                syllables.append(current)
                current = ""
            if pending_prebase:
                syllables.append(pending_prebase)
                pending_prebase = ""
            syllables.append(ch)
            i += 1
            continue

        # Punctuation
        if ch in PUNCTUATION:
            if current:
                syllables.append(current)
                current = ""
            if pending_prebase:
                syllables.append(pending_prebase)
                pending_prebase = ""
            syllables.append(ch)
            i += 1
            continue

        # Non-Myanmar character
        if current:
            syllables.append(current)
            current = ""
        if pending_prebase:
            syllables.append(pending_prebase)
            pending_prebase = ""
        syllables.append(ch)
        i += 1

    # Flush remaining
    if current:
        syllables.append(current)
    if pending_prebase:
        syllables.append(pending_prebase)

    return syllables


def _analyze_syllable(syl: str) -> SyllableAnalysis:
    """
    Parse a single orthographic syllable into its components and romanize.
    """
    analysis = SyllableAnalysis(orth=syl)

    # Handle non-Burmese
    if not any(is_myanmar_char(ch) for ch in syl):
        analysis.is_burmese = False
        analysis.roman = syl
        return analysis

    # Handle abbreviations
    if syl in ABBREVIATION_ROMAN:
        analysis.roman = ABBREVIATION_ROMAN[syl]
        analysis.base = syl
        analysis.components = [{"ch": syl, "label": "abbreviation", "roman": analysis.roman}]
        return analysis
    if syl == ABBREVIATION_EXTENDED:
        analysis.roman = "lanykaung"
        analysis.base = syl
        analysis.components = [{"ch": syl, "label": "abbreviation", "roman": analysis.roman}]
        return analysis

    # Handle numerals
    if syl in NUMERAL_ROMAN:
        analysis.roman = NUMERAL_ROMAN[syl]
        analysis.is_burmese = False
        return analysis

    # Handle punctuation
    if syl in PUNCTUATION:
        analysis.roman = "," if syl == "၊" else "."
        analysis.is_burmese = False
        return analysis

    # Handle Great Sa standalone
    if syl == GREAT_SA:
        analysis.roman = GREAT_SA_ROMAN
        analysis.base = syl
        analysis.components = [{"ch": syl, "label": "great sa (ssa)", "roman": GREAT_SA_ROMAN}]
        return analysis

    # Parse the syllable character by character
    i = 0
    chars = list(syl)
    n = len(chars)

    # 1. Pre-base vowels
    while i < n and chars[i] in PRE_BASE_VOWELS:
        analysis.pre_vowels.append(chars[i])
        i += 1

    # 2. Base consonant (possibly with stacked consonants via virama)
    if i < n and (chars[i] in MYANMAR_CONSONANTS or chars[i] in MYANMAR_INDEPENDENT_VOWELS):
        analysis.base = chars[i]
        i += 1

        # Check for stacked consonants: C္C
        while i + 1 < n and chars[i] == VIRAMA and chars[i + 1] in MYANMAR_CONSONANTS:
            analysis.stacked_consonants.append(chars[i + 1])
            i += 2

    # 3. Medials (in order: ျ/ြ, ွ, ှ)
    while i < n and chars[i] in MYANMAR_MEDIALS:
        m = chars[i]
        analysis.medials.append(m)
        if m == "ွ":
            analysis.has_wa_medial = True
        if m == "ှ":
            analysis.has_ha_medial = True
        i += 1

    # 4. Vowel signs and marks (can be interleaved)
    while i < n:
        ch = chars[i]
        if ch in MYANMAR_VOWEL_SIGNS:
            analysis.vowel_signs.append(ch)
        elif ch == ANUSVARA:
            analysis.has_anusvara = True
            analysis.final_marks.append(ch)
        elif ch == ASAT:
            analysis.has_asat = True
            analysis.final_marks.append(ch)
        elif ch == TONE_HIGH:
            analysis.has_tone_high = True
            analysis.final_marks.append(ch)
        elif ch == TONE_LOW:
            analysis.has_tone_low = True
            analysis.final_marks.append(ch)
        elif ch in MYANMAR_CONSONANTS:
            # This is a coda consonant (should be followed by asat)
            analysis.coda_consonant = ch
        elif ch == GREAT_SA:
            # Great Sa after vowel: treat as coda
            analysis.coda_consonant = ch
        else:
            # Unknown - skip
            pass
        i += 1

    # Now romanize
    _romanize_analysis(analysis)

    return analysis


def _romanize_analysis(analysis: SyllableAnalysis) -> None:
    """
    Fill in the romanization fields of a SyllableAnalysis.

    Component breakdown strategy:
    - Show phonetic progression from base consonant to final sound
    - Base consonant: full syllable with inherent 'a' (ka, kha, na, ma)
    - Medials: show the glide addition (+y, +w) or aspiration (+h)
    - Vowels: show the vowel sound (a, i, u, e, ei, au, etc.)
    - Finals: show coda with dash prefix (-n, -m, -k, -t, -p)
    - Asat: indicate vowel removal where relevant
    """
    components = []

    # --- ONSET CALCULATION ---
    onset_parts = []

    # Determine which medials are present
    has_ya_medial = "ျ" in analysis.medials
    has_ra_medial = "ြ" in analysis.medials
    has_wa_med = "ွ" in analysis.medials  # renamed to avoid confusion with has_wa_medial
    has_ha_med = "ှ" in analysis.medials

    # Track if we've consumed medials in a special combination
    medials_consumed = set()

    # --- Check for special onset combinations ---
    # ORDER MATTERS: wa-dominance must be checked BEFORE palatalization

    # 1. Wa-medial dominance: when ွ co-occurs with ျ/ြ, the ya/ra is absorbed
    #    Result is just /w/, e.g., ကျွ → /kw/ not /cw/ (no palatalization)
    #    This check MUST come before palatalization checks
    if has_wa_med:
        for medial in ["ျ", "ြ"]:
            if medial in analysis.medials:
                # Ya/ra absorbed by wa - mark as consumed so palatalization won't apply
                medials_consumed.add(medial)

    # 2. Velar palatalization: က/ခ/ဂ/ဃ + ျ/ြ → c/ch/j
    #    Only applies if ya/ra wasn't already absorbed by wa
    velar_palatal_onset = None
    if analysis.base in {"က", "ခ", "ဂ", "ဃ"}:
        for medial in ["ျ", "ြ"]:
            if medial in analysis.medials and medial not in medials_consumed:
                key = (analysis.base, medial)
                if key in VELAR_PALATAL_MAP:
                    velar_palatal_onset = VELAR_PALATAL_MAP[key]
                    medials_consumed.add(medial)
                    break

    # 3. ငျ/ငြ → ny (NGA + palatal medial = palatalized nasal)
    #    Only applies if ya/ra wasn't already absorbed by wa
    nga_palatal_onset = None
    if analysis.base == "င":
        for medial in ["ျ", "ြ"]:
            if (
                medial in analysis.medials
                and medial not in medials_consumed
                and medial in NGA_PALATAL_MEDIALS
            ):
                nga_palatal_onset = "ny"
                medials_consumed.add(medial)
                break

    # 4. ʃ (sh) combinations:
    #    - ရှ, ယှ → sh (base + ha-medial only)
    #    - သျှ, လျှ → sh (base + ya-medial + ha-medial)
    sh_onset = None
    if has_ha_med:
        # ရှ, ယှ → sh
        if analysis.base in {"ယ", "ရ"} and not has_ya_medial:
            sh_onset = "sh"
            medials_consumed.add("ှ")
        # သျှ, လျှ → sh (only if ya not absorbed by wa)
        elif analysis.base in SH_ONSET_BASES and has_ya_medial and "ျ" not in medials_consumed:
            sh_onset = "sh"
            medials_consumed.add("ျ")
            medials_consumed.add("ှ")

    # 5. Regular ha-medial aspiration for sonorants (if not consumed above)
    ha_prefix = ""
    if has_ha_med and "ှ" not in medials_consumed:
        if analysis.base in {"င", "ဉ", "ည", "န", "ဏ", "မ", "လ", "ဝ", "ဠ"}:
            ha_prefix = "h"
            medials_consumed.add("ှ")

    # --- Build the onset ---

    # Stacked consonants (conjuncts) come first
    for sc in analysis.stacked_consonants:
        sc_roman = CONSONANT_ROMAN.get(sc, "")
        onset_parts.append(sc_roman)

    # Base consonant (with special handling)
    if analysis.base:
        if analysis.base in MYANMAR_INDEPENDENT_VOWELS:
            base_roman = INDEPENDENT_VOWEL_ROMAN.get(analysis.base, "")
            onset_parts.append(base_roman)
        elif analysis.base == GREAT_SA:
            onset_parts.append(GREAT_SA_ROMAN)
        elif sh_onset:
            # sh combination replaces base + medials
            onset_parts.append(sh_onset)
        elif velar_palatal_onset:
            # Velar palatalization replaces base + medial
            onset_parts.append(velar_palatal_onset)
        elif nga_palatal_onset:
            # ငျ/ငြ → ny
            onset_parts.append(nga_palatal_onset)
        else:
            # Regular consonant with optional ha-prefix
            base_roman = ha_prefix + CONSONANT_ROMAN.get(analysis.base, "")
            onset_parts.append(base_roman)

    # Add remaining medials (ျ, ြ, ွ) that weren't consumed
    for m in analysis.medials:
        if m in medials_consumed:
            continue
        if m == "ှ":
            # Ha-medial not consumed - rare standalone case
            if not ha_prefix and not sh_onset:
                onset_parts.append("h")
            continue
        m_roman = MEDIAL_ROMAN.get(m, "")
        onset_parts.append(m_roman)

    analysis.onset_roman = "".join(onset_parts)

    # --- VOWEL CALCULATION ---
    vowel_set = set(analysis.vowel_signs) | set(analysis.pre_vowels)
    base_vowel = _vowel_signs_to_base(vowel_set, analysis.has_anusvara)

    # Wa-medial vowel shift
    wa_shift_active = False
    if analysis.has_wa_medial and analysis.coda_consonant in WA_VOWEL_SHIFT_CODAS:
        base_vowel = "u"
        wa_shift_active = True
        if analysis.onset_roman.endswith("w"):
            analysis.onset_roman = analysis.onset_roman[:-1]
    if analysis.base == "ဝ" and analysis.coda_consonant in WA_VOWEL_SHIFT_CODAS:
        base_vowel = "u"
        wa_shift_active = True

    # --- CODA CALCULATION ---
    coda_roman = ""
    misc_coda_silent = False  # Track if misc coda became silent

    if analysis.coda_consonant:
        if analysis.coda_consonant == GREAT_SA:
            coda_roman = "th"
        # Special case: ို + miscellaneous coda → coda becomes SILENT
        # Miscellaneous codas (ယ်, ရ်, လ်, ဝ်, ဟ်, ဠ်) after ို vowel are unpronounced
        elif base_vowel == "o" and analysis.coda_consonant in MISC_CODAS:
            coda_roman = ""  # Silent
            misc_coda_silent = True
        elif wa_shift_active:
            coda_roman = CODA_ROMAN.get(analysis.coda_consonant, "")
        else:
            mutation_key = (base_vowel, analysis.coda_consonant)
            if mutation_key in RHYME_MUTATIONS:
                base_vowel, coda_roman = RHYME_MUTATIONS[mutation_key]
            else:
                coda_roman = CODA_ROMAN.get(analysis.coda_consonant, "")

    if analysis.has_anusvara:
        coda_roman += "n"

    analysis.vowel_roman = base_vowel
    analysis.coda_roman = coda_roman

    # --- FULL ROMANIZATION ---
    analysis.roman = analysis.onset_roman + analysis.vowel_roman + analysis.coda_roman

    # --- TONE ---
    analysis.tone = _determine_tone(
        coda_consonant=analysis.coda_consonant,
        has_tone_high=analysis.has_tone_high,
        has_tone_low=analysis.has_tone_low,
        vowel_signs=vowel_set,
    )

    # --- BUILD COMPONENT BREAKDOWN (phonetic roadmap) ---
    # Strategy: show each element with its phonetic contribution
    # Format: character : phonetic_value

    # Track the building sound for progressive display
    current_sound = ""

    # 1. Base consonant with inherent 'a'
    if analysis.base:
        if analysis.base in MYANMAR_INDEPENDENT_VOWELS:
            # Independent vowels are their own sound
            base_sound = INDEPENDENT_VOWEL_ROMAN.get(analysis.base, "")
            components.append({"ch": analysis.base, "label": base_sound, "roman": base_sound})
            current_sound = base_sound
        elif analysis.base == GREAT_SA:
            components.append({"ch": analysis.base, "label": "ssa", "roman": GREAT_SA_ROMAN})
            current_sound = GREAT_SA_ROMAN
        else:
            # Regular consonant: show the onset sound
            # The onset_roman already has the correct value from our calculation
            cons_only = CONSONANT_ROMAN.get(analysis.base, "")

            # Determine what label to show based on special combinations
            if sh_onset:
                # sh combinations (ရှ, ယှ, သျှ, လျှ)
                medial_chars = "".join(m for m in analysis.medials if m in medials_consumed)
                components.append(
                    {"ch": analysis.base + medial_chars, "label": "sha", "roman": "sh"}
                )
                current_sound = "sh"
            elif velar_palatal_onset:
                # Velar palatalization (ကျ/ကြ→c, etc.)
                palatal_medial = "ျ" if "ျ" in medials_consumed else "ြ"
                components.append(
                    {
                        "ch": analysis.base + palatal_medial,
                        "label": velar_palatal_onset + "a",
                        "roman": velar_palatal_onset,
                    }
                )
                current_sound = velar_palatal_onset
            elif nga_palatal_onset:
                # ငျ/ငြ → ny
                palatal_medial = "ျ" if "ျ" in medials_consumed else "ြ"
                components.append(
                    {"ch": analysis.base + palatal_medial, "label": "nya", "roman": "ny"}
                )
                current_sound = "ny"
            elif ha_prefix:
                # Aspirated sonorant (hl, hm, hn, hng, etc.)
                base_with_h = ha_prefix + cons_only + "a"
                components.append(
                    {"ch": analysis.base + "ှ", "label": base_with_h, "roman": ha_prefix + cons_only}
                )
                current_sound = ha_prefix + cons_only
            else:
                # Plain consonant
                base_with_a = cons_only + "a"
                components.append({"ch": analysis.base, "label": base_with_a, "roman": cons_only})
                current_sound = cons_only

    # 2. Stacked consonants (conjuncts) - these blend into onset
    for sc in analysis.stacked_consonants:
        sc_roman = CONSONANT_ROMAN.get(sc, "")
        sc_with_a = sc_roman + "a"
        components.append({"ch": "္" + sc, "label": f"+{sc_roman}", "roman": sc_roman})
        current_sound += sc_roman

    # 3. Medials - show the glide they add (only those not consumed)
    for m in analysis.medials:
        if m in medials_consumed:
            continue
        if m == "ှ":
            # Ha-medial not consumed - standalone case
            components.append({"ch": m, "label": "+h", "roman": "h"})
        elif m == "ျ":
            components.append({"ch": m, "label": "+y", "roman": "y"})
        elif m == "ြ":
            components.append({"ch": m, "label": "+y", "roman": "y"})
        elif m == "ွ":
            if wa_shift_active:
                # Wa absorbed into vowel
                components.append({"ch": m, "label": "→ u", "roman": ""})
            else:
                components.append({"ch": m, "label": "+w", "roman": "w"})

    # 4. Vowel signs - show the vowel sound
    all_vowel_chars = analysis.pre_vowels + analysis.vowel_signs
    if all_vowel_chars:
        vowel_str = "".join(all_vowel_chars)
        # Show what vowel this produces
        components.append({"ch": vowel_str, "label": base_vowel, "roman": base_vowel})
    elif analysis.base and analysis.base not in MYANMAR_INDEPENDENT_VOWELS:
        # No explicit vowel signs - check if we need to show a mutated inherent vowel
        # If the vowel isn't plain "a" (due to rhyme mutation), show what it became
        # But skip if wa-medial already handled the vowel shift
        if base_vowel != "a" and analysis.coda_consonant and not wa_shift_active:
            # Vowel changed due to coda (rhyme mutation) - show the result
            components.append({"ch": "(a→)", "label": base_vowel, "roman": base_vowel})

    # 5. Final consonant (coda)
    if analysis.coda_consonant:
        if analysis.coda_consonant == GREAT_SA:
            components.append({"ch": analysis.coda_consonant, "label": "-th", "roman": coda_roman})
        elif misc_coda_silent:
            # Miscellaneous coda after ို becomes silent
            components.append(
                {"ch": analysis.coda_consonant + "်", "label": "(silent)", "roman": ""}
            )
        else:
            # Show with dash prefix to indicate it's a final
            coda_display = f"-{coda_roman}" if coda_roman else ""
            components.append(
                {"ch": analysis.coda_consonant + "်", "label": coda_display, "roman": coda_roman}
            )

    # 6. Anusvara (nasalization)
    if analysis.has_anusvara:
        components.append({"ch": ANUSVARA, "label": "-n", "roman": "n"})

    # 7. Asat without coda (pure vowel killer)
    if analysis.has_asat and not analysis.coda_consonant:
        components.append({"ch": ASAT, "label": "∅", "roman": ""})

    # 8. Tone marks (brief but informative)
    if analysis.has_tone_high:
        analysis.tone_roman = ""
        components.append({"ch": TONE_HIGH, "label": "high", "roman": ""})
    elif analysis.has_tone_low:
        analysis.tone_roman = ""
        components.append({"ch": TONE_LOW, "label": "creaky", "roman": ""})

    analysis.components = components

    # --- MINOR SYLLABLE DETECTION ---
    # A minor syllable typically has: no vowel diacritics, no tone marks,
    # and appears before a major syllable. We can only detect the first two here.
    if (
        not analysis.vowel_signs
        and not analysis.has_anusvara
        and not analysis.coda_consonant
        and not analysis.has_tone_high
        and not analysis.has_tone_low
        and analysis.base not in MYANMAR_INDEPENDENT_VOWELS
    ):
        analysis.is_minor = True
        # Minor syllables have schwa, not full "a"
        analysis.vowel_roman = "ə"
        analysis.roman = analysis.onset_roman + "ə"


# =============================================================================
# PUBLIC API
# =============================================================================


def romanize_syllable(syl: str) -> str:
    """
    Romanize a single Burmese syllable.

    Returns a phonetic romanization string.
    """
    analysis = _analyze_syllable(syl)
    return analysis.roman


def romanize(text: str, separator: str = "-") -> str:
    """
    Romanize a Burmese string.

    Args:
        text: Burmese text to romanize
        separator: String to join syllables (default: "-")

    Returns:
        Romanized string with syllables joined by separator
    """
    syllables = _split_into_syllables(text)
    romans = []
    for syl in syllables:
        r = romanize_syllable(syl)
        if r.strip():
            romans.append(r)
    return separator.join(romans)


def analyze(text: str) -> list[SyllableAnalysis]:
    """
    Perform detailed analysis of Burmese text.

    Returns a list of SyllableAnalysis objects, one per syllable.
    """
    syllables = _split_into_syllables(text)
    return [_analyze_syllable(syl) for syl in syllables]


def get_g2p_data(text: str) -> dict:
    """
    Get detailed G2P (grapheme-to-phoneme) data for UI display.

    Returns a dict with:
        - overall_roman: full romanization
        - syllables: list of per-syllable breakdowns
    """
    analyses = analyze(text)

    syllable_data = []
    for a in analyses:
        syllable_data.append(
            {
                "orth": a.orth,
                "roman": a.roman,
                "is_burmese": a.is_burmese,
                "is_minor": a.is_minor,
                "onset_roman": a.onset_roman,
                "vowel_roman": a.vowel_roman,
                "coda_roman": a.coda_roman,
                "tone": a.tone.level if a.tone else None,
                "base": {
                    "ch": a.base,
                    "roman": CONSONANT_ROMAN.get(a.base, "")
                    if a.base in MYANMAR_CONSONANTS
                    else "",
                    "label": "consonant" if a.base in MYANMAR_CONSONANTS else "vowel",
                }
                if a.base
                else None,
                "medials": [
                    {"ch": m, "roman": MEDIAL_ROMAN.get(m, ""), "label": f"{m} medial"}
                    for m in a.medials
                ],
                "vowels": [
                    {"ch": v, "roman": "", "label": "vowel sign"}
                    for v in (a.pre_vowels + a.vowel_signs)
                ],
                "finals": [{"ch": a.coda_consonant + "်", "roman": a.coda_roman, "label": "final"}]
                if a.coda_consonant
                else [],
                "marks": [
                    {"ch": m, "roman": "", "label": _get_mark_label(m)} for m in a.final_marks
                ],
                "components": a.components,
            }
        )

    overall = "-".join(a.roman for a in analyses if a.roman.strip())

    return {
        "overall_roman": overall,
        "syllables": syllable_data,
    }


def _get_mark_label(mark: str) -> str:
    """Get human-readable label for a mark."""
    labels = {
        ANUSVARA: "anusvara (nasalization)",
        ASAT: "asat (vowel killer)",
        TONE_LOW: "creaky tone",
        TONE_HIGH: "high tone",
    }
    return labels.get(mark, "mark")


# =============================================================================
# COMPATIBILITY LAYER (drop-in replacement for existing code)
# =============================================================================

# These mirror the interface from the original newserver.py


def _romanize_syllable(syl: str) -> str:
    """Legacy API: romanize a single syllable."""
    return romanize_syllable(syl)


def _infer_pronunciation(text: str) -> str:
    """Legacy API: romanize entire text."""
    return romanize(text, separator="-")


def _g2p_word(text: str) -> dict:
    """Legacy API: get G2P data for a word."""
    return get_g2p_data(text)


def _split_into_syllables_for_g2p(text: str) -> list[str]:
    """Legacy API: split text into syllables."""
    return _split_into_syllables(text)


def _g2p_analyze_syllable(syl: str) -> dict:
    """
    Legacy API: analyze a single syllable.
    Returns a dict matching the original format.
    """
    a = _analyze_syllable(syl)
    return {
        "orth": a.orth,
        "is_burmese": a.is_burmese,
        "base": a.base,
        "medials": a.medials,
        "vowel_signs": a.vowel_signs + a.pre_vowels,
        "final_clusters": [a.coda_consonant + "်"] if a.coda_consonant else [],
        "extra_finals": [],
        "marks": a.final_marks,
        "has_nasal_mark": a.has_anusvara,
        "onset_roman": a.onset_roman,
        "vowel_roman": a.vowel_roman,
        "coda_roman": a.coda_roman,
        "roman": a.roman,
    }


# =============================================================================
# DIACRITIC LABELS (for UI)
# =============================================================================

DIACRITIC_LABELS = {
    "ျ": "ya-medial (palatal glide)",
    "ြ": "ra-medial (→ y in standard Burmese)",
    "ွ": "wa-medial (labial glide)",
    "ှ": "ha-medial (aspiration/voicelessness)",
    "ါ": "tall aa vowel sign",
    "ာ": "aa vowel sign",
    "ိ": "i vowel sign",
    "ီ": "long ii vowel sign",
    "ု": "u vowel sign",
    "ူ": "long uu vowel sign",
    "ေ": "e vowel sign (pre-base)",
    "ဲ": "ai/è vowel sign",
    ANUSVARA: "anusvara (nasalization → -n)",
    ASAT: "asat (kills inherent vowel)",
    TONE_LOW: "creaky tone marker (aukmyit)",
    TONE_HIGH: "high tone marker (visarga)",
    VIRAMA: "virama (consonant stacker)",
}


# =============================================================================
# TESTING
# =============================================================================

if __name__ == "__main__":
    # Test cases
    test_words = [
        "မြန်မာ",  # Myanmar
        "တက္ကသိုလ်",  # university (with stack)
        "လောက",  # world (with stack)
        "အင်္ဂလိပ်",  # English
        "ပိဿာ",  # viss (with great sa)
        "ကြောင်",  # cat
        "လှ",  # beautiful (ha-medial)
        "ရှင်း",  # clear (sha sound)
        "ကွက်",  # (wa + stop → u)
        "ဝန်",  # burden (wa onset + n coda)
        "ခုနှစ်",  # minor syllable example
        "ခလုတ်",  # button (minor + major)
        "၌",  # locative abbreviation
        "၎င်း",  # demonstrative abbreviation
        "ကိုက်",  # bite (ို + က် → aik)
        "ကောက်",  # pick (ော + က် → auk)
        # New tests for velar palatalization
        "ကျ",  # velar + ya → c (ca)
        "ကြ",  # velar + ra → c (ca)
        "ချ",  # aspirated velar + ya → ch (cha)
        "ခြ",  # aspirated velar + ra → ch (cha)
        "ဂျ",  # voiced velar + ya → j (ja)
        "ကျောင်း",  # school (kyaung → caun)
        "ခြေ",  # foot (khre → chei)
        "ဂျပန်",  # Japan (gya-pan → ja-pan)
        # NGA + RA palatalization
        "ငြိမ်",  # quiet (ngri → nyi)
        # Additional sh combinations
        "လျှာ",  # tongue (lhya → sha)
        "သျှ",  # (thya + ha → sha)
        # NEW: NGA + YA palatalization
        "ငျ",  # NGA + ya → ny
        # NEW: Voiced aspirated velar palatalization
        "ဃျ",  # GHA + ya → j (rare)
        "ဃြ",  # GHA + ra → j (rare)
        # NEW: Wa-dominance (ya/ra absorbed when wa present)
        "ကျွ",  # kyw → kw (ya absorbed)
        "ကြွ",  # krw → kw (ra absorbed)
        "ကြွေး",  # kywe → kwe (ra absorbed, then palatalize... wait, complex)
        # NEW: ို + miscellaneous coda → silent
        "ကိုလ်",  # ko (l coda silent after ို)
        "ကိုရ်",  # ko (r coda silent after ို)
        "ကိုယ်",  # ko (y coda silent after ို) - common word "self"
    ]

    print("=" * 60)
    print("BURMESE TRANSLITERATION ENGINE - TEST OUTPUT")
    print("=" * 60)

    for word in test_words:
        print(f"\n{word}")
        print(f"  → {romanize(word)}")

        data = get_g2p_data(word)
        for syl in data["syllables"]:
            print(f"    [{syl['orth']}] = {syl['roman']}", end="")
            if syl.get("is_minor"):
                print(" (minor)", end="")
            if syl.get("tone"):
                print(f" ({syl['tone']} tone)", end="")
            print()
            for comp in syl.get("components", []):
                print(
                    f"      {comp['ch']:4} : {comp.get('label', ''):<30} → {comp.get('roman', '')}"
                )
