"""AdminHQ gap-closing audit (2026-08-28) — Daniel: "admin is to see all
and be able to." Three real platform-wide gaps found with zero admin
visibility despite the underlying feature being live and storing real
state: scheduled posts, AI-thumbnail quota usage, and LC ID redemption.

Same pattern as admin_platform_visibility.py — read the existing table,
add a platform-wide (non-owner-scoped) admin view, no new architecture.
Schedules also gets an admin retry/cancel action mirroring the
customer-facing ones in schedules.py, since "be able to" means more
than read-only here.

Two other candidates from the same audit were deliberately left out:
  - troubleshoot.py is a disabled stub (ANTHROPIC_API_KEY unset in
    production, every call 503s) — there is no real data to surface.
  - whop_bounty_mirror.py is a one-way internal webhook sync into
    SponsoredCampaign, not a domain with its own list/state to browse.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Schedule, User
from app.routes import arcade_prize
from app.routes.admin import AdminUser

router = APIRouter(prefix="/admin", tags=["admin-ops-visibility"])


# ─── Schedules · platform-wide ─────────────────────────────────────────────


class ScheduleRow(BaseModel):
    id: str
    user_id: str
    user_email: str | None
    project_slug: str
    clip_title: str
    platform: str
    scheduled_for: str
    status: str
    post_url: str | None
    error: str | None
    retry_count: int


class SchedulesOut(BaseModel):
    schedules: list[ScheduleRow]
    total_returned: int


@router.get("/schedules", response_model=SchedulesOut)
def list_all_schedules(
    _admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    status_filter: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> SchedulesOut:
    q = db.query(Schedule)
    if status_filter:
        q = q.filter(Schedule.status == status_filter)
    rows = q.order_by(Schedule.scheduled_for.desc()).limit(limit).all()

    user_ids = {r.user_id for r in rows}
    emails_by_id: dict[str, str | None] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            emails_by_id[u.id] = u.email

    return SchedulesOut(
        schedules=[
            ScheduleRow(
                id=r.id,
                user_id=r.user_id,
                user_email=emails_by_id.get(r.user_id),
                project_slug=r.project_slug,
                clip_title=r.clip_title,
                platform=r.platform,
                scheduled_for=r.scheduled_for.isoformat() if r.scheduled_for else "",
                status=r.status,
                post_url=r.post_url,
                error=r.error,
                retry_count=r.retry_count,
            )
            for r in rows
        ],
        total_returned=len(rows),
    )


@router.post("/schedules/{schedule_id}/retry", response_model=ScheduleRow)
def admin_retry_schedule(
    schedule_id: str,
    _admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> ScheduleRow:
    """Admin override of the customer-facing retry — no ownership check,
    any schedule in any status can be nudged back to pending. Mirrors
    schedules.py's retry_schedule (cron picks it up on the next tick)."""
    row = db.query(Schedule).filter(Schedule.id == schedule_id).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "schedule not found")
    row.status = "pending"
    row.error = None
    row.next_retry_at = None
    db.commit()
    db.refresh(row)
    user = db.query(User).filter(User.id == row.user_id).one_or_none()
    return ScheduleRow(
        id=row.id, user_id=row.user_id, user_email=user.email if user else None,
        project_slug=row.project_slug, clip_title=row.clip_title, platform=row.platform,
        scheduled_for=row.scheduled_for.isoformat() if row.scheduled_for else "",
        status=row.status, post_url=row.post_url, error=row.error, retry_count=row.retry_count,
    )


@router.post("/schedules/{schedule_id}/cancel", response_model=ScheduleRow)
def admin_cancel_schedule(
    schedule_id: str,
    _admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> ScheduleRow:
    row = db.query(Schedule).filter(Schedule.id == schedule_id).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "schedule not found")
    row.status = "canceled"
    db.commit()
    db.refresh(row)
    user = db.query(User).filter(User.id == row.user_id).one_or_none()
    return ScheduleRow(
        id=row.id, user_id=row.user_id, user_email=user.email if user else None,
        project_slug=row.project_slug, clip_title=row.clip_title, platform=row.platform,
        scheduled_for=row.scheduled_for.isoformat() if row.scheduled_for else "",
        status=row.status, post_url=row.post_url, error=row.error, retry_count=row.retry_count,
    )


# ─── AI thumbnail quota · per user ──────────────────────────────────────────


class ThumbnailQuotaRow(BaseModel):
    user_id: str
    email: str | None
    tier: str
    founder_flag: bool
    used_this_period: int
    boost_credit: int
    period_start: str | None


class ThumbnailQuotaListOut(BaseModel):
    users: list[ThumbnailQuotaRow]
    total_returned: int


@router.get("/thumbnail-quota", response_model=ThumbnailQuotaListOut)
def list_thumbnail_quota_usage(
    _admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    only_used: bool = True,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> ThumbnailQuotaListOut:
    q = db.query(User)
    if only_used:
        q = q.filter(User.thumbnail_batches_used_this_period > 0)
    rows = q.order_by(User.thumbnail_batches_used_this_period.desc()).limit(limit).all()
    return ThumbnailQuotaListOut(
        users=[
            ThumbnailQuotaRow(
                user_id=u.id,
                email=u.email,
                tier=u.tier or "free",
                founder_flag=bool(u.founder_flag),
                used_this_period=u.thumbnail_batches_used_this_period or 0,
                boost_credit=u.thumbnail_batches_boost_credit or 0,
                period_start=u.thumbnail_batches_period_start.isoformat() if u.thumbnail_batches_period_start else None,
            )
            for u in rows
        ],
        total_returned=len(rows),
    )


# ─── LC IDs · minted / redeemed ─────────────────────────────────────────────


class LcIdRow(BaseModel):
    user_id: str
    email: str | None
    lc_id: str
    tier: str


class LcIdListOut(BaseModel):
    users: list[LcIdRow]
    total_returned: int


@router.get("/lc-ids", response_model=LcIdListOut)
def list_lc_ids(
    _admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> LcIdListOut:
    rows = (
        db.query(User)
        .filter(User.lc_id.is_not(None))
        .order_by(User.lc_id.asc())
        .limit(limit)
        .all()
    )
    return LcIdListOut(
        users=[
            LcIdRow(user_id=u.id, email=u.email, lc_id=u.lc_id or "", tier=u.tier or "free")
            for u in rows
        ],
        total_returned=len(rows),
    )


# ─── Arcade prize dispatch · admin-only, wired for real this time ──────────
#
# arcade_prize.py already has a correctly-built, admin-gated POST /dispatch
# — the exact "built but never reachable" bug the 2026-08-26 audit found in
# canary.py/beta_cohort.py. Root cause here is different: the account-app
# proxy always forwards to `{BACKEND_URL}/admin/{path}` (see
# `[...path]/route.ts`), but arcade_prize's router lives under
# `/arcade/prize`, not `/admin`, so no allowlist regex could ever reach it
# without either rewriting the shared proxy's URL construction (riskier,
# touches every other admin surface) or adding a thin `/admin`-prefixed
# wrapper here that calls the real handler directly — zero duplicated
# payment logic, this literally invokes the same function Whop-transfer
# code and all.


@router.get("/arcade-prize/current", response_model=arcade_prize.PrizeCurrentResponse)
def admin_arcade_prize_current(
    _admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> arcade_prize.PrizeCurrentResponse:
    return arcade_prize.prize_current(db=db)


@router.get("/arcade-prize/history", response_model=arcade_prize.PrizeHistoryResponse)
def admin_arcade_prize_history(
    _admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=24)] = 12,
) -> arcade_prize.PrizeHistoryResponse:
    return arcade_prize.prize_history(db=db, limit=limit)


@router.post("/arcade-prize/dispatch", response_model=arcade_prize.DispatchResponse)
def admin_arcade_prize_dispatch(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    month: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
) -> arcade_prize.DispatchResponse:
    return arcade_prize.prize_dispatch(admin=admin, db=db, month=month)
