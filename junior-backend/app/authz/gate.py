"""DB-loading authorization wrapper.

Sits between a request handler and the pure evaluator. On every call it

1. Reloads the caller from the live database (so downgrade / role change
   / revocation take effect on the very next mutation, regardless of what
   a previously issued JWT still claims).
2. Compares the JWT's ``capability_schema_version`` against the current
   server version. A mismatch raises ``StaleCapabilities`` so the caller
   can 409 the client and force a ``/sync`` refresh.
3. Projects the caller into a fresh :class:`AuthorizationContext`.
4. Calls :func:`~app.authz.evaluator.evaluate`.
5. When a :class:`SupportContext` is present, writes an audit row to
   :class:`AdminAuditLog` regardless of the outcome (the audit exists to
   record that an admin ATTEMPTED cross-tenant access, not just successes).

Batch 2C ships the wrapper; batch 2D wires it into the new
``/admin/support/*`` routes and re-migrates HQ endpoints; batch 2E hits
account-app proxies. The wrapper is deliberately synchronous — the
existing project runs sync SQLAlchemy end-to-end.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.authz.capabilities import Action, Capability, OperatingMode
from app.authz.context import (
    AuthorizationContext,
    Decision,
    Resource,
    SupportContext,
)
from app.authz.evaluator import evaluate
from app.authz.projection import build_authorization_context
from app.features import CAPABILITY_SCHEMA_VERSION


class StaleCapabilities(Exception):
    """Raised when the caller's JWT was issued under an older capability
    schema. Callers convert to HTTP 409 with a body pointing at ``/sync``
    for a fresh JWT + capability set."""

    def __init__(self, jwt_version: int, current_version: int):
        super().__init__(
            f"stale capability schema: jwt={jwt_version} current={current_version}"
        )
        self.jwt_version = jwt_version
        self.current_version = current_version


def _write_support_audit(
    db: Session,
    *,
    actor_user: Any,
    support: SupportContext,
    decision: Decision,
    resource: Resource,
    action: Action,
) -> None:
    """Persist one AdminAuditLog row per support-mode call.

    Written regardless of ALLOW / DENY / DENY_NEEDS_SECOND_APPROVER so
    the log records every ATTEMPTED cross-tenant access. Payload is a
    small JSON blob mirroring the SupportContext shape (no secrets, no
    PII beyond ticket / tenant / actor). Failures here are swallowed —
    the caller has already made their access decision and audit is
    best-effort during this compat window; a durability upgrade lands
    once HQ ingestion is wired in a later step."""
    from app.models import AdminAuditLog

    try:
        payload = json.dumps(
            {
                "target_tenant_id": support.target_tenant_id,
                "capability": support.capability.value,
                "resource_kind": resource.kind,
                "action": action.value,
                "decision": decision.kind.value,
                "decision_reason": decision.reason,
            }
        )
        db.add(
            AdminAuditLog(
                actor_email=str(getattr(actor_user, "email", "") or ""),
                action=f"support.{support.capability.value}",
                target_type="tenant",
                target_id=support.target_tenant_id,
                payload_json=payload,
                result="ok" if decision.allowed else "error",
                error_message=None if decision.allowed else decision.reason,
                support_ticket_id=support.ticket_id,
                support_reason=support.reason,
                support_capability=support.capability.value,
                support_expiry_at=support.expiry_at,
                support_approver_id=support.second_approver_id,
            )
        )
        db.commit()
    except Exception:  # noqa: BLE001
        # Never let audit failure short-circuit a legitimate authz call.
        db.rollback()


def gate(
    *,
    actor_user: Any,
    db: Session,
    resource: Resource,
    action: Action,
    required_capability: Capability,
    operating_mode: OperatingMode = OperatingMode.SELF,
    support: SupportContext | None = None,
    jwt_capability_schema_version: int | None = None,
) -> Decision:
    """Authorize a request and (in support mode) audit it.

    The caller passes the already-loaded user object; this wrapper reads
    the auxiliary rows itself. Every gate() invocation projects a fresh
    context — no caller-supplied context is trusted.

    Args:
        actor_user: The caller's ``User`` row, freshly loaded by
            ``current_user()``. Ownership + capabilities are re-derived
            from this row's live column values.
        db: Open :class:`Session`. Support-mode audit rows write here.
        resource: The target resource, tenant-tagged.
        action: read / write / delete.
        required_capability: The exact capability the endpoint needs.
        operating_mode: SELF for ordinary calls; DEMO / SUPPORT only when
            the route explicitly opts in (see admin_support routes).
        support: Optional :class:`SupportContext`. Required when
            ``operating_mode == SUPPORT``; audited on every accepted call.
        jwt_capability_schema_version: The version stamped into the
            caller's JWT. If provided AND lower than
            :data:`~app.features.CAPABILITY_SCHEMA_VERSION`, raises
            :exc:`StaleCapabilities` so the route can 409.

    Returns:
        The evaluator's :class:`Decision`. Callers convert non-ALLOW
        decisions into HTTP responses (403 for ``DENY``, 409/403 for
        ``DENY_NEEDS_SECOND_APPROVER``, per route convention).

    Raises:
        StaleCapabilities: JWT capability_schema_version < current.
    """
    if (
        jwt_capability_schema_version is not None
        and jwt_capability_schema_version < CAPABILITY_SCHEMA_VERSION
    ):
        raise StaleCapabilities(
            jwt_capability_schema_version, CAPABILITY_SCHEMA_VERSION
        )

    target_tenant_id: str | None = None
    if operating_mode is OperatingMode.SUPPORT and support is not None:
        target_tenant_id = support.target_tenant_id

    ctx: AuthorizationContext = build_authorization_context(
        actor_user,
        db,
        operating_mode=operating_mode,
        target_tenant_id=target_tenant_id,
    )

    decision = evaluate(
        ctx,
        resource,
        action,
        required_capability=required_capability,
        support=support,
        now=datetime.now(timezone.utc),
    )

    if support is not None:
        _write_support_audit(
            db,
            actor_user=actor_user,
            support=support,
            decision=decision,
            resource=resource,
            action=action,
        )

    return decision
