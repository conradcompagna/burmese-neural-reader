"""WSGI entry point for gunicorn.

Usage:
    gunicorn wsgi:app --bind 0.0.0.0:8000 --workers 1 --timeout 120
"""

from newserverPDF21split import (
    app,
    load_dictionary,
    load_grammar_lexicon_tsv,
    TSV_GRAMMAR_PATH,
    init_ud_parser,
    init_stanza_ner,
)

# Run all startup initialization that the __main__ block normally handles.
load_dictionary()
load_grammar_lexicon_tsv(TSV_GRAMMAR_PATH)
init_ud_parser()
init_stanza_ner()
