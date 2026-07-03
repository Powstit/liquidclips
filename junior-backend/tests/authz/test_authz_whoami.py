"""Batch 2E · /authz/whoami internal capability snapshot.

Endpoint used by the account-app proxy layer (Next.js) to gate admin
routes on server-authoritative ``capabilities`` + ``platform_role``
instead of the legacy client-side email allowlist. Fixture responses
mirror the projection so the three surfaces (/me, /sync, /authz/whoami)
can never disagree.
"""

from __future__ import annotations

import os
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.models import User
from app.routes import authz_whoami as authz_whoami_module


@pytest.fixture(autouse=True)
def _clear_internal_secret(monkeypatch):
    """Match the /admin/* dev bypass — empty configured secret allows all.
    Tests set the env explicitly when they want to prove the secret gate."""
    monkeypatch.delenv("INTERNAL_API_SECRET", raising=False)
    # Config settings cached at import time; force re-read.
    from app.config import get_settings
    get_settings.cache_clear()  # type: ignore[attr-defined]
    yield
    get_settings.cache_clear()  # type: ignore[attr-defined]


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
    app.include_router(authz_whoami_module.router)
    app.dependency_overrides[get_db] = override_get_db
    with SessionLocal() as seed:
        yield TestClient(app), seed
    app.dependency_overrides.clear()


def _seed(session, *, clerk_id: str, email: str, tier: str = "solo", platform_role: str = "none"):
    user = User(
        id=uuid.uuid4().hex,
        clerk_id=clerk_id,
        email=email,
        tier=tier,
        platform_role=platform_role,
    )
    session.add(user)
    session.commit()
    return user


def test_whoami_returns_admin_capabilities(client_and_session):
    client, session = client_and_session
    _seed(session, clerk_id="clerk_admin", email="daniel@example.com", platform_role="admin")

    r = client.get("/authz/whoami?clerk_user_id=clerk_admin")
    assert r.status_code == 200
    body = r.json()
    assert body["platform_role"] == "admin"
    for cap in ("hq.read", "hq.mutate", "support.tenant.read", "support.tenant.write"):
        assert cap in body["capabilities"]
    assert body["capability_schema_version"] >= 1


def test_whoami_returns_clipper_capabilities(client_and_session):
    client, session = client_and_session
    _seed(session, clerk_id="clerk_clipper", email="c@example.com", tier="solo")

    r = client.get("/authz/whoami?clerk_user_id=clerk_clipper")
    assert r.status_code == 200
    body = r.json()
    assert body["platform_role"] == "none"
    assert "clipper.use" in body["capabilities"]
    assert "hq.read" not in body["capabilities"]
    assert "agency.campaign.create" not in body["capabilities"]


def test_whoami_returns_agency_capabilities(client_and_session):
    client, session = client_and_session
    _seed(session, clerk_id="clerk_agency", email="a@example.com", tier="agency")

    r = client.get("/authz/whoami?clerk_user_id=clerk_agency")
    body = r.json()
    for cap in (
        "agency.workspace.read",
        "agency.campaign.create",
        "agency.roster.manage",
        "agency.payouts.manage",
    ):
        assert cap in body["capabilities"]


def test_whoami_404_for_unknown_clerk_id(client_and_session):
    client, session = client_and_session
    r = client.get("/authz/whoami?clerk_user_id=clerk_unknown")
    assert r.status_code == 404


def test_whoami_rejects_wrong_internal_secret(client_and_session, monkeypatch):
    from app.config import get_settings
    monkeypatch.setenv("INTERNAL_API_SECRET", "expected-secret")
    get_settings.cache_clear()  # type: ignore[attr-defined]

    client, session = client_and_session
    _seed(session, clerk_id="clerk_admin", email="daniel@example.com", platform_role="admin")

    # No header → 401.
    r = client.get("/authz/whoami?clerk_user_id=clerk_admin")
    assert r.status_code == 401
    # Wrong header → 401.
    r = client.get(
        "/authz/whoami?clerk_user_id=clerk_admin",
        headers={"x-internal-secret": "wrong"},
    )
    assert r.status_code == 401
    # Correct header → 200.
    r = client.get(
        "/authz/whoami?clerk_user_id=clerk_admin",
        headers={"x-internal-secret": "expected-secret"},
    )
    assert r.status_code == 200


def test_whoami_includes_tenant_contexts_owner_row(client_and_session):
    client, session = client_and_session
    u = _seed(session, clerk_id="clerk_agency", email="a@example.com", tier="agency")

    r = client.get("/authz/whoami?clerk_user_id=clerk_agency")
    body = r.json()
    tenants = {t["tenant_id"]: t["role"] for t in body["tenant_contexts"]}
    assert tenants[u.id] == "owner"


def test_whoami_returns_legacy_shape_mirrors(client_and_session):
    """The response includes ``raw_tier`` and ``effective_plan`` so the
    account-app can still populate its existing UI copy strings without a
    second round-trip."""
    client, session = client_and_session
    _seed(session, clerk_id="clerk_agency", email="a@example.com", tier="agency")
    r = client.get("/authz/whoami?clerk_user_id=clerk_agency")
    body = r.json()
    assert body["raw_tier"] == "agency"
    assert body["effective_plan"] == "agency"
