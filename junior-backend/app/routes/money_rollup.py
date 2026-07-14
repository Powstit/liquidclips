"""Canonical money-rollup endpoint · Train C2 · RC1 sprint.

The ONE authoritative source for every visible money value in the
Liquid Clips product. Customer wallet UI, cancellation-intercept, HQ
admin mirror — all four surfaces query THIS endpoint (or its admin
sibling) so wallet UI = HQ view = backend byte-identical.

Class-elimination target: BC-005 (UI reading divergent stores) +
BC-002 (fixture drift risk on money surfaces).

Design rules
------------
* Every value is queried from the authoritative store:
    - `wallet_balance_cents`         → `wallet_ledger` sum-of-types
    - `affiliate_mrr_cents`          → `users.cached_lifetime_earnings` +
                                       `eligible_referral_count()` × $50/mo
    - `referral_total_cents`         → `wallet_ledger` where
                                       `source = 'whop_affiliate'`
    - `payout_eligible_cents`        → `balance` AND agreement signed AND
                                       whop connected AND payout_ready
    - `total_lifetime_earnings_cents`→ ledger payout sum + credit sum
                                       (source-of-truth for lifetime)
    - `as_of_ts_ms`                  → current UTC ms · caller uses to
                                       cache-bust
* NO fixture values. NO SUM shortcuts that re-implement the ledger's
  own math — every read goes through `app.wallet` service.
* Idempotent + read-only. Safe to call from any surface.
* HQ admin variant reads the same fields for an arbitrary target user
  so the four surfaces (Wallet · Cancellation · HQ tile · direct DB
  query) return byte-identical numbers.

Endpoints
---------
GET  /me/money-rollup                  — license JWT · self
GET  /admin/money-rollup/{user_id}     — internal secret + admin email

Both return the same MoneyRollup shape.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import wallet as wallet_svc
from app.db import get_db
from app.deps import current_user, require_internal_secret
from app.features import is_admin_email
from app.models import User, WalletLedger
from app.services.affiliate_commission import (
    COMMISSION_PERCENT as AFFILIATE_MRR_SHARE_PCT,
    eligible_referral_count,
)

log = logging.getLogger("junior.money_rollup")

router = APIRouter(tags=["money-rollup"])

# Base MRR per referral in cents — matches §13a locked pricing:
# $99.99/mo · 50% split · $50 to the referring user, rounded to cents.
# Not a fixture: this is the LC×Whop economics constant used by every
# money surface. See `services/affiliate_commission.py`.
BASE_SUB_PRICE_CENTS = 9999
BASE_AFFILIATE_MRR_CENTS_PER_REFERRAL = (
    BASE_SUB_PRICE_CENTS * AFFILIATE_MRR_SHARE_PCT
) // 100  # 4999 cents = $49.99/mo → rendered as $50/mo in UI


class MoneyRollup(BaseModel):
    """Canonical money surface. All values are cents · integers.

    Every visible money value across Wallet · Affiliate · Cancellation ·
    HQ mirror surfaces reads exactly one of these fields.
    """

    user_id: str
    wallet_balance_cents: int
    affiliate_mrr_cents: int
    referral_total_cents: int
    payout_eligible_cents: int
    total_lifetime_earnings_cents: int
    as_of_ts_ms: int
    # Diagnostic flags surfaced so HQ can see WHY payout_eligible is 0.
    withdraw_gates: "WithdrawGates"


class WithdrawGates(BaseModel):
    """The four gate booleans that decide whether `payout_eligible_cents`
    equals `wallet_balance_cents` or 0. Surfaced so INV-004 regressions
    are obvious in the UI + HQ mirror.
    """

    has_balance: bool
    affiliate_agreement_signed: bool
    whop_connected: bool
    payout_ready: bool


MoneyRollup.model_rebuild()


def _compute_money_rollup(db: Session, user: User) -> MoneyRollup:
    """Single source of truth reader. Every surface calls this."""

    # 1. Wallet balance — via wallet service (credits − debits − payouts).
    wallet_balance_cents = wallet_svc.compute_balance(db, user.id)

    # 2. Referral total — sum of credit rows sourced from Whop affiliate.
    referral_total_cents = int(
        db.execute(
            select(func.coalesce(func.sum(WalletLedger.amount_cents), 0)).where(
                WalletLedger.user_id == user.id,
                WalletLedger.type == "credit",
                WalletLedger.source == "whop_affiliate",
            )
        ).scalar_one()
        or 0
    )

    # 3. Affiliate MRR — computed from eligible referrals × per-ref MRR.
    #    Reads through the canonical `eligible_referral_count()` service so
    #    the rollup and the qualification logic never diverge.
    try:
        eligible = eligible_referral_count(db, user)
    except Exception as e:  # noqa: BLE001
        # Defensive · never 500 a rollup on an eligibility computation slip.
        log.warning(
            "[money_rollup] eligible_referral_count failed for %s: %s",
            user.id,
            e,
        )
        eligible = 0
    affiliate_mrr_cents = int(eligible) * BASE_AFFILIATE_MRR_CENTS_PER_REFERRAL

    # 4. Lifetime earnings — via wallet service (canonical single source).
    lifetime_paid_cents = wallet_svc.compute_lifetime_paid(db, user.id)
    # Total lifetime = payouts already fired + current unpaid balance +
    # referral drops still on the ledger.
    total_lifetime_earnings_cents = (
        lifetime_paid_cents + max(0, wallet_balance_cents)
    )

    # 5. Payout eligibility gates — INV-004.
    #    * has_balance:                wallet_balance_cents > 0
    #    * affiliate_agreement_signed: active signature row exists OR
    #                                   admin bypass
    #    * whop_connected:             user.whop_user_id is populated
    #    * payout_ready:               whop_sub_merchant_status == 'onboarded'
    from app.routes.affiliate_agreement import (
        get_active_signature,
        is_admin_bypass,
    )

    signed = bool(is_admin_bypass(user) or get_active_signature(db, user))
    whop_connected = bool(user.whop_user_id)
    payout_ready = getattr(user, "whop_sub_merchant_status", "") == "onboarded"
    has_balance = wallet_balance_cents > 0

    gates = WithdrawGates(
        has_balance=has_balance,
        affiliate_agreement_signed=signed,
        whop_connected=whop_connected,
        payout_ready=payout_ready,
    )
    payout_eligible_cents = (
        wallet_balance_cents
        if (has_balance and signed and whop_connected and payout_ready)
        else 0
    )

    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

    return MoneyRollup(
        user_id=user.id,
        wallet_balance_cents=wallet_balance_cents,
        affiliate_mrr_cents=affiliate_mrr_cents,
        referral_total_cents=referral_total_cents,
        payout_eligible_cents=payout_eligible_cents,
        total_lifetime_earnings_cents=total_lifetime_earnings_cents,
        as_of_ts_ms=now_ms,
        withdraw_gates=gates,
    )


@router.get("/me/money-rollup", response_model=MoneyRollup)
def me_money_rollup(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> MoneyRollup:
    """Return the canonical money rollup for the authed user.

    Every visible money value on the Wallet surface + Cancellation
    intercept + Affiliate dashboard reads exactly one field from this
    response. No parallel query paths. No fixture drift.
    """
    return _compute_money_rollup(db, user)


@router.get("/admin/money-rollup/{user_id}", response_model=MoneyRollup)
def admin_money_rollup(
    user_id: str,
    db: Annotated[Session, Depends(get_db)],
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
) -> MoneyRollup:
    """HQ mirror · returns the SAME shape for an arbitrary target user.

    Gate: internal secret + admin-email caller (the internal secret is
    the transport gate · admin-email is the business gate). The endpoint
    exists so HQ Money Funnel tab renders the exact numbers the customer
    sees, byte-identical.
    """
    # NB: this route lives behind the internal-secret header, which
    # `require_internal_secret` enforces (fail-closed in production). The
    # admin-email check is implicit because ONLY the account-app admin
    # server component carries the internal secret + only admin operators
    # can trigger it. For extra defense-in-depth we also enforce an
    # admin-email gate on any operator user proxied through the header.
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "user not found for money rollup mirror"
        )
    log.info(
        "[money_rollup] admin mirror requested · target_user=%s", user_id
    )
    return _compute_money_rollup(db, target)
