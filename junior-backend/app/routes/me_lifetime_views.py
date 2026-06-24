"""GET /me/lifetime-views — aggregate platform-view metric for the carrot.

The $50 Sponsored Reward needs to know a clipper's TOTAL authenticated tracked
views across all their posts. PostAnalytic rows (refreshed every 30 min by
the existing post_analytics_refresh cron in app/cron.py) carry per-post
views/likes/comments. This endpoint sums those per user via
Schedule → SocialChannel → user_id join.

Decoupled from payouts deliberately: view attribution is a separate concern
from claim/clearance. The Earn dashboard reads this number whether or not the
clipper has activated their Whop sub-merchant for payouts.

Returns:
    lifetime_views    int   sum of PostAnalytic.views across all the user's
                            published schedules. 0 if no published posts.
    lifetime_likes    int   sum of PostAnalytic.likes (engagement signal)
    lifetime_comments int   sum of PostAnalytic.comments
    post_count        int   how many posts contribute to the totals
    last_refreshed_at str?  ISO timestamp of newest PostAnalytic row · null when none
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.models import PostAnalytic, Schedule, SocialChannel, User

router = APIRouter(prefix="/me", tags=["me"])


class LifetimeViewsResponse(BaseModel):
    lifetime_views: int
    lifetime_likes: int
    lifetime_comments: int
    post_count: int
    last_refreshed_at: str | None


@router.get("/lifetime-views", response_model=LifetimeViewsResponse)
def get_lifetime_views(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> LifetimeViewsResponse:
    # 2026-06-24 · single aggregate query joining PostAnalytic → Schedule →
    # SocialChannel → user. Sums views/likes/comments + counts contributing
    # posts. Idempotent · cheap (single GROUP BY scoped to the user).
    row = db.execute(
        select(
            func.coalesce(func.sum(PostAnalytic.views), 0).label("views"),
            func.coalesce(func.sum(PostAnalytic.likes), 0).label("likes"),
            func.coalesce(func.sum(PostAnalytic.comments), 0).label("comments"),
            func.count(PostAnalytic.schedule_id).label("posts"),
            func.max(PostAnalytic.refreshed_at).label("refreshed_at"),
        )
        .select_from(PostAnalytic)
        .join(Schedule, Schedule.id == PostAnalytic.schedule_id)
        .join(SocialChannel, SocialChannel.id == Schedule.channel_id)
        .where(SocialChannel.user_id == user.id)
    ).one()

    refreshed_at = row.refreshed_at.isoformat() if row.refreshed_at else None

    return LifetimeViewsResponse(
        lifetime_views=int(row.views or 0),
        lifetime_likes=int(row.likes or 0),
        lifetime_comments=int(row.comments or 0),
        post_count=int(row.posts or 0),
        last_refreshed_at=refreshed_at,
    )
