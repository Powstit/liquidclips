"""Whop Payments SDK wrapper · 2026-06-24.

Server-to-server bridge to Whop's transfers + sub-merchant onboarding + account
reads. Feature-flag gated by CARROT_WHOP_LIVE env var (default FALSE → mock
mode that returns deterministic fake data so the carrot UI can be developed +
tested without touching real money).

Reference: https://docs.whop.com/api-reference/transfers/create-transfer
            https://docs.whop.com/api-reference/ledger-accounts/retrieve-ledger-account
            (account_links + companies.create are platform-payouts endpoints)

Each function returns a dict shaped for our internal use (see Result types at
the top of each function). When CARROT_WHOP_LIVE=true and WHOP_API_KEY +
WHOP_PARENT_COMPANY_ID are set, real HTTP calls are made. Without them,
mock mode returns "fake_*" IDs that the rest of the stack can persist for
testing without breaking on real Whop reads.

Daniel-locked rules (2026-06-24):
  - LC charges a 5% protocol fee deducted from gross BEFORE the transfer
  - Transfers credit the clipper's Whop USD ledger. The clipper then chooses
    their payout method in Whop's hosted payout portal.
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from typing import Any

import httpx

_log = logging.getLogger("junior.whop_payments")

WHOP_API_BASE = "https://api.whop.com"
WHOP_API_VERSION = "/api/v1"

# Daniel-locked economics
LC_PROTOCOL_FEE_PCT = 5.0
MIN_WITHDRAWAL_USD = 10.0
DEFAULT_PAYOUT_CURRENCY = "usd"


def is_live() -> bool:
    """Hard gate · returns True only when both CARROT_WHOP_LIVE=true AND
    a usable WHOP_API_KEY is configured. Defaults to FALSE (mock mode)."""
    flag = os.environ.get("CARROT_WHOP_LIVE", "").strip().lower()
    key_ok = bool(os.environ.get("WHOP_API_KEY") or os.environ.get("WHOP_APP_API_KEY"))
    return flag in ("1", "true", "yes", "on") and key_ok


def _parent_company_id() -> str:
    """Our parent Whop company that owns the sub-merchants we onboard.
    Sourced from WHOP_PARENT_COMPANY_ID (preferred) or WHOP_COMPANY_ID env."""
    return (
        os.environ.get("WHOP_PARENT_COMPANY_ID")
        or os.environ.get("WHOP_COMPANY_ID")
        or ""
    )


def _api_key() -> str:
    """Prefer the app API key (new app) · fall back to the legacy account key."""
    return (
        os.environ.get("WHOP_APP_API_KEY")
        or os.environ.get("WHOP_API_KEY")
        or ""
    )


def _client() -> httpx.Client:
    return httpx.Client(
        base_url=f"{WHOP_API_BASE}{WHOP_API_VERSION}",
        timeout=httpx.Timeout(15.0, connect=5.0),
        headers={
            "Authorization": f"Bearer {_api_key()}",
            "Content-Type": "application/json",
            "User-Agent": "liquidclips-backend/whop-payments",
        },
    )


# ──────── Math helpers (5% LC fee · per Daniel-locked rule) ────────────


def split_gross_to_net_and_fee(gross_usd: float) -> tuple[float, float]:
    """Returns (net_to_clipper, lc_protocol_fee_usd)."""
    fee = round(gross_usd * (LC_PROTOCOL_FEE_PCT / 100.0), 2)
    net = round(gross_usd - fee, 2)
    return net, fee


# ──────── Sub-merchant lifecycle ───────────────────────────────────────


def create_sub_merchant(*, email: str, title: str, internal_user_id: str) -> dict[str, Any]:
    """Onboard a clipper as a sub-merchant under our parent Whop company.

    Returns: {"id": "biz_xxx", "live": bool}.

    Mock mode returns "fake_biz_<short_uuid>" so the rest of the stack can
    persist + verify the ledger without touching Whop."""
    if not is_live():
        fake_id = "fake_biz_" + uuid.uuid4().hex[:12]
        _log.info("[carrot] mock sub-merchant created · fake_id=%s · email=%s", fake_id, email)
        return {"id": fake_id, "live": False}

    parent = _parent_company_id()
    if not parent:
        raise RuntimeError("WHOP_PARENT_COMPANY_ID (or WHOP_COMPANY_ID) not set · cannot onboard sub-merchant")

    with _client() as c:
        r = c.post(
            "/companies",
            json={
                "email": email,
                "parent_company_id": parent,
                "title": title,
                "metadata": {"internal_user_id": internal_user_id},
            },
        )
        r.raise_for_status()
        data = r.json()
        return {"id": data.get("id") or data.get("company_id"), "live": True, "raw": data}


def create_onboarding_link(
    *,
    sub_merchant_id: str,
    return_url: str,
    refresh_url: str,
) -> dict[str, Any]:
    """Generate a short-lived URL the clipper opens to complete Whop's hosted
    KYC + bank/wallet linking. Returns {"url": "https://whop.com/..."}.

    Mock mode returns a synthetic URL we can land on locally to simulate the
    completion callback."""
    if not is_live():
        fake = (
            f"https://api.liquidclips.app/dev/mock-whop-onboarding"
            f"?sub_merchant_id={sub_merchant_id}&return={return_url}"
        )
        _log.info("[carrot] mock onboarding link · %s", fake)
        return {"url": fake, "live": False}

    with _client() as c:
        r = c.post(
            "/account_links",
            json={
                "company_id": sub_merchant_id,
                "refresh_url": refresh_url,
                "return_url": return_url,
                "use_case": "account_onboarding",
            },
        )
        r.raise_for_status()
        data = r.json()
        return {"url": data.get("url"), "live": True, "raw": data}


def create_payouts_portal_link(
    *,
    sub_merchant_id: str,
    return_url: str,
    refresh_url: str,
) -> dict[str, Any]:
    """Generate a short-lived Whop-hosted portal URL for balances,
    payout methods, KYC, and withdrawals."""
    if not is_live():
        raise RuntimeError("Whop payouts are not live")

    with _client() as c:
        r = c.post(
            "/account_links",
            json={
                "company_id": sub_merchant_id,
                "refresh_url": refresh_url,
                "return_url": return_url,
                "use_case": "payouts_portal",
            },
        )
        r.raise_for_status()
        data = r.json()
        return {"url": data.get("url"), "live": True, "raw": data}


# ──────── Transfer (the actual $50 carrot payout) ──────────────────────


def create_transfer(
    *,
    origin_id: str,
    destination_id: str,
    amount_usd: float,
    currency: str = DEFAULT_PAYOUT_CURRENCY,
    notes: str = "",
    idempotence_key: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Credit USD (or another Whop-supported currency) from our org account to a
    clipper's sub-merchant. Returns the Whop transfer object.

    Mock mode returns a deterministic synthetic transfer (status="completed",
    fake_transfer_id) so the rest of the stack can persist a ledger row +
    flip the carrot state machine to "paid" without touching real money.
    """
    if not is_live():
        fake = {
            "id": "fake_xfer_" + uuid.uuid4().hex[:14],
            "type": "wallet_send",
            "origin_id": origin_id,
            "destination_id": destination_id,
            "amount": amount_usd,
            "currency": currency,
            "status": "completed",
            "fee_amount": 0,
            "notes": notes,
            "metadata": metadata or {},
            "created_at": int(time.time()),
            "live": False,
        }
        _log.info(
            "[carrot] mock transfer · $%s %s → %s · id=%s",
            amount_usd, currency.upper(), destination_id, fake["id"],
        )
        return fake

    idempotence = idempotence_key or ("lc_" + uuid.uuid4().hex)
    payload: dict[str, Any] = {
        "origin_id": origin_id,
        "destination_id": destination_id,
        "amount": amount_usd,
        "currency": currency,
        "idempotence_key": idempotence,
    }
    if notes:
        payload["notes"] = notes
    if metadata:
        payload["metadata"] = metadata

    with _client() as c:
        r = c.post("/transfers", json=payload)
        r.raise_for_status()
        return {**r.json(), "live": True}


# ──────── Account read (for sub-merchant wallet + capabilities) ────────


def retrieve_account(account_id: str) -> dict[str, Any]:
    """GET /ledger_accounts/{id} and adapt it to the small internal shape
    consumed by the wallet and sponsored-reward routes.

    The endpoint accepts a connected company's biz_* id directly."""
    if not is_live() or account_id.startswith("fake_"):
        return {
            "id": account_id,
            "title": "Mock Clipper Sub-Merchant",
            "status": "active",
            "wallet": {"id": None, "address": None, "network": None},
            "capabilities": {
                "crypto_payout": "active",
                "transfer": "active",
                "instant_payout": "active",
                "standard_payout": "active",
                "crypto_deposit": "active",
                "bank_deposit": "active",
                "accept_card_payments": "active",
                "accept_bank_payments": "inactive",
                "accept_bnpl_payments": "inactive",
                "card_deposit": "inactive",
                "card_issuing": "inactive",
            },
            "verification": {
                "individual": {"status": "approved"},
                "business": None,
            },
            "balances": [],
            "total_usd": "0",
            "live": False,
        }

    with _client() as c:
        r = c.get(f"/ledger_accounts/{account_id}")
        r.raise_for_status()
        data = r.json()
        payout = data.get("payout_account_details") or {}
        payout_status = str(payout.get("status") or "not_started")
        return {
            **data,
            "status": payout_status,
            "wallet": {"id": None, "address": None, "network": None},
            "capabilities": {
                "crypto_payout": "active" if payout_status == "connected" else payout_status,
                "standard_payout": "active" if payout_status == "connected" else payout_status,
            },
            "verification": payout.get("latest_verification"),
            "payout_account_details": payout,
            "live": True,
        }
