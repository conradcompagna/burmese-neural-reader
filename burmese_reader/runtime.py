"""Application-owned feature state, with an explicit fallback for legacy CLI use."""

from dataclasses import dataclass, field
from threading import RLock
from typing import Any, Callable

from flask import current_app, has_app_context
from werkzeug.local import LocalProxy


@dataclass
class Runtime:
    allow_model_loading: bool = True
    features: dict[str, Any] = field(default_factory=dict)
    lock: Any = field(default_factory=RLock)

    def feature(self, name: str, factory: Callable[[], Any]) -> Any:
        with self.lock:
            if name not in self.features:
                self.features[name] = factory()
            return self.features[name]


# Legacy ``from app import ...`` callers and app.py use this same runtime.
# Independently constructed apps receive separate feature stores.
DEFAULT_RUNTIME = Runtime()


def get_runtime() -> Runtime:
    if has_app_context():
        return current_app.extensions["burmese_reader.runtime"]
    return DEFAULT_RUNTIME


def feature_state(name: str, factory: Callable[[], Any]) -> LocalProxy:
    return LocalProxy(lambda: get_runtime().feature(name, factory))
