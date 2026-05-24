"""GET /me — canonical "who am I" debug endpoint.

The desktop Settings panel and account-app dashboard both call this to
answer the question "what does Junior actually think I am?". Backend is the
source of truth (DB + admin-override logic), not Clerk's stale metadata.

Anything PII-shaped (email) is returned because the caller already has the
JWT and is asking about themselves. Don't expose this to anyone else.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.features import is_admin_email
from app.models import User

router = APIRouter(prefix="/me", tags=["me"])


class MeResponse(BaseModel):
    # Identity
    backend_user_id: str
    clerk_id: str | None
    email: str | None
    whop_user_id: str | None
    affiliate_id: str | None

    # Tier truth — separates raw DB value from override
    raw_tier: str
    raw_founder: bool
    effective_tier: str
    effective_founder: bool
    admin_override: bool

    # Billing
    subscription_status: str
    billing_provider: str  # "whop" | "clerk"

    # Whop integration auth state — backend doesn't store the desktop's
    # OAuth token (that's keychain-local), but it can confirm whether the
    # backend's own App API Key is configured.
    whop_backend_key_configured: bool


@router.get("", response_model=MeResponse)
def me(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> MeResponse:
    from app.config import get_settings

    is_admin = is_admin_email(user.email)
    # IMPORTANT: current_user() mutates user.tier/founder_flag in-memory for
    # admins (so downstream gates see Autopilot). For /me's whole purpose —
    # showing raw DB truth vs the override — we must re-read the untouched row,
    # otherwise raw_tier would echo the elevated value and the debug panel lies.
    raw = db.get(User, user.id)
    raw_tier = raw.tier if raw else user.tier
    raw_founder = raw.founder_flag if raw else user.founder_flag

    effective_tier = "autopilot" if is_admin else raw_tier
    effective_founder = True if is_admin else raw_founder

    return MeResponse(
        backend_user_id=str(user.id),
        clerk_id=user.clerk_id,
        email=user.email,
        whop_user_id=user.whop_user_id,
        affiliate_id=user.affiliate_id,
        raw_tier=raw_tier,
        raw_founder=raw_founder,
        effective_tier=effective_tier,
        effective_founder=effective_founder,
        admin_override=is_admin,
        subscription_status="admin" if is_admin else (raw.subscription_status if raw else user.subscription_status),
        billing_provider="whop" if user.whop_user_id else "clerk",
        whop_backend_key_configured=bool(get_settings().whop_api_key),
    )
