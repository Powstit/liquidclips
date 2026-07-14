"""Admin State Puppeteer — Lane B · Chapter 5 (2026-07-10).

Admin-only write/read routes for the State Puppeteer table
(`state_overrides`). Powers HQ's per-user surface-state driver: an admin
picks a user, a surface, and one of the six documented states; the
matching `/me/wallet/summary` (etc.) response body is swapped for a
`state_puppet_fixtures.py` fixture until the override expires or an
admin clears it.

Contracts
---------
- All endpoints reuse the canonical `require_admin` gate from
  `admin.py` (`x-internal-secret` + `is_admin_email`). NEVER reinvent
  the gate.
- Every mutation writes one `AdminAuditLog` row via `_write_audit`
  (see admin_mutations.py) so overrides are fully traceable — HQ's
  audit tab surfaces the actor + target + payload.
- TTL is bounded: default 30 min, hard maximum 4 h. Anything longer is
  rejected. Rows outside the window are ignored by the wallet endpoint
  even if never cleared.
- No PII: the response mirror uses the DB user id (`usr_...`) — never
  the email — to identify the target.

Endpoints
---------
POST   /admin/user/{user_id}/state-override        · create/replace override
DELETE /admin/user/{user_id}/state-override        · clear override(s)
GET    /admin/user/{user_id}/state-overrides       · list active overrides for user
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import AdminAuditLog, StateOverride, User
from app.routes.admin import AdminUser
from app.routes.admin_mutations import _redact_payload, _write_audit
from app.state_puppet_fixtures import VALID_STATES, VALID_SURFACES

_log = logging.getLogger("junior.admin_state_override")

router = APIRouter(prefix="/admin/user", tags=["admin", "state-puppet"])


# ────────────────────────────────────────────────────────────────────
# Constants
# ────────────────────────────────────────────────────────────────────

# Default TTL is 30 minutes — long enough to walk a demo, short enough
# that a forgotten override doesn't leak into next session.
DEFAULT_TTL_MINUTES = 30
# Hard ceiling — no override lives longer than 4h. Anything longer must
# be re-applied by an admin explicitly.
MAX_TTL_MINUTES = 240


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _clamp_expires_at(expires_at: datetime | None) -> datetime:
    """Return an aware `expires_at` inside [now+1min, now+MAX_TTL_MINUTES].
    Missing → now+DEFAULT_TTL_MINUTES."""
    now = _utcnow()
    if expires_at is None:
        return now + timedelta(minutes=DEFAULT_TTL_MINUTES)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= now:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "expires_at must be in the future")
    max_end = now + timedelta(minutes=MAX_TTL_MINUTES)
    if expires_at > max_end:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"expires_at exceeds hard maximum of {MAX_TTL_MINUTES} minutes",
        )
    return expires_at


# ────────────────────────────────────────────────────────────────────
# I/O shapes
# ────────────────────────────────────────────────────────────────────


class StateOverrideIn(BaseModel):
    surface: Literal[
        "wallet-detail",
        "sync-mail-money-drop",
        "catalog-carousel",
        "cancellation-intercept",
    ]
    state: Literal[
        "fresh_install",
        "populated",
        "paid_normal",
        "paid_streak",
        "grace",
        "cancelled",
    ]
    expires_at: datetime | None = None


class StateOverrideOut(BaseModel):
    id: int
    user_id: str
    surface: str
    state: str
    applied_by_admin_email: str
    applied_at: datetime
    expires_at: datetime
    cleared_at: datetime | None
    active: bool = Field(
        description="True iff cleared_at is null AND expires_at is in the future.",
    )


class StateOverrideListOut(BaseModel):
    user_id: str
    overrides: list[StateOverrideOut]


def _row_to_out(row: StateOverride) -> StateOverrideOut:
    now = _utcnow()
    active = row.cleared_at is None and row.expires_at > now
    return StateOverrideOut(
        id=row.id,
        user_id=row.user_id,
        surface=row.surface,
        state=row.state,
        applied_by_admin_email=row.applied_by_admin_email,
        applied_at=row.applied_at,
        expires_at=row.expires_at,
        cleared_at=row.cleared_at,
        active=active,
    )


# ────────────────────────────────────────────────────────────────────
# POST · create / replace override
# ────────────────────────────────────────────────────────────────────


@router.post(
    "/{user_id}/state-override",
    response_model=StateOverrideOut,
    status_code=status.HTTP_201_CREATED,
)
def apply_state_override(
    user_id: str,
    body: StateOverrideIn,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> StateOverrideOut:
    """Create a new StateOverride row. Any currently-active row on the
    same (user_id, surface) is cleared first so there's never more than
    one active row per slot. Emits `state_puppet_activated` via audit
    log; the client-side HQ panel emits the diag event."""

    target = db.query(User).filter_by(id=user_id).one_or_none()
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")

    if body.surface not in VALID_SURFACES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unsupported surface")
    if body.state not in VALID_STATES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unsupported state")

    expires_at = _clamp_expires_at(body.expires_at)
    now = _utcnow()

    # Clear any active row on the same (user, surface) so there's a
    # unique active row per slot. `cleared_at` timestamps the flip; we
    # don't UPDATE `expires_at` (see the model docstring — TTL is
    # append-only).
    prev = (
        db.query(StateOverride)
        .filter(
            StateOverride.user_id == user_id,
            StateOverride.surface == body.surface,
            StateOverride.cleared_at.is_(None),
            StateOverride.expires_at > now,
        )
        .all()
    )
    for row in prev:
        row.cleared_at = now

    inserted = StateOverride(
        user_id=user_id,
        surface=body.surface,
        state=body.state,
        applied_by_admin_email=(admin.email or "unknown@admin"),
        applied_at=now,
        expires_at=expires_at,
    )
    db.add(inserted)
    db.commit()
    db.refresh(inserted)

    _write_audit(
        db,
        actor_email=admin.email or "unknown@admin",
        action="state_puppet.apply",
        target_type="user",
        target_id=user_id,
        payload=_redact_payload(
            {
                "surface": body.surface,
                "state": body.state,
                "expires_at": expires_at.isoformat(),
            }
        ),
        result="ok",
    )

    return _row_to_out(inserted)


# ────────────────────────────────────────────────────────────────────
# DELETE · clear override(s)
# ────────────────────────────────────────────────────────────────────


@router.delete(
    "/{user_id}/state-override",
    response_model=StateOverrideListOut,
)
def clear_state_override(
    user_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    surface: Annotated[str | None, Query()] = None,
) -> StateOverrideListOut:
    """Clear active overrides for a user.

    - `?surface=wallet-detail` clears only that surface.
    - Omit `surface` to clear ALL surfaces for the user.
    Returns the list of rows that were cleared (as they now look after
    the `cleared_at` stamp)."""

    target = db.query(User).filter_by(id=user_id).one_or_none()
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")

    now = _utcnow()
    q = db.query(StateOverride).filter(
        StateOverride.user_id == user_id,
        StateOverride.cleared_at.is_(None),
        StateOverride.expires_at > now,
    )
    if surface is not None:
        if surface not in VALID_SURFACES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "unsupported surface")
        q = q.filter(StateOverride.surface == surface)

    rows = q.all()
    for row in rows:
        row.cleared_at = now
    db.commit()

    _write_audit(
        db,
        actor_email=admin.email or "unknown@admin",
        action="state_puppet.clear",
        target_type="user",
        target_id=user_id,
        payload=_redact_payload(
            {
                "surface": surface or "*",
                "cleared_count": len(rows),
            }
        ),
        result="ok",
    )

    return StateOverrideListOut(
        user_id=user_id,
        overrides=[_row_to_out(r) for r in rows],
    )


# ────────────────────────────────────────────────────────────────────
# GET · list active overrides
# ────────────────────────────────────────────────────────────────────


@router.get(
    "/{user_id}/state-overrides",
    response_model=StateOverrideListOut,
)
def list_state_overrides(
    user_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    include_expired: Annotated[bool, Query()] = False,
) -> StateOverrideListOut:
    """List overrides for a user. By default, only ACTIVE rows.
    `?include_expired=true` returns the full history (cap 100)."""

    target = db.query(User).filter_by(id=user_id).one_or_none()
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")

    now = _utcnow()
    q = db.query(StateOverride).filter(StateOverride.user_id == user_id)
    if not include_expired:
        q = q.filter(
            StateOverride.cleared_at.is_(None),
            StateOverride.expires_at > now,
        )
    rows = q.order_by(StateOverride.applied_at.desc()).limit(100).all()
    return StateOverrideListOut(
        user_id=user_id,
        overrides=[_row_to_out(r) for r in rows],
    )


# ────────────────────────────────────────────────────────────────────
# Internal helper — read-only lookup used by /me/wallet/summary etc.
# ────────────────────────────────────────────────────────────────────


def get_active_override(
    db: Session, *, user_id: str, surface: str
) -> StateOverride | None:
    """Return the currently-active StateOverride for (user, surface) or
    None. Used by product-surface routes (me_wallet.py) to swap in a
    fixture body. NEVER writes."""
    now = _utcnow()
    return (
        db.query(StateOverride)
        .filter(
            StateOverride.user_id == user_id,
            StateOverride.surface == surface,
            StateOverride.cleared_at.is_(None),
            StateOverride.expires_at > now,
        )
        .order_by(StateOverride.applied_at.desc())
        .first()
    )
