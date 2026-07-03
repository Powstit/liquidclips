"""Closed enums that back the capability registry.

Every gate references an enum member. String literals in call sites are
banned by convention — the evaluator only accepts :class:`Capability`
values, so a typo becomes a type error at import time.

The 16 capability minimum is fixed by
``SELF_ONBOARDING_RELEASE_MASTER.md`` §Step 2 → Minimum capabilities.
Additions require both an enum edit and a matching client-side mirror
in ``desktop-2/src/lib/authz/capabilities.ts`` (batch 2F).

``PlatformRole`` is server-authoritative — it is stored on the user row
and never inferred from an email allow-list. ``OperatingMode`` is
request-scoped: a single admin can be in ``self`` on one call, ``demo``
on the next, and ``support`` on a third with a specific target tenant.
"""

from __future__ import annotations

from enum import Enum


class Capability(str, Enum):
    """The closed capability registry.

    Membership is closed on purpose — a route that needs a new
    capability MUST land the enum edit in the same change so the
    evaluator can reason about it and the client mirror stays honest.
    """

    # ---- Clipper (ordinary product usage) ----
    CLIPPER_USE = "clipper.use"

    # ---- Agency (owner + staff acting inside own tenant) ----
    AGENCY_WORKSPACE_READ = "agency.workspace.read"
    AGENCY_CAMPAIGN_CREATE = "agency.campaign.create"
    AGENCY_CAMPAIGN_UPDATE = "agency.campaign.update"
    AGENCY_CAMPAIGN_PUBLISH = "agency.campaign.publish"
    AGENCY_CAMPAIGN_ARCHIVE = "agency.campaign.archive"
    AGENCY_ROSTER_READ = "agency.roster.read"
    AGENCY_ROSTER_MANAGE = "agency.roster.manage"
    AGENCY_RULES_MANAGE = "agency.rules.manage"
    AGENCY_PAYOUTS_READ = "agency.payouts.read"
    AGENCY_PAYOUTS_MANAGE = "agency.payouts.manage"

    # ---- Platform (staff-level operations) ----
    HQ_READ = "hq.read"
    HQ_MUTATE = "hq.mutate"
    SUPPORT_TENANT_READ = "support.tenant.read"
    SUPPORT_TENANT_WRITE = "support.tenant.write"

    # ---- Demo (admin-only entitlement override on OWN data) ----
    DEMO_PLAN_OVERRIDE = "demo.plan_override"


class PlatformRole(str, Enum):
    """Server-authoritative platform authority.

    Stored on ``User.platform_role``. Backfilled in migration from the
    legacy ``JUNIOR_ADMIN_EMAILS`` list. Never inferred from email at
    request time in the new code path.
    """

    NONE = "none"
    STAFF = "staff"   # SUPPORT_TENANT_READ only, no HQ_WRITE, no SUPPORT_WRITE
    ADMIN = "admin"   # HQ_* + SUPPORT_TENANT_READ; write needs 2nd approver


class OperatingMode(str, Enum):
    """Request-scoped mode.

    ``self`` — caller acting on their own tenant / product.
    ``demo`` — admin acting on OWN data with ``DEMO_PLAN_OVERRIDE``
    granted (never crosses tenant boundary).
    ``support`` — explicit cross-tenant access, requires a matching
    :class:`~app.authz.context.SupportContext` on the request.
    """

    SELF = "self"
    DEMO = "demo"
    SUPPORT = "support"


class Action(str, Enum):
    """The verb dimension of an authorization check."""

    READ = "read"
    WRITE = "write"
    DELETE = "delete"
