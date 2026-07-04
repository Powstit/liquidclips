"""Task F · Founder Access seat-cap runtime gate + status endpoint.

Owns:
  * ``MAX_FOUNDER_SEATS`` = 12,000 · §13a locked cap.
  * ``founder_seats_used(db)`` · row count from :class:`FounderSeat`.
  * ``try_grant_founder_seat(db, whop_membership_id, plan_id, ...)`` ·
    idempotent seat grant · returns True when the row landed under
    the cap · False when the cap is reached and the caller must
    reject the tier grant / void the payment.
  * ``GET /founder/seat-status`` · public route consumed by the
    marketing site + the account-app checkout page. Fail-safe pattern:
    when the backend is unreachable the callers default to ``closed:
    false`` so a networking blip never hides the Founder CTA
    (Whop-side membership cap is the ultimate backstop).

Referenced by:
  * ``app/routes/webhooks_whop.py :: _handle_membership_valid`` — gates
    tier grants on Founder plan memberships.
  * ``liquidclips-marketing/src/lib/founderSeatStatus.ts`` — SSR read
    on the marketing homepage's Founder CTA slot.

Note on payment voiding (spec §F.2): the spec calls for voiding the
Whop payment via API when the cap is reached. For Cohort 0 that path
stays a ``TODO(cohort-0-founder-void)`` — no real Founder payments
have hit yet, so an over-cap membership is a purely defensive log
today. The Whop-side seat_cap metadata (set on ``plan_VWj1uoy2RcOsg``)
gives us a parallel enforcement rail that Whop honours natively.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import FounderSeat

log = logging.getLogger("junior.founder")
router = APIRouter(prefix="/founder", tags=["founder"])


# §13a locked cap. Do NOT change without updating the Whop plan
# metadata (seat_cap=12000 on plan_VWj1uoy2RcOsg).
MAX_FOUNDER_SEATS = 12_000


# ─────────────────────────────────────────────────────────────
# Service helpers
# ─────────────────────────────────────────────────────────────


def founder_seats_used(db: Session) -> int:
    """Number of Founder seats granted to date. Read straight from the
    row count · every insertion increments by exactly one."""
    val = db.execute(select(func.count(FounderSeat.id))).scalar_one()
    return int(val or 0)


def founder_seats_remaining(db: Session) -> int:
    return max(0, MAX_FOUNDER_SEATS - founder_seats_used(db))


def is_cohort_closed(db: Session) -> bool:
    return founder_seats_used(db) >= MAX_FOUNDER_SEATS


def try_grant_founder_seat(
    db: Session,
    *,
    whop_membership_id: str,
    plan_id: str,
    user_id: str | None = None,
    whop_user_id: str | None = None,
) -> tuple[bool, str]:
    """Attempt to reserve one of the 12,000 Founder seats.

    Returns ``(True, "granted")`` when a new row lands under the cap,
    ``(True, "idempotent")`` when the row already existed for this
    ``whop_membership_id`` (webhook retry — safe no-op), or
    ``(False, "cohort_full")`` when the cap is reached.

    The unique constraint on ``whop_membership_id`` is the primary
    idempotency guard; the pre-check is a fast path that also lets us
    tell the caller which branch fired.
    """
    existing = (
        db.query(FounderSeat)
        .filter(FounderSeat.whop_membership_id == whop_membership_id)
        .one_or_none()
    )
    if existing is not None:
        return True, "idempotent"
    if is_cohort_closed(db):
        log.warning(
            "[founder] refusing seat grant · cohort_full · plan=%s membership=%s",
            plan_id,
            whop_membership_id,
        )
        return False, "cohort_full"
    row = FounderSeat(
        whop_membership_id=whop_membership_id,
        plan_id=plan_id,
        user_id=user_id,
        whop_user_id=whop_user_id,
    )
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        # Concurrent writer landed first — treat as idempotent.
        db.rollback()
        # After rollback the session is empty; re-look up so the caller
        # sees the winning row for logging.
        winner = (
            db.query(FounderSeat)
            .filter(FounderSeat.whop_membership_id == whop_membership_id)
            .one_or_none()
        )
        if winner is None:
            # Extremely unlikely (race + rollback + row gone). Re-raise.
            raise
        return True, "idempotent"
    return True, "granted"


# ─────────────────────────────────────────────────────────────
# Public route · GET /founder/seat-status
# ─────────────────────────────────────────────────────────────


class FounderSeatStatus(BaseModel):
    used: int
    remaining: int
    closed: bool
    max_seats: int = MAX_FOUNDER_SEATS


@router.get("/seat-status", response_model=FounderSeatStatus)
def get_seat_status(
    db: Annotated[Session, Depends(get_db)],
) -> FounderSeatStatus:
    """Public snapshot of the Founder Access cohort.

    No auth: the marketing site + checkout page read this before the
    user is even signed in. Fail-safe on the caller side (default to
    ``closed=False`` when the fetch fails) so a networking blip never
    hides the Founder CTA silently — the Whop-side seat_cap metadata
    is the ultimate enforcement rail.
    """
    used = founder_seats_used(db)
    return FounderSeatStatus(
        used=used,
        remaining=max(0, MAX_FOUNDER_SEATS - used),
        closed=used >= MAX_FOUNDER_SEATS,
    )
