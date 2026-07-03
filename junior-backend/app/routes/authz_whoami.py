"""``/authz/whoami`` — server-authoritative capability snapshot.

Called by the account-app proxy layer (Batch 2E) so its Next.js
routes can gate on ``capabilities`` / ``platform_role`` derived from
the persisted DB row rather than the legacy client-side email
allowlist. Uses the same ``x-internal-secret`` + ``clerk_user_id``
pattern as ``/admin/*`` so the account-app can call it before any
admin verification exists — the endpoint is the identity primitive
the whole proxy layer bootstraps from.

Response mirrors the additive fields on ``/me`` (batch 2B) so a
future client can share the same projection code.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.authz import OperatingMode, build_authorization_context
from app.config import get_settings
from app.db import get_db
from app.features import CAPABILITY_SCHEMA_VERSION
from app.models import User

router = APIRouter(prefix="/authz", tags=["authz"])


class TenantContextOut(BaseModel):
    tenant_id: str
    role: str


class WhoAmIResponse(BaseModel):
    backend_user_id: str
    clerk_id: str | None
    email: str | None
    platform_role: str
    capabilities: list[str]
    tenant_contexts: list[TenantContextOut]
    limits: dict[str, int]
    capability_schema_version: int
    # Legacy shape mirrors for one compat release — lets the account-app
    # migrate its consumers gradually without a big-bang rewrite.
    raw_tier: str
    effective_plan: str


def _require_internal_secret(
    x_internal_secret: Annotated[str | None, Header()] = None,
) -> None:
    """Same defense-in-depth model as ``/admin/*``. An empty configured
    secret is a dev bypass; production must set INTERNAL_API_SECRET."""
    secret = get_settings().internal_api_secret
    if secret and x_internal_secret != secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad internal secret")


@router.get("/whoami", response_model=WhoAmIResponse)
def whoami(
    db: Annotated[Session, Depends(get_db)],
    clerk_user_id: Annotated[str, Query(min_length=1)],
    _internal: Annotated[None, Depends(_require_internal_secret)] = None,
) -> WhoAmIResponse:
    """Return the server-authoritative capability snapshot for a Clerk user.

    Uses the same projection as ``/me`` / ``/sync`` so the three surfaces
    can never disagree. Runs in SELF mode — the caller (account-app
    proxy) is asking "what can this user do on their own tenant?", not
    entering support mode. Support mode is granted via
    ``/admin/support/*`` with an explicit :class:`SupportContext`.
    """
    user = db.query(User).filter_by(clerk_id=clerk_user_id).one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")

    ctx = build_authorization_context(
        user, db, operating_mode=OperatingMode.SELF
    )
    return WhoAmIResponse(
        backend_user_id=str(user.id),
        clerk_id=user.clerk_id,
        email=user.email,
        platform_role=ctx.platform_role.value,
        capabilities=sorted(c.value for c in ctx.capabilities),
        tenant_contexts=[
            TenantContextOut(tenant_id=m.tenant_id, role=m.role)
            for m in ctx.tenant_memberships
        ],
        limits=dict(ctx.limits),
        capability_schema_version=ctx.capability_schema_version
        or CAPABILITY_SCHEMA_VERSION,
        raw_tier=ctx.raw_plan,
        effective_plan=ctx.effective_plan,
    )
