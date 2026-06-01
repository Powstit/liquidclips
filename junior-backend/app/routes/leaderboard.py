"""GET /leaderboard/earnings — top 100 affiliates by lifetime earnings (cached).

Whop is the source-of-truth for affiliate earnings, but the per-user fetch path
in `affiliate.py` would rate-limit us instantly if we fanned out for a public
leaderboard. So `app/cron.py:_refresh_affiliate_cache_tick` runs every 6 hours
and snapshots each linked user's Whop affiliate stats into:

    users.cached_lifetime_earnings_usd  (numeric(10,2))
    users.cached_paid_referrals         (integer)
    users.cached_display_handle         (varchar; whop username || email-derived)
    users.cached_earnings_at            (timestamptz)

This route reads from that cache only — fast, predictable, no Whop dependency
at request time. Privacy: we render `cached_display_handle` (an opaque-ish
username), never the email, real name, or Whop user id.

Auth: license JWT (same as the rest of the desktop API). No internal-secret
gate — every signed-in desktop user gets to see the board.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.features import is_admin_email
from app.models import User

router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])


class LeaderboardEntry(BaseModel):
    rank: int
    display_handle: str
    lifetime_earnings_usd: str   # stringified decimal for display
    paid_referrals: int
    is_caller: bool              # True if this entry IS the calling user


class LeaderboardResponse(BaseModel):
    entries: list[LeaderboardEntry]
    caller_rank: int | None
    caller_entry: LeaderboardEntry | None  # set when caller is OUTSIDE the top 100
    refreshed_at: str | None
    total_ranked: int             # how many users have any earnings cached at all


def _format_money(v: Decimal | float | int | None) -> str:
    if v is None:
        return "0.00"
    return f"{Decimal(v):.2f}"


def _stale_label(refreshed_at: datetime | None) -> str | None:
    if refreshed_at is None:
        return None
    # Surface UTC ISO; the desktop renders relative time client-side
    return refreshed_at.astimezone(timezone.utc).isoformat()


@router.get("/earnings", response_model=LeaderboardResponse)
def earnings_leaderboard(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
) -> LeaderboardResponse:
    # Exclude admins + users without a cached display handle (= never linked
    # to Whop, so they don't belong on an "affiliate" board even with $0).
    # ORDER BY desc(earnings), tiebreaker on paid_referrals (more proof of
    # work), then created_at (oldest first wins a tied empty slot).
    admin_emails_lower = [e.strip().lower() for e in []]  # populated via is_admin_email below
    base_query = (
        db.query(User)
        .filter(User.cached_display_handle.isnot(None))
        .filter(User.cached_lifetime_earnings_usd > 0)
    )

    # Materialize as list because we need to filter admins out by helper
    # (the admin list lives in env, not a column). Cheap — bounded by N
    # users with any earnings, which is <few hundred for a long time.
    candidates: list[User] = [
        u for u in base_query.order_by(
            User.cached_lifetime_earnings_usd.desc(),
            User.cached_paid_referrals.desc(),
            User.created_at.asc(),
        ).all()
        if not is_admin_email(u.email)
    ]
    total_ranked = len(candidates)

    # Top-100 slice for the leaderboard view
    top: list[User] = candidates[:100]
    entries: list[LeaderboardEntry] = []
    caller_rank: int | None = None
    for idx, u in enumerate(top, start=1):
        is_me = u.id == user.id
        if is_me:
            caller_rank = idx
        entries.append(
            LeaderboardEntry(
                rank=idx,
                display_handle=u.cached_display_handle or "anonymous",
                lifetime_earnings_usd=_format_money(u.cached_lifetime_earnings_usd),
                paid_referrals=int(u.cached_paid_referrals or 0),
                is_caller=is_me,
            )
        )

    # If caller is outside the top 100 but still ranked, find their rank
    # for the floating "your rank" card.
    caller_entry: LeaderboardEntry | None = None
    if caller_rank is None:
        for idx, u in enumerate(candidates, start=1):
            if u.id == user.id:
                caller_rank = idx
                caller_entry = LeaderboardEntry(
                    rank=idx,
                    display_handle=u.cached_display_handle or "anonymous",
                    lifetime_earnings_usd=_format_money(u.cached_lifetime_earnings_usd),
                    paid_referrals=int(u.cached_paid_referrals or 0),
                    is_caller=True,
                )
                break

    # Freshness — the youngest cached_earnings_at across all ranked users is
    # the snapshot time. Avoids a separate "last cron run" persisted row.
    refreshed_at: datetime | None = (
        db.query(func.max(User.cached_earnings_at)).scalar()
        if total_ranked
        else None
    )

    return LeaderboardResponse(
        entries=entries,
        caller_rank=caller_rank,
        caller_entry=caller_entry,
        refreshed_at=_stale_label(refreshed_at),
        total_ranked=total_ranked,
    )
