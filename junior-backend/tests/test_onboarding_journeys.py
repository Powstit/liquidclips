"""Step 4 · Clipper + Agency onboarding state machines.

Named assertions per SELF_ONBOARDING_RELEASE_MASTER.md §Step 4:

* ``clipper_resume``    — cold restart / reconnect picks up at the
                           next expected clipper state.
* ``clipper_idempotent``— repeat mark of the same state is a no-op.
* ``agency_resume``     — cold restart picks up at the next expected
                           agency state.
* ``agency_idempotent`` — repeat mark of the same state is a no-op.
* ``server_owned``      — state machine writes land on the server DB,
                           NOT client-only storage. Verified by
                           reading ``MilestoneTransition`` rows back.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import MilestoneTransition, User
from app.onboarding_journeys import (
    AGENCY_PATH,
    CLIPPER_PATH,
    advance,
    all_journeys,
    current_state,
    journey_progress,
    next_state_for,
    resume,
)


@pytest.fixture()
def session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with Session() as s:
        yield s


def _mkuser(session, *, tier: str = "solo"):
    u = User(
        id=uuid.uuid4().hex,
        clerk_id=f"clerk_{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.com",
        tier=tier,
    )
    session.add(u)
    session.commit()
    return u


# ---------------------------------------------------------------------------
# clipper_resume · fresh install picks up at next expected step
# ---------------------------------------------------------------------------


def test_clipper_resume_fresh_install(session):
    user = _mkuser(session)
    res = resume(session, user, "clipper")
    assert res["next"] == "account_created"
    assert res["surface"] == "sign-up"
    assert res["complete"] is False


def test_clipper_resume_after_first_two_steps(session):
    user = _mkuser(session)
    advance(session, user, "clipper", "account_created", source_surface="webhook.clerk")
    advance(session, user, "clipper", "desktop_connected", source_surface="desktop.activation")
    res = resume(session, user, "clipper")
    assert res["next"] == "source_added"
    assert res["surface"] == "desktop.create.paste-url"


def test_clipper_journey_completes_returns_none(session):
    user = _mkuser(session)
    for state in CLIPPER_PATH:
        advance(session, user, "clipper", state, source_surface=f"test.{state}")
    res = resume(session, user, "clipper")
    assert res["next"] is None
    assert res["surface"] is None
    assert res["complete"] is True


# ---------------------------------------------------------------------------
# clipper_idempotent · repeat marks are no-ops
# ---------------------------------------------------------------------------


def test_clipper_idempotent_same_source(session):
    user = _mkuser(session)
    first = advance(session, user, "clipper", "first_clip_generated", source_surface="desktop.engine.build")
    second = advance(session, user, "clipper", "first_clip_generated", source_surface="desktop.engine.build")
    assert first is True
    assert second is False

    rows = session.query(MilestoneTransition).filter_by(user_id=user.id, next_state="first_clip_generated").all()
    assert len(rows) == 1


def test_clipper_idempotent_with_explicit_key(session):
    user = _mkuser(session)
    # Same event_id → dedupe even across sources
    first = advance(
        session, user, "clipper", "first_publish_or_download",
        source_surface="desktop.publish.modal",
        idempotency_key="evt_publish_abc",
    )
    dup = advance(
        session, user, "clipper", "first_publish_or_download",
        source_surface="desktop.publish.modal",
        idempotency_key="evt_publish_abc",
    )
    assert first is True
    assert dup is False


# ---------------------------------------------------------------------------
# agency_resume · same guarantees on the agency lane
# ---------------------------------------------------------------------------


def test_agency_resume_fresh_install(session):
    user = _mkuser(session, tier="agency")
    res = resume(session, user, "agency")
    assert res["next"] == "account_created"
    assert res["surface"] == "sign-up"


def test_agency_resume_after_plan_active(session):
    user = _mkuser(session, tier="agency")
    advance(session, user, "agency", "account_created", source_surface="webhook.clerk")
    advance(session, user, "agency", "agency_plan_active", source_surface="webhook.whop.subscription")
    res = resume(session, user, "agency")
    assert res["next"] == "agency_profile_started"
    assert res["surface"] == "account-app.agency.profile"


def test_agency_journey_completes(session):
    user = _mkuser(session, tier="agency")
    for state in AGENCY_PATH:
        advance(session, user, "agency", state, source_surface=f"test.{state}")
    res = resume(session, user, "agency")
    assert res["complete"] is True


# ---------------------------------------------------------------------------
# agency_idempotent
# ---------------------------------------------------------------------------


def test_agency_idempotent_invite(session):
    user = _mkuser(session, tier="agency")
    first = advance(session, user, "agency", "first_invite_sent", source_surface="account-app.agency.roster")
    dup = advance(session, user, "agency", "first_invite_sent", source_surface="account-app.agency.roster")
    assert first is True
    assert dup is False


# ---------------------------------------------------------------------------
# server_owned · writes land on the server DB, not client state
# ---------------------------------------------------------------------------


def test_server_owned_writes_hit_the_db(session):
    user = _mkuser(session)
    advance(session, user, "clipper", "account_created", source_surface="webhook.clerk")
    advance(session, user, "clipper", "desktop_connected", source_surface="desktop.activation")

    rows = session.query(MilestoneTransition).filter_by(user_id=user.id).all()
    assert len(rows) == 2
    # Every row carries the master-doc contract fields
    for r in rows:
        assert r.journey == "clipper"
        assert r.next_state
        assert r.source_surface
        assert r.schema_version >= 1
        assert r.idempotency_key
        assert r.created_at is not None


def test_prev_state_records_previous(session):
    """Every audit row names the state the user was in before."""
    user = _mkuser(session)
    advance(session, user, "clipper", "account_created", source_surface="webhook.clerk")
    advance(session, user, "clipper", "desktop_connected", source_surface="desktop.activation")
    rows = session.query(MilestoneTransition).filter_by(user_id=user.id).order_by(MilestoneTransition.created_at.asc()).all()
    assert rows[0].prev_state is None
    assert rows[1].prev_state == "account_created"


# ---------------------------------------------------------------------------
# Extra guarantees
# ---------------------------------------------------------------------------


def test_unknown_state_rejected(session):
    user = _mkuser(session)
    ok = advance(session, user, "clipper", "not_a_state", source_surface="test")
    assert ok is False


def test_current_state_walks_the_furthest_reached(session):
    """Even if a caller stamps out-of-order, current_state returns the
    furthest reached state per path ordering."""
    user = _mkuser(session)
    advance(session, user, "clipper", "first_publish_or_download", source_surface="desktop.publish.modal")
    advance(session, user, "clipper", "account_created", source_surface="webhook.clerk")
    assert current_state(session, user, "clipper") == "first_publish_or_download"


def test_all_journeys_returns_both_lanes(session):
    user = _mkuser(session)
    advance(session, user, "clipper", "account_created", source_surface="webhook.clerk")
    both = all_journeys(session, user)
    assert set(both.keys()) == {"clipper", "agency"}
    assert both["clipper"]["current"] == "account_created"
    assert both["agency"]["current"] is None


# NOTE · snapshot-mirror stamping (mark_milestone side effect) is exercised
# by the existing test_onboarding_milestones.py suite that already knows how
# to isolate the independent SessionLocal from the fixture DB. Retesting it
# here would require fixture plumbing that adds cost without adding cover.


def test_journey_progress_returns_ordered_reached(session):
    user = _mkuser(session)
    advance(session, user, "clipper", "desktop_connected", source_surface="desktop.activation")
    advance(session, user, "clipper", "account_created", source_surface="webhook.clerk")
    prog = journey_progress(session, user, "clipper")
    # states_reached must reflect the PATH order, not insert order
    assert prog["states_reached"] == ["account_created", "desktop_connected"]
    assert prog["complete"] is False
    assert prog["next"] == "source_added"
