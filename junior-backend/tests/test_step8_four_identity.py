"""Step 8 · four-identity authorization + journey proof.

Master-doc named assertions:

* ``identity_clipper``   — ordinary Clipper (tier=solo, platform_role=none)
                            gets clipper.use ONLY on own tenant.
* ``identity_agency_a``  — Agency owner A can manage A's tenant.
* ``identity_agency_b``  — Agency owner B can manage B's tenant · A and
                            B share NO permissions.
* ``identity_admin``     — Platform admin gets HQ + support caps on OWN
                            tenant · does NOT silently inherit B.
* ``cross_tenant_denied``— Every SELF-mode call from A to B (or B to A,
                            or admin to B via customer route) is denied.
* ``admin_modes_scoped`` — Admin SELF · DEMO · SUPPORT modes each
                            expose the expected surface; support mode
                            requires an explicit context AND records
                            an audit row.

Additionally, verifies the Step 7.5 agent substrate under the same
matrix: agent identity (dispatched actions) audits like a human
identity, and capability scope forbids cross-role tool invocation.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.agents_substrate import dispatch
from app.authz import (
    Action,
    Capability,
    DecisionKind,
    OperatingMode,
    Resource,
    SupportContext,
    gate,
)
from app.db import Base
from app.models import Agent, AgentAction, User


@pytest.fixture()
def session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with Session() as s:
        yield s


def _mkuser(session, *, tier: str, platform_role: str = "none", email: str | None = None):
    u = User(
        id=uuid.uuid4().hex,
        clerk_id=f"clerk_{uuid.uuid4().hex[:8]}",
        email=email or f"{uuid.uuid4().hex[:8]}@example.com",
        tier=tier,
        platform_role=platform_role,
    )
    session.add(u)
    session.commit()
    return u


def _mkagent(session, *, role: str = "user_replier"):
    row = Agent(
        id=uuid.uuid4().hex,
        agent_id=f"agent_{uuid.uuid4().hex[:8]}",
        name="Test Agent",
        provider="mock",
        role=role,
        credential_id="cred_test",
        enabled=True,
        daily_credit_cap_cents=1000,
        owner="daniel@liquidclips.app",
    )
    session.add(row)
    session.commit()
    return row


# ---------------------------------------------------------------------
# identity_clipper
# ---------------------------------------------------------------------


def test_identity_clipper_can_read_own_workspace(session):
    clipper = _mkuser(session, tier="solo")
    decision = gate(
        actor_user=clipper,
        db=session,
        resource=Resource(kind="clipper.workspace", tenant_id=clipper.id),
        action=Action.READ,
        required_capability=Capability.CLIPPER_USE,
    )
    assert decision.allowed


def test_identity_clipper_denied_hq_read(session):
    clipper = _mkuser(session, tier="solo")
    decision = gate(
        actor_user=clipper,
        db=session,
        resource=Resource(kind="hq.overview", tenant_id="platform"),
        action=Action.READ,
        required_capability=Capability.HQ_READ,
    )
    assert not decision.allowed


def test_identity_clipper_denied_agency_write(session):
    clipper = _mkuser(session, tier="solo")
    decision = gate(
        actor_user=clipper,
        db=session,
        resource=Resource(kind="agency.campaign", tenant_id=clipper.id),
        action=Action.WRITE,
        required_capability=Capability.AGENCY_CAMPAIGN_CREATE,
    )
    assert not decision.allowed


# ---------------------------------------------------------------------
# identity_agency_a + identity_agency_b + cross_tenant_denied
# ---------------------------------------------------------------------


def test_identity_agency_a_can_manage_a(session):
    owner_a = _mkuser(session, tier="agency")
    decision = gate(
        actor_user=owner_a,
        db=session,
        resource=Resource(kind="agency.roster", tenant_id=owner_a.id),
        action=Action.WRITE,
        required_capability=Capability.AGENCY_ROSTER_MANAGE,
    )
    assert decision.allowed


def test_identity_agency_b_can_manage_b(session):
    owner_b = _mkuser(session, tier="agency")
    decision = gate(
        actor_user=owner_b,
        db=session,
        resource=Resource(kind="agency.roster", tenant_id=owner_b.id),
        action=Action.WRITE,
        required_capability=Capability.AGENCY_ROSTER_MANAGE,
    )
    assert decision.allowed


def test_cross_tenant_a_to_b_denied_read(session):
    owner_a = _mkuser(session, tier="agency")
    owner_b = _mkuser(session, tier="agency")
    decision = gate(
        actor_user=owner_a,
        db=session,
        resource=Resource(kind="agency.roster", tenant_id=owner_b.id),
        action=Action.READ,
        required_capability=Capability.AGENCY_ROSTER_READ,
    )
    assert not decision.allowed
    assert decision.reason == "cross_tenant_denied"


def test_cross_tenant_b_to_a_denied_write(session):
    owner_a = _mkuser(session, tier="agency")
    owner_b = _mkuser(session, tier="agency")
    decision = gate(
        actor_user=owner_b,
        db=session,
        resource=Resource(kind="agency.roster", tenant_id=owner_a.id),
        action=Action.WRITE,
        required_capability=Capability.AGENCY_ROSTER_MANAGE,
    )
    assert not decision.allowed
    assert decision.reason == "cross_tenant_denied"


def test_cross_tenant_clipper_to_agency_a_denied(session):
    clipper = _mkuser(session, tier="solo")
    owner_a = _mkuser(session, tier="agency")
    decision = gate(
        actor_user=clipper,
        db=session,
        resource=Resource(kind="agency.roster", tenant_id=owner_a.id),
        action=Action.READ,
        required_capability=Capability.AGENCY_ROSTER_READ,
    )
    assert not decision.allowed


# ---------------------------------------------------------------------
# identity_admin
# ---------------------------------------------------------------------


def test_identity_admin_gets_hq_capabilities(session):
    admin = _mkuser(session, tier="solo", platform_role="admin")
    decision = gate(
        actor_user=admin,
        db=session,
        resource=Resource(kind="hq.overview", tenant_id=admin.id),
        action=Action.READ,
        required_capability=Capability.HQ_READ,
    )
    assert decision.allowed


def test_identity_admin_denied_cross_tenant_in_self_mode(session):
    """THE SEVER · admin platform_role does NOT grant cross-tenant read
    when running in the SELF customer path."""
    admin = _mkuser(session, tier="solo", platform_role="admin")
    owner_b = _mkuser(session, tier="agency")
    decision = gate(
        actor_user=admin,
        db=session,
        resource=Resource(kind="agency.roster", tenant_id=owner_b.id),
        action=Action.READ,
        required_capability=Capability.AGENCY_ROSTER_READ,
    )
    assert not decision.allowed
    assert decision.reason == "cross_tenant_denied"


# ---------------------------------------------------------------------
# admin_modes_scoped
# ---------------------------------------------------------------------


def test_admin_self_mode_own_tenant_ok(session):
    admin = _mkuser(session, tier="solo", platform_role="admin")
    decision = gate(
        actor_user=admin,
        db=session,
        resource=Resource(kind="agency.campaign", tenant_id=admin.id),
        action=Action.WRITE,
        required_capability=Capability.AGENCY_CAMPAIGN_CREATE,
        operating_mode=OperatingMode.SELF,
    )
    assert decision.allowed  # admin's own tenant, agency caps promoted


def test_admin_demo_mode_own_only(session):
    admin = _mkuser(session, tier="solo", platform_role="admin")
    owner_b = _mkuser(session, tier="agency")
    decision = gate(
        actor_user=admin,
        db=session,
        resource=Resource(kind="agency.campaign", tenant_id=owner_b.id),
        action=Action.WRITE,
        required_capability=Capability.AGENCY_CAMPAIGN_CREATE,
        operating_mode=OperatingMode.DEMO,
    )
    assert not decision.allowed
    assert decision.reason == "demo_cross_tenant"


def test_admin_support_mode_requires_context(session):
    admin = _mkuser(session, tier="solo", platform_role="admin")
    owner_b = _mkuser(session, tier="agency")
    decision = gate(
        actor_user=admin,
        db=session,
        resource=Resource(kind="agency.roster", tenant_id=owner_b.id),
        action=Action.READ,
        required_capability=Capability.SUPPORT_TENANT_READ,
        operating_mode=OperatingMode.SUPPORT,
        support=None,
    )
    assert not decision.allowed
    assert decision.reason == "support_context_required"


def test_admin_support_read_with_context_ok_and_audits(session):
    from app.models import AdminAuditLog

    admin = _mkuser(session, tier="solo", platform_role="admin", email="danieldiyepriye@gmail.com")
    owner_b = _mkuser(session, tier="agency")
    ctx = SupportContext(
        actor_user_id=admin.id,
        target_tenant_id=owner_b.id,
        reason="ticket LC-9 · investigation",
        expiry_at=datetime.now(timezone.utc) + timedelta(hours=1),
        capability=Capability.SUPPORT_TENANT_READ,
        ticket_id="LC-9",
    )
    decision = gate(
        actor_user=admin,
        db=session,
        resource=Resource(kind="agency.roster", tenant_id=owner_b.id),
        action=Action.READ,
        required_capability=Capability.SUPPORT_TENANT_READ,
        operating_mode=OperatingMode.SUPPORT,
        support=ctx,
    )
    assert decision.allowed
    # Audit trail lands
    rows = session.query(AdminAuditLog).all()
    assert len(rows) == 1
    assert rows[0].support_ticket_id == "LC-9"


def test_admin_support_write_requires_second_approver(session):
    admin = _mkuser(session, tier="solo", platform_role="admin", email="danieldiyepriye@gmail.com")
    owner_b = _mkuser(session, tier="agency")
    ctx = SupportContext(
        actor_user_id=admin.id,
        target_tenant_id=owner_b.id,
        reason="ticket LC-10",
        expiry_at=datetime.now(timezone.utc) + timedelta(hours=1),
        capability=Capability.SUPPORT_TENANT_WRITE,
        ticket_id="LC-10",
        second_approver_id=None,
    )
    decision = gate(
        actor_user=admin,
        db=session,
        resource=Resource(kind="agency.roster", tenant_id=owner_b.id),
        action=Action.WRITE,
        required_capability=Capability.SUPPORT_TENANT_WRITE,
        operating_mode=OperatingMode.SUPPORT,
        support=ctx,
    )
    assert decision.kind is DecisionKind.DENY_NEEDS_SECOND_APPROVER


# ---------------------------------------------------------------------
# Agent identity (Step 7.5) verified under the same matrix
# ---------------------------------------------------------------------


def test_identity_agent_action_audits_and_capability_scoped(session):
    """An agent dispatch behaves like a human identity in one respect:
    every action leaves an audit row, and its capability scope forbids
    tool invocation outside the role's bundle. That completes the
    four-identity + agent proof."""
    agent = _mkagent(session, role="user_replier")
    row = dispatch(
        session,
        agent_id=agent.agent_id,
        action_type="user_reply.answer_question",
        messages=[{"role": "user", "content": "help"}],
        tools=[],
    )
    assert row.success is True
    # And a capability-violating tool call is denied AND audited.
    row2 = dispatch(
        session,
        agent_id=agent.agent_id,
        action_type="user_reply.answer_question",
        messages=[{"role": "user", "content": "escalate"}],
        tools=["agent.pr.create"],  # not in user_replier's bundle
    )
    assert row2.success is False
    assert row2.stable_error_code == "agent.capability_denied"
    # Both rows land
    assert session.query(AgentAction).count() == 2


def test_identity_agent_kill_switch_stops_dispatch(session, monkeypatch):
    """The four-identity gate must include an agent identity that CAN
    be revoked in seconds. LC_AGENTS_ENABLED=false is the fleet-wide
    kill switch that satisfies that requirement."""
    monkeypatch.setenv("LC_AGENTS_ENABLED", "false")
    agent = _mkagent(session)
    row = dispatch(
        session,
        agent_id=agent.agent_id,
        action_type="user_reply.answer_question",
        messages=[{"role": "user", "content": "hi"}],
    )
    assert row.success is False
    assert row.stable_error_code == "agent.global_kill_switch"
