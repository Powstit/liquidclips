"""Banners + Announcements public reads — v0.7.55.

Admin CRUD lives in app/routes/admin.py to share require_admin auth.
Public endpoints filter on is_active + the optional date window.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.features import _resolve_tier
from app.models import Announcement, Banner, User

router = APIRouter()

_PREMIUM_TIERS = {"solo", "pro", "agency"}


def _is_premium_target(target_tier: str | None, viewer_tier: str | None) -> bool:
    """`target_tier` semantics:
      None      → open to every tier (always renders).
      "free"    → only free viewers.
      "paid"    → only premium viewers (solo|pro|agency).
    """
    if target_tier is None:
        return True
    resolved = _resolve_tier(viewer_tier or "free")
    if target_tier == "paid":
        return resolved in _PREMIUM_TIERS
    if target_tier == "free":
        return resolved not in _PREMIUM_TIERS
    return True


def serialize_banner(b: Banner) -> dict[str, Any]:
    return {
        "id": b.id,
        "title": b.title,
        "subtitle": b.subtitle,
        "image_url": b.image_url,
        "cta_text": b.cta_text,
        "cta_url": b.cta_url,
        "placement": b.placement,
        "target_tier": b.target_tier,
        "target_mission_id": b.target_mission_id,
        "priority": b.priority,
        "starts_at": b.starts_at.isoformat() if b.starts_at else None,
        "ends_at": b.ends_at.isoformat() if b.ends_at else None,
        "is_active": bool(b.is_active),
    }


def serialize_announcement(a: Announcement) -> dict[str, Any]:
    return {
        "id": a.id,
        "title": a.title,
        "body_markdown": a.body_markdown,
        "kind": a.kind,
        "cta_text": a.cta_text,
        "cta_url": a.cta_url,
        "target_tier": a.target_tier,
        "pinned": bool(a.pinned),
        "published_at": a.published_at.isoformat() if a.published_at else None,
        "is_active": bool(a.is_active),
    }


@router.get("/banners")
def list_banners(
    db: Annotated[Session, Depends(get_db)],
    placement: str | None = Query(default=None, description="Filter to a single surface (e.g. earn_hero)."),
    clerk_user_id: str | None = Query(default=None),
) -> dict[str, Any]:
    viewer_tier: str | None = None
    if clerk_user_id:
        user = db.query(User).filter(User.clerk_id == clerk_user_id).one_or_none()
        if user:
            viewer_tier = user.tier or "free"
    now = datetime.now(timezone.utc)
    q = (
        db.query(Banner)
        .filter(Banner.is_active.is_(True))
        .order_by(Banner.priority.desc(), Banner.created_at.desc())
    )
    if placement:
        q = q.filter(Banner.placement == placement)
    rows = q.all()
    out: list[dict[str, Any]] = []
    for b in rows:
        if b.starts_at and b.starts_at > now:
            continue
        if b.ends_at and b.ends_at < now:
            continue
        if not _is_premium_target(b.target_tier, viewer_tier):
            continue
        out.append(serialize_banner(b))
    return {"banners": out, "viewer_tier": viewer_tier}


@router.get("/announcements")
def list_announcements(
    db: Annotated[Session, Depends(get_db)],
    clerk_user_id: str | None = Query(default=None),
    kind: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    viewer_tier: str | None = None
    if clerk_user_id:
        user = db.query(User).filter(User.clerk_id == clerk_user_id).one_or_none()
        if user:
            viewer_tier = user.tier or "free"
    now = datetime.now(timezone.utc)
    q = (
        db.query(Announcement)
        .filter(Announcement.is_active.is_(True))
        .order_by(Announcement.pinned.desc(), Announcement.published_at.desc().nulls_last(), Announcement.created_at.desc())
    )
    if kind:
        q = q.filter(Announcement.kind == kind)
    rows = q.limit(limit).all()
    out: list[dict[str, Any]] = []
    for a in rows:
        if a.published_at and a.published_at > now:
            continue
        if not _is_premium_target(a.target_tier, viewer_tier):
            continue
        out.append(serialize_announcement(a))
    return {"announcements": out, "viewer_tier": viewer_tier}
