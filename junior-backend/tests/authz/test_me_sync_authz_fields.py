"""/me + /sync additive Step 2 batch 2b fields.

Verifies:

* Every new field lands on the response (platform_role, capabilities,
  limits, tenant_contexts, operating_mode, target_tenant_id,
  capability_schema_version).
* Every legacy field is preserved (no accidental removal).
* An admin's ``platform_role`` reflects the persisted column, not the
  in-memory tier elevation that batch 2C removes.
* Values echo the AuthorizationContext projected from CURRENT DB state.
* Issued JWTs carry the new claims.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import jwt as _jwt_lib

from app.db import Base, get_db
from app.jwt_signer import issue_license_jwt, public_pem
from app.models import User
from app.routes import me as me_module
from app.routes import sync as sync_module


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
    app.include_router(me_module.router)
    app.include_router(sync_module.router)
    app.dependency_overrides[get_db] = override_get_db

    with SessionLocal() as seed:
        yield TestClient(app), seed
    app.dependency_overrides.clear()


def _mint_and_seed(session, *, tier: str, platform_role: str = "none", founder: bool = False):
    user = User(
        id=uuid.uuid4().hex,
        clerk_id=f"clerk_{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.com",
        tier=tier,
        founder_flag=founder,
        platform_role=platform_role,
    )
    session.add(user)
    session.commit()
    token, _ = issue_license_jwt(
        user_id=user.id,
        tier=tier,
        founder=founder,
        platform_role=platform_role,
    )
    return user, token


def test_me_returns_new_authz_fields_for_clipper(client_and_session):
    client, session = client_and_session
    user, token = _mint_and_seed(session, tier="solo")

    response = client.get("/me", headers={"authorization": f"Bearer {token}"})
    assert response.status_code == 200
    body = response.json()

    assert body["platform_role"] == "none"
    assert "clipper.use" in body["capabilities"]
    # Clipper never gets agency plan caps.
    assert "agency.campaign.create" not in body["capabilities"]
    assert body["operating_mode"] == "self"
    assert body["target_tenant_id"] is None
    assert body["capability_schema_version"] >= 1
    assert isinstance(body["limits"], dict)
    assert any(t["tenant_id"] == user.id and t["role"] == "owner" for t in body["tenant_contexts"])


def test_me_returns_admin_platform_role_from_persisted_column(client_and_session):
    client, session = client_and_session
    _, token = _mint_and_seed(session, tier="solo", platform_role="admin")

    response = client.get("/me", headers={"authorization": f"Bearer {token}"})
    body = response.json()
    assert body["platform_role"] == "admin"
    for cap in ("hq.read", "hq.mutate", "support.tenant.read", "support.tenant.write"):
        assert cap in body["capabilities"]


def test_me_preserves_all_legacy_fields(client_and_session):
    """Every field a legacy client reads must still be present after
    Batch 2B. Regression boundary from the master doc: ordinary sessions
    do not lock out — the legacy fields keep working."""
    client, session = client_and_session
    _, token = _mint_and_seed(session, tier="agency")

    response = client.get("/me", headers={"authorization": f"Bearer {token}"})
    body = response.json()
    for legacy_field in (
        "backend_user_id",
        "clerk_id",
        "email",
        "raw_tier",
        "raw_founder",
        "effective_tier",
        "effective_founder",
        "admin_override",
        "subscription_status",
        "billing_provider",
        "remaining_exports",
        "account_limit",
        "extra_accounts_purchased",
        "clips_created",
        "whop_backend_key_configured",
    ):
        assert legacy_field in body, f"missing legacy field {legacy_field}"


def test_sync_returns_new_authz_fields(client_and_session):
    client, session = client_and_session
    _, token = _mint_and_seed(session, tier="agency")

    response = client.get("/sync", headers={"authorization": f"Bearer {token}"})
    assert response.status_code == 200
    body = response.json()

    assert body["platform_role"] == "none"  # agency owner is not platform-staff
    for cap in ("agency.campaign.create", "agency.roster.manage", "clipper.use"):
        assert cap in body["capabilities"]
    assert body["operating_mode"] == "self"
    assert body["target_tenant_id"] is None
    assert body["capability_schema_version"] >= 1


def test_sync_preserves_legacy_fields(client_and_session):
    client, session = client_and_session
    _, token = _mint_and_seed(session, tier="solo")

    response = client.get("/sync", headers={"authorization": f"Bearer {token}"})
    body = response.json()
    for legacy_field in (
        "tier",
        "founder",
        "subscription_status",
        "paid_until",
        "billing_provider",
        "features",
        "new_license_jwt",
        "remaining_exports",
        "admin_override",
        "active_announcements",
        "trial_days_remaining",
        "trial_convert_pending",
        "onboarding_status",
    ):
        assert legacy_field in body, f"missing legacy field {legacy_field}"


def test_issued_jwt_carries_new_claims():
    """The JWT signer's additive claims must land in the payload and be
    readable via the bundled public key. Old-shape callers (no platform
    role, no schema version) still work and get sensible defaults."""
    token, _ = issue_license_jwt(
        user_id="user_1",
        tier="solo",
        platform_role="admin",
        tenant_id_own=None,
    )
    payload = _jwt_lib.decode(token, public_pem(), algorithms=["EdDSA"])
    assert payload["platform_role"] == "admin"
    assert payload["capability_schema_version"] >= 1
    assert payload["tenant_id_own"] is None
    # Legacy claims preserved.
    for legacy in ("sub", "tier", "founder", "features", "iat", "exp", "iss"):
        assert legacy in payload


def test_issued_jwt_defaults_platform_role_to_none():
    token, _ = issue_license_jwt(user_id="user_1", tier="solo")
    payload = _jwt_lib.decode(token, public_pem(), algorithms=["EdDSA"])
    assert payload["platform_role"] == "none"
