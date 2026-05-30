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
    if not platforms:
        # Profile key was rejected by Ayrshare OR has zero linked accounts.
        # Either way the user needs to fix something before we save it.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "We couldn't find any linked platforms on that profile key. "
            "Link an account on your Ayrshare dashboard, then try again.",
        )

    row = db.get(SocialConnection, user.id)
    if row:
        row.ayrshare_profile_key = key
        row.connected_platforms = platforms
        row.active = True
    else:
        row = SocialConnection(
            user_id=user.id,
            ayrshare_profile_key=key,
            connected_platforms=platforms,
            active=True,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return _state_from_row(row)


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
