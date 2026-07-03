"""Sprint G.1 · Path A Fix 3 · Onboarding milestone reconciliation.

Self-healing pass called from `/sync` before the client receives the
onboarding_status snapshot. Derives missing milestones from other
already-persisted User fields — so a lost `mark_milestone` write
(DB blip during signup, connection drop during first activation, etc.)
self-heals on the very next `/sync`.

Discipline:
  · Idempotent — `mark_milestone` early-returns when a key is present,
    so calling this on every /sync is cheap when nothing needs healing.
  · Independent-session guarantee inherited from `mark_milestone` —
    writes here survive a caller-side rollback the same way direct
    milestone stamps do.
  · Never raises · fire-and-forget · a broken reconcile pass MUST NOT
    break /sync itself.
  · Additive-only — new derivations land here as new `if` blocks.
    Never rename or remove existing derivations without a data
    migration for the affected milestone keys.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import User

log = logging.getLogger("junior.onboarding.reconcile")


def _as_aware(dt: datetime | None) -> datetime | None:
    """Normalize to UTC-aware. SQLite (dev + test) returns naive
    datetimes on `DateTime(timezone=True)` columns."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _try_stamp(db: Session, user: User, key: str, at: datetime | None) -> bool:
    """Wraps `mark_milestone` in a fail-soft guard so a raise from any
    single derivation cannot break the reconcile pass. Returns True only
    when a new stamp was written."""
    if at is None:
        return False
    try:
        from app.onboarding_milestones import mark_milestone
        return bool(mark_milestone(db, user, key, at=at))  # type: ignore[arg-type]
    except Exception:
        log.warning(
            "[onboarding-reconcile] _try_stamp raised · user=%s · key=%s",
            user.id, key, exc_info=True,
        )
        return False


def reconcile_missing_milestones(db: Session, user: User) -> list[str]:
    """Backfill milestones we CAN derive from other User fields.

    Returns the list of milestone keys that got stamped this call.
    Never raises — every derivation is wrapped in _try_stamp so a
    single-branch failure cannot break /sync.
    """
    stamped: list[str] = []
    try:
        status = dict(user.onboarding_status or {})
    except Exception:
        # User row lacks the field or the JSON is corrupt — nothing to
        # reconcile without a starting state.
        return stamped

    # ─── signed_up_at ────────────────────────────────────────────────
    # Every existing user has a `trial_started_at` timestamp set on
    # creation (DB default = now()). Use it as the anchor if the
    # signup-time mark_milestone write was lost. Older accounts that
    # predate the field default land on a real timestamp too because
    # the migration was idempotent.
    if not status.get("signed_up_at"):
        trial_start = _as_aware(getattr(user, "trial_started_at", None))
        if _try_stamp(db, user, "signed_up_at", trial_start):
            stamped.append("signed_up_at")

    # ─── first_paid_referral ────────────────────────────────────────
    # Derive only from a referred buyer's real Whop-backed first payment.
    # The owner's own `first_paid_at` is unrelated and must never be used
    # as a proxy. Attribution can contain the owner's internal id (agency
    # invite path), Whop affiliate id, or Whop affiliate code.
    if not status.get("first_paid_referral"):
        try:
            tokens = {
                token
                for token in (
                    user.id,
                    getattr(user, "whop_affiliate_id", None),
                    getattr(user, "whop_affiliate_code", None),
                )
                if token
            }
            referred_buyer = (
                db.query(User)
                .filter(
                    User.id != user.id,
                    User.affiliate_id.in_(tokens),
                    User.first_paid_at.isnot(None),
                )
                .order_by(User.first_paid_at.asc())
                .first()
            )
            referral_paid_at = _as_aware(
                referred_buyer.first_paid_at if referred_buyer else None
            )
            if _try_stamp(
                db,
                user,
                "first_paid_referral",
                referral_paid_at,
            ):
                stamped.append("first_paid_referral")
        except Exception:
            log.warning(
                "[onboarding-reconcile] first_paid_referral derive failed · user=%s",
                user.id,
                exc_info=True,
            )

    # ─── agency_member_accepted_at (invitee side) ────────────────────
    # If the User row carries an `affiliate_id` that points at another
    # User's id (i.e., the owner) AND we lost the mark_milestone during
    # accept_invite, derive from the AgencyMember join_at timestamp.
    # Safe because affiliate_id being set to another user implies the
    # accept path ran successfully at least once.
    if not status.get("agency_member_accepted_at"):
        try:
            from app.models import AgencyMember
            row = (
                db.query(AgencyMember)
                .filter(
                    AgencyMember.user_id == user.id,
                    AgencyMember.status == "active",
                    AgencyMember.removed_at.is_(None),
                )
                .order_by(AgencyMember.joined_at.asc())
                .first()
            )
            if row is not None and row.joined_at is not None:
                joined_at = _as_aware(row.joined_at)
                if _try_stamp(db, user, "agency_member_accepted_at", joined_at):
                    stamped.append("agency_member_accepted_at")
        except Exception:
            log.warning(
                "[onboarding-reconcile] agency_member_accepted_at derive failed · user=%s",
                user.id, exc_info=True,
            )

    if stamped:
        log.info(
            "[onboarding-reconcile] self-healed %d milestone(s) for user=%s: %s",
            len(stamped), user.id, stamped,
        )
    return stamped
