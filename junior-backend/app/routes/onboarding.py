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
    header:   Authorization: Bearer <license JWT>   (identifies the user)
    body:     { "email": str }                       (Whop purchase email)
    response: { "linked": bool, "tier": str }

  linked=true  → a pending entitlement was found and applied; `tier` is the
                 newly applied tier.
  linked=false → nothing pending; `tier` is the user's current tier (unchanged).

Idempotent: once a pending row is consumed, repeat calls return
{linked: false, tier: <current>}.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import engine, get_db
from app.deps import current_user, require_internal_secret
from app.models import PendingWhopMembership, User, WhopClaimToken
from app.routes.notifications import write_notification
from app.routes.webhooks_whop import apply_membership_tier

CLAIM_TTL_MIN = 20         # claim link lifetime
CLAIM_MAX_PER_HOUR = 5     # per purchase-email AND per requester (anti-spam)


def _now() -> datetime:
    # SQLite (dev) stores naive datetimes; match it so comparisons don't raise.
    now = datetime.now(timezone.utc)
    return now.replace(tzinfo=None) if engine.dialect.name == "sqlite" else now


def _activate_pending(db: Session, user: User, pending: PendingWhopMembership) -> bool:
    """Apply a pending Whop entitlement + fire the activation side-effects
    (notification + email) that apply_membership_tier omits. Returns whether the
    user is a founder claim. Caller commits and emits its own funnel event."""
    apply_membership_tier(
        db, user, tier=pending.tier, founder=pending.founder,
        whop_user_id=pending.whop_user_id, renewal_at=pending.renewal_period_end,
        paid=pending.paid,
    )
    if pending.paid and user.first_paid_at is None:
        user.first_paid_at = datetime.now(timezone.utc)
    pending.consumed_at = datetime.now(timezone.utc)
    founder = bool(pending.founder)
    if user.founder_flag and founder:
        write_notification(
            db, user_id=user.id, category="founder", title="Welcome, founder.",
            body="Your founder seat is locked — Autopilot is yours from day one of every sprint.",
            priority="high", external_dedup_key=f"founder-claim-{user.id}",
        )
    else:
        write_notification(
            db, user_id=user.id, category="billing", title=f"{user.tier.capitalize()} tier active.",
            body="Your plan is live. Download Liquid Clips and start exporting.",
            priority="medium", external_dedup_key=f"whop-claim-{user.id}-{user.tier}",
        )
    return founder

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


class LinkWhopRequest(BaseModel):
    # 2026-08-10 — reverted to accepting `clerk_user_id` in the body, but
    # SAFELY this time: this endpoint now requires `x-internal-secret`
    # (require_internal_secret below), the same gate `/desktop/connect`
    # uses. Only account-app's own server-side proxy route
    # (api/onboarding/link-whop/route.ts) holds that secret, and IT derives
    # clerk_user_id from a verified Clerk session server-side — the browser
    # never gets to supply an arbitrary id. This is what the 2026-07-04
    # license-JWT-only change was actually trying to prevent (a browser
    # directly spoofing clerk_user_id), without requiring a license JWT
    # that no real caller of this endpoint has ever actually held: both
    # call sites (WhopLinkBoot.tsx, get/page.tsx) are web-context Clerk
    # sign-ins, not the desktop app, so they never carry one — confirmed
    # live, every call 401'd since the license-JWT requirement landed.
    clerk_user_id: str
    email: str


class LinkWhopResponse(BaseModel):
    linked: bool
    tier: str


@router.post("/link-whop", response_model=LinkWhopResponse)
def link_whop(
    body: LinkWhopRequest,
    db: Annotated[Session, Depends(get_db)],
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
) -> LinkWhopResponse:
    user = db.query(User).filter_by(clerk_id=body.clerk_user_id).one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
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

    # This is the COMMON affiliate/founder path (pay on Whop → sign up after).
    # apply_membership_tier is side-effect-free, so _activate_pending layers the
    # notification the typical buyer otherwise never got; email + events below.
    founder = _activate_pending(db, user, pending)
    db.commit()

    # Branded activation email (founder welcome vs trial/paid). Non-blocking.
    # Admin alert mirrors the email so Daniel sees every paid signup in real time.
    from app.mailer import send_admin_paid_customer_alert, send_founder_welcome, send_subscription_activated
    if user.founder_flag and founder:
        send_founder_welcome(user.email)
        send_admin_paid_customer_alert(
            customer_email=user.email,
            tier=user.tier,
            source="founder_unlock",
            monthly_usd="£1 commit",
        )
    else:
        send_subscription_activated(
            user.email, tier=user.tier, trial=(user.subscription_status == "trialing"),
        )
        send_admin_paid_customer_alert(
            customer_email=user.email,
            tier=user.tier,
            source="whop_subscription_active",
            note=("trialing" if user.subscription_status == "trialing" else None),
        )

    # PostHog — mirror the webhook funnel events so the pay-then-signup path is
    # measured the same as the user-already-existed path.
    if user.clerk_id:
        from app import analytics
        analytics.identify(
            user_id=user.clerk_id, tier=user.tier,
            whop_user_id=user.whop_user_id, affiliate_id=user.affiliate_id,
        )
        # New spec event: pending membership consumed by same-email link-whop.
        analytics.capture(
            user_id=user.clerk_id, event="whop_onboarding_link_succeeded",
            properties={"tier": user.tier, "founder": founder},
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


# --- Self-serve claim: bought on Whop with a different email than signup -----

class ClaimWhopRequest(BaseModel):
    clerk_user_id: str
    signed_in_email: str | None = None
    whop_purchase_email: str


class ClaimWhopResponse(BaseModel):
    ok: bool  # ALWAYS true — never reveal whether a purchase/account exists


@router.post("/claim-whop", response_model=ClaimWhopResponse)
def claim_whop(
    body: ClaimWhopRequest,
    db: Annotated[Session, Depends(get_db)],
) -> ClaimWhopResponse:
    """Start a claim when the Whop purchase email differs from the Junior signup
    email. We NEVER instantly link and NEVER reveal whether a purchase exists — if
    one does, we email a one-use, 20-min claim link to the Whop purchase email.
    Controlling that inbox + being the same signed-in user at redeem is the proof."""
    generic = ClaimWhopResponse(ok=True)
    purchase_email = (body.whop_purchase_email or "").strip().lower()
    if not purchase_email or "@" not in purchase_email:
        return generic
    user = db.query(User).filter_by(clerk_id=body.clerk_user_id).one_or_none()
    if not user:
        return generic

    now = _now()
    hour_ago = now - timedelta(hours=1)
    recent_email = db.query(WhopClaimToken).filter(
        WhopClaimToken.whop_purchase_email == purchase_email,
        WhopClaimToken.created_at > hour_ago,
    ).count()
    recent_user = db.query(WhopClaimToken).filter(
        WhopClaimToken.clerk_user_id == body.clerk_user_id,
        WhopClaimToken.created_at > hour_ago,
    ).count()
    if recent_email >= CLAIM_MAX_PER_HOUR or recent_user >= CLAIM_MAX_PER_HOUR:
        return generic  # rate-limited — silently drop, stay generic

    pending = (
        db.query(PendingWhopMembership)
        .filter(PendingWhopMembership.email == purchase_email, PendingWhopMembership.consumed_at.is_(None))
        .order_by(PendingWhopMembership.created_at.desc())
        .first()
    )
    if not pending:
        return generic  # nothing to claim — but don't reveal that

    token = secrets.token_urlsafe(32)
    db.add(WhopClaimToken(
        token=token,
        clerk_user_id=body.clerk_user_id,
        whop_purchase_email=purchase_email,
        expires_at=now + timedelta(minutes=CLAIM_TTL_MIN),
    ))
    db.commit()

    from app.config import get_settings
    claim_url = f"{get_settings().account_site_url}/get?claim={token}"
    from app.mailer import send_whop_claim_link
    send_whop_claim_link(purchase_email, claim_url=claim_url)

    if user.clerk_id:
        from app import analytics
        analytics.capture(user_id=user.clerk_id, event="whop_claim_email_sent", properties={"tier": pending.tier})
    return generic


class RedeemClaimRequest(BaseModel):
    clerk_user_id: str
    token: str


class RedeemClaimResponse(BaseModel):
    linked: bool
    tier: str | None = None
    reason: str | None = None


@router.post("/claim-whop/redeem", response_model=RedeemClaimResponse)
def redeem_claim(
    body: RedeemClaimRequest,
    db: Annotated[Session, Depends(get_db)],
) -> RedeemClaimResponse:
    """Redeem a claim token opened from the Whop-purchase-email inbox. Requires
    the SAME signed-in Clerk user that requested it (two-factor: inbox + session).
    One-use; expires in 20 min."""
    def fail(reason: str) -> RedeemClaimResponse:
        if body.clerk_user_id:
            from app import analytics
            analytics.capture(user_id=body.clerk_user_id, event="whop_claim_failed", properties={"reason": reason})
        return RedeemClaimResponse(linked=False, reason=reason)

    tok = db.query(WhopClaimToken).filter_by(token=body.token).one_or_none()
    if not tok:
        return fail("invalid")
    if tok.consumed_at is not None:
        return fail("used")
    if tok.expires_at <= _now():
        return fail("expired")
    if tok.clerk_user_id != body.clerk_user_id:
        return fail("mismatch")  # must be the same signed-in user that requested it

    user = db.query(User).filter_by(clerk_id=body.clerk_user_id).one_or_none()
    if not user:
        return fail("no_user")

    pending = (
        db.query(PendingWhopMembership)
        .filter(PendingWhopMembership.email == tok.whop_purchase_email, PendingWhopMembership.consumed_at.is_(None))
        .order_by(PendingWhopMembership.created_at.desc())
        .first()
    )
    if not pending:
        tok.consumed_at = datetime.now(timezone.utc)  # burn the token regardless
        db.commit()
        return fail("nothing_pending")

    founder = _activate_pending(db, user, pending)
    tok.consumed_at = datetime.now(timezone.utc)
    db.commit()

    from app.mailer import send_admin_paid_customer_alert, send_founder_welcome, send_subscription_activated
    if user.founder_flag and founder:
        send_founder_welcome(user.email)
        send_admin_paid_customer_alert(
            customer_email=user.email,
            tier=user.tier,
            source="founder_unlock",
            monthly_usd="£1 commit",
            note="claim-flow activation",
        )
    else:
        send_subscription_activated(user.email, tier=user.tier, trial=(user.subscription_status == "trialing"))
        send_admin_paid_customer_alert(
            customer_email=user.email,
            tier=user.tier,
            source="whop_subscription_active",
            note=("trialing" if user.subscription_status == "trialing" else "claim-flow activation"),
        )

    if user.clerk_id:
        from app import analytics
        analytics.identify(user_id=user.clerk_id, tier=user.tier, whop_user_id=user.whop_user_id, affiliate_id=user.affiliate_id)
        # Emit both the doc's new name (whop_claim_redeemed) and the existing
        # name (whop_claim_succeeded) so existing dashboards don't break.
        analytics.capture(user_id=user.clerk_id, event="whop_claim_redeemed", properties={"tier": user.tier, "founder": founder})
        analytics.capture(user_id=user.clerk_id, event="whop_claim_succeeded", properties={"tier": user.tier, "founder": founder})

    return RedeemClaimResponse(linked=True, tier=user.tier)


# --- Crew onboarding markers ------------------------------------------------
#
# 2026-07-10 · P1 · post-verify Crew referral flywheel gate. Records
# `crew_onboarding_shown_at` / `_completed_at` / `_dismissed_at` on
# `User.onboarding_status` (existing JSON dict, see app/models.py line ~184).
# The WelcomeRoute reads `/me` after Clerk OTP success — if none of the
# three markers are set the app routes to `#/crew-onboarding` BEFORE Home.
#
# Per Daniel's directive: server-side state, NOT localStorage. Reasoning:
# the user may reinstall the desktop app on a new machine (or a Windows
# user might switch to macOS) and the Crew ask should never re-appear
# after they've explicitly acknowledged it once.


class CrewOnboardingResponse(BaseModel):
    ok: bool = True
    shown_at: str | None = None
    completed_at: str | None = None
    dismissed_at: str | None = None


def _crew_marker_response(status: dict) -> CrewOnboardingResponse:
    return CrewOnboardingResponse(
        ok=True,
        shown_at=status.get("crew_onboarding_shown_at"),
        completed_at=status.get("crew_onboarding_completed_at"),
        dismissed_at=status.get("crew_onboarding_dismissed_at"),
    )


def _write_crew_marker(
    db: Session, user: User, *, key: str, only_if_missing: bool = False,
) -> dict:
    status = dict(user.onboarding_status or {})
    if only_if_missing and status.get(key):
        return status
    status[key] = datetime.now(timezone.utc).isoformat()
    user.onboarding_status = status
    # SQLAlchemy JSON columns don't auto-detect nested mutation — assigning
    # a new dict forces the update. commit + refresh so subsequent reads
    # (same request) see the new state.
    db.add(user)
    db.commit()
    db.refresh(user)
    return dict(user.onboarding_status or {})


@router.post("/crew/shown", response_model=CrewOnboardingResponse)
def crew_onboarding_shown(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
) -> CrewOnboardingResponse:
    """Idempotent — only writes on first call. Subsequent calls no-op
    but return the current markers so the frontend can reconcile."""
    status = _write_crew_marker(
        db, user, key="crew_onboarding_shown_at", only_if_missing=True,
    )
    return _crew_marker_response(status)


@router.post("/crew/completed", response_model=CrewOnboardingResponse)
def crew_onboarding_completed(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
) -> CrewOnboardingResponse:
    """Marks the crew onboarding as completed — user approved + sent
    at least one invite. Always overwrites (last-completed-wins)."""
    status = _write_crew_marker(
        db, user, key="crew_onboarding_completed_at", only_if_missing=False,
    )
    return _crew_marker_response(status)


@router.post("/crew/dismissed", response_model=CrewOnboardingResponse)
def crew_onboarding_dismissed(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
) -> CrewOnboardingResponse:
    """User tapped 'Skip forever'. Prevents future auto-open on
    subsequent Welcome landings."""
    status = _write_crew_marker(
        db, user, key="crew_onboarding_dismissed_at", only_if_missing=False,
    )
    return _crew_marker_response(status)


@router.get("/crew", response_model=CrewOnboardingResponse)
def crew_onboarding_state(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
) -> CrewOnboardingResponse:
    """Read-only snapshot for the WelcomeRoute post-verify check."""
    del db  # unused; helper reads user.onboarding_status directly
    return _crew_marker_response(dict(user.onboarding_status or {}))
