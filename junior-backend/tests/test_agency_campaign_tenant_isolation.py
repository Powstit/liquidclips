"""Owner isolation for the customer-facing agency campaign surface."""

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
from app.models import SponsoredCampaign, User
from app.routes import agency_campaigns


@pytest.fixture()
def tenant_app():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    session_local = sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )

    app = FastAPI()
    app.include_router(agency_campaigns.router)

    def override_get_db():
        session = session_local()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield client, session_local
    engine.dispose()


def _user(session, label: str) -> User:
    row = User(
        id=uuid.uuid4().hex,
        clerk_id=f"user_{label}_{uuid.uuid4().hex[:8]}",
        email=f"{label}@tenant.test",
        tier="agency",
        subscription_status="active",
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def _campaign(session, owner: User, slug: str) -> SponsoredCampaign:
    row = SponsoredCampaign(
        id=uuid.uuid4().hex,
        slug=slug,
        name=f"{slug} title",
        description=f"{slug} brief",
        campaign_type="clip",
        type="coming_soon",
        status="draft",
        whop_url="https://whop.com/test",
        created_by=owner.id,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def _auth(user: User, *, ttl_days: int | None = None) -> dict[str, str]:
    token, _ = issue_license_jwt(
        user_id=user.id,
        tier=user.tier,
        ttl_days=ttl_days,
    )
    return {"authorization": f"Bearer {token}"}


def test_agencies_only_list_their_own_campaigns(tenant_app):
    client, session_local = tenant_app
    with session_local() as session:
        agency_a = _user(session, "agency-a")
        agency_b = _user(session, "agency-b")
        _campaign(session, agency_a, "a-campaign")
        _campaign(session, agency_b, "b-campaign")

    a_response = client.get("/agency/campaigns", headers=_auth(agency_a))
    b_response = client.get("/agency/campaigns", headers=_auth(agency_b))

    assert a_response.status_code == 200
    assert [row["slug"] for row in a_response.json()] == ["a-campaign"]
    assert b_response.status_code == 200
    assert [row["slug"] for row in b_response.json()] == ["b-campaign"]


def test_cross_tenant_get_and_patch_are_non_disclosing(tenant_app):
    client, session_local = tenant_app
    with session_local() as session:
        agency_a = _user(session, "agency-a")
        agency_b = _user(session, "agency-b")
        _campaign(session, agency_b, "b-private")

    get_response = client.get(
        "/agency/campaigns/b-private",
        headers=_auth(agency_a),
    )
    patch_response = client.patch(
        "/agency/campaigns/b-private",
        headers=_auth(agency_a),
        json={"title": "stolen"},
    )

    assert get_response.status_code == 404
    assert get_response.json() == {"detail": "campaign not found"}
    assert patch_response.status_code == 404
    with session_local() as session:
        row = session.query(SponsoredCampaign).filter_by(slug="b-private").one()
        assert row.name == "b-private title"


def test_cross_tenant_archive_is_rejected_and_owner_archive_succeeds(tenant_app):
    client, session_local = tenant_app
    with session_local() as session:
        agency_a = _user(session, "agency-a")
        agency_b = _user(session, "agency-b")
        _campaign(session, agency_a, "a-owned")
        _campaign(session, agency_b, "b-owned")

    denied = client.post(
        "/agency/campaigns/b-owned/archive",
        headers=_auth(agency_a),
    )
    assert denied.status_code == 404
    with session_local() as session:
        assert session.query(SponsoredCampaign).filter_by(slug="b-owned").one_or_none()

    allowed = client.post(
        "/agency/campaigns/a-owned/archive",
        headers=_auth(agency_a),
    )
    assert allowed.status_code == 200
    assert allowed.json() == {"slug": "a-owned", "archived": True}
    with session_local() as session:
        assert session.query(SponsoredCampaign).filter_by(slug="a-owned").one_or_none() is None
        assert session.query(SponsoredCampaign).filter_by(slug="b-owned").one_or_none()


def test_cross_tenant_status_is_rejected_and_owner_status_succeeds(tenant_app):
    client, session_local = tenant_app
    with session_local() as session:
        agency_a = _user(session, "agency-a")
        agency_b = _user(session, "agency-b")
        _campaign(session, agency_a, "a-owned")
        _campaign(session, agency_b, "b-owned")

    denied = client.post(
        "/agency/campaigns/b-owned/status",
        headers=_auth(agency_a),
        json={"status": "closed"},
    )
    assert denied.status_code == 404
    with session_local() as session:
        assert session.query(SponsoredCampaign).filter_by(slug="b-owned").one().status == "draft"

    suspended = client.post(
        "/agency/campaigns/a-owned/status",
        headers=_auth(agency_a),
        json={"status": "coming_soon"},
    )
    assert suspended.status_code == 200
    assert suspended.json()["status"] == "coming_soon"

    # Unconditional — works even from a non-draft status, unlike patch.
    closed = client.post(
        "/agency/campaigns/a-owned/status",
        headers=_auth(agency_a),
        json={"status": "closed"},
    )
    assert closed.status_code == 200
    assert closed.json()["status"] == "closed"
    with session_local() as session:
        assert session.query(SponsoredCampaign).filter_by(slug="a-owned").one().status == "closed"


def test_status_rejects_invalid_value(tenant_app):
    client, session_local = tenant_app
    with session_local() as session:
        agency_a = _user(session, "agency-a")
        _campaign(session, agency_a, "a-owned")

    response = client.post(
        "/agency/campaigns/a-owned/status",
        headers=_auth(agency_a),
        json={"status": "live"},  # not allowed here — must go through /publish
    )
    assert response.status_code == 422


def test_admin_support_view_remains_explicit(tenant_app, monkeypatch):
    client, session_local = tenant_app
    with session_local() as session:
        agency_a = _user(session, "agency-a")
        agency_b = _user(session, "agency-b")
        admin = _user(session, "admin")
        _campaign(session, agency_a, "a-campaign")
        _campaign(session, agency_b, "b-campaign")

    monkeypatch.setattr(
        agency_campaigns,
        "is_admin_email",
        lambda email: email == admin.email,
    )
    response = client.get("/agency/campaigns", headers=_auth(admin))
    assert response.status_code == 200
    assert {row["slug"] for row in response.json()} == {
        "a-campaign",
        "b-campaign",
    }


def test_campaign_surface_rejects_missing_invalid_and_expired_bearer(tenant_app):
    client, session_local = tenant_app
    with session_local() as session:
        agency = _user(session, "agency")

    missing = client.get("/agency/campaigns")
    invalid = client.get(
        "/agency/campaigns",
        headers={"authorization": "Bearer definitely-not-a-jwt"},
    )
    expired = client.get(
        "/agency/campaigns",
        headers=_auth(agency, ttl_days=-1),
    )

    assert missing.status_code == 401
    assert invalid.status_code == 401
    assert expired.status_code == 401
