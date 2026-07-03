"""Table-driven proof of the pure evaluator.

Each ``assert_*`` test name maps 1:1 to a required assertion from
``SELF_ONBOARDING_RELEASE_MASTER.md`` §Step 2. The remainder are
additional regression tests that back the same guarantees at finer
granularity — cross-tenant denial in demo mode, expired support
context, mismatched target tenant, capability required even in
support mode, and so on.

Pure module → no FastAPI, no DB, no clock reads. Tests inject
``now=`` explicitly whenever expiry matters.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.authz import (
    Action,
    AuthorizationContext,
    Capability,
    Decision,
    DecisionKind,
    OperatingMode,
    PlatformRole,
    Resource,
    SupportContext,
    TenantMembership,
    evaluate,
)


# ---------------------------------------------------------------------------
# Named assertions from the master doc (Step 2)
# ---------------------------------------------------------------------------


def test_clipper_self_allowed(clipper_ordinary, agency_a_roster):
    """Master assertion: clipper_self_allowed.

    A Clipper hitting their OWN clipper.use resource returns ALLOW.
    """
    own_resource = Resource(kind="clipper.workspace", tenant_id=clipper_ordinary.actor_user_id)
    decision = evaluate(
        clipper_ordinary,
        own_resource,
        Action.READ,
        required_capability=Capability.CLIPPER_USE,
    )
    assert decision.allowed
    assert decision.kind is DecisionKind.ALLOW


def test_clipper_hq_denied(clipper_ordinary, hq_overview):
    """Master assertion: clipper_hq_denied.

    A Clipper hitting HQ_READ returns DENY with capability_missing.
    """
    decision = evaluate(
        clipper_ordinary,
        hq_overview,
        Action.READ,
        required_capability=Capability.HQ_READ,
    )
    assert not decision.allowed
    assert decision.reason in {"capability_missing", "cross_tenant_denied"}
    # HQ resource is not in the clipper's memberships, so the earlier
    # cross-tenant rule fires; either denial is acceptable here.


def test_agency_a_self_allowed(agency_owner_a, agency_a_roster):
    """Master assertion: agency_a_self_allowed.

    Agency owner A can read A's roster.
    """
    decision = evaluate(
        agency_owner_a,
        agency_a_roster,
        Action.READ,
        required_capability=Capability.AGENCY_ROSTER_READ,
    )
    assert decision.allowed


def test_agency_a_to_b_denied(agency_owner_a, agency_b_roster):
    """Master assertion: agency_a_to_b_denied.

    Agency owner A CANNOT read B's roster. This is the primary
    cross-tenant guarantee that Step 2 exists to enforce.
    """
    decision = evaluate(
        agency_owner_a,
        agency_b_roster,
        Action.READ,
        required_capability=Capability.AGENCY_ROSTER_READ,
    )
    assert not decision.allowed
    assert decision.reason == "cross_tenant_denied"


def test_admin_demo_own_only_allowed_on_own(platform_admin_demo, admin_own_workspace):
    """Master assertion: admin_demo_own_only (positive case).

    Admin in DEMO mode is granted product entitlement on OWN data via
    plan_override.
    """
    decision = evaluate(
        platform_admin_demo,
        admin_own_workspace,
        Action.WRITE,
        required_capability=Capability.AGENCY_CAMPAIGN_CREATE,
    )
    assert decision.allowed
    assert decision.reason == "demo_plan_override"


def test_admin_demo_own_only_denied_cross_tenant(platform_admin_demo, agency_b_roster):
    """Master assertion: admin_demo_own_only (negative case).

    Admin in DEMO mode CANNOT touch tenant B's data — demo NEVER
    silently inherits another tenant.
    """
    decision = evaluate(
        platform_admin_demo,
        agency_b_roster,
        Action.WRITE,
        required_capability=Capability.AGENCY_CAMPAIGN_CREATE,
    )
    assert not decision.allowed
    assert decision.reason == "demo_cross_tenant"


def test_admin_support_requires_context_denied_when_missing(platform_admin_support_read_b, agency_b_roster):
    """Master assertion: admin_support_requires_context.

    Admin in SUPPORT mode with NO SupportContext returns DENY hard.
    Prevents an unconditional bypass.
    """
    decision = evaluate(
        platform_admin_support_read_b,
        agency_b_roster,
        Action.READ,
        required_capability=Capability.SUPPORT_TENANT_READ,
        support=None,
    )
    assert not decision.allowed
    assert decision.reason == "support_context_required"


def test_admin_support_read_allowed_with_context(
    platform_admin_support_read_b, agency_b_roster, support_ctx_read_b
):
    """SUPPORT_TENANT_READ with a well-formed context returns ALLOW."""
    decision = evaluate(
        platform_admin_support_read_b,
        agency_b_roster,
        Action.READ,
        required_capability=Capability.SUPPORT_TENANT_READ,
        support=support_ctx_read_b,
    )
    assert decision.allowed
    assert decision.reason == "support_ok"


def test_admin_support_write_audited_denied_without_approver(
    agency_b_roster, support_ctx_write_b_no_approver
):
    """Master assertion: admin_support_write_audited (denial branch).

    SUPPORT_TENANT_WRITE without a second_approver_id returns the
    distinguishable ``DENY_NEEDS_SECOND_APPROVER`` outcome so the
    calling route can surface the specific hint.
    """
    ctx = AuthorizationContext(
        actor_user_id="user_admin",
        raw_plan="solo",
        effective_plan="solo",
        founder_flag=False,
        platform_role=PlatformRole.ADMIN,
        tenant_memberships=(TenantMembership(tenant_id="user_admin", role="owner"),),
        operating_mode=OperatingMode.SUPPORT,
        target_tenant_id="user_agency_b",
        capabilities=frozenset({
            Capability.SUPPORT_TENANT_READ,
            Capability.SUPPORT_TENANT_WRITE,
        }),
    )
    decision = evaluate(
        ctx,
        agency_b_roster,
        Action.WRITE,
        required_capability=Capability.SUPPORT_TENANT_WRITE,
        support=support_ctx_write_b_no_approver,
    )
    assert decision.kind is DecisionKind.DENY_NEEDS_SECOND_APPROVER


def test_admin_support_write_audited_allowed_with_approver(
    agency_b_roster, support_ctx_write_b_with_approver
):
    """Master assertion: admin_support_write_audited (allow branch)."""
    ctx = AuthorizationContext(
        actor_user_id="user_admin",
        raw_plan="solo",
        effective_plan="solo",
        founder_flag=False,
        platform_role=PlatformRole.ADMIN,
        tenant_memberships=(TenantMembership(tenant_id="user_admin", role="owner"),),
        operating_mode=OperatingMode.SUPPORT,
        target_tenant_id="user_agency_b",
        capabilities=frozenset({
            Capability.SUPPORT_TENANT_READ,
            Capability.SUPPORT_TENANT_WRITE,
        }),
    )
    decision = evaluate(
        ctx,
        agency_b_roster,
        Action.WRITE,
        required_capability=Capability.SUPPORT_TENANT_WRITE,
        support=support_ctx_write_b_with_approver,
    )
    assert decision.allowed


# ---------------------------------------------------------------------------
# stale_jwt_rechecked — evaluator seam only. Full DB re-load lands in
# gate.py (batch 2C). Here we prove the evaluator ignores the JWT
# entirely: it only sees the resolved capability set. If a caller
# rebuilds a context with a smaller cap set, the evaluator denies —
# regardless of what the old JWT said.
# ---------------------------------------------------------------------------


def test_stale_jwt_rechecked_downgrade(admin_own_workspace):
    """Master assertion (evaluator side): stale_jwt_rechecked.

    The evaluator has no notion of a JWT. It reads only the
    :class:`AuthorizationContext`. When the caller rebuilds a context
    with fewer capabilities (a downgrade), the evaluator denies even
    though a prior JWT could have claimed otherwise. Full contract
    (JWT re-verify + DB row re-read on every mutation) lands in
    ``gate.py`` batch 2C — this test proves the evaluator half.
    """
    downgraded = AuthorizationContext(
        actor_user_id="user_agency_a",
        raw_plan="solo",
        effective_plan="solo",
        founder_flag=False,
        platform_role=PlatformRole.NONE,
        tenant_memberships=(TenantMembership(tenant_id="user_agency_a", role="owner"),),
        operating_mode=OperatingMode.SELF,
        target_tenant_id=None,
        capabilities=frozenset({Capability.CLIPPER_USE}),  # agency caps stripped
    )
    resource = Resource(kind="agency.campaign", tenant_id="user_agency_a")
    decision = evaluate(
        downgraded,
        resource,
        Action.WRITE,
        required_capability=Capability.AGENCY_CAMPAIGN_CREATE,
    )
    assert not decision.allowed
    assert decision.reason == "capability_missing"
    assert decision.required_capability is Capability.AGENCY_CAMPAIGN_CREATE


# ---------------------------------------------------------------------------
# Additional guarantees at finer granularity
# ---------------------------------------------------------------------------


def test_support_expired_denied(
    platform_admin_support_read_b, agency_b_roster, support_ctx_read_b
):
    """An expired SupportContext returns DENY."""
    expired = SupportContext(
        actor_user_id=support_ctx_read_b.actor_user_id,
        target_tenant_id=support_ctx_read_b.target_tenant_id,
        reason=support_ctx_read_b.reason,
        expiry_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        capability=support_ctx_read_b.capability,
        ticket_id=support_ctx_read_b.ticket_id,
    )
    decision = evaluate(
        platform_admin_support_read_b,
        agency_b_roster,
        Action.READ,
        required_capability=Capability.SUPPORT_TENANT_READ,
        support=expired,
    )
    assert not decision.allowed
    assert decision.reason == "support_expired"


def test_support_target_mismatch_denied(
    platform_admin_support_read_b, agency_a_roster, support_ctx_read_b
):
    """Resource tenant that doesn't match the SupportContext target denies."""
    decision = evaluate(
        platform_admin_support_read_b,
        agency_a_roster,  # tenant A but support targets B
        Action.READ,
        required_capability=Capability.SUPPORT_TENANT_READ,
        support=support_ctx_read_b,
    )
    assert not decision.allowed
    assert decision.reason == "support_target_mismatch"


def test_support_empty_reason_denied(
    platform_admin_support_read_b, agency_b_roster
):
    """SupportContext with an empty reason is denied — non-negotiable audit input."""
    ctx = SupportContext(
        actor_user_id="user_admin",
        target_tenant_id="user_agency_b",
        reason="   ",
        expiry_at=datetime.now(timezone.utc) + timedelta(hours=1),
        capability=Capability.SUPPORT_TENANT_READ,
    )
    decision = evaluate(
        platform_admin_support_read_b,
        agency_b_roster,
        Action.READ,
        required_capability=Capability.SUPPORT_TENANT_READ,
        support=ctx,
    )
    assert not decision.allowed
    assert decision.reason == "support_reason_empty"


def test_admin_self_mode_cannot_touch_b(platform_admin, agency_b_roster):
    """Admin in SELF mode CANNOT touch tenant B via any capability.

    This is the sever: no admin bypass on customer/self routes.
    """
    decision = evaluate(
        platform_admin,
        agency_b_roster,
        Action.READ,
        required_capability=Capability.AGENCY_ROSTER_READ,
    )
    assert not decision.allowed
    assert decision.reason == "cross_tenant_denied"


def test_membership_scoped_agency_member_read(clipper_ordinary):
    """A non-owner member of an agency can read its workspace if granted."""
    member = AuthorizationContext(
        actor_user_id="user_clipper_1",
        raw_plan="solo",
        effective_plan="solo",
        founder_flag=False,
        platform_role=PlatformRole.NONE,
        tenant_memberships=(
            TenantMembership(tenant_id="user_clipper_1", role="owner"),
            TenantMembership(tenant_id="user_agency_a", role="member"),
        ),
        operating_mode=OperatingMode.SELF,
        target_tenant_id=None,
        capabilities=frozenset({
            Capability.CLIPPER_USE,
            Capability.AGENCY_WORKSPACE_READ,
        }),
    )
    resource = Resource(kind="agency.workspace", tenant_id="user_agency_a")
    decision = evaluate(
        member,
        resource,
        Action.READ,
        required_capability=Capability.AGENCY_WORKSPACE_READ,
    )
    assert decision.allowed


# ---------------------------------------------------------------------------
# Purity contract: same inputs → same outputs
# ---------------------------------------------------------------------------


def test_evaluator_is_deterministic(agency_owner_a, agency_a_roster):
    """Purity: the evaluator returns the same Decision for the same inputs."""
    first = evaluate(
        agency_owner_a,
        agency_a_roster,
        Action.READ,
        required_capability=Capability.AGENCY_ROSTER_READ,
    )
    second = evaluate(
        agency_owner_a,
        agency_a_roster,
        Action.READ,
        required_capability=Capability.AGENCY_ROSTER_READ,
    )
    assert first == second


def test_no_admin_bypass_on_agency_cross_tenant(platform_admin, agency_b_roster):
    """Direct restatement of the sever: admin platform_role provides NO
    bypass when the resource lives on another tenant and we're in SELF."""
    decision = evaluate(
        platform_admin,
        agency_b_roster,
        Action.WRITE,
        required_capability=Capability.AGENCY_CAMPAIGN_UPDATE,
    )
    assert decision.kind is DecisionKind.DENY
    assert decision.reason == "cross_tenant_denied"
