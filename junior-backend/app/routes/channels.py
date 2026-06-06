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
from app.features import is_admin_email
from app.models import SocialChannel, SocialConnection, User, WebhookEvent

log = logging.getLogger("junior.channels")

router = APIRouter(prefix="/channels", tags=["channels"])

# Separate router for /admin/channels/* observability endpoints. Mounted under
# `/admin/channels` so it lives alongside the rest of the admin surface even
# though the handler implementations live next to the channels CRUD they
# inspect. main.py should `app.include_router(channels.admin_router)`.
admin_router = APIRouter(prefix="/admin/channels", tags=["channels-admin"])

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


def _build_platform_link_url(profile_key: str, platform: str, channel_id: str | None = None) -> str:
    """Return an Ayrshare hosted-link URL scoped to one platform.

    The desktop opens this in the user's normal browser, not an embedded
    WebView. JWT is the clean path; profileKey is the resilient fallback.

    v0.7.x harden: when channel_id is provided, we pass a redirect target
    to generate_jwt() so Ayrshare bounces the user back to the account-app
    after OAuth, which fires a `liquidclips://channel-linked?channel_id=X`
    deep link. Without `redirect=` TikTok specifically refuses to complete
    OAuth (its age-gate page closes itself with no callback target).
    """
    platform_slug = platform.strip().lower()
    link_url: str | None = None

    # account-app hosts a tiny bounce page that fires liquidclips:// deep
    # link to the running desktop. Falls through silently if the account
    # host isn't reachable — JWT path still works, just no auto-close.
    redirect_target = None
    if channel_id:
        account_host = os.environ.get("ACCOUNT_SITE_URL", "https://account.jnremployee.com").rstrip("/")
        redirect_target = f"{account_host}/channel-linked?cid={channel_id}"

    try:
        jwt_response = ayrshare.generate_jwt(
            profile_key,
            allowed_social=[platform_slug],
            redirect=redirect_target,
        )
        url_from_jwt = (jwt_response or {}).get("url")
        if isinstance(url_from_jwt, str) and url_from_jwt:
            link_url = url_from_jwt
    except httpx.HTTPError as exc:
        log.warning("[channels] generateJWT HTTP failed for %s, falling back: %s", platform_slug, exc)
    except RuntimeError as exc:
        # Captures both the missing-env-var case AND the new `code:188`
        # JSON-error case (where Ayrshare returns HTTP 200 with status:error).
        log.warning("[channels] generateJWT runtime error for %s, falling back: %s", platform_slug, exc)
    except Exception:  # noqa: BLE001 — linking should degrade to the fallback URL
        log.exception("[channels] generateJWT raised unexpectedly, falling back")

    if link_url:
        return link_url
    # v0.7.x harden: Ayrshare's 2026 hosted-link endpoint expects `platform=`
    # (singular) AND a `redirect=` param for TikTok (its age-gate refuses to
    # complete OAuth without one). Was `platforms=` (plural) + no redirect.
    parts = [f"profileKey={profile_key}", f"platform={platform_slug}"]
    if redirect_target:
        from urllib.parse import quote
        parts.append(f"redirect={quote(redirect_target, safe='')}")
    return f"{_ayrshare_link_domain()}/social-accounts?" + "&".join(parts)


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
    pk_prefix = (profile_key or "")[:8]
    log.info(
        "[channels] _fetch_handle_from_ayrshare start profile_key_prefix=%s platform=%s",
        pk_prefix, platform,
    )
    try:
        with httpx.Client(timeout=ayrshare.DEFAULT_TIMEOUT) as client:
            r = client.get(
                f"{ayrshare.AYRSHARE_BASE}/user",
                headers=ayrshare._headers(profile_key),
            )
        if r.status_code != 200:
            log.warning(
                "[channels] _fetch_handle_from_ayrshare http_status=%s profile_key_prefix=%s platform=%s",
                r.status_code, pk_prefix, platform,
            )
            return None, "error"
        body = r.json()
        # Ayrshare's /user returns `displayNames` (preferred) or
        # `activeSocialAccounts`. Try a few shapes.
        display_names = body.get("displayNames") or {}
        if isinstance(display_names, dict) and platform in display_names:
            handle = str(display_names[platform])
            log.info(
                "[channels] _fetch_handle_from_ayrshare end profile_key_prefix=%s platform=%s handle=%s status=active source=displayNames",
                pk_prefix, platform, handle,
            )
            return handle, "active"
        active = body.get("activeSocialAccounts") or []
        # v0.7.x fix: strict platform check. Previously any non-empty dict
        # for SOME OTHER platform (e.g. {"instagram": "@x"}) flipped status
        # to active with handle=None, then publish-time failed because the
        # REQUESTED platform wasn't linked. Now status="active" requires the
        # specific platform to actually appear in displayNames OR in
        # activeSocialAccounts. Anything else is pending_link.
        if isinstance(active, dict):
            handle = active.get(platform)
            if handle:
                log.info(
                    "[channels] _fetch_handle_from_ayrshare end profile_key_prefix=%s platform=%s handle=%s status=active source=activeSocialAccounts.dict",
                    pk_prefix, platform, str(handle),
                )
                return str(handle), "active"
            # Wrong-platform dict — do NOT mark active.
            log.info(
                "[channels] _fetch_handle_from_ayrshare end profile_key_prefix=%s platform=%s handle=None status=pending_link source=activeSocialAccounts.dict.other_platforms",
                pk_prefix, platform,
            )
            return None, "pending_link"
        if isinstance(active, list):
            status_str = "active" if platform in [str(p).lower() for p in active] else "pending_link"
            log.info(
                "[channels] _fetch_handle_from_ayrshare end profile_key_prefix=%s platform=%s handle=None status=%s source=activeSocialAccounts.list",
                pk_prefix, platform, status_str,
            )
            return None, status_str
        log.info(
            "[channels] _fetch_handle_from_ayrshare end profile_key_prefix=%s platform=%s handle=None status=pending_link source=fallback",
            pk_prefix, platform,
        )
        return None, "pending_link"
    except Exception as exc:  # noqa: BLE001
        log.exception(
            "[channels] _fetch_handle_from_ayrshare hard fail profile_key_prefix=%s platform=%s",
            pk_prefix, platform,
        )
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
    # Pre-check the reuse branch so the start log shows "existing? yes/no".
    pre_existing = (
        db.query(SocialChannel)
        .filter(SocialChannel.user_id == user.id)
        .filter(SocialChannel.platform == body.platform)
        .filter(SocialChannel.status != "deleted")
        .order_by(SocialChannel.created_at.asc())
        .first()
    )
    log.info(
        "[channels] create_channel start platform=%s user_id=%s existing=%s",
        body.platform, user.id, "yes" if pre_existing is not None else "no",
    )

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

    # IDEMPOTENT REUSE — every "Link TikTok" click on a clip card used to
    # provision a brand-new Ayrshare sub-profile bound to an empty
    # profile_key, orphaning whatever the user actually linked. Reuse
    # any existing non-deleted row for the same (user, platform) so the
    # second click resumes the same OAuth flow instead of spawning a new
    # empty profile. Old clients automatically benefit because the path
    # is server-side.
    existing_for_platform = pre_existing
    if existing_for_platform is not None:
        log.info(
            "[channels] create_channel reuse-existing channel_id=%s status=%s platform=%s user_id=%s",
            existing_for_platform.id, existing_for_platform.status, existing_for_platform.platform, user.id,
        )
        link_url = _build_platform_link_url(
            existing_for_platform.ayrshare_profile_key,
            existing_for_platform.platform,
            channel_id=existing_for_platform.id,
        )
        # Tick link_attempts + stamp probe — every reuse is a fresh OAuth try.
        existing_for_platform.link_attempts = int(existing_for_platform.link_attempts or 0) + 1
        existing_for_platform.last_probe_at = datetime.now(timezone.utc)
        existing_for_platform.last_probe_error = None
        db.commit()
        db.refresh(existing_for_platform)
        pk_prefix = (existing_for_platform.ayrshare_profile_key or "")[:8]
        log.info(
            "[channels] create_channel end (reuse) channel_id=%s profile_key_prefix=%s link_url_len=%d link_attempts=%d",
            existing_for_platform.id, pk_prefix, len(link_url or ""), existing_for_platform.link_attempts,
        )
        return ChannelCreateResponse(
            channel=_to_response(existing_for_platform),
            link_url=link_url,
        )

    # Tier cap — counts all non-deleted channels across platforms.
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
        last_probe_at=datetime.now(timezone.utc),
        last_probe_error=None,
        link_attempts=1,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    # Build a platform-specific link. This keeps the Schedule v2 channel flow
    # direct: picking Instagram lands on Instagram/Meta linking, not a generic
    # Ayrshare social picker. channel_id threads through so the redirect on
    # successful OAuth fires the right deep link.
    link_url = _build_platform_link_url(profile_key, body.platform, channel_id=row.id)

    pk_prefix = (profile_key or "")[:8]
    log.info(
        "[channels] create_channel end channel_id=%s profile_key_prefix=%s link_url_len=%d link_attempts=%d",
        row.id, pk_prefix, len(link_url or ""), row.link_attempts,
    )

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
    prev_status = row.status
    prev_handle = row.handle
    log.info(
        "[channels] refresh_channel start channel_id=%s current_status=%s last_refreshed_at=%s",
        channel_id, prev_status,
        row.last_refreshed_at.isoformat() if row.last_refreshed_at else None,
    )
    handle, status_str = _fetch_handle_from_ayrshare(row.ayrshare_profile_key, row.platform)
    row.handle = handle or row.handle
    if status_str:
        # Preserve a manual 'paused' state — only flip auto on/off.
        if row.status not in ("paused", "deleted"):
            row.status = status_str
    now = datetime.now(timezone.utc)
    row.last_refreshed_at = now
    row.last_probe_at = now
    # status_str == "error" means the Ayrshare probe itself failed; record a
    # short marker so the observability table can show drift. On success clear.
    if status_str == "error":
        row.last_probe_error = "ayrshare_user_probe_failed"
        log.warning(
            "[channels] refresh_channel ayrshare probe error channel_id=%s",
            channel_id,
        )
    else:
        row.last_probe_error = None
    db.commit()
    db.refresh(row)
    # Transition direction — what changed from this refresh.
    if prev_status != row.status:
        direction = f"{prev_status}->{row.status}"
    elif (prev_handle or None) != (row.handle or None):
        direction = "handle_changed"
    else:
        direction = "no_change"
    log.info(
        "[channels] refresh_channel end channel_id=%s new_status=%s handle=%s transition=%s",
        channel_id, row.status, row.handle, direction,
    )
    return _to_response(row)


class RelinkResponse(BaseModel):
    link_url: str
    # Returning the row lets the desktop re-seed its in-memory state in one
    # round-trip — previously InlineScheduler had to call refresh after
    # relink, doubling the network cost on every "I finished — recheck."
    channel: ChannelResponse


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
    pk_prefix = (row.ayrshare_profile_key or "")[:8]
    log.info(
        "[channels] relink_channel start channel_id=%s profile_key_prefix=%s",
        channel_id, pk_prefix,
    )
    link_url = _build_platform_link_url(row.ayrshare_profile_key, row.platform, channel_id=row.id)
    # Bump observability columns — relink == fresh OAuth attempt.
    row.link_attempts = int(row.link_attempts or 0) + 1
    row.last_probe_at = datetime.now(timezone.utc)
    row.last_probe_error = None
    db.commit()
    db.refresh(row)
    log.info(
        "[channels] relink_channel end channel_id=%s profile_key_prefix=%s link_url_len=%d link_attempts=%d",
        channel_id, pk_prefix, len(link_url or ""), row.link_attempts,
    )
    return RelinkResponse(
        link_url=link_url,
        channel=_to_response(row),
    )


# ── Admin diagnostics ──────────────────────────────────────────────────


_DIAGNOSE_RAW_MAX = 4000  # cap raw Ayrshare payload at 4k chars for the JSON response


def _serialize_channel_row(row: SocialChannel) -> dict[str, object | None]:
    """Full DB-truth snapshot of a SocialChannel, including the observability
    columns (last_probe_at / last_probe_error / link_attempts) that the public
    ChannelResponse hides."""
    return {
        "id": row.id,
        "user_id": row.user_id,
        "label": row.label,
        "platform": row.platform,
        "ayrshare_profile_key": row.ayrshare_profile_key,
        "ayrshare_ref_id": row.ayrshare_ref_id,
        "handle": row.handle,
        "status": row.status,
        "total_posts": int(row.total_posts or 0),
        "link_attempts": int(row.link_attempts or 0),
        "last_refreshed_at": row.last_refreshed_at.isoformat() if row.last_refreshed_at else None,
        "last_probe_at": row.last_probe_at.isoformat() if row.last_probe_at else None,
        "last_probe_error": row.last_probe_error,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _ayrshare_platforms_linked(raw: dict | None, expected_platform: str) -> list[dict[str, str | None]]:
    """Pull a (platform, handle, status) list out of Ayrshare's /user-style
    response. Tolerant of both `displayNames`/`activeSocialAccounts` shapes
    so diagnostics keep working even if Ayrshare swaps payload keys mid-rollout."""
    if not isinstance(raw, dict):
        return []
    out: list[dict[str, str | None]] = []
    display_names = raw.get("displayNames") or {}
    active = raw.get("activeSocialAccounts") or []
    if isinstance(active, list):
        active_set = {str(p).lower() for p in active}
    elif isinstance(active, dict):
        active_set = {str(k).lower() for k in active.keys()}
    else:
        active_set = set()
    if isinstance(display_names, dict) and display_names:
        for platform, handle in display_names.items():
            p = str(platform).lower()
            out.append({
                "platform": p,
                "handle": str(handle) if handle is not None else None,
                "status": "active" if p in active_set or display_names.get(platform) else "linked",
            })
    # Surface platforms that are active but missing a display name (rare,
    # happens transiently while Ayrshare backfills the handle).
    for p in active_set:
        if not any(entry["platform"] == p for entry in out):
            out.append({"platform": p, "handle": None, "status": "active"})
    return out


def _recommend_action(channel_status: str, ayrshare_platforms: list[dict[str, str | None]], expected_platform: str, profile_found: bool) -> str:
    """One-line, human-readable recommendation. The diagnose endpoint exists
    so a human (Daniel) or an automated probe can decide what to do next; this
    string is the headline. Order matters — first match wins."""
    if not profile_found:
        return f"recreate_profile — Ayrshare has no profile for key (channel.status={channel_status})"
    expected = expected_platform.lower()
    matching = [p for p in ayrshare_platforms if p.get("platform") == expected]
    if not ayrshare_platforms:
        return f"relink — Ayrshare profile exists but no platforms linked (channel.status={channel_status})"
    if not matching:
        linked = ",".join(sorted({str(p.get("platform")) for p in ayrshare_platforms}))
        return f"relink — expected {expected} not in Ayrshare-linked platforms [{linked}]"
    if channel_status == "pending_link" and matching:
        return "refresh_channel — handle visible on Ayrshare but DB stale"
    if channel_status in ("error",) and matching:
        return "refresh_channel — Ayrshare reports linked; clear stale error in DB"
    if channel_status == "active" and matching:
        return "ok — DB and Ayrshare agree"
    return f"investigate — channel.status={channel_status}, ayrshare_linked={bool(matching)}"


class ChannelDiagnoseResponse(BaseModel):
    channel: dict
    ayrshare: dict
    last_10_webhooks: list[dict]
    recommended_action: str


@admin_router.post("/{channel_id}/diagnose", response_model=ChannelDiagnoseResponse)
def diagnose_channel(
    channel_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ChannelDiagnoseResponse:
    """Full-state probe of a single channel for admin debugging.

    Returns the DB row, the latest Ayrshare response (raw, truncated), the
    last 10 Ayrshare webhooks matched to this profile, and a one-line
    recommended next action. Side-effect: stamps `last_probe_at` /
    `last_probe_error` on the channel so successive diagnose calls show
    "when was this last checked".
    """
    row = db.get(SocialChannel, channel_id)
    if not row or row.status == "deleted":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "channel not found")

    # Authorization: caller is admin OR caller owns the channel. We accept
    # owner so a non-admin support user can still self-diagnose their own
    # channel from the same endpoint — useful for the desktop "Why isn't my
    # channel linking?" panel.
    caller_is_admin = is_admin_email(user.email)
    if not caller_is_admin and row.user_id != user.id:
        # Same 404 for non-owner non-admins so we don't leak channel existence
        raise HTTPException(status.HTTP_404_NOT_FOUND, "channel not found")

    profile_key = row.ayrshare_profile_key
    ayrshare_block: dict[str, object] = {
        "profile_found": False,
        "platforms_linked": [],
        "raw_response": None,
    }
    probe_error: str | None = None

    # 1) Hit Ayrshare. Prefer /user (cheap, returns the linked-platform map).
    #    Fall back to history() if /user errors — at least we'll see something.
    raw_body: dict | None = None
    try:
        with httpx.Client(timeout=ayrshare.DEFAULT_TIMEOUT) as client:
            r = client.get(
                f"{ayrshare.AYRSHARE_BASE}/user",
                headers=ayrshare._headers(profile_key),
            )
        if r.status_code == 200:
            raw_body = r.json() if r.content else {}
            ayrshare_block["profile_found"] = True
        elif r.status_code in (401, 403, 404):
            raw_body = {"status_code": r.status_code, "body": r.text[:1000]}
            ayrshare_block["profile_found"] = False
            probe_error = f"ayrshare /user returned {r.status_code}"
        else:
            raw_body = {"status_code": r.status_code, "body": r.text[:1000]}
            probe_error = f"ayrshare /user returned {r.status_code}"
    except Exception as exc:  # noqa: BLE001 — diagnostics must never 500
        log.exception("[channels] diagnose: ayrshare /user failed channel_id=%s", channel_id)
        probe_error = f"ayrshare /user exception: {type(exc).__name__}: {exc}"[:300]

    # Fallback to history() if /user wasn't useful — still gives us a signal
    # that the profile is alive on Ayrshare's side.
    if raw_body is None or (isinstance(raw_body, dict) and "status_code" in raw_body and raw_body.get("status_code") != 200):
        try:
            hist = ayrshare.history(profile_key, last_records=5)
            if raw_body is None:
                raw_body = {"history": hist}
            else:
                raw_body["history"] = hist
            ayrshare_block["profile_found"] = ayrshare_block["profile_found"] or True
        except Exception as exc:  # noqa: BLE001
            log.exception("[channels] diagnose: ayrshare.history failed channel_id=%s", channel_id)
            if probe_error is None:
                probe_error = f"ayrshare.history exception: {type(exc).__name__}: {exc}"[:300]

    ayrshare_block["platforms_linked"] = _ayrshare_platforms_linked(raw_body, row.platform)

    # Truncate raw_response to 4k chars so a huge Ayrshare blob never blows
    # up the diagnose JSON. We serialize then slice — keeps it deterministic.
    if raw_body is not None:
        try:
            import json as _json
            raw_str = _json.dumps(raw_body, default=str)
        except Exception:  # noqa: BLE001
            raw_str = str(raw_body)
        ayrshare_block["raw_response"] = raw_str[:_DIAGNOSE_RAW_MAX]
    else:
        ayrshare_block["raw_response"] = None

    # 2) Last 10 Ayrshare webhooks tied to this profile. WebhookEvent only
    #    stores provider/external_id/event_type/received_at/body_hash today
    #    (no raw payload column), so we match on provider="ayrshare" and use
    #    the profile_key prefix as a heuristic on external_id when possible.
    #    Falls back to "last 10 ayrshare webhooks overall" if no key match.
    pk_prefix = (profile_key or "")[:8]
    wh_query = db.query(WebhookEvent).filter(WebhookEvent.provider == "ayrshare")
    if pk_prefix:
        wh_query_pk = wh_query.filter(WebhookEvent.external_id.like(f"%{pk_prefix}%"))
        wh_rows = wh_query_pk.order_by(WebhookEvent.received_at.desc()).limit(10).all()
        if not wh_rows:
            wh_rows = wh_query.order_by(WebhookEvent.received_at.desc()).limit(10).all()
    else:
        wh_rows = wh_query.order_by(WebhookEvent.received_at.desc()).limit(10).all()

    last_10: list[dict] = [
        {
            "received_at": w.received_at.isoformat() if w.received_at else None,
            "event_type": w.event_type,
            "status": "received",          # WebhookEvent has no status column today
            "processing_ms": None,         # not currently captured per-event
            "signature_ok": True,          # only signature-valid events get logged
            "error": None,                 # WebhookEvent has no error column today
            "external_id": w.external_id,
        }
        for w in wh_rows
    ]

    # 3) Recommendation
    recommended = _recommend_action(
        channel_status=row.status,
        ayrshare_platforms=ayrshare_block["platforms_linked"],  # type: ignore[arg-type]
        expected_platform=row.platform,
        profile_found=bool(ayrshare_block["profile_found"]),
    )

    # 4) Side-effect: stamp last_probe_at / last_probe_error
    try:
        row.last_probe_at = datetime.now(timezone.utc)
        row.last_probe_error = probe_error
        db.commit()
        db.refresh(row)
    except Exception:  # noqa: BLE001
        log.exception("[channels] diagnose: failed to stamp last_probe_at channel_id=%s", channel_id)
        db.rollback()

    log.info(
        "[channels] diagnose channel_id=%s caller=%s admin=%s profile_found=%s linked=%d recommendation=%s",
        channel_id,
        user.id,
        caller_is_admin,
        ayrshare_block["profile_found"],
        len(ayrshare_block["platforms_linked"]),  # type: ignore[arg-type]
        recommended,
    )

    return ChannelDiagnoseResponse(
        channel=_serialize_channel_row(row),
        ayrshare=ayrshare_block,
        last_10_webhooks=last_10,
        recommended_action=recommended,
    )
