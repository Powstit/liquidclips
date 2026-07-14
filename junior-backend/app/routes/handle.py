"""Unified user.handle CRUD + public resolution.

Two endpoints:
  · POST /me/handle          · **deprecated alias** — delegates 100% to
                                ``app.services.identity_claim.claim_handle``
                                with ``source="legacy-handle-alias"``.
                                Scheduled for removal in Wave 2 once no
                                active clients remain. See
                                ``lcos/reports/impact/wave-1-identity-ladder/``.
  · GET  /link-resolve/{h}   · unauthed lookup used by the marketing
                                site's /join/[handle] redirect.

Wave 1 gap-closure (2026-07-12):
    Prior to this change, ``POST /me/handle`` contained its OWN
    validation + reserved-word list + collision check, duplicating
    the write path in ``app/routes/me.py::claim_lc_id_handle``. Both
    surfaces would drift silently the moment either regex changed.
    The gap-closure extracts one canonical service
    (``app.services.identity_claim.claim_handle``); this route
    becomes a THIN transport whose only remaining responsibility is
    the legacy ``HandleOut`` response shape for backward compatibility
    with any pre-migration client.

Handle rules (locked in
``app.services.identity_claim.claim_handle`` · this route no longer
enforces them independently):
  · lowercase, alphanumeric + underscore
  · 3-20 chars (stricter than the pre-Wave-1 3-30 range · matches the
    ladder-visible ``@handle`` pill shape)
  · case-insensitive uniqueness
  · reserved-word list (see ``identity_claim._RESERVED_HANDLES``)
"""

from __future__ import annotations

import logging
import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.models import User
from app.services.identity_claim import claim_handle

router = APIRouter(tags=["handle"])
log = logging.getLogger("junior.handle_deprecated")


class HandlePayload(BaseModel):
    # Wave 1 gap-closure: allow 1-60 char range at the pydantic layer so
    # the input reaches the canonical service, which then applies the
    # stricter ``^[a-z0-9_]{3,20}$`` and reserved-word rules — the client
    # sees a consistent 422 whether the failure is length OR shape OR a
    # reserved word.
    handle: str = Field(..., min_length=1, max_length=60)


class HandleOut(BaseModel):
    """Legacy response shape · retained so pre-migration clients (the
    original ``AffiliateWidget`` shipped before Wave 1) keep working
    while they migrate to ``POST /me/lc-id/claim`` which returns the
    unified ``MeResponse``."""

    handle: str
    share_url: str


@router.post("/me/handle", response_model=HandleOut, deprecated=True)
def set_handle(
    payload: HandlePayload,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    response: Response,
) -> HandleOut:
    """**Deprecated** · thin alias for ``POST /me/lc-id/claim``.

    Wave 1 gap-closure (2026-07-12) rewrote this route to delegate
    100% to :func:`app.services.identity_claim.claim_handle` so
    ``users.handle`` has ONE canonical writer function. The route no
    longer contains independent validation, collision, or write
    logic — it exists only to preserve the legacy response shape
    (``{handle, share_url}``) for clients that haven't yet migrated
    to the unified ``MeResponse`` returned by ``POST /me/lc-id/claim``.

    Deprecation signals:
      * ``X-Deprecation`` response header points callers at the
        canonical endpoint.
      * Every call emits a backend-log deprecation warning so ops
        can trace lingering callers via the log rail.
      * Scheduled removal · Wave 2. See
        ``lcos/reports/impact/wave-1-identity-ladder/02-gap-closure.md``.
    """
    # ASCII-only per RFC 7230; the middle-dot glyph elsewhere in the
    # codebase can't ride HTTP headers.
    response.headers["X-Deprecation"] = (
        "POST /me/handle is deprecated. Use POST /me/lc-id/claim (returns MeResponse)."
    )
    log.warning(
        "deprecated_endpoint /me/handle called · user_id=%s · migrate to /me/lc-id/claim",
        user.id,
    )
    updated = claim_handle(
        session=db,
        user_id=user.id,
        handle=payload.handle,
        source="legacy-handle-alias",
    )
    return HandleOut(
        handle=updated.handle or "",
        share_url=f"https://liquidclips.app/join/{updated.handle}",
    )


class LinkResolveOut(BaseModel):
    """Response shape for the marketing /join/[handle] redirect. The
    marketing route consumes only affiliate_code — the extra fields
    are here so a future analytics or attribution surface can grow
    without a version bump."""

    handle: str
    affiliate_code: str | None
    checkout_url: str


@router.get("/link-resolve/{handle}", response_model=LinkResolveOut)
def resolve_link(
    handle: str,
    db: Annotated[Session, Depends(get_db)],
) -> LinkResolveOut:
    """Public lookup for marketing site. Returns the target user's real
    Whop affiliate code so /join/<handle> can 302 to Whop's checkout
    with correct attribution. If the handle exists but the user has no
    Whop affiliate code yet (they haven't connected Whop), we still
    return 200 with affiliate_code=null so the marketing site can 302
    to the plain checkout without breaking the flow."""
    if not re.match(r"^[a-z0-9._-]{2,60}$", handle.lower()):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "handle_not_found")
    user = (
        db.query(User)
        .filter(User.handle.ilike(handle))
        .one_or_none()
    )
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "handle_not_found")

    aff = user.whop_affiliate_code or user.whop_affiliate_id or None
    checkout_base = "https://account.liquidclips.app/checkout"
    checkout_url = f"{checkout_base}?a={aff}" if aff else checkout_base
    return LinkResolveOut(
        handle=user.handle or handle,
        affiliate_code=aff,
        checkout_url=checkout_url,
    )
