"""Reconcile Liquid Clips affiliate commission terms with Whop.

Affiliate commission qualification is deliberately separate from Partner
Engine campaign access:

* commission: 2 referred paid customers held active for 7 days;
* Partner Engine: its own 10-referral + verified-channel gate.

Whop owns attribution, earnings, refunds, and payouts. This service creates a
30%-first-payment baseline for active paid members, upgrades it to
50%-all-payments after qualification, and removes overrides when the
referrer's subscription lapses. It is feature-gated so tests and dry runs
never mutate live money settings.
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

QUALIFY_PAID_REFERRALS = 2
GOOD_STANDING_DAYS = 7
BASELINE_PERCENT = 30
COMMISSION_PERCENT = 50

# Recurring Liquid Clips plans. Founder is one-time and intentionally omitted.
RECURRING_PLAN_IDS = (
    "plan_qe8AFXj9J3SWi",  # Pro
    "plan_dhssNse4FfPlI",  # Growth
    "plan_BvDBrtybhbxNg",  # Agency
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
    """Count active referrals whose first payment cleared the 7-day hold."""
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


def _terms(*, qualified: bool) -> dict[str, Any]:
    return {
        "commission_type": "percentage",
        "commission_value": COMMISSION_PERCENT if qualified else BASELINE_PERCENT,
        "applies_to_payments": "all_payments" if qualified else "first_payment",
    }


def _create_override(
    affiliate_id: str,
    plan_id: str,
    *,
    qualified: bool,
) -> dict[str, Any]:
    payload = {
        "id": affiliate_id,
        "override_type": "standard",
        "plan_id": plan_id,
        **_terms(qualified=qualified),
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
    *,
    qualified: bool,
) -> dict[str, Any]:
    payload = {
        "id": affiliate_id,
        "override_type": "standard",
        "plan_id": plan_id,
        **_terms(qualified=qualified),
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


def _matches_terms(
    row: dict[str, Any],
    plan_id: str,
    *,
    qualified: bool,
) -> bool:
    try:
        value = float(row.get("commission_value") or 0)
    except (TypeError, ValueError):
        value = 0
    return (
        row.get("override_type") == "standard"
        and row.get("plan_id") == plan_id
        and row.get("commission_type") == "percentage"
        and value == (COMMISSION_PERCENT if qualified else BASELINE_PERCENT)
        and row.get("applies_to_payments")
        == ("all_payments" if qualified else "first_payment")
    )


def _reconcile_overrides(
    user: User,
    *,
    qualified: bool,
) -> list[str]:
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
        if match and _matches_terms(match, plan_id, qualified=qualified):
            row = match
        elif match and match.get("id"):
            row = _update_override(
                user.whop_affiliate_id,
                str(match["id"]),
                plan_id,
                qualified=qualified,
            )
        else:
            row = _create_override(
                user.whop_affiliate_id,
                plan_id,
                qualified=qualified,
            )
        override_id = row.get("id")
        if not override_id:
            raise RuntimeError(f"Whop returned no override id for {plan_id}")
        ids.append(str(override_id))
    return ids


def _activate(db: Session, user: User) -> bool:
    ids = _reconcile_overrides(user, qualified=True)
    user.affiliate_commission_override_ids = ids
    user.whop_commission_override_id = ids[0]
    if user.affiliate_qualified_at is None:
        user.affiliate_qualified_at = datetime.now(timezone.utc)
    db.commit()
    _fire_qualified_side_effects(db, user)
    return True


def _ensure_baseline(db: Session, user: User) -> bool:
    ids = _reconcile_overrides(user, qualified=False)
    user.affiliate_commission_override_ids = ids
    # Legacy single id denotes qualified 50% only; baseline must not make the
    # dashboard claim the recurring rate is active.
    user.whop_commission_override_id = None
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


def reconcile_user(db: Session, user: User, *, now: datetime | None = None) -> str:
    """Return inactive, dry_run, baseline, active, activated, or paused."""
    settings = get_settings()
    has_overrides = bool(
        user.affiliate_commission_override_ids or user.whop_commission_override_id
    )
    qualified_active = bool(
        user.affiliate_qualified_at and user.whop_commission_override_id
    )
    if has_overrides and not user.whop_affiliate_id:
        return "unavailable"
    member_active = user.subscription_status == "active" and user.tier != "free"
    # v2.2.11 founder bypass · founders earn 50% recurring from the
    # first referral, no 2-paid + 7-day wait. Gated on member_active
    # below so a refunded founder still tears down their overrides via
    # the _pause() path. The qualifier ladder remains:
    #   1. already-stamped affiliate_qualified_at  → keep activated
    #   2. founder_flag                            → bypass earned-by-volume
    #   3. 2 paid referrals · 7 days held          → standard earned path
    qualifies = (
        bool(user.affiliate_qualified_at)
        or bool(getattr(user, "founder_flag", False))
        or (
            eligible_referral_count(db, user, now=now) >= QUALIFY_PAID_REFERRALS
        )
    )

    if not member_active:
        if has_overrides and settings.affiliate_commission_live:
            _pause(db, user)
            return "paused"
        return "inactive"
    if not qualifies:
        if not settings.affiliate_commission_live:
            return "dry_run"
        if not settings.whop_api_key or not user.whop_affiliate_id:
            return "inactive"
        _ensure_baseline(db, user)
        return "baseline"
    if qualified_active:
        return "active"
    if not settings.affiliate_commission_live:
        return "dry_run"
    if not settings.whop_api_key or not user.whop_affiliate_id:
        return "unqualified"
    _activate(db, user)
    return "activated"


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


def _fire_qualified_side_effects(db: Session, user: User) -> None:
    try:
        from app.mailer import send_admin_affiliate_milestone, send_affiliate_qualified
        from app.routes.notifications import write_notification

        row = write_notification(
            db,
            user_id=user.id,
            category="affiliate",
            title="50% recurring unlocked.",
            body=(
                "Two referred paid customers cleared the 7-day hold. "
                "Whop now applies 50% to future recurring payments."
            ),
            priority="high",
            external_dedup_key=f"affiliate-qualified-{user.id}",
        )
        if row is not None and user.email:
            send_affiliate_qualified(user.email)
            send_admin_affiliate_milestone(
                affiliate_email=user.email,
                milestone="qualified_50_percent",
                note="2 referred paid customers cleared 7 days",
            )
    except Exception:  # noqa: BLE001
        log.exception("affiliate qualification side-effects failed for user=%s", user.id)
