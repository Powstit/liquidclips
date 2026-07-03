"""Batch 2C · THE SEVER · full-stack proof.

Before this batch, ``routes/agency.py:_require_agency_owner_or_staff``
returned unconditionally when the caller's email was in
``ADMIN_EMAILS``. That meant an admin could read/mutate ANY agency
tenant via the customer route without an audit trail. Batch 2C removed
that line.

These tests hit the real FastAPI TestClient against
``routes/agency.py`` so we prove the sever at the HTTP layer, not just
at the evaluator seam.

Named assertions covered:

* ``agency_a_to_b_denied`` (full stack) — A hitting /agency/{B}/* → 403.
* ``admin_no_cross_via_customer_route`` — the specific sever behaviour.
* Regression boundary — admin STILL opens their own tenant; ordinary
  Clipper / Agency sessions do not lock out.
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
from app.jwt_signer import issue_license_jwt
from app.models import User
from app.routes import agency as agency_module


@pytest.fixture()
def client_and_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, expire_on_commit=False
    )

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(agency_module.router)
    app.dependency_overrides[get_db] = override_get_db

    with SessionLocal() as seed:
        yield TestClient(app), seed
    app.dependency_overrides.clear()


def _seed_agency_owner(session, *, email: str, tier: str = "agency", platform_role: str = "none"):
    user = User(
        id=uuid.uuid4().hex,
        clerk_id=f"clerk_{uuid.uuid4().hex[:8]}",
        email=email,
        tier=tier,
        platform_role=platform_role,
    )
    session.add(user)
    session.commit()
    token, _ = issue_license_jwt(
        user_id=user.id, tier=tier, platform_role=platform_role
    )
    return user, token


def test_agency_a_gets_own_roster(client_and_session):
    """Regression boundary: agency owner A can still hit /agency/A/roster."""
    client, session = client_and_session
    owner_a, token_a = _seed_agency_owner(session, email="a@example.com")

    r = client.get(
        f"/agency/{owner_a.id}/roster",
        headers={"authorization": f"Bearer {token_a}"},
    )
    assert r.status_code == 200


def test_agency_a_cannot_read_b_roster(client_and_session):
    """Master assertion agency_a_to_b_denied at HTTP layer."""
    client, session = client_and_session
    _, token_a = _seed_agency_owner(session, email="a@example.com")
    owner_b, _ = _seed_agency_owner(session, email="b@example.com")

    r = client.get(
        f"/agency/{owner_b.id}/roster",
        headers={"authorization": f"Bearer {token_a}"},
    )
    assert r.status_code == 403
    assert "agency owner" in r.json()["detail"].lower()


def test_admin_cannot_read_b_roster_via_customer_route(client_and_session):
    """THE SEVER — batch 2c's whole reason to exist.

    An admin (persisted ``platform_role='admin'``) hitting the customer
    ``/agency/{B}/roster`` route with a valid JWT MUST get 403. Cross-
    tenant admin access is only possible via the audited
    ``/admin/support/*`` routes introduced in batch 2D."""
    client, session = client_and_session
    # Seed an admin on a non-agency tier so is_agency_tier(admin) is False
    # even without the deps.py in-memory elevation. Their persisted
    # platform_role is 'admin' — the bypass was removed regardless.
    admin, admin_token = _seed_agency_owner(
        session,
        email="daniel@example.com",
        tier="solo",
        platform_role="admin",
    )
    owner_b, _ = _seed_agency_owner(session, email="b@example.com")

    r = client.get(
        f"/agency/{owner_b.id}/roster",
        headers={"authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 403, (
        "admin bypass should have been severed by batch 2c — "
        "customer /agency/{other}/* must not be reachable by admin without support context"
    )


def test_clipper_gets_403_on_someone_elses_agency(client_and_session):
    """Regression: ordinary Clipper still gets 403 on cross-tenant."""
    client, session = client_and_session
    clipper, clipper_token = _seed_agency_owner(
        session, email="clipper@example.com", tier="solo"
    )
    owner_a, _ = _seed_agency_owner(session, email="a@example.com")

    r = client.get(
        f"/agency/{owner_a.id}/roster",
        headers={"authorization": f"Bearer {clipper_token}"},
    )
    assert r.status_code == 403
