"""Onboarding backfill — claim a Whop entitlement bought before sign-up.

Affiliate-referred buyers often purchase a Junior plan on Whop and only
THEN create / sign into their Junior account. When that happens the Whop
`membership_went_valid` webhook fires before any local user exists, so it
parks the entitlement in a `PendingWhopMembership` row keyed by email
(see app/routes/webhooks_whop.py `_stash_pending_membership`).

This endpoint runs on first sign-in: the account-app calls it right after
Clerk hands us the user. It looks up an unconsumed pending row for the
user's email, applies the tier via the shared `apply_membership_tier`
helper, and stamps the row consumed so it can never be replayed.

Whop has no membership-lookup-by-email (v5 `company/memberships` returns
no email on the record and ignores the `email` filter), so we rely on the
pending-store fallback rather than a live lookup.

Contract:
  POST /onboarding/link-whop
    body:     { "clerk_user_id": str, "email": str }
    response: { "linked": bool, "tier": str }

  linked=true  → a pending entitlement was found and applied; `tier` is the
                 newly applied tier.
  linked=false → nothing pending; `tier` is the user's current tier (unchanged).

Idempotent: once a pending row is consumed, repeat calls return
{linked: false, tier: <current>}.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import PendingWhopMembership, User
from app.routes.notifications import write_notification
from app.routes.webhooks_whop import apply_membership_tier

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


class LinkWhopRequest(BaseModel):
    clerk_user_id: str
    email: str


class LinkWhopResponse(BaseModel):
    linked: bool
    tier: str


@router.post("/link-whop", response_model=LinkWhopResponse)
def link_whop(
    body: LinkWhopRequest,
    db: Annotated[Session, Depends(get_db)],
) -> LinkWhopResponse:
    user = db.query(User).filter_by(clerk_id=body.clerk_user_id).one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found — sign up first")

    email = (body.email or user.email or "").strip().lower()

    pending = (
        db.query(PendingWhopMembership)
        .filter(
            PendingWhopMembership.email == email,
            PendingWhopMembership.consumed_at.is_(None),
        )
        .order_by(PendingWhopMembership.created_at.desc())
        .first()
    )
    if not pending:
        return LinkWhopResponse(linked=False, tier=user.tier)

    apply_membership_tier(
        db,
        user,
        tier=pending.tier,
        founder=pending.founder,
        whop_user_id=pending.whop_user_id,
        renewal_at=pending.renewal_period_end,
    )
    pending.consumed_at = datetime.now(timezone.utc)

    # This is the COMMON affiliate/founder path (pay on Whop → sign up after).
    # apply_membership_tier is deliberately side-effect-free, so without this the
    # typical buyer got NO activation email, notification, or funnel event. Layer
    # the same effects the webhook path applies when the user already existed.
    founder = bool(pending.founder)
    if user.founder_flag and founder:
        write_notification(
            db, user_id=user.id, category="founder",
            title="Welcome, founder.",
            body="Your founder seat is locked — Autopilot is yours from day one of every sprint.",
            priority="high", external_dedup_key=f"founder-claim-{user.id}",
        )
    else:
        write_notification(
            db, user_id=user.id, category="billing",
            title=f"{user.tier.capitalize()} tier active.",
            body="Your plan is live. Download Junior and start exporting.",
            priority="medium", external_dedup_key=f"whop-claim-{user.id}-{user.tier}",
        )
    db.commit()

    # Branded activation email (founder welcome vs trial/paid). Non-blocking.
    from app.mailer import send_founder_welcome, send_subscription_activated
    if user.founder_flag and founder:
        send_founder_welcome(user.email)
    else:
        send_subscription_activated(
            user.email, tier=user.tier, trial=(user.subscription_status == "trialing"),
        )

    # PostHog — mirror the webhook funnel events so the pay-then-signup path is
    # measured the same as the user-already-existed path.
    if user.clerk_id:
        from app import analytics
        analytics.identify(
            user_id=user.clerk_id, tier=user.tier,
            whop_user_id=user.whop_user_id, affiliate_id=user.affiliate_id,
        )
        analytics.capture(
            user_id=user.clerk_id, event="whop_membership_valid",
            properties={"tier": user.tier, "founder": founder},
        )
        if user.subscription_status == "trialing":
            analytics.capture(
                user_id=user.clerk_id, event="whop_trial_started",
                properties={"tier": user.tier, "subscription_status": user.subscription_status, "billing_provider": "whop"},
            )

    return LinkWhopResponse(linked=True, tier=user.tier)
