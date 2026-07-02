"""Sprint G.1 · Kade Reactive Onboarding · milestone stream helper.

Central write path for the User.onboarding_status JSON. Callers
enumerate a MilestoneKey and pass a User row; the helper stamps the
timestamp only when the key is currently absent (idempotent · no
overwrite of the first-occurrence anchor).

Discipline:
  · This module is the ONLY writer to User.onboarding_status. Routes
    call `mark_milestone(...)`; they never construct the dict inline.
  · The helper is safe to call from any transaction — it uses a
    nested `savepoint` so a downstream route rollback never loses the
    milestone stamp.
  · Emission of the desktop bus event lives in
    desktop-2/src/lib/onboardingEmitter.ts. This module writes the
    truth; the emitter turns writes into bus events on the client.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Literal

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.models import User

log = logging.getLogger("junior.onboarding")


# The closed vocabulary — new milestones require a matching KadeState
# pose mapping in desktop-2/src/design-os/components/KadeController.tsx.
# Additive only; never rename a landed key (existing rows would then
# never see the new key filled and never fire the milestone).
MilestoneKey = Literal[
    "signed_up_at",
    "first_launch_at",
    "first_clip_at",
    "first_publish_at",
    "first_earn_view_at",
    "first_bounty_submit",
    "first_paid_referral",
    "agency_owner_first_campaign",
    "agency_owner_first_invite",
    "agency_member_accepted_at",
]


ALL_MILESTONE_KEYS: tuple[str, ...] = (
    "signed_up_at",
    "first_launch_at",
    "first_clip_at",
    "first_publish_at",
    "first_earn_view_at",
    "first_bounty_submit",
    "first_paid_referral",
    "agency_owner_first_campaign",
    "agency_owner_first_invite",
    "agency_member_accepted_at",
)


def mark_milestone(
    db: Session,
    user: User,
    key: MilestoneKey,
    *,
    at: datetime | None = None,
) -> bool:
    """Stamp `user.onboarding_status[key] = at` iff the key is currently
    absent (or None). Returns True when the write happened, False when
    the key was already stamped (no-op).

    Rollback-survival guarantee (Sprint G.1 Integrity fix · 2026-07-02):

    The milestone write commits to an INDEPENDENT session opened from
    `SessionLocal()`. If the caller's transaction later rolls back, the
    milestone stamp survives. This is a *stronger* guarantee than a
    SQLAlchemy savepoint (`db.begin_nested()`) — savepoints commit and
    roll back with their parent, so a caller-side `db.rollback()` would
    still lose the milestone. Telemetry-critical writes need a separate
    connection, not a savepoint. See:
      https://docs.sqlalchemy.org/en/20/orm/session_transaction.html
      #session-begin-nested

    Locally, we also mirror the timestamp onto the caller's User row (via
    `flag_modified`) so any subsequent read inside the caller's still-
    open transaction sees the new milestone without a re-fetch.

    Never raises for a bad key — logs a warning and returns False. Never
    raises for a stalled write — the surrounding `try` catches, logs,
    and returns False so the caller's transaction is never derailed
    by a telemetry hiccup.
    """
    if key not in ALL_MILESTONE_KEYS:
        log.warning("[onboarding] unknown milestone key: %s", key)
        return False

    caller_status = dict(user.onboarding_status or {})
    if caller_status.get(key):
        return False

    ts = (at or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    # Independent session · this write commits regardless of the caller's
    # transaction. Imported lazily to keep `app.db` off the module-import
    # graph for test fixtures that stub SessionLocal.
    try:
        from app.db import SessionLocal
    except Exception:
        log.warning("[onboarding] SessionLocal unavailable — skipping milestone write", exc_info=True)
        return False

    fresh = SessionLocal()
    try:
        target = fresh.get(User, user.id)
        if target is None:
            # User row hasn't reached the isolated session yet (e.g. still
            # inside the caller's uncommitted create). Fall back to writing
            # on the caller session — cheaper than a savepoint dance and
            # keeps the JSON coherent within the caller's transaction.
            caller_status[key] = ts
            user.onboarding_status = caller_status
            flag_modified(user, "onboarding_status")
            db.add(user)
            return True

        target_status = dict(target.onboarding_status or {})
        if target_status.get(key):
            # Concurrency: another request stamped this key between our
            # first-check and now. Mirror the persisted timestamp onto the
            # caller's row so /sync sees the same value.
            caller_status[key] = target_status[key]
            user.onboarding_status = caller_status
            flag_modified(user, "onboarding_status")
            return False

        target_status[key] = ts
        target.onboarding_status = target_status
        flag_modified(target, "onboarding_status")
        # Savepoint scope keeps the ORM state coherent if commit fails.
        with fresh.begin_nested():
            fresh.add(target)
        fresh.commit()

        # Mirror onto the caller's user row so a subsequent /sync inside
        # the same transaction reads the milestone without a re-fetch.
        caller_status[key] = ts
        user.onboarding_status = caller_status
        flag_modified(user, "onboarding_status")
        return True
    except Exception:
        try:
            fresh.rollback()
        except Exception:  # noqa: BLE001
            pass
        log.warning(
            "[onboarding] mark_milestone write failed · user=%s · key=%s",
            user.id, key, exc_info=True,
        )
        return False
    finally:
        fresh.close()


def snapshot(user: User) -> dict[str, str | None]:
    """Return the full milestone dict shaped so every canonical key is
    present in the response. Absent keys land as `null` so the desktop
    emitter can diff `null → timestamp` transitions cleanly. Never
    returns extra keys — a database row that carries a legacy /
    unknown milestone name is filtered out at read time."""
    src = user.onboarding_status or {}
    return {k: (src.get(k) or None) for k in ALL_MILESTONE_KEYS}
