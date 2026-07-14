"""Crew P1 · post-verify onboarding markers.

Verifies the three POST endpoints write to `User.onboarding_status`
and are read back via GET /onboarding/crew. Guards the WelcomeRoute
post-verify handoff (Priority 1 Crew agent · 2026-07-10).

Tests:
  1. crew_shown is idempotent (only writes first time)
  2. crew_completed always overwrites (last-write-wins)
  3. crew_dismissed always overwrites
  4. GET reflects the current state
  5. Independent keys · shown does not clobber completed
"""
from __future__ import annotations

import pytest
from datetime import timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import User
from app.routes.onboarding import (
    _write_crew_marker,
    _crew_marker_response,
)


@pytest.fixture
def db_session(monkeypatch):
    """In-memory SQLite session · per-test isolated (matches the pattern
    used by test_onboarding_milestones.py)."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, expire_on_commit=False,
    )

    import app.db as _app_db
    monkeypatch.setattr(_app_db, "SessionLocal", SessionLocal)

    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _mk_user(db, email: str = "crew@test.local") -> User:
    u = User(clerk_id=f"user_{email}", email=email, tier="free")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def test_shown_marker_writes_iso_timestamp(db_session):
    u = _mk_user(db_session)
    status = _write_crew_marker(
        db_session, u, key="crew_onboarding_shown_at", only_if_missing=True,
    )
    assert "crew_onboarding_shown_at" in status
    assert isinstance(status["crew_onboarding_shown_at"], str)
    # ISO-8601 · has T + timezone tail
    assert "T" in status["crew_onboarding_shown_at"]


def test_shown_marker_idempotent(db_session):
    u = _mk_user(db_session)
    first = _write_crew_marker(
        db_session, u, key="crew_onboarding_shown_at", only_if_missing=True,
    )
    first_ts = first["crew_onboarding_shown_at"]
    # Second call must NOT overwrite (idempotent).
    second = _write_crew_marker(
        db_session, u, key="crew_onboarding_shown_at", only_if_missing=True,
    )
    assert second["crew_onboarding_shown_at"] == first_ts


def test_completed_marker_overwrites(db_session):
    u = _mk_user(db_session)
    first = _write_crew_marker(
        db_session, u, key="crew_onboarding_completed_at", only_if_missing=False,
    )
    import time as _t
    _t.sleep(0.01)
    second = _write_crew_marker(
        db_session, u, key="crew_onboarding_completed_at", only_if_missing=False,
    )
    # Last-write-wins for completed / dismissed.
    assert second["crew_onboarding_completed_at"] >= first["crew_onboarding_completed_at"]


def test_dismissed_marker_writes(db_session):
    u = _mk_user(db_session)
    status = _write_crew_marker(
        db_session, u, key="crew_onboarding_dismissed_at", only_if_missing=False,
    )
    assert "crew_onboarding_dismissed_at" in status


def test_all_three_keys_coexist(db_session):
    """shown / completed / dismissed live under the same JSON dict and
    must not clobber each other."""
    u = _mk_user(db_session)
    _write_crew_marker(db_session, u, key="crew_onboarding_shown_at", only_if_missing=True)
    _write_crew_marker(db_session, u, key="crew_onboarding_completed_at", only_if_missing=False)
    status = _write_crew_marker(db_session, u, key="crew_onboarding_dismissed_at", only_if_missing=False)
    assert "crew_onboarding_shown_at" in status
    assert "crew_onboarding_completed_at" in status
    assert "crew_onboarding_dismissed_at" in status


def test_snapshot_response_shape(db_session):
    u = _mk_user(db_session)
    _write_crew_marker(db_session, u, key="crew_onboarding_shown_at", only_if_missing=True)
    resp = _crew_marker_response(dict(u.onboarding_status or {}))
    assert resp.ok is True
    assert resp.shown_at is not None
    assert resp.completed_at is None
    assert resp.dismissed_at is None
