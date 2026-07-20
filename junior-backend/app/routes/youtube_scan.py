"""YouTube channel scan · shallow analytics for any public channel.

Endpoint:
  GET /me/youtube-scan?handle=@mrbeast   (or ?channel_id=UCX6OQ3D... or ?url=...)
                        &max_videos=20

Returns:
  {
    channel: { id, title, custom_url, description, thumbnail,
               subscribers, total_views, video_count },
    videos: [
      { id, title, published_at, thumbnail, views, likes, comments, duration },
      ...
    ],
    fetched_at
  }

Data source: YouTube Data API v3 (Server-key auth, quota 10,000 units/day).
Cost per scan: ~3 requests × ~50 units each ≈ 150 units.

Key is server-side only via YOUTUBE_API_KEY on Railway. The desktop bundle
never sees it.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.deps import current_user
from app.models import User

log = logging.getLogger("junior.youtube_scan")

router = APIRouter(tags=["youtube"])

YT_API_BASE = "https://www.googleapis.com/youtube/v3"


class YtChannel(BaseModel):
    id: str
    title: str
    custom_url: str | None = None
    description: str
    thumbnail: str | None = None
    subscribers: int
    total_views: int
    video_count: int


class YtVideo(BaseModel):
    id: str
    title: str
    published_at: str
    thumbnail: str | None = None
    views: int
    likes: int
    comments: int
    duration: str  # ISO-8601 (PT#M#S)


class YtScanResponse(BaseModel):
    channel: YtChannel
    videos: list[YtVideo]
    fetched_at: str


def _extract_handle_or_id(input_str: str) -> tuple[str | None, str | None]:
    """Return (handle, channel_id) — one is set, the other is None."""
    s = input_str.strip()
    if not s:
        return None, None
    # Channel ID pattern (UC...)
    if re.match(r"^UC[A-Za-z0-9_-]{20,}$", s):
        return None, s
    # @handle
    if s.startswith("@"):
        return s, None
    # Extract from URL
    m = re.search(r"youtube\.com/@([A-Za-z0-9._-]+)", s)
    if m:
        return f"@{m.group(1)}", None
    m = re.search(r"youtube\.com/channel/(UC[A-Za-z0-9_-]{20,})", s)
    if m:
        return None, m.group(1)
    # Otherwise treat as bare handle without @
    if re.match(r"^[A-Za-z0-9._-]{3,}$", s):
        return f"@{s}", None
    return None, None


@router.get("/me/youtube-scan", response_model=YtScanResponse)
async def youtube_scan(
    _user: Annotated[User, Depends(current_user)],
    handle: str | None = Query(default=None, description="@handle style"),
    channel_id: str | None = Query(default=None, description="UC... channel id"),
    url: str | None = Query(default=None, description="Any youtube channel URL"),
    max_videos: int = Query(default=20, ge=1, le=50),
) -> YtScanResponse:
    key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if not key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "YOUTUBE_API_KEY not configured on backend",
        )

    input_str = handle or channel_id or url or ""
    resolved_handle, resolved_channel_id = _extract_handle_or_id(input_str)
    if not resolved_handle and not resolved_channel_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Provide `handle`, `channel_id`, or `url`",
        )

    async with httpx.AsyncClient(timeout=15.0) as client:
        # ── 1. Resolve channel ────────────────────────────────────────
        params: dict[str, str] = {
            "part": "snippet,statistics,contentDetails",
            "key": key,
        }
        if resolved_handle:
            params["forHandle"] = resolved_handle
        else:
            params["id"] = resolved_channel_id or ""

        r = await client.get(f"{YT_API_BASE}/channels", params=params)
        if r.status_code != 200:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                f"YouTube channels lookup failed: {r.status_code}",
            )
        data = r.json()
        items = data.get("items", [])
        if not items:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                f"No YouTube channel found for '{input_str}'",
            )

        c = items[0]
        c_stats = c.get("statistics", {})
        c_snip = c.get("snippet", {})
        thumbs = c_snip.get("thumbnails", {})
        c_thumb = (thumbs.get("high") or thumbs.get("default") or {}).get("url")
        uploads_playlist = (
            c.get("contentDetails", {}).get("relatedPlaylists", {}).get("uploads")
        )

        channel = YtChannel(
            id=c["id"],
            title=c_snip.get("title", ""),
            custom_url=c_snip.get("customUrl"),
            description=c_snip.get("description", ""),
            thumbnail=c_thumb,
            subscribers=int(c_stats.get("subscriberCount") or 0),
            total_views=int(c_stats.get("viewCount") or 0),
            video_count=int(c_stats.get("videoCount") or 0),
        )

        # ── 2. Fetch recent uploads via the uploads playlist ─────────
        videos: list[YtVideo] = []
        if uploads_playlist:
            pl = await client.get(
                f"{YT_API_BASE}/playlistItems",
                params={
                    "part": "snippet,contentDetails",
                    "playlistId": uploads_playlist,
                    "maxResults": max_videos,
                    "key": key,
                },
            )
            if pl.status_code == 200:
                pl_items = pl.json().get("items", [])
                video_ids = [
                    it["contentDetails"]["videoId"]
                    for it in pl_items
                    if it.get("contentDetails", {}).get("videoId")
                ]

                # ── 3. Batch fetch video stats + durations ───────────
                if video_ids:
                    vr = await client.get(
                        f"{YT_API_BASE}/videos",
                        params={
                            "part": "snippet,statistics,contentDetails",
                            "id": ",".join(video_ids),
                            "key": key,
                        },
                    )
                    if vr.status_code == 200:
                        for v in vr.json().get("items", []):
                            vs = v.get("statistics", {})
                            vsnip = v.get("snippet", {})
                            vthumbs = vsnip.get("thumbnails", {})
                            vt = (
                                vthumbs.get("high") or vthumbs.get("default") or {}
                            ).get("url")
                            videos.append(
                                YtVideo(
                                    id=v["id"],
                                    title=vsnip.get("title", ""),
                                    published_at=vsnip.get("publishedAt", ""),
                                    thumbnail=vt,
                                    views=int(vs.get("viewCount") or 0),
                                    likes=int(vs.get("likeCount") or 0),
                                    comments=int(vs.get("commentCount") or 0),
                                    duration=v.get("contentDetails", {}).get(
                                        "duration", "PT0S"
                                    ),
                                )
                            )

    return YtScanResponse(
        channel=channel,
        videos=videos,
        fetched_at=datetime.now(timezone.utc).isoformat(),
    )
