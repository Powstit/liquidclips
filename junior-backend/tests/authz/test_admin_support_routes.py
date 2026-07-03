"""Batch 2D · /admin/support/* full-stack proof.

Verifies:

* Support-mode admin CAN read a cross-tenant agency roster via the
  sanctioned route (proves the sever from Batch 2C left a working
  admin escape hatch).
* Every accepted call writes an AdminAuditLog row with the ticket,
  reason, capability, expiry, and approver id (when write).
* Missing / invalid / expired support context → 400.
* Non-admin caller → 403 via ``capability_missing``.
* Write without second approver → 428 (DENY_NEEDS_SECOND_APPROVER)
  AND still writes an audit row.
* Write with valid second approver → 200 + audit + invite row.

Uses FastAPI TestClient against the real ``admin_support`` router.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.jwt_signer import issue_license_jwt
from app.models import AdminAuditLog, AgencyInvite, User
from app.routes import admin_support as admin_support_module


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
    app.include_router(admin_support_module.router)
    app.dependency_overrides[get_db] = override_get_db

    with SessionLocal() as seed:
        yield TestClient(app), seed
    app.dependency_overrides.clear()


def _mint(session, *, email: str, tier: str = "solo", platform_role: str = "none"):
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


def _support_headers(
    token: str,
    capability: str,
    *,
    ticket: str = "LC-TEST-1",
    reason: str = "test support session",
    expiry_delta: timedelta = timedelta(hours=1),
    approver_id: str | None = None,
) -> dict[str, str]:
    expiry_at = (datetime.now(timezone.utc) + expiry_delta).isoformat()
    headers = {
        "authorization": f"Bearer {token}",
        "x-support-ticket-id": ticket,
        "x-support-reason": reason,
        "x-support-expiry-at": expiry_at,
        "x-support-capability": capability,
    }
    if approver_id is not None:
        headers["x-support-approver-id"] = approver_id
    return headers


def test_admin_can_read_target_roster_via_support_route(client_and_session):
    """The sanctioned cross-tenant read — replaces the severed customer bypass."""
    client, session = client_and_session
    admin, admin_token = _mint(session, email="daniel@example.com", platform_role="admin")
    target, _ = _mint(session, email="b@example.com", tier="agency")

    r = client.get(
        f"/admin/support/agency/{target.id}/roster",
        headers=_support_headers(admin_token, "support.tenant.read"),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "members" in body
    assert "pending_invites" in body

    # Every accepted support call writes an audit row.
    rows = session.query(AdminAuditLog).all()
    assert len(rows) == 1
    row = rows[0]
    assert row.support_ticket_id == "LC-TEST-1"
    assert row.support_capability == "support.tenant.read"
    assert row.target_id == target.id
    assert row.result == "ok"


def test_missing_support_reason_rejected(client_and_session):
    client, session = client_and_session
    admin, admin_token = _mint(session, email="daniel@example.com", platform_role="admin")
    target, _ = _mint(session, email="b@example.com", tier="agency")

    headers = _support_headers(admin_token, "support.tenant.read")
    headers.pop("x-support-reason")

    r = client.get(
        f"/admin/support/agency/{target.id}/roster", headers=headers
    )
    assert r.status_code == 400
    assert "reason" in r.json()["detail"].lower()


def test_expired_support_context_rejected(client_and_session):
    client, session = client_and_session
    admin, admin_token = _mint(session, email="daniel@example.com", platform_role="admin")
    target, _ = _mint(session, email="b@example.com", tier="agency")

    r = client.get(
        f"/admin/support/agency/{target.id}/roster",
        headers=_support_headers(
            admin_token, "support.tenant.read", expiry_delta=timedelta(minutes=-5)
        ),
    )
    assert r.status_code == 400
    assert "expired" in r.json()["detail"].lower()


def test_support_ttl_ceiling_enforced(client_and_session):
    """Max 4h expiry — a caller asking for a longer session is rejected
    at the header parse. Guards against a compromised admin JWT being
    handed a long-lived support token."""
    client, session = client_and_session
    admin, admin_token = _mint(session, email="daniel@example.com", platform_role="admin")
    target, _ = _mint(session, email="b@example.com", tier="agency")

    r = client.get(
        f"/admin/support/agency/{target.id}/roster",
        headers=_support_headers(
            admin_token, "support.tenant.read", expiry_delta=timedelta(hours=24)
        ),
    )
    assert r.status_code == 400
    assert "max ttl" in r.json()["detail"].lower()


def test_capability_mismatch_rejected(client_and_session):
    """x-support-capability MUST match the endpoint's declared capability."""
    client, session = client_and_session
    admin, admin_token = _mint(session, email="daniel@example.com", platform_role="admin")
    target, _ = _mint(session, email="b@example.com", tier="agency")

    r = client.get(
        f"/admin/support/agency/{target.id}/roster",
        headers=_support_headers(admin_token, "support.tenant.write"),
    )
    assert r.status_code == 400
    assert "support.tenant.read" in r.json()["detail"]


def test_ordinary_user_denied_on_support_route(client_and_session):
    """A Clipper (platform_role='none') hitting /admin/support/* fails
    the SUPPORT_TENANT_READ capability check → 403."""
    client, session = client_and_session
    clipper, clipper_token = _mint(session, email="clipper@example.com")
    target, _ = _mint(session, email="b@example.com", tier="agency")

    r = client.get(
        f"/admin/support/agency/{target.id}/roster",
        headers=_support_headers(clipper_token, "support.tenant.read"),
    )
    assert r.status_code == 403


def test_write_without_approver_returns_428_and_audits(client_and_session):
    """Master assertion admin_support_write_audited (denial branch, HTTP layer).

    A SUPPORT_TENANT_WRITE call with no ``x-support-approver-id`` returns
    ``428 Precondition Required`` AND writes an audit row so the attempt
    is traceable."""
    client, session = client_and_session
    admin, admin_token = _mint(session, email="daniel@example.com", platform_role="admin")
    target, _ = _mint(session, email="b@example.com", tier="agency")

    r = client.post(
        f"/admin/support/agency/{target.id}/roster/invite",
        json={"email": "invitee@example.com", "role": "member"},
        headers=_support_headers(
            admin_token, "support.tenant.write", ticket="LC-TEST-2"
        ),
    )
    assert r.status_code == 428, r.text

    rows = session.query(AdminAuditLog).all()
    assert len(rows) == 1
    assert rows[0].support_ticket_id == "LC-TEST-2"
    assert rows[0].result == "error"


def test_write_with_valid_approver_succeeds_and_audits(client_and_session):
    """Master assertion admin_support_write_audited (allow branch, HTTP layer).

    A SUPPORT_TENANT_WRITE call with a live second-admin approver id
    succeeds, creates the invite row, and writes an audit row that
    records the approver_id."""
    client, session = client_and_session
    admin, admin_token = _mint(session, email="daniel@example.com", platform_role="admin")
    approver, _ = _mint(session, email="second@example.com", platform_role="admin")
    target, _ = _mint(session, email="b@example.com", tier="agency")

    r = client.post(
        f"/admin/support/agency/{target.id}/roster/invite",
        json={"email": "invitee@example.com", "role": "member"},
        headers=_support_headers(
            admin_token,
            "support.tenant.write",
            ticket="LC-TEST-3",
            approver_id=approver.id,
        ),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending"

    # Invite row landed.
    invites = session.query(AgencyInvite).filter_by(agency_id=target.id).all()
    assert len(invites) == 1

    # Audit row landed with approver_id populated.
    rows = session.query(AdminAuditLog).all()
    assert len(rows) == 1
    row = rows[0]
    assert row.support_approver_id == approver.id
    assert row.result == "ok"
    assert row.support_capability == "support.tenant.write"


def test_write_with_non_admin_approver_is_treated_as_missing(client_and_session):
    """A non-admin user id in x-support-approver-id doesn't satisfy the
    second-approver requirement — the gate returns
    DENY_NEEDS_SECOND_APPROVER and the route returns 428. Prevents an
    attacker from listing a random Clipper as the "approver"."""
    client, session = client_and_session
    admin, admin_token = _mint(session, email="daniel@example.com", platform_role="admin")
    non_admin, _ = _mint(session, email="notanadmin@example.com")
    target, _ = _mint(session, email="b@example.com", tier="agency")

    r = client.post(
        f"/admin/support/agency/{target.id}/roster/invite",
        json={"email": "invitee@example.com", "role": "member"},
        headers=_support_headers(
            admin_token,
            "support.tenant.write",
            ticket="LC-TEST-4",
            approver_id=non_admin.id,
        ),
    )
    assert r.status_code == 428
