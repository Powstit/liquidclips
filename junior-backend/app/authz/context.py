"""Frozen dataclasses fed into and out of the pure evaluator.

The evaluator (:mod:`app.authz.evaluator`) is a pure function of these
types. No DB, no ``datetime.now``, no request object leaks in. A
DB-loading wrapper (``gate.py``, batch 2C) is responsible for
assembling an :class:`AuthorizationContext` from the current database
state on every mutation, so downgrade + revocation take effect on the
NEXT request rather than after a JWT rotation.

``SupportContext.expiry_at`` is enforced by the caller (gate wrapper)
rather than by the evaluator — the evaluator only checks that the
expiry has not already passed relative to a ``now`` passed in by the
caller. This preserves purity.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Literal, Mapping, Tuple

from app.authz.capabilities import (
    Action,
    Capability,
    OperatingMode,
    PlatformRole,
)


@dataclass(frozen=True)
class TenantMembership:
    """Caller's role inside one tenant.

    ``tenant_id`` for a Clipper is the caller's own ``user.id``. For an
    Agency owner it is the agency owner's ``user.id`` (agencies are
    implicit — see ``routes/agency.py`` current comments).
    """

    tenant_id: str
    role: Literal["owner", "member", "mod", "none"]


@dataclass(frozen=True)
class SupportContext:
    """Explicit cross-tenant support context.

    Every ``/admin/support/*`` endpoint constructs one of these from the
    request headers and hands it to the gate. The gate wrapper writes
    an ``AdminAuditLog`` row on every accepted call (batch 2B extends
    the model with support-specific columns).

    ``second_approver_id`` is required for ``SUPPORT_TENANT_WRITE``.
    The gate verifies the second approver has a valid ADMIN JWT + the
    write capability before considering it satisfied.
    """

    actor_user_id: str
    target_tenant_id: str
    reason: str                       # non-empty free text, audited
    expiry_at: datetime               # UTC, aware datetime; ≤ 4h from issue
    capability: Capability            # exact cap being exercised
    ticket_id: str | None = None
    second_approver_id: str | None = None


@dataclass(frozen=True)
class AuthorizationContext:
    """The resolved state fed into the evaluator.

    Built freshly on every mutation from the current DB row for the
    caller. NEVER cached across requests; NEVER trusted from a stale
    JWT (JWT is used only for signature auth + identity + version
    compare in the gate wrapper).
    """

    actor_user_id: str
    raw_plan: str                                # user.tier (pre-override)
    effective_plan: str                          # post founder/comp override
    founder_flag: bool
    platform_role: PlatformRole
    tenant_memberships: Tuple[TenantMembership, ...]
    operating_mode: OperatingMode
    target_tenant_id: str | None                 # only when mode == SUPPORT
    capabilities: frozenset[Capability]
    limits: Mapping[str, int] = field(default_factory=dict)
    capability_schema_version: int = 1


@dataclass(frozen=True)
class Resource:
    """The target of an authorization check.

    ``kind`` is a free-form namespaced string (e.g.
    ``"agency.roster"``, ``"hq.overview"``) used only for audit
    logging. The evaluator only reads ``tenant_id`` and the required
    capability declared by the caller.
    """

    kind: str
    tenant_id: str      # tenant that OWNS the resource (never null)


class DecisionKind(str, Enum):
    """Evaluator outcome — no third state.

    A ``DENY_NEEDS_SECOND_APPROVER`` is a specific denial that the
    calling route can distinguish from a plain denial so it can surface
    a "get a second approver" hint instead of a generic 403.
    """

    ALLOW = "allow"
    DENY = "deny"
    DENY_NEEDS_SECOND_APPROVER = "deny_needs_second_approver"


@dataclass(frozen=True)
class Decision:
    """Structured evaluator output.

    ``reason`` is a stable machine-friendly code for audit + telemetry;
    UI copy is chosen at the call site based on it.
    """

    kind: DecisionKind
    reason: str
    required_capability: Capability | None = None

    @property
    def allowed(self) -> bool:
        return self.kind is DecisionKind.ALLOW

    @classmethod
    def allow(cls, reason: str = "ok") -> "Decision":
        return cls(kind=DecisionKind.ALLOW, reason=reason)

    @classmethod
    def deny(cls, reason: str, required: Capability | None = None) -> "Decision":
        return cls(
            kind=DecisionKind.DENY,
            reason=reason,
            required_capability=required,
        )

    @classmethod
    def deny_needs_second_approver(cls, reason: str = "second_approver_required") -> "Decision":
        return cls(
            kind=DecisionKind.DENY_NEEDS_SECOND_APPROVER,
            reason=reason,
        )
