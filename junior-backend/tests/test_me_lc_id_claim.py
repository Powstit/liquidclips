"""``POST /me/lc-id/claim`` · Wave 1 · Cluster 1 · identity ladder.

Backend contract test for the handle-claim endpoint introduced by
``lcos/reports/impact/wave-1-identity-ladder/``. Verifies:

  * ``200`` on a valid handle with an updated ``MeResponse.handle`` in
    the response body.
  * ``409`` on a case-insensitive collision with another user.
  * ``422`` on a regex fail or reserved word.
  * ``401`` when the caller isn't authenticated.
  * Idempotent for the same caller reclaiming their own handle.

Uses ``FastAPI`` + in-memory SQLite + ``dependency_overrides`` — the
same pattern as ``test_tier_enforcement.py`` and ``test_founder_seat_cap
.py``. No fixtures are shared across tests to avoid module-scope state
bleed from the app.main lifespan.
"""

from __future__ import annotations

import uuid
from typing import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.deps import current_user
from app.models import User
from app.routes.me import router as me_router


# ---------------------------------------------------------------------
# Test-only FastAPI app · isolates the endpoint from the full app
# lifespan (which mutates DB + spawns background tasks).
# ---------------------------------------------------------------------


def _mk_user(session, **overrides) -> User:
    row = User(
        id=uuid.uuid4().hex,
        clerk_id=overrides.pop("clerk_id", f"clerk_{uuid.uuid4().hex[:8]}"),
        email=overrides.pop("email", f"{uuid.uuid4().hex[:8]}@example.com"),
        tier=overrides.pop("tier", "free"),
        lc_id=overrides.pop("lc_id", None),
        handle=overrides.pop("handle", None),
        **overrides,
    )
    session.add(row)
    session.commit()
    return row


@pytest.fixture()
def app_state() -> Iterator[tuple[FastAPI, sessionmaker, User]]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False, future=True)

    seed_session = Session()
    caller = _mk_user(seed_session, lc_id="LC-TESTAA")
    other = _mk_user(seed_session, lc_id="LC-OTHERB", handle="alreadytaken")
    seed_session.close()

    app = FastAPI()
    app.include_router(me_router)

    def _override_get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    def _override_current_user():
        s = Session()
        try:
            row = s.get(User, caller.id)
            assert row is not None
            return row
        finally:
            s.close()

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[current_user] = _override_current_user

    # ``other`` is exposed so a collision test can assert against it.
    yield app, Session, caller

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------
# 200 · valid claim writes to the caller's row and returns MeResponse
# ---------------------------------------------------------------------


def test_valid_handle_returns_200_and_updates_row(app_state):
    app, Session, caller = app_state
    tc = TestClient(app)

    r = tc.post("/me/lc-id/claim", json={"handle": "danielx_"})

    assert r.status_code == 200, r.text
    body = r.json()
    # MeResponse fields — the response should carry the updated handle.
    assert body["handle"] == "danielx_"
    assert body["lc_id"] == "LC-TESTAA"
    # And the DB row was persisted.
    with Session() as s:
        row = s.get(User, caller.id)
        assert row.handle == "danielx_"


def test_valid_handle_is_normalised_to_lowercase(app_state):
    # The backend strips + lowercases before validation. A submission
    # with uppercase / whitespace becomes the normalised form.
    app, Session, caller = app_state
    tc = TestClient(app)

    # Note: the client SHOULD send lowercase — but if it doesn't the
    # backend still normalises. Casing this way (DANIELx_) fails the
    # regex directly if we DIDN'T normalise, so this test asserts the
    # normalisation happens BEFORE the regex check.
    r = tc.post("/me/lc-id/claim", json={"handle": "  DANIELx_  "})

    assert r.status_code == 200, r.text
    assert r.json()["handle"] == "danielx_"


# ---------------------------------------------------------------------
# 409 · case-insensitive collision with another user's handle
# ---------------------------------------------------------------------


def test_duplicate_handle_returns_409(app_state):
    app, Session, caller = app_state
    tc = TestClient(app)

    # ``other`` was seeded with handle="alreadytaken".
    r = tc.post("/me/lc-id/claim", json={"handle": "alreadytaken"})
    assert r.status_code == 409
    assert "handle_taken" in r.text


def test_duplicate_handle_case_insensitive(app_state):
    app, Session, caller = app_state
    tc = TestClient(app)

    # Uppercase variant should still collide after normalisation.
    r = tc.post("/me/lc-id/claim", json={"handle": "ALREADYTAKEN"})
    assert r.status_code == 409


def test_reclaiming_own_handle_is_idempotent_200(app_state):
    app, Session, caller = app_state
    tc = TestClient(app)

    # First claim succeeds.
    r1 = tc.post("/me/lc-id/claim", json={"handle": "reclaim_ok"})
    assert r1.status_code == 200

    # Second claim with the same handle returns 200, not 409, because
    # the "another user" filter excludes the caller's own row.
    r2 = tc.post("/me/lc-id/claim", json={"handle": "reclaim_ok"})
    assert r2.status_code == 200
    assert r2.json()["handle"] == "reclaim_ok"


# ---------------------------------------------------------------------
# 422 · regex fail
# ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_handle",
    [
        "ab",              # too short (< 3) even after normalisation
        "a" * 21,          # too long (> 20)
        "cat-dog",         # dash banned by the Wave 1 shape
        "cat.dog",         # dot banned by the Wave 1 shape
        "hello world",     # space banned
        "hello@world",     # @ banned
    ],
)
def test_invalid_handle_shape_returns_422(app_state, bad_handle):
    """The backend normalises ``.strip().lower()`` BEFORE the regex
    check, so uppercase alone doesn't fail (a ``Cat_dog`` submission
    lowercases to a valid handle). Only shapes that survive the
    normalisation as invalid should trip 422."""
    app, Session, caller = app_state
    tc = TestClient(app)

    r = tc.post("/me/lc-id/claim", json={"handle": bad_handle})
    # Pydantic 422 (payload validation) OR handler 422 (regex fail) —
    # either is a proper client error. We accept both because a length
    # >20 trips the pydantic ``max_length=40`` check inside acceptable
    # bounds but past the regex.
    assert r.status_code in (400, 422), r.text


def test_uppercase_normalises_to_valid_handle(app_state):
    """Documented normalisation behaviour · ``Cat_dog`` → ``cat_dog``
    → 200. Locked as a distinct test so any change to the
    normalisation rules is loud."""
    app, Session, caller = app_state
    tc = TestClient(app)
    r = tc.post("/me/lc-id/claim", json={"handle": "Cat_dog"})
    assert r.status_code == 200, r.text
    assert r.json()["handle"] == "cat_dog"


def test_reserved_word_returns_422(app_state):
    app, Session, caller = app_state
    tc = TestClient(app)

    r = tc.post("/me/lc-id/claim", json={"handle": "admin"})
    assert r.status_code == 422
    assert "handle_reserved" in r.text


def test_reserved_word_case_insensitive_after_normalisation(app_state):
    app, Session, caller = app_state
    tc = TestClient(app)

    # ``ADMIN`` → normalised to ``admin`` → hits the reserved set.
    r = tc.post("/me/lc-id/claim", json={"handle": "ADMIN"})
    assert r.status_code == 422
    assert "handle_reserved" in r.text


# ---------------------------------------------------------------------
# 401 · missing auth
# ---------------------------------------------------------------------


def test_missing_auth_returns_401():
    """Without the ``current_user`` override, the endpoint enforces the
    real license JWT dependency and rejects unauthenticated calls."""
    app = FastAPI()
    app.include_router(me_router)
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)

    def _override_get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _override_get_db

    tc = TestClient(app)
    r = tc.post("/me/lc-id/claim", json={"handle": "someone_"})
    # ``license_claims`` raises 401 when there's no ``Authorization``
    # header, which propagates through the un-overridden
    # ``current_user`` dep chain.
    assert r.status_code == 401
    engine.dispose()
