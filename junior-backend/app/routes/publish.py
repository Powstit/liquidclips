"""Publish-now endpoint — Sprint 6.

Desktop POSTs a single clip + platform set. Backend uploads to Postiz,
tells Postiz to publish immediately, returns the post_url.

The actual file content is small (vertical 1080×1920 ~5-30 MB per clip).
We accept it as multipart upload from the desktop; backend stores nothing
beyond the route's lifetime.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import postiz
from app.db import get_db
from app.deps import current_user
from app.models import User
from app.routes.notifications import write_notification

router = APIRouter(prefix="/publish-now", tags=["publish"])

Platform = Literal["youtube", "tiktok", "x"]


class PublishResponse(BaseModel):
    platform: str
    post_url: str
    posted_at: str
    postiz_post_id: str


def _require_paid_tier(user: User) -> None:
    """Two gates: entitlement (does the tier have publishing at all) AND
    built-ness (has Postiz actually shipped). The second returns 503 with a
    'Coming Sprint 5' body so paying customers know what's pending."""
    from app.features import has_feature, is_feature_built, feature_sprint
    if not has_feature(user.tier, "platform_connections_max", founder=user.founder_flag):
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            "Publishing requires Solo, Growth, Autopilot, or Founder tier.",
        )
    if not is_feature_built(user.tier, "platform_connections_max"):
        sprint = feature_sprint(user.tier, "platform_connections_max") or "soon"
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"Publishing arrives in Sprint {sprint}. Your subscription entitles you to it; "
            "we'll email when it's live.",
        )


@router.post("", response_model=list[PublishResponse])
async def publish_now(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
    title: str = Form(...),
    description: str = Form(""),
    platforms: str = Form(..., description="Comma-separated subset of youtube,tiktok,x"),
) -> list[PublishResponse]:
    """Upload a single clip + publish to one or more platforms immediately."""
    _require_paid_tier(user)

    platform_list = [p.strip() for p in platforms.split(",") if p.strip() in ("youtube", "tiktok", "x")]
    if not platform_list:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no valid platforms in `platforms`")

    # Persist the upload to a temp location so postiz.upload_clip can stream it.
    import tempfile, os
    suffix = os.path.splitext(file.filename or "clip.mp4")[1] or ".mp4"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        contents = await file.read()
        tmp.write(contents)
        tmp_path = tmp.name

    out: list[PublishResponse] = []
    try:
        for platform in platform_list:
            postiz_id = await postiz.upload_clip(
                user_id=user.id,
                clip_path=tmp_path,
                title=title,
                description=description,
                platform=platform,
            )
            published = await postiz.publish_now(
                user_id=user.id,
                postiz_post_id=postiz_id,
                platform=platform,
            )
            out.append(PublishResponse(
                platform=platform,
                post_url=published["post_url"],
                posted_at=published["posted_at"],
                postiz_post_id=postiz_id,
            ))
            write_notification(
                db,
                user_id=user.id,
                category="post_published",
                title=f"Published to {platform}",
                body=f"\"{title}\" went live at {published['post_url']}",
                priority="medium",
                external_dedup_key=f"publish-now-{postiz_id}",
                action_kind="open_url",
                action_data={"url": published["post_url"]},
            )
        db.commit()
        return out
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
