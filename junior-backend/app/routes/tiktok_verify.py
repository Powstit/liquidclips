"""TikTok handle verification for the Partner Engine ($10 RPM dedicated-
channel gate + one of the two Partner unlock conditions).

Two-step flow:

  1. POST /me/tiktok/start { "handle": "..." }
     → server generates a short verification code, stores handle + code on
       the user row, returns the code. The user puts the code in their
       TikTok bio.

  2. POST /me/tiktok/confirm
     → MVP: trust the user click ("I pasted it"). Sets
       tiktok_verified_at = now() and immediately attempts the Partner
       unlock check (the second condition is referred_paid_subs >= 10).
       LATER: scrape the bio server-side; until then the admin queue
       is the policing layer.

License-JWT-gated like every other /me/* route. The user's identity is
resolved by app.deps.current_user.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.models import User

router = APIRouter(prefix="/me/tiktok", tags=["tiktok-verify"])

# Short, unambiguous code — readable in a TikTok bio. Avoid 0/O/1/I.
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_CODE_LEN = 6


def _generate_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LEN))


def _normalize_handle(raw: str) -> str:
    """Strip `@`, whitespace, and any tiktok.com URL prefix the user might
    paste. Lowercase to match TikTok's case-insensitive handles."""
    h = raw.strip()
    if h.startswith("http"):
        # tiktok.com/@username[/...] → username
        tail = h.rsplit("/@", 1)[-1] if "/@" in h else h.rsplit("/", 1)[-1]
        h = tail.split("?", 1)[0].split("/", 1)[0]
    return h.lstrip("@").lower()


class StartRequest(BaseModel):
    handle: str = Field(min_length=2, max_length=40)


class StartResponse(BaseModel):
    handle: str
    verification_code: str
    instructions: str


class ConfirmResponse(BaseModel):
    verified: bool
    handle: str
    partner_unlocked: bool
    referred_paid_subs: int
    paid_subs_needed: int


@router.post("/start", response_model=StartResponse)
def start_verification(
    body: StartRequest,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> StartResponse:
    """Begin verification: persist handle + a fresh 6-char code, return the
    code so the dashboard can render the "paste this in your bio" prompt.

    Re-calling /start resets the code (a user fixing a typo on the handle).
    Verification timestamp is NOT cleared — re-verification of a different
    handle requires admin intervention to avoid a malicious churn loop.
    """
    handle = _normalize_handle(body.handle)
    if not handle or not all(c.isalnum() or c in "._-" for c in handle):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid tiktok handle")

    if user.tiktok_verified_at and user.tiktok_handle and user.tiktok_handle != handle:
        # Already verified a DIFFERENT handle. Block silently — admin must
        # reset. Closes the dedicated-account dupe / sock-puppet vector.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "a different tiktok handle is already verified on this account",
        )

    code = _generate_code()
    user.tiktok_handle = handle
    user.tiktok_verification_code = code
    db.commit()

    return StartResponse(
        handle=handle,
        verification_code=code,
        instructions=(
            f"Open TikTok, edit your bio, and add this code anywhere in it: {code}. "
            "Save the bio, then come back and tap 'I pasted it'."
        ),
    )


@router.post("/confirm", response_model=ConfirmResponse)
def confirm_verification(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ConfirmResponse:
    """Confirm verification — MVP trusts the click. Sets tiktok_verified_at
    and runs the Partner unlock check (the second condition is
    referred_paid_subs >= 10; step 6 owns the actual override POST).

    Idempotent: re-confirming a verified handle returns the same payload
    without re-stamping the timestamp.
    """
    if not user.tiktok_handle or not user.tiktok_verification_code:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "no verification in progress — call /me/tiktok/start first",
        )

    if not user.tiktok_verified_at:
        user.tiktok_verified_at = datetime.now(timezone.utc)
        # Verification code stays on the row for admin spot-checks. Clear it
        # only on a future "reset" path so support can confirm the original
        # code matched what the user posted.
        db.commit()

    # Partner Engine — try to unlock. Both conditions are met iff TikTok is
    # verified AND referred_paid_subs >= 10. Service is idempotent + safe
    # when no Whop override endpoint is configured (PARTNER_UNLOCK_LIVE=false).
    from app.services.partner_unlock import try_unlock_partner, PAID_REFERRAL_THRESHOLD
    try_unlock_partner(db, user)

    return ConfirmResponse(
        verified=True,
        handle=user.tiktok_handle,
        partner_unlocked=bool(user.partner_unlocked_at),
        referred_paid_subs=user.referred_paid_subs or 0,
        paid_subs_needed=PAID_REFERRAL_THRESHOLD,
    )
