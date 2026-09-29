"""Register HTTP features and lifecycle hooks."""


def register_routes(app):
    from .memory import bp as memory_bp

    app.register_blueprint(memory_bp)
    from .lookup import bp as lookup_bp

    app.register_blueprint(lookup_bp)
    from .fuzzy import bp as fuzzy_bp

    app.register_blueprint(fuzzy_bp)
    from .custom_routes import bp as custom_routes_bp

    app.register_blueprint(custom_routes_bp)
    from .pdf_cache import bp as pdf_cache_bp

    app.register_blueprint(pdf_cache_bp)
    from .document_routes import bp as document_routes_bp

    app.register_blueprint(document_routes_bp)
    from .text_extraction import bp as text_extraction_bp

    app.register_blueprint(text_extraction_bp)
    from .debug_ud import bp as debug_ud_bp

    app.register_blueprint(debug_ud_bp)
    from .debug_segmentation import bp as debug_segmentation_bp

    app.register_blueprint(debug_segmentation_bp)
    from .debug_pos import bp as debug_pos_bp

    app.register_blueprint(debug_pos_bp)
    from .debug_spell import bp as debug_spell_bp

    app.register_blueprint(debug_spell_bp)
    from .debug_unknowns import bp as debug_unknowns_bp

    app.register_blueprint(debug_unknowns_bp)
    from .annotation_routes import bp as annotation_routes_bp

    app.register_blueprint(annotation_routes_bp)
    from .srs_routes import bp as srs_routes_bp

    app.register_blueprint(srs_routes_bp)
    from .pages import bp as pages_bp

    app.register_blueprint(pages_bp)
    from .debug_assets import bp as debug_assets_bp

    app.register_blueprint(debug_assets_bp)
    from .policy import _block_debug_endpoints

    app.before_request(_block_debug_endpoints)
    from .memory import _mem_trace_before_request

    app.before_request(_mem_trace_before_request)
    from .memory import _mem_trace_after_request

    app.after_request(_mem_trace_after_request)
