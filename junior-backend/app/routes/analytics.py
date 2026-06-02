"""Per-channel + cross-channel analytics (Schedule v2).

Reads ONLY from `post_analytics` (refreshed by cron every 30 min) — never
hits Ayrshare at request time. That makes the AnalyticsView fast,
rate-limit-safe, and renderable from a stale cache when Ayrshare is down.

Three endpoints:
  GET /analytics/overview?window=7d|30d|90d|all
  GET /analytics/channels/{id}?window=7d|30d|90d|all
  GET /analytics/posts/{schedule_id}            -- single post, server-cached
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, desc
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.models import PostAnalytic, Schedule, SocialChannel, User

log = logging.getLogger("junior.analytics")

router = APIRouter(prefix="/analytics", tags=["analytics"])

Window = Literal["7d", "30d", "90d", "all"]


def _window_cutoff(window: Window) -> datetime | None:
    if window == "7d":
        return datetime.now(timezone.utc) - timedelta(days=7)
    if window == "30d":
        return datetime.now(timezone.utc) - timedelta(days=30)
    if window == "90d":
        return datetime.now(timezone.utc) - timedelta(days=90)
    return None  # all-time


# ── Response shapes ────────────────────────────────────────────────────

class OverviewResponse(BaseModel):
    window: Window
    total_views: int
    total_engagement: int    # likes + comments + shares + saves
    total_posts: int
    best_channel: dict | None
    best_clip: dict | None


class ChannelAnalyticsRow(BaseModel):
    channel_id: str
    label: str
    platform: str
    handle: str | None
    posts: int
    views: int
    engagement: int
    engagement_rate: float | None


class ChannelDetailResponse(BaseModel):
    channel_id: str
    label: str
    platform: str
    handle: str | None
    window: Window
    total_posts: int
    total_views: int
    total_engagement: int
    top_clips: list[dict]   # [{schedule_id, clip_title, views, likes, scheduled_for, post_url}]


class PostAnalyticsResponse(BaseModel):
    schedule_id: str
    channel_id: str
    platform: str
    views: int
    likes: int
    comments: int
    shares: int
    saves: int
    engagement_rate: float | None
    refreshed_at: str
    post_url: str | None


# ── Routes ─────────────────────────────────────────────────────────────

@router.get("/overview", response_model=OverviewResponse)
def overview(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    window: Annotated[Window, Query()] = "30d",
) -> OverviewResponse:
    cutoff = _window_cutoff(window)
    q = (
        db.query(
            func.coalesce(func.sum(PostAnalytic.views), 0).label("v"),
            func.coalesce(func.sum(PostAnalytic.likes), 0).label("l"),
            func.coalesce(func.sum(PostAnalytic.comments), 0).label("c"),
            func.coalesce(func.sum(PostAnalytic.shares), 0).label("s"),
            func.coalesce(func.sum(PostAnalytic.saves), 0).label("sv"),
            func.count(PostAnalytic.schedule_id).label("posts"),
        )
        .join(SocialChannel, SocialChannel.id == PostAnalytic.channel_id)
        .filter(SocialChannel.user_id == user.id)
    )
    if cutoff is not None:
        q = q.filter(PostAnalytic.refreshed_at >= cutoff)
    row = q.one()
    total_views = int(row.v or 0)
    total_engagement = int((row.l or 0) + (row.c or 0) + (row.s or 0) + (row.sv or 0))
    total_posts = int(row.posts or 0)

    # Best channel by views in window
    best_channel = None
    chan_q = (
        db.query(
            SocialChannel.id,
            SocialChannel.label,
            SocialChannel.platform,
            func.coalesce(func.sum(PostAnalytic.views), 0).label("v"),
        )
        .join(PostAnalytic, PostAnalytic.channel_id == SocialChannel.id)
        .filter(SocialChannel.user_id == user.id)
    )
    if cutoff is not None:
        chan_q = chan_q.filter(PostAnalytic.refreshed_at >= cutoff)
    chan_q = chan_q.group_by(SocialChannel.id).order_by(desc("v")).limit(1)
    top = chan_q.first()
    if top:
        best_channel = {"id": top[0], "label": top[1], "platform": top[2], "views": int(top[3] or 0)}

    # Best clip by views in window
    best_clip = None
    clip_q = (
        db.query(
            PostAnalytic.schedule_id,
            Schedule.clip_title,
            PostAnalytic.views,
            PostAnalytic.platform,
            Schedule.actual_post_url,
        )
        .join(Schedule, Schedule.id == PostAnalytic.schedule_id)
        .join(SocialChannel, SocialChannel.id == PostAnalytic.channel_id)
        .filter(SocialChannel.user_id == user.id)
    )
    if cutoff is not None:
        clip_q = clip_q.filter(PostAnalytic.refreshed_at >= cutoff)
    clip_q = clip_q.order_by(desc(PostAnalytic.views)).limit(1)
    top_clip = clip_q.first()
    if top_clip:
        best_clip = {
            "schedule_id": top_clip[0],
            "title": top_clip[1],
            "views": int(top_clip[2] or 0),
            "platform": top_clip[3],
            "post_url": top_clip[4],
        }

    return OverviewResponse(
        window=window,
        total_views=total_views,
        total_engagement=total_engagement,
        total_posts=total_posts,
        best_channel=best_channel,
        best_clip=best_clip,
    )


@router.get("/channels", response_model=list[ChannelAnalyticsRow])
def list_channel_analytics(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    window: Annotated[Window, Query()] = "30d",
) -> list[ChannelAnalyticsRow]:
    """Per-channel rollup — feeds the Channels table on the Analytics tab."""
    cutoff = _window_cutoff(window)
    q = (
        db.query(
            SocialChannel.id,
            SocialChannel.label,
            SocialChannel.platform,
            SocialChannel.handle,
            func.count(PostAnalytic.schedule_id).label("posts"),
            func.coalesce(func.sum(PostAnalytic.views), 0).label("views"),
            func.coalesce(func.sum(PostAnalytic.likes), 0).label("likes"),
            func.coalesce(func.sum(PostAnalytic.comments), 0).label("comments"),
            func.coalesce(func.sum(PostAnalytic.shares), 0).label("shares"),
            func.coalesce(func.sum(PostAnalytic.saves), 0).label("saves"),
        )
        .outerjoin(PostAnalytic, PostAnalytic.channel_id == SocialChannel.id)
        .filter(SocialChannel.user_id == user.id)
        .filter(SocialChannel.status != "deleted")
    )
    if cutoff is not None:
        # outer join means rows without analytics still appear — fine.
        q = q.filter((PostAnalytic.refreshed_at >= cutoff) | (PostAnalytic.refreshed_at.is_(None)))
    q = q.group_by(SocialChannel.id).order_by(desc("views"))

    out: list[ChannelAnalyticsRow] = []
    for row in q.all():
        views = int(row.views or 0)
        engagement = int((row.likes or 0) + (row.comments or 0) + (row.shares or 0) + (row.saves or 0))
        rate = round((engagement / views * 100), 2) if views else None
        out.append(ChannelAnalyticsRow(
            channel_id=row.id,
            label=row.label,
            platform=row.platform,
            handle=row.handle,
            posts=int(row.posts or 0),
            views=views,
            engagement=engagement,
            engagement_rate=rate,
        ))
    return out


@router.get("/channels/{channel_id}", response_model=ChannelDetailResponse)
def channel_detail(
    channel_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    window: Annotated[Window, Query()] = "30d",
) -> ChannelDetailResponse:
    channel = db.get(SocialChannel, channel_id)
    if not channel or channel.user_id != user.id or channel.status == "deleted":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "channel not found")
    cutoff = _window_cutoff(window)

    base = db.query(PostAnalytic).filter(PostAnalytic.channel_id == channel_id)
    if cutoff is not None:
        base = base.filter(PostAnalytic.refreshed_at >= cutoff)

    total_views = int(db.query(func.coalesce(func.sum(PostAnalytic.views), 0)).filter(PostAnalytic.channel_id == channel_id).scalar() or 0)
    total_engagement = int(
        db.query(
            func.coalesce(func.sum(PostAnalytic.likes), 0) +
            func.coalesce(func.sum(PostAnalytic.comments), 0) +
            func.coalesce(func.sum(PostAnalytic.shares), 0) +
            func.coalesce(func.sum(PostAnalytic.saves), 0),
        ).filter(PostAnalytic.channel_id == channel_id).scalar() or 0
    )
    total_posts = int(base.count())

    top_q = (
        db.query(
            PostAnalytic.schedule_id,
            Schedule.clip_title,
            Schedule.scheduled_for,
            Schedule.actual_post_url,
            PostAnalytic.views,
            PostAnalytic.likes,
        )
        .join(Schedule, Schedule.id == PostAnalytic.schedule_id)
        .filter(PostAnalytic.channel_id == channel_id)
    )
    if cutoff is not None:
        top_q = top_q.filter(PostAnalytic.refreshed_at >= cutoff)
    top_q = top_q.order_by(desc(PostAnalytic.views)).limit(20)
    top_clips = [
        {
            "schedule_id": r[0],
            "clip_title": r[1],
            "scheduled_for": r[2].isoformat() if r[2] else None,
            "post_url": r[3],
            "views": int(r[4] or 0),
            "likes": int(r[5] or 0),
        }
        for r in top_q.all()
    ]

    return ChannelDetailResponse(
        channel_id=channel.id,
        label=channel.label,
        platform=channel.platform,
        handle=channel.handle,
        window=window,
        total_posts=total_posts,
        total_views=total_views,
        total_engagement=total_engagement,
        top_clips=top_clips,
    )


@router.get("/posts/{schedule_id}", response_model=PostAnalyticsResponse)
def post_analytics(
    schedule_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PostAnalyticsResponse:
    schedule = db.get(Schedule, schedule_id)
    if not schedule or schedule.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "schedule not found")
    row = db.get(PostAnalytic, schedule_id)
    if not row:
        # No analytics cached yet — return zeroed row instead of 404 so the UI
        # renders an "analytics not ready yet" state cleanly.
        return PostAnalyticsResponse(
            schedule_id=schedule_id,
            channel_id=schedule.channel_id or "",
            platform=schedule.platform or "",
            views=0, likes=0, comments=0, shares=0, saves=0,
            engagement_rate=None,
            refreshed_at=datetime.now(timezone.utc).isoformat(),
            post_url=schedule.actual_post_url,
        )
    return PostAnalyticsResponse(
        schedule_id=row.schedule_id,
        channel_id=row.channel_id,
        platform=row.platform,
        views=int(row.views or 0),
        likes=int(row.likes or 0),
        comments=int(row.comments or 0),
        shares=int(row.shares or 0),
        saves=int(row.saves or 0),
        engagement_rate=float(row.engagement_rate) if row.engagement_rate is not None else None,
        refreshed_at=row.refreshed_at.isoformat() if row.refreshed_at else "",
        post_url=schedule.actual_post_url,
    )
