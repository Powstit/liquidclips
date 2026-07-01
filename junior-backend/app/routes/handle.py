"""v2.2.14 · unified user.handle CRUD + public resolution.

Two endpoints:
  · POST /me/handle          · authed rename (writes user.handle)
  · GET  /link-resolve/{h}   · unauthed lookup used by the marketing
                                site's /join/[handle] redirect

Handle rules (mirror app.handle_backfill):
  · lowercase, alphanumeric + dash + underscore + dot
  · 3-30 chars
  · case-insensitive uniqueness (Postgres LOWER(handle) unique index)
  · reserved handles (system-bot, admin, staff, mod, root, whop,
    liquidclips) refused so no user can impersonate the bot / staff
    badges surfaced in chat
"""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.handle_backfill import (
    _HANDLE_MAX_LEN,
    _HANDLE_MIN_LEN,
    _SAFE_HANDLE_CHARS,
)
from app.models import User

router = APIRouter(tags=["handle"])

# Reserved names that must never map to a real user. Includes the
# system-bot id (chat welcome-bot), badge role words (users could
# impersonate by taking those handles), and brand terms.
_RESERVED_HANDLES = {
    "system-bot",
    "admin",
    "staff",
    "mod",
    "root",
    "founder",
    "whop",
    "liquid",
    "liquidclips",
    "liquid-clips",
    "kade",
    "support",
    "help",
    "billing",
    "hq",
}


def _validate_handle(raw: str) -> str:
    """Normalise + validate. Raises 400 if the input can't be a handle.
    Mirrors the backfill rules so a manually-picked handle can never
    clash shape-wise with a backfilled one."""
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "handle_required")
    lower = raw.strip().lower()
    cleaned = _SAFE_HANDLE_CHARS.sub("", lower).strip("-._")
    if len(cleaned) < _HANDLE_MIN_LEN:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"handle_too_short · min {_HANDLE_MIN_LEN} chars after cleanup",
        )
    if len(cleaned) > _HANDLE_MAX_LEN:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"handle_too_long · max {_HANDLE_MAX_LEN} chars",
        )
    if cleaned in _RESERVED_HANDLES:
        raise HTTPException(status.HTTP_409_CONFLICT, "handle_reserved")
    return cleaned


class HandlePayload(BaseModel):
    handle: str = Field(..., min_length=1, max_length=60)


class HandleOut(BaseModel):
    handle: str
    share_url: str


@router.post("/me/handle", response_model=HandleOut)
def set_handle(
    payload: HandlePayload,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> HandleOut:
    """Set or rename the caller's unified handle."""
    normalised = _validate_handle(payload.handle)

    # Case-insensitive uniqueness. Reuse the LOWER(handle) unique index
    # by querying with ilike.
    existing = (
        db.query(User)
        .filter(User.id != user.id)
        .filter(User.handle.ilike(normalised))
        .limit(1)
        .one_or_none()
    )
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "handle_taken")

    user.handle = normalised
    db.commit()
    return HandleOut(
        handle=normalised,
        share_url=f"https://liquidclips.app/join/{normalised}",
    )


class LinkResolveOut(BaseModel):
    """Response shape for the marketing /join/[handle] redirect. The
    marketing route consumes only affiliate_code — the extra fields
    are here so a future analytics or attribution surface can grow
    without a version bump."""

    handle: str
    affiliate_code: str | None
    checkout_url: str


@router.get("/link-resolve/{handle}", response_model=LinkResolveOut)
def resolve_link(
    handle: str,
    db: Annotated[Session, Depends(get_db)],
) -> LinkResolveOut:
    """Public lookup for marketing site. Returns the target user's real
    Whop affiliate code so /join/<handle> can 302 to Whop's checkout
    with correct attribution. If the handle exists but the user has no
    Whop affiliate code yet (they haven't connected Whop), we still
    return 200 with affiliate_code=null so the marketing site can 302
    to the plain checkout without breaking the flow."""
    if not re.match(r"^[a-z0-9._-]{2,60}$", handle.lower()):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "handle_not_found")
    user = (
        db.query(User)
        .filter(User.handle.ilike(handle))
        .one_or_none()
    )
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "handle_not_found")

    aff = user.whop_affiliate_code or user.whop_affiliate_id or None
    checkout_base = "https://account.liquidclips.app/checkout"
    checkout_url = f"{checkout_base}?a={aff}" if aff else checkout_base
    return LinkResolveOut(
        handle=user.handle or handle,
        affiliate_code=aff,
        checkout_url=checkout_url,
    )
