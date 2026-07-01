"""v2.2.14 · one-shot backfill of user.handle for existing rows.

Called from main.py's lifespan startup. Idempotent — only touches
rows where handle IS NULL. Derives from the most meaningful source
we have per user and sanitises to Whop's affiliate-code shape so the
same string works as both the chat @name and the share-URL slug.

Collision handling: if the derived handle is already taken (either
because two users share the same email prefix or because a name
collided with a prior backfill), we append `-N` where N counts up
until unique.
"""

from __future__ import annotations

import logging
import re

from sqlalchemy.orm import Session

from app.models import User

log = logging.getLogger("junior.handle_backfill")

# Whop affiliate-code shape: alphanumeric + dash + underscore + dot.
# Constrained to lower-case for case-insensitive uniqueness (the
# unique index in main.py uses LOWER(handle)).
_SAFE_HANDLE_CHARS = re.compile(r"[^a-z0-9._-]+")
_HANDLE_MIN_LEN = 3
_HANDLE_MAX_LEN = 30


def sanitise_candidate(raw: str) -> str:
    """Lower-case + strip unsafe chars + trim length. Empty output ==
    caller falls back to the next derivation source."""
    if not raw:
        return ""
    lower = raw.lower().strip()
    cleaned = _SAFE_HANDLE_CHARS.sub("-", lower).strip("-._")
    if len(cleaned) < _HANDLE_MIN_LEN:
        return ""
    return cleaned[:_HANDLE_MAX_LEN]


def derive_seed_handle(user: User) -> str:
    """Best-effort seed handle from the most meaningful source we have.
    Falls through: cached_display_handle → email prefix → uid8 slug."""
    # Prefer the display handle Whop / affiliate cron already cached — it's
    # usually the closest to what the user thinks of as "their name".
    if user.cached_display_handle:
        candidate = sanitise_candidate(user.cached_display_handle)
        if candidate:
            return candidate

    if user.email and "@" in user.email:
        candidate = sanitise_candidate(user.email.split("@", 1)[0])
        if candidate:
            return candidate

    # Last-resort deterministic slug so no user ever ends up handle-less.
    return f"clipper-{user.id[:8]}"


def resolve_unique(db: Session, seed: str, user_id: str) -> str:
    """Return a unique handle, appending -N counter if seed is taken.
    Excludes the user's own row so a re-run doesn't infinite-loop on
    an existing handle."""
    candidate = seed
    counter = 1
    while True:
        # Case-insensitive lookup mirrors the UNIQUE INDEX ON LOWER(handle)
        # in main.py's schema. Small query on an indexed column · fast.
        clash = (
            db.query(User)
            .filter(User.id != user_id)
            .filter(User.handle.ilike(candidate))
            .limit(1)
            .one_or_none()
        )
        if clash is None:
            return candidate
        counter += 1
        # Truncate seed so seed-N stays within max_length.
        room = _HANDLE_MAX_LEN - (len(str(counter)) + 1)
        candidate = f"{seed[:room]}-{counter}"
        if counter > 999:
            # Absurd worst case · fall back to uid8 slug to guarantee we
            # never loop forever on a pathological dataset.
            return f"clipper-{user_id[:8]}"


def backfill_missing_handles(db: Session) -> int:
    """Populate user.handle for every row where it's NULL. Returns the
    number of rows updated. Safe to call on every boot — a row with a
    handle set is left untouched."""
    updated = 0
    users_missing = (
        db.query(User)
        .filter(User.handle.is_(None))
        .all()
    )
    for user in users_missing:
        try:
            seed = derive_seed_handle(user)
            handle = resolve_unique(db, seed, user.id)
            user.handle = handle
            updated += 1
        except Exception:  # noqa: BLE001 · one bad row shouldn't stop the batch
            log.exception("[handle_backfill] failed on user=%s", user.id)
    if updated:
        db.commit()
    return updated
