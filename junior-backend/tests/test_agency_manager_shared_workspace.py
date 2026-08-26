"""Shared-workspace access for Agency 'manager' roster members.

Proves the exact scenario the feature exists for: owner creates a
campaign, invites a second paying user as a manager, that user accepts
under their own account, and can then see + act on the owner's
campaign — while an unrelated agency stays isolated, a clipper-role
member gets no campaign access at all, and a manager whose own tier
lapses loses access even though their roster row is untouched.
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
from app.models import AgencyInvite, SponsoredCampaign, User, utcnow
from app.routes import agency, agency_campaigns


@pytest.fixture()
def workspace_app():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    session_local = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, expire_on_commit=False,
    )

    app = FastAPI()
    app.include_router(agency.router)
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


def _user(session, label: str, tier: str = "agency") -> User:
    row = User(
        id=uuid.uuid4().hex,
        clerk_id=f"user_{label}_{uuid.uuid4().hex[:8]}",
        email=f"{label}@lc-workspace-fixture.com",
        tier=tier,
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


def _auth(user: User) -> dict[str, str]:
    token, _ = issue_license_jwt(user_id=user.id, tier=user.tier)
    return {"authorization": f"Bearer {token}"}


def _invite_and_accept(client, session_local, owner: User, invitee: User, role: str) -> None:
    """Real flow: owner issues invite via the API, invitee accepts via
    the API — not a hand-inserted AgencyMember row. Proves the actual
    endpoints, not just the DB shape."""
    invite_resp = client.post(
        f"/agency/{owner.id}/roster/invite",
        headers=_auth(owner),
        json={"email": invitee.email, "role": role},
    )
    assert invite_resp.status_code == 201, invite_resp.text
    with session_local() as session:
        invite = session.query(AgencyInvite).filter_by(agency_id=owner.id).one()
        token = invite.token
    accept_resp = client.post(f"/agency/invites/{token}/accept", headers=_auth(invitee))
    assert accept_resp.status_code == 200, accept_resp.text


def test_manager_sees_and_edits_owners_campaign(workspace_app):
    client, session_local = workspace_app
    with session_local() as session:
        owner = _user(session, "owner")
        manager = _user(session, "manager")
        _campaign(session, owner, "owner-campaign")

    _invite_and_accept(client, session_local, owner, manager, role="manager")

    list_resp = client.get("/agency/campaigns", headers=_auth(manager))
    assert list_resp.status_code == 200
    assert [row["slug"] for row in list_resp.json()] == ["owner-campaign"]

    get_resp = client.get("/agency/campaigns/owner-campaign", headers=_auth(manager))
    assert get_resp.status_code == 200

    patch_resp = client.patch(
        "/agency/campaigns/owner-campaign",
        headers=_auth(manager),
        json={"description": "updated by manager"},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["description"] == "updated by manager"

    # The owner sees the manager's edit too — shared state, not a copy.
    owner_get = client.get("/agency/campaigns/owner-campaign", headers=_auth(owner))
    assert owner_get.json()["description"] == "updated by manager"


def test_unrelated_agency_still_isolated_from_manager_access(workspace_app):
    client, session_local = workspace_app
    with session_local() as session:
        owner = _user(session, "owner")
        manager = _user(session, "manager")
        stranger = _user(session, "stranger")
        _campaign(session, owner, "owner-campaign")

    _invite_and_accept(client, session_local, owner, manager, role="manager")

    # Stranger was never invited anywhere — must not see the campaign.
    resp = client.get("/agency/campaigns/owner-campaign", headers=_auth(stranger))
    assert resp.status_code == 404
    assert resp.json() == {"detail": "campaign not found"}

    list_resp = client.get("/agency/campaigns", headers=_auth(stranger))
    assert list_resp.json() == []


def test_clipper_role_member_gets_no_campaign_access(workspace_app):
    """member/mod are payout-split clipper roles — must NOT inherit
    campaign-management access just by being on the roster."""
    client, session_local = workspace_app
    with session_local() as session:
        owner = _user(session, "owner")
        clipper = _user(session, "clipper")
        _campaign(session, owner, "owner-campaign")

    _invite_and_accept(client, session_local, owner, clipper, role="member")

    resp = client.get("/agency/campaigns/owner-campaign", headers=_auth(clipper))
    assert resp.status_code == 404

    list_resp = client.get("/agency/campaigns", headers=_auth(clipper))
    assert list_resp.json() == []


def test_manager_without_own_agency_tier_still_gated_by_own_subscription(workspace_app):
    """Roster membership grants no tier. A manager whose own account
    isn't Agency-tier gets 403'd at _require_agency before ownership
    is ever considered — proves each seat pays for itself."""
    client, session_local = workspace_app
    with session_local() as session:
        owner = _user(session, "owner")
        # Invitee is on 'pro', not an agency-family tier.
        downgraded_manager = _user(session, "downgraded", tier="pro")
        _campaign(session, owner, "owner-campaign")

    _invite_and_accept(client, session_local, owner, downgraded_manager, role="manager")

    resp = client.get("/agency/campaigns", headers=_auth(downgraded_manager))
    assert resp.status_code == 403
    assert "Agency-tier subscription required" in resp.json()["detail"]
