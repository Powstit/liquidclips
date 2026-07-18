"""Tests for POST /me/affiliate/enroll — the SOLE Whop affiliate identity
mint entry point.

Business rule LOCKED 2026-07-18:
  - Payment lane and affiliate lane are separate.
  - Payment webhooks NEVER mint affiliate identities.
  - This endpoint is the sole entry point for whop.affiliates.create().

Covers:
  1. Paying user → mints identity, activates 50% overrides.
  2. Already-enrolled user → idempotent, no re-mint.
  3. Free-tier user → 402 subscription_required.
  4. Non-active subscription_status → 402 subscription_required.
  5. Money gate off (affiliate_commission_live=False) → dry_run.
  6. Malformed Whop response (missing id) → 502 whop_response_malformed.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import get_settings
from app.db import Base, get_db
from app.deps import current_user
from app.models import User
from app.routes import affiliate_enroll as affiliate_enroll_module
from app.services import affiliate_commission


@pytest.fixture()
def client_and_session():
    """Build an isolated FastAPI app + in-memory SQLite DB with dependency
    overrides. A single connection (StaticPool) is shared so the seed
    session and the request session see the same data.
    """
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
    app.include_router(affiliate_enroll_module.router)
    app.dependency_overrides[get_db] = override_get_db

    with SessionLocal() as seed:
        yield app, TestClient(app), seed
    app.dependency_overrides.clear()


def _mk_user(
    session,
    *,
    tier: str = "solo",
    subscription_status: str = "active",
    whop_affiliate_id: str | None = None,
    whop_affiliate_code: str | None = None,
) -> User:
    u = User(
        id=uuid.uuid4().hex,
        clerk_id=f"clerk_{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.com",
        tier=tier,
        subscription_status=subscription_status,
        whop_affiliate_id=whop_affiliate_id,
        whop_affiliate_code=whop_affiliate_code,
    )
    session.add(u)
    session.commit()
    return u


def _bind_user(app: FastAPI, user: User) -> None:
    """Override current_user so it resolves the user via the SAME session
    that the endpoint receives via get_db. This keeps the ORM instance
    persistent inside that session (avoids `not persistent within this Session`
    errors when the endpoint calls db.refresh()).
    """
    user_id = user.id
    from fastapi import Depends
    from sqlalchemy.orm import Session as _Session

    def _resolve_user(db: _Session = Depends(get_db)) -> User:
        return db.get(User, user_id)  # type: ignore[return-value]

    app.dependency_overrides[current_user] = _resolve_user


# ---------------------------------------------------------------------------
# 1. Paying user → mint + activate
# ---------------------------------------------------------------------------
def test_enroll_endpoint_mints_identity_for_paying_user(
    client_and_session, monkeypatch
):
    app, client, session = client_and_session
    user = _mk_user(session, tier="solo", subscription_status="active")
    _bind_user(app, user)

    settings = get_settings()
    monkeypatch.setattr(settings, "affiliate_commission_live", True)
    monkeypatch.setattr(settings, "whop_api_key", "test-key")

    # Stub whop identity mint
    def _fake_create(_user):
        return {"id": "aff_minted_abc", "username": "clippername"}

    monkeypatch.setattr(
        affiliate_enroll_module, "create_affiliate_identity", _fake_create
    )

    # Stub reconcile so we can assert it ran without hitting Whop
    reconcile_calls: list[str] = []

    def _fake_reconcile(_db, u, **_kw):
        reconcile_calls.append(u.whop_affiliate_id or "")
        return "active"

    monkeypatch.setattr(affiliate_enroll_module, "reconcile_user", _fake_reconcile)

    resp = client.post("/me/affiliate/enroll")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["state"] == "enrolled"
    assert body["whop_affiliate_id"] == "aff_minted_abc"
    assert body["whop_affiliate_code"] == "clippername"
    assert body["whop_affiliate_url"] == "https://whop.com/checkout/studio?a=clippername"

    # Identity persisted
    session.refresh(user)
    assert user.whop_affiliate_id == "aff_minted_abc"
    assert user.whop_affiliate_code == "clippername"

    # Reconcile ran (i.e. overrides activated) after identity mint
    assert reconcile_calls == ["aff_minted_abc"]


# ---------------------------------------------------------------------------
# 2. Idempotency
# ---------------------------------------------------------------------------
def test_enroll_endpoint_is_idempotent(client_and_session, monkeypatch):
    app, client, session = client_and_session
    user = _mk_user(
        session,
        tier="solo",
        subscription_status="active",
        whop_affiliate_id="aff_existing",
        whop_affiliate_code="existingcode",
    )
    _bind_user(app, user)

    # If create_affiliate_identity is called even once, fail loudly
    def _boom(_user):
        raise AssertionError("must NOT re-mint an already-enrolled user")

    monkeypatch.setattr(affiliate_enroll_module, "create_affiliate_identity", _boom)

    reconcile_calls: list[str] = []

    def _fake_reconcile(_db, u, **_kw):
        reconcile_calls.append(u.whop_affiliate_id or "")
        return "active"

    monkeypatch.setattr(affiliate_enroll_module, "reconcile_user", _fake_reconcile)

    resp1 = client.post("/me/affiliate/enroll")
    resp2 = client.post("/me/affiliate/enroll")

    for resp in (resp1, resp2):
        assert resp.status_code == 200
        body = resp.json()
        assert body["state"] == "already_enrolled"
        assert body["whop_affiliate_id"] == "aff_existing"
        assert body["whop_affiliate_code"] == "existingcode"
        assert (
            body["whop_affiliate_url"]
            == "https://whop.com/checkout/studio?a=existingcode"
        )

    # Reconcile ran both times (keeps overrides in sync) but no mint
    assert reconcile_calls == ["aff_existing", "aff_existing"]


# ---------------------------------------------------------------------------
# 3. Free-tier user rejected
# ---------------------------------------------------------------------------
def test_enroll_endpoint_rejects_free_users(client_and_session, monkeypatch):
    app, client, session = client_and_session
    user = _mk_user(session, tier="free", subscription_status="active")
    _bind_user(app, user)

    def _boom(_user):
        raise AssertionError("must NOT mint for free-tier user")

    monkeypatch.setattr(affiliate_enroll_module, "create_affiliate_identity", _boom)

    resp = client.post("/me/affiliate/enroll")
    assert resp.status_code == 402
    body = resp.json()
    assert body["detail"]["code"] == "subscription_required"


# ---------------------------------------------------------------------------
# 4. Inactive subscription rejected
# ---------------------------------------------------------------------------
def test_enroll_endpoint_rejects_inactive_subscription(
    client_and_session, monkeypatch
):
    app, client, session = client_and_session
    user = _mk_user(session, tier="solo", subscription_status="expired")
    _bind_user(app, user)

    def _boom(_user):
        raise AssertionError("must NOT mint for inactive subscription")

    monkeypatch.setattr(affiliate_enroll_module, "create_affiliate_identity", _boom)

    resp = client.post("/me/affiliate/enroll")
    assert resp.status_code == 402
    body = resp.json()
    assert body["detail"]["code"] == "subscription_required"


# ---------------------------------------------------------------------------
# 5. Money gate off → dry_run
# ---------------------------------------------------------------------------
def test_enroll_endpoint_returns_dry_run_when_money_gate_off(
    client_and_session, monkeypatch
):
    app, client, session = client_and_session
    user = _mk_user(session, tier="solo", subscription_status="active")
    _bind_user(app, user)

    settings = get_settings()
    monkeypatch.setattr(settings, "affiliate_commission_live", False)

    # create_affiliate_identity returns None when the money gate is off — no
    # Whop calls, no identity persisted.
    resp = client.post("/me/affiliate/enroll")
    assert resp.status_code == 200
    body = resp.json()
    assert body["state"] == "dry_run"
    assert body["whop_affiliate_id"] is None
    assert body["whop_affiliate_code"] is None
    assert body["whop_affiliate_url"] is None

    # Nothing persisted
    session.refresh(user)
    assert user.whop_affiliate_id is None


# ---------------------------------------------------------------------------
# 6. Malformed Whop response → 502
# ---------------------------------------------------------------------------
def test_enroll_endpoint_handles_whop_missing_id(client_and_session, monkeypatch):
    app, client, session = client_and_session
    user = _mk_user(session, tier="pro", subscription_status="active")
    _bind_user(app, user)

    settings = get_settings()
    monkeypatch.setattr(settings, "affiliate_commission_live", True)
    monkeypatch.setattr(settings, "whop_api_key", "test-key")

    def _fake_create(_user):
        # No "id" in response — malformed
        return {"username": "unlucky", "status": "pending"}

    monkeypatch.setattr(
        affiliate_enroll_module, "create_affiliate_identity", _fake_create
    )

    resp = client.post("/me/affiliate/enroll")
    assert resp.status_code == 502
    body = resp.json()
    assert body["detail"]["code"] == "whop_response_malformed"

    # Nothing persisted
    session.refresh(user)
    assert user.whop_affiliate_id is None
