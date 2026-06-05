"""Schedules CRUD + drip-batch endpoint.

Spec §1.4 — explicit mechanics for the schedule-and-publish flow:

  At schedule time:
    1. Desktop uploads the clip to Postiz Engine NOW (real wiring in Sprint 5).
    2. Backend inserts a row in `schedules` with status='pending'.

  At fire time (cron tick every 60s):
    1. Cron picks up rows where scheduled_for <= NOW() AND status='pending'.
    2. For each: status='uploading' → call Postiz → status='scheduled'.
    3. Postiz webhook back: status='published' (with post_url) or 'failed'.

  Desktop /sync polls /schedules and surfaces "3 posts published while you were away."

In this Sprint 7 cut the Postiz call is stubbed — it just marks the row
as 'scheduled' immediately. Sprint 5 wires the real Postiz internal API.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.models import Schedule, User

router = APIRouter(prefix="/schedules", tags=["schedules"])

Platform = Literal["youtube", "tiktok", "x"]


def _require_scheduling_built(user: User) -> None:
    """Scheduling + drip fire through the Postiz engine, which isn't live in prod
    yet (beta). 503 instead of inserting rows the cron can't actually publish.
    Auto-clears once POSTIZ_CLIENT_ID/SECRET are configured (see features.py)."""
    from app.features import is_feature_built
    if not is_feature_built(user.tier, "schedule_one"):
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Scheduling & drip are in beta — coming soon. Export your clips and post them for now.",
        )


class ScheduleCreate(BaseModel):
    project_slug: str
    clip_idx: int
    clip_title: str
    vertical_path: str
    platform: Platform
    scheduled_for: datetime


class ScheduleResponse(BaseModel):
    id: str
    project_slug: str
    clip_idx: int
    clip_title: str
    platform: str
    scheduled_for: datetime
    status: str
    post_url: str | None
    # Schedule v2 — the live URL of the published post. Set by the Ayrshare
    # webhook handler when a scheduled post fires. Aliased into the response
    # so the desktop has one canonical field to read (`live_url`) regardless
    # of whether the row was published via the legacy cron path
    # (`post_url`) or Ayrshare's native scheduler (`actual_post_url`).
    live_url: str | None = None
    error: str | None
    created_at: datetime

    class Config:
        from_attributes = True

    @classmethod
    def from_row(cls, row: "Schedule") -> "ScheduleResponse":
        return cls(
            id=row.id,
            project_slug=row.project_slug,
            clip_idx=row.clip_idx,
            clip_title=row.clip_title,
            platform=row.platform or "",
            scheduled_for=row.scheduled_for,
            status=row.status,
            post_url=row.post_url,
            live_url=row.actual_post_url or row.post_url,
            error=row.error,
            created_at=row.created_at,
        )


class DripBatchCreate(BaseModel):
    project_slug: str
    items: list[ScheduleCreate]


@router.post("", response_model=ScheduleResponse, status_code=status.HTTP_201_CREATED)
def create_schedule(
    body: ScheduleCreate,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ScheduleResponse:
    _require_scheduling_built(user)
    if body.scheduled_for.tzinfo is None:
        body.scheduled_for = body.scheduled_for.replace(tzinfo=timezone.utc)
    row = Schedule(
        user_id=user.id,
        project_slug=body.project_slug,
        clip_idx=body.clip_idx,
        clip_title=body.clip_title,
        vertical_path=body.vertical_path,
        platform=body.platform,
        scheduled_for=body.scheduled_for,
        status="pending",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return ScheduleResponse.from_row(row)


@router.post("/drip-batch", response_model=list[ScheduleResponse], status_code=status.HTTP_201_CREATED)
def create_drip_batch(
    body: DripBatchCreate,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ScheduleResponse]:
    """Batch-insert a drip across multiple clips + dates in a single transaction.

    The desktop calls this once with the whole drip plan instead of N POSTs —
    keeps the UI feedback tight ("15 clips scheduled across 14 days").
    """
    _require_scheduling_built(user)
    out: list[ScheduleResponse] = []
    for item in body.items:
        scheduled_for = item.scheduled_for
        if scheduled_for.tzinfo is None:
            scheduled_for = scheduled_for.replace(tzinfo=timezone.utc)
        row = Schedule(
            user_id=user.id,
            project_slug=item.project_slug,
            clip_idx=item.clip_idx,
            clip_title=item.clip_title,
            vertical_path=item.vertical_path,
            platform=item.platform,
            scheduled_for=scheduled_for,
            status="pending",
        )
        db.add(row)
        out.append(row)  # populated after commit
    db.commit()
    return [ScheduleResponse.from_row(r) for r in out]


@router.get("", response_model=list[ScheduleResponse])
def list_schedules(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    project_slug: str | None = None,
    limit: int = 200,
) -> list[ScheduleResponse]:
    q = db.query(Schedule).filter(Schedule.user_id == user.id).order_by(Schedule.scheduled_for.asc())
    if project_slug:
        q = q.filter(Schedule.project_slug == project_slug)
    return [ScheduleResponse.from_row(r) for r in q.limit(limit).all()]


@router.post("/{schedule_id}/retry", response_model=ScheduleResponse)
def retry_schedule(
    schedule_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ScheduleResponse:
    """Re-queue a failed schedule.

    Resets status to `pending`, clears the error message, drops the retry
    counter so the cron's backoff window starts fresh. The next cron tick
    (60s) picks it up. Only `failed` rows are eligible — published / canceled /
    in-flight rows reject so the desktop never accidentally double-publishes.
    """
    row = db.get(Schedule, schedule_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "schedule not found")
    if row.status != "failed":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"only failed schedules can be retried — this one is {row.status}",
        )
    row.status = "pending"
    row.error = None
    row.retry_count = 0
    row.next_retry_at = None
    db.commit()
    db.refresh(row)
    return ScheduleResponse.from_row(row)


@router.delete("/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_schedule(
    schedule_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    row = db.get(Schedule, schedule_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "schedule not found")
    if row.status in ("published", "uploading"):
        raise HTTPException(status.HTTP_409_CONFLICT, f"cannot cancel a {row.status} schedule")

    # Schedule v2: if this row was queued via Ayrshare's native scheduler
    # (the channel_id + ayrshare_scheduled_post_id path), cancel it on
    # Ayrshare's side too. Best-effort — flip the local status either way.
    if row.channel_id and row.ayrshare_scheduled_post_id:
        from app import ayrshare
        from app.models import SocialChannel
        channel = db.get(SocialChannel, row.channel_id)
        if channel and channel.ayrshare_profile_key:
            try:
                ayrshare.cancel_scheduled(channel.ayrshare_profile_key, row.ayrshare_scheduled_post_id)
            except Exception as exc:  # noqa: BLE001
                # Log and continue — local cancel still wins. Ayrshare retries
                # the cancel out of band; worst case the post fires and the
                # user has a "published" notification mismatch.
                import logging as _l
                _l.getLogger("junior.schedules").warning(
                    "[schedules] ayrshare.cancel_scheduled failed for %s/%s: %s",
                    channel.ayrshare_profile_key, row.ayrshare_scheduled_post_id, exc,
                )

    row.status = "canceled"
    db.commit()
