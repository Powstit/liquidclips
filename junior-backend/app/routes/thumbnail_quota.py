"""v2.2.17 · thumbnail batch quota enforcement.

Hosted-AI tiers get a monthly cap so cost never runs away. Boost packs
top up when they exhaust the included allowance.

Endpoints:
  GET  /me/thumbnail-quota      · desktop reads current state before
                                  showing "X batches left" widget
  POST /me/thumbnail-quota/spend · desktop calls just before firing an
                                   OpenAI batch · returns 402 if over
                                   cap so the UI shows "Buy boost pack
                                   $9 for 25 more" instead of billing.

Boost pack fulfilment: webhooks_whop.py listens for payment_succeeded
on plan_xLS3gGsJ16455 and increments thumbnail_batches_boost_credit
by 25 on receipt.

Economics (as of 2026-07-01):
  · Standard batch (8 variants medium)  ≈ $0.24 raw OpenAI cost
  · HD batch (8 variants hi-fidelity)   ≈ $1.52 raw OpenAI cost
  · Pro tier: 100 batches/mo included   ≈ $24 cost · 76% margin
  · Agency tier: 500 batches/mo         ≈ $120 cost · 76% margin
  · Boost pack: 25 batches for $9       ≈ $6 cost · 33% margin
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.features import is_admin_email
from app.models import User

router = APIRouter(prefix="/me/thumbnail-quota", tags=["thumbnail-quota"])

# Tier → monthly included batches. Tier keys mirror features.py
# internal names (solo/growth/autopilot/agency + legacy aliases).
_TIER_MONTHLY_QUOTA: dict[str, int | None] = {
    "free":      0,       # can browse studio · cannot generate
    "solo":      None,    # BYO OpenAI key · no server cap
    "pro":       None,    # legacy Solo alias
    "growth":    100,     # Pro tier (v2 rename)
    "autopilot": 500,     # Agency legacy alias
    "agency":    500,
    # 2026-07-02 · 3-tier agency ladder. Solo mirrors mid quota (the
    # thumbnail is a low-cost per-unit generation — no need to nickel-
    # and-dime the $50 tier); White-Label doubles as its signature.
    "agency_solo":       500,
    "agency_whitelabel": 1000,
}

BOOST_PACK_BATCH_COUNT = 25


def _quota_for_tier(tier: str | None, founder: bool) -> int | None:
    """Return the monthly batch quota for a tier. None means unlimited /
    not tracked (Solo BYO-key path). 0 means blocked (free)."""
    if founder:
        return None  # founders bypass · admin-adjacent
    return _TIER_MONTHLY_QUOTA.get(tier or "free", 0)


def _period_start(now: datetime) -> datetime:
    """First-of-month UTC. Batch counter resets when the stored
    period_start is older than the current month's start."""
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _rollover_if_needed(user: User, now: datetime) -> None:
    """Reset the monthly counter when we cross the UTC month boundary.
    Boost credit is NOT reset — it's a topped-up balance that persists."""
    current_period = _period_start(now)
    stored = user.thumbnail_batches_period_start
    if stored is None or stored.tzinfo is None:
        stored = stored.replace(tzinfo=timezone.utc) if stored else None
    if stored is None or stored < current_period:
        user.thumbnail_batches_used_this_period = 0
        user.thumbnail_batches_period_start = current_period


class ThumbnailQuotaOut(BaseModel):
    """Response shape for GET /me/thumbnail-quota. The desktop uses
    this to paint the "X batches left this month" widget in
    ThumbnailBatchControls."""

    tier: str
    monthly_included: int | None  # null = BYO key · no cap
    used_this_period: int
    period_start: datetime | None
    boost_credit: int
    remaining_total: int | None  # null = unlimited path; int = monthly + boost - used
    can_generate: bool
    over_cap: bool
    # Whop checkout URL for the Boost Pack · surfaced verbatim in the
    # UI's out-of-quota modal so a single click sends the user to the
    # $9 top-up.
    boost_pack_url: str = "https://whop.com/checkout/plan_xLS3gGsJ16455"
    boost_pack_batches: int = BOOST_PACK_BATCH_COUNT


def _quota_snapshot(user: User) -> ThumbnailQuotaOut:
    now = datetime.now(timezone.utc)
    _rollover_if_needed(user, now)
    monthly = _quota_for_tier(user.tier, user.founder_flag or is_admin_email(user.email))
    if monthly is None:
        # BYO-key path (Solo) or admin/founder · treat as always allowed
        return ThumbnailQuotaOut(
            tier=user.tier or "free",
            monthly_included=None,
            used_this_period=user.thumbnail_batches_used_this_period,
            period_start=user.thumbnail_batches_period_start,
            boost_credit=user.thumbnail_batches_boost_credit,
            remaining_total=None,
            can_generate=True,
            over_cap=False,
        )
    used = user.thumbnail_batches_used_this_period or 0
    boost = user.thumbnail_batches_boost_credit or 0
    monthly_remaining = max(0, monthly - used)
    total_remaining = monthly_remaining + boost
    return ThumbnailQuotaOut(
        tier=user.tier or "free",
        monthly_included=monthly,
        used_this_period=used,
        period_start=user.thumbnail_batches_period_start,
        boost_credit=boost,
        remaining_total=total_remaining,
        can_generate=total_remaining > 0,
        over_cap=total_remaining <= 0,
    )


@router.get("", response_model=ThumbnailQuotaOut)
def get_quota(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ThumbnailQuotaOut:
    """Return the caller's current thumbnail-batch quota state."""
    snap = _quota_snapshot(user)
    # Persist any rollover work done by _quota_snapshot.
    db.commit()
    return snap


class SpendResponse(BaseModel):
    state: Literal["ok", "no_quota_needed", "over_cap"]
    used_this_period: int
    boost_credit: int
    remaining_total: int | None
    boost_pack_url: str = "https://whop.com/checkout/plan_xLS3gGsJ16455"


@router.post("/spend", response_model=SpendResponse)
def spend_batch(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> SpendResponse:
    """Called by the desktop's ThumbnailBatchControls just BEFORE
    firing a batch. If the user is on a metered tier and over cap,
    returns 402 · desktop surfaces the "Buy 25 more for $9" modal.
    Otherwise decrements + returns state."""
    now = datetime.now(timezone.utc)
    _rollover_if_needed(user, now)
    monthly = _quota_for_tier(user.tier, user.founder_flag or is_admin_email(user.email))

    if monthly is None:
        # BYO-key path · no server counter to move
        db.commit()
        return SpendResponse(
            state="no_quota_needed",
            used_this_period=user.thumbnail_batches_used_this_period,
            boost_credit=user.thumbnail_batches_boost_credit,
            remaining_total=None,
        )

    used = user.thumbnail_batches_used_this_period or 0
    boost = user.thumbnail_batches_boost_credit or 0

    monthly_remaining = max(0, monthly - used)
    if monthly_remaining > 0:
        # Prefer to consume the monthly allowance before the boost pack
        user.thumbnail_batches_used_this_period = used + 1
        db.commit()
        return SpendResponse(
            state="ok",
            used_this_period=user.thumbnail_batches_used_this_period,
            boost_credit=boost,
            remaining_total=(monthly - user.thumbnail_batches_used_this_period) + boost,
        )
    if boost > 0:
        user.thumbnail_batches_boost_credit = boost - 1
        db.commit()
        return SpendResponse(
            state="ok",
            used_this_period=used,
            boost_credit=user.thumbnail_batches_boost_credit,
            remaining_total=user.thumbnail_batches_boost_credit,
        )
    # Neither monthly nor boost left · 402 so the desktop opens the buy-boost modal
    raise HTTPException(
        status.HTTP_402_PAYMENT_REQUIRED,
        detail={
            "state": "over_cap",
            "message": (
                f"You've used all {monthly} thumbnail batches this month. "
                f"Grab a $9 boost pack for {BOOST_PACK_BATCH_COUNT} more."
            ),
            "boost_pack_url": "https://whop.com/checkout/plan_xLS3gGsJ16455",
        },
    )
