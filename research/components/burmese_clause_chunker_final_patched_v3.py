#!/usr/bin/env python3
"""
COMPREHENSIVE BURMESE CLAUSE CHUNKING ALGORITHM
Fully exploits the grammar dictionary for maximum coverage.

This version includes ALL markers extracted from burmese_grammar_dictionary.tsv
organized into proper categories for clause boundary detection.
"""

# ============================================================================
# MARKER DICTIONARIES - COMPREHENSIVE FROM GRAMMAR TSV
# ============================================================================

# STRONG CLAUSE BOUNDARIES - always create clause break
# Sources: Subordinate clause markers, Subordinate sentence markers, Clauses and verb attributes
STRONG_CLAUSE_MARKERS = {
    # Conditional markers
    'က',              # "if / when"
    'ကျ',             # "when we get to..."
    'ကျတော့',         # "when we get to..."
    'ကျရင်',          # "when we get to..."
    'လျှင်',          # "if / when" (formal)
    'ရင်',            # "if / when" (colloquial)
    'မူ',             # "if (it) V's"
    'ပါမူ',           # "if (it) V's"
    'မှ',             # "only if..."
    'မှန်လျှင်',      # "if it counts as..."
    'မှန်ရင်',        # "if it counts as..."
    'သော်',           # "when / if"
    
    # Concessive markers
    'သော်လည်း',       # "although..."
    'သော်ငြားလည်း',   # "although..."
    'စေကာမူ',         # "even if / although"
    'ပေမဲ့',          # "but / although"
    'ပေတဲ့',          # "although"
    'လင့်ကစား',       # "although..."
    'ဆိုပေမယ့်',      # "although it is said"
    'ဆိုသော်လည်း',    # "although it is said"
    'မည်သို့ဆိုစေ',   # "however that may be"
    
    # Temporal markers
    'တုန်းက',         # "back when..."
    'တော့',           # "when / because"
    'တော့ခါ',         # "when / because"
    'တိုင်း',         # "every time (when)"
    'ကတည်းက',         # "ever since..."
    'ဆိုကတည်းက',      # "ever since (someone) said"
    
    # Sequential/posterior markers
    'ပြီးလျှင်',      # "and then..." (formal)
    'ပြီးတော့',       # "and then..." (colloquial)
    'ပြီးနောက်',      # "after"
    'ပြီးမှ',         # "only after"
    'ပြီး',           # "after V-ing"
    'ပြီးရင်',        # "afterwards"
    'ဆိုပြီး',        # "after saying..."
    'ဆိုပြီးတော့',    # "after saying..."
    
    # Causal/reason markers
    'သဖြင့်',         # "therefore / so"
    'ကြောင့်',        # "because of..."
    'ကြောင့်မို့',    # "because of..."
    'ကြောင့်မို့လို့', # "because of..."
    'မို့',           # "because"
    'မို့လို့',       # "because"
    'လို့',           # "because..."
    'ရကား',           # "because..."
    'ဆိုတော့',        # "since it is (that)..."
    'ဆိုလို့',        # "because it was said that..."
    
    # Purpose markers
    'ရန်',            # "in order to V"
    'ပါရန်',          # "in order to V"
    'ဖို့',           # "for / to"
    'အောင်',          # "so that"
    'အောင်လို့',      # "so as to..."
    
    # Comparison/manner markers
    'သလို',           # "like / as"
    'သကဲ့သို့',       # "just as"
    'ကဲ့သို့',        # "like / as if"
    'အတိုင်း',        # "according to"
    'သို့',           # "like / as if"
    'အလား',           # "like / in the manner of"
    'နယ်',            # "like / in the way of"
    'လိုလို',         # "rather like"
    
    # Limit/extent markers
    'အထိ',            # "up to / until"
    'ထိ',             # "up to / until"
    'တိုင်',          # "up to / until"
    'တိုင်တိုင်',     # "up to / until"
    'တိုင်အောင်',     # "up to / until" / "even though"
    'မချင်း',         # "for as long as not V"
    'အဆုံး',          # "finally / in the end"
    
    # Before markers
    'ခင်',            # "before V-ing"
    'မီ',             # "before V-ing"
    
    # Immediate sequence
    'ချင်း',          # "as soon as..."
    'ရော',            # "as soon as..."
    
    # Quotative-conditional compounds
    'ဆိုရင်',         # "if you take the case of..."
    'ဆိုသော်',        # "if you consider..."
    'ဆိုရာတွင်',      # "when we speak of..."
    'ဆိုရာ၌',         # "when we speak of..."
    'ဆိုပါမူ',        # "only when it is said"
    
    # Other strong markers
    'အစား',           # "instead of..."
    'အရ',             # "according to..."
    'အတွက်',          # "for / on account of"
    'စဖူး',           # "unprecedentedly"
    'ဖြစ်စေ',         # "whether it be..."
    'ဖြစ်ဖြစ်',       # "whether it be..."
    'မဆို',           # "not specified which"
}

# MODERATE CLAUSE BOUNDARIES - usually create break, context dependent
MODERATE_CLAUSE_MARKERS = {
    '၍',              # sequential/causal connector (very common)
    'ကာ',             # "while V-ing / by V-ing" simultaneous
    'လျက်',           # "-ing / while V-ing" continuous
    'ရက်',            # "-ing / while V-ing"
    'ဟု',             # quotative "saying that..."
    'ဟူ၍',            # quotative (formal)
    'ရာ',             # "when (V)" temporal
    'ရာတွင်',         # "when/where"
    
    # Simultaneous markers
    'ကာမျှ',          # "by the mere fact of V-ing"
    'ကာမျှနှင့်',     # "by the mere fact of V-ing"
    'ရင်း',           # "while V-ing"
    'ယင်း',           # "while V-ing"
    'တုန်း',          # "while / during"
    'ကောင်းဆဲ',       # "while still doing"
    'ကောင်းတုန်း',    # "while still doing"
    
    # Appearance/manner markers
    'ယောင်',          # "in the guise of V-ing"
    'ယောင်ယောင်',     # "in the guise of V-ing"
    'အယောင်',         # "as if..."
    
    # Quotative compounds
    'ဆိုကာ',          # "saying"
    
    # Alternation markers
    'ချည်',           # "alternating / and then"
    'တုံ',            # "alternating / back and forth"
    'လိုက်',          # "alternating / back and forth"
    'ဟယ်',            # "again and again"
    'လား',            # "again and again"
    
    # Result markers
    'စဖွယ်',          # "such as to cause V"
    
    # Other moderate markers
    'ဖြင့်',          # "by / via"
    'အားဖြင့်',       # "by way of / via"
    'နေနေသာသာ',       # "far from V-ing"
    'ပဲ',             # "without V-ing"
    'ဘဲ',             # "without V-ing"
}

# SENTENCE-FINAL MARKERS - mark end of main clause
SENTENCE_FINAL_MARKERS = {
    # Statement endings
    'သည်',            # formal statement
    '၏',              # formal/literary statement
    'တယ်',            # colloquial statement
    'ပါတယ်',          # polite statement
    'တာ',             # colloquial statement
    'သ',              # statement variant
    
    # Completive/change-of-state
    'ပြီ',            # "now / already"
    
    # Future markers
    'မည်',            # formal future
    'မယ်',            # colloquial future
    'မှာ',            # future/pending
    'လိမ့်မယ်',       # "probably will"
    'လတ္တံ့',         # "will / about to"
    'အံ့',            # "will / shall"
    'ပိမ့်',          # future
    
    # Question markers
    'လား',            # neutral question
    'သလား',           # embedded question
    'လဲ',             # question "also?"
    'လော',            # "is it? / yet?"
    'စ',              # yes/no question
    'စုံ',            # yes/no question
    'နည်း',           # mild question
    'တုံး',           # question (surprise)
    
    # Emphatic markers
    'ပေ',             # emphatic
    'ပဲ',             # emphatic "just / only"
    'ပင်',            # strong emphasis
    'ပါ့',            # emphatic
    'ရဲ့',            # emphatic
    'ကဲ့',            # emphatic
    'တကား',           # exclamatory "indeed!"
    'တမုံ့',          # emphatic "indeed!"
    'တည်း',           # emphatic "exactly"
    'ချေ',            # emphatic (literary)
    
    # Negative endings
    'ဘူး',            # negative (with မ)
    'ဖူး',            # negative (experiential)
    'ပေါင်',          # negative statement
    
    # Command endings
    'လော့',           # command "do it now"
    'လင့်',           # negative command
    
    # Polite/softening markers
    'ပါ',             # polite final
    'ပေါ့',           # "of course"
    'နော်',           # "OK? right?"
    'နော',            # "OK? right?"
    'နှော',           # "OK? right?"
    
    # Exclamatory markers
    'ကိုး',           # exclamatory
    'ဟာ',             # exclamatory
    'ရယ်',            # "really / ha!"
    'သကော',           # conceptualizing
    'ဥစ္စာ',          # exclamatory (colloquial)
    
    # Exclusivity
    'ချည်း',          # "nothing but..."
    'ချည့်',          # "nothing but..."
    
    # Habitual
    'မြဲ',            # "always / habitually"
    'စမြဲ',           # "always / habitually"
    
    # Other finals
    'ရိုး',           # plain tone
    'ရော',            # statement / "and...?"
    'ကရော',           # statement / "and...?"
    'နှင့်',          # negative command (with မ)
    'နဲ့',            # negative command (with မ)
}

# NOMINALIZERS - DO NOT create clause boundaries (they form NPs)
NOMINALIZERS = {
    'မှု',            # abstract nominalization
    'ချက်',           # result nominalization
    'ခြင်း',          # gerund
    'ရေး',            # "affairs of"
    'ပုံ',            # "manner of"
    'နည်း',           # "method of"
    'သူ',             # "person who V's"
    'ဟာ',             # placeholder noun (colloquial)
    'တာ',             # "the V-ing" (can also be final)
    'ရာ',             # "thing / matter" (can also be subordinator)
    'ကျိုး',          # "benefit of"
    'ခမန်း',          # "that must be..."
    'ခွင့်',          # "permission to V"
    'စ',              # "beginning"
    'စရာ',            # "something to V"
    'စိတ်',           # "attitude to V"
    'တော်',           # honorific quality
    'ဖော်',           # "effort to V"
    'ဖော်ရ',          # "effort to V"
    'ဖန်',            # "many times V-ed"
    'ဖွယ်',           # "fit for V"
    'ဖွယ်ရာ',         # "something that can be V-ed"
    'မည်',            # future nominalizer (can also be final)
    'မှာ',            # pending act (can also be final)
    'ရိုး',           # "habit of V-ing"
    'ရင်း',           # "essence"
    'ရုံ',            # "mere V-ing"
    'လေ့',            # "habit / practice"
    'လုံး',           # "the whole V-ing"
    'သံ',             # "sound of V"
    'ဟန်',            # "manner of V"
}

# RELATIVIZERS - optional clause boundaries (modify following nouns)
RELATIVIZERS = {
    'သော',            # relative marker (formal)
    'သည့်',           # relative marker (formal variant)
    'တဲ့',            # relative marker (colloquial)
    'မည့်',           # future relative
    'မယ့်',           # future relative (colloquial)
    'မဲ',             # future relative
    'သား',            # relativizer
    'သ',              # relative variant
    'တယ်',            # relative variant
    'ပြီးသား',        # "that is already V-ed"
    'နေကျ',           # "that is habitually V"
    'ရင်းစွဲ',        # "that was previously V-ing"
    'လက်စ',           # "that is not yet finished V-ing"
}

# AUXILIARIES - appear between verb stem and boundary marker
AUXILIARIES = {
    # Tense/aspect
    'ခဲ့',            # past
    'နေ',             # progressive
    'ပြီး',           # completion (as auxiliary)
    'လာ',             # inchoative
    'သွား',           # movement/change
    'ထား',            # resultative
    
    # Modality
    'နိုင်',          # ability
    'ရ',              # deontic/permission
    'တတ်',           # ability/habit
    'သင့်',           # should/ought
    'ထိုက်',          # proper to V
    'တန်',            # suitable
    'တန်ရာ',          # usual
    'လွယ်',           # easy
    'ခဲ',             # rare/difficult
    'ဝံ့',            # dare
    'ရဲ',             # dare
    
    # Voice/valence
    'စေ',             # causative
    'ခိုင်း',         # causative/order
    'ပေး',            # benefactive
    'ယူ',             # self-benefactive
    'ခံ',             # passive-like
    'မိ',             # accidental
    
    # Number/politeness
    'ကြ',             # plural
    'ပါ',             # polite
    'တော်',           # honorific (royal)
    'မူ',             # honorific
    
    # Experiential/evidential
    'ဖူး',            # experiential
    'ဖြစ်',           # manage to V
    
    # Aspect/manner
    'လိုက်',          # completive
    'ပစ်',            # abruptly
    'ကုန်',           # exhaustively
    'လေ',             # euphonic
    'ပေ',             # euphonic
    'လတ်',            # euphonic
    'သေး',            # still/yet
    'ဦး',             # still/yet
    'အုံး',           # still/yet
    'ရစ်',            # remain
    
    # Desire/attempt
    'ချင်',           # want
    'လို',            # want
    'ကြည့်',          # try
    'စမ်း',           # try/test
    
    # Degree/intensity
    'စွာ',            # intensity
    'ချ',             # intensity
    'လှ',             # very
    'လွန်း',          # too much
    'လွန်းအားကြီး',   # too much
    'အားကြီး',        # too strongly
    'လောက်',          # enough
    'ပျော်',          # enough
    
    # Other
    'ပြ',             # show how
    'ပြန်',           # again/back
    'ပြု',            # do (generic)
    'ရက်',            # bring oneself
    'ရှာ',            # with concern
    'ယောင်',          # seem to
    'နိုး',           # tendency
    'နင့်',           # in advance
    'ခင်',            # beforehand
    'လု',             # about to
    'လုနီး',          # about to
    'သာ',             # feasibly
    'အပ်',            # suitable/passive
    'အား',            # free capacity
    'ကောင်း',         # beneficially
    'စိန်',           # challenge
    'လှည့်',          # coaxing
    'ပိုင်',          # entitled
    'က်',             # etcetera
}

# ============================================================================
# ALGORITHM FUNCTIONS
# ============================================================================

def parse_conllu(filepath, max_sentences=None):
    """Parse CoNLL-U file into list of sentences."""
    sentences = []
    current = []
    
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                if current:
                    sentences.append(current)
                    current = []
                    if max_sentences and len(sentences) >= max_sentences:
                        break
            elif not line.startswith('#'):
                parts = line.split('\t')
                if len(parts) >= 8:
                    current.append({
                        'id': int(parts[0]),
                        'form': parts[1],
                        'pos': parts[3],
                        'head': int(parts[6]),
                        'deprel': parts[7]
                    })
    
    if current:
        sentences.append(current)
    return sentences


def get_marker_sequence(sentence, verb_id, max_lookahead=12):
    """
    Get the sequence of marker TOKENS immediately following a verb.
    Skips punctuation between the verb and markers.
    Returns: list[dict] (token dicts)
    """
    id2 = {t['id']: t for t in sentence}
    markers = []
    current_id = verb_id
    steps = 0

    while steps < max_lookahead:
        next_id = current_id + 1
        if next_id not in id2:
            break
        tok = id2[next_id]
        steps += 1

        if tok['pos'] == 'PUNCT':
            current_id = tok['id']
            continue

        # Special case: quotative-conditional bridging (e.g., ... မယ်/တယ်/သည် + ဆို + ရင်/လျှင်/မှ/သော် ...)
        # Treat 'ဆို' as part of the marker chain so the boundary attaches to the main verb, not the future/final marker.
        if tok['form'] == 'ဆို' and markers and markers[-1]['form'] in SENTENCE_FINAL_MARKERS:
            peek_id = tok['id'] + 1
            while peek_id in id2 and id2[peek_id]['pos'] == 'PUNCT':
                peek_id += 1
            if peek_id in id2 and id2[peek_id]['form'] in {'ရင်', 'လျှင်', 'မှ', 'သော်'}:
                markers.append(tok)
                current_id = tok['id']
                continue

        # Special case: post-quotative reporting verb (e.g., ... ဟု + ဆို + သည်/၏/တယ် ...)
        # Include 'ဆို' in the marker chain so we don't split between 'ဟု' and 'ဆို ...'.
        if tok['form'] == 'ဆို' and tok['pos'] == 'VERB' and markers and markers[-1]['form'] in {'ဟု', 'ဟူ၍'}:
            peek_id = tok['id'] + 1
            while peek_id in id2 and id2[peek_id]['pos'] == 'PUNCT':
                peek_id += 1
            if peek_id in id2 and id2[peek_id]['form'] in SENTENCE_FINAL_MARKERS:
                markers.append(tok)
                current_id = tok['id']
                continue

        if tok['pos'] in ('PART', 'SCONJ', 'ADP', 'CCONJ'):
            markers.append(tok)
            current_id = tok['id']
            continue

        break

    return markers

def classify_markers(marker_tokens, deprel=None):
    """
    Classify a marker sequence into boundary type.
    Returns (boundary_type, trigger_marker)

    Args:
        marker_tokens: list of marker token dicts
        deprel: dependency relation of the verb (used to distinguish acl vs root)
    """
    if not marker_tokens:
        return ('none', None)

    marker_forms = [t['form'] for t in marker_tokens]
    combined = ''.join(marker_forms)
    last = marker_forms[-1]

    # POS-aware nominalizer detection (avoid treating SCONJ 'ရာ' etc. as nominalizers)
    non_aux = [t for t in marker_tokens if t['form'] not in AUXILIARIES]
    has_nominalizer = any(t['form'] in NOMINALIZERS and t['pos'] in ('PART', 'NOUN') for t in non_aux)

    # If the (first) non-aux marker is a nominalizer and the tail is just case/topic/plural
    # then this is an NP, not a clause boundary (e.g., ဖန်တီး + မှု + မှ; ယူဆ + ချက် + အရ)
    if non_aux:
        first = non_aux[0]
        if first['form'] in NOMINALIZERS and first['pos'] in ('PART', 'NOUN'):
            NOMINAL_TAIL = {
                'က', 'မှ', 'အရ', 'အတွက်', 'ကြောင့်', 'ကြောင့်မို့', 'ကြောင့်မို့လို့',
                'ကို', 'တွင်', 'မှာ', 'သို့', 'နှင့်', 'နဲ့',
                'များ', 'တို့',
            }
            tail = non_aux[1:]
            if all((t['form'] in NOMINAL_TAIL) or (t['pos'] in ('ADP', 'SCONJ')) for t in tail):
                return ('nominalizer', first['form'])

    # Strong clause markers (always split)
    for marker in sorted(STRONG_CLAUSE_MARKERS, key=len, reverse=True):
        if marker == combined or marker in marker_forms:
            return ('strong', marker)
        if len(marker) > 1 and combined.endswith(marker):
            return ('strong', marker)

    # Sentence finals
    if last in SENTENCE_FINAL_MARKERS:
        # Don't treat as final if it follows a nominalizer and is acting as case/topic on NP
        if has_nominalizer and last in {'မှာ', 'သည်', 'က', 'မှ', 'အရ', 'အတွက်', 'ကြောင့်'}:
            # Return nominalizer to suppress the boundary
            for t in non_aux:
                if t['form'] in NOMINALIZERS and t['pos'] in ('PART', 'NOUN'):
                    return ('nominalizer', t['form'])

        # Relative/adnominal clause check
        if deprel == 'acl' and last in {'မည်', 'မှာ'}:
            return ('relativizer', last)

        # Plural/topic marker on NP
        if last == 'သည်' and 'တို့' in marker_forms:
            return ('none', None)

        # Check if only auxiliaries + final marker
        non_aux_forms = [t['form'] for t in marker_tokens if t['form'] not in AUXILIARIES]
        if not non_aux_forms or non_aux_forms[-1] in SENTENCE_FINAL_MARKERS:
            return ('final', last)

    # Nominalizers (form-based fallback)
    if last in NOMINALIZERS and marker_tokens[-1]['pos'] in ('PART', 'NOUN'):
        return ('nominalizer', last)

    # Relativizers
    if last in RELATIVIZERS:
        return ('relativizer', last)

    # Moderate clause markers
    for marker in MODERATE_CLAUSE_MARKERS:
        if marker in marker_forms:
            return ('moderate', marker)

    return ('none', None)

def find_boundaries(sentence):
    """Find all clause boundaries in a sentence."""
    boundaries = []
    id2 = {t['id']: t for t in sentence}

    for token in sentence:
        if token['pos'] not in ('VERB', 'ADJ'):
            continue
        if token['pos'] == 'ADJ' and token['deprel'] not in ('acl', 'root', 'advcl'):
            continue

        # If this is the reporting verb in "ဟု ဆို(သည်/၏/...)", don't start a new clause here.
        if token['form'] == 'ဆို' and token['pos'] == 'VERB':
            prev_id = token['id'] - 1
            while prev_id in id2 and id2[prev_id]['pos'] == 'PUNCT':
                prev_id -= 1
            if prev_id in id2 and id2[prev_id]['form'] in {'ဟု', 'ဟူ၍'}:
                continue

        marker_tokens = get_marker_sequence(sentence, token['id'])
        if not marker_tokens:
            continue

        btype, trigger = classify_markers(marker_tokens, token['deprel'])
        if btype == 'none' or btype == 'nominalizer':
            continue

        marker_forms = [t['form'] for t in marker_tokens]
        end_id = marker_tokens[-1]['id']  # correct even when punctuation is skipped

        boundaries.append({
            'verb_id': token['id'],
            'verb': token['form'],
            'end_id': end_id,
            'type': btype,
            'trigger': trigger,
            'markers': marker_forms
        })

    return boundaries


def create_chunks(sentence, boundaries, include_moderate=True, include_relativizers=False):
    """Create text chunks from identified boundaries."""
    # Filter by type
    cuts = []
    for b in boundaries:
        if b['type'] == 'strong':
            cuts.append(b)
        elif b['type'] == 'moderate' and include_moderate:
            cuts.append(b)
        elif b['type'] == 'final':
            cuts.append(b)
        elif b['type'] == 'relativizer' and include_relativizers:
            cuts.append(b)
    
    if not cuts:
        text = ' '.join(t['form'] for t in sentence if t['pos'] != 'PUNCT')
        return [{'text': text, 'type': 'single', 'trigger': None}]
    
    cuts.sort(key=lambda x: x['end_id'])
    
    chunks = []
    prev_end = 0
    
    for b in cuts:
        start = prev_end + 1
        end = b['end_id']
        
        if start <= end:
            tokens = [t for t in sentence if start <= t['id'] <= end]
            text = ' '.join(t['form'] for t in tokens if t['pos'] != 'PUNCT')
            if text.strip():
                chunks.append({
                    'text': text,
                    'type': b['type'],
                    'trigger': b['trigger']
                })
            prev_end = end
    
    # Remainder
    if prev_end < len(sentence):
        tokens = [t for t in sentence if t['id'] > prev_end and t['pos'] != 'PUNCT']
        if tokens:
            text = ' '.join(t['form'] for t in tokens)
            if text.strip():
                chunks.append({
                    'text': text,
                    'type': 'remainder',
                    'trigger': None
                })
    
    return chunks


# ============================================================================
# STATISTICS
# ============================================================================

if __name__ == '__main__':
    print("="*100)
    print("COMPREHENSIVE BURMESE CLAUSE CHUNKER")
    print("Marker coverage from grammar dictionary")
    print("="*100)
    
    print(f"\nMarker counts:")
    print(f"  STRONG boundaries:   {len(STRONG_CLAUSE_MARKERS)} markers")
    print(f"  MODERATE boundaries: {len(MODERATE_CLAUSE_MARKERS)} markers")
    print(f"  SENTENCE FINALS:     {len(SENTENCE_FINAL_MARKERS)} markers")
    print(f"  NOMINALIZERS:        {len(NOMINALIZERS)} markers")
    print(f"  RELATIVIZERS:        {len(RELATIVIZERS)} markers")
    print(f"  AUXILIARIES:         {len(AUXILIARIES)} markers")
    print(f"  TOTAL:               {len(STRONG_CLAUSE_MARKERS) + len(MODERATE_CLAUSE_MARKERS) + len(SENTENCE_FINAL_MARKERS) + len(NOMINALIZERS) + len(RELATIVIZERS) + len(AUXILIARIES)} markers")
    
    # Test on corpus
    sentences = parse_conllu('/mnt/user-data/uploads/myUDTree_ver1_0_conllu.pred', max_sentences=3000)
    print(f"\nLoaded {len(sentences)} sentences for testing")
    
    # Find good examples
    examples = []
    for i, sent in enumerate(sentences):
        if 20 <= len(sent) <= 45:
            bounds = find_boundaries(sent)
            clause_bounds = [b for b in bounds if b['type'] in ('strong', 'moderate')]
            if 2 <= len(clause_bounds) <= 4:
                examples.append((i, sent, bounds))
    
    print(f"Found {len(examples)} good multi-clause examples")
    
    # Show 10 examples
    print("\n" + "="*100)
    print("10 EXAMPLE ANALYSES")
    print("="*100)
    
    for idx, (sent_i, sent, bounds) in enumerate(examples[:10]):
        print(f"\n{'━'*100}")
        print(f"EXAMPLE {idx+1}")
        print("━"*100)
        
        original = ' '.join(t['form'] for t in sent)
        print(f"\n📜 ORIGINAL:\n   {original}")
        
        print(f"\n🔍 BOUNDARIES:")
        for b in bounds:
            if b['type'] != 'nominalizer':
                print(f"   • {b['type'].upper():12} verb='{b['verb']}' → [{', '.join(b['markers'])}] trigger=⟨{b['trigger']}⟩")
        
        chunks = create_chunks(sent, bounds)
        print(f"\n📋 CHUNKS ({len(chunks)}):")
        for j, c in enumerate(chunks, 1):
            trigger = f" ⟨{c['trigger']}⟩" if c['trigger'] else ""
            print(f"   {j}. [{c['type'].upper():10}]{trigger}")
            print(f"      {c['text']}")