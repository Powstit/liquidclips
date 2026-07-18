"""REGRESSION SENTINELS · payment webhook must NEVER mint affiliate identity.

Business rule LOCKED 2026-07-18 by Daniel:
  - Payment lane and affiliate lane are separate.
  - Payment webhooks activate subscriptions and reconcile EXISTING affiliates
    — they NEVER mint new affiliate identities.
  - Identity minting happens ONLY via user-triggered POST /me/affiliate/enroll.

These tests exist to prevent the coupling from silently regressing. If a
future edit re-introduces `create_affiliate_identity()` inside the payment
webhook path, these tests fail loudly. Do not delete them.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import analytics, clerk_sync, mailer
from app.db import Base
from app.models import User
from app.routes import webhooks_whop
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


@pytest.fixture(autouse=True)
def no_external_side_effects(monkeypatch):
    monkeypatch.setattr(clerk_sync, "sync_clerk_metadata", lambda *args, **kwargs: None)
    monkeypatch.setattr(analytics, "capture", lambda *args, **kwargs: None)
    monkeypatch.setattr(analytics, "identify", lambda *args, **kwargs: None)
    monkeypatch.setattr(mailer, "send_admin_paid_customer_alert", lambda *a, **k: None)
    monkeypatch.setattr(mailer, "send_subscription_activated", lambda *a, **k: None)
    monkeypatch.setattr(mailer, "send_subscription_canceled", lambda *a, **k: None)


def _user(db, *, tier: str = "free", status: str = "trial") -> User:
    user = User(
        id=uuid.uuid4().hex,
        clerk_id=f"user_{uuid.uuid4().hex[:12]}",
        email=f"{uuid.uuid4().hex[:8]}@example.com",
        tier=tier,
        subscription_status=status,
    )
    db.add(user)
    db.commit()
    return user


def _event_data(user: User, plan_id: str) -> dict:
    return {
        "id": f"pay_{uuid.uuid4().hex[:12]}",
        "plan": {"id": plan_id, "title": None},
        "user": {
            "email": user.email,
            "id": user.whop_user_id or "user_whop_new",
        },
    }


# ---------------------------------------------------------------------------
# SENTINEL 1: payment.succeeded MUST NOT call create_affiliate_identity.
# ---------------------------------------------------------------------------
def test_payment_succeeded_does_not_call_create_affiliate_identity(db, monkeypatch):
    """The regression this test guards against:
    a future edit adds `create_affiliate_identity(user)` back into
    _handle_payment_succeeded. Identity minting is the affiliate lane and
    ONLY the /me/affiliate/enroll endpoint may cross that line.
    """
    calls: list[str] = []

    def _boom(user):  # noqa: ANN001
        calls.append(user.email)
        raise AssertionError(
            "payment webhook MUST NOT mint affiliate identity — "
            "two-lane separation LOCKED 2026-07-18"
        )

    # Patch on the service module so any indirect import path is covered
    monkeypatch.setattr(affiliate_commission, "create_affiliate_identity", _boom)

    user = _user(db)
    data = _event_data(user, "plan_qe8AFXj9J3SWi")  # solo plan

    webhooks_whop._handle_payment_succeeded(db, data)
    db.commit()
    db.refresh(user)

    # Sanity — the tier grant still happened (payment lane works)
    assert user.subscription_status == "active"
    assert user.tier == "solo"
    # Sanity — the sentinel was never triggered
    assert calls == []
    # And the user still has no affiliate identity
    assert user.whop_affiliate_id is None
    assert user.whop_affiliate_code is None


# ---------------------------------------------------------------------------
# SENTINEL 2: payment.succeeded still reconciles EXISTING affiliates.
# ---------------------------------------------------------------------------
def test_payment_succeeded_still_reconciles_existing_affiliate(db, monkeypatch):
    """The payment webhook must still call reconcile_user() so that
    a user who is ALREADY enrolled as an affiliate gets their 50%
    overrides activated when they become paying. This is the safe
    half of the coupling — no mint, just activation.
    """
    reconcile_calls: list[tuple[str, str]] = []

    def _fake_reconcile(_db, u, **_kw):
        reconcile_calls.append((u.id, u.whop_affiliate_id or ""))
        return "active"

    monkeypatch.setattr(affiliate_commission, "reconcile_user", _fake_reconcile)

    # Belt-and-braces — if any code path tries to mint, fail loudly
    def _boom(_user):
        raise AssertionError("payment webhook must not mint")

    monkeypatch.setattr(affiliate_commission, "create_affiliate_identity", _boom)

    user = _user(db)
    user.whop_affiliate_id = "aff_pre_existing"
    user.whop_affiliate_code = "existingclipper"
    db.commit()

    data = _event_data(user, "plan_qe8AFXj9J3SWi")

    webhooks_whop._handle_payment_succeeded(db, data)
    db.commit()
    db.refresh(user)

    # Payment lane: subscription active
    assert user.subscription_status == "active"
    # Affiliate lane: reconcile ran for this user's existing identity
    assert reconcile_calls == [(user.id, "aff_pre_existing")]
    # Identity untouched — no re-mint, no code overwrite
    assert user.whop_affiliate_id == "aff_pre_existing"
    assert user.whop_affiliate_code == "existingclipper"
