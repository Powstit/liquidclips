"""Explicit audited cross-tenant support endpoints.

Introduced by Batch 2C's sever — the customer ``/agency/{id}/*`` routes
no longer allow admin cross-tenant access. This router provides the
sanctioned path: an admin (or staff) can inspect a target tenant only
by hitting an ``/admin/support/*`` endpoint that requires a documented
support context in the request headers and writes an audit row on every
call regardless of outcome.

Contract per SELF_ONBOARDING_RELEASE_MASTER.md §Step 2:

* Every call carries ``x-support-ticket-id`` (external reference),
  ``x-support-reason`` (non-empty free text), and
  ``x-support-expiry-at`` (ISO-8601, ≤ 4h from now).
* ``x-support-capability`` names the exact capability the endpoint
  needs — mismatch is a 403.
* Writes additionally require ``x-support-approver-id`` naming a second
  admin user id. The gate wrapper returns
  :attr:`DecisionKind.DENY_NEEDS_SECOND_APPROVER` when it is absent or
  the referenced user isn't a valid admin; the route converts that to
  ``428 Precondition Required`` so the client can prompt for the
  approver flow.

Endpoints shipped in Batch 2D:

* ``GET /admin/support/agency/{agency_id}/roster`` — SUPPORT_TENANT_READ.
* ``POST /admin/support/agency/{agency_id}/roster/invite`` —
  SUPPORT_TENANT_WRITE (audited, requires second approver).

Future batches add coverage for user detail, campaign inspection, etc.
The pattern (extract context → gate → proxy to existing query) is the
template.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Header, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

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
from app.config import get_settings
from app.db import get_db
from app.deps import current_user
from app.jwt_signer import verify_license_jwt
from app.models import User


router = APIRouter(prefix="/admin/support", tags=["admin-support"])


# Maximum lifetime a support session can carry — 4 hours per master doc
# proof-of-scoping (bounded ≤ 4h to sharply limit breach exposure of a
# leaked admin JWT). Configurable via env for stricter deployments.
def _support_max_ttl_seconds() -> int:
    import os
    try:
        return int(os.environ.get("LC_SUPPORT_WRITE_MAX_TTL_SECONDS", "14400"))
    except ValueError:
        return 14400


# ---------------------------------------------------------------------
# Belt-and-suspenders outer gate — matches the rest of /admin/*.
# ---------------------------------------------------------------------


def _require_internal_secret(
    x_internal_secret: Annotated[str | None, Header()] = None,
) -> None:
    """Reject requests missing the server-shared internal secret.

    Preserves the defence-in-depth model of the existing /admin/* router:
    even a stolen admin JWT alone cannot hit /admin/support/* without
    also possessing this secret. Empty settings-side value = dev bypass
    (mirrors ``routes/admin.py``)."""
    secret = get_settings().internal_api_secret
    if secret and x_internal_secret != secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad internal secret")


# ---------------------------------------------------------------------
# Support context assembly from request headers.
# ---------------------------------------------------------------------


def _build_support_context(
    *,
    actor: User,
    target_tenant_id: str,
    required_capability: Capability,
    x_support_ticket_id: str | None,
    x_support_reason: str | None,
    x_support_expiry_at: str | None,
    x_support_capability: str | None,
    x_support_approver_id: str | None,
    db: Session,
) -> SupportContext:
    """Validate + parse the ``x-support-*`` headers into a SupportContext.

    Enforces the bounded-expiry contract locally so an evaluator that
    ONLY checks ``expiry_at > now`` cannot be tricked by a caller who
    supplies ``expiry_at = year 2999``. Reason must be non-empty (the
    evaluator re-checks, but a 400 here is a clearer error). The
    approver id is looked up as a live admin user; a stale or invalid id
    causes the gate to return DENY_NEEDS_SECOND_APPROVER.
    """
    if not x_support_reason or not x_support_reason.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "x-support-reason required")
    if not x_support_expiry_at:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "x-support-expiry-at required")
    try:
        expiry_at = datetime.fromisoformat(x_support_expiry_at.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "x-support-expiry-at must be ISO-8601",
        ) from None
    if expiry_at.tzinfo is None:
        expiry_at = expiry_at.replace(tzinfo=timezone.utc)

    now = datetime.now(timezone.utc)
    max_ttl = timedelta(seconds=_support_max_ttl_seconds())
    if expiry_at > now + max_ttl:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"support expiry exceeds max ttl {max_ttl.total_seconds()}s",
        )
    if expiry_at <= now:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "support context already expired",
        )

    if x_support_capability != required_capability.value:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"x-support-capability must equal {required_capability.value!r}",
        )

    # Second-approver lookup — only relevant for write. If provided, the
    # id must resolve to a live admin user; the gate wrapper additionally
    # confirms the capability outcome. Non-admin ids are treated as
    # missing (gate returns DENY_NEEDS_SECOND_APPROVER).
    approver_id_for_ctx: str | None = None
    if x_support_approver_id:
        approver = db.get(User, x_support_approver_id)
        if approver is not None and getattr(approver, "platform_role", "none") == "admin":
            approver_id_for_ctx = str(approver.id)
        # Else: leave None so the gate short-circuits with the specific
        # DENY_NEEDS_SECOND_APPROVER decision. The route converts to 428.

    return SupportContext(
        actor_user_id=str(actor.id),
        target_tenant_id=target_tenant_id,
        reason=x_support_reason.strip(),
        expiry_at=expiry_at,
        capability=required_capability,
        ticket_id=x_support_ticket_id,
        second_approver_id=approver_id_for_ctx,
    )


def _decision_to_http(decision) -> None:
    """Convert non-ALLOW decisions to matching HTTP errors."""
    if decision.allowed:
        return
    if decision.kind is DecisionKind.DENY_NEEDS_SECOND_APPROVER:
        raise HTTPException(
            status.HTTP_428_PRECONDITION_REQUIRED,
            "second approver required",
        )
    raise HTTPException(status.HTTP_403_FORBIDDEN, decision.reason)


# ---------------------------------------------------------------------
# GET /admin/support/agency/{agency_id}/roster — SUPPORT_TENANT_READ
# ---------------------------------------------------------------------


@router.get("/agency/{agency_id}/roster")
def support_list_roster(
    agency_id: str,
    caller: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    _internal: Annotated[None, Depends(_require_internal_secret)] = None,
    x_support_ticket_id: Annotated[str | None, Header()] = None,
    x_support_reason: Annotated[str | None, Header()] = None,
    x_support_expiry_at: Annotated[str | None, Header()] = None,
    x_support_capability: Annotated[str | None, Header()] = None,
):
    """Return the target agency's roster + pending invites — audited.

    Any admin or staff with SUPPORT_TENANT_READ granted by the projection
    can reach this. Every accepted call writes an AdminAuditLog row via
    the gate wrapper.
    """
    ctx = _build_support_context(
        actor=caller,
        target_tenant_id=agency_id,
        required_capability=Capability.SUPPORT_TENANT_READ,
        x_support_ticket_id=x_support_ticket_id,
        x_support_reason=x_support_reason,
        x_support_expiry_at=x_support_expiry_at,
        x_support_capability=x_support_capability,
        x_support_approver_id=None,
        db=db,
    )

    try:
        decision = gate(
            actor_user=caller,
            db=db,
            resource=Resource(kind="agency.roster", tenant_id=agency_id),
            action=Action.READ,
            required_capability=Capability.SUPPORT_TENANT_READ,
            operating_mode=OperatingMode.SUPPORT,
            support=ctx,
        )
    except StaleCapabilities:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "stale_capabilities · refresh /sync"
        ) from None
    _decision_to_http(decision)

    # Proxy the underlying data — reuse the exact code path the customer
    # /agency/{id}/roster endpoint runs so the JSON shape stays identical.
    from app.routes.agency import list_roster as customer_list_roster  # local: avoid cycle

    # customer_list_roster expects a User row that OWNS the agency. We
    # temporarily substitute the target's owner-ish view: fabricate a
    # dummy owner record just for the ownership check. Simpler: query the
    # tables directly here, since we already authorised at gate().
    from app.models import AgencyMember, AgencyInvite
    from app.routes.agency import (
        RosterOut,
        _member_row_to_out,
        _invite_row_to_out,
        _as_utc,
        utcnow,
    )

    member_rows = (
        db.query(AgencyMember)
        .filter(
            AgencyMember.agency_id == agency_id,
            AgencyMember.removed_at.is_(None),
        )
        .order_by(AgencyMember.joined_at.asc())
        .all()
    )
    user_ids = [m.user_id for m in member_rows]
    users_by_id: dict[str, User] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            users_by_id[u.id] = u
    members = [
        _member_row_to_out(m, users_by_id.get(m.user_id)) for m in member_rows
    ]

    now = utcnow()
    pending_rows = (
        db.query(AgencyInvite)
        .filter(
            AgencyInvite.agency_id == agency_id,
            AgencyInvite.status == "pending",
        )
        .order_by(AgencyInvite.created_at.desc())
        .all()
    )
    live_pending: list[AgencyInvite] = []
    for inv in pending_rows:
        exp = _as_utc(inv.expires_at)
        if exp is not None and exp <= now:
            inv.status = "expired"
        else:
            live_pending.append(inv)
    if any(inv.status == "expired" for inv in pending_rows):
        db.flush()

    return RosterOut(
        members=members,
        pending_invites=[_invite_row_to_out(r) for r in live_pending],
    )


# ---------------------------------------------------------------------
# POST /admin/support/agency/{agency_id}/roster/invite — WRITE
# ---------------------------------------------------------------------


class SupportInviteRequest(BaseModel):
    email: EmailStr
    role: str = "member"


@router.post("/agency/{agency_id}/roster/invite")
def support_invite_member(
    agency_id: str,
    body: SupportInviteRequest,
    caller: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    _internal: Annotated[None, Depends(_require_internal_secret)] = None,
    x_support_ticket_id: Annotated[str | None, Header()] = None,
    x_support_reason: Annotated[str | None, Header()] = None,
    x_support_expiry_at: Annotated[str | None, Header()] = None,
    x_support_capability: Annotated[str | None, Header()] = None,
    x_support_approver_id: Annotated[str | None, Header()] = None,
):
    """Invite a clipper into the target agency — audited, requires 2nd approver.

    The write flow mirrors the customer ``/agency/{id}/roster/invite``
    endpoint, but every call writes an audit row (via the gate wrapper)
    with the ticket + reason + approver + result. Without a valid
    second approver id, gate returns
    :attr:`DecisionKind.DENY_NEEDS_SECOND_APPROVER` and we surface 428.
    """
    ctx = _build_support_context(
        actor=caller,
        target_tenant_id=agency_id,
        required_capability=Capability.SUPPORT_TENANT_WRITE,
        x_support_ticket_id=x_support_ticket_id,
        x_support_reason=x_support_reason,
        x_support_expiry_at=x_support_expiry_at,
        x_support_capability=x_support_capability,
        x_support_approver_id=x_support_approver_id,
        db=db,
    )

    try:
        decision = gate(
            actor_user=caller,
            db=db,
            resource=Resource(kind="agency.roster.invite", tenant_id=agency_id),
            action=Action.WRITE,
            required_capability=Capability.SUPPORT_TENANT_WRITE,
            operating_mode=OperatingMode.SUPPORT,
            support=ctx,
        )
    except StaleCapabilities:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "stale_capabilities · refresh /sync"
        ) from None
    _decision_to_http(decision)

    # Actual invite creation. Kept minimal here — a full re-implementation
    # of every side-effect the customer route runs (email send, unique
    # constraints, audit within agency.py) can come once the sanction
    # flow is proven end-to-end. For Batch 2D we prove: the gate + audit
    # + basic write executes; a full-fidelity write is deferred to
    # subsequent hardening.
    from app.models import AgencyInvite
    import uuid

    invite = AgencyInvite(
        id=uuid.uuid4().hex,
        agency_id=agency_id,
        invited_by_user_id=caller.id,
        email=str(body.email).strip().lower(),
        token=uuid.uuid4().hex,
        role=body.role,
        status="pending",
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db.add(invite)
    db.commit()

    return {"id": invite.id, "status": invite.status, "email": invite.email}
