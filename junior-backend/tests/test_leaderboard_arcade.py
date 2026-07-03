"""Batch 3E · /leaderboard/arcade — fresh-install and populated behaviour.

Prove:
* Fresh DB (no users with ``arcade_high_score > 0``) returns empty
  clippers + empty agencies + zero counters.
* Populated DB splits agencies vs clippers by ``is_agency_tier``.
* Endpoint is UNAUTHENTICATED — the splash calls it pre-JWT.
* Response contains ONLY public display fields (handle + score +
  avatar_index) — never email, clerk id, or raw user id.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.models import User
from app.routes import leaderboard as leaderboard_module


@pytest.fixture()
def client_and_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(leaderboard_module.router)
    app.dependency_overrides[get_db] = override_get_db

    with SessionLocal() as seed:
        yield TestClient(app), seed
    app.dependency_overrides.clear()


def _seed(session, *, tier: str, score: int, handle: str | None = None):
    user = User(
        id=uuid.uuid4().hex,
        clerk_id=f"clerk_{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.com",
        tier=tier,
        handle=handle,
        arcade_high_score=score,
    )
    session.add(user)
    session.commit()
    return user


def test_fresh_install_returns_empty_state(client_and_session):
    """Zero rows means honest empty arrays and zero counters — no
    fabricated leaderboard on first launch."""
    client, session = client_and_session
    # DB is empty of arcade scorers.
    r = client.get("/leaderboard/arcade")
    assert r.status_code == 200
    body = r.json()
    assert body["clippers"] == []
    assert body["agencies"] == []
    assert body["counters"]["clippers"]["total"] == 0
    assert body["counters"]["agencies"]["total"] == 0
    assert body["counters"]["clippers"]["delta_today"] == 0


def test_endpoint_is_unauthenticated(client_and_session):
    """Splash renders pre-JWT — the route must respond 200 without
    any authorization header."""
    client, session = client_and_session
    r = client.get("/leaderboard/arcade")
    assert r.status_code == 200
    # Sanity — no bearer token was sent; a 200 confirms no auth dep fired.


def test_populated_leaderboard_splits_agencies_from_clippers(client_and_session):
    client, session = client_and_session
    _seed(session, tier="solo", score=2840, handle="KingKade")
    _seed(session, tier="pro", score=1760, handle="VisorVibe")
    _seed(session, tier="agency", score=24560, handle="BowtieBoss")
    _seed(session, tier="agency_solo", score=18340, handle="GoldMedal")

    r = client.get("/leaderboard/arcade")
    body = r.json()

    assert len(body["clippers"]) == 2
    assert len(body["agencies"]) == 2

    clipper_handles = {row["handle"] for row in body["clippers"]}
    agency_handles = {row["handle"] for row in body["agencies"]}
    assert clipper_handles == {"KingKade", "VisorVibe"}
    assert agency_handles == {"BowtieBoss", "GoldMedal"}

    # Sorted by score DESC — first clipper is the top scorer.
    assert body["clippers"][0]["handle"] == "KingKade"
    assert body["agencies"][0]["handle"] == "BowtieBoss"

    assert body["counters"]["clippers"]["total"] == 2
    assert body["counters"]["agencies"]["total"] == 2


def test_response_only_exposes_public_fields(client_and_session):
    """Confirm no PII leaks through the response."""
    client, session = client_and_session
    _seed(session, tier="solo", score=500, handle="TestUser")

    r = client.get("/leaderboard/arcade")
    row = r.json()["clippers"][0]

    # Public fields present
    assert set(row.keys()) == {"handle", "score", "avatar_index"}
    assert row["handle"] == "TestUser"
    assert row["score"] == 500
    assert 1 <= row["avatar_index"] <= 10
    # PII never leaks
    for banned in ("email", "clerk_id", "user_id", "id"):
        assert banned not in row


def test_missing_handle_falls_back_to_email_shorthand(client_and_session):
    """A user without ``handle`` set still shows up on the board using
    the pre-@ portion of their email — safer than nothing, and matches
    what /leaderboard/earnings does via ``cached_display_handle``."""
    client, session = client_and_session
    user = User(
        id=uuid.uuid4().hex,
        clerk_id="clerk_x",
        email="pippin@example.com",
        tier="solo",
        arcade_high_score=999,
    )
    session.add(user)
    session.commit()

    r = client.get("/leaderboard/arcade")
    handles = [row["handle"] for row in r.json()["clippers"]]
    assert "pippin" in handles


def test_limit_parameter_caps_row_count(client_and_session):
    client, session = client_and_session
    for i in range(8):
        _seed(session, tier="solo", score=1000 + i, handle=f"C{i}")

    r = client.get("/leaderboard/arcade?limit=3")
    assert len(r.json()["clippers"]) == 3
    # Highest scores first.
    scores = [row["score"] for row in r.json()["clippers"]]
    assert scores == sorted(scores, reverse=True)


def test_avatar_index_is_stable_per_user(client_and_session):
    """Same user id → same avatar slot across calls."""
    client, session = client_and_session
    _seed(session, tier="solo", score=500, handle="Steady")
    first = client.get("/leaderboard/arcade").json()["clippers"][0]["avatar_index"]
    second = client.get("/leaderboard/arcade").json()["clippers"][0]["avatar_index"]
    assert first == second
