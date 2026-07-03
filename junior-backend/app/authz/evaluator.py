"""Pure authorization evaluator.

Zero DB access. Zero ``datetime.now``. Zero side effects. Same inputs
produce the same output — trivially unit-testable via a table.

The five rules encoded here match the master doc's contract:

1. **Own-tenant path** — ``operating_mode == SELF`` AND the resource's
   tenant is in the caller's membership set AND the required
   capability is present.
2. **Demo path** — ``operating_mode == DEMO`` AND the resource's tenant
   equals the caller's own user id AND (required cap is present OR
   :attr:`Capability.DEMO_PLAN_OVERRIDE` is granted). Any cross-tenant
   resource in demo mode is denied unconditionally.
3. **Support path** — ``operating_mode == SUPPORT`` AND a matching
   :class:`SupportContext` is supplied AND the resource tenant equals
   both the support target and the context's declared target tenant
   AND the support capability is granted AND the support hasn't
   expired. Writes additionally require a second approver id.
4. **Cross-tenant in SELF mode** — always denied. This is the sever:
   there is no admin bypass on customer routes.
5. **Missing capability** — always denied with a specific
   ``required_capability`` field so the route can render a targeted
   message.
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.authz.capabilities import Action, Capability, OperatingMode
from app.authz.context import (
    AuthorizationContext,
    Decision,
    Resource,
    SupportContext,
)


def _now_utc() -> datetime:  # thin seam so tests can inject
    return datetime.now(timezone.utc)


def evaluate(
    ctx: AuthorizationContext,
    resource: Resource,
    action: Action,
    required_capability: Capability,
    support: SupportContext | None = None,
    *,
    now: datetime | None = None,
) -> Decision:
    """Return an authorization decision.

    Args:
        ctx: Resolved authorization context for the caller.
        resource: The target resource, tagged with the owning tenant.
        action: Verb (``read`` / ``write`` / ``delete``).
        required_capability: The specific capability this call needs.
            Route handlers declare this at their call site; the
            evaluator never guesses which cap a resource implies.
        support: Optional support-mode context. Required when
            ``ctx.operating_mode == OperatingMode.SUPPORT``.
        now: Injected clock. Defaults to :func:`datetime.now` in UTC.

    Returns:
        A :class:`Decision` carrying the outcome kind, a stable reason
        code, and the specific capability that was required (for
        client-side messaging and audit).
    """
    # 1. The declared capability must exist on the caller. This is the
    #    server-side floor — even in demo/support modes, the capability
    #    must be granted; the modes only decide WHICH tenant the cap
    #    applies to.
    cap_granted = required_capability in ctx.capabilities

    # 2. Support mode requires an explicit context object. A caller
    #    entering support mode without a SupportContext is either a
    #    misconfigured route or a bypass attempt — deny hard.
    if ctx.operating_mode is OperatingMode.SUPPORT and support is None:
        return Decision.deny(
            "support_context_required",
            required=required_capability,
        )

    # 3. Support mode: the resource must live on the declared target
    #    tenant, the support capability must match the ask, and the
    #    context must not be expired. Writes require a second approver.
    if ctx.operating_mode is OperatingMode.SUPPORT:
        assert support is not None  # narrowed by the branch above
        now_ts = now if now is not None else _now_utc()

        if not support.reason.strip():
            return Decision.deny("support_reason_empty", required=required_capability)
        if support.expiry_at <= now_ts:
            return Decision.deny("support_expired", required=required_capability)
        if support.target_tenant_id != resource.tenant_id:
            return Decision.deny("support_target_mismatch", required=required_capability)
        if ctx.target_tenant_id != support.target_tenant_id:
            return Decision.deny("support_context_target_mismatch", required=required_capability)
        if support.capability is not required_capability:
            return Decision.deny(
                "support_capability_mismatch",
                required=required_capability,
            )
        if not cap_granted:
            return Decision.deny("capability_missing", required=required_capability)
        # Support-write must carry a second approver id. The gate
        # wrapper is responsible for verifying that id is a valid
        # ADMIN with SUPPORT_TENANT_WRITE — the evaluator only
        # requires that the field is present so the audit row is
        # complete.
        if required_capability is Capability.SUPPORT_TENANT_WRITE and not support.second_approver_id:
            return Decision.deny_needs_second_approver()
        return Decision.allow("support_ok")

    # 4. Demo mode: cross-tenant is unconditionally denied. Demo grants
    #    plan_override capability on OWN data only.
    if ctx.operating_mode is OperatingMode.DEMO:
        if resource.tenant_id != ctx.actor_user_id:
            return Decision.deny("demo_cross_tenant", required=required_capability)
        # Plan override expands the effective cap set for own data;
        # non-plan capabilities (HQ_*, SUPPORT_*) still require the
        # underlying grant.
        is_plan_scope = required_capability.value.startswith(("plan.", "clipper.", "agency."))
        override_active = Capability.DEMO_PLAN_OVERRIDE in ctx.capabilities
        if is_plan_scope and override_active:
            return Decision.allow("demo_plan_override")
        if cap_granted:
            return Decision.allow("demo_ok")
        return Decision.deny("capability_missing", required=required_capability)

    # 5. Self mode (the common path).
    if ctx.operating_mode is OperatingMode.SELF:
        # Membership check: the caller must own or belong to the
        # tenant that owns the resource. No admin bypass.
        member = _find_membership(ctx, resource.tenant_id)
        if member is None:
            return Decision.deny("cross_tenant_denied", required=required_capability)
        if not cap_granted:
            return Decision.deny("capability_missing", required=required_capability)
        return Decision.allow("self_ok")

    # Defensive: unknown mode.
    return Decision.deny("unknown_operating_mode", required=required_capability)


def _find_membership(ctx: AuthorizationContext, tenant_id: str):
    for m in ctx.tenant_memberships:
        if m.tenant_id == tenant_id:
            return m
    return None
