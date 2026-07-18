"""Reconcile Liquid Clips affiliate commission terms with Whop.

Rewritten 2026-07-18 · business logic simplified to single flat rate.

BUSINESS RULES (LOCKED):
- Only paying Liquid Clips subscribers earn affiliate commission.
- Gate: subscription_status == "active" AND tier != "free"
- Rate: flat 50% rev-share of every payment forever (rev_share · all_payments)
- Applies to every recurring Liquid Clips plan
- Immediate activation on first payment.succeeded (no qualification ladder)
- Instant pause on subscription lapse (all overrides deleted)
- Whop enforces its own 30-day refund/dispute hold before payout (untouchable)
- Balance already earned stays with the user even after they stop paying

Whop owns attribution, earnings tracking, refunds, hold windows, and payouts.
This service only tells Whop what commission terms to apply to each user's
referrals.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import User

log = logging.getLogger("junior.affiliate_commission")

COMMISSION_PERCENT = 50

# --- Reporting-only compat shims -----------------------------------------
# The qualification ladder was retired 2026-07-18 · commission is now a
# flat 50% for any paying subscriber. The two symbols below are preserved
# ONLY as informational/reporting values used by the admin panel + the
# affiliate dashboard's `qualification` block. They no longer gate money.
QUALIFY_PAID_REFERRALS = 2
GOOD_STANDING_DAYS = 7
# -------------------------------------------------------------------------

# Recurring Liquid Clips plans. The $500 Founder Lifetime plan is one-time
# and intentionally omitted; the $99.99/mo Founder Access plan is monthly
# recurring and pays 50% MRR to the referrer like the standard tiers.
RECURRING_PLAN_IDS = (
    "plan_qe8AFXj9J3SWi",  # Solo
    "plan_dhssNse4FfPlI",  # Pro
    "plan_BvDBrtybhbxNg",  # Agency
    "plan_VWj1uoy2RcOsg",  # LEGACY Founder Access · grandfathered
    "plan_svbzoXoT4oj6b",  # PRIOR Founder Access · trial-based · grandfathered
    "plan_NMKvKj8SVVKsY",  # Founder Access v2 · $99.99/mo · immediate charge · rotated 2026-07-05 post-ship-walk
)

WHOP_API_BASE = "https://api.whop.com/api/v1"


def _affiliate_tokens(user: User) -> tuple[str, ...]:
    return tuple(
        token
        for token in (user.whop_affiliate_id, user.whop_affiliate_code)
        if token
    )


def eligible_referral_count(
    db: Session,
    referrer: User,
    *,
    now: datetime | None = None,
) -> int:
    """Count referrals whose first payment cleared the reporting hold.

    RETAINED FOR REPORTING ONLY (2026-07-18). No longer gates commission
    rate. Surfaces `X of 2` progress on the affiliate dashboard + admin
    detail panel. Money-gating uses `reconcile_user`'s `is_paying` check
    instead.
    """
    tokens = _affiliate_tokens(referrer)
    if not tokens:
        return 0
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=GOOD_STANDING_DAYS)
    return (
        db.query(User)
        .filter(
            User.affiliate_id.in_(tokens),
            User.subscription_status == "active",
            User.first_paid_at.isnot(None),
            User.first_paid_at <= cutoff,
            User.id != referrer.id,
        )
        .count()
    )


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {get_settings().whop_api_key}",
        "Content-Type": "application/json",
    }


def _list_overrides(affiliate_id: str) -> list[dict[str, Any]]:
    with httpx.Client(timeout=20.0, headers=_headers()) as client:
        response = client.get(
            f"{WHOP_API_BASE}/affiliates/{affiliate_id}/overrides",
            params={"first": 100},
        )
        response.raise_for_status()
        body = response.json()
    return list(body.get("data") or [])


def _terms() -> dict[str, Any]:
    """Single flat commission terms · locked 2026-07-18."""
    return {
        "commission_type": "percentage",
        "commission_value": COMMISSION_PERCENT,
        "applies_to_payments": "all_payments",
    }


def _create_override(affiliate_id: str, plan_id: str) -> dict[str, Any]:
    payload = {
        "id": affiliate_id,
        "override_type": "standard",
        "plan_id": plan_id,
        **_terms(),
    }
    with httpx.Client(timeout=20.0, headers=_headers()) as client:
        response = client.post(
            f"{WHOP_API_BASE}/affiliates/{affiliate_id}/overrides",
            json=payload,
        )
        response.raise_for_status()
        return dict(response.json())


def _update_override(
    affiliate_id: str,
    override_id: str,
    plan_id: str,
) -> dict[str, Any]:
    payload = {
        "id": affiliate_id,
        "override_type": "standard",
        "plan_id": plan_id,
        **_terms(),
    }
    with httpx.Client(timeout=20.0, headers=_headers()) as client:
        response = client.patch(
            f"{WHOP_API_BASE}/affiliates/{affiliate_id}/overrides/{override_id}",
            json=payload,
        )
        response.raise_for_status()
        return dict(response.json())


def _delete_override(affiliate_id: str, override_id: str) -> None:
    with httpx.Client(timeout=20.0, headers=_headers()) as client:
        response = client.delete(
            f"{WHOP_API_BASE}/affiliates/{affiliate_id}/overrides/{override_id}",
        )
        response.raise_for_status()


def _matches_terms(row: dict[str, Any], plan_id: str) -> bool:
    try:
        value = float(row.get("commission_value") or 0)
    except (TypeError, ValueError):
        value = 0
    return (
        row.get("override_type") == "standard"
        and row.get("plan_id") == plan_id
        and row.get("commission_type") == "percentage"
        and value == COMMISSION_PERCENT
        and row.get("applies_to_payments") == "all_payments"
    )


def _reconcile_overrides(user: User) -> list[str]:
    existing = _list_overrides(user.whop_affiliate_id)
    ids: list[str] = []
    for plan_id in RECURRING_PLAN_IDS:
        match = next(
            (
                row
                for row in existing
                if row.get("override_type") == "standard"
                and row.get("plan_id") == plan_id
            ),
            None,
        )
        if match and _matches_terms(match, plan_id):
            row = match
        elif match and match.get("id"):
            row = _update_override(
                user.whop_affiliate_id,
                str(match["id"]),
                plan_id,
            )
        else:
            row = _create_override(user.whop_affiliate_id, plan_id)
        override_id = row.get("id")
        if not override_id:
            raise RuntimeError(f"Whop returned no override id for {plan_id}")
        ids.append(str(override_id))
    return ids


def _activate(db: Session, user: User) -> bool:
    ids = _reconcile_overrides(user)
    user.affiliate_commission_override_ids = ids
    user.whop_commission_override_id = ids[0]
    db.commit()
    return True


def _pause(db: Session, user: User) -> bool:
    override_ids = list(user.affiliate_commission_override_ids or [])
    if not override_ids and not user.whop_commission_override_id:
        return False
    if user.whop_commission_override_id and user.whop_commission_override_id not in override_ids:
        override_ids.append(user.whop_commission_override_id)
    for override_id in override_ids:
        _delete_override(user.whop_affiliate_id, override_id)
    user.affiliate_commission_override_ids = []
    user.whop_commission_override_id = None
    db.commit()
    return True


def create_affiliate_identity(user: User) -> dict[str, Any] | None:
    """Mint a Whop affiliate identity for `user` if one doesn't exist.

    Called from `_handle_payment_succeeded` on first paid conversion so
    the user is ready to earn 50% on downstream referrals immediately.
    Idempotent at the call site: caller checks `user.whop_affiliate_id`
    is None before invoking. Returns the parsed Whop response body, or
    None if the money gate is off / config is missing.
    """
    settings = get_settings()
    if not settings.affiliate_commission_live:
        return None
    if not settings.whop_api_key:
        return None
    payload = {
        "user_identifier": user.email,
        "company_id": settings.whop_company_id,
    }
    with httpx.Client(timeout=20.0, headers=_headers()) as client:
        response = client.post(
            f"{WHOP_API_BASE}/affiliates",
            json=payload,
        )
        response.raise_for_status()
        return dict(response.json())


def reconcile_user(db: Session, user: User, *, now: datetime | None = None) -> str:
    """Reconcile a single user's Whop overrides against the flat-rate rule.

    Returns one of:
      * "unavailable" — no Whop affiliate identity yet (nothing to do)
      * "dry_run"    — money gate off (no live Whop calls)
      * "active"     — paying subscriber · 50% overrides synced
      * "paused"     — non-paying · all overrides deleted
      * "inactive"   — non-paying with nothing to tear down
    """
    del now  # ladder retired · timing input no longer needed
    settings = get_settings()

    if not user.whop_affiliate_id:
        return "unavailable"

    if not settings.affiliate_commission_live:
        return "dry_run"

    if not settings.whop_api_key:
        return "unavailable"

    is_paying = user.subscription_status == "active" and user.tier != "free"

    if is_paying:
        _activate(db, user)
        return "active"

    has_overrides = bool(
        user.affiliate_commission_override_ids or user.whop_commission_override_id
    )
    if has_overrides:
        _pause(db, user)
        return "paused"
    return "inactive"


def reconcile_all(db: Session, *, now: datetime | None = None) -> dict[str, int]:
    counts: dict[str, int] = {}
    users = db.query(User).filter(
        or_(
            User.whop_affiliate_id.isnot(None),
            User.whop_commission_override_id.isnot(None),
        )
    ).all()
    for user in users:
        try:
            state = reconcile_user(db, user, now=now)
        except Exception:  # noqa: BLE001
            db.rollback()
            log.exception("affiliate commission reconcile failed for user=%s", user.id)
            state = "error"
        counts[state] = counts.get(state, 0) + 1
    return counts
