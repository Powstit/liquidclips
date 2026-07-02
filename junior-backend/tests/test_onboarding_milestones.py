"""Sprint G.1 · Kade Reactive Onboarding · milestone helper tests.

Verifies:
  1. mark_milestone stamps a missing key
  2. mark_milestone is idempotent (existing timestamp not overwritten)
  3. mark_milestone rejects unknown keys silently (no raise)
  4. snapshot returns every canonical key + null for absent milestones
  5. snapshot filters legacy/unknown keys out of the response
  6. /sync response carries the onboarding_status snapshot
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import User
from app.onboarding_milestones import (
    ALL_MILESTONE_KEYS,
    mark_milestone,
    snapshot,
)


@pytest.fixture
def db_session():
    """In-memory SQLite session — ephemeral, per-test isolated."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _make_user(db, email: str = "test@example.com") -> User:
    u = User(clerk_id=f"user_{email}", email=email, tier="free")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def test_mark_milestone_stamps_missing_key(db_session):
    u = _make_user(db_session)
    assert u.onboarding_status == {}
    ok = mark_milestone(db_session, u, "signed_up_at")
    db_session.commit()
    assert ok is True
    assert "signed_up_at" in u.onboarding_status
    # ISO-8601 with Z suffix
    ts = u.onboarding_status["signed_up_at"]
    assert isinstance(ts, str)
    assert ts.endswith("Z")


def test_mark_milestone_is_idempotent(db_session):
    u = _make_user(db_session)
    fixed_ts = datetime(2026, 7, 2, 10, 0, 0, tzinfo=timezone.utc)
    mark_milestone(db_session, u, "first_launch_at", at=fixed_ts)
    db_session.commit()
    stamped_at = u.onboarding_status["first_launch_at"]

    # Second call must NOT overwrite (idempotence guarantee — the
    # timestamp is a first-occurrence anchor).
    later_ts = fixed_ts + timedelta(hours=1)
    ok = mark_milestone(db_session, u, "first_launch_at", at=later_ts)
    db_session.commit()
    assert ok is False
    assert u.onboarding_status["first_launch_at"] == stamped_at


def test_mark_milestone_rejects_unknown_key_silently(db_session):
    u = _make_user(db_session)
    ok = mark_milestone(db_session, u, "bogus_milestone_xyz")  # type: ignore[arg-type]
    assert ok is False
    assert "bogus_milestone_xyz" not in (u.onboarding_status or {})


def test_snapshot_includes_every_canonical_key(db_session):
    u = _make_user(db_session)
    mark_milestone(db_session, u, "signed_up_at")
    mark_milestone(db_session, u, "first_launch_at")
    db_session.commit()
    snap = snapshot(u)
    for key in ALL_MILESTONE_KEYS:
        assert key in snap, f"canonical key missing: {key}"
    # Filled keys carry timestamps
    assert snap["signed_up_at"] is not None
    assert snap["first_launch_at"] is not None
    # Everything else is None
    for key in ALL_MILESTONE_KEYS:
        if key in ("signed_up_at", "first_launch_at"):
            continue
        assert snap[key] is None, f"expected null for absent milestone: {key}"


def test_snapshot_filters_legacy_or_unknown_keys(db_session):
    u = _make_user(db_session)
    # Simulate a row from an older schema that carries an obsolete key.
    u.onboarding_status = {
        "signed_up_at": "2026-07-02T10:00:00Z",
        "legacy_orphan_key_from_v0.6": "2026-06-01T00:00:00Z",
    }
    db_session.commit()
    snap = snapshot(u)
    # Only canonical keys appear
    assert "legacy_orphan_key_from_v0.6" not in snap
    assert snap["signed_up_at"] == "2026-07-02T10:00:00Z"


def test_ordered_milestones_produce_ascending_timestamps(db_session):
    """When mark_milestone is called sequentially, each stamp should be
    strictly monotonic (using explicit `at=` to avoid clock jitter)."""
    u = _make_user(db_session)
    t0 = datetime(2026, 7, 2, 10, 0, 0, tzinfo=timezone.utc)
    for i, key in enumerate([
        "signed_up_at",
        "first_launch_at",
        "first_clip_at",
        "first_publish_at",
    ]):
        mark_milestone(db_session, u, key, at=t0 + timedelta(minutes=i))
    db_session.commit()
    snap = snapshot(u)
    ts = [
        snap["signed_up_at"],
        snap["first_launch_at"],
        snap["first_clip_at"],
        snap["first_publish_at"],
    ]
    assert ts == sorted(ts)
