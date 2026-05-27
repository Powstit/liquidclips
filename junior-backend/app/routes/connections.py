"""Customer-facing 'connections' API. The word 'Postiz' never appears in any
response body — to the desktop and to the customer this looks like Junior
managing per-platform OAuth itself.

Endpoints:
  POST /oauth/postiz/start              - returns the consent URL to redirect to
  GET  /oauth/postiz/callback           - Postiz hits this after the user authorises
  GET  /connections                     - list connected platforms for the user
  POST /connections/{platform}/connect  - kick off a per-platform OAuth (YT/TT/IG/X)
  DELETE /connections/{integration_id}  - disconnect a platform

Tier gating happens in `_assert_can_connect` — Free users get 402 with an
upgrade copy, Solo gets a 2-account cap, Growth gets 4, Autopilot unlimited.
"""

from __future__ import annotations

import secrets
import time
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import postiz
from app.db import get_db
from app.deps import current_user
from app.features import feature_value, has_feature
from app.models import PostizConnection, User

router = APIRouter(tags=["connections"])

# Junior's stable platform IDs (what the desktop sends + what we expose
# externally). Maps onto Postiz's `__type` strings via postiz.py.
JuniorPlatform = Literal["youtube", "tiktok", "instagram", "x"]
PLATFORM_LABELS: dict[str, str] = {
    "youtube": "YouTube",
    "tiktok": "TikTok",
    "instagram": "Instagram",
    "x": "X",
}


class PlatformConnection(BaseModel):
    """What the desktop sees per connected account. Postiz IDs are surfaced
    so the desktop can pick a specific account when a user has multiple."""

    integration_id: str
    platform: JuniorPlatform
    label: str             # platform display name ("YouTube")
    account_handle: str    # what the customer sees ("@youraccount")
    disabled: bool


class ConnectionsListResponse(BaseModel):
    connections: list[PlatformConnection]
    connection_count: int
    max_connections: int | None  # None = unlimited
    can_connect_more: bool


class StartOAuthResponse(BaseModel):
    redirect_url: str
    state: str


# -- in-memory state store ----------------------------------------------
# The OAuth `state` parameter is held briefly between /start and /callback so
# we can verify CSRF. In production this would be Redis; for v1 a dict is fine.
# Each entry is (user_id, expires_at_unix). Abandoned consent flows would
# otherwise leak forever — sweep stale entries on every insert.
_OAUTH_STATE_TTL_SECONDS = 600  # 10 minutes covers slow consent screens.
_OAUTH_STATE_TO_USER: dict[str, tuple[str, float]] = {}


def _store_oauth_state(state: str, user_id: str) -> None:
    now = time.time()
    # Opportunistic sweep — cheap and bounds memory without a background task.
    for k in [k for k, (_, exp) in _OAUTH_STATE_TO_USER.items() if exp <= now]:
        _OAUTH_STATE_TO_USER.pop(k, None)
    _OAUTH_STATE_TO_USER[state] = (user_id, now + _OAUTH_STATE_TTL_SECONDS)


def _consume_oauth_state(state: str) -> str | None:
    entry = _OAUTH_STATE_TO_USER.pop(state, None)
    if not entry:
        return None
    user_id, expires_at = entry
    if expires_at <= time.time():
        return None
    return user_id


def _assert_can_connect(user: User) -> int | None:
    """Tier gate for connect operations. Returns the max-connections cap
    (None = unlimited). Raises 402 if the user can't connect at all."""
    if not has_feature(user.tier, "platform_connections_max", founder=user.founder_flag):
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            "Connecting a platform requires Solo, Growth, Autopilot, or Founder.",
        )
    max_v = feature_value(user.tier, "platform_connections_max", founder=user.founder_flag)
    return max_v if isinstance(max_v, int) else None  # None = unlimited


def _platform_id_from_postiz(provider: str) -> JuniorPlatform | None:
    """Postiz uses provider strings like 'youtube' / 'instagram-standalone'
    / 'instagram' — collapse to Junior's stable platform IDs."""
    if provider in ("youtube", "tiktok", "x"):
        return provider  # type: ignore[return-value]
    if provider in ("instagram", "instagram-standalone"):
        return "instagram"
    return None


@router.post("/oauth/postiz/start", response_model=StartOAuthResponse)
def start_oauth(
    user: Annotated[User, Depends(current_user)],
) -> StartOAuthResponse:
    """Customer clicked 'Connect [platform]' for the first time and we don't
    yet have a pos_* token for them. Returns the consent URL the desktop
    should open in a browser tab. After the user authorises, Postiz redirects
    them to /oauth/postiz/callback below."""
    _assert_can_connect(user)
    state = secrets.token_urlsafe(24)
    _store_oauth_state(state, user.id)
    return StartOAuthResponse(
        redirect_url=postiz.authorize_url(state),
        state=state,
    )


@router.get("/oauth/postiz/callback")
async def oauth_callback(
    db: Annotated[Session, Depends(get_db)],
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
):
    """Postiz redirects here after the consent screen. We exchange the code
    for a pos_* token + persist it under the user's row. Then we redirect
    back into the desktop app via a deep link.

    On error or denied consent we redirect with an `error` query param so
    the desktop shows a clear message."""
    if not state:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "missing state")
    user_id = _consume_oauth_state(state)
    if not user_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown or expired state")

    if error or not code:
        return RedirectResponse(
            url=f"junior://oauth-result?status=denied&reason={error or 'no_code'}",
            status_code=302,
        )

    try:
        token_payload = await postiz.exchange_code(code)
    except Exception as exc:  # noqa: BLE001
        return RedirectResponse(
            url=f"junior://oauth-result?status=error&reason=exchange_failed",
            status_code=302,
        )

    existing = db.get(PostizConnection, user_id)
    if existing:
        existing.postiz_org_id = token_payload["id"]
        existing.postiz_stripe_cus = token_payload.get("cus")
        existing.access_token = token_payload["access_token"]
        existing.active = True
    else:
        db.add(PostizConnection(
            user_id=user_id,
            postiz_org_id=token_payload["id"],
            postiz_stripe_cus=token_payload.get("cus"),
            access_token=token_payload["access_token"],
            active=True,
        ))
    db.commit()

    return RedirectResponse(url="junior://oauth-result?status=connected", status_code=302)


@router.get("/connections", response_model=ConnectionsListResponse)
async def list_connections(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ConnectionsListResponse:
    """The desktop's source of truth for 'which platforms is this user
    connected to.' Fetches the live list from Postiz under the user's token —
    never trusts a local cache because a user can disconnect from Postiz's
    own UI (we treat that as authoritative)."""
    max_v = feature_value(user.tier, "platform_connections_max", founder=user.founder_flag)
    max_count = max_v if isinstance(max_v, int) else None

    conn = db.get(PostizConnection, user.id)
    if not conn or not conn.active:
        return ConnectionsListResponse(
            connections=[],
            connection_count=0,
            max_connections=max_count,
            can_connect_more=(max_count is None or max_count > 0) and has_feature(user.tier, "platform_connections_max", founder=user.founder_flag),
        )

    raw = await postiz.list_integrations(conn.access_token)
    mapped: list[PlatformConnection] = []
    for row in raw:
        platform = _platform_id_from_postiz(row.get("providerIdentifier", ""))
        if not platform:
            continue
        mapped.append(PlatformConnection(
            integration_id=row.get("id", ""),
            platform=platform,
            label=PLATFORM_LABELS[platform],
            account_handle=row.get("name") or "(unnamed)",
            disabled=bool(row.get("disabled")),
        ))
    return ConnectionsListResponse(
        connections=mapped,
        connection_count=len(mapped),
        max_connections=max_count,
        can_connect_more=(max_count is None or len(mapped) < max_count),
    )


async def _live_connection_count(db: Session, user: User) -> int:
    """Live count of connections under this user's Postiz identity. We hit
    Postiz instead of trusting a local shadow — user can disconnect from
    Postiz UI and we'd over-count otherwise."""
    conn = db.get(PostizConnection, user.id)
    if not conn or not conn.active:
        return 0
    raw = await postiz.list_integrations(conn.access_token)
    return sum(1 for r in raw if _platform_id_from_postiz(r.get("providerIdentifier", "")))


@router.post("/connections/{platform}/connect", response_model=StartOAuthResponse)
async def connect_platform(
    platform: JuniorPlatform,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> StartOAuthResponse:
    """Adding a new platform (YouTube / TikTok / Instagram / X). The flow is
    identical to the initial /oauth/postiz/start — both return a URL the
    desktop should open. Tier cap is enforced here."""
    max_count = _assert_can_connect(user)

    if max_count is not None:
        current_count = await _live_connection_count(db, user)
        if current_count >= max_count:
            raise HTTPException(
                status.HTTP_402_PAYMENT_REQUIRED,
                f"Your tier allows {max_count} connections. Upgrade to add more.",
            )

    state = secrets.token_urlsafe(24)
    _store_oauth_state(state, user.id)
    return StartOAuthResponse(
        redirect_url=postiz.authorize_url(state),
        state=state,
    )


@router.delete("/connections/{integration_id}", status_code=204)
async def disconnect_platform(
    integration_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Disconnect a single platform. The Postiz identity stays in place (so
    other platforms keep working); only this integration is removed."""
    conn = db.get(PostizConnection, user.id)
    if not conn or not conn.active:
        # Nothing to disconnect — idempotent success.
        return
    await postiz.delete_integration(conn.access_token, integration_id)
