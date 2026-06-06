"""Social-account connection endpoints — P1 (Ayrshare).

Replaces the OAuth-link flow we had drafted for Postiz. Ayrshare's hosted
linking page does the actual OAuth dance (TikTok / YouTube / IG / X /
LinkedIn) on their domain; the user pastes their Profile Key back into
the desktop's Settings → Connections panel.

Routes:
    GET  /social/connections           — current user's connection state
    POST /social/connect               — paste/save profile key, verify via Ayrshare
    POST /social/refresh-platforms     — re-pull connected_platforms from Ayrshare
    DEL  /social/disconnect/{platform} — locally hide a platform (no Ayrshare
                                          revoke; user must unlink on their hosted
                                          dashboard if they want to revoke fully)
"""

from __future__ import annotations

import logging
import os
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import ayrshare
from app.db import get_db
from app.deps import current_user
from app.models import SocialConnection, User

log = logging.getLogger("junior.social")

router = APIRouter(prefix="/social", tags=["social"])


class ConnectionState(BaseModel):
    connected: bool
    profile_key_set: bool
    platforms: list[str]
    active: bool


class ConnectRequest(BaseModel):
    profile_key: str = Field(..., min_length=8, max_length=128)


def _state_from_row(row: SocialConnection | None) -> ConnectionState:
    if not row:
        return ConnectionState(connected=False, profile_key_set=False, platforms=[], active=False)
    return ConnectionState(
        connected=bool(row.active and row.connected_platforms),
        profile_key_set=bool(row.ayrshare_profile_key),
        platforms=list(row.connected_platforms or []),
        active=bool(row.active),
    )


def _fetch_active_platforms(profile_key: str) -> list[str]:
    """Ask Ayrshare which platforms this profile has actively linked. We use
    the /user endpoint scoped to the profile key; the `activeSocialAccounts`
    field on the response is the source of truth.

    Returns an empty list on any error — the caller decides whether to treat
    that as a disconnect or a transient failure."""
    try:
        r = httpx.get(
            f"{ayrshare.AYRSHARE_BASE}/user",
            headers=ayrshare._headers(profile_key),
            timeout=ayrshare.DEFAULT_TIMEOUT,
        )
        r.raise_for_status()
        body = r.json()
        plats = body.get("activeSocialAccounts") or body.get("displayNames") or []
        if isinstance(plats, dict):
            plats = list(plats.keys())
        return [str(p).lower() for p in plats]
    except Exception as exc:  # noqa: BLE001
        log.warning("[social] fetch platforms failed: %s", exc)
        return []


@router.get("/connections", response_model=ConnectionState)
def get_connection(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ConnectionState:
    row = db.get(SocialConnection, user.id)
    return _state_from_row(row)


@router.post("/connect", response_model=ConnectionState)
def connect(
    body: ConnectRequest,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ConnectionState:
    if not ayrshare.is_configured():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Publishing is in beta — Ayrshare isn't configured on the server yet.",
        )
    key = body.profile_key.strip()
    platforms = _fetch_active_platforms(key)
    # We used to 400 here when platforms.length == 0, but that blocks the
    # legitimate "user pastes their valid profile key BEFORE linking accounts"
    # flow — most users paste the key first, then link socials on Ayrshare,
    # then come back and refresh. Save the key with `active=False` and
    # connected_platforms=[] so /social/refresh-platforms can flip it active
    # later when they finish linking on Ayrshare's hosted page.
    #
    # We still validate the key is non-empty + that Ayrshare's reply was
    # parseable (no exception) — _fetch_active_platforms returns [] for both
    # "no platforms yet" and "invalid key", so we can't perfectly distinguish.
    # That's OK: an invalid key just means the user sees zero platforms in
    # PublishModal and tries again. No worse than the previous 400.

    row = db.get(SocialConnection, user.id)
    is_active = bool(platforms)  # active only when ≥1 linked platform
    if row:
        row.ayrshare_profile_key = key
        row.connected_platforms = platforms
        row.active = is_active
    else:
        row = SocialConnection(
            user_id=user.id,
            ayrshare_profile_key=key,
            connected_platforms=platforms,
            active=is_active,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return _state_from_row(row)


class StartLinkResponse(BaseModel):
    link_url: str
    profile_key_set: bool


# Ayrshare's hosted-link page supports a ?platforms=<p> query to deep-link
# the user past the platform-picker straight into a single platform's OAuth.
# We restrict to the four platforms we expose so the URL can never be
# poisoned with random strings from a client.
_ALLOWED_PLATFORM_DEEPLINK = {"youtube", "tiktok", "instagram", "x", "facebook", "linkedin"}


@router.post("/start-link", response_model=StartLinkResponse)
def start_link(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    platform: str | None = Query(
        None,
        description="Optional. When set, the returned URL deep-links the user "
                    "into a single platform's OAuth (skipping Ayrshare's "
                    "platform-picker). 'youtube' | 'tiktok' | 'instagram' | 'x' | "
                    "'facebook' | 'linkedin'.",
    ),
) -> StartLinkResponse:
    """In-app linking — provisions an Ayrshare sub-profile for this user,
    mints a short-lived JWT, and returns a hosted-link URL the desktop opens
    in the user's system browser.

    Two-tier resolution:
      1. generateJWT (clean — no Ayrshare login modal, branding hidden)
      2. profileKey query-param fallback (used when JWT mint fails, e.g.
         the org RSA private key isn't configured in Ayrshare dashboard)

    When `platform` is set, the returned URL is deep-linked into that
    platform's OAuth — Daniel's UX rule: "a 15-year-old clicks YouTube
    and lands on Google sign-in, not on an Ayrshare login modal."
    """
    if not ayrshare.is_configured():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Publishing is in beta — Ayrshare isn't configured on the server yet.",
        )

    row = db.get(SocialConnection, user.id)

    # 1) Reuse existing profile_key when present; otherwise create a fresh
    # one and persist immediately so a backend crash mid-flow doesn't strand
    # an orphan profile on Ayrshare's side.
    if row and row.ayrshare_profile_key:
        profile_key = row.ayrshare_profile_key
    else:
        title = f"{user.email or user.id} · liquidclips"
        try:
            created = ayrshare.create_profile(title=title, email=user.email)
        except httpx.HTTPError as exc:
            log.exception("[social] create_profile failed")
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                "Ayrshare wouldn't provision a profile right now. Try again in a minute.",
            ) from exc
        profile_key = (created or {}).get("profileKey") or (created or {}).get("profile_key")
        if not profile_key:
            log.error("[social] Ayrshare returned no profileKey: %r", created)
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                "Ayrshare returned an unexpected response. Try again.",
            )
        if row:
            row.ayrshare_profile_key = profile_key
        else:
            row = SocialConnection(
                user_id=user.id,
                ayrshare_profile_key=profile_key,
                connected_platforms=[],
                active=False,
            )
            db.add(row)
        db.commit()
        db.refresh(row)

    # 2) Build the hosted-link URL.
    #
    # FIRST try generateJWT — it returns a URL with the JWT embedded so
    # Ayrshare's hosted page skips the login modal entirely (Daniel's
    # 15-year-old test). When the platform arg is set we pass allowedSocial
    # so the hosted linker only renders that one platform.
    #
    # FALLBACK to the profileKey URL if the JWT mint fails — usually
    # because the org RSA private key isn't yet set up in Ayrshare
    # dashboard. The user still gets in, they just see the Ayrshare
    # login modal once.
    #
    # AYRSHARE_LINK_DOMAIN env takes over for a Custom Domain.
    domain = (os.environ.get("AYRSHARE_LINK_DOMAIN", "").strip() or "app.ayrshare.com").rstrip("/")
    if not domain.startswith("http"):
        domain = f"https://{domain}"

    platform_slug: str | None = None
    if platform:
        p = platform.strip().lower()
        if p in _ALLOWED_PLATFORM_DEEPLINK:
            platform_slug = p

    # JWT-based linking via Ayrshare's RSA Integration Package — returns
    # a profile.ayrshare.com URL with no Ayrshare-org branding, no login
    # modal, and (when allowedSocial is set) only the requested platform's
    # tile rendered. This is the "15-year-old test" path.
    link_url: str | None = None
    try:
        allowed = [platform_slug] if platform_slug else None
        jwt_response = ayrshare.generate_jwt(profile_key, allowed_social=allowed)
        url_from_jwt = (jwt_response or {}).get("url")
        if isinstance(url_from_jwt, str) and url_from_jwt:
            link_url = url_from_jwt
    except httpx.HTTPError as exc:
        log.warning("[social] generateJWT failed, falling back to profileKey URL: %s", exc)
    except RuntimeError as exc:
        # AYRSHARE_JWT_PRIVATE_KEY / AYRSHARE_DOMAIN not configured on Railway.
        log.warning("[social] generateJWT prerequisites missing, falling back: %s", exc)
    except Exception:  # noqa: BLE001 — any unexpected failure falls back gracefully
        log.exception("[social] generateJWT raised unexpectedly, falling back")

    if not link_url:
        # Last-resort fallback (org branding visible). Should only fire when
        # Railway env isn't set or Ayrshare returns an outage.
        fallback_url = f"{domain}/social-accounts?profileKey={profile_key}"
        if platform_slug:
            fallback_url += f"&platforms={platform_slug}"
        link_url = fallback_url

    return StartLinkResponse(link_url=link_url, profile_key_set=True)


@router.post("/refresh-platforms", response_model=ConnectionState)
def refresh_platforms(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ConnectionState:
    row = db.get(SocialConnection, user.id)
    if not row or not row.ayrshare_profile_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No social profile connected.")
    platforms = _fetch_active_platforms(row.ayrshare_profile_key)
    row.connected_platforms = platforms
    row.active = bool(platforms)
    db.commit()
    db.refresh(row)
    return _state_from_row(row)


@router.delete("/disconnect/{platform}", response_model=ConnectionState)
def disconnect_platform(
    platform: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ConnectionState:
    """Hide a platform locally. We don't call Ayrshare's revoke — the user has
    to do that on their hosted dashboard. This only stops Junior from
    auto-selecting the platform in PublishModal."""
    row = db.get(SocialConnection, user.id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No social profile connected.")
    plat = platform.strip().lower()
    row.connected_platforms = [p for p in (row.connected_platforms or []) if p != plat]
    row.active = bool(row.connected_platforms)
    db.commit()
    db.refresh(row)
    return _state_from_row(row)
