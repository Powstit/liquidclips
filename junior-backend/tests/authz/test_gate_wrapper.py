"""Batch 2C · DB-loading gate wrapper.

Covers the full-stack half of the named master assertions that Batch 2A
could only prove at the pure-evaluator seam:

* ``stale_jwt_rechecked`` — gate raises :class:`StaleCapabilities` when
  the caller's JWT-stamped schema version is older than the current one.
* ``admin_support_write_audited`` — a support-mode call writes an
  AdminAuditLog row regardless of the outcome (ALLOW or DENY), with the
  reason + ticket + capability + expiry recorded.
* ``admin_support_requires_context`` — SUPPORT mode without a
  :class:`SupportContext` is denied.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.authz import (
    Action,
    Capability,
    DecisionKind,
    OperatingMode,
    Resource,
    StaleCapabilities,
    SupportContext,
    gate,
)
from app.db import Base
from app.features import CAPABILITY_SCHEMA_VERSION
from app.models import AdminAuditLog, User


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
    user = User(
        id=uuid.uuid4().hex,
        clerk_id=f"clerk_{uuid.uuid4().hex[:8]}",
        email=email or f"{uuid.uuid4().hex[:8]}@example.com",
        tier=tier,
        platform_role=platform_role,
    )
    session.add(user)
    session.commit()
    return user


def test_gate_self_mode_allows_own_tenant(session):
    owner = _mkuser(session, tier="agency")
    resource = Resource(kind="agency.roster", tenant_id=owner.id)
    decision = gate(
        actor_user=owner,
        db=session,
        resource=resource,
        action=Action.READ,
        required_capability=Capability.AGENCY_ROSTER_READ,
    )
    assert decision.allowed


def test_gate_self_mode_denies_cross_tenant(session):
    a = _mkuser(session, tier="agency")
    b = _mkuser(session, tier="agency")
    resource_on_b = Resource(kind="agency.roster", tenant_id=b.id)
    decision = gate(
        actor_user=a,
        db=session,
        resource=resource_on_b,
        action=Action.READ,
        required_capability=Capability.AGENCY_ROSTER_READ,
    )
    assert not decision.allowed
    assert decision.reason == "cross_tenant_denied"


def test_gate_stale_jwt_raises(session):
    """Master assertion stale_jwt_rechecked (full stack).

    A JWT stamped with an older ``capability_schema_version`` triggers
    the 409 path — the gate wrapper raises so the route handler can
    return 409 stale_capabilities and force /sync refresh."""
    user = _mkuser(session, tier="solo")
    with pytest.raises(StaleCapabilities) as exc_info:
        gate(
            actor_user=user,
            db=session,
            resource=Resource(kind="clipper.workspace", tenant_id=user.id),
            action=Action.READ,
            required_capability=Capability.CLIPPER_USE,
            jwt_capability_schema_version=CAPABILITY_SCHEMA_VERSION - 1,
        )
    assert exc_info.value.jwt_version == CAPABILITY_SCHEMA_VERSION - 1
    assert exc_info.value.current_version == CAPABILITY_SCHEMA_VERSION


def test_gate_current_schema_version_is_accepted(session):
    user = _mkuser(session, tier="solo")
    # Current version — no exception.
    decision = gate(
        actor_user=user,
        db=session,
        resource=Resource(kind="clipper.workspace", tenant_id=user.id),
        action=Action.READ,
        required_capability=Capability.CLIPPER_USE,
        jwt_capability_schema_version=CAPABILITY_SCHEMA_VERSION,
    )
    assert decision.allowed


def test_gate_support_mode_without_context_denies(session):
    """Master assertion admin_support_requires_context (full stack)."""
    admin = _mkuser(session, tier="solo", platform_role="admin", email="daniel@example.com")
    target = _mkuser(session, tier="agency")

    decision = gate(
        actor_user=admin,
        db=session,
        resource=Resource(kind="agency.roster", tenant_id=target.id),
        action=Action.READ,
        required_capability=Capability.SUPPORT_TENANT_READ,
        operating_mode=OperatingMode.SUPPORT,
        support=None,
    )
    assert not decision.allowed
    assert decision.reason == "support_context_required"


def test_gate_support_read_writes_audit_row(session):
    """Master assertion admin_support_write_audited (allow branch,
    read variant). Every support-mode call — allowed or denied — must
    leave an AdminAuditLog row so cross-tenant access is auditable."""
    admin = _mkuser(session, tier="solo", platform_role="admin", email="daniel@example.com")
    target = _mkuser(session, tier="agency")

    ctx = SupportContext(
        actor_user_id=admin.id,
        target_tenant_id=target.id,
        reason="ticket LC-9001 — payout dispute",
        expiry_at=datetime.now(timezone.utc) + timedelta(hours=1),
        capability=Capability.SUPPORT_TENANT_READ,
        ticket_id="LC-9001",
    )
    decision = gate(
        actor_user=admin,
        db=session,
        resource=Resource(kind="agency.roster", tenant_id=target.id),
        action=Action.READ,
        required_capability=Capability.SUPPORT_TENANT_READ,
        operating_mode=OperatingMode.SUPPORT,
        support=ctx,
    )
    assert decision.allowed
    rows = session.query(AdminAuditLog).all()
    assert len(rows) == 1
    row = rows[0]
    assert row.support_ticket_id == "LC-9001"
    assert row.support_reason.startswith("ticket LC-9001")
    assert row.support_capability == "support.tenant.read"
    assert row.target_id == target.id
    assert row.result == "ok"


def test_gate_support_write_without_approver_denies_and_still_audits(session):
    """Master assertion admin_support_write_audited (denial branch).

    A SUPPORT_TENANT_WRITE call without ``second_approver_id`` returns
    :attr:`DecisionKind.DENY_NEEDS_SECOND_APPROVER` — AND still writes
    the audit row so the attempt is traceable."""
    admin = _mkuser(session, tier="solo", platform_role="admin", email="daniel@example.com")
    target = _mkuser(session, tier="agency")

    ctx = SupportContext(
        actor_user_id=admin.id,
        target_tenant_id=target.id,
        reason="ticket LC-9002 — invite fix",
        expiry_at=datetime.now(timezone.utc) + timedelta(hours=1),
        capability=Capability.SUPPORT_TENANT_WRITE,
        ticket_id="LC-9002",
        second_approver_id=None,
    )
    decision = gate(
        actor_user=admin,
        db=session,
        resource=Resource(kind="agency.roster", tenant_id=target.id),
        action=Action.WRITE,
        required_capability=Capability.SUPPORT_TENANT_WRITE,
        operating_mode=OperatingMode.SUPPORT,
        support=ctx,
    )
    assert decision.kind is DecisionKind.DENY_NEEDS_SECOND_APPROVER
    rows = session.query(AdminAuditLog).all()
    assert len(rows) == 1
    assert rows[0].result == "error"
    assert rows[0].support_ticket_id == "LC-9002"


def test_gate_support_write_with_approver_allows_and_audits(session):
    admin = _mkuser(session, tier="solo", platform_role="admin", email="daniel@example.com")
    approver = _mkuser(
        session, tier="solo", platform_role="admin", email="second@example.com"
    )
    target = _mkuser(session, tier="agency")

    ctx = SupportContext(
        actor_user_id=admin.id,
        target_tenant_id=target.id,
        reason="ticket LC-9003 — payout split correction",
        expiry_at=datetime.now(timezone.utc) + timedelta(hours=1),
        capability=Capability.SUPPORT_TENANT_WRITE,
        ticket_id="LC-9003",
        second_approver_id=approver.id,
    )
    decision = gate(
        actor_user=admin,
        db=session,
        resource=Resource(kind="agency.roster", tenant_id=target.id),
        action=Action.WRITE,
        required_capability=Capability.SUPPORT_TENANT_WRITE,
        operating_mode=OperatingMode.SUPPORT,
        support=ctx,
    )
    assert decision.allowed
    rows = session.query(AdminAuditLog).all()
    assert len(rows) == 1
    assert rows[0].result == "ok"
    assert rows[0].support_approver_id == approver.id
