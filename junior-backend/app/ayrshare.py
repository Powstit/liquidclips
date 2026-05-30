"""Ayrshare social-publishing client.

Replaces the in-progress Postiz self-host (which never went live in
prod — `_PUBLISHING_LIVE = False` per features.py). Ayrshare is a
hosted API on the Business plan ($599/mo, 30 profiles included). Key
loaded from env AYRSHARE_API_KEY.

Surface kept tiny — only what publish.py + cron.py need:

    post(...)           publish or schedule a post
    history(...)        recent posts for a profile
    analytics(...)      per-post engagement
    check_key()         health check used by /healthcheck

Profile-Key header scopes each call to one connected user; each Junior
user gets their own profile key on first Connect via Ayrshare's hosted
linking page. We persist the key in social_connections.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

AYRSHARE_BASE = "https://app.ayrshare.com/api"
DEFAULT_TIMEOUT = 30.0


def _api_key() -> str:
    key = os.environ.get("AYRSHARE_API_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "AYRSHARE_API_KEY is not set — publish is disabled until the Railway "
            "env var is populated."
        )
    return key


def _headers(profile_key: str | None = None) -> dict[str, str]:
    h = {
        "Authorization": f"Bearer {_api_key()}",
        "Content-Type": "application/json",
    }
    if profile_key:
        h["Profile-Key"] = profile_key
    return h


def is_configured() -> bool:
    """Cheap check used by features.py to decide whether to mark publish
    features as `built: True`. Avoids raising on import for clients that
    only want to know if the key is present."""
    return bool(os.environ.get("AYRSHARE_API_KEY", "").strip())


def check_key() -> dict[str, Any]:
    """GET /user — Ayrshare's account-info endpoint. Used as a health
    check at /healthcheck and during Connect-account flow to verify the
    user pasted a real profile key."""
    r = httpx.get(
        f"{AYRSHARE_BASE}/user",
        headers=_headers(),
        timeout=DEFAULT_TIMEOUT,
    )
    r.raise_for_status()
    return r.json()


def post(
    text: str,
    platforms: list[str],
    media_urls: list[str] | None = None,
    *,
    profile_key: str | None = None,
    scheduled_at: str | None = None,
) -> dict[str, Any]:
    """Publish or schedule a post across one or more platforms.

    Args:
        text:           caption / post text.
        platforms:      e.g. ["tiktok", "instagram", "youtube", "x"].
        media_urls:     optional list of media URLs.
        profile_key:    the connected user's Ayrshare Profile Key. Required
                        for multi-user mode (which we are).
        scheduled_at:   ISO-8601 future timestamp. If set, Ayrshare queues
                        the post instead of firing immediately.

    Returns Ayrshare's response dict. Errors raise httpx.HTTPStatusError —
    publish.py and cron.py catch + surface as 502 to the desktop.
    """
    payload: dict[str, Any] = {
        "post": text,
        "platforms": platforms,
    }
    if media_urls:
        payload["mediaUrls"] = media_urls
    if scheduled_at:
        payload["scheduleDate"] = scheduled_at
    r = httpx.post(
        f"{AYRSHARE_BASE}/post",
        headers=_headers(profile_key),
        json=payload,
        timeout=DEFAULT_TIMEOUT,
    )
    r.raise_for_status()
    return r.json()


def history(profile_key: str, *, last_records: int = 25) -> dict[str, Any]:
    """Recent posts for a profile. Used by the desktop Publish history view."""
    r = httpx.get(
        f"{AYRSHARE_BASE}/history",
        headers=_headers(profile_key),
        params={"lastRecords": last_records},
        timeout=DEFAULT_TIMEOUT,
    )
    r.raise_for_status()
    return r.json()


def analytics(profile_key: str, post_id: str) -> dict[str, Any]:
    """Per-post engagement (likes, comments, views per platform)."""
    r = httpx.post(
        f"{AYRSHARE_BASE}/analytics/post",
        headers=_headers(profile_key),
        json={"id": post_id},
        timeout=DEFAULT_TIMEOUT,
    )
    r.raise_for_status()
    return r.json()


def media_upload(file_path: str, profile_key: str | None = None) -> str:
    """Upload a local media file (mp4 / jpg / etc) to Ayrshare's CDN and
    return the public URL. We chain this before `post()` so multipart-from-
    desktop uploads can flow without us hosting our own CDN.

    Ayrshare endpoint: POST /api/post/uploadUrl returns a signed URL, then
    the file is PUT'd against that URL. Two-step on purpose — keeps large
    bodies off Ayrshare's API gateway.
    """
    import mimetypes

    fname = os.path.basename(file_path)
    content_type = mimetypes.guess_type(fname)[0] or "application/octet-stream"

    # Step 1: ask for a signed upload URL.
    sign = httpx.post(
        f"{AYRSHARE_BASE}/post/uploadUrl",
        headers=_headers(profile_key),
        json={"fileName": fname, "contentType": content_type},
        timeout=DEFAULT_TIMEOUT,
    )
    sign.raise_for_status()
    body = sign.json()
    upload_url = body.get("uploadUrl") or body.get("url")
    public_url = body.get("accessUrl") or body.get("publicUrl") or body.get("url")
    if not upload_url or not public_url:
        raise RuntimeError(f"Ayrshare uploadUrl response missing URL fields: {body}")

    # Step 2: PUT the bytes against the signed URL. Use a generous timeout —
    # 60s/MB headroom for slow links, capped at 10min.
    size = os.path.getsize(file_path)
    put_timeout = max(60.0, min(600.0, size / (1024 * 1024) * 60.0))
    with open(file_path, "rb") as fh:
        put = httpx.put(
            upload_url,
            content=fh.read(),
            headers={"Content-Type": content_type},
            timeout=put_timeout,
        )
    put.raise_for_status()
    return public_url


def cancel_scheduled(profile_key: str, post_id: str) -> dict[str, Any]:
    """Cancel a pending scheduled post. Used by desktop's ScheduleQueue cancel
    button — currently routes through schedules.py."""
    r = httpx.request(
        "DELETE",
        f"{AYRSHARE_BASE}/post",
        headers=_headers(profile_key),
        json={"id": post_id},
        timeout=DEFAULT_TIMEOUT,
    )
    r.raise_for_status()
    return r.json()
