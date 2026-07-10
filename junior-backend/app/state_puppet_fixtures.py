"""State Puppeteer fixtures — Lane B · Chapter 5 (2026-07-10).

State-puppet fixtures — NEVER customer data.

Every dict in this module is a hand-written, admin-only synthetic
response body. They exist so Daniel (or another admin) can flip any
given user's `/me/wallet/summary` response to one of the six documented
data states without touching the customer's real ledger — useful for:

  · demoing the cancellation-intercept sheet to a beta cohort
  · driving Playwright walk-throughs against real backend + fixture data
  · repro-ing a "grace period" bug without waiting for the real clock

Rules
-----
  1. NO real customer values EVER live in here. Every dollar figure,
     campaign slug, and username is either invented or `state_puppet_*`
     prefixed.
  2. Shape MUST match `WalletSummaryResponse` in `app/routes/me_wallet.py`
     — the route feeds one of these dicts back through `WalletSummaryResponse(**fixture)`.
  3. Each fixture MUST include the top-level `balance_cents`,
     `pending_cents`, `next_payout_at`, and `recent_ledger` fields
     introduced by the G2 Layer-6 ledger surface. Missing keys → 500.
  4. The six states are the ONLY six recognised state keys. Anything
     else raises 400 in the route.

Six states
----------
  fresh_install : brand-new install; wallet empty, no submissions, no
                  ledger. Withdraw block visible but "not_started".
  populated     : mid-funnel clipper; submissions in flight, some paid,
                  some rejected. Wallet non-zero.
  paid_normal   : power user, healthy monthly paid, ledger with three
                  payouts, next_payout_at in ~5 days.
  paid_streak   : whale user, 12+ payouts, streak-flagged, wallet has a
                  balance ready to withdraw (payout_ready=true).
  grace         : subscription lapsed into grace period; withdraw is
                  live but next_payout_at pushed out; ledger frozen.
  cancelled     : cancelled subscription; withdraw is FROZEN; balance
                  shows locked funds ready to refund once contract
                  window closes.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

# Every fixture leaves timestamps blank (None) or ISO-strings we compute
# at call time. That way the fixture module is import-safe (no time-of-
# import side effects) and the responses always look "recent" enough
# that HQ demos don't need to work around a frozen clock.


VALID_STATES = (
    "fresh_install",
    "populated",
    "paid_normal",
    "paid_streak",
    "grace",
    "cancelled",
)

VALID_SURFACES = (
    "wallet-detail",
    "sync-mail-money-drop",
    "catalog-carousel",
    "cancellation-intercept",
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _future_iso(days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def _past_iso(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


# ─── FRESH INSTALL ────────────────────────────────────────────────────
def _fixture_fresh_install() -> dict[str, Any]:
    return {
        "pipeline": {
            "in_review_usd_cents": 0,
            "approved_usd_cents": 0,
            "paid_usd_cents": 0,
            "rejected_usd_cents": 0,
            "total_pipeline_usd_cents": 0,
        },
        "stats": {
            "lifetime_views": 0,
            "total_submissions": 0,
            "approval_rate_pct": 0,
            "affiliate_revenue_usd_cents": 0,
        },
        "campaigns": [],
        "recent_activity": [],
        "withdraw": {
            "is_live": True,
            "min_withdrawal_usd": 25.0,
            "lc_fee_pct": 0.05,
            "currency": "USD",
            "setup_available": True,
            "payout_ready": False,
            "payout_status": "not_started",
            "available_usd_cents": 0,
            "pending_usd_cents": 0,
            "reserve_usd_cents": 0,
            "destination_wallet": None,
        },
        "balance_cents": 0,
        "pending_cents": 0,
        "next_payout_at": None,
        "recent_ledger": [],
    }


# ─── POPULATED ────────────────────────────────────────────────────────
def _fixture_populated() -> dict[str, Any]:
    return {
        "pipeline": {
            "in_review_usd_cents": 4200,   # $42
            "approved_usd_cents": 12500,   # $125
            "paid_usd_cents": 6800,        # $68
            "rejected_usd_cents": 1500,    # $15
            "total_pipeline_usd_cents": 23500,
        },
        "stats": {
            "lifetime_views": 148_920,
            "total_submissions": 14,
            "approval_rate_pct": 63,
            "affiliate_revenue_usd_cents": 0,
        },
        "campaigns": [
            {
                "slug": "state_puppet_uncle_daniel_hooks",
                "title": "State Puppet · Uncle Daniel Hooks",
                "brand": "Liquid Clips (fixture)",
                "banner_url": None,
                "views": 88_300,
                "submissions": 6,
                "approved": 4,
                "earned_usd_cents": 8800,
                "status": "active",
            },
            {
                "slug": "state_puppet_agency_streak",
                "title": "State Puppet · Agency Streak",
                "brand": "Liquid Clips (fixture)",
                "banner_url": None,
                "views": 60_620,
                "submissions": 8,
                "approved": 5,
                "earned_usd_cents": 10500,
                "status": "active",
            },
        ],
        "recent_activity": [
            {
                "at": _past_iso(1),
                "kind": "approved",
                "label": "Approved for $42.00 from Uncle Daniel Hooks (fixture)",
                "campaign_slug": "state_puppet_uncle_daniel_hooks",
                "amount_usd_cents": 4200,
            },
            {
                "at": _past_iso(2),
                "kind": "paid",
                "label": "Paid $68.00 from Agency Streak (fixture)",
                "campaign_slug": "state_puppet_agency_streak",
                "amount_usd_cents": 6800,
            },
            {
                "at": _past_iso(3),
                "kind": "submitted",
                "label": "Submitted to Uncle Daniel Hooks (fixture)",
                "campaign_slug": "state_puppet_uncle_daniel_hooks",
                "amount_usd_cents": None,
            },
        ],
        "withdraw": {
            "is_live": True,
            "min_withdrawal_usd": 25.0,
            "lc_fee_pct": 0.05,
            "currency": "USD",
            "setup_available": True,
            "payout_ready": False,
            "payout_status": "pending",
            "available_usd_cents": 0,
            "pending_usd_cents": 6800,
            "reserve_usd_cents": 0,
            "destination_wallet": None,
        },
        "balance_cents": 0,
        "pending_cents": 6800,
        "next_payout_at": _future_iso(9),
        "recent_ledger": [
            {
                "id": "state_puppet_led_001",
                "type": "credit",
                "amount_cents": 6800,
                "currency": "USD",
                "source": "campaign_approval",
                "whop_membership_id": None,
                "period_start": _past_iso(3),
                "created_at": _past_iso(2),
            }
        ],
    }


# ─── PAID · NORMAL ────────────────────────────────────────────────────
def _fixture_paid_normal() -> dict[str, Any]:
    return {
        "pipeline": {
            "in_review_usd_cents": 3300,
            "approved_usd_cents": 22000,
            "paid_usd_cents": 48000,
            "rejected_usd_cents": 900,
            "total_pipeline_usd_cents": 73300,
        },
        "stats": {
            "lifetime_views": 622_400,
            "total_submissions": 41,
            "approval_rate_pct": 78,
            "affiliate_revenue_usd_cents": 0,
        },
        "campaigns": [
            {
                "slug": "state_puppet_carousel_top",
                "title": "State Puppet · Carousel Top (fixture)",
                "brand": "Liquid Clips (fixture)",
                "banner_url": None,
                "views": 411_200,
                "submissions": 22,
                "approved": 17,
                "earned_usd_cents": 32000,
                "status": "active",
            },
        ],
        "recent_activity": [
            {
                "at": _past_iso(0),
                "kind": "paid",
                "label": "Paid $110.00 from Carousel Top (fixture)",
                "campaign_slug": "state_puppet_carousel_top",
                "amount_usd_cents": 11000,
            },
            {
                "at": _past_iso(1),
                "kind": "paid",
                "label": "Paid $95.00 from Carousel Top (fixture)",
                "campaign_slug": "state_puppet_carousel_top",
                "amount_usd_cents": 9500,
            },
            {
                "at": _past_iso(2),
                "kind": "approved",
                "label": "Approved for $220.00 from Carousel Top (fixture)",
                "campaign_slug": "state_puppet_carousel_top",
                "amount_usd_cents": 22000,
            },
        ],
        "withdraw": {
            "is_live": True,
            "min_withdrawal_usd": 25.0,
            "lc_fee_pct": 0.05,
            "currency": "USD",
            "setup_available": True,
            "payout_ready": True,
            "payout_status": "connected",
            "available_usd_cents": 22000,
            "pending_usd_cents": 4500,
            "reserve_usd_cents": 0,
            "destination_wallet": "0xST…PUPT",
        },
        "balance_cents": 22000,
        "pending_cents": 4500,
        "next_payout_at": _future_iso(5),
        "recent_ledger": [
            {
                "id": "state_puppet_led_101",
                "type": "payout",
                "amount_cents": 11000,
                "currency": "USD",
                "source": "whop_payout",
                "whop_membership_id": "state_puppet_mem_A",
                "period_start": _past_iso(30),
                "created_at": _past_iso(0),
            },
            {
                "id": "state_puppet_led_102",
                "type": "payout",
                "amount_cents": 9500,
                "currency": "USD",
                "source": "whop_payout",
                "whop_membership_id": "state_puppet_mem_A",
                "period_start": _past_iso(60),
                "created_at": _past_iso(1),
            },
            {
                "id": "state_puppet_led_103",
                "type": "credit",
                "amount_cents": 22000,
                "currency": "USD",
                "source": "campaign_approval",
                "whop_membership_id": None,
                "period_start": _past_iso(7),
                "created_at": _past_iso(2),
            },
        ],
    }


# ─── PAID · STREAK ────────────────────────────────────────────────────
def _fixture_paid_streak() -> dict[str, Any]:
    return {
        "pipeline": {
            "in_review_usd_cents": 8800,
            "approved_usd_cents": 61000,
            "paid_usd_cents": 320_000,
            "rejected_usd_cents": 400,
            "total_pipeline_usd_cents": 389_800,
        },
        "stats": {
            "lifetime_views": 4_120_000,
            "total_submissions": 178,
            "approval_rate_pct": 88,
            "affiliate_revenue_usd_cents": 0,
        },
        "campaigns": [
            {
                "slug": "state_puppet_streak_hero",
                "title": "State Puppet · Streak Hero (fixture)",
                "brand": "Liquid Clips (fixture)",
                "banner_url": None,
                "views": 2_800_000,
                "submissions": 96,
                "approved": 84,
                "earned_usd_cents": 240_000,
                "status": "active",
            },
        ],
        "recent_activity": [
            {
                "at": _past_iso(0),
                "kind": "paid",
                "label": "Paid $410.00 from Streak Hero (fixture)",
                "campaign_slug": "state_puppet_streak_hero",
                "amount_usd_cents": 41000,
            },
        ],
        "withdraw": {
            "is_live": True,
            "min_withdrawal_usd": 25.0,
            "lc_fee_pct": 0.05,
            "currency": "USD",
            "setup_available": True,
            "payout_ready": True,
            "payout_status": "connected",
            "available_usd_cents": 61000,
            "pending_usd_cents": 8800,
            "reserve_usd_cents": 0,
            "destination_wallet": "0xST…PUPT",
        },
        "balance_cents": 61000,
        "pending_cents": 8800,
        "next_payout_at": _future_iso(3),
        "recent_ledger": [
            {
                "id": f"state_puppet_led_2{i:02d}",
                "type": "payout",
                "amount_cents": 41000,
                "currency": "USD",
                "source": "whop_payout",
                "whop_membership_id": "state_puppet_mem_S",
                "period_start": _past_iso(30 * (i + 1)),
                "created_at": _past_iso(i),
            }
            for i in range(3)
        ],
    }


# ─── GRACE ────────────────────────────────────────────────────────────
def _fixture_grace() -> dict[str, Any]:
    return {
        "pipeline": {
            "in_review_usd_cents": 0,
            "approved_usd_cents": 15000,
            "paid_usd_cents": 88000,
            "rejected_usd_cents": 300,
            "total_pipeline_usd_cents": 103_000,
        },
        "stats": {
            "lifetime_views": 812_000,
            "total_submissions": 62,
            "approval_rate_pct": 71,
            "affiliate_revenue_usd_cents": 0,
        },
        "campaigns": [],
        "recent_activity": [
            {
                "at": _past_iso(5),
                "kind": "paid",
                "label": "Last payout · $180.00 (fixture)",
                "campaign_slug": None,
                "amount_usd_cents": 18000,
            }
        ],
        "withdraw": {
            "is_live": True,
            "min_withdrawal_usd": 25.0,
            "lc_fee_pct": 0.05,
            "currency": "USD",
            "setup_available": True,
            "payout_ready": True,
            "payout_status": "grace",
            "available_usd_cents": 15000,
            "pending_usd_cents": 0,
            "reserve_usd_cents": 3000,
            "destination_wallet": "0xST…PUPT",
        },
        "balance_cents": 15000,
        "pending_cents": 0,
        "next_payout_at": _future_iso(14),
        "recent_ledger": [
            {
                "id": "state_puppet_led_g01",
                "type": "credit",
                "amount_cents": 15000,
                "currency": "USD",
                "source": "campaign_approval",
                "whop_membership_id": None,
                "period_start": _past_iso(10),
                "created_at": _past_iso(6),
            }
        ],
    }


# ─── CANCELLED ────────────────────────────────────────────────────────
def _fixture_cancelled() -> dict[str, Any]:
    return {
        "pipeline": {
            "in_review_usd_cents": 0,
            "approved_usd_cents": 0,
            "paid_usd_cents": 44000,
            "rejected_usd_cents": 0,
            "total_pipeline_usd_cents": 44000,
        },
        "stats": {
            "lifetime_views": 210_000,
            "total_submissions": 22,
            "approval_rate_pct": 55,
            "affiliate_revenue_usd_cents": 0,
        },
        "campaigns": [],
        "recent_activity": [
            {
                "at": _past_iso(21),
                "kind": "paid",
                "label": "Final payout · $130.00 (fixture)",
                "campaign_slug": None,
                "amount_usd_cents": 13000,
            }
        ],
        "withdraw": {
            "is_live": True,
            "min_withdrawal_usd": 25.0,
            "lc_fee_pct": 0.05,
            "currency": "USD",
            "setup_available": False,
            "payout_ready": False,
            "payout_status": "frozen",
            "available_usd_cents": 0,
            "pending_usd_cents": 0,
            "reserve_usd_cents": 4400,
            "destination_wallet": None,
        },
        "balance_cents": 0,
        "pending_cents": 0,
        "next_payout_at": None,
        "recent_ledger": [
            {
                "id": "state_puppet_led_c01",
                "type": "payout",
                "amount_cents": 13000,
                "currency": "USD",
                "source": "whop_payout",
                "whop_membership_id": "state_puppet_mem_C",
                "period_start": _past_iso(45),
                "created_at": _past_iso(21),
            }
        ],
    }


_BUILDERS: dict[str, Any] = {
    "fresh_install": _fixture_fresh_install,
    "populated": _fixture_populated,
    "paid_normal": _fixture_paid_normal,
    "paid_streak": _fixture_paid_streak,
    "grace": _fixture_grace,
    "cancelled": _fixture_cancelled,
}


def wallet_summary_fixture(state: str) -> dict[str, Any]:
    """Return the wallet-summary fixture for a state. Raises KeyError
    on an unknown state so the caller can 400 it cleanly."""
    builder = _BUILDERS[state]
    return builder()
