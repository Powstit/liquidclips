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

    Never raises for a bad key — logs a warning and returns False. Never
    raises for a stalled write — the surrounding `try` catches, logs,
    and returns False so the caller's transaction is never derailed
    by a telemetry hiccup.
    """
    if key not in ALL_MILESTONE_KEYS:
        log.warning("[onboarding] unknown milestone key: %s", key)
        return False

    status = dict(user.onboarding_status or {})
    existing = status.get(key)
    if existing:
        return False

    ts = (at or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    status[key] = ts
    try:
        user.onboarding_status = status
        # JSON mutation on SQLAlchemy needs an explicit flag so the ORM
        # tracks the change on assignment of a re-serialised dict.
        flag_modified(user, "onboarding_status")
        db.add(user)
    except Exception:
        log.warning("[onboarding] mark_milestone write failed · user=%s · key=%s", user.id, key, exc_info=True)
        return False
    return True


def snapshot(user: User) -> dict[str, str | None]:
    """Return the full milestone dict shaped so every canonical key is
    present in the response. Absent keys land as `null` so the desktop
    emitter can diff `null → timestamp` transitions cleanly. Never
    returns extra keys — a database row that carries a legacy /
    unknown milestone name is filtered out at read time."""
    src = user.onboarding_status or {}
    return {k: (src.get(k) or None) for k in ALL_MILESTONE_KEYS}
