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


def wallet_reads_live() -> bool:
    """Read-only ledger access is safe independently of transfer enablement."""
    return bool(_api_key())


def wallet_onboarding_live() -> bool:
    """Connected-account creation/KYC can be enabled before transfers."""
    flag = os.environ.get("WHOP_WALLET_ONBOARDING_LIVE", "").strip().lower()
    return (
        flag in ("1", "true", "yes", "on")
        and bool(_api_key())
        and bool(_parent_company_id())
    )


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
    if not wallet_onboarding_live():
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
    if not wallet_onboarding_live():
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
    if not wallet_onboarding_live():
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


# ──────── Plans (subscription products) ────────────────────────────────
#
# 2026-07-02 · Phase 2 of the 3-tier agency ladder. Plans hang off a
# Whop "access pass" (product); one plan = one price point + interval.
# Ladder: $50/mo · $299/mo · $500/mo — all under the existing Liquid
# Clips access pass. We create these via the V5 REST endpoint, which
# lives at `POST https://api.whop.com/v5/plans` and returns the created
# plan's `plan_xxx` id. The V1 sub-merchant + transfer endpoints stay
# on `/api/v1`; only plans use V5.
#
# Idempotence: `list_plans_for_access_pass` looks up by title FIRST so
# re-running the create script never double-creates. If the Whop API
# rejects plan creation via API for this account (some accounts require
# dashboard-only creation), the helper raises `WhopPlansAPIUnavailable`
# so the caller can fall back to reading the plan IDs from env vars
# Daniel pasted after hand-creating in the dashboard.


class WhopPlansAPIUnavailable(RuntimeError):
    """Raised when the Whop API refuses plan-create/list access for this
    account. Fall back to dashboard creation + env-var plan IDs."""


_WHOP_V5_BASE = "https://api.whop.com/v5"


def _v5_client() -> httpx.Client:
    """Whop V5 REST client — used for plan create/list. The V1 endpoints
    (sub-merchant / transfer / ledger) keep their own `_client()`."""
    return httpx.Client(
        base_url=_WHOP_V5_BASE,
        timeout=httpx.Timeout(15.0, connect=5.0),
        headers={
            "Authorization": f"Bearer {_api_key()}",
            "Content-Type": "application/json",
            "User-Agent": "liquidclips-backend/whop-plans",
        },
    )


def list_plans_for_access_pass(access_pass_id: str) -> list[dict[str, Any]]:
    """Fetch every plan currently attached to the given access pass. Used
    by the create script for idempotence (title-lookup before create).

    Raises `WhopPlansAPIUnavailable` on 401/403/404 so the caller can
    switch to dashboard-created plan IDs pasted into env vars."""
    if not _api_key():
        raise WhopPlansAPIUnavailable("WHOP_API_KEY missing · cannot list plans")
    with _v5_client() as c:
        r = c.get(f"/access_passes/{access_pass_id}/plans")
        if r.status_code in (401, 403, 404):
            raise WhopPlansAPIUnavailable(
                f"Whop V5 plan listing not available (HTTP {r.status_code}) · "
                f"fall back to dashboard + env-var plan IDs",
            )
        r.raise_for_status()
        data = r.json()
        return list(data.get("data") or data.get("plans") or data)


def create_plan(
    *,
    access_pass_id: str,
    title: str,
    price_cents: int,
    interval: str = "month",
    currency: str = "usd",
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a recurring subscription plan under the given access pass.

    Returns {"id": "plan_xxx", "title": ..., "price_cents": ..., "raw": {...}}.

    Idempotent — first checks list_plans_for_access_pass() for an existing
    plan with the same title (case-insensitive) and returns it unchanged
    if found. Only actually creates when no match exists.

    Raises `WhopPlansAPIUnavailable` if the API refuses; the create script
    catches this and prints an instruction pointing at the Whop dashboard.
    """
    if not _api_key():
        raise WhopPlansAPIUnavailable("WHOP_API_KEY missing · cannot create plans")

    existing = list_plans_for_access_pass(access_pass_id)
    for plan in existing:
        plan_title = (plan.get("title") or plan.get("name") or "").strip().lower()
        if plan_title == title.strip().lower():
            _log.info("[whop-plans] plan already exists · id=%s · title=%s", plan.get("id"), title)
            return {
                "id": plan.get("id"),
                "title": plan.get("title") or plan.get("name"),
                "price_cents": plan.get("amount_in_cents") or plan.get("initial_price"),
                "raw": plan,
                "created": False,
            }

    payload: dict[str, Any] = {
        "access_pass_id": access_pass_id,
        "title": title,
        "initial_price": price_cents / 100.0,
        "renewal_price": price_cents / 100.0,
        "base_currency": currency,
        "billing_period": 30 if interval == "month" else 365,
        "internal_notes": "Liquid Clips agency-tier ladder (Phase 2)",
    }
    if metadata:
        payload["metadata"] = metadata

    with _v5_client() as c:
        r = c.post("/plans", json=payload)
        if r.status_code in (401, 403, 404, 405):
            raise WhopPlansAPIUnavailable(
                f"Whop V5 plan creation refused (HTTP {r.status_code}) · "
                f"create plans in the dashboard and paste the IDs into "
                f"WHOP_PLAN_ID_AGENCY_SOLO / _AGENCY / _AGENCY_WHITELABEL",
            )
        r.raise_for_status()
        data = r.json()
        _log.info("[whop-plans] created · id=%s · $%.2f/%s", data.get("id"), price_cents / 100, interval)
        return {
            "id": data.get("id"),
            "title": data.get("title") or title,
            "price_cents": price_cents,
            "raw": data,
            "created": True,
        }


# ──────── Custom affiliate commission (agency-tier 50% MRR override) ───
#
# Deck slide 07 promise: agency-tier owners "skip the gate and earn from
# day one." Whop's default affiliate flow requires the qualification gate
# (11K views OR 2 paid refs) before 50% unlocks. We bypass this at
# tier-grant time by pushing a custom commission rate onto the owner's
# Whop affiliate record.
#
# Best-effort: if Whop's V5 doesn't expose this endpoint on our account,
# the helper LOGS and returns without raising, so the tier grant itself
# still succeeds. Follow-up: manual per-affiliate rate override in the
# Whop dashboard for the first agency-tier signups until we verify the
# API path.


def set_affiliate_custom_commission(
    *,
    whop_user_id: str,
    rate_bps: int = 5000,
) -> dict[str, Any]:
    """Push a custom affiliate commission rate onto a Whop user record.

    Args:
        whop_user_id: The `user_xxx` id from the membership webhook data.
        rate_bps: Basis points (5000 = 50%). Default 5000 per the deck
                  slide 07 promise for agency-tier owners.

    Returns {"ok": bool, "raw": {...} | None, "note": str}.
    Never raises — a failed override is logged and returned as `ok:False`.
    The caller can still grant the tier locally; the override can be
    re-attempted from an admin surface later.
    """
    result: dict[str, Any] = {"ok": False, "raw": None, "note": ""}
    if not _api_key():
        result["note"] = "WHOP_API_KEY missing · skipping commission override"
        _log.warning("[whop-affiliate] %s", result["note"])
        return result

    try:
        with _v5_client() as c:
            r = c.post(
                f"/users/{whop_user_id}/affiliate/custom_commission",
                json={"rate_bps": rate_bps},
            )
            if r.status_code in (401, 403, 404, 405):
                result["note"] = (
                    f"Whop custom commission API unavailable (HTTP {r.status_code}) · "
                    f"set the rate manually in the Whop dashboard for user_id={whop_user_id}"
                )
                _log.warning("[whop-affiliate] %s", result["note"])
                return result
            r.raise_for_status()
            result["ok"] = True
            result["raw"] = r.json()
            _log.info(
                "[whop-affiliate] custom commission set · user=%s · rate=%d bps",
                whop_user_id, rate_bps,
            )
    except Exception as exc:
        result["note"] = f"whop custom commission call failed: {exc}"
        _log.warning("[whop-affiliate] %s", result["note"])
    return result


# ──────── Account read (for sub-merchant wallet + capabilities) ────────


def retrieve_account(account_id: str) -> dict[str, Any]:
    """GET /ledger_accounts/{id} and adapt it to the small internal shape
    consumed by the wallet and sponsored-reward routes.

    The endpoint accepts a connected company's biz_* id directly."""
    if not wallet_reads_live() or account_id.startswith("fake_"):
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
