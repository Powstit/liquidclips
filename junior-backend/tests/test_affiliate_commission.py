from __future__ import annotations

from datetime import datetime, timedelta, timezone
import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import get_settings
from app.db import Base
from app.models import User
from app.routes import affiliate
from app.services import affiliate_commission


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _user(db, *, status="active", tier="solo", affiliate_id=None, first_paid_at=None):
    user = User(
        id=uuid.uuid4().hex,
        clerk_id=f"user_{uuid.uuid4().hex[:12]}",
        email=f"{uuid.uuid4().hex[:8]}@example.com",
        tier=tier,
        subscription_status=status,
        affiliate_id=affiliate_id,
        first_paid_at=first_paid_at,
    )
    db.add(user)
    db.commit()
    return user


# ---------------------------------------------------------------------------
# Reporting-only compat: eligible_referral_count still populates the admin
# panel + dashboard "X of 2" progress ring. Money gating no longer depends on
# it — but the query itself must stay correct because Daniel reads it.
# ---------------------------------------------------------------------------
def test_eligible_referrals_reporting_shim_still_returns_correct_count(db):
    now = datetime.now(timezone.utc)
    referrer = _user(db)
    referrer.whop_affiliate_id = "aff_referrer"
    referrer.whop_affiliate_code = "clippername"
    db.commit()

    _user(
        db,
        affiliate_id="aff_referrer",
        first_paid_at=now - timedelta(days=8),
    )
    _user(
        db,
        affiliate_id="clippername",
        first_paid_at=now - timedelta(days=7, minutes=1),
    )
    _user(
        db,
        affiliate_id="clippername",
        first_paid_at=now - timedelta(days=2),
    )
    _user(
        db,
        status="refunded",
        affiliate_id="aff_referrer",
        first_paid_at=now - timedelta(days=20),
    )

    assert affiliate_commission.eligible_referral_count(db, referrer, now=now) == 2


def test_reconcile_activates_50_percent_on_existing_affiliate(db, monkeypatch):
    """A paying subscriber with an ALREADY-MINTED Whop affiliate identity
    gets 50% overrides on every recurring plan the first time
    reconcile_user runs — no qualification ladder, no 7-day hold.

    Note: identity minting is out-of-band via POST /me/affiliate/enroll.
    Payment webhooks and this reconcile path never mint — they only
    activate/tear-down overrides for identities that already exist."""
    settings = get_settings()
    monkeypatch.setattr(settings, "affiliate_commission_live", True)
    monkeypatch.setattr(settings, "whop_api_key", "test-key")

    user = _user(db, status="active", tier="solo")
    user.whop_affiliate_id = "aff_paid"
    db.commit()

    created: list[tuple[str, dict]] = []
    monkeypatch.setattr(affiliate_commission, "_list_overrides", lambda _aid: [])

    def _cap_create(_aid, plan_id):
        # Verify terms EVERY call — proves _terms() returns 50%/all_payments.
        terms = affiliate_commission._terms()
        assert terms == {
            "commission_type": "percentage",
            "commission_value": 50,
            "applies_to_payments": "all_payments",
        }
        created.append((plan_id, terms))
        return {"id": f"affov_{plan_id}"}

    monkeypatch.setattr(affiliate_commission, "_create_override", _cap_create)

    assert affiliate_commission.reconcile_user(db, user) == "active"
    assert [plan_id for plan_id, _ in created] == list(
        affiliate_commission.RECURRING_PLAN_IDS
    )
    assert user.whop_commission_override_id == user.affiliate_commission_override_ids[0]


def test_free_user_gets_no_override_created(db, monkeypatch):
    """A free-tier user has no override lifecycle work: nothing to create,
    nothing to tear down."""
    settings = get_settings()
    monkeypatch.setattr(settings, "affiliate_commission_live", True)
    monkeypatch.setattr(settings, "whop_api_key", "test-key")

    user = _user(db, status="active", tier="free")
    user.whop_affiliate_id = "aff_free"
    db.commit()

    def _boom(*_args, **_kwargs):
        raise AssertionError("no Whop mutation should happen for free tier")

    monkeypatch.setattr(affiliate_commission, "_list_overrides", _boom)
    monkeypatch.setattr(affiliate_commission, "_create_override", _boom)
    monkeypatch.setattr(affiliate_commission, "_delete_override", _boom)

    assert affiliate_commission.reconcile_user(db, user) == "inactive"
    assert not user.affiliate_commission_override_ids


def test_lapsed_user_pauses_all_overrides(db, monkeypatch):
    """When a paying user's subscription lapses (expired/refunded/downgraded
    to free), every override is deleted instantly."""
    settings = get_settings()
    monkeypatch.setattr(settings, "affiliate_commission_live", True)
    monkeypatch.setattr(settings, "whop_api_key", "test-key")

    user = _user(db, status="expired", tier="free")
    user.whop_affiliate_id = "aff_lapsed"
    user.whop_commission_override_id = "affov_one"
    user.affiliate_commission_override_ids = ["affov_one", "affov_two"]
    db.commit()

    deleted: list[str] = []
    monkeypatch.setattr(
        affiliate_commission,
        "_delete_override",
        lambda _aid, override_id: deleted.append(override_id),
    )

    assert affiliate_commission.reconcile_user(db, user) == "paused"
    assert deleted == ["affov_one", "affov_two"]
    assert user.affiliate_commission_override_ids == []
    assert user.whop_commission_override_id is None


def test_reconcile_is_idempotent_when_called_repeatedly(db, monkeypatch):
    """Calling reconcile_user twice for the same paying user is a no-op on
    the second call because the Whop list-response already matches the
    50%/all_payments terms."""
    settings = get_settings()
    monkeypatch.setattr(settings, "affiliate_commission_live", True)
    monkeypatch.setattr(settings, "whop_api_key", "test-key")

    user = _user(db, status="active", tier="pro")
    user.whop_affiliate_id = "aff_idem"
    db.commit()

    # Simulate Whop already having 50% overrides for every plan.
    existing_rows = [
        {
            "id": f"affov_{plan_id}",
            "override_type": "standard",
            "plan_id": plan_id,
            "commission_type": "percentage",
            "commission_value": 50,
            "applies_to_payments": "all_payments",
        }
        for plan_id in affiliate_commission.RECURRING_PLAN_IDS
    ]
    monkeypatch.setattr(affiliate_commission, "_list_overrides", lambda _aid: existing_rows)

    creates: list[str] = []
    updates: list[str] = []
    monkeypatch.setattr(
        affiliate_commission,
        "_create_override",
        lambda _aid, plan_id: creates.append(plan_id) or {"id": f"affov_{plan_id}"},
    )
    monkeypatch.setattr(
        affiliate_commission,
        "_update_override",
        lambda _aid, _oid, plan_id: updates.append(plan_id) or {"id": f"affov_{plan_id}"},
    )

    # Two consecutive reconciles.
    assert affiliate_commission.reconcile_user(db, user) == "active"
    assert affiliate_commission.reconcile_user(db, user) == "active"

    # No creates or updates should have happened — existing rows already match.
    assert creates == []
    assert updates == []


def test_existing_30_percent_baseline_user_upgrades_to_50(db, monkeypatch):
    """Legacy users whose Whop overrides are still on the retired 30%
    first_payment baseline get PATCHed to 50% all_payments on the next
    reconcile."""
    settings = get_settings()
    monkeypatch.setattr(settings, "affiliate_commission_live", True)
    monkeypatch.setattr(settings, "whop_api_key", "test-key")

    user = _user(db, status="active", tier="agency")
    user.whop_affiliate_id = "aff_legacy"
    db.commit()

    existing_rows = [
        {
            "id": f"affov_{plan_id}",
            "override_type": "standard",
            "plan_id": plan_id,
            "commission_type": "percentage",
            "commission_value": 30,  # legacy baseline
            "applies_to_payments": "first_payment",
        }
        for plan_id in affiliate_commission.RECURRING_PLAN_IDS
    ]
    monkeypatch.setattr(affiliate_commission, "_list_overrides", lambda _aid: existing_rows)

    updated_terms: list[dict] = []

    def _cap_update(_aid, override_id, plan_id):
        updated_terms.append(
            {"override_id": override_id, "plan_id": plan_id, **affiliate_commission._terms()}
        )
        return {"id": override_id}

    monkeypatch.setattr(affiliate_commission, "_update_override", _cap_update)

    def _no_create(*_a, **_k):
        raise AssertionError("existing rows must PATCH, not POST")

    monkeypatch.setattr(affiliate_commission, "_create_override", _no_create)

    assert affiliate_commission.reconcile_user(db, user) == "active"
    assert len(updated_terms) == len(affiliate_commission.RECURRING_PLAN_IDS)
    for row in updated_terms:
        assert row["commission_value"] == 50
        assert row["applies_to_payments"] == "all_payments"


def test_all_recurring_plan_ids_get_50_percent_override(db, monkeypatch):
    """Every plan in RECURRING_PLAN_IDS (Solo · Pro · Agency · 3 Founder
    variants) receives a 50%/all_payments override."""
    settings = get_settings()
    monkeypatch.setattr(settings, "affiliate_commission_live", True)
    monkeypatch.setattr(settings, "whop_api_key", "test-key")

    user = _user(db, status="active", tier="solo")
    user.whop_affiliate_id = "aff_plancoverage"
    db.commit()

    monkeypatch.setattr(affiliate_commission, "_list_overrides", lambda _aid: [])
    plans_seen: list[str] = []
    monkeypatch.setattr(
        affiliate_commission,
        "_create_override",
        lambda _aid, plan_id: plans_seen.append(plan_id) or {"id": f"affov_{plan_id}"},
    )

    affiliate_commission.reconcile_user(db, user)
    assert plans_seen == list(affiliate_commission.RECURRING_PLAN_IDS)
    # Sanity: the full v2.2.11 plan set is present.
    assert len(plans_seen) == 6


def test_dry_run_mode_makes_no_whop_api_calls(db, monkeypatch):
    """affiliate_commission_live=False guarantees zero HTTP mutations."""
    settings = get_settings()
    monkeypatch.setattr(settings, "affiliate_commission_live", False)

    user = _user(db, status="active", tier="solo")
    user.whop_affiliate_id = "aff_dry"
    db.commit()

    def _boom(*_a, **_k):
        raise AssertionError("dry_run must NOT touch Whop")

    monkeypatch.setattr(affiliate_commission, "_list_overrides", _boom)
    monkeypatch.setattr(affiliate_commission, "_create_override", _boom)
    monkeypatch.setattr(affiliate_commission, "_update_override", _boom)
    monkeypatch.setattr(affiliate_commission, "_delete_override", _boom)

    assert affiliate_commission.reconcile_user(db, user) == "dry_run"
    assert user.affiliate_commission_override_ids == []


def test_reconcile_user_missing_whop_affiliate_id_returns_unavailable(db, monkeypatch):
    """A user with no minted Whop affiliate identity yet reports
    "unavailable" and does zero Whop work."""
    settings = get_settings()
    monkeypatch.setattr(settings, "affiliate_commission_live", True)
    monkeypatch.setattr(settings, "whop_api_key", "test-key")

    user = _user(db, status="active", tier="solo")
    # No whop_affiliate_id set.
    db.commit()

    def _boom(*_a, **_k):
        raise AssertionError("must not touch Whop with no affiliate id")

    monkeypatch.setattr(affiliate_commission, "_list_overrides", _boom)
    monkeypatch.setattr(affiliate_commission, "_create_override", _boom)

    assert affiliate_commission.reconcile_user(db, user) == "unavailable"


# ---------------------------------------------------------------------------
# Regression: the affiliate dashboard's referral-URL cache path stays wired.
# Unrelated to the commission ladder retirement but MUST keep passing.
# ---------------------------------------------------------------------------
def test_affiliate_link_uses_whop_checkout_code_and_caches_both_tokens(db, monkeypatch):
    referrer = _user(db)
    monkeypatch.setattr(
        affiliate,
        "_fetch_whop_affiliate",
        lambda _email: {
            "id": "aff_referrer",
            "status": "active",
            "active_members_count": 0,
            "total_referrals_count": 0,
            "monthly_recurring_revenue_usd": "0.00",
            "total_referral_earnings_usd": "0.00",
            "user": {"username": "clippername"},
        },
    )

    result = affiliate.build_affiliate_me_response(referrer, db=db)

    assert result.affiliate.referral_url.endswith("/checkout?a=clippername")
    assert result.affiliate.affiliate_id == "aff_referrer"
    assert result.affiliate.affiliate_code == "clippername"
    assert referrer.whop_affiliate_id == "aff_referrer"
    assert referrer.whop_affiliate_code == "clippername"
