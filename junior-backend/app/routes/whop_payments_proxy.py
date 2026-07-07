"""Whop payments proxy · surface the authenticated user's Whop payment
history to their branded Wallet page without leaking the company API key
to the client.

Ships 2026-07-07 · Sprint Final §1D.

Endpoints:
  GET /me/whop/payments   — history · scoped to user.whop_user_id
  GET /me/whop/wallet     — connected wallet address + currency prefs

Auth: user JWT. Server calls Whop v2 API with `WHOP_ACCOUNT_API_KEY_1`
(never exposed to client), then filters to rows where `user` matches
the authenticated user's `whop_user_id`. If the user has no linked
Whop identity yet (guest / clipper who hasn't upgraded), returns an
empty list · never leaks another user's payments.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.models import User

log = logging.getLogger("junior.whop_payments_proxy")

router = APIRouter(prefix="/me/whop", tags=["whop-proxy"])

_WHOP_API = "https://api.whop.com/api/v2"


class WhopPayment(BaseModel):
    id: str
    final_amount_cents: int
    currency: str
    status: str
    paid_at: str | None
    last_payment_attempt: str | None
    card_brand: str | None
    last4: str | None
    crypto_tx_hash: str | None
    wallet_address: str | None


class PaymentsOut(BaseModel):
    payments: list[WhopPayment]
    total_paid_cents: int
    currency: str
    linked_whop_user_id: str | None


class WalletOut(BaseModel):
    linked_whop_user_id: str | None
    connected_wallet_address: str | None
    currency: str
    manage_url: str  # deep link into Whop's own wallet page for openWhopAction
    affiliate_page_url: str | None


def _whop_api_key() -> str:
    """Read the account API key from env · same key we probe with."""
    return (
        os.environ.get("WHOP_ACCOUNT_API_KEY_1")
        or os.environ.get("WHOP_API_KEY")
        or ""
    )


async def _whop_get(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    key = _whop_api_key()
    if not key:
        return {"data": [], "error": "no_key"}
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(
                f"{_WHOP_API}/{path.lstrip('/')}",
                params=params or {},
                headers={"Authorization": f"Bearer {key}"},
            )
            if r.status_code != 200:
                log.warning("[whop_proxy] %s → %s", path, r.status_code)
                return {"data": [], "error": f"http_{r.status_code}"}
            return r.json()
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("[whop_proxy] %s exc=%s", path, exc)
        return {"data": [], "error": "network"}


@router.get("/payments", response_model=PaymentsOut)
async def whop_payments(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
) -> PaymentsOut:
    """Return this user's Whop payments · filtered server-side.

    Guests (no whop_user_id) get an empty list. Never fabricates data.
    """
    whop_user_id = (user.whop_user_id or "").strip()
    if not whop_user_id:
        return PaymentsOut(
            payments=[], total_paid_cents=0, currency="usd", linked_whop_user_id=None
        )

    # v2/payments returns paginated; we take the first 50 (most recent).
    body = await _whop_get("payments", {"limit": 50})
    rows = body.get("data") or []

    payments: list[WhopPayment] = []
    total_paid_cents = 0
    for r in rows:
        if not isinstance(r, dict):
            continue
        # Filter to authenticated user's payments only.
        if (r.get("user") or "").strip() != whop_user_id:
            continue
        # Convert final_amount (float dollars) to cents.
        try:
            amt_cents = int(round(float(r.get("final_amount") or 0) * 100))
        except (TypeError, ValueError):
            amt_cents = 0

        paid_at_ts = r.get("paid_at")
        paid_at = (
            datetime.fromtimestamp(int(paid_at_ts), tz=timezone.utc).isoformat()
            if isinstance(paid_at_ts, (int, float)) and paid_at_ts > 0
            else None
        )
        last_attempt_ts = r.get("last_payment_attempt")
        last_attempt = (
            datetime.fromtimestamp(int(last_attempt_ts), tz=timezone.utc).isoformat()
            if isinstance(last_attempt_ts, (int, float)) and last_attempt_ts > 0
            else None
        )
        payment = WhopPayment(
            id=str(r.get("id") or ""),
            final_amount_cents=amt_cents,
            currency=str(r.get("currency") or "usd"),
            status=str(r.get("status") or ""),
            paid_at=paid_at,
            last_payment_attempt=last_attempt,
            card_brand=r.get("card_brand"),
            last4=r.get("last4"),
            crypto_tx_hash=r.get("crypto_tx_hash"),
            wallet_address=r.get("wallet_address"),
        )
        payments.append(payment)
        if payment.status == "paid" or payment.paid_at:
            total_paid_cents += amt_cents

    currency = payments[0].currency if payments else "usd"
    return PaymentsOut(
        payments=payments,
        total_paid_cents=total_paid_cents,
        currency=currency,
        linked_whop_user_id=whop_user_id,
    )


@router.get("/wallet", response_model=WalletOut)
async def whop_wallet(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
) -> WalletOut:
    """Return this user's connected wallet address + currency preference
    by reading their most recent membership row from Whop. Used by the
    branded Wallet page above the "Withdraw" CTA."""
    whop_user_id = (user.whop_user_id or "").strip()
    manage_url = "https://whop.com/@me/wallet"
    if not whop_user_id:
        return WalletOut(
            linked_whop_user_id=None,
            connected_wallet_address=None,
            currency="usd",
            manage_url=manage_url,
            affiliate_page_url=None,
        )
    body = await _whop_get("memberships", {"limit": 20})
    rows = body.get("data") or []
    wallet_address: str | None = None
    currency = "usd"
    affiliate_url: str | None = None
    for r in rows:
        if not isinstance(r, dict):
            continue
        if (r.get("user") or "").strip() != whop_user_id:
            continue
        if not wallet_address:
            wa = (r.get("wallet_address") or "").strip()
            if wa:
                wallet_address = wa
        aff = (r.get("affiliate_page_url") or "").strip()
        if aff and not affiliate_url:
            affiliate_url = aff
    return WalletOut(
        linked_whop_user_id=whop_user_id,
        connected_wallet_address=wallet_address,
        currency=currency,
        manage_url=manage_url,
        affiliate_page_url=affiliate_url,
    )
