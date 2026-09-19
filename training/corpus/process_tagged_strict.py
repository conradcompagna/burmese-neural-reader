#!/usr/bin/env python3
"""
Process tagged_strict.txt with segmentation and spaCy POS tagging.
Creates a training corpus for CRF sentence tagger.
"""

import sys
import json
from pathlib import Path

# Import the segmenter and POS tagger from newserver
sys.path.insert(0, str(Path(__file__).parent))

from app import (
    get_segmenter_instance,
    init_ud_parser,
    build_spacy_pos_overlay_for_segments,
    _is_spacy_clean_token,
    SPACY_UPOS_COLORS,
)


def process_text_with_segmentation_and_pos(text: str) -> dict:
    """
    Process text with segmentation and spaCy POS tagging.

    Args:
        text: Input Burmese text

    Returns:
        Dictionary with segments and POS tags
    """
    # Use the neural segmenter from newserver
    from app import segment_with_pipeline

    # Segment the text using the neural pipeline
    segments = segment_with_pipeline(text)

    # Build POS overlay using spaCy (no dependency parsing needed in overlay)
    pos_overlay = build_spacy_pos_overlay_for_segments(segments)

    # Build the result
    result = {"text": text, "segments": segments, "pos_tags": []}

    # Extract POS information for each segment
    for i, seg in enumerate(segments):
        pos_info = pos_overlay.get(i, {})
        result["pos_tags"].append(
            {
                "index": i,
                "token": seg,
                "upos": pos_info.get("upos", ""),
                "tag": pos_info.get("tag", ""),
                "dep": pos_info.get("dep", ""),
            }
        )

    return result


def process_file(input_path: Path, output_path: Path):
    """
    Process tagged_strict.txt file and create training corpus.

    Args:
        input_path: Path to input file
        output_path: Path to output file
    """
    print(f"Reading from: {input_path}")

    with open(input_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Split by sentence markers
    sentences = content.split("<SENT_END>")

    print(f"Found {len(sentences)} sentences")

    results = []

    for i, sentence in enumerate(sentences):
        # Clean up whitespace
        sentence = sentence.strip()

        if not sentence:
            continue

        print(f"\rProcessing sentence {i + 1}/{len(sentences)}...", end="", flush=True)

        try:
            result = process_text_with_segmentation_and_pos(sentence)
            results.append(result)
        except Exception as e:
            print(f"\nError processing sentence {i + 1}: {e}")
            continue

    print(f"\n\nProcessed {len(results)} sentences successfully")

    # Write results to JSONL format
    print(f"Writing to: {output_path}")
    with open(output_path, "w", encoding="utf-8") as f:
        for result in results:
            f.write(json.dumps(result, ensure_ascii=False) + "\n")

    # Also write a CoNLL-U format file for CRF training
    conllu_path = output_path.with_suffix(".conllu")
    print(f"Writing CoNLL-U format to: {conllu_path}")

    with open(conllu_path, "w", encoding="utf-8") as f:
        for sent_idx, result in enumerate(results):
            f.write(f"# sent_id = {sent_idx + 1}\n")
            f.write(f"# text = {result['text']}\n")

            for pos_tag in result["pos_tags"]:
                # CoNLL-U format: ID FORM LEMMA UPOS XPOS FEATS HEAD DEPREL DEPS MISC
                # For CRF sentence tagging, we only need: ID, FORM, UPOS
                token_id = pos_tag["index"] + 1
                form = pos_tag["token"]
                upos = pos_tag["upos"] or "_"
                tag = pos_tag["tag"] or "_"

                # Write simplified CoNLL-U format
                f.write(f"{token_id}\t{form}\t_\t{upos}\t{tag}\t_\t_\t_\t_\t_\n")

            f.write("\n")

    print("\nDone!")

    # Print summary statistics
    print("\n=== Summary ===")
    total_tokens = sum(len(r["segments"]) for r in results)
    print(f"Total sentences: {len(results)}")
    print(f"Total tokens: {total_tokens}")
    print(f"Average tokens per sentence: {total_tokens / len(results):.2f}")

    # Count POS tags
    pos_counts = {}
    for result in results:
        for pos_tag in result["pos_tags"]:
            upos = pos_tag["upos"] or "UNKNOWN"
            pos_counts[upos] = pos_counts.get(upos, 0) + 1

    print("\nPOS tag distribution:")
    for pos, count in sorted(pos_counts.items(), key=lambda x: x[1], reverse=True):
        print(f"  {pos:10s}: {count:6d} ({100 * count / total_tokens:5.2f}%)")


if __name__ == "__main__":
    input_file = Path(__file__).parent / "tagged_strict.txt"
    output_file = Path(__file__).parent / "tagged_strict_segmented_pos.jsonl"

    if not input_file.exists():
        print(f"Error: Input file not found: {input_file}")
        sys.exit(1)

    process_file(input_file, output_file)
