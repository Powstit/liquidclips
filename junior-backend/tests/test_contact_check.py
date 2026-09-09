"""``POST /me/contact-check`` — K-factor existing-user gate.

Uses an isolated FastAPI app + in-memory SQLite + dependency_overrides,
matching test_crew_invite_send.py / test_me_lc_id_claim.py.
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
from app.routes import contact_check as contact_check_module
from app.routes.contact_check import router


@pytest.fixture()
def app_state() -> Iterator[tuple[FastAPI, sessionmaker, User]]:
    # Rate-limit state is module-level (in-process, matching
    # promo_codes.py's own pattern) — clear it so tests don't leak
    # hits into each other regardless of execution order.
    contact_check_module._rate_hits.clear()

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False, future=True)

    seed_session = Session()
    caller = User(
        id=uuid.uuid4().hex,
        clerk_id=f"clerk_{uuid.uuid4().hex[:8]}",
        email="caller@example.com",
        tier="free",
    )
    existing = User(
        id=uuid.uuid4().hex,
        clerk_id=f"clerk_{uuid.uuid4().hex[:8]}",
        email="already-a-user@example.com",
        tier="free",
    )
    seed_session.add_all([caller, existing])
    seed_session.commit()
    seed_session.close()

    app = FastAPI()
    app.include_router(router)

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

    yield app, Session, caller

    app.dependency_overrides.clear()
    engine.dispose()
    contact_check_module._rate_hits.clear()


# TEST 1 — existing user → true
def test_existing_user_returns_true(app_state):
    app, _Session, _caller = app_state
    tc = TestClient(app)
    r = tc.post("/me/contact-check", json={"email": "already-a-user@example.com"})
    assert r.status_code == 200, r.text
    assert r.json() == {"is_user": True}


# TEST 2 — unknown email → false
def test_unknown_email_returns_false(app_state):
    app, _Session, _caller = app_state
    tc = TestClient(app)
    r = tc.post("/me/contact-check", json={"email": "nobody-here@example.com"})
    assert r.status_code == 200, r.text
    assert r.json() == {"is_user": False}


# TEST 3 — email normalization (case + whitespace)
def test_email_normalization_case_and_whitespace(app_state):
    app, _Session, _caller = app_state
    tc = TestClient(app)
    r = tc.post("/me/contact-check", json={"email": "  Already-A-User@Example.com  "})
    assert r.status_code == 200, r.text
    assert r.json() == {"is_user": True}


# TEST 4 — unauthenticated request rejected
def test_unauthenticated_request_rejected():
    # Deliberately the REAL app (no dependency_overrides) so the real
    # current_user -> license_claims chain runs and rejects a request
    # with no bearer token, exactly as it would in production.
    from app.main import app as real_app

    tc = TestClient(real_app)
    r = tc.post("/me/contact-check", json={"email": "anyone@example.com"})
    assert r.status_code == 401


# TEST 5 / 7 — response contains ONLY is_user, no user details exposed
def test_response_contains_only_is_user_field(app_state):
    app, _Session, _caller = app_state
    tc = TestClient(app)
    r = tc.post("/me/contact-check", json={"email": "already-a-user@example.com"})
    body = r.json()
    assert set(body.keys()) == {"is_user"}
    # Same shape whether true or false — no extra fields leak either way.
    r2 = tc.post("/me/contact-check", json={"email": "nobody-here@example.com"})
    assert set(r2.json().keys()) == {"is_user"}
    forbidden_substrings = ["id", "clerk", "whop", "tier", "affiliate", "name"]
    dumped = str(body).lower()
    # "is_user" itself contains no forbidden substring by coincidence;
    # guard explicitly rather than relying on that.
    for token in forbidden_substrings:
        assert token not in dumped.replace("is_user", ""), f"leaked '{token}' in response"


# TEST 6 — rate limiting
def test_rate_limit_returns_429_after_threshold(app_state):
    app, _Session, _caller = app_state
    tc = TestClient(app)
    limit = contact_check_module._RATE_LIMIT_MAX_HITS
    for i in range(limit):
        r = tc.post("/me/contact-check", json={"email": f"probe{i}@example.com"})
        assert r.status_code == 200, r.text
    r_over = tc.post("/me/contact-check", json={"email": "one-too-many@example.com"})
    assert r_over.status_code == 429
