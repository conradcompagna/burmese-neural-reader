"""Render archived debug view fragments without requiring a running Flask server."""

from jinja2 import Environment, FileSystemLoader

from .settings import APP_ROOT

# These fragments retain the original HTML escaping at their call sites, including
# intentionally generated table markup. They are not arbitrary uploaded templates.
_templates = Environment(
    loader=FileSystemLoader(APP_ROOT / "templates"),
    autoescape=False,
    keep_trailing_newline=True,
)


def render_debug_template(name, values):
    return _templates.get_template(name).render(values=values)
