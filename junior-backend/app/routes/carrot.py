"""Carrot rail · 2026-06-24 · the $50 Sponsored Reward backend.

Three endpoints power the activation-bonus state machine in the desktop:

  GET  /me/carrot         · returns status + view progress + sub-merchant state
                            + recent payout history
  POST /me/carrot/onboard · creates sub-merchant if needed + returns the
                            Whop hosted onboarding URL
  POST /me/carrot/claim   · gates on (5K views OR 5 paid affiliates) +
                            active subscription + onboarded, then triggers
                            transfers.create with the 5% LC fee deducted

Feature-flag gated by CARROT_WHOP_LIVE (default false). In mock mode every
Whop call returns deterministic fake data so the UI develops + tests cleanly
without touching real money.

⚠ IRON GATE IG-SOV-2.2-001 mirrors the canonical economics defined in
desktop-2/src/design-os/earn/sponsoredReward.ts. Threshold values + payout
amount + fee % must match across both repos.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import whop_payments
from app.db import get_db
from app.deps import current_user
from app.models import CampaignSubmission, PostAnalytic, Schedule, SocialChannel, User

router = APIRouter(prefix="/me/carrot", tags=["carrot"])
_log = logging.getLogger("junior.carrot")

# Daniel-locked from desktop-2/src/design-os/earn/sponsoredReward.ts (IG-SOV-2.2-001)
CARROT_AMOUNT_USD = 50.0
CARROT_VIEW_THRESHOLD = 5_000
CARROT_AFFILIATE_THRESHOLD = 5
CARROT_CLEARANCE_DAYS = 7


# ──────── Response models ──────────────────────────────────────────────


class CarrotWalletBlock(BaseModel):
    address: str | None
    network: str | None  # solana | ethereum | bitcoin
    onboarded: bool
    capabilities_crypto_payout: str  # active | inactive | pending | unknown


class CarrotEconomicsBlock(BaseModel):
    gross_usd: float
    lc_protocol_fee_pct: float
    lc_protocol_fee_usd: float
    net_to_clipper_usd: float
    currency: str
    min_withdrawal_usd: float


class CarrotProgressBlock(BaseModel):
    views: int
    views_threshold: int
    affiliates: int
    affiliates_threshold: int
    qualified: bool
    qualified_via: str | None  # "views" | "affiliates" | None


class CarrotResponse(BaseModel):
    state: str  # not_started | tracking | milestone_reached | subscription_required | pending_clearance | approved | rejected | paid | tracking_paused
    is_live: bool  # True when CARROT_WHOP_LIVE=true and we'd actually move money
    is_mock: bool  # convenience inverse
    progress: CarrotProgressBlock
    economics: CarrotEconomicsBlock
    wallet: CarrotWalletBlock | None
    sub_merchant_id: str | None
    lifetime_paid_usd: float
    last_claim_at: str | None
    status_copy: str


class OnboardResponse(BaseModel):
    sub_merchant_id: str
    onboarding_url: str
    is_live: bool


class ClaimResponse(BaseModel):
    state: str
    transfer_id: str | None
    gross_usd: float
    fee_usd: float
    net_usd: float
    currency: str
    error: str | None
    is_live: bool


class PayoutPortalResponse(BaseModel):
    url: str
    expires_at: str | None = None


# ──────── Helpers ──────────────────────────────────────────────────────


def _user_lifetime_views(db: Session, user_id: str) -> int:
    """Sum PostAnalytic.views across all the user's published posts.
    Mirrors /me/lifetime-views aggregation logic."""
    row = db.execute(
        select(func.coalesce(func.sum(PostAnalytic.views), 0))
        .select_from(PostAnalytic)
        .join(Schedule, Schedule.id == PostAnalytic.schedule_id)
        .join(SocialChannel, SocialChannel.id == Schedule.channel_id)
        .where(SocialChannel.user_id == user_id)
    ).one()
    return int(row[0] or 0)


def _user_affiliate_count(user: User) -> int:
    """Best-available paid-referrals count. Whop's live count is authoritative
    but we read from the local cache (User.cached_paid_referrals · refreshed
    by the leaderboard cron every 6h)."""
    return int(user.cached_paid_referrals or 0)


def _has_active_paid_sub(user: User) -> bool:
    """Active paid subscription required to track views AND claim payout."""
    return user.subscription_status == "active" and (user.tier or "free") != "free"


def _resolve_state(
    *,
    user: User,
    views: int,
    affiliates: int,
    sub_merchant_id: str | None,
    onboarded: bool,
) -> str:
    """Derive the carrot state machine value from current inputs. Mirrors the
    enum in desktop-2/src/design-os/earn/activationBonus.ts."""
    qualified = views >= CARROT_VIEW_THRESHOLD or affiliates >= CARROT_AFFILIATE_THRESHOLD
    paid = _has_active_paid_sub(user)

    if not qualified and not paid:
        return "tracking_paused" if views == 0 else "tracking"
    if not qualified:
        return "tracking"
    # qualified
    if not paid:
        return "subscription_required"
    if not sub_merchant_id or not onboarded:
        return "milestone_reached"
    # Approved/pending_clearance/paid distinctions require the carrot_payouts
    # ledger we haven't migrated yet · v1 ships "approved" once qualified
    # + paid + onboarded. Future: add 7-day clearance hold via a ledger row
    # status column.
    return "approved"


def _status_copy(state: str, progress: CarrotProgressBlock) -> str:
    """Human-readable copy matching the desktop SponsoredRewardModule."""
    if state == "tracking_paused":
        return "Subscribe to start tracking views toward your $50 reward."
    if state == "tracking":
        remaining = max(0, CARROT_VIEW_THRESHOLD - progress.views)
        return f"{remaining:,} more views to unlock review."
    if state == "milestone_reached":
        return "Milestone reached · activate your payout wallet to claim."
    if state == "subscription_required":
        return "Active paid subscription required to claim."
    if state == "pending_clearance":
        return "Pending 7-day clearance review."
    if state == "approved":
        return "Approved · withdrawable to your Whop wallet."
    if state == "rejected":
        return "Rejected · contact support."
    if state == "paid":
        return "Paid out · view history."
    return state


# ──────── Endpoints ────────────────────────────────────────────────────


@router.get("", response_model=CarrotResponse)
def get_carrot(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CarrotResponse:
    """Returns the clipper's current carrot state · views progress · economics
    breakdown · wallet info (from Whop if onboarded)."""

    views = _user_lifetime_views(db, user.id)
    affiliates = _user_affiliate_count(user)

    sub_merchant_id = getattr(user, "whop_sub_merchant_id", None)
    onboarded = bool(sub_merchant_id) and getattr(user, "whop_sub_merchant_status", "") == "onboarded"

    wallet_block: CarrotWalletBlock | None = None
    if sub_merchant_id:
        try:
            acct = whop_payments.retrieve_account(sub_merchant_id)
            w = acct.get("wallet") or {}
            caps = acct.get("capabilities") or {}
            if whop_payments.is_live() and acct.get("status") == "connected":
                onboarded = True
                if user.whop_sub_merchant_status != "onboarded":
                    user.whop_sub_merchant_status = "onboarded"
                    db.commit()
            wallet_block = CarrotWalletBlock(
                address=w.get("address"),
                network=w.get("network"),
                onboarded=onboarded,
                capabilities_crypto_payout=str(caps.get("crypto_payout") or "unknown"),
            )
        except Exception as e:  # noqa: BLE001
            _log.warning("[carrot] retrieve_account failed for %s: %s", sub_merchant_id, e)

    progress = CarrotProgressBlock(
        views=views,
        views_threshold=CARROT_VIEW_THRESHOLD,
        affiliates=affiliates,
        affiliates_threshold=CARROT_AFFILIATE_THRESHOLD,
        qualified=views >= CARROT_VIEW_THRESHOLD or affiliates >= CARROT_AFFILIATE_THRESHOLD,
        qualified_via=(
            "views" if views >= CARROT_VIEW_THRESHOLD
            else "affiliates" if affiliates >= CARROT_AFFILIATE_THRESHOLD
            else None
        ),
    )

    net, fee = whop_payments.split_gross_to_net_and_fee(CARROT_AMOUNT_USD)
    economics = CarrotEconomicsBlock(
        gross_usd=CARROT_AMOUNT_USD,
        lc_protocol_fee_pct=whop_payments.LC_PROTOCOL_FEE_PCT,
        lc_protocol_fee_usd=fee,
        net_to_clipper_usd=net,
        currency=whop_payments.DEFAULT_PAYOUT_CURRENCY,
        min_withdrawal_usd=whop_payments.MIN_WITHDRAWAL_USD,
    )

    state = _resolve_state(
        user=user,
        views=views,
        affiliates=affiliates,
        sub_merchant_id=sub_merchant_id,
        onboarded=onboarded,
    )

    return CarrotResponse(
        state=state,
        is_live=whop_payments.is_live(),
        is_mock=not whop_payments.is_live(),
        progress=progress,
        economics=economics,
        wallet=wallet_block,
        sub_merchant_id=sub_merchant_id,
        lifetime_paid_usd=float(getattr(user, "carrot_total_paid_usd_cents", 0) or 0) / 100.0,
        last_claim_at=(
            getattr(user, "carrot_last_claim_at", None).isoformat()
            if getattr(user, "carrot_last_claim_at", None) else None
        ),
        status_copy=_status_copy(state, progress),
    )


@router.post("/onboard", response_model=OnboardResponse)
def onboard_carrot(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> OnboardResponse:
    """Create a Whop sub-merchant for the clipper if needed · return the
    onboarding URL (Whop hosts the KYC + bank/wallet linking flow)."""
    if not whop_payments.is_live():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Whop wallet onboarding is not live yet.",
        )

    sub_merchant_id = getattr(user, "whop_sub_merchant_id", None)

    if not sub_merchant_id:
        try:
            res = whop_payments.create_sub_merchant(
                email=user.email,
                title=f"Liquid Clips clipper · {user.email}",
                internal_user_id=user.id,
            )
        except (httpx.HTTPError, RuntimeError) as e:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                f"Couldn't create Whop sub-merchant: {e!s}",
            ) from None
        sub_merchant_id = res["id"]
        # Persist on the user row · idempotent column (added via main.py lifespan).
        if hasattr(user, "whop_sub_merchant_id"):
            user.whop_sub_merchant_id = sub_merchant_id
        if hasattr(user, "whop_sub_merchant_status"):
            user.whop_sub_merchant_status = "pending"
        db.commit()

    # Generate the hosted onboarding link (idempotent · safe to call multiple
    # times · returns fresh URL each call).
    account_origin = os.environ.get("ACCOUNT_SITE_URL", "https://account.liquidclips.app")
    try:
        link = whop_payments.create_onboarding_link(
            sub_merchant_id=sub_merchant_id,
            return_url=f"{account_origin}/dashboard?payout=complete",
            refresh_url=f"{account_origin}/dashboard?payout=refresh",
        )
    except (httpx.HTTPError, RuntimeError) as e:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Couldn't create Whop onboarding link: {e!s}",
        ) from None

    return OnboardResponse(
        sub_merchant_id=sub_merchant_id,
        onboarding_url=link["url"],
        is_live=bool(link.get("live", False)),
    )


@router.post("/payouts-portal", response_model=PayoutPortalResponse)
def open_payouts_portal(
    user: Annotated[User, Depends(current_user)],
) -> PayoutPortalResponse:
    """Return a short-lived Whop-hosted payout portal for an onboarded user."""
    if not whop_payments.is_live():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Whop payouts are not live yet.",
        )
    sub_merchant_id = getattr(user, "whop_sub_merchant_id", None)
    if not sub_merchant_id:
        raise HTTPException(
            status.HTTP_412_PRECONDITION_FAILED,
            "Complete Whop wallet onboarding first.",
        )
    account_origin = os.environ.get("ACCOUNT_SITE_URL", "https://account.liquidclips.app")
    try:
        link = whop_payments.create_payouts_portal_link(
            sub_merchant_id=sub_merchant_id,
            return_url=f"{account_origin}/dashboard?payout=complete",
            refresh_url=f"{account_origin}/dashboard?payout=refresh",
        )
    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Couldn't open Whop payouts: {exc!s}",
        ) from None
    return PayoutPortalResponse(
        url=link["url"],
        expires_at=(link.get("raw") or {}).get("expires_at"),
    )


@router.post("/claim", response_model=ClaimResponse)
def claim_carrot(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ClaimResponse:
    """Trigger the $50 transfer. Gates checked in order:
      1. Active paid subscription
      2. Onboarded sub-merchant
      3. Either 5K views OR 5 paid affiliates
    Then call Whop transfers.create with net = gross - 5% LC protocol fee."""

    if not whop_payments.is_live():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Whop payouts are not live yet.",
        )

    if not _has_active_paid_sub(user):
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            "Active paid subscription required to claim the $50 reward.",
        )

    sub_merchant_id = getattr(user, "whop_sub_merchant_id", None)
    if not sub_merchant_id or getattr(user, "whop_sub_merchant_status", "") != "onboarded":
        raise HTTPException(
            status.HTTP_412_PRECONDITION_FAILED,
            "Complete the Whop wallet onboarding before claiming. POST /me/carrot/onboard.",
        )

    views = _user_lifetime_views(db, user.id)
    affiliates = _user_affiliate_count(user)
    if not (views >= CARROT_VIEW_THRESHOLD or affiliates >= CARROT_AFFILIATE_THRESHOLD):
        raise HTTPException(
            status.HTTP_412_PRECONDITION_FAILED,
            f"Threshold not met · need {CARROT_VIEW_THRESHOLD:,} views OR "
            f"{CARROT_AFFILIATE_THRESHOLD} paid affiliates.",
        )

    if getattr(user, "carrot_last_claim_at", None) is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This sponsored reward has already been claimed.",
        )

    net, fee = whop_payments.split_gross_to_net_and_fee(CARROT_AMOUNT_USD)

    origin = whop_payments._parent_company_id() or "fake_lc_parent"

    try:
        xfer = whop_payments.create_transfer(
            origin_id=origin,
            destination_id=sub_merchant_id,
            amount_usd=net,
            currency=whop_payments.DEFAULT_PAYOUT_CURRENCY,
            notes="Liquid Clips sponsored reward",
            idempotence_key=f"carrot-{user.id}",
            metadata={
                "reward_kind": "activation_bonus",
                "internal_user_id": user.id,
                "lc_protocol_fee_usd": fee,
                "gross_usd": CARROT_AMOUNT_USD,
            },
        )
    except httpx.HTTPError as e:
        return ClaimResponse(
            state="approved",
            transfer_id=None,
            gross_usd=CARROT_AMOUNT_USD,
            fee_usd=fee,
            net_usd=net,
            currency=whop_payments.DEFAULT_PAYOUT_CURRENCY,
            error=f"Whop transfer failed: {e!s}",
            is_live=whop_payments.is_live(),
        )

    # Update lifetime ledger on the user row (idempotent column).
    if hasattr(user, "carrot_total_paid_usd_cents"):
        user.carrot_total_paid_usd_cents = (user.carrot_total_paid_usd_cents or 0) + int(round(net * 100))
    if hasattr(user, "carrot_last_claim_at"):
        user.carrot_last_claim_at = datetime.now(timezone.utc)
    db.commit()

    return ClaimResponse(
        state="paid",
        transfer_id=xfer.get("id"),
        gross_usd=CARROT_AMOUNT_USD,
        fee_usd=fee,
        net_usd=net,
        currency=whop_payments.DEFAULT_PAYOUT_CURRENCY,
        error=None,
        is_live=bool(xfer.get("live", False)),
    )
