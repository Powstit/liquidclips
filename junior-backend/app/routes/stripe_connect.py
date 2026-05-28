"""Stripe Connect Express onboarding for non-Whop affiliates.

Whop-native affiliates use the Whop partner dashboard for payouts (Whop owns
that relationship). Affiliates who never connected Whop go through a Stripe
Connect Express account that Liquid Clips creates on their behalf — Stripe
hosts the onboarding (KYC, bank details), we just create the account and the
AccountLink, then surface status via the dashboard.

Endpoints (both server-to-server only; account-app calls with x-internal-secret):
    POST /me/affiliate/stripe-connect/onboarding
        Body: { country?: str }   # ISO 3166-1 alpha-2; defaults to settings.stripe_connect_default_country
        Returns: { url, account_id, status }
        Idempotent — re-call to refresh the hosted onboarding link (which has a
        ~5 minute TTL per Stripe), without re-creating the Stripe Account.

    GET /me/affiliate/stripe-connect/status
        Returns the persisted status without round-tripping Stripe — refreshed
        by the account.updated webhook in app/routes/webhooks_stripe.py.

Refusal: if the user has a Whop affiliate record (users.whop_affiliate_id is
set) we return 409 — Stripe Connect is the non-Whop rail only. Whop owns
their payouts and the partner-dashboard URL.
"""

from __future__ import annotations

from typing import Annotated

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import User

router = APIRouter(prefix="/me/affiliate/stripe-connect", tags=["affiliate", "stripe_connect"])


# --- request / response shapes -------------------------------------------

class OnboardingRequest(BaseModel):
    country: str | None = None  # ISO 3166-1 alpha-2; None → settings default


class OnboardingResponse(BaseModel):
    url: str
    account_id: str
    status: str  # none | pending | restricted | active


class ConnectStatusResponse(BaseModel):
    account_id: str | None
    status: str
    payouts_enabled: bool
    charges_enabled: bool


# --- auth + helpers ------------------------------------------------------

def _require_internal(secret_header: str | None) -> None:
    secret = get_settings().internal_api_secret
    if not secret:
        return  # not configured (local dev) → allow
    if secret_header != secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad internal secret")


def _get_user_or_404(db: Session, clerk_user_id: str) -> User:
    user = db.query(User).filter_by(clerk_id=clerk_user_id).one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    return user


def _require_stripe_configured() -> None:
    if not get_settings().stripe_secret_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Stripe Connect is not configured on this server (STRIPE_SECRET_KEY missing).",
        )


def _refuse_if_whop_native(user: User) -> None:
    """Whop affiliates use Whop payouts. Don't let them create a parallel
    Stripe Connect account they don't need."""
    if user.whop_affiliate_id:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This user is a Whop-native affiliate. Whop owns their payouts — "
            "Stripe Connect is the non-Whop rail only.",
        )


def derive_status(account: stripe.Account) -> tuple[str, bool, bool]:
    """Map Stripe's flags to our 4-state enum.

    none      — no account (never reached here; caller handles)
    pending   — account exists, KYC not yet submitted
    restricted — KYC submitted but Stripe still wants more (payouts disabled)
    active    — payouts_enabled AND details_submitted
    """
    payouts = bool(account.get("payouts_enabled"))
    charges = bool(account.get("charges_enabled"))
    submitted = bool(account.get("details_submitted"))
    if payouts and submitted:
        return "active", payouts, charges
    if submitted:
        return "restricted", payouts, charges
    return "pending", payouts, charges


# --- endpoints -----------------------------------------------------------

@router.post("/onboarding", response_model=OnboardingResponse)
def create_or_refresh_onboarding(
    body: OnboardingRequest,
    db: Annotated[Session, Depends(get_db)],
    clerk_user_id: Annotated[str, Query(min_length=1)],
    x_internal_secret: Annotated[str | None, Header()] = None,
) -> OnboardingResponse:
    _require_internal(x_internal_secret)
    _require_stripe_configured()

    user = _get_user_or_404(db, clerk_user_id)
    _refuse_if_whop_native(user)

    s = get_settings()
    stripe.api_key = s.stripe_secret_key

    # 1) Get-or-create the Express account.
    if user.stripe_connect_account_id:
        try:
            account = stripe.Account.retrieve(user.stripe_connect_account_id)
        except stripe.StripeError as e:
            # Account got deleted out from under us (admin closed it).
            # Drop the stale id; next call creates a fresh one.
            user.stripe_connect_account_id = None
            user.stripe_connect_status = "none"
            user.stripe_connect_payouts_enabled = False
            user.stripe_connect_charges_enabled = False
            db.commit()
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                f"Stripe account retrieve failed: {e!s}. Reset — call again to create a new one.",
            ) from e
    else:
        country = (body.country or s.stripe_connect_default_country).upper()
        try:
            account = stripe.Account.create(
                type="express",
                country=country,
                email=user.email or None,
                capabilities={"transfers": {"requested": True}},
                business_type="individual",
                metadata={
                    "liquidclips_user_id": user.id,
                    "clerk_user_id": user.clerk_id or "",
                    "affiliate_id": user.affiliate_id or "",
                },
            )
        except stripe.StripeError as e:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                f"Stripe account create failed: {e!s}",
            ) from e
        user.stripe_connect_account_id = account.id

    # 2) Sync our cached status fields from whatever Stripe currently reports.
    stripe_status, payouts, charges = derive_status(account)
    user.stripe_connect_status = stripe_status
    user.stripe_connect_payouts_enabled = payouts
    user.stripe_connect_charges_enabled = charges
    db.commit()

    # 3) Issue a fresh AccountLink — these have a short TTL (~5 min).
    try:
        link = stripe.AccountLink.create(
            account=account.id,
            refresh_url=s.stripe_connect_refresh_url,
            return_url=s.stripe_connect_return_url,
            type="account_onboarding",
        )
    except stripe.StripeError as e:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Stripe AccountLink create failed: {e!s}",
        ) from e

    return OnboardingResponse(
        url=link.url,
        account_id=account.id,
        status=user.stripe_connect_status,
    )


@router.get("/status", response_model=ConnectStatusResponse)
def get_status(
    db: Annotated[Session, Depends(get_db)],
    clerk_user_id: Annotated[str, Query(min_length=1)],
    x_internal_secret: Annotated[str | None, Header()] = None,
) -> ConnectStatusResponse:
    _require_internal(x_internal_secret)
    user = _get_user_or_404(db, clerk_user_id)
    return ConnectStatusResponse(
        account_id=user.stripe_connect_account_id,
        status=user.stripe_connect_status,
        payouts_enabled=user.stripe_connect_payouts_enabled,
        charges_enabled=user.stripe_connect_charges_enabled,
    )
