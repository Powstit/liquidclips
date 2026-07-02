"""Path A Fix 1 · accept_invite auto-inserts a 0-bps AgencyPayoutSplit
row for new members so the owner sees them in the PayoutSplitPanel
immediately.

Verifies:
  1. A fresh accept creates a new AgencyPayoutSplit row with percent_bps=0
  2. Re-accepting an existing invite (idempotent path) does not duplicate
  3. Reactivating a soft-deleted member preserves the existing split row
     when one already exists
  4. Payout row created for invitee only, not for owner
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import (
    AgencyInvite,
    AgencyMember,
    AgencyPayoutSplit,
    User,
)


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


def _make_user(db, *, email, tier="free", uid=None):
    u = User(
        id=uid or uuid.uuid4().hex,
        clerk_id=f"user_{email}",
        email=email,
        tier=tier,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _make_invite(db, *, agency_id, email, role="member", token=None):
    inv = AgencyInvite(
        id=uuid.uuid4().hex,
        agency_id=agency_id,
        invited_by_user_id=agency_id,
        email=email.lower(),
        token=token or secrets.token_urlsafe(32),
        role=role,
        status="pending",
        expires_at=datetime.now(timezone.utc) + timedelta(days=14),
        created_at=datetime.now(timezone.utc),
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return inv


def _accept(db, user, invite):
    """Invoke accept_invite as a plain function with the current_user dep
    resolved to `user`. The function signature reads the dependencies
    from FastAPI at request-time; calling it here bypasses that by
    passing them positionally."""
    from app.routes.agency import accept_invite
    return accept_invite(token=invite.token, user=user, db=db)


def test_accept_creates_zero_bps_split_row(db_session):
    owner = _make_user(db_session, email="owner@example.com", tier="agency")
    invitee = _make_user(db_session, email="clipper@example.com")
    invite = _make_invite(db_session, agency_id=owner.id, email="clipper@example.com")

    out = _accept(db_session, invitee, invite)
    assert out.ok is True

    rows = (
        db_session.query(AgencyPayoutSplit)
        .filter(
            AgencyPayoutSplit.agency_id == owner.id,
            AgencyPayoutSplit.member_user_id == invitee.id,
        )
        .all()
    )
    assert len(rows) == 1, "expected exactly one 0-bps split row"
    assert rows[0].percent_bps == 0


def test_accept_is_idempotent_for_split_row(db_session):
    """Re-accepting shouldn't duplicate the split row (protected by the
    existing_split check in accept_invite)."""
    owner = _make_user(db_session, email="owner@example.com", tier="agency")
    invitee = _make_user(db_session, email="clipper@example.com")
    invite = _make_invite(db_session, agency_id=owner.id, email="clipper@example.com")

    _accept(db_session, invitee, invite)

    # Simulate a re-invite/re-accept path — new invite for the same
    # invitee. The old membership stays (soft-deleted case is separate).
    invite2 = _make_invite(db_session, agency_id=owner.id, email="clipper@example.com")
    _accept(db_session, invitee, invite2)

    rows = (
        db_session.query(AgencyPayoutSplit)
        .filter(
            AgencyPayoutSplit.agency_id == owner.id,
            AgencyPayoutSplit.member_user_id == invitee.id,
        )
        .all()
    )
    assert len(rows) == 1, "must not duplicate split row on re-accept"


def test_accept_preserves_existing_split_percent(db_session):
    """When a soft-deleted member is reactivated, an already-set
    percent_bps must NOT be zeroed by the accept path."""
    owner = _make_user(db_session, email="owner@example.com", tier="agency")
    invitee = _make_user(db_session, email="clipper@example.com")

    # Pre-existing split row with a non-zero percent — simulates a
    # rebalance-then-soft-delete-then-reinvite lifecycle.
    now = datetime.now(timezone.utc)
    db_session.add(AgencyPayoutSplit(
        agency_id=owner.id,
        member_user_id=invitee.id,
        percent_bps=4200,
        updated_at=now,
        updated_by_user_id=owner.id,
    ))
    db_session.commit()

    invite = _make_invite(db_session, agency_id=owner.id, email="clipper@example.com")
    _accept(db_session, invitee, invite)

    row = (
        db_session.query(AgencyPayoutSplit)
        .filter(
            AgencyPayoutSplit.agency_id == owner.id,
            AgencyPayoutSplit.member_user_id == invitee.id,
        )
        .one()
    )
    assert row.percent_bps == 4200, "existing split percent must not be reset"


def test_accept_does_not_create_split_for_owner(db_session):
    """Only the invitee gets a split row — never the owner (an agency
    owning a split of their own agency's pot is nonsensical)."""
    owner = _make_user(db_session, email="owner@example.com", tier="agency")
    invitee = _make_user(db_session, email="clipper@example.com")
    invite = _make_invite(db_session, agency_id=owner.id, email="clipper@example.com")
    _accept(db_session, invitee, invite)

    owner_rows = (
        db_session.query(AgencyPayoutSplit)
        .filter(
            AgencyPayoutSplit.agency_id == owner.id,
            AgencyPayoutSplit.member_user_id == owner.id,
        )
        .all()
    )
    assert owner_rows == []
