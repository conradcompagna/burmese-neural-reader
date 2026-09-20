from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Iterable, List, Optional


def _normalize_burmese(s: str) -> str:
    """
    Simple NFC normalization for Burmese text.
    Mirrors newserver.normalize_burmese but is self-contained to avoid circular imports.
    """
    if not s:
        return s
    return unicodedata.normalize("NFC", s)


def _normalize_headword(s: str) -> str:
    """
    Normalize a headword for keying:
    - NFC normalize
    - keep only Myanmar-range characters (U+1000–U+109F)
    """
    if not s:
        return ""
    s = _normalize_burmese(s)
    s = "".join(ch for ch in s if 0x1000 <= ord(ch) <= 0x109F)
    return s.strip()


def _dt_to_str(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    return dt.isoformat(timespec="seconds")


def _dt_from_str(val: Optional[str]) -> Optional[datetime]:
    if not val:
        return None
    val = val.strip()
    if not val:
        return None
    # Accept both bare ISO and ISO+"Z"
    if val.endswith("Z"):
        val = val[:-1]
    try:
        return datetime.fromisoformat(val)
    except ValueError:
        return None


@dataclass
class TokenStats:
    head: str                 # normalized key
    display: str              # most recent surface form
    total_seen: int = 0
    first_seen: Optional[datetime] = None
    last_seen: Optional[datetime] = None

    def to_dict(self) -> Dict:
        return {
            "head": self.head,
            "display": self.display,
            "total_seen": self.total_seen,
            "first_seen": _dt_to_str(self.first_seen),
            "last_seen": _dt_to_str(self.last_seen),
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "TokenStats":
        return cls(
            head=str(data.get("head") or ""),
            display=str(data.get("display") or ""),
            total_seen=int(data.get("total_seen") or 0),
            first_seen=_dt_from_str(data.get("first_seen")),
            last_seen=_dt_from_str(data.get("last_seen")),
        )


@dataclass
class ReviewState:
    repetitions: int = 0          # how many successful reviews
    interval_days: float = 0.0    # current spaced interval
    ease_factor: float = 2.5      # Anki-style EF, constrained to [1.3, 3.0]
    due: Optional[datetime] = None
    last_review: Optional[datetime] = None

    def to_dict(self) -> Dict:
        return {
            "repetitions": self.repetitions,
            "interval_days": self.interval_days,
            "ease_factor": self.ease_factor,
            "due": _dt_to_str(self.due),
            "last_review": _dt_to_str(self.last_review),
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "ReviewState":
        return cls(
            repetitions=int(data.get("repetitions") or 0),
            interval_days=float(data.get("interval_days") or 0.0),
            ease_factor=float(data.get("ease_factor") or 2.5),
            due=_dt_from_str(data.get("due")),
            last_review=_dt_from_str(data.get("last_review")),
        )


@dataclass
class CardState:
    head: str
    display: str
    stats: TokenStats
    review: ReviewState

    def to_dict(self) -> Dict:
        return {
            "head": self.head,
            "display": self.display,
            "stats": self.stats.to_dict(),
            "review": self.review.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "CardState":
        stats = TokenStats.from_dict(data.get("stats") or {})
        review = ReviewState.from_dict(data.get("review") or {})
        head = stats.head or str(data.get("head") or "")
        display = stats.display or str(data.get("display") or head)
        return cls(head=head, display=display, stats=stats, review=review)


class ReadingSRS:
    """
    Minimal Anki-style spaced repetition for Burmese tokens.

    You drive it as follows (integration is up to newserver.py):
      - Call observe_tokens([...]) whenever the reader encounters tokens you
        want to track (already filtered to dictionary-known tokens).
      - Call get_next_card() to fetch the next card for flashcard mode.
      - Call grade_card(head, knew=True/False) after the user presses
        “I know” / “I don’t know”.
    """

    MIN_EASE: float = 1.3
    MAX_EASE: float = 3.0

    def __init__(self, state_path: Path | str):
        self.state_path = Path(state_path)
        self.cards: Dict[str, CardState] = {}
        self._loaded: bool = False
        # Optional unigram frequency lookup: head -> count
        self.unigram_counts: Dict[str, int] = {}

    def set_unigram_counts(self, counts: Dict[str, int]) -> None:
        """
        Inject unigram frequencies (head -> count) to influence card ordering.
        If a headword is missing here, total_seen will be used instead.
        """
        self.unigram_counts = counts or {}

    # ---------- persistence ----------

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        if not self.state_path.exists():
            self.cards = {}
            return
        try:
            with self.state_path.open("r", encoding="utf-8") as f:
                raw = json.load(f)
        except Exception:
            self.cards = {}
            return

        cards: Dict[str, CardState] = {}
        if isinstance(raw, dict):
            for key, val in raw.items():
                if not isinstance(val, dict):
                    continue
                cs = CardState.from_dict(val)
                norm = _normalize_headword(cs.head)
                if not norm:
                    continue
                cs.head = norm
                cs.stats.head = norm
                cards[norm] = cs
        self.cards = cards

    def _save(self) -> None:
        if not self._loaded:
            # Nothing to save
            return
        try:
            data = {head: card.to_dict() for head, card in self.cards.items()}
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            with self.state_path.open("w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception:
            # Fail-soft; don't crash the main server
            pass

    # ---------- observation ----------

    def observe_tokens(self, tokens: Iterable[str], autosave: bool = True) -> None:
        """
        Record that the user has encountered these tokens while reading.

        tokens: iterable of surface forms (e.g. segments already filtered so that
                only dictionary-known tokens are included).
        """
        self._ensure_loaded()
        now = datetime.utcnow()
        for tok in tokens:
            self._observe_single(tok, now)
        if autosave:
            self._save()

    def observe_token(self, token: str, autosave: bool = True) -> None:
        self.observe_tokens([token], autosave=autosave)

    def _observe_single(self, token: str, now: datetime) -> None:
        token = token or ""
        display = token
        norm = _normalize_headword(token)
        if not norm:
            return

        card = self.cards.get(norm)
        if card is None:
            stats = TokenStats(
                head=norm,
                display=display,
                total_seen=1,
                first_seen=now,
                last_seen=now,
            )
            review = ReviewState(
                repetitions=0,
                interval_days=0.0,
                ease_factor=2.5,
                due=None,
                last_review=None,
            )
            card = CardState(head=norm, display=display, stats=stats, review=review)
            self.cards[norm] = card
        else:
            card.display = display or card.display
            card.stats.display = card.display
            card.stats.total_seen += 1
            if card.stats.first_seen is None:
            card.stats.first_seen = now
        card.stats.last_seen = now

    # ---------- selection ----------

    def _freq_priority(self, card: CardState) -> int:
        """
        Priority score for ordering cards.
        Uses unigram count if available; otherwise falls back to observed total_seen.
        """
        freq = self.unigram_counts.get(card.head, 0)
        return freq if freq > 0 else card.stats.total_seen

    def _select_next_card(self, now: Optional[datetime] = None) -> Optional[CardState]:
        self._ensure_loaded()
        if not self.cards:
            return None
        if now is None:
            now = datetime.utcnow()

        cards = list(self.cards.values())

        # 1) Due review cards (learnt items whose scheduled due <= now)
        due_cards = [
            c for c in cards
            if c.review.repetitions > 0 and c.review.due is not None and c.review.due <= now
        ]
        if due_cards:
            due_cards.sort(
                key=lambda c: (
                    c.review.due or now,
                    -self._freq_priority(c),
                )
            )
            return due_cards[0]

        # 2) New cards (never successfully reviewed) ordered by frequency
        new_cards = [c for c in cards if c.review.repetitions == 0]
        if new_cards:
            new_cards.sort(
                key=lambda c: (
                    -self._freq_priority(c),
                    c.stats.first_seen or now,
                )
            )
            return new_cards[0]

        # 3) Fallback: not-yet-due review cards, earliest due first
        scheduled = [c for c in cards if c.review.due is not None]
        if not scheduled:
            return None
        scheduled.sort(
            key=lambda c: (
                c.review.due or now,
                -self._freq_priority(c),
            )
        )
        return scheduled[0]

    def get_next_card(self, now: Optional[datetime] = None) -> Optional[Dict]:
        """
        Return the next card to show in flashcard mode, or None if nothing.

        The returned dict is JSON-serializable, e.g.:

            {
                "head": "...",          # normalized key
                "display": "...",       # last-seen surface form
                "is_new": true/false,   # whether repetitions == 0
                "stats": {...},         # TokenStats as dict
                "review": {...},        # ReviewState as dict
            }
        """
        card = self._select_next_card(now=now)
        if card is None:
            return None
        is_new = card.review.repetitions == 0
        return {
            "head": card.head,
            "display": card.display,
            "is_new": is_new,
            "stats": card.stats.to_dict(),
            "review": card.review.to_dict(),
        }

    # ---------- grading ----------

    def grade_card(self, head: str, knew: bool, autosave: bool = True,
                   now: Optional[datetime] = None) -> None:
        """
        Update spaced repetition state for a card after the user answers it.

        head:  Burmese headword (any surface form; will be normalized)
        knew:  True if user clicked “I know”, False if “I don’t know”
        """
        self._ensure_loaded()
        norm = _normalize_headword(head)
        if not norm:
            return
        card = self.cards.get(norm)
        if card is None:
            # If the card was not in state yet, treat this as first observation.
            now_dt = now or datetime.utcnow()
            self._observe_single(head, now_dt)
            card = self.cards.get(norm)
            if card is None:
                return

        now = now or datetime.utcnow()
        rs = card.review

        if not knew:
            # “I don’t know”: reset scheduling but keep ease factor slightly reduced.
            rs.repetitions = 0
            rs.interval_days = 0.0
            rs.ease_factor = max(self.MIN_EASE, rs.ease_factor - 0.3)
            rs.last_review = now
            rs.due = now + timedelta(days=1)
        else:
            # “I know”: standard SM-2 style with only a binary grade.
            r = rs.repetitions
            if r == 0:
                interval = 1.0
            elif r == 1:
                interval = 3.0
            else:
                # Grow interval by ease factor
                base = rs.interval_days if rs.interval_days > 0 else 3.0
                interval = base * rs.ease_factor
                # Clamp to at least 1 day
                if interval < 1.0:
                    interval = 1.0

            rs.repetitions = r + 1
            rs.interval_days = interval
            # Slightly increase ease for a successful recall
            rs.ease_factor = min(self.MAX_EASE, rs.ease_factor + 0.05)
            rs.last_review = now
            rs.due = now + timedelta(days=interval)

        if autosave:
            self._save()

    # ---------- diagnostics / listing ----------

    def get_top_tokens(self, limit: int = 100) -> List[Dict]:
        """
        Return the most frequently seen tokens, for overview or debug screens.

        Result is a list of dicts sorted by total_seen descending.
        """
        self._ensure_loaded()
        cards = sorted(
            self.cards.values(),
            key=lambda c: (-c.stats.total_seen, c.stats.first_seen or datetime.min),
        )
        out: List[Dict] = []
        for card in cards[: max(0, limit)]:
            out.append(
                {
                    "head": card.head,
                    "display": card.display,
                    "total_seen": card.stats.total_seen,
                    "first_seen": _dt_to_str(card.stats.first_seen),
                    "last_seen": _dt_to_str(card.stats.last_seen),
                    "repetitions": card.review.repetitions,
                    "due": _dt_to_str(card.review.due),
                }
            )
        return out
