"""Regression guard · Whop OAuth PKCE.

2026-08-04 — /auth/whop/start built the Whop authorize URL without any
PKCE parameters. Whop's OAuth now requires PKCE unconditionally, so every
"Connect Whop" attempt failed 100% of the time with
`invalid_request · code_challenge is required`, confirmed live against
production. This pins the fix: /start mints + stores a verifier and sends
a matching S256 challenge; /callback retrieves the stored verifier and
forwards it in the token exchange; a missing/consumed/expired verifier at
callback time is rejected before any token-exchange HTTP call is attempted.
"""

from __future__ import annotations

import base64
import hashlib
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import get_settings
from app.db import Base, get_db
from app.models import User, WhopOAuthPkce
from app.routes import auth_whop as auth_whop_module


@pytest.fixture()
def client_and_session(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "whop_oauth_client_id", "client_test123")
    monkeypatch.setattr(settings, "whop_oauth_client_secret", "secret_test123")
    monkeypatch.setattr(settings, "whop_oauth_redirect_uri", "https://api.jnremployee.com/auth/whop/callback")

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
    app.include_router(auth_whop_module.router)
    app.dependency_overrides[get_db] = override_get_db

    with SessionLocal() as seed:
        yield TestClient(app, follow_redirects=False), seed
    app.dependency_overrides.clear()


def test_start_includes_pkce_challenge_and_stores_verifier(client_and_session):
    client, session = client_and_session
    resp = client.get("/auth/whop/start", params={"challenge": "desktop-challenge-abc123"})

    assert resp.status_code == 302
    location = resp.headers["location"]
    qs = parse_qs(urlparse(location).query)

    assert qs["code_challenge_method"][0] == "S256"
    # Pinned against live Whop's actual validation, not just our own
    # assumptions: "read_user" (the old value) fails with invalid_scope, and
    # omitting nonce with an openid scope fails with
    # "nonce is required for openid scope" — both confirmed against
    # production before this fix.
    assert qs["scope"][0] == "openid profile email"
    assert len(qs["nonce"][0]) > 0
    challenge_sent = qs["code_challenge"][0]

    row = session.get(WhopOAuthPkce, "desktop-challenge-abc123")
    assert row is not None
    assert row.consumed_at is None
    # The stored verifier must actually hash to the challenge we sent Whop —
    # otherwise the callback's token exchange would fail Whop-side too.
    expected = base64.urlsafe_b64encode(
        hashlib.sha256(row.code_verifier.encode()).digest()
    ).rstrip(b"=").decode()
    assert challenge_sent == expected


def test_start_twice_refreshes_verifier_without_error(client_and_session):
    """A double-click / back-button retry on /start must not 500 on a
    primary-key collision — it should just mint a fresh verifier."""
    client, session = client_and_session
    client.get("/auth/whop/start", params={"challenge": "same-challenge-xyz"})
    first_verifier = session.get(WhopOAuthPkce, "same-challenge-xyz").code_verifier
    session.expire_all()

    resp2 = client.get("/auth/whop/start", params={"challenge": "same-challenge-xyz"})
    assert resp2.status_code == 302
    second_verifier = session.get(WhopOAuthPkce, "same-challenge-xyz").code_verifier
    assert second_verifier != first_verifier


def test_callback_forwards_code_verifier_in_token_exchange(client_and_session, monkeypatch):
    client, session = client_and_session

    user = User(id="user_1", clerk_id="clerk_1", email="buyer@example.com", whop_user_id="whop_user_1")
    session.add(user)
    session.commit()

    start_resp = client.get("/auth/whop/start", params={"challenge": "cb-challenge-1"})
    stored_verifier = session.get(WhopOAuthPkce, "cb-challenge-1").code_verifier

    captured = {}

    class _FakeResponse:
        def __init__(self, status_code, payload):
            self.status_code = status_code
            self._payload = payload
            self.text = str(payload)

        def json(self):
            return self._payload

    class _FakeHttpxClient:
        def __init__(self, *a, **k):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False
        def post(self, url, data=None, headers=None):
            captured["token_post_data"] = data
            return _FakeResponse(200, {"access_token": "tok_abc"})
        def get(self, url, headers=None):
            return _FakeResponse(200, {"id": "whop_user_1", "email": "buyer@example.com"})

    monkeypatch.setattr(auth_whop_module.httpx, "Client", _FakeHttpxClient)

    resp = client.get(
        "/auth/whop/callback",
        params={"code": "auth_code_xyz", "state": "cb-challenge-1"},
    )

    # Success path renders the deep-link activation HTML (200), not a
    # redirect — only the error branches 302 back to connect-desktop.
    assert resp.status_code == 200
    assert captured["token_post_data"]["code_verifier"] == stored_verifier

    row = session.get(WhopOAuthPkce, "cb-challenge-1")
    session.refresh(row)
    assert row.consumed_at is not None


def test_callback_rejects_missing_pkce_row_without_calling_whop(client_and_session, monkeypatch):
    """No /start ever happened for this state (or it already expired) — must
    bounce cleanly, and critically must NOT attempt a token exchange Whop
    would reject anyway."""
    client, session = client_and_session

    called = {"count": 0}

    class _ShouldNotBeCalled:
        def __init__(self, *a, **k):
            called["count"] += 1
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False

    monkeypatch.setattr(auth_whop_module.httpx, "Client", _ShouldNotBeCalled)

    resp = client.get(
        "/auth/whop/callback",
        params={"code": "auth_code_xyz", "state": "never-started-state"},
    )

    assert resp.status_code == 302
    assert "whop_error=state" in resp.headers["location"]
    assert called["count"] == 0


def test_callback_rejects_already_consumed_pkce_row(client_and_session, monkeypatch):
    client, session = client_and_session
    session.add(WhopOAuthPkce(
        state="already-used",
        code_verifier="whatever",
        consumed_at=datetime.now(timezone.utc),
    ))
    session.commit()

    resp = client.get(
        "/auth/whop/callback",
        params={"code": "auth_code_xyz", "state": "already-used"},
    )
    assert resp.status_code == 302
    assert "whop_error=state" in resp.headers["location"]


def test_callback_rejects_expired_pkce_row(client_and_session):
    client, session = client_and_session
    session.add(WhopOAuthPkce(
        state="stale-state",
        code_verifier="whatever",
        created_at=datetime.now(timezone.utc) - timedelta(minutes=30),
    ))
    session.commit()

    resp = client.get(
        "/auth/whop/callback",
        params={"code": "auth_code_xyz", "state": "stale-state"},
    )
    assert resp.status_code == 302
    assert "whop_error=state" in resp.headers["location"]
