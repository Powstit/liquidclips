"""HQ library proxy · GET /library/* + /podcast/handoff/*.

⚠ IRON GATE IG-COMPOSER-K · HQ library proxy contract.
Do NOT expose HQ_READ_SECRET to the desktop client. This module is the
ONLY egress point from the desktop into HQ's 1.3M-channel archive.

Desktop clients hit ``/library/search`` etc. authed with their license
JWT (``Depends(current_user)``). This module then forwards the request
to ``hq.liquidclips.com/api/library/*`` with the shared
``x-hq-secret`` header attached server-side. The secret NEVER leaves
the backend perimeter.

Response bodies are passed through verbatim — HQ's shape is the
contract the Composer front-door mockup is coded against
(``FRONT-DOOR-thumbnail-wall.html`` · ``HQ_YOUTUBE_LIBRARY_API_HANDOFF_2026-07-17.md``).

Endpoints (all read-only, license-JWT gated):

* ``GET /library/search``   → HQ ``/api/library/search``
* ``GET /library/channel/<lc_id>``       → HQ ``/api/library/channel/<lc_id>``
* ``GET /library/handoff/<video_id>``    → HQ ``/api/handoff/<video_id>``
* ``GET /podcast/handoff/<episode_id>``  → HQ ``/api/podcast/handoff/<episode_id>``

Failure modes:

* HQ 401 → we misconfigured the secret · surface as 502 (never leak)
* HQ 429 → pass-through (rate-limited upstream)
* HQ 5xx / network timeout → 502 with a stable shape
* HQ 200 → forward JSON verbatim
"""

from __future__ import annotations

import logging
import os
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.deps import current_user
from app.models import User

router = APIRouter(tags=["library"])
_log = logging.getLogger("junior.library")

# HQ base URL is env-overridable so a future HQ hostname move doesn't
# require a code change. Default is production. Timeout kept modest
# because the desktop is the caller and its UX budget is ~500ms.
_HQ_BASE_URL = os.environ.get("HQ_BASE_URL", "https://hq.liquidclips.com").rstrip("/")
_HQ_TIMEOUT_S = float(os.environ.get("HQ_LIBRARY_TIMEOUT_S", "15"))


def _hq_headers() -> dict[str, str]:
    """Build the outbound header set for the HQ API.

    Fail-closed if the secret is not configured in production. Dev
    still allows the call so local iteration works, but HQ will 401
    upstream — which we translate to a 502 so no secret detail leaks.
    """
    secret = os.environ.get("HQ_READ_SECRET", "").strip()
    if not secret and os.environ.get("ENV", "").lower() == "production":
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "HQ_READ_SECRET env var must be set in production",
        )
    return {"x-hq-secret": secret, "accept": "application/json"}


async def _hq_get(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Thin proxy call to HQ. Never surface the secret to the caller."""
    url = f"{_HQ_BASE_URL}{path}"
    try:
        async with httpx.AsyncClient(timeout=_HQ_TIMEOUT_S) as client:
            resp = await client.get(url, params=params, headers=_hq_headers())
    except httpx.HTTPError as exc:
        _log.warning("hq_library.network_error path=%s err=%s", path, exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "hq library upstream unreachable") from exc

    if resp.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "hq library rate-limited")
    if resp.status_code >= 500:
        _log.warning("hq_library.upstream_5xx path=%s code=%s", path, resp.status_code)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "hq library upstream error")
    if resp.status_code == status.HTTP_401_UNAUTHORIZED:
        # Our secret is wrong — do not leak that to the caller. Return
        # a stable 502 with no upstream detail.
        _log.error("hq_library.auth_fail path=%s", path)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "hq library upstream error")
    if resp.status_code != status.HTTP_200_OK:
        _log.warning("hq_library.non_200 path=%s code=%s", path, resp.status_code)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "hq library upstream error")

    try:
        return resp.json()
    except ValueError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "hq library upstream returned non-json") from exc


# ── /library/search ───────────────────────────────────────────────
@router.get("/library/search")
async def library_search(
    _user: Annotated[User, Depends(current_user)],
    q: Annotated[str, Query(min_length=0, max_length=200)] = "",
    niche: Annotated[str | None, Query(max_length=64)] = None,
    tier: Annotated[str | None, Query(max_length=16)] = None,
    min_subs: Annotated[int | None, Query(ge=0)] = None,
    has_video: Annotated[int, Query(ge=0, le=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=200)] = 24,
    cursor: Annotated[str | None, Query(max_length=256)] = None,
) -> dict[str, Any]:
    """Search HQ's 1.3M-channel index. Returns HQ's response verbatim."""
    params: dict[str, Any] = {"q": q, "has_video": has_video, "limit": limit}
    if niche:
        params["niche"] = niche
    if tier:
        params["tier"] = tier
    if min_subs is not None:
        params["min_subs"] = min_subs
    if cursor:
        params["cursor"] = cursor
    return await _hq_get("/api/library/search", params=params)


# ── /library/channel/{lc_id} ──────────────────────────────────────
@router.get("/library/channel/{lc_id}")
async def library_channel(
    lc_id: str,
    _user: Annotated[User, Depends(current_user)],
) -> dict[str, Any]:
    """Full channel profile + deep-dive + latest video_id."""
    return await _hq_get(f"/api/library/channel/{lc_id}")


# ── /library/handoff/{video_id} ───────────────────────────────────
@router.get("/library/handoff/{video_id}")
async def library_handoff(
    video_id: str,
    _user: Annotated[User, Depends(current_user)],
) -> dict[str, Any]:
    """One-call clip package: source_url + thumb + caption + moments."""
    return await _hq_get(f"/api/handoff/{video_id}")


# ── /podcast/handoff/{episode_id} ─────────────────────────────────
@router.get("/podcast/handoff/{episode_id}")
async def podcast_handoff(
    episode_id: str,
    _user: Annotated[User, Depends(current_user)],
) -> dict[str, Any]:
    """Podcast handoff · always ``whisper_needed:false`` via Podscan cache."""
    return await _hq_get(f"/api/podcast/handoff/{episode_id}")
