"""Build a fresh :class:`AuthorizationContext` from the current DB row.

The projection is the seam between the persisted world (User, AgencyMember)
and the pure evaluator. Every mutation-level gate should call
:func:`build_authorization_context` on the caller's live User row so a
downgrade or role change takes effect on the very next request — the JWT
carries only identity + a schema version fingerprint; capabilities are
never trusted from the token itself.

Batch 2B ships the projection + additive /me + /sync fields. The
DB-loading gate wrapper (calls the projection, then the evaluator, then
writes audit) lands in batch 2C alongside the agency-route sever.
"""

from __future__ import annotations

from typing import Any, Iterable

from sqlalchemy.orm import Session

from app.authz.capabilities import (
    Capability,
    OperatingMode,
    PlatformRole,
)
from app.authz.context import (
    AuthorizationContext,
    TenantMembership,
)
from app.features import (
    CAPABILITY_SCHEMA_VERSION,
    _plan_capability_names_for_tier,
    _platform_capability_names_for_role,
    _resolve_tier,
    _tier_limits_for,
    is_agency_tier,
)


def _to_capability_enum(names: Iterable[str]) -> frozenset[Capability]:
    """Convert capability string values into the closed enum set.

    Unknown strings are dropped — this is the guardrail that stops a typo in
    ``features.py`` from silently granting a made-up capability. The
    evaluator only accepts enum members, so anything not in ``Capability``
    can never be checked and therefore can never authorise anything.
    """
    valid: dict[str, Capability] = {c.value: c for c in Capability}
    return frozenset(valid[n] for n in names if n in valid)


def _load_tenant_memberships(user_id: str, db: Session) -> tuple[TenantMembership, ...]:
    """Return the active tenant memberships for ``user_id``.

    Always includes ``TenantMembership(user_id, "owner")`` because a user's
    own tenant is themselves — even a plain Clipper "owns" their own data.
    An agency owner shows up as ``(agency_id, "owner")`` where
    ``agency_id == user_id`` (the implicit-agencies model documented in
    ``routes/agency.py``). Active ``AgencyMember`` rows contribute
    ``(agency_id, role)`` for each agency the user belongs to.
    """
    memberships: list[TenantMembership] = [
        TenantMembership(tenant_id=user_id, role="owner"),
    ]
    # Local import — AgencyMember is defined in models.py which imports many
    # sibling modules; top-of-file import would risk a circular reference.
    from app.models import AgencyMember

    rows = (
        db.query(AgencyMember)
        .filter(AgencyMember.user_id == user_id, AgencyMember.status == "active")
        .all()
    )
    for row in rows:
        role = row.role if row.role in {"member", "mod"} else "member"
        # Skip an agency membership that duplicates the user's own tenant —
        # ownership is already represented by the first entry.
        if row.agency_id == user_id:
            continue
        memberships.append(TenantMembership(tenant_id=row.agency_id, role=role))
    return tuple(memberships)


def _resolve_platform_role(user: Any) -> PlatformRole:
    """Read the persisted role, falling back to NONE.

    A short compat window: if ``platform_role`` is somehow missing or blank
    (fresh column, backfill pending), and the legacy email allowlist would
    have elevated the user, we return ADMIN. Once every prod row is
    backfilled + batch 2C removes the legacy path, this fallback is deleted.
    """
    role_str = getattr(user, "platform_role", None) or "none"
    try:
        return PlatformRole(role_str)
    except ValueError:
        # Unknown role string — fail closed to NONE.
        return PlatformRole.NONE


def _has_own_agency_tenant(user: Any) -> bool:
    """True when the user is themselves an agency owner (implicit-agency
    model) — in which case ``user.id`` is a tenant id worth carrying in the
    JWT's ``tenant_id_own`` claim so offline reads know the ID."""
    return bool(is_agency_tier(getattr(user, "tier", None)))


def build_authorization_context(
    user: Any,
    db: Session,
    *,
    operating_mode: OperatingMode = OperatingMode.SELF,
    target_tenant_id: str | None = None,
) -> AuthorizationContext:
    """Assemble a fresh :class:`AuthorizationContext` for ``user``.

    Called by request handlers on every mutation — never cached. Reads
    live from the passed-in :class:`Session` so downgrade/revocation take
    effect on the very next call, regardless of what a previously issued
    JWT still claims.

    Args:
        user: The already-loaded ``User`` row. The caller is responsible
            for loading it fresh (``db.get(User, sub)``) inside the same
            request scope — this helper does not re-query it, so the
            caller cannot accidentally act on a stale in-memory copy.
        db: An open Session for the auxiliary lookups (memberships).
        operating_mode: SELF for ordinary calls; DEMO/SUPPORT for admin
            routes that explicitly opt in. The evaluator enforces the
            per-mode invariants.
        target_tenant_id: The tenant being acted on in SUPPORT mode.
            Must be ``None`` outside SUPPORT.

    Returns:
        Frozen :class:`AuthorizationContext` — the evaluator's only input
        for authority questions.
    """
    tier = getattr(user, "tier", "free") or "free"
    founder = bool(getattr(user, "founder_flag", False))
    resolved_tier = _resolve_tier(tier)

    platform_role = _resolve_platform_role(user)

    plan_cap_names = _plan_capability_names_for_tier(tier, founder=founder)
    platform_cap_names = _platform_capability_names_for_role(platform_role.value)
    # DEMO mode grants the plan_override capability so an admin can exercise
    # every plan feature on OWN data; the evaluator refuses to apply it to
    # cross-tenant resources regardless.
    mode_cap_names: set[str] = set()
    if operating_mode is OperatingMode.DEMO and platform_role is PlatformRole.ADMIN:
        mode_cap_names.add("demo.plan_override")

    capabilities = _to_capability_enum(
        plan_cap_names | platform_cap_names | mode_cap_names
    )

    memberships = _load_tenant_memberships(user.id, db)
    limits = _tier_limits_for(tier)

    return AuthorizationContext(
        actor_user_id=str(user.id),
        raw_plan=str(tier),
        effective_plan=str(resolved_tier),
        founder_flag=founder,
        platform_role=platform_role,
        tenant_memberships=memberships,
        operating_mode=operating_mode,
        target_tenant_id=target_tenant_id,
        capabilities=capabilities,
        limits=limits,
        capability_schema_version=CAPABILITY_SCHEMA_VERSION,
    )
