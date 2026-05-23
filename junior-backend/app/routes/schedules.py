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
    error: str | None
    created_at: datetime

    class Config:
        from_attributes = True


class DripBatchCreate(BaseModel):
    project_slug: str
    items: list[ScheduleCreate]


@router.post("", response_model=ScheduleResponse, status_code=status.HTTP_201_CREATED)
def create_schedule(
    body: ScheduleCreate,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ScheduleResponse:
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
    return ScheduleResponse.model_validate(row)


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
    return [ScheduleResponse.model_validate(r) for r in out]


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
    return [ScheduleResponse.model_validate(r) for r in q.limit(limit).all()]


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
    row.status = "canceled"
    db.commit()
