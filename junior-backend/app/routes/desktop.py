"""Desktop activation + sync endpoints.

The flow (oauth-billing.md §3.4):
1. Desktop opens the user's browser to account.jnremployee.com/connect-desktop
   with a one-time challenge string.
2. That page (authed via Clerk session) POSTs the challenge here.
3. We mint a fresh license JWT for the user's current tier.
4. The browser deep-links back: junior://activate?token=<jwt>&challenge=<...>
5. Desktop verifies the challenge matches what it generated, stores the JWT
   in the OS keychain.

For dev, the Clerk session check accepts the Clerk user ID directly so the
desktop can be tested without standing up the full browser-roundtrip yet.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import current_user
from app.features import is_admin_email
from app.jwt_signer import issue_license_jwt, public_pem
from app.models import License, User
from app.routes.usage import starter_export_remaining

router = APIRouter(prefix="/desktop", tags=["desktop"])


class ConnectRequest(BaseModel):
    # The VERIFIED Clerk user id, injected server-side by account-app's
    # /api/desktop/connect route from the active Clerk session. The browser
    # never reaches this endpoint directly (it lacks the internal secret), so a
    # client can't mint a license for an arbitrary clerk_user_id.
    clerk_user_id: str
    challenge: str       # echoed back in the deep link so desktop can verify


class ConnectResponse(BaseModel):
    license_jwt: str
    expires_at: datetime
    tier: str
    founder: bool
    challenge: str


@router.post("/connect", response_model=ConnectResponse)
def connect_desktop(
    body: ConnectRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> ConnectResponse:
    # Server-to-server only: minting a desktop license is gated by the shared
    # internal secret. Only account-app's /api/desktop/connect (which derives
    # clerk_user_id from a verified Clerk session) holds it. The desktop and the
    # browser must NEVER be able to call this directly with an arbitrary id.
    # Empty secret = local dev (matches updates.py / admin.py convention).
    settings = get_settings()
    if settings.internal_api_secret and request.headers.get("x-internal-secret") != settings.internal_api_secret:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "desktop licenses are minted server-side only")

    user = db.query(User).filter_by(clerk_id=body.clerk_user_id).one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found — sign up first")

    # Apply admin override BEFORE issuing the JWT — otherwise an admin who
    # also happens to be on a free tier gets a free-tier JWT. Founders and
    # master-admins always get Autopilot entitlements.
    is_admin = is_admin_email(user.email)
    effective_tier = "autopilot" if is_admin else user.tier
    effective_founder = True if is_admin else user.founder_flag
    quota = None  # free is export-gated (100 clip exports), not monthly-video-capped

    jwt_str, expires_at = issue_license_jwt(
        user_id=user.id,
        tier=effective_tier,
        founder=effective_founder,
        quota_videos_per_month=quota,
    )
    # Only send the security-style "Junior activated on a new machine" email
    # on the FIRST license for this user. Subsequent auto-rotations from
    # /sync would otherwise spam every 25 days. Trigger before the new
    # License row is added so we can check the prior count cleanly.
    is_first_activation = db.query(License).filter_by(user_id=user.id).count() == 0

    db.add(License(user_id=user.id, jwt=jwt_str, tier_at_issue=effective_tier, expires_at=expires_at))
    db.commit()

    if is_first_activation:
        from app.mailer import send_license_activated
        send_license_activated(user.email)

        # PostHog: this is the desktop install / first-launch funnel point.
        # Only fires once per user (gated by is_first_activation).
        from app import analytics
        analytics.capture(
            user_id=user.clerk_id,
            event="desktop_activated",
            properties={
                "tier": effective_tier,
                "founder": effective_founder,
                "admin_override": is_admin,
                # Affiliate attribution so the funnel can join activation back to
                # the referring partner. ID only — never email/name (sanitized too).
                "affiliate_id": user.affiliate_id,
                "activation_source": "desktop_connect",
            },
        )

    return ConnectResponse(
        license_jwt=jwt_str,
        expires_at=expires_at,
        tier=effective_tier,
        founder=effective_founder,
        challenge=body.challenge,
    )


class HeartbeatResponse(BaseModel):
    tier: str
    founder: bool
    paid_until: datetime | None
    subscription_status: str
    # Starter pass — remaining free clip exports (null = unlimited / paid).
    remaining_exports: int | None


@router.post("/heartbeat", response_model=HeartbeatResponse)
def heartbeat(user: Annotated[User, Depends(current_user)]) -> HeartbeatResponse:
    """Cheap call the desktop hits on launch + every 60s while running."""
    return HeartbeatResponse(
        tier=user.tier,
        founder=user.founder_flag,
        paid_until=user.paid_until,
        subscription_status=user.subscription_status,
        remaining_exports=starter_export_remaining(user),
    )


@router.get("/public-key")
def get_public_key() -> dict:
    """Desktop bundles this at build time; the endpoint exists as a fallback
    and for verifying the bundled key matches what the backend is signing with."""
    return {"public_pem": public_pem()}
