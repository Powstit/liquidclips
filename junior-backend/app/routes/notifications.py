"""Notifications inbox — see ~/Desktop/jnr/notifications.md.

Voice rules (spec §3.10 + §3.9): past-tense for done, plain-verb for in-progress,
no exclamation marks, no emoji, specifics over vibes. junior_message category
uses first-person ("Finished the 90GB podcast"); every other category stays
neutral past-tense.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.models import Notification, User

router = APIRouter(prefix="/notifications", tags=["notifications"])

Category = Literal[
    "system_update", "post_published", "post_failed", "drip_summary",
    "quota_warning", "billing", "affiliate", "founder", "junior_message",
    "pipeline_event",
]


class NotificationDto(BaseModel):
    id: str
    category: str
    title: str
    body: str
    priority: str
    action_kind: str | None
    action_data: dict
    read_at: datetime | None
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("", response_model=list[NotificationDto])
def list_notifications(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    unread_only: bool = False,
    limit: int = 50,
) -> list[NotificationDto]:
    q = (
        db.query(Notification)
        .filter(Notification.user_id == user.id, Notification.dismissed_at.is_(None))
        .order_by(Notification.created_at.desc())
    )
    if unread_only:
        q = q.filter(Notification.read_at.is_(None))
    return [NotificationDto.model_validate(n) for n in q.limit(limit).all()]


class UnreadCount(BaseModel):
    unread: int


@router.get("/unread-count", response_model=UnreadCount)
def unread_count(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> UnreadCount:
    n = (
        db.query(Notification)
        .filter(
            Notification.user_id == user.id,
            Notification.dismissed_at.is_(None),
            Notification.read_at.is_(None),
        )
        .count()
    )
    return UnreadCount(unread=n)


@router.post("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(
    notification_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    row = db.get(Notification, notification_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "notification not found")
    if row.read_at is None:
        row.read_at = datetime.now(timezone.utc)
        db.commit()


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_read(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    now = datetime.now(timezone.utc)
    db.query(Notification).filter(
        Notification.user_id == user.id,
        Notification.read_at.is_(None),
        Notification.dismissed_at.is_(None),
    ).update({Notification.read_at: now})
    db.commit()


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
def dismiss(
    notification_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    row = db.get(Notification, notification_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "notification not found")
    if row.dismissed_at is None:
        row.dismissed_at = datetime.now(timezone.utc)
        db.commit()


# --- helpers used by webhook handlers + cron worker -------------------

def write_notification(
    db: Session,
    *,
    user_id: str,
    category: Category,
    title: str,
    body: str,
    priority: str = "medium",
    action_kind: str | None = None,
    action_data: dict | None = None,
    external_dedup_key: str | None = None,
) -> Notification | None:
    """Idempotent insert. Returns None if the dedup key already exists."""
    if external_dedup_key:
        existing = db.query(Notification).filter_by(external_dedup_key=external_dedup_key).one_or_none()
        if existing:
            return None
    row = Notification(
        user_id=user_id,
        category=category,
        title=title,
        body=body,
        priority=priority,
        action_kind=action_kind,
        action_data=action_data or {},
        external_dedup_key=external_dedup_key,
    )
    db.add(row)
    db.flush()
    return row
