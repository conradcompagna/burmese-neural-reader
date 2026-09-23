"""Construct the reader and explicitly provision models or fixture adapters."""

from flask import Flask
from flask_cors import CORS

from .runtime import Runtime
from .settings import APP_ROOT


def initialize_resources():
    """Production startup; call inside the target application's context."""
    from . import grammar, lexicon, ner, settings, ud

    lexicon.load_dictionary()
    grammar.load_grammar_lexicon_tsv(settings.TSV_GRAMMAR_PATH)
    ud.init_ud_parser()
    ner.init_stanza_ner()


def create_app(
    config=None,
    *,
    load_resources=True,
    resource_loader=None,
    segmenter=None,
    stanza_ner=None,
    ud_parser=None,
    runtime=None,
):
    app = Flask(
        "burmese_reader",
        root_path=str(APP_ROOT),
        static_folder=str(APP_ROOT / "static"),
        template_folder=str(APP_ROOT / "templates"),
    )
    app.config.update(
        JSON_AS_ASCII=False,
        MAX_CONTENT_LENGTH=500 * 1024 * 1024,
        SEND_FILE_MAX_AGE_DEFAULT=3600,
    )
    if config:
        app.config.update(config)
    app.extensions["burmese_reader.runtime"] = runtime or Runtime(
        allow_model_loading=load_resources
    )
    CORS(app)
    from .http import register_routes

    register_routes(app)
    with app.app_context():
        from . import lexicon, ner, ud

        if segmenter is not None:
            lexicon.state.SEGMENTER_INSTANCE = segmenter
            lexicon.state.DICT_LOADED = True
        if stanza_ner is not None:
            ner.state.STANZA_NER = stanza_ner
        if ud_parser is not None:
            ud.state.UD_PARSER = ud_parser
        if load_resources:
            (resource_loader or initialize_resources)()
    return app
