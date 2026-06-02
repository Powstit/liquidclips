"""Publish-now endpoint — P1 (Ayrshare).

Desktop POSTs a single clip + caption + platform set. We upload the file
to Ayrshare's CDN, then make ONE multi-platform `post()` call. Ayrshare
fans out to TikTok / YouTube / Instagram / X / LinkedIn server-side; we
get back one response with per-platform IDs and URLs.

Previously this called the in-progress Postiz self-host once per platform.
Postiz is now legacy (see app/postiz.py docstring).
"""

from __future__ import annotations

import logging
import os
import tempfile
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import ayrshare
from app.db import get_db
from app.deps import current_user
from app.models import SocialConnection, User
from app.routes.notifications import write_notification

log = logging.getLogger("junior.publish")

router = APIRouter(prefix="/publish-now", tags=["publish"])

# Ayrshare's supported set we surface to the desktop. Keep in sync with
# PublishModal in src/components/PublishModal.tsx.
SUPPORTED_PLATFORMS = {"youtube", "tiktok", "x", "instagram", "linkedin", "facebook"}


class PerPlatformResult(BaseModel):
    platform: str
    post_url: str | None
    post_id: str | None
    status: str  # "published" | "failed"
    error: str | None = None


class PublishResponse(BaseModel):
    results: list[PerPlatformResult]


def _require_paid_tier(user: User) -> None:
    from app.features import has_feature, is_feature_built, feature_sprint
    if not has_feature(user.tier, "publish_now", founder=user.founder_flag):
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            "Publishing requires Solo, Pro, Agency, or Founder tier.",
        )
    if not is_feature_built(user.tier, "publish_now"):
        sprint = feature_sprint(user.tier, "publish_now") or "soon"
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"Publishing arrives in Sprint {sprint}. Your subscription entitles you to it; "
            "we'll email when it's live.",
        )


def _resolve_profile_key(db: Session, user: User) -> str:
    row = db.get(SocialConnection, user.id)
    if not row or not row.active or not row.ayrshare_profile_key:
        raise HTTPException(
            status.HTTP_412_PRECONDITION_FAILED,
            "Connect a social profile in Settings before publishing.",
        )
    return row.ayrshare_profile_key


@router.post("", response_model=PublishResponse)
async def publish_now(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
    title: str = Form(...),
    description: str = Form(""),
    platforms: str = Form(default="", description="Legacy: comma-separated subset of youtube,tiktok,x,instagram,linkedin,facebook. Used when channel_id is not provided. New code should send channel_id instead."),
    channel_id: str | None = Form(default=None, description="Schedule v2: the social_channels.id to publish to. When set, platforms is inferred from the channel and profile_key is the channel's own Ayrshare profile (not the legacy SocialConnection.ayrshare_profile_key)."),
    scheduled_at: str | None = Form(default=None, description="Optional ISO-8601 future timestamp. When set, Ayrshare queues the post and publishes at that time instead of immediately."),
) -> PublishResponse:
    """Upload a clip + publish to one or more platforms.

    Two routing paths:

    * Channel mode (preferred): pass `channel_id`. Posts go to that one
      channel's Ayrshare profile + that channel's platform. Each channel =
      one platform handle, so a single call = a single post on one handle.
      To post to multiple handles, the desktop loops over channels.

    * Legacy mode (back-compat): pass `platforms` (comma-separated). Uses
      the user's single SocialConnection.ayrshare_profile_key. Will be
      removed once everyone has migrated to channels.

    When `scheduled_at` is None → posts immediately.
    When `scheduled_at` is an ISO-8601 future timestamp → Ayrshare queues
    and fires at that time. The Ayrshare post id is persisted to schedules
    for cancel.
    """
    _require_paid_tier(user)

    # Resolve which Ayrshare profile + which platform list to post against.
    channel = None
    if channel_id:
        from app.models import SocialChannel
        channel = db.get(SocialChannel, channel_id)
        if not channel or channel.user_id != user.id or channel.status == "deleted":
            raise HTTPException(status.HTTP_404_NOT_FOUND, "channel not found")
        if channel.status == "paused":
            raise HTTPException(status.HTTP_409_CONFLICT, "channel is paused — unpause it before publishing.")
        profile_key = channel.ayrshare_profile_key
        platform_list = [channel.platform]
    else:
        profile_key = _resolve_profile_key(db, user)
        platform_list = [
            p.strip().lower() for p in platforms.split(",")
            if p.strip().lower() in SUPPORTED_PLATFORMS
        ]
        if not platform_list:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "no valid platforms in `platforms` (or pass channel_id)")

    suffix = os.path.splitext(file.filename or "clip.mp4")[1] or ".mp4"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        contents = await file.read()
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        media_url = ayrshare.media_upload(tmp_path, profile_key=profile_key)
        caption = f"{title}\n\n{description}".strip() if description else title
        try:
            resp = ayrshare.post(
                text=caption,
                platforms=platform_list,
                media_urls=[media_url],
                profile_key=profile_key,
                scheduled_at=scheduled_at,
            )
        except httpx.HTTPStatusError as exc:
            log.warning("[publish] ayrshare.post HTTPStatusError: %s | body=%s", exc, getattr(exc.response, "text", ""))
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                f"Ayrshare rejected the post: {exc}",
            ) from exc

        results: list[PerPlatformResult] = []
        per_platform = resp.get("postIds") or []
        ok_map = {entry.get("platform"): entry for entry in per_platform if isinstance(entry, dict)}
        for platform in platform_list:
            entry = ok_map.get(platform)
            if entry and (entry.get("postUrl") or entry.get("id")):
                results.append(PerPlatformResult(
                    platform=platform,
                    post_url=entry.get("postUrl"),
                    post_id=entry.get("id"),
                    status="published",
                ))
                write_notification(
                    db,
                    user_id=user.id,
                    category="post_published",
                    title=f"Published to {platform}",
                    body=f"\"{title}\" went live" + (f" at {entry['postUrl']}" if entry.get("postUrl") else ""),
                    priority="medium",
                    external_dedup_key=f"publish-now-{entry.get('id') or platform}",
                    action_kind="open_url" if entry.get("postUrl") else "open_app",
                    action_data={"url": entry.get("postUrl")} if entry.get("postUrl") else {},
                )
            else:
                err = (entry or {}).get("status") or "publish failed"
                results.append(PerPlatformResult(
                    platform=platform,
                    post_url=None,
                    post_id=None,
                    status="failed",
                    error=str(err),
                ))

        # Schedule v2: when channel + scheduled_at are set AND Ayrshare
        # accepted the post, persist a schedules row so the desktop's queue
        # surface can find it for cancel/edit. Also bumps total_posts on the
        # channel for the at-a-glance counter.
        if channel and scheduled_at:
            from app.models import Schedule
            scheduled_dt = None
            try:
                from datetime import datetime as _dt
                scheduled_dt = _dt.fromisoformat(scheduled_at.replace("Z", "+00:00"))
            except Exception:  # noqa: BLE001
                pass
            for r in results:
                if r.status != "published":
                    continue
                row = Schedule(
                    user_id=user.id,
                    project_slug=getattr(file, "filename", "uploaded"),
                    clip_idx=0,
                    clip_title=title,
                    vertical_path=tmp_path,
                    platform=r.platform,
                    scheduled_for=scheduled_dt,
                    status="scheduled",
                    channel_id=channel.id,
                    caption_override=description or None,
                    ayrshare_scheduled_post_id=r.post_id,
                    actual_post_url=r.post_url,
                )
                db.add(row)
            channel.total_posts = (channel.total_posts or 0) + sum(1 for r in results if r.status == "published")
        elif channel:
            # Immediate publish (no scheduled_at) — still bump the counter.
            channel.total_posts = (channel.total_posts or 0) + sum(1 for r in results if r.status == "published")

        db.commit()
        return PublishResponse(results=results)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
