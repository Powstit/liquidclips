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

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.features import is_admin_email
from app.models import User
from app.routes.usage import starter_export_remaining

router = APIRouter(prefix="/affiliate", tags=["affiliate"])

WHOP_AFFILIATES_URL = "https://api.whop.com/api/v1/affiliates"
PARTNER_DASHBOARD_URL = "https://partner.jnremployee.com"
QUALIFY_PAID_REFERRALS = 2       # 50% recurring kicks in from customer 3 after qualifying
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
    referral_url: str | None
    status: str | None
    active_members_count: int | None
    total_referrals_count: int | None
    monthly_recurring_revenue_usd: str | None
    total_referral_earnings_usd: str | None
    qualification: Qualification | None
    partner_dashboard_url: str = PARTNER_DASHBOARD_URL


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


def _require_internal(secret_header: str | None) -> None:
    secret = get_settings().internal_api_secret
    if not secret:
        return  # not configured (local dev) → allow
    if secret_header != secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad internal secret")


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

    customer = CustomerBlock(
        tier=eff_tier,
        subscription_status="admin" if is_admin else user.subscription_status,
        founder=eff_founder,
        admin_override=is_admin,
        can_earn=can_earn,
        billing_provider="whop" if user.whop_user_id else "clerk",
        is_trial=user.subscription_status == "trialing",
        remaining_exports=None if is_admin else starter_export_remaining(user),
        paid_until=user.paid_until.isoformat() if user.paid_until else None,
        whop_connected=bool(user.whop_user_id),
        referrer_affiliate_id=user.affiliate_id,
    )

    aff = _fetch_whop_affiliate((user.email or "").strip().lower())
    if aff and aff.get("id"):
        aff_id = str(aff["id"])
        # Cache the user's own Whop affiliate_id for reverse lookup in
        # paid-conversion webhooks. Skip if the user is detached (admin override
        # path expunges from the session). Wrap so a commit failure never breaks
        # the dashboard render.
        if db is not None and user.whop_affiliate_id != aff_id:
            try:
                user.whop_affiliate_id = aff_id
                db.commit()
            except Exception:  # noqa: BLE001
                db.rollback()
        active = aff.get("active_members_count")
        try:
            paid_count = int(active or 0)
        except (TypeError, ValueError):
            # Whop returned a non-numeric value here once before — don't crash the dashboard.
            paid_count = 0
        affiliate = AffiliateBlock(
            connected=True,
            affiliate_id=aff_id,
            referral_url=f"{get_settings().account_site_url}/checkout?a={aff_id}",
            status=aff.get("status"),
            active_members_count=active,
            total_referrals_count=aff.get("total_referrals_count"),
            monthly_recurring_revenue_usd=aff.get("monthly_recurring_revenue_usd"),
            total_referral_earnings_usd=aff.get("total_referral_earnings_usd"),
            qualification=Qualification(
                paid_referrals_count=paid_count,
                verified_views_count=None,
                qualified=True if paid_count >= QUALIFY_PAID_REFERRALS else None,
            ),
        )
    else:
        affiliate = AffiliateBlock(
            connected=False,
            affiliate_id=None,
            referral_url=None,
            status=None,
            active_members_count=None,
            total_referrals_count=None,
            monthly_recurring_revenue_usd=None,
            total_referral_earnings_usd=None,
            qualification=None,
        )

    return AffiliateMeResponse(customer=customer, affiliate=affiliate)


@router.get("/me", response_model=AffiliateMeResponse)
def affiliate_me(
    db: Annotated[Session, Depends(get_db)],
    clerk_user_id: Annotated[str, Query(min_length=1)],
    x_internal_secret: Annotated[str | None, Header()] = None,
) -> AffiliateMeResponse:
    _require_internal(x_internal_secret)

    user = db.query(User).filter_by(clerk_id=clerk_user_id).one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")

    return build_affiliate_me_response(user, db=db)
