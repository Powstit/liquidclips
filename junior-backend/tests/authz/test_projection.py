"""``build_authorization_context`` — projection from live User rows.

Uses an in-memory SQLite session so the tests exercise the real
SQLAlchemy schema (guaranteeing every new column declared in
``models.py`` for Batch 2B is picked up by ``create_all``). Kept
self-contained: fixtures create the users + AgencyMember rows they need,
so tests do not depend on other test files' side effects.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.authz import (
    Capability,
    OperatingMode,
    PlatformRole,
    build_authorization_context,
)
from app.db import Base
from app.models import AgencyMember, User


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


def _make_user(session, *, tier: str, platform_role: str = "none", founder: bool = False):
    u = User(
        id=uuid.uuid4().hex,
        clerk_id=f"clerk_{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.com",
        tier=tier,
        founder_flag=founder,
        platform_role=platform_role,
    )
    session.add(u)
    session.commit()
    return u


def test_projection_clipper_self_mode(session):
    user = _make_user(session, tier="solo")
    ctx = build_authorization_context(user, session)

    assert ctx.actor_user_id == user.id
    assert ctx.raw_plan == "solo"
    assert ctx.effective_plan == "solo"
    assert ctx.platform_role is PlatformRole.NONE
    assert ctx.operating_mode is OperatingMode.SELF
    assert ctx.target_tenant_id is None

    # Clipper has clipper.use only; no agency caps, no platform caps.
    assert Capability.CLIPPER_USE in ctx.capabilities
    for banned in {
        Capability.AGENCY_CAMPAIGN_CREATE,
        Capability.HQ_READ,
        Capability.SUPPORT_TENANT_READ,
    }:
        assert banned not in ctx.capabilities

    # Own tenant membership is always the caller.
    assert any(m.tenant_id == user.id and m.role == "owner" for m in ctx.tenant_memberships)


def test_projection_agency_owner_gets_full_agency_bundle(session):
    user = _make_user(session, tier="agency")
    ctx = build_authorization_context(user, session)

    assert ctx.effective_plan == "agency"
    for granted in {
        Capability.CLIPPER_USE,
        Capability.AGENCY_WORKSPACE_READ,
        Capability.AGENCY_CAMPAIGN_CREATE,
        Capability.AGENCY_CAMPAIGN_PUBLISH,
        Capability.AGENCY_ROSTER_MANAGE,
        Capability.AGENCY_RULES_MANAGE,
        Capability.AGENCY_PAYOUTS_MANAGE,
    }:
        assert granted in ctx.capabilities
    # Still no platform caps unless they are staff/admin.
    assert Capability.HQ_READ not in ctx.capabilities


def test_projection_platform_admin_gets_hq_support_and_own_plan(session):
    """Step 2 batch 2c contract per SELF_ONBOARDING_RELEASE_MASTER.md:
    'Admin self/demo mode gets full product entitlement against the
    admin's own records only.' Platform admin's OWN tenant capabilities
    include the full agency-whitelabel bundle so they can exercise every
    product feature on their own data without opting into DEMO mode."""
    admin = _make_user(session, tier="solo", platform_role="admin")
    ctx = build_authorization_context(admin, session)

    assert ctx.platform_role is PlatformRole.ADMIN
    for granted in {
        Capability.HQ_READ,
        Capability.HQ_MUTATE,
        Capability.SUPPORT_TENANT_READ,
        Capability.SUPPORT_TENANT_WRITE,
        # Plan caps promoted so admin's OWN tenant works after deps.py
        # in-memory tier elevation is removed in a later batch. Cross-
        # tenant is still denied by the evaluator's membership check.
        Capability.AGENCY_CAMPAIGN_CREATE,
        Capability.AGENCY_ROSTER_MANAGE,
        Capability.AGENCY_PAYOUTS_MANAGE,
    }:
        assert granted in ctx.capabilities


def test_projection_admin_in_demo_mode_gets_plan_override(session):
    admin = _make_user(session, tier="solo", platform_role="admin")
    ctx = build_authorization_context(
        admin, session, operating_mode=OperatingMode.DEMO
    )

    assert ctx.operating_mode is OperatingMode.DEMO
    assert Capability.DEMO_PLAN_OVERRIDE in ctx.capabilities
    # Underlying platform caps still present.
    assert Capability.HQ_READ in ctx.capabilities


def test_projection_non_admin_in_demo_mode_does_NOT_get_override(session):
    """Only admins can hold DEMO_PLAN_OVERRIDE — an ordinary user asking
    for DEMO mode gets the mode label but not the override capability.
    This guards against a request-layer bug that sets demo mode on a
    non-admin request accidentally granting them extra capabilities."""
    user = _make_user(session, tier="solo", platform_role="none")
    ctx = build_authorization_context(
        user, session, operating_mode=OperatingMode.DEMO
    )
    assert Capability.DEMO_PLAN_OVERRIDE not in ctx.capabilities


def test_projection_founder_promotes_effective_plan_bundle(session):
    user = _make_user(session, tier="solo", founder=True)
    ctx = build_authorization_context(user, session)
    # Founder gets the agency_whitelabel bundle regardless of raw tier
    # (mirrors tier_features behaviour). Raw plan preserved.
    assert ctx.raw_plan == "solo"
    for granted in {
        Capability.AGENCY_WORKSPACE_READ,
        Capability.AGENCY_CAMPAIGN_CREATE,
        Capability.AGENCY_PAYOUTS_MANAGE,
    }:
        assert granted in ctx.capabilities


def test_projection_agency_membership_shows_up_in_tenant_contexts(session):
    owner = _make_user(session, tier="agency")
    member = _make_user(session, tier="solo")
    session.add(
        AgencyMember(
            agency_id=owner.id,
            user_id=member.id,
            role="member",
            status="active",
        )
    )
    session.commit()

    ctx = build_authorization_context(member, session)
    tenants = {m.tenant_id: m.role for m in ctx.tenant_memberships}
    assert tenants[member.id] == "owner"
    assert tenants[owner.id] == "member"


def test_projection_disabled_membership_is_ignored(session):
    """A disabled AgencyMember row must not appear in tenant_contexts —
    otherwise a revoked member could still read the agency's data."""
    owner = _make_user(session, tier="agency")
    member = _make_user(session, tier="solo")
    session.add(
        AgencyMember(
            agency_id=owner.id,
            user_id=member.id,
            role="member",
            status="disabled",
        )
    )
    session.commit()

    ctx = build_authorization_context(member, session)
    tenants = {m.tenant_id for m in ctx.tenant_memberships}
    assert owner.id not in tenants  # only own tenant remains


def test_projection_recomputes_on_downgrade(session):
    """The projection reads live from the DB — a tier column update takes
    effect on the very next call, regardless of any previously issued
    JWT that still claims the old tier."""
    user = _make_user(session, tier="agency")
    before = build_authorization_context(user, session)
    assert Capability.AGENCY_CAMPAIGN_CREATE in before.capabilities

    user.tier = "solo"
    session.commit()

    after = build_authorization_context(user, session)
    assert Capability.AGENCY_CAMPAIGN_CREATE not in after.capabilities
    assert Capability.CLIPPER_USE in after.capabilities


def test_projection_recomputes_on_role_change(session):
    user = _make_user(session, tier="solo", platform_role="admin")
    before = build_authorization_context(user, session)
    assert before.platform_role is PlatformRole.ADMIN

    user.platform_role = "none"
    session.commit()

    after = build_authorization_context(user, session)
    assert after.platform_role is PlatformRole.NONE
    assert Capability.HQ_READ not in after.capabilities
    assert Capability.SUPPORT_TENANT_WRITE not in after.capabilities


def test_projection_carries_schema_version_from_features_module(session):
    from app.features import CAPABILITY_SCHEMA_VERSION
    user = _make_user(session, tier="solo")
    ctx = build_authorization_context(user, session)
    assert ctx.capability_schema_version == CAPABILITY_SCHEMA_VERSION
    assert isinstance(ctx.capability_schema_version, int)
    assert ctx.capability_schema_version >= 1
