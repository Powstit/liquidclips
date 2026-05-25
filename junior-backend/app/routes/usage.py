"""Usage quota — Free tier 3 videos/month enforcement.

Desktop calls /usage/video-started BEFORE running the pipeline. On 402, it
shows the upgrade prompt and refuses to start. On 200, the row is incremented
and the desktop is cleared to proceed.

Paid tiers (solo, channel, autopilot, founder) always 200 — no quota check.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.models import Usage, User

router = APIRouter(prefix="/usage", tags=["usage"])


class UsageStatus(BaseModel):
    tier: str
    period_start: date
    videos_processed: int
    cap: int | None  # null = unlimited
    remaining: int | None


def _current_period_start() -> date:
    now = datetime.now(timezone.utc).date()
    return date(now.year, now.month, 1)


def _quota_for_tier(tier: str) -> int | None:
    # Monthly video cap retired (2026-05-25). The free tier is now gated by the
    # 100 clip-export starter pass (starter_export_remaining), not a per-month
    # video count. video_started still tracks processed videos for analytics but
    # never blocks. See [[junior-whop-affiliate-checkout]] for the export model.
    return None


STARTER_EXPORT_CAP = 100


def starter_export_remaining(user: User) -> int | None:
    """Starter pass — free + Whop-TRIAL users get 100 successful clip EXPORTS
    (lifetime). None = unlimited. We key on subscription_status, not just tier:
    a trial buyer is tier=solo but status "trialing" → still capped (can't bypass
    the 100 free exports until the first payment promotes them to "active").

    Grace: a paid plan that's been canceled or is in dunning (past_due) keeps
    full access until the paid period actually ENDS (paid_until in the future) —
    Clerk/Whop cancel sets status away from "active" but access is promised
    through period end, so we must not re-cap them mid-period. Founders are
    always unlimited. Junior enforces this; Whop/Clerk only handle billing."""
    if user.founder_flag:
        return None
    if user.tier != "free":
        if user.subscription_status == "active":
            return None
        if user.subscription_status in ("canceled", "past_due"):
            pu = user.paid_until
            if pu is not None:
                now = datetime.now(timezone.utc)
                if pu.tzinfo is None:  # SQLite stores naive; match it
                    now = now.replace(tzinfo=None)
                if pu > now:
                    return None  # grace — still inside the paid period
        # trialing / expired / refunded / canceled-past-period → starter-limited
    return max(0, STARTER_EXPORT_CAP - (user.starter_exports_used or 0))


def _usage_row(db: Session, user_id: str) -> Usage:
    period = _current_period_start()
    row = db.query(Usage).filter_by(user_id=user_id, period_start=period).one_or_none()
    if row is None:
        row = Usage(user_id=user_id, period_start=period, videos_processed=0)
        db.add(row)
        db.flush()
    return row


@router.get("", response_model=UsageStatus)
def get_usage(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> UsageStatus:
    row = _usage_row(db, user.id)
    cap = _quota_for_tier(user.tier)
    remaining = max(0, cap - row.videos_processed) if cap is not None else None
    db.commit()
    return UsageStatus(
        tier=user.tier,
        period_start=row.period_start,
        videos_processed=row.videos_processed,
        cap=cap,
        remaining=remaining,
    )


@router.post("/video-started", response_model=UsageStatus)
def video_started(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> UsageStatus:
    cap = _quota_for_tier(user.tier)
    row = _usage_row(db, user.id)
    if cap is not None and row.videos_processed >= cap:
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            f"Free tier cap reached ({cap}/month). Upgrade to continue.",
        )
    row.videos_processed += 1
    db.commit()
    remaining = max(0, cap - row.videos_processed) if cap is not None else None
    return UsageStatus(
        tier=user.tier,
        period_start=row.period_start,
        videos_processed=row.videos_processed,
        cap=cap,
        remaining=remaining,
    )


class ExportStatus(BaseModel):
    tier: str
    exports_used: int
    cap: int | None
    remaining_exports: int | None


@router.post("/clip-exported", response_model=ExportStatus)
def clip_exported(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ExportStatus:
    """Called by the desktop AFTER a successful clip export (never on previews,
    drafts, or failed exports). Increments the starter counter for free/starter
    users and returns remaining free exports. 402 once 100 are used → desktop shows
    the 'continue on Solo' prompt. Paid tiers/founders never count and never block."""
    remaining = starter_export_remaining(user)  # None = unlimited (paid/founder)
    if remaining is not None and remaining <= 0:
        # 402 — starter cap exhausted. Fire before raising so the event lands
        # even if the caller doesn't see the exception body.
        if user.clerk_id:
            from app import analytics
            analytics.capture(
                user_id=user.clerk_id,
                event="clip_export_blocked",
                properties={
                    "exports_used": user.starter_exports_used or 0,
                    "reason": "starter_cap",
                },
            )
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            "You've used your 100 free clips. Continue on Solo ($29.99/mo) to keep exporting.",
        )
    if remaining is not None:
        user.starter_exports_used = (user.starter_exports_used or 0) + 1
        db.commit()
        remaining = starter_export_remaining(user)
        if user.clerk_id:
            from app import analytics
            # Record the successful export increment.
            analytics.capture(
                user_id=user.clerk_id,
                event="clip_export_recorded",
                properties={
                    "exports_used": user.starter_exports_used or 0,
                    "remaining_exports": remaining if remaining is not None else 0,
                    "subscription_status": user.subscription_status,
                },
            )
        # Funnel signal: the 100th free export just landed → next export hits the
        # paywall. This is the "continue on Solo" moment for the desktop.
        if remaining == 0 and user.clerk_id:
            from app import analytics
            analytics.capture(
                user_id=user.clerk_id,
                event="starter_pass_exhausted",
                properties={"exports_used": STARTER_EXPORT_CAP, "tier": user.tier, "subscription_status": user.subscription_status},
            )
    capped = remaining is not None
    return ExportStatus(
        tier=user.tier,
        exports_used=user.starter_exports_used or 0,
        cap=STARTER_EXPORT_CAP if capped else None,
        remaining_exports=remaining,
    )
