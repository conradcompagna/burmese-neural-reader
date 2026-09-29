"""Burmese reader: srs."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from . import normalization as normalization_service
from .runtime import feature_state


@dataclass
class TokenStats:
    head: str
    display: str
    total_seen: int = 0
    first_seen: Optional[datetime] = None
    last_seen: Optional[datetime] = None

    def to_dict(self) -> dict:
        return {
            "head": self.head,
            "display": self.display,
            "total_seen": self.total_seen,
            "first_seen": self.first_seen.isoformat() if self.first_seen else None,
            "last_seen": self.last_seen.isoformat() if self.last_seen else None,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "TokenStats":
        def _dt(val):
            if not val:
                return None
            try:
                return datetime.fromisoformat(val)
            except Exception:
                return None

        return cls(
            head=data.get("head", "") or "",
            display=data.get("display", "") or "",
            total_seen=int(data.get("total_seen") or 0),
            first_seen=_dt(data.get("first_seen")),
            last_seen=_dt(data.get("last_seen")),
        )


@dataclass
class ReviewState:
    repetitions: int = 0
    interval_days: float = 0.0
    ease_factor: float = 2.5
    due: Optional[datetime] = None
    last_review: Optional[datetime] = None

    def to_dict(self) -> dict:
        return {
            "repetitions": self.repetitions,
            "interval_days": self.interval_days,
            "ease_factor": self.ease_factor,
            "due": self.due.isoformat() if self.due else None,
            "last_review": self.last_review.isoformat() if self.last_review else None,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "ReviewState":
        def _dt(val):
            if not val:
                return None
            try:
                return datetime.fromisoformat(val)
            except Exception:
                return None

        return cls(
            repetitions=int(data.get("repetitions") or 0),
            interval_days=float(data.get("interval_days") or 0.0),
            ease_factor=float(data.get("ease_factor") or 2.5),
            due=_dt(data.get("due")),
            last_review=_dt(data.get("last_review")),
        )


@dataclass
class CardState:
    head: str
    stats: TokenStats
    review: ReviewState

    def to_dict(self) -> dict:
        return {
            "head": self.head,
            "stats": self.stats.to_dict(),
            "review": self.review.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "CardState":
        head = data.get("head", "") or ""
        stats_data = data.get("stats") or {}
        review_data = data.get("review") or {}
        stats = TokenStats.from_dict(stats_data)
        review = ReviewState.from_dict(review_data)
        return cls(head=head, stats=stats, review=review)


class ReadingSRS:
    """On-disk spaced-repetition engine keyed by normalized Burmese headwords."""

    def __init__(self, state_path: Path):
        self.state_path = Path(state_path)
        self.cards: dict[str, CardState] = {}
        self._loaded = False

    # ---- persistence -----------------------------------------------------
    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        if self.state_path.exists():
            try:
                raw = self.state_path.read_text("utf-8")
                data = json.loads(raw)
                if isinstance(data, dict):
                    for head, cdata in data.items():
                        try:
                            self.cards[head] = CardState.from_dict(cdata)
                        except Exception as e:
                            print("[WARN] bad SRS card for", head, ":", e)
            except Exception as e:
                print("[WARN] Failed to load reading SRS state:", e)
                self.cards = {}
        self._loaded = True

    def _save(self) -> None:
        if not self._loaded:
            return
        if not READING_SRS_SAVE_ENABLED:
            return
        try:
            payload = {head: card.to_dict() for head, card in self.cards.items()}
            self.state_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as e:
            print("[WARN] Failed to save reading SRS state:", e)

    # ---- core operations -------------------------------------------------
    def _normalize(self, token: str) -> str:
        """Use the same normalization as dictionary headwords."""
        return normalization_service.normalize_headword(token or "")

    def observe_tokens(self, tokens, autosave: bool = True) -> None:
        """Record raw exposure counts from whatever the user has read.
        `tokens` should already be dictionary-known segments/headwords.
        """
        self._ensure_loaded()
        if not tokens:
            return
        now = datetime.utcnow()
        for t in tokens:
            head = self._normalize(t)
            if not head:
                continue
            card = self.cards.get(head)
            if card is None:
                stats = TokenStats(
                    head=head,
                    display=t,
                    total_seen=1,
                    first_seen=now,
                    last_seen=now,
                )
                review = ReviewState()
                card = CardState(head=head, stats=stats, review=review)
                self.cards[head] = card
            else:
                card.stats.total_seen += 1
                card.stats.last_seen = now
                card.stats.display = t  # keep latest surface form
        if autosave:
            self._save()

    # ---- scheduling ------------------------------------------------------
    def _select_next_card(self, now: Optional[datetime] = None) -> Optional[CardState]:
        self._ensure_loaded()
        if now is None:
            now = datetime.utcnow()
        due: list[CardState] = []
        new: list[CardState] = []
        fallback: list[CardState] = []
        for card in self.cards.values():
            rs = card.review
            st = card.stats
            if rs.repetitions > 0 and rs.due is not None:
                if rs.due <= now:
                    due.append(card)
                else:
                    fallback.append(card)
            else:
                new.append(card)
        if due:
            due.sort(key=lambda c: (c.review.due, -(c.stats.total_seen or 0)))
            return due[0]
        if new:
            new.sort(
                key=lambda c: (
                    -(c.stats.total_seen or 0),
                    c.stats.first_seen or now,
                )
            )
            return new[0]
        if fallback:
            fallback.sort(key=lambda c: c.review.due or now)
            return fallback[0]
        return None

    def get_next_card(self) -> Optional[dict]:
        card = self._select_next_card()
        if card is None:
            return None
        return {
            "head": card.head,
            "display": card.stats.display,
            "is_new": card.review.repetitions == 0,
            "stats": card.stats.to_dict(),
            "review": card.review.to_dict(),
        }

    # ---- grading ---------------------------------------------------------
    def _update_sm2(
        self, review: ReviewState, quality: int, now: Optional[datetime] = None
    ) -> None:
        """SM-2 style update.
        quality: 0ÃÂ¢Ã¢âÂ¬Ã¢â¬Å5, where <3 = failure, =3 = success.
        Here we only use 4 (knew) or 2 (didn't know).
        """
        if now is None:
            now = datetime.utcnow()
        q = max(0, min(5, int(quality)))
        if q < 3:
            review.repetitions = 0
            review.interval_days = 1.0
        else:
            if review.repetitions == 0:
                review.interval_days = 1.0
            elif review.repetitions == 1:
                review.interval_days = 3.0
            else:
                review.interval_days = review.interval_days * review.ease_factor
            review.repetitions += 1
        ef = review.ease_factor
        ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
        if ef < 1.3:
            ef = 1.3
        review.ease_factor = ef
        review.last_review = now
        review.due = now + timedelta(days=review.interval_days)

    def grade_card(self, head: str, knew: bool, autosave: bool = True) -> None:
        self._ensure_loaded()
        norm = self._normalize(head)
        if not norm:
            return
        card = self.cards.get(norm)
        if card is None:
            return
        quality = 4 if knew else 2
        self._update_sm2(card.review, quality)
        if autosave:
            self._save()


READING_SRS_STATE_PATH = Path("reading_srs_state.json")


READING_SRS_SAVE_ENABLED = False


def _new_state():
    from types import SimpleNamespace

    return SimpleNamespace(
        READING_SRS=ReadingSRS(READING_SRS_STATE_PATH),
    )


state = feature_state("srs", _new_state)
