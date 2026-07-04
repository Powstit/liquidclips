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


def test_eligible_referrals_require_active_and_seven_days(db):
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


def test_reconcile_qualified_is_dry_run_when_money_flag_off(db, monkeypatch):
    now = datetime.now(timezone.utc)
    settings = get_settings()
    monkeypatch.setattr(settings, "affiliate_commission_live", False)
    referrer = _user(db)
    referrer.whop_affiliate_id = "aff_referrer"
    db.commit()
    for _ in range(2):
        _user(
            db,
            affiliate_id="aff_referrer",
            first_paid_at=now - timedelta(days=8),
        )

    assert affiliate_commission.reconcile_user(db, referrer, now=now) == "dry_run"
    assert referrer.affiliate_commission_override_ids == []


def test_reconcile_creates_one_qualified_override_per_recurring_plan(db, monkeypatch):
    now = datetime.now(timezone.utc)
    settings = get_settings()
    monkeypatch.setattr(settings, "affiliate_commission_live", True)
    monkeypatch.setattr(settings, "whop_api_key", "test-key")
    referrer = _user(db)
    referrer.whop_affiliate_id = "aff_referrer"
    db.commit()
    for _ in range(2):
        _user(
            db,
            affiliate_id="aff_referrer",
            first_paid_at=now - timedelta(days=8),
        )

    created: list[str] = []
    monkeypatch.setattr(affiliate_commission, "_list_overrides", lambda _affiliate_id: [])
    monkeypatch.setattr(
        affiliate_commission,
        "_create_override",
        lambda _affiliate_id, plan_id, *, qualified: (
            assert_qualified(qualified)
            or
            created.append(plan_id) or {"id": f"affov_{plan_id}"}
        ),
    )
    monkeypatch.setattr(
        affiliate_commission,
        "_fire_qualified_side_effects",
        lambda *_args, **_kwargs: None,
    )

    assert affiliate_commission.reconcile_user(db, referrer, now=now) == "activated"
    assert created == list(affiliate_commission.RECURRING_PLAN_IDS)
    assert len(referrer.affiliate_commission_override_ids) == len(
        affiliate_commission.RECURRING_PLAN_IDS
    )
    assert referrer.whop_commission_override_id == referrer.affiliate_commission_override_ids[0]
    assert referrer.affiliate_qualified_at is not None


def assert_qualified(value: bool) -> None:
    assert value is True


def test_reconcile_provisions_first_payment_baseline_before_qualification(db, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "affiliate_commission_live", True)
    monkeypatch.setattr(settings, "whop_api_key", "test-key")
    referrer = _user(db)
    referrer.whop_affiliate_id = "aff_referrer"
    db.commit()

    created: list[tuple[str, bool]] = []
    monkeypatch.setattr(affiliate_commission, "_list_overrides", lambda _affiliate_id: [])
    monkeypatch.setattr(
        affiliate_commission,
        "_create_override",
        lambda _affiliate_id, plan_id, *, qualified: (
            created.append((plan_id, qualified)) or {"id": f"affov_{plan_id}"}
        ),
    )

    assert affiliate_commission.reconcile_user(db, referrer) == "baseline"
    assert created == [
        (plan_id, False) for plan_id in affiliate_commission.RECURRING_PLAN_IDS
    ]
    assert len(referrer.affiliate_commission_override_ids) == len(
        affiliate_commission.RECURRING_PLAN_IDS
    )
    assert referrer.whop_commission_override_id is None


def test_reconcile_pauses_overrides_when_referrer_subscription_lapses(db, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "affiliate_commission_live", True)
    referrer = _user(db, status="expired", tier="free")
    referrer.whop_affiliate_id = "aff_referrer"
    referrer.whop_commission_override_id = "affov_one"
    referrer.affiliate_commission_override_ids = ["affov_one", "affov_two"]
    db.commit()

    deleted: list[str] = []
    monkeypatch.setattr(
        affiliate_commission,
        "_delete_override",
        lambda _affiliate_id, override_id: deleted.append(override_id),
    )

    assert affiliate_commission.reconcile_user(db, referrer) == "paused"
    assert deleted == ["affov_one", "affov_two"]
    assert referrer.affiliate_commission_override_ids == []
    assert referrer.whop_commission_override_id is None


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
