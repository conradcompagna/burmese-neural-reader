"""Burmese reader: dictionary types."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

from . import normalization as normalization_service


@dataclass
class DictionaryEntry:
    """A single dictionary entry with metadata."""

    headword: str
    romanization: str = ""
    pos: str = ""
    senses: list[str] = field(default_factory=list)
    source: str = ""  # Which dictionary this came from
    priority: int = 0  # Lower = higher priority


@dataclass
class DictionaryLayer:
    """
    A single dictionary layer in the stack.
    Layers are checked in priority order (lowest priority number first).
    """

    name: str
    entries: dict[str, DictionaryEntry] = field(default_factory=dict)
    priority: int = 100  # Default: low priority
    enabled: bool = True
    source_name: str = ""  # Display/source label for entries

    def add_entry(
        self,
        headword: str,
        romanization: str = "",
        pos: str = "",
        senses: list[str] | None = None,
        definition: str = "",
    ) -> None:
        """Add or update an entry in this layer."""
        norm = normalization_service._normalize_headword(headword)
        if not norm:
            return
        entry = self.entries.get(norm)
        if entry is None:
            entry = DictionaryEntry(
                headword=headword,
                romanization=romanization or "",
                pos=pos or "",
                senses=list(senses)
                if senses
                else ([] if not definition else [definition]),
                source=getattr(self, "source_name", self.name),
                priority=self.priority,
            )
            self.entries[norm] = entry
            return
        # Merge/augment existing entry
        if romanization and not entry.romanization:
            entry.romanization = romanization
        if pos:
            if not entry.pos:
                entry.pos = pos
            elif pos not in entry.pos.split("|"):
                entry.pos = f"{entry.pos}|{pos}"
        if senses:
            for s in senses:
                if s and s not in entry.senses:
                    entry.senses.append(s)
        elif definition and definition not in entry.senses:
            entry.senses.append(definition)

    def __contains__(self, key: str) -> bool:
        return normalization_service._normalize_headword(key) in self.entries

    def get(self, key: str) -> Optional[DictionaryEntry]:
        return self.entries.get(normalization_service._normalize_headword(key))


class StackedDictionary:
    """
    Multi-layer dictionary with priority-based lookup.
    """

    def __init__(self):
        self.layers: dict[str, DictionaryLayer] = {}
        self._sorted_layers: list[DictionaryLayer] = []
        self._all_words: set[str] = set()  # Cache for fast membership

    def add_layer(
        self, name: str, priority: int = 100, source_name: str | None = None
    ) -> DictionaryLayer:
        """Create and add a new dictionary layer."""
        layer = DictionaryLayer(
            name=name, priority=priority, source_name=source_name or name
        )
        self.layers[name] = layer
        self._rebuild_sorted()
        return layer

    def get_layer(self, name: str) -> Optional[DictionaryLayer]:
        """Get a layer by name."""
        return self.layers.get(name)

    def remove_layer(self, name: str) -> bool:
        """Remove a layer by name."""
        if name in self.layers:
            del self.layers[name]
            self._rebuild_sorted()
            return True
        return False

    def _rebuild_sorted(self) -> None:
        """Rebuild sorted layer list and word cache."""
        self._sorted_layers = sorted(
            [l for l in self.layers.values() if l.enabled], key=lambda x: x.priority
        )
        self._all_words = set()
        for layer in self._sorted_layers:
            self._all_words.update(layer.entries.keys())

    def rebuild_cache(self) -> None:
        """Manually rebuild caches (call after bulk modifications)."""
        self._rebuild_sorted()

    def __contains__(self, key: str) -> bool:
        """Check if word exists in any enabled layer."""
        return normalization_service._normalize_headword(key) in self._all_words

    def lookup(self, key: str) -> Optional[DictionaryEntry]:
        """
        Look up a word, returning the highest-priority match.
        Returns None if not found in any layer.
        """
        norm = normalization_service._normalize_headword(key)
        for layer in self._sorted_layers:
            if norm in layer.entries:
                return layer.entries[norm]
        return None

    def lookup_all(self, key: str) -> list[DictionaryEntry]:
        """Look up a word in all layers, returning all matches."""
        norm = normalization_service._normalize_headword(key)
        results = []
        for layer in self._sorted_layers:
            if norm in layer.entries:
                results.append(layer.entries[norm])
        return results

    def get_entry(self, key: str) -> Optional[DictionaryEntry]:
        """Return the highest-priority entry (or None)."""
        return self.lookup(key)

    def keys(self) -> set[str]:
        """Return the set of normalized headwords."""
        return self._all_words

    def items(self):
        """Yield (headword, entry) pairs in arbitrary order."""
        for head in self._all_words:
            entry = self.lookup(head)
            if entry is not None:
                yield head, entry

    def word_count(self) -> int:
        """Total unique words across all enabled layers."""
        return len(self._all_words)


def _entry_to_legacy_dict(entry: DictionaryEntry) -> dict:
    """Convert a DictionaryEntry to the legacy DICT-style payload."""
    return {
        "roman": entry.romanization or "",
        "pos": entry.pos or "",
        "senses": entry.senses if entry.senses else [],
        "source": entry.source or "",
    }


class DictView:
    """Lightweight view over the segmenter's StackedDictionary (no duplication)."""

    def __init__(self, dict_getter: Callable[[], Optional[StackedDictionary]]):
        self._dict_getter = dict_getter

    def _dict(self) -> Optional[StackedDictionary]:
        try:
            return self._dict_getter()
        except Exception:
            return None

    def __contains__(self, key: str) -> bool:
        d = self._dict()
        return (key in d) if d else False

    def __getitem__(self, key: str) -> dict:
        d = self._dict()
        if not d:
            raise KeyError(key)
        entry = d.get_entry(key)
        if entry is None:
            raise KeyError(key)
        return _entry_to_legacy_dict(entry)

    def get(self, key: str, default=None) -> Optional[dict]:
        d = self._dict()
        if not d:
            return default
        entry = d.get_entry(key)
        return _entry_to_legacy_dict(entry) if entry else default

    def __iter__(self):
        d = self._dict()
        return iter(d.keys()) if d else iter(())

    def items(self):
        d = self._dict()
        if not d:
            return iter(())
        for head, entry in d.items():
            yield head, _entry_to_legacy_dict(entry)

    def keys(self):
        d = self._dict()
        return d.keys() if d else set()

    def __len__(self) -> int:
        d = self._dict()
        return d.word_count() if d else 0
