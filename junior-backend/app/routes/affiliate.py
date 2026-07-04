"""GET /affiliate/me — account-dashboard bridge to the user's Whop affiliate.

The account-app (Clerk-authed) dashboard calls this server-to-server to show the
user's referral link + Whop affiliate stats + their own customer entitlement,
without the dashboard needing a license JWT or the Whop API key in its own env.

Whop is the SOURCE OF TRUTH for the affiliate (id, link, referrals, earnings):
we get-or-create the affiliate by EMAIL via Whop's REST affiliates endpoint
(POST /api/v1/affiliates accepts user_identifier = email | username | user id).
There is NO Junior-side referral ledger or custom code — this is a thin bridge.

Auth: a server-to-server shared secret. The caller (account-app server
component) sends x-internal-secret and only ever passes its own verified Clerk
user id. Earnings are mildly sensitive, so unlike /onboarding/link-whop this
endpoint is not open.
"""

from __future__ import annotations

from typing import Annotated, Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import require_internal_secret
from app.features import is_admin_email
from app.models import User
from app.routes.usage import starter_export_remaining
from app.services.affiliate_commission import (
    QUALIFY_PAID_REFERRALS,
    eligible_referral_count,
)

router = APIRouter(prefix="/affiliate", tags=["affiliate"])

WHOP_AFFILIATES_URL = "https://api.whop.com/api/v1/affiliates"
QUALIFY_VERIFIED_VIEWS = 11000   # OR this many Whop-verified views (Whop owns view truth)


class Qualification(BaseModel):
    paid_referrals_count: int
    paid_referrals_needed: int = QUALIFY_PAID_REFERRALS
    verified_views_count: int | None  # Whop owns view truth; null = not exposed here
    verified_views_needed: int = QUALIFY_VERIFIED_VIEWS
    qualified: bool | None  # True = paid threshold met; null = manual/review (views path)


class AffiliateBlock(BaseModel):
    connected: bool
    affiliate_id: str | None
    affiliate_code: str | None
    referral_url: str | None
    status: str | None
    active_members_count: int | None
    total_referrals_count: int | None
    monthly_recurring_revenue_usd: str | None
    total_referral_earnings_usd: str | None
    qualification: Qualification | None
    partner_dashboard_url: str
    payout_provider: str  # "whop" | "stripe_connect"
    payout_status: str    # ready | qualification_required | unavailable
    payout_setup_url: str


class PaymentRoute(BaseModel):
    key: str
    label: str
    provider: str
    status: str
    manage_url: str
    helper: str
    in_app: bool


class PaymentVisibility(BaseModel):
    app_subscription: PaymentRoute
    reward_payouts: PaymentRoute
    affiliate_payouts: PaymentRoute


class CustomerBlock(BaseModel):
    tier: str
    subscription_status: str
    founder: bool
    admin_override: bool
    can_earn: bool  # affiliate earning needs an active paid plan (or founder/admin)
    billing_provider: str  # "whop" | "clerk"
    is_trial: bool
    remaining_exports: int | None  # null = unlimited (paid/founder/admin)
    paid_until: str | None
    whop_connected: bool
    referrer_affiliate_id: str | None  # who referred THEM (inbound, first-touch)


class AffiliateMeResponse(BaseModel):
    customer: CustomerBlock
    affiliate: AffiliateBlock
    payments: PaymentVisibility


# Internal-secret gate is now fail-closed via `deps.require_internal_secret`
# (missing env → 500, missing/mismatched header → 401). Previously the
# `if not secret: return` fallback silently accepted any request when the
# Railway env var was unset — a config drift on prod would have exposed
# customer + affiliate detail.


def _fetch_whop_affiliate(email: str) -> dict[str, Any] | None:
    """Get-or-create the user's Whop affiliate by email. Returns None on any
    failure so the dashboard degrades to a 'open partner dashboard' fallback
    instead of erroring."""
    s = get_settings()
    if not s.whop_api_key or not email:
        return None
    try:
        with httpx.Client(timeout=20.0) as client:
            r = client.post(
                WHOP_AFFILIATES_URL,
                headers={
                    "Authorization": f"Bearer {s.whop_api_key}",
                    "Content-Type": "application/json",
                },
                json={"company_id": s.whop_company_id, "user_identifier": email},
            )
        if r.status_code >= 400:
            return None
        return r.json()
    except (httpx.HTTPError, ValueError):
        return None


def _affiliate_code(affiliate: dict[str, Any]) -> str | None:
    """Return the Whop checkout code (normally the user's username).

    Whop's embedded checkout does not accept the aff_* record id as the
    affiliateCode. Keep the code separate from our internal record id.
    """
    user = affiliate.get("user") or {}
    raw = user.get("username")
    if not isinstance(raw, str):
        return None
    code = raw.strip()
    return code[:64] if code and all(c.isalnum() or c in "_-" for c in code) else None


def build_affiliate_me_response(user: User, db: Session | None = None) -> AffiliateMeResponse:
    """Shared builder — consumed by both `/affiliate/me` (account-app, internal
    secret + clerk id) and `/me/affiliate` (desktop, license JWT). Keeps the
    customer/affiliate construction in one place so both surfaces stay in
    lockstep when fields are added or rules change.

    Mostly pure: one Whop API call, returns the response object. When `db` is
    passed AND Whop returns the affiliate, we opportunistically cache
    `user.whop_affiliate_id` so paid-conversion webhooks can later resolve
    `buyer.affiliate_id → referrer user` without an extra Whop round-trip.
    Best-effort — a cache failure must not break the dashboard."""
    is_admin = is_admin_email(user.email)
    eff_tier = "autopilot" if is_admin else user.tier
    eff_founder = True if is_admin else user.founder_flag
    can_earn = bool(
        eff_founder
        or is_admin
        or (user.subscription_status == "active" and user.tier != "free")
    )
    settings = get_settings()
    billing_provider = "whop" if user.whop_user_id else "clerk"
    account_url = f"{settings.account_site_url.rstrip('/')}/dashboard"

    customer = CustomerBlock(
        tier=eff_tier,
        subscription_status="admin" if is_admin else user.subscription_status,
        founder=eff_founder,
        admin_override=is_admin,
        can_earn=can_earn,
        billing_provider=billing_provider,
        is_trial=user.subscription_status == "trialing",
        remaining_exports=None if is_admin else starter_export_remaining(user),
        paid_until=user.paid_until.isoformat() if user.paid_until else None,
        whop_connected=bool(user.whop_user_id),
        referrer_affiliate_id=user.affiliate_id,
    )

    aff = _fetch_whop_affiliate((user.email or "").strip().lower())
    if aff and aff.get("id"):
        aff_id = str(aff["id"])
        aff_code = _affiliate_code(aff)
        # Cache the user's own Whop affiliate_id for reverse lookup in
        # paid-conversion webhooks. Skip if the user is detached (admin override
        # path expunges from the session). Wrap so a commit failure never breaks
        # the dashboard render.
        if db is not None and (
            user.whop_affiliate_id != aff_id
            or user.whop_affiliate_code != aff_code
        ):
            try:
                user.whop_affiliate_id = aff_id
                user.whop_affiliate_code = aff_code
                db.commit()
            except Exception:  # noqa: BLE001
                db.rollback()
        active = aff.get("active_members_count")
        try:
            paid_count = int(active or 0)
        except (TypeError, ValueError):
            # Whop returned a non-numeric value here once before — don't crash the dashboard.
            paid_count = 0
        qualified_count = (
            eligible_referral_count(db, user)
            if db is not None
            else paid_count
        )
        affiliate = AffiliateBlock(
            connected=True,
            affiliate_id=aff_id,
            affiliate_code=aff_code,
            referral_url=(
                f"{settings.account_site_url}/checkout?{urlencode({'a': aff_code})}"
                if aff_code
                else None
            ),
            status=aff.get("status"),
            active_members_count=active,
            total_referrals_count=aff.get("total_referrals_count"),
            monthly_recurring_revenue_usd=aff.get("monthly_recurring_revenue_usd"),
            total_referral_earnings_usd=aff.get("total_referral_earnings_usd"),
            partner_dashboard_url=settings.whop_partner_dashboard_url,
            payout_provider="whop",
            payout_status=(
                "ready"
                if user.whop_commission_override_id
                else "qualification_required"
            ),
            payout_setup_url=settings.whop_partner_dashboard_url,
            qualification=Qualification(
                paid_referrals_count=qualified_count,
                verified_views_count=None,
                # Do not claim the 50% rate is active merely because the count
                # is met. It is active only after Whop override ids are stored.
                qualified=bool(user.whop_commission_override_id),
            ),
        )
    else:
        # Whop is the single affiliate attribution + payout rail. A transient
        # Whop failure must surface as unavailable, never silently advertise a
        # Stripe route that has onboarding but no commission transfer ledger.
        affiliate = AffiliateBlock(
            connected=False,
            affiliate_id=None,
            affiliate_code=None,
            referral_url=None,
            status=None,
            active_members_count=None,
            total_referrals_count=None,
            monthly_recurring_revenue_usd=None,
            total_referral_earnings_usd=None,
            qualification=None,
            partner_dashboard_url=settings.whop_partner_dashboard_url,
            payout_provider="whop",
            payout_status="unavailable",
            payout_setup_url=settings.whop_partner_dashboard_url,
        )

    payments = PaymentVisibility(
        app_subscription=PaymentRoute(
            key="app_subscription",
            label="Liquid Clips subscription",
            provider="Whop" if billing_provider == "whop" else "Stripe via Clerk",
            status=customer.subscription_status,
            manage_url=settings.whop_manage_url if billing_provider == "whop" else account_url,
            helper=(
                "Whop owns this subscription and receipt. Manage card, cancel, or change plan on Whop."
                if billing_provider == "whop"
                else "Stripe powers card billing through Clerk. Manage plan and payment method in your Liquid Clips account."
            ),
            in_app=True,
        ),
        reward_payouts=PaymentRoute(
            key="reward_payouts",
            label="Whop Content Reward payouts",
            provider="Whop",
            status="offloaded",
            manage_url=settings.whop_payouts_url,
            helper="Whop verifies reward views, approvals, and payouts. Liquid Clips shows the brief and submission status only.",
            in_app=False,
        ),
        affiliate_payouts=PaymentRoute(
            key="affiliate_payouts",
            label="Affiliate commissions",
            provider="Whop payouts",
            status=affiliate.payout_status,
            manage_url=affiliate.payout_setup_url,
            helper="Whop tracks referrals, calculates commissions, handles refunds, and pays affiliates.",
            in_app=False,
        ),
    )

    return AffiliateMeResponse(customer=customer, affiliate=affiliate, payments=payments)


@router.get("/me", response_model=AffiliateMeResponse)
def affiliate_me(
    db: Annotated[Session, Depends(get_db)],
    clerk_user_id: Annotated[str, Query(min_length=1)],
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
) -> AffiliateMeResponse:
    user = db.query(User).filter_by(clerk_id=clerk_user_id).one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")

    return build_affiliate_me_response(user, db=db)
