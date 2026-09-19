import spacy
from pathlib import Path

# Path to the spaCy model
UD_MODEL_PATH = Path(r"C:\Users\conra\Desktop\burmese d\model-best")


def inspect_spacy_pos(sentence: str):
    print(f"Loading spaCy model from: {UD_MODEL_PATH}")
    try:
        nlp = spacy.load(UD_MODEL_PATH)
    except Exception as e:
        print(f"Error loading spaCy model: {e}")
        print("Please ensure the model path is correct and spaCy is installed.")
        return

    print(f"\nProcessing sentence: '{sentence}'")
    doc = nlp(sentence)

    print("\n--- Token Analysis ---")
    for token in doc:
        print(
            f"Text: '{token.text}' | UPOS (token.pos_): '{token.pos_}' | Fine Tag (token.tag_): '{token.tag_}' | Dependency (token.dep_): '{token.dep_}'"
        )


if __name__ == "__main__":
    sample_sentence = "မင်္ဂလာပါ"  # Mingalaba - Hello
    inspect_spacy_pos(sample_sentence)

    sample_sentence_2 = "ကျွန်တော် မြန်မာစာသင်တယ်။"  # I learn Burmese.
    inspect_spacy_pos(sample_sentence_2)
