"""Shared fixtures for the four-identity authorization matrix.

These fixtures live in the ``authz`` test package because they are
consumed by every evaluator test. They intentionally do NOT touch the
database — batch 2A ships the pure evaluator only. The DB-loading
gate wrapper (``gate.py``) grows integration-level fixtures in a
later batch.

The four identities named in ``SELF_ONBOARDING_RELEASE_MASTER.md``
§Step 8 are pre-built here so every test case below reads the same
canonical shape:

* ``clipper_ordinary`` — tier ``solo``, no platform role.
* ``agency_owner_a`` — tier ``agency``, owns tenant ``A``.
* ``agency_owner_b`` — tier ``agency``, owns tenant ``B``.
* ``platform_admin`` — tier ``solo`` (personal account), platform role
  ``admin``, owns their own tenant only.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.authz import (
    AuthorizationContext,
    Capability,
    OperatingMode,
    PlatformRole,
    Resource,
    SupportContext,
    TenantMembership,
)


CLIPPER_CAPS: frozenset[Capability] = frozenset({Capability.CLIPPER_USE})

AGENCY_OWNER_CAPS: frozenset[Capability] = frozenset({
    Capability.CLIPPER_USE,
    Capability.AGENCY_WORKSPACE_READ,
    Capability.AGENCY_CAMPAIGN_CREATE,
    Capability.AGENCY_CAMPAIGN_UPDATE,
    Capability.AGENCY_CAMPAIGN_PUBLISH,
    Capability.AGENCY_CAMPAIGN_ARCHIVE,
    Capability.AGENCY_ROSTER_READ,
    Capability.AGENCY_ROSTER_MANAGE,
    Capability.AGENCY_RULES_MANAGE,
    Capability.AGENCY_PAYOUTS_READ,
    Capability.AGENCY_PAYOUTS_MANAGE,
})

ADMIN_CAPS: frozenset[Capability] = frozenset({
    Capability.CLIPPER_USE,
    Capability.HQ_READ,
    Capability.HQ_MUTATE,
    Capability.SUPPORT_TENANT_READ,
    Capability.SUPPORT_TENANT_WRITE,
})

ADMIN_DEMO_CAPS: frozenset[Capability] = ADMIN_CAPS | {Capability.DEMO_PLAN_OVERRIDE}


@pytest.fixture
def clipper_ordinary() -> AuthorizationContext:
    """Ordinary Clipper acting on their own tenant."""
    return AuthorizationContext(
        actor_user_id="user_clipper_1",
        raw_plan="solo",
        effective_plan="solo",
        founder_flag=False,
        platform_role=PlatformRole.NONE,
        tenant_memberships=(
            TenantMembership(tenant_id="user_clipper_1", role="owner"),
        ),
        operating_mode=OperatingMode.SELF,
        target_tenant_id=None,
        capabilities=CLIPPER_CAPS,
    )


@pytest.fixture
def agency_owner_a() -> AuthorizationContext:
    """Agency owner A. Tenant id equals user id (implicit agency model)."""
    return AuthorizationContext(
        actor_user_id="user_agency_a",
        raw_plan="agency",
        effective_plan="agency",
        founder_flag=False,
        platform_role=PlatformRole.NONE,
        tenant_memberships=(
            TenantMembership(tenant_id="user_agency_a", role="owner"),
        ),
        operating_mode=OperatingMode.SELF,
        target_tenant_id=None,
        capabilities=AGENCY_OWNER_CAPS,
    )


@pytest.fixture
def agency_owner_b() -> AuthorizationContext:
    """Agency owner B — a completely separate tenant from A."""
    return AuthorizationContext(
        actor_user_id="user_agency_b",
        raw_plan="agency",
        effective_plan="agency",
        founder_flag=False,
        platform_role=PlatformRole.NONE,
        tenant_memberships=(
            TenantMembership(tenant_id="user_agency_b", role="owner"),
        ),
        operating_mode=OperatingMode.SELF,
        target_tenant_id=None,
        capabilities=AGENCY_OWNER_CAPS,
    )


@pytest.fixture
def platform_admin() -> AuthorizationContext:
    """Platform admin acting on their OWN tenant (self mode)."""
    return AuthorizationContext(
        actor_user_id="user_admin",
        raw_plan="solo",
        effective_plan="solo",
        founder_flag=False,
        platform_role=PlatformRole.ADMIN,
        tenant_memberships=(
            TenantMembership(tenant_id="user_admin", role="owner"),
        ),
        operating_mode=OperatingMode.SELF,
        target_tenant_id=None,
        capabilities=ADMIN_CAPS,
    )


@pytest.fixture
def platform_admin_demo() -> AuthorizationContext:
    """Platform admin in DEMO mode — plan override on own data only."""
    return AuthorizationContext(
        actor_user_id="user_admin",
        raw_plan="solo",
        effective_plan="solo",
        founder_flag=False,
        platform_role=PlatformRole.ADMIN,
        tenant_memberships=(
            TenantMembership(tenant_id="user_admin", role="owner"),
        ),
        operating_mode=OperatingMode.DEMO,
        target_tenant_id=None,
        capabilities=ADMIN_DEMO_CAPS,
    )


@pytest.fixture
def platform_admin_support_read_b() -> AuthorizationContext:
    """Platform admin in SUPPORT mode targeting tenant B (read)."""
    return AuthorizationContext(
        actor_user_id="user_admin",
        raw_plan="solo",
        effective_plan="solo",
        founder_flag=False,
        platform_role=PlatformRole.ADMIN,
        tenant_memberships=(
            TenantMembership(tenant_id="user_admin", role="owner"),
        ),
        operating_mode=OperatingMode.SUPPORT,
        target_tenant_id="user_agency_b",
        capabilities=ADMIN_CAPS,
    )


@pytest.fixture
def support_ctx_read_b() -> SupportContext:
    """Well-formed SUPPORT_TENANT_READ context targeting tenant B."""
    return SupportContext(
        actor_user_id="user_admin",
        target_tenant_id="user_agency_b",
        reason="ticket LC-1023 — clipper payout dispute",
        expiry_at=datetime.now(timezone.utc) + timedelta(hours=1),
        capability=Capability.SUPPORT_TENANT_READ,
        ticket_id="LC-1023",
    )


@pytest.fixture
def support_ctx_write_b_no_approver() -> SupportContext:
    """SUPPORT_TENANT_WRITE with no second approver — must be denied."""
    return SupportContext(
        actor_user_id="user_admin",
        target_tenant_id="user_agency_b",
        reason="ticket LC-1024 — payout split correction",
        expiry_at=datetime.now(timezone.utc) + timedelta(hours=1),
        capability=Capability.SUPPORT_TENANT_WRITE,
        ticket_id="LC-1024",
        second_approver_id=None,
    )


@pytest.fixture
def support_ctx_write_b_with_approver() -> SupportContext:
    """SUPPORT_TENANT_WRITE with a valid second approver id."""
    return SupportContext(
        actor_user_id="user_admin",
        target_tenant_id="user_agency_b",
        reason="ticket LC-1024 — payout split correction",
        expiry_at=datetime.now(timezone.utc) + timedelta(hours=1),
        capability=Capability.SUPPORT_TENANT_WRITE,
        ticket_id="LC-1024",
        second_approver_id="user_admin_2",
    )


@pytest.fixture
def agency_a_roster() -> Resource:
    """A resource owned by tenant A."""
    return Resource(kind="agency.roster", tenant_id="user_agency_a")


@pytest.fixture
def agency_b_roster() -> Resource:
    """A resource owned by tenant B."""
    return Resource(kind="agency.roster", tenant_id="user_agency_b")


@pytest.fixture
def admin_own_workspace() -> Resource:
    """A resource owned by the admin's own tenant."""
    return Resource(kind="agency.workspace", tenant_id="user_admin")


@pytest.fixture
def hq_overview() -> Resource:
    """A platform-owned resource (HQ dashboard)."""
    # HQ resources still carry a tenant_id (platform), but capability is
    # what actually decides access at the evaluator layer.
    return Resource(kind="hq.overview", tenant_id="platform")
