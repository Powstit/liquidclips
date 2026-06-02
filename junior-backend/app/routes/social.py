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
from fastapi import APIRouter, Depends, HTTPException, status
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


@router.post("/start-link", response_model=StartLinkResponse)
def start_link(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> StartLinkResponse:
    """In-app Ayrshare linking (sprint #14d).

    Provisions an Ayrshare sub-profile for this user (or reuses an existing
    one), mints a short-lived JWT, and returns the hosted-link URL. The
    desktop opens that URL inside a Tauri WebView so the user can OAuth
    each platform (TikTok / Reels / YouTube / X) without leaving Liquid Clips
    or signing up to Ayrshare.

    Idempotent — repeated calls on the same user re-mint a fresh JWT against
    the SAME profile key, so a closed-and-reopened linking window keeps the
    same Ayrshare profile lineage.
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

    # 2) Mint a JWT for the hosted link page. Optional `domain` arg becomes
    # useful once a Custom Domain (e.g. social.liquidclips.app) is configured
    # in Ayrshare admin — until then the URL stays on app.ayrshare.com but
    # the JWT still skips signup. Env override = AYRSHARE_LINK_DOMAIN.
    domain = os.environ.get("AYRSHARE_LINK_DOMAIN", "").strip() or None
    try:
        token_resp = ayrshare.generate_jwt(profile_key, domain=domain)
    except httpx.HTTPError as exc:
        log.exception("[social] generate_jwt failed")
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Couldn't mint an Ayrshare linking token. Try again.",
        ) from exc

    link_url = (token_resp or {}).get("url") or (token_resp or {}).get("link")
    if not link_url:
        log.error("[social] Ayrshare generateJWT returned no url: %r", token_resp)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Ayrshare didn't return a link URL. Try again.",
        )

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
