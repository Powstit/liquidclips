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
from app.deps import current_user, require_internal_secret
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
    # Verified email + first name from the SAME Clerk session — used to upsert
    # the User row if the clerk.user.created webhook hasn't landed yet. Optional
    # for backward compat with older account-app deploys; when present, sign-in
    # self-heals instead of 404'ing on a webhook race.
    email: str | None = None
    first_name: str | None = None


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
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
) -> ConnectResponse:
    # Server-to-server only: minting a desktop license is gated by the shared
    # internal secret via `deps.require_internal_secret` (fail-closed: missing
    # env → 500, missing/mismatched header → 401). Only account-app's
    # /api/desktop/connect (which derives clerk_user_id from a verified Clerk
    # session) holds the secret. The desktop and the browser must NEVER be
    # able to call this directly with an arbitrary id.

    # Normalize email up-front so we never store mixed-case duplicates or
    # whitespace, and the empty-after-strip case is rejected cleanly.
    email_clean = (body.email or "").strip().lower()

    user = db.query(User).filter_by(clerk_id=body.clerk_user_id).one_or_none()
    if user:
        # Existing User: ONLY fill in a missing email — never overwrite a real
        # existing one (Clerk allows email changes, but the canonical sync path
        # for that is the user.updated webhook, not this bridge).
        if (not (user.email or "").strip()) and email_clean:
            user.email = email_clean
    else:
        # SELF-HEAL: account-app passes the VERIFIED Clerk session (clerk_user_id
        # + email from auth()/currentUser server-side). If the user.created
        # webhook hasn't landed yet — or never fires — we MUST NOT hold sign-in
        # hostage. Create the row here with the verified email; the webhook stays
        # the canonical sync path and is idempotent (no-op if user exists).
        if not email_clean:
            # Older account-app deploys that don't send email — keep the 404
            # rather than create a row without contact info we can't trust.
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                "user not found and no email provided to create one",
            )
        user = User(
            clerk_id=body.clerk_user_id,
            email=email_clean,
            # tier/founder_flag/subscription_status/trial_started_at/starter_exports_used
            # all use SQLAlchemy column defaults (free / False / trial / utcnow / 0).
        )
        db.add(user)
        db.flush()  # populate user.id for the License insert below

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

        # Sprint G.1 · stamp first_launch_at milestone. Fire-and-forget
        # so a telemetry write never blocks the license mint.
        try:
            from app.onboarding_milestones import mark_milestone
            mark_milestone(db, user, "first_launch_at")
            db.commit()
        except Exception:
            pass

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


class ConnectFromCheckoutRequest(BaseModel):
    """2026-07-05 · user-journey-lens P0 · new-Whop-buyer bridge.

    Body posted by account-app `/api/desktop/connect-whop-checkout` for
    users who came through Whop checkout WITHOUT a prior Clerk account.
    They land on account-app, sign up on Clerk (creating the User row
    via the user.created webhook), then this endpoint mints a JWT
    without requiring the desktop-initiated challenge nonce.

    Auth: `x-internal-secret` (shared with account-app) + verified
    Clerk session on the account-app side. No `challenge` param — the
    deep link is emitted with `?source=whop-checkout` which desktop
    activation.ts accepts via TRUSTED_CHALLENGELESS_SOURCES."""
    clerk_user_id: str
    whop_membership_id: str
    email: str | None = None
    first_name: str | None = None


class ConnectFromCheckoutResponse(BaseModel):
    license_jwt: str
    expires_at: datetime
    tier: str
    founder: bool


@router.post("/connect-from-checkout", response_model=ConnectFromCheckoutResponse)
def connect_from_checkout(
    body: ConnectFromCheckoutRequest,
    db: Annotated[Session, Depends(get_db)],
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
) -> ConnectFromCheckoutResponse:
    """Mint a JWT for a Clerk-signed-in Whop-checkout buyer.

    The Clerk `user.created` webhook may or may not have drained the
    `PendingWhopMembership` row by the time this endpoint fires (webhook
    race). If it has, `user.tier` is already `autopilot` + `founder_flag`
    is True. If it hasn't, we look up the pending row inline and apply
    the tier ourselves.

    Idempotent — hitting this twice for the same clerk_user_id +
    membership_id returns a fresh JWT and does not double-grant."""
    email_clean = (body.email or "").strip().lower()
    user = db.query(User).filter_by(clerk_id=body.clerk_user_id).one_or_none()
    if user is None:
        # Self-heal path — mirror /desktop/connect. The Clerk webhook
        # should have created the row, but the race window means we
        # can't assume it.
        if not email_clean:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                "user not found and no email provided to create one",
            )
        user = User(clerk_id=body.clerk_user_id, email=email_clean)
        db.add(user)
        db.flush()

    # If the Clerk webhook already drained the pending row the user is
    # already on the Founder tier. Otherwise, look up the row by
    # (email, tier, unconsumed) and apply the tier now. `whop_membership_id`
    # is passed to correlate but the source of truth is the pending row.
    from app.models import PendingWhopMembership
    from app.routes.webhooks_whop import apply_membership_tier

    pending = (
        db.query(PendingWhopMembership)
        .filter(
            PendingWhopMembership.email == (user.email or "").strip().lower(),
            PendingWhopMembership.consumed_at.is_(None),
        )
        .order_by(PendingWhopMembership.created_at.desc())
        .first()
    )
    if pending is not None:
        # Drain — the Clerk webhook would normally do this via
        # /onboarding/link-whop; this path does it inline for the
        # buyer waiting on the account-app landing page.
        apply_membership_tier(
            db,
            user,
            tier=pending.tier,
            founder=pending.founder,
            whop_user_id=pending.whop_user_id,
            renewal_at=pending.renewal_period_end,
            paid=pending.paid,
        )
        pending.consumed_at = datetime.now(timezone.utc)
        db.flush()

    # Same admin-override + JWT-mint pattern as /desktop/connect.
    is_admin = is_admin_email(user.email)
    effective_tier = "autopilot" if is_admin else (user.tier or "free")
    effective_founder = True if is_admin else user.founder_flag

    jwt_str, expires_at = issue_license_jwt(
        user_id=user.id,
        tier=effective_tier,
        founder=effective_founder,
        quota_videos_per_month=None,
    )
    db.add(License(user_id=user.id, jwt=jwt_str, tier_at_issue=effective_tier, expires_at=expires_at))
    db.commit()

    return ConnectFromCheckoutResponse(
        license_jwt=jwt_str,
        expires_at=expires_at,
        tier=effective_tier,
        founder=effective_founder,
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
