"""Compatibility entrypoint; maintained implementation lives in burmese_reader/."""

import importlib
import json
from pathlib import Path

from burmese_reader.application import create_app, initialize_resources
from burmese_reader.runtime import DEFAULT_RUNTIME

app = create_app(load_resources=False, runtime=DEFAULT_RUNTIME)
_EXPORTS = json.loads(
    (Path(__file__).parent / "burmese_reader/compatibility.json").read_text()
)


def __getattr__(name):
    """Preserve named imports used by existing research and Konbaung adapters."""
    location = _EXPORTS.get(name)
    if location is None:
        raise AttributeError(name)
    module, _, state = location.partition(".")
    owner = importlib.import_module("burmese_reader." + module)
    return getattr(getattr(owner, state) if state else owner, name)


if __name__ == "__main__":
    with app.app_context():
        initialize_resources()
    app.run(host="127.0.0.1", port=5000, debug=False)
