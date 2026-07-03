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


# ---------------------------------------------------------------------------
# 2026-07-03 · Step 3 batch 3e · /leaderboard/arcade
#
# Powers the desktop splash screen — replaces the MOCK_AGENCIES /
# MOCK_CLIPPERS / MOCK_COUNTERS arrays fabricated in
# `overlays/invaders/mockLeaderboard.ts`. The splash renders BEFORE the
# desktop has a license JWT so this route is INTENTIONALLY
# unauthenticated. It exposes only the display handle + arcade score —
# no email, no clerk id, no billing state.
#
# `arcade_high_score` column + descending index landed at
# `main.py:541-542`. New users default to 0; a row is only surfaced by
# the query when the score > 0 so a fresh install renders an honest
# empty state ("First to 1000 wins Founder tier") instead of a
# fabricated leaderboard.
#
# Agencies vs Clippers split: derived from `is_agency_tier(user.tier)`
# using the resolver in features.py. Same-tier tie is broken by
# arcade_high_score DESC then handle ASC (deterministic).
# ---------------------------------------------------------------------------

from fastapi import Query
from app.features import is_agency_tier


class ArcadeRow(BaseModel):
    """One public splash row — display-only fields."""

    handle: str
    score: int
    # 1-10 · client uses this to pick from /brand/splash/avatars/
    # avatar-XX-<name>.png so we don't have to fanout avatar strings
    # here. Deterministic from user id so the same person keeps their
    # avatar across reloads without a stored preference.
    avatar_index: int


class ArcadeCounters(BaseModel):
    total: int
    delta_today: int


class ArcadeLeaderboardResponse(BaseModel):
    clippers: list[ArcadeRow]
    agencies: list[ArcadeRow]
    counters: dict[str, ArcadeCounters]


def _avatar_index(user_id: str) -> int:
    """Stable 1-10 mapping from user id → avatar slot."""
    # Cheap deterministic hash — hex user_ids are common; fall back to
    # sum-of-codepoints for anything unusual. Modulo 10 gives 0-9;
    # +1 for the 1-10 numbering used by /brand/splash/avatars/.
    try:
        n = int(user_id[-4:], 16)
    except ValueError:
        n = sum(ord(c) for c in user_id)
    return (n % 10) + 1


def _fallback_handle(user: User) -> str:
    """Prefer the unified handle; fall back to email-derived shorthand
    so a user who hasn't set a public handle yet still shows up as
    something like ``daniel`` rather than the raw email address."""
    handle = getattr(user, "handle", None)
    if handle:
        return str(handle)
    email = getattr(user, "email", None)
    if email:
        return str(email).split("@", 1)[0]
    return "player"


@router.get("/arcade", response_model=ArcadeLeaderboardResponse)
def arcade_leaderboard(
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=25)] = 5,
) -> ArcadeLeaderboardResponse:
    """Public arcade leaderboard for the splash screen.

    No auth on purpose — splash renders pre-activation. The response
    exposes only display fields; internal ids and PII stay server-side.
    Returns empty arrays when nobody has scored yet — the honest empty
    state the splash then renders.
    """
    rows = (
        db.query(User)
        .filter(User.arcade_high_score > 0)
        .order_by(User.arcade_high_score.desc(), User.id.asc())
        .limit(limit * 4)  # slack so we can split by tier without a second query
        .all()
    )

    clippers: list[ArcadeRow] = []
    agencies: list[ArcadeRow] = []
    for u in rows:
        entry = ArcadeRow(
            handle=_fallback_handle(u),
            score=int(u.arcade_high_score or 0),
            avatar_index=_avatar_index(str(u.id)),
        )
        if is_agency_tier(getattr(u, "tier", None)):
            if len(agencies) < limit:
                agencies.append(entry)
        else:
            if len(clippers) < limit:
                clippers.append(entry)
        if len(clippers) >= limit and len(agencies) >= limit:
            break

    # Counters — total users with a score > 0, split by agency-vs-clipper.
    # ``delta_today`` is 0 for now (no ``arcade_high_score_at`` timestamp
    # column yet; adding one is a follow-up hardening pass to preserve the
    # UI "+X today" strip. Returning zero is the honest state until we
    # track the delta persistently — the client should render "+0 today"
    # or hide the delta when it's 0).
    all_rows = (
        db.query(User)
        .filter(User.arcade_high_score > 0)
        .all()
    )
    total_agencies = sum(1 for u in all_rows if is_agency_tier(getattr(u, "tier", None)))
    total_clippers = len(all_rows) - total_agencies

    return ArcadeLeaderboardResponse(
        clippers=clippers,
        agencies=agencies,
        counters={
            "clippers": ArcadeCounters(total=total_clippers, delta_today=0),
            "agencies": ArcadeCounters(total=total_agencies, delta_today=0),
        },
    )
