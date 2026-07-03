"""Server-owned authorization primitives.

Step 2 of the self-onboarding release master. See
``SELF_ONBOARDING_RELEASE_MASTER.md`` for the full contract.

Three independent dimensions:

* **Plan entitlements** — what the caller's subscription unlocks
  (derived from tier + founder/comp override).
* **Platform role** — staff-level authority
  (:class:`~app.authz.capabilities.PlatformRole`).
* **Tenant scope** — WHICH tenants the caller may touch
  (own memberships + optional cross-tenant support context).

Combined with an operating mode (``self`` / ``demo`` / ``support``) they
form an :class:`~app.authz.context.AuthorizationContext` that is fed
into a **pure** evaluator (:func:`app.authz.evaluator.evaluate`) which
returns a :class:`~app.authz.context.Decision`.

Batch 2A ships the pure module + table-driven unit tests only; nothing
in this package is wired into request handlers yet. The DB-loading
wrapper (``gate.py``) and route migrations land in later batches.
"""

from __future__ import annotations

from app.authz.capabilities import (
    Action,
    Capability,
    OperatingMode,
    PlatformRole,
)
from app.authz.context import (
    AuthorizationContext,
    Decision,
    DecisionKind,
    Resource,
    SupportContext,
    TenantMembership,
)
from app.authz.evaluator import evaluate
from app.authz.gate import StaleCapabilities, gate
from app.authz.projection import build_authorization_context

__all__ = [
    "Action",
    "AuthorizationContext",
    "Capability",
    "Decision",
    "DecisionKind",
    "OperatingMode",
    "PlatformRole",
    "Resource",
    "StaleCapabilities",
    "SupportContext",
    "TenantMembership",
    "build_authorization_context",
    "evaluate",
    "gate",
]
