"""Multi-channel social management (Schedule v2).

One channel = one Ayrshare sub-profile = one platform handle. Users add
channels ONE AT A TIME via:

    POST /channels       — create row, mint Ayrshare profile, return link URL
    user OAuths the platform in their browser via Ayrshare hosted linking
    POST /channels/{id}/refresh — pull handle + status from Ayrshare /user

Channels are scoped per-user. Daniel can run 7 TikTok + 7 Reels + 7 YT off
one Liquid Clips install — each is its own row + own Ayrshare profile.

Legacy `social_connections` users get auto-backfilled into a single channel
on their first GET /channels call.

Auth: license JWT.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import ayrshare
from app.db import get_db
from app.deps import current_user
from app.models import SocialChannel, SocialConnection, User

log = logging.getLogger("junior.channels")

router = APIRouter(prefix="/channels", tags=["channels"])

# Per-tier channel caps. Mirrors useTier.ts MAX_CHANNELS. Tightened to keep
# us under the Ayrshare Business-plan 30-profile cap until we have real
# revenue justifying an Enterprise upgrade.
_MAX_CHANNELS_BY_TIER = {
    "free": 0,
    "solo": 2,
    "pro": 5,
    "agency": 15,
    # Legacy aliases — same caps as their v2 successor
    "growth": 5,
    "autopilot": 15,
}

_SUPPORTED_PLATFORMS = ("tiktok", "instagram", "youtube", "x", "linkedin", "facebook", "threads")

PlatformLit = Literal[
    "tiktok", "instagram", "youtube", "x", "linkedin", "facebook", "threads"
]


# ── Pydantic shapes ────────────────────────────────────────────────────

class ChannelCreate(BaseModel):
    platform: PlatformLit
    label: str = Field(..., min_length=1, max_length=80)


class ChannelPatch(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=80)
    status: Literal["active", "paused"] | None = None


class ChannelResponse(BaseModel):
    id: str
    label: str
    platform: str
    handle: str | None
    status: str
    total_posts: int
    last_refreshed_at: str | None
    created_at: str


class ChannelCreateResponse(BaseModel):
    channel: ChannelResponse
    link_url: str           # open in the system browser so OAuth uses a trusted user agent


# ── Helpers ────────────────────────────────────────────────────────────

def _to_response(row: SocialChannel) -> ChannelResponse:
    return ChannelResponse(
        id=row.id,
        label=row.label,
        platform=row.platform,
        handle=row.handle,
        status=row.status,
        total_posts=int(row.total_posts or 0),
        last_refreshed_at=row.last_refreshed_at.isoformat() if row.last_refreshed_at else None,
        created_at=row.created_at.isoformat() if row.created_at else "",
    )


def _max_channels_for(user: User) -> int:
    if user.founder_flag:
        return 30  # Ayrshare Business cap
    return _MAX_CHANNELS_BY_TIER.get(user.tier, 0)


def _ayrshare_link_domain() -> str:
    domain = (os.environ.get("AYRSHARE_LINK_DOMAIN", "").strip() or "app.ayrshare.com").rstrip("/")
    if not domain.startswith("http"):
        domain = f"https://{domain}"
    return domain


def _build_platform_link_url(profile_key: str, platform: str) -> str:
    """Return an Ayrshare hosted-link URL scoped to one platform.

    The desktop opens this in the user's normal browser, not an embedded
    WebView. We still make the URL platform-specific so "Connect Instagram"
    lands on the Instagram/Meta linking path instead of a generic Ayrshare
    picker. JWT is the clean path; profileKey is the resilient fallback.
    """
    platform_slug = platform.strip().lower()
    link_url: str | None = None
    try:
        jwt_response = ayrshare.generate_jwt(profile_key, allowed_social=[platform_slug])
        url_from_jwt = (jwt_response or {}).get("url")
        if isinstance(url_from_jwt, str) and url_from_jwt:
            link_url = url_from_jwt
    except httpx.HTTPError as exc:
        log.warning("[channels] generateJWT failed for %s, falling back to profileKey URL: %s", platform_slug, exc)
    except RuntimeError as exc:
        log.warning("[channels] generateJWT prerequisites missing, falling back: %s", exc)
    except Exception:  # noqa: BLE001 — linking should degrade to the fallback URL
        log.exception("[channels] generateJWT raised unexpectedly, falling back")

    if link_url:
        return link_url
    return f"{_ayrshare_link_domain()}/social-accounts?profileKey={profile_key}&platforms={platform_slug}"


def _backfill_legacy_connection(db: Session, user: User) -> SocialChannel | None:
    """One-time migration helper. If the user has a legacy SocialConnection
    row but no SocialChannel rows, create a single 'Main account' channel
    that re-uses the same Ayrshare profile_key. Idempotent: returns None if
    already migrated."""
    has_channels = db.query(SocialChannel).filter_by(user_id=user.id).first()
    if has_channels:
        return None
    legacy = db.get(SocialConnection, user.id)
    if not legacy or not legacy.ayrshare_profile_key:
        return None
    platforms = legacy.connected_platforms or []
    primary_platform = (
        str(platforms[0]).lower() if platforms else "tiktok"
    )
    row = SocialChannel(
        user_id=user.id,
        label="Main account",
        platform=primary_platform if primary_platform in _SUPPORTED_PLATFORMS else "tiktok",
        ayrshare_profile_key=legacy.ayrshare_profile_key,
        status="active" if platforms else "pending_link",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    log.info("[channels] backfilled legacy SocialConnection for user=%s as channel=%s", user.id, row.id)
    return row


def _fetch_handle_from_ayrshare(profile_key: str, platform: str) -> tuple[str | None, str]:
    """Hit Ayrshare /user with the channel's profile key. Returns
    (handle, status). status ∈ active | error."""
    try:
        with httpx.Client(timeout=ayrshare.DEFAULT_TIMEOUT) as client:
            r = client.get(
                f"{ayrshare.AYRSHARE_BASE}/user",
                headers=ayrshare._headers(profile_key),
            )
        if r.status_code != 200:
            return None, "error"
        body = r.json()
        # Ayrshare's /user returns `displayNames` (preferred) or
        # `activeSocialAccounts`. Try a few shapes.
        display_names = body.get("displayNames") or {}
        if isinstance(display_names, dict) and platform in display_names:
            return str(display_names[platform]), "active"
        active = body.get("activeSocialAccounts") or []
        if isinstance(active, dict):
            # Some payloads return {"tiktok": "@handle"} maps
            handle = active.get(platform)
            if handle:
                return str(handle), "active"
            return None, "active" if active else "pending_link"
        if isinstance(active, list):
            return None, "active" if platform in [str(p).lower() for p in active] else "pending_link"
        return None, "pending_link"
    except Exception as exc:  # noqa: BLE001
        log.warning("[channels] fetch_handle failed: %s", exc)
        return None, "error"


# ── Routes ─────────────────────────────────────────────────────────────

@router.get("", response_model=list[ChannelResponse])
def list_channels(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ChannelResponse]:
    _backfill_legacy_connection(db, user)
    rows = (
        db.query(SocialChannel)
        .filter(SocialChannel.user_id == user.id)
        .filter(SocialChannel.status != "deleted")
        .order_by(SocialChannel.created_at.asc())
        .all()
    )
    return [_to_response(r) for r in rows]


@router.get("/{channel_id}", response_model=ChannelResponse)
def get_channel(
    channel_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ChannelResponse:
    row = db.get(SocialChannel, channel_id)
    if not row or row.user_id != user.id or row.status == "deleted":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "channel not found")
    return _to_response(row)


@router.post("", response_model=ChannelCreateResponse, status_code=status.HTTP_201_CREATED)
def create_channel(
    body: ChannelCreate,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ChannelCreateResponse:
    if not ayrshare.is_configured():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Publishing isn't configured yet — try again in a moment.",
        )
    if body.platform not in _SUPPORTED_PLATFORMS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unsupported platform '{body.platform}'. Supported: {_SUPPORTED_PLATFORMS}",
        )

    # Tier cap — soft fail with a clear upgrade message.
    existing = (
        db.query(SocialChannel)
        .filter(SocialChannel.user_id == user.id)
        .filter(SocialChannel.status != "deleted")
        .count()
    )
    cap = _max_channels_for(user)
    if existing >= cap:
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            f"You've added the max {cap} channels for your tier. Upgrade to add more.",
        )

    # Provision the Ayrshare sub-profile. We commit the channel row BEFORE
    # the user finishes linking so a backend crash mid-flow doesn't orphan
    # the Ayrshare profile.
    title = f"{body.label} · {user.email or user.id} · liquidclips"
    try:
        created = ayrshare.create_profile(title=title, email=user.email)
    except httpx.HTTPError as exc:
        log.exception("[channels] create_profile failed")
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Couldn't provision an Ayrshare profile. Try again in a minute.",
        ) from exc
    profile_key = (created or {}).get("profileKey") or (created or {}).get("profile_key")
    ref_id = (created or {}).get("refId") or (created or {}).get("ref_id")
    if not profile_key:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Ayrshare returned an unexpected response: {created}",
        )

    row = SocialChannel(
        user_id=user.id,
        label=body.label,
        platform=body.platform,
        ayrshare_profile_key=profile_key,
        ayrshare_ref_id=ref_id,
        status="pending_link",
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    # Build a platform-specific link. This keeps the Schedule v2 channel flow
    # direct: picking Instagram lands on Instagram/Meta linking, not a generic
    # Ayrshare social picker.
    link_url = _build_platform_link_url(profile_key, body.platform)

    return ChannelCreateResponse(channel=_to_response(row), link_url=link_url)


@router.patch("/{channel_id}", response_model=ChannelResponse)
def patch_channel(
    channel_id: str,
    body: ChannelPatch,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ChannelResponse:
    row = db.get(SocialChannel, channel_id)
    if not row or row.user_id != user.id or row.status == "deleted":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "channel not found")
    if body.label is not None:
        # Enforce per-user label uniqueness explicitly so we return 400 not
        # an opaque 500 on the unique constraint.
        clash = (
            db.query(SocialChannel)
            .filter(SocialChannel.user_id == user.id)
            .filter(SocialChannel.label == body.label)
            .filter(SocialChannel.id != channel_id)
            .filter(SocialChannel.status != "deleted")
            .first()
        )
        if clash:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"You already have a channel named '{body.label}'.")
        row.label = body.label
    if body.status is not None:
        row.status = body.status
    db.commit()
    db.refresh(row)
    return _to_response(row)


@router.delete("/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_channel(
    channel_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    """Soft-delete: mark status='deleted'. The Ayrshare profile is NOT
    deleted (in case the user wants to re-link later). Pending schedules
    pointing at this channel get cancelled."""
    row = db.get(SocialChannel, channel_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "channel not found")
    row.status = "deleted"
    db.commit()
    # Cancellation of pending schedules happens via the schedules route's
    # housekeeping cron (`_reconcile_published_tick` will surface them as
    # canceled). Avoiding a fan-out here keeps the DELETE fast.


@router.post("/{channel_id}/refresh", response_model=ChannelResponse)
def refresh_channel(
    channel_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ChannelResponse:
    row = db.get(SocialChannel, channel_id)
    if not row or row.user_id != user.id or row.status == "deleted":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "channel not found")
    handle, status_str = _fetch_handle_from_ayrshare(row.ayrshare_profile_key, row.platform)
    row.handle = handle or row.handle
    if status_str:
        # Preserve a manual 'paused' state — only flip auto on/off.
        if row.status not in ("paused", "deleted"):
            row.status = status_str
    row.last_refreshed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return _to_response(row)


class RelinkResponse(BaseModel):
    link_url: str


@router.post("/{channel_id}/relink", response_model=RelinkResponse)
def relink_channel(
    channel_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> RelinkResponse:
    """Re-mint the link URL — used when the user needs to swap the OAuth
    on an existing channel (e.g. revoked, expired, wrong handle)."""
    row = db.get(SocialChannel, channel_id)
    if not row or row.user_id != user.id or row.status == "deleted":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "channel not found")
    return RelinkResponse(link_url=_build_platform_link_url(row.ayrshare_profile_key, row.platform))
