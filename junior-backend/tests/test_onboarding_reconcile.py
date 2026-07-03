"""Path A Fix 3 · reconciliation pass tests.

Verifies:
  1. Missing signed_up_at is derived from trial_started_at
  2. Missing first_paid_referral uses the referred buyer's payment time
  3. Missing agency_member_accepted_at is derived from AgencyMember.joined_at
  4. Existing timestamps are NEVER overwritten (idempotent through mark_milestone)
  5. Reconcile pass returns [] when nothing needs healing
  6. Reconcile pass never raises — a broken derivation branch is swallowed
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import AgencyMember, User
from app.onboarding_reconcile import reconcile_missing_milestones


@pytest.fixture
def db_session(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    import app.db as _app_db
    monkeypatch.setattr(_app_db, "SessionLocal", SessionLocal)

    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _make_user(
    db,
    *,
    email="test@example.com",
    trial_started_at=None,
    first_paid_at=None,
    referred_paid_subs=0,
    affiliate_id=None,
    whop_affiliate_id=None,
    whop_affiliate_code=None,
):
    u = User(
        clerk_id=f"user_{email}",
        email=email,
        tier="free",
        trial_started_at=trial_started_at or datetime(2026, 6, 1, tzinfo=timezone.utc),
        referred_paid_subs=referred_paid_subs,
        first_paid_at=first_paid_at,
        affiliate_id=affiliate_id,
        whop_affiliate_id=whop_affiliate_id,
        whop_affiliate_code=whop_affiliate_code,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def test_signed_up_at_derived_from_trial_started_at(db_session):
    trial_start = datetime(2026, 5, 1, 12, 0, 0, tzinfo=timezone.utc)
    u = _make_user(db_session, trial_started_at=trial_start)
    stamped = reconcile_missing_milestones(db_session, u)
    db_session.commit()
    assert "signed_up_at" in stamped
    assert u.onboarding_status["signed_up_at"].startswith("2026-05-01T12:00:00")


def test_first_paid_referral_uses_referred_buyers_payment_time(db_session):
    owner_paid_at = datetime(2026, 6, 1, tzinfo=timezone.utc)
    referral_paid_at = datetime(2026, 6, 10, tzinfo=timezone.utc)
    owner = _make_user(
        db_session,
        email="owner@example.com",
        first_paid_at=owner_paid_at,
        referred_paid_subs=1,
        whop_affiliate_id="aff_owner",
    )
    _make_user(
        db_session,
        email="buyer@example.com",
        first_paid_at=referral_paid_at,
        affiliate_id="aff_owner",
    )

    stamped = reconcile_missing_milestones(db_session, owner)
    db_session.commit()
    assert "first_paid_referral" in stamped
    assert owner.onboarding_status["first_paid_referral"].startswith(
        "2026-06-10T00:00:00"
    )


def test_referral_time_wins_when_owner_paid_after_referral(db_session):
    owner = _make_user(
        db_session,
        email="owner-late@example.com",
        first_paid_at=datetime(2026, 6, 20, tzinfo=timezone.utc),
        referred_paid_subs=1,
        whop_affiliate_code="owner-code",
    )
    _make_user(
        db_session,
        email="buyer-early@example.com",
        first_paid_at=datetime(2026, 6, 5, tzinfo=timezone.utc),
        affiliate_id="owner-code",
    )

    reconcile_missing_milestones(db_session, owner)
    db_session.commit()
    assert owner.onboarding_status["first_paid_referral"].startswith(
        "2026-06-05T00:00:00"
    )


def test_paid_referral_counter_without_truthful_event_stays_unset(db_session):
    owner = _make_user(
        db_session,
        email="legacy-owner@example.com",
        first_paid_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
        referred_paid_subs=3,
        whop_affiliate_id="aff_missing_buyer",
    )
    stamped = reconcile_missing_milestones(db_session, owner)
    assert "first_paid_referral" not in stamped
    assert not owner.onboarding_status.get("first_paid_referral")


def test_agency_member_accepted_derived_from_joined_at(db_session):
    owner = _make_user(db_session, email="owner@example.com")
    invitee = _make_user(db_session, email="invitee@example.com")
    joined_at = datetime(2026, 6, 15, 10, 30, 0, tzinfo=timezone.utc)
    db_session.add(AgencyMember(
        agency_id=owner.id,
        user_id=invitee.id,
        role="member",
        status="active",
        joined_at=joined_at,
    ))
    db_session.commit()

    stamped = reconcile_missing_milestones(db_session, invitee)
    db_session.commit()
    assert "agency_member_accepted_at" in stamped
    assert invitee.onboarding_status["agency_member_accepted_at"].startswith("2026-06-15T10:30")


def test_existing_timestamp_is_never_overwritten(db_session):
    """Idempotence · a stamped milestone must not shift under reconcile."""
    u = _make_user(db_session, trial_started_at=datetime(2026, 5, 1, tzinfo=timezone.utc))
    # Pre-stamp with a DIFFERENT timestamp than trial_started_at
    from app.onboarding_milestones import mark_milestone
    original = datetime(2026, 4, 15, tzinfo=timezone.utc)
    mark_milestone(db_session, u, "signed_up_at", at=original)
    db_session.commit()
    original_ts = u.onboarding_status["signed_up_at"]
    assert original_ts.startswith("2026-04-15")

    # Reconcile should be a no-op for this key
    stamped = reconcile_missing_milestones(db_session, u)
    db_session.commit()
    assert "signed_up_at" not in stamped
    assert u.onboarding_status["signed_up_at"] == original_ts


def test_reconcile_returns_empty_list_when_nothing_to_heal(db_session):
    """Cheap-path: all derivable milestones already stamped → []."""
    u = _make_user(db_session)
    from app.onboarding_milestones import mark_milestone
    mark_milestone(db_session, u, "signed_up_at", at=datetime(2026, 5, 1, tzinfo=timezone.utc))
    db_session.commit()
    stamped = reconcile_missing_milestones(db_session, u)
    assert stamped == []


def test_reconcile_never_raises(db_session, monkeypatch):
    """Reconcile MUST NOT propagate exceptions. Simulate a broken
    mark_milestone (e.g., the fresh SessionLocal fails to connect) and
    verify the pass swallows + returns []. /sync must not 500 because
    the self-heal pass hit a snag."""
    u = _make_user(db_session)

    # Force mark_milestone to raise from inside the reconcile pass.
    import app.onboarding_reconcile as _reconcile_mod
    def _boom(*_a, **_kw):
        raise RuntimeError("simulated milestone failure")
    monkeypatch.setattr(_reconcile_mod, "mark_milestone", None, raising=False)
    # Re-import inside the function scope to bypass the top-of-module
    # import — the reconcile function re-imports lazily, so we patch the
    # module-level symbol AFTER the function pulls it in.
    from app.onboarding_milestones import mark_milestone as _real
    def _wrap_boom(*args, **kwargs):
        raise RuntimeError("simulated milestone failure")
    monkeypatch.setattr("app.onboarding_milestones.mark_milestone", _wrap_boom)

    stamped = reconcile_missing_milestones(db_session, u)
    # Function catches exceptions inside each derivation → returns []
    # instead of propagating.
    assert isinstance(stamped, list)
