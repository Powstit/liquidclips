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
    platforms: str = Form(..., description="Comma-separated subset of youtube,tiktok,x,instagram,linkedin,facebook"),
) -> PublishResponse:
    """Upload a clip + publish to one or more platforms immediately."""
    _require_paid_tier(user)
    profile_key = _resolve_profile_key(db, user)

    platform_list = [
        p.strip().lower() for p in platforms.split(",")
        if p.strip().lower() in SUPPORTED_PLATFORMS
    ]
    if not platform_list:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no valid platforms in `platforms`")

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
        db.commit()
        return PublishResponse(results=results)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
