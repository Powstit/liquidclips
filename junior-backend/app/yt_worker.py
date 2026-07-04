"""F7 · Layer 4 · YouTube batch-lookup worker.

Backs the desktop-2 F5 warm-peer roster builder with a server-side
YouTube Data API v3 batch lookup. Given a set of ``video_ids`` and
``channel_ids``, returns matched metadata::

    video_id · channel_id · channel_handle · subs · verified_at

Design decisions:

* **24h in-memory cache keyed by channel_id.** Roster builds are
  bursty (a Gmail scan can produce 100+ candidates in seconds) but
  individual channels only need re-lookup once a day. Cache is
  process-local — Railway runs a single replica so a cross-instance
  cache layer would only add complexity without lift.

* **100 lookups/minute + 10,000/day quota tracked in-process.** Both
  windows reset automatically. Google's Data API costs 1 unit per
  ``videos.list`` and 1 per ``channels.list`` call, so the 10k/day
  budget covers roughly 10k unique channels resolved per day.

* **Scraper-stub fallback when the quota trips.** Returns a partial
  row (empty handle · subs = -1) so the roster builder can still
  ship a roster with degraded metadata. The ``partial=True`` flag on
  the response lets the client mark rows for later re-verification
  the next time quota is available.

* **License-JWT-gated.** The endpoint depends on ``current_user`` so
  a leaked YOUTUBE_API_KEY can never be burned by anonymous curl.

The endpoint is registered in ``app/main.py`` as part of the standard
router import list.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from threading import Lock
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import current_user
from app.models import User

log = logging.getLogger("junior.yt_worker")
router = APIRouter(prefix="/yt", tags=["yt-worker"])


# ─────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────

MAX_PER_MINUTE = 100
MAX_PER_DAY = 10_000
CACHE_TTL_SEC = 60 * 60 * 24
YT_API_BASE = "https://www.googleapis.com/youtube/v3"
BATCH_MAX = 50  # Google's per-request cap for videos.list + channels.list


# ─────────────────────────────────────────────────────────────────
# Cache · in-memory, keyed by channel_id
# ─────────────────────────────────────────────────────────────────

# channel_id → (channel_id, channel_handle, subs, verified_at_epoch)
_cache: dict[str, tuple[str, str, int, float]] = {}
_cache_lock = Lock()


def _cache_get(channel_id: str) -> tuple[str, str, int, float] | None:
    """Return the cached row if it exists AND is within TTL. Rows past
    their TTL are evicted opportunistically so the cache doesn't grow
    without bound."""
    with _cache_lock:
        row = _cache.get(channel_id)
        if row is None:
            return None
        (_, _, _, verified_at_epoch) = row
        if time.time() - verified_at_epoch > CACHE_TTL_SEC:
            _cache.pop(channel_id, None)
            return None
        return row


def _cache_put(channel_id: str, channel_handle: str, subs: int) -> None:
    with _cache_lock:
        _cache[channel_id] = (channel_id, channel_handle, subs, time.time())


# ─────────────────────────────────────────────────────────────────
# Rate-limit + daily quota tracking
# ─────────────────────────────────────────────────────────────────

_minute_window: list[float] = []
_day_quota_used = 0
_day_quota_reset_at = time.time() + 86400
_rate_lock = Lock()


def _prune_minute_window() -> None:
    """Drop timestamps older than 60s so the minute counter reflects
    the sliding window."""
    cutoff = time.time() - 60
    while _minute_window and _minute_window[0] < cutoff:
        _minute_window.pop(0)


def _reset_day_if_expired() -> None:
    """Zero the daily counter when the 24h window elapses."""
    global _day_quota_used, _day_quota_reset_at
    now = time.time()
    if now >= _day_quota_reset_at:
        _day_quota_used = 0
        _day_quota_reset_at = now + 86400


def _quota_available(count: int) -> bool:
    """Return True when both the per-minute AND per-day budgets can
    absorb ``count`` more lookups without breaching a limit."""
    with _rate_lock:
        _reset_day_if_expired()
        _prune_minute_window()
        if _day_quota_used + count > MAX_PER_DAY:
            return False
        if len(_minute_window) + count > MAX_PER_MINUTE:
            return False
        return True


def _record_lookups(count: int) -> None:
    global _day_quota_used
    with _rate_lock:
        now = time.time()
        for _ in range(count):
            _minute_window.append(now)
        _day_quota_used += count


def _reset_state() -> None:
    """Test-only helper. Not exposed via HTTP. Resets cache + rate
    windows so each test starts from a clean slate."""
    global _day_quota_used, _day_quota_reset_at
    with _cache_lock:
        _cache.clear()
    with _rate_lock:
        _minute_window.clear()
        _day_quota_used = 0
        _day_quota_reset_at = time.time() + 86400


# ─────────────────────────────────────────────────────────────────
# YouTube Data API v3 · videos.list + channels.list
# ─────────────────────────────────────────────────────────────────


class YtApiError(Exception):
    """Any non-quota API failure. Distinguished from ``YtQuotaError``
    so the caller can differentiate ``500 misconfigured`` (raise) from
    ``partial fallback`` (swallow + degrade)."""


class YtQuotaError(Exception):
    """Google returned 403 quotaExceeded. Triggers scraper fallback."""


def _http_client() -> httpx.Client:
    """Factory so tests can patch a single spot to inject a mock."""
    return httpx.Client(timeout=15.0)


def _raise_for_yt(response: httpx.Response, endpoint: str) -> None:
    """Convert a YouTube API error response into one of our two
    typed exceptions."""
    if response.status_code < 400:
        return
    body = response.text or ""
    if response.status_code == 403 and "quotaExceeded" in body:
        raise YtQuotaError(f"{endpoint} · quota_exceeded")
    raise YtApiError(f"{endpoint} · HTTP {response.status_code}")


def fetch_videos(video_ids: list[str], api_key: str) -> dict[str, str]:
    """Return ``video_id → channel_id`` for every video the API
    resolved. Batched at ``BATCH_MAX`` per Google's cap."""
    if not video_ids:
        return {}
    result: dict[str, str] = {}
    for i in range(0, len(video_ids), BATCH_MAX):
        chunk = video_ids[i : i + BATCH_MAX]
        with _http_client() as client:
            r = client.get(
                f"{YT_API_BASE}/videos",
                params={
                    "part": "snippet",
                    "id": ",".join(chunk),
                    "key": api_key,
                },
            )
        _raise_for_yt(r, "videos.list")
        for item in r.json().get("items", []):
            vid = item.get("id")
            chid = (item.get("snippet") or {}).get("channelId")
            if vid and chid:
                result[vid] = chid
    return result


def fetch_channels(
    channel_ids: list[str], api_key: str,
) -> dict[str, tuple[str, int]]:
    """Return ``channel_id → (handle, subs)`` for every channel the
    API resolved."""
    if not channel_ids:
        return {}
    result: dict[str, tuple[str, int]] = {}
    for i in range(0, len(channel_ids), BATCH_MAX):
        chunk = channel_ids[i : i + BATCH_MAX]
        with _http_client() as client:
            r = client.get(
                f"{YT_API_BASE}/channels",
                params={
                    "part": "snippet,statistics",
                    "id": ",".join(chunk),
                    "key": api_key,
                },
            )
        _raise_for_yt(r, "channels.list")
        for item in r.json().get("items", []):
            chid = item.get("id")
            snippet = item.get("snippet") or {}
            stats = item.get("statistics") or {}
            handle = snippet.get("customUrl") or snippet.get("title") or ""
            raw = stats.get("subscriberCount") or "0"
            try:
                subs = int(raw)
            except (TypeError, ValueError):
                subs = 0
            if chid:
                result[chid] = (handle, subs)
    return result


def scraper_fallback(channel_ids: list[str]) -> dict[str, tuple[str, int]]:
    """Fallback stub returning partial data when the quota is
    exhausted. Real implementation would parse each channel's public
    ``/about`` page; the stub returns ``('', -1)`` so downstream can
    render a "verifying…" placeholder and re-poll on the next daily
    quota cycle."""
    log.warning(
        "[yt_worker] scraper fallback fired · %d channels · quota exhausted",
        len(channel_ids),
    )
    return {chid: ("", -1) for chid in channel_ids}


# ─────────────────────────────────────────────────────────────────
# Public data shapes + endpoint
# ─────────────────────────────────────────────────────────────────


class BatchLookupRequest(BaseModel):
    video_ids: list[str] = Field(default_factory=list, max_length=200)
    channel_ids: list[str] = Field(default_factory=list, max_length=200)


class BatchLookupMatch(BaseModel):
    video_id: str | None = None
    channel_id: str
    channel_handle: str
    subs: int
    verified_at: str  # ISO-8601 UTC


class BatchLookupResponse(BaseModel):
    matches: list[BatchLookupMatch]
    partial: bool = False


def _to_iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


@router.post("/batch-lookup", response_model=BatchLookupResponse)
def batch_lookup(
    body: BatchLookupRequest,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> BatchLookupResponse:
    """Batch-lookup YouTube videos + channels.

    Flow:
      1. Resolve ``video_ids`` → ``channel_ids`` via the videos.list
         endpoint (skipped when quota exhausted).
      2. Consolidate caller-supplied channel_ids with the video-derived
         set and split into cache hits vs uncached.
      3. Fetch the uncached channels through channels.list, falling
         back to :func:`scraper_fallback` when the quota trips.
      4. Emit one match per requested ``video_id`` and one per requested
         ``channel_id`` (deduplication is the client's responsibility;
         each id emits its own row so the ordering matches the request).
    """
    settings = get_settings()
    api_key = settings.youtube_api_key
    if not api_key:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "server misconfigured · YOUTUBE_API_KEY unset",
        )

    video_ids = [v.strip() for v in body.video_ids if v.strip()]
    channel_ids = [c.strip() for c in body.channel_ids if c.strip()]

    partial = False
    video_to_channel: dict[str, str] = {}

    # Step 1 · resolve video_id → channel_id
    if video_ids:
        if not _quota_available(len(video_ids)):
            partial = True
        else:
            try:
                video_to_channel = fetch_videos(video_ids, api_key)
                _record_lookups(len(video_ids))
            except YtQuotaError:
                partial = True
            except YtApiError as e:
                raise HTTPException(
                    status.HTTP_502_BAD_GATEWAY,
                    f"yt videos.list failed: {e}",
                ) from e

    # Step 2 · split cache hits vs uncached channels
    channels_needed = set(channel_ids) | set(video_to_channel.values())
    resolved: dict[str, tuple[str, str, int, float]] = {}
    uncached: list[str] = []
    for chid in channels_needed:
        row = _cache_get(chid)
        if row:
            resolved[chid] = row
        else:
            uncached.append(chid)

    # Step 3 · fetch uncached (or scraper fallback)
    if uncached:
        used_fallback = False
        if not _quota_available(len(uncached)):
            used_fallback = True
        else:
            try:
                fetched = fetch_channels(uncached, api_key)
                _record_lookups(len(uncached))
                now = time.time()
                for chid, (handle, subs) in fetched.items():
                    _cache_put(chid, handle, subs)
                    resolved[chid] = (chid, handle, subs, now)
            except YtQuotaError:
                used_fallback = True
            except YtApiError as e:
                raise HTTPException(
                    status.HTTP_502_BAD_GATEWAY,
                    f"yt channels.list failed: {e}",
                ) from e

        if used_fallback:
            partial = True
            now = time.time()
            for chid, (handle, subs) in scraper_fallback(uncached).items():
                resolved[chid] = (chid, handle, subs, now)

    # Step 4 · emit matches (one per requested id)
    matches: list[BatchLookupMatch] = []
    for vid in video_ids:
        chid = video_to_channel.get(vid)
        if not chid:
            continue
        row = resolved.get(chid)
        if not row:
            continue
        (_, handle, subs, epoch) = row
        matches.append(
            BatchLookupMatch(
                video_id=vid,
                channel_id=chid,
                channel_handle=handle,
                subs=subs,
                verified_at=_to_iso(epoch),
            ),
        )
    for chid in channel_ids:
        row = resolved.get(chid)
        if not row:
            continue
        (_, handle, subs, epoch) = row
        matches.append(
            BatchLookupMatch(
                video_id=None,
                channel_id=chid,
                channel_handle=handle,
                subs=subs,
                verified_at=_to_iso(epoch),
            ),
        )

    return BatchLookupResponse(matches=matches, partial=partial)
