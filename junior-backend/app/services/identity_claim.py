"""Canonical identity-claim service · Wave 1 gap-closure (2026-07-12).

**Single writer for ``users.handle``.** Every route that mutates the
column MUST delegate to :func:`claim_handle` — validation, uniqueness,
telemetry, and response shape all live here so no two callers can drift.

Introduced by the Wave 1 identity-ladder gap-closure to remove the
duplicate writer between ``POST /me/lc-id/claim`` (Wave 1 new) and
``POST /me/handle`` (legacy). Both routes are now thin transports over
this service · see:

  * ``junior-backend/app/routes/me.py::claim_lc_id_handle``
  * ``junior-backend/app/routes/handle.py::set_handle`` (deprecated alias)

Rules enforced here (the ONLY place they live · client code mirrors
this policy but does not import it):

  * regex ``^[a-z0-9_]{3,20}$`` after ``strip().lower()``
  * reserved-word set (locked list; new words go here + in the client
    mirror in ``ClaimHandleSheet.tsx``)
  * case-insensitive uniqueness against ``LOWER(users.handle)``
  * idempotent reclaim of the caller's own handle (no 409 vs self)

Telemetry: emits ``handle_write`` with ``{source, lc_id, handle}`` on
every successful write. Downstream Doctor + HQ log rails consume this
to prove the canonical writer landed and no legacy path bypassed it.
"""

from __future__ import annotations

import logging
import re
from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import User

log = logging.getLogger("junior.identity_claim")

# ── Locked policy ─────────────────────────────────────────────────────

# Wave 1 handle shape · matches the client mirror in
# ``desktop-2/src/design-os/onboarding/ClaimHandleSheet.tsx``.
_CLAIM_HANDLE_RE = re.compile(r"^[a-z0-9_]{3,20}$")

# Reserved-word set · Wave 1 gap-closure consolidation. Every entry
# from the old ``handle.py::_RESERVED_HANDLES`` set plus the additional
# brand/anti-impersonation names introduced by the ladder. Kept in sync
# manually with:
#
#   * ``desktop-2/src/design-os/onboarding/ClaimHandleSheet.tsx``
#     ``RESERVED_HANDLES`` set (flow-test grep asserts parity)
_RESERVED_HANDLES: frozenset[str] = frozenset({
    "system-bot",
    "admin",
    "staff",
    "mod",
    "root",
    "founder",
    "whop",
    "liquid",
    "liquidclips",
    "liquid-clips",
    "kade",
    "support",
    "help",
    "billing",
    "hq",
    # Wave 1 additions.
    "guest",
    "anonymous",
    "you",
    "me",
    "self",
    "daniel",
    "clip",
    "clipper",
    "agency",
    "signin",
    "signup",
    "login",
    "logout",
})

ClaimSource = Literal["lc-id-claim", "legacy-handle-alias"]


def _emit_handle_write(*, source: ClaimSource, user: User, handle: str) -> None:
    """Emit the canonical ``handle_write`` diagnostic on every successful
    write. Rides the backend log rail (see ``junior-backend/app/main.py``
    log config); HQ tails ``junior.identity_claim`` for the topic.

    Payload shape locked:
        {source, lc_id, handle, user_id}

    Kept boolean/string-only so no PII (email) leaks. ``lc_id`` is
    already a customer-facing public identifier · safe to log.
    """
    try:
        log.info(
            "handle_write source=%s lc_id=%s handle=%s user_id=%s",
            source,
            getattr(user, "lc_id", None),
            handle,
            user.id,
        )
    except Exception:  # noqa: BLE001 · telemetry never blocks the write
        pass


def claim_handle(
    *,
    session: Session,
    user_id: str,
    handle: str,
    source: ClaimSource,
) -> User:
    """Canonical write path for ``users.handle``.

    Returns the freshly-updated ``User`` row (re-read from the DB so
    downstream projection sees the persisted value, not an
    admin-elevated in-memory copy).

    Raises ``HTTPException``:
      * 401 if ``user_id`` doesn't resolve to a row
      * 422 on regex/reserved-word failure
      * 409 on case-insensitive collision with another user

    Idempotent for the caller's own row · claiming the same handle
    twice returns the user unchanged with no 409.
    """
    normalised = (handle or "").strip().lower()

    if not _CLAIM_HANDLE_RE.match(normalised):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "handle_invalid_format",
        )
    if normalised in _RESERVED_HANDLES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "handle_reserved",
        )

    row = session.get(User, user_id)
    if row is None:
        # The JWT resolved but the DB row is gone — 401 keeps the
        # client's session-lifecycle re-auth flow intact.
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "license user not found",
        )

    # Idempotent reclaim of own handle.
    if (row.handle or "").lower() == normalised:
        _emit_handle_write(source=source, user=row, handle=normalised)
        return row

    # Case-insensitive uniqueness against other users.
    existing = (
        session.query(User)
        .filter(User.id != row.id)
        .filter(User.handle.ilike(normalised))
        .limit(1)
        .one_or_none()
    )
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "handle_taken")

    row.handle = normalised
    session.commit()
    session.refresh(row)
    _emit_handle_write(source=source, user=row, handle=normalised)
    return row


# ── Exported for router-level parity + test grep ──────────────────────

CLAIM_HANDLE_RE = _CLAIM_HANDLE_RE
RESERVED_HANDLES = _RESERVED_HANDLES

__all__ = [
    "CLAIM_HANDLE_RE",
    "RESERVED_HANDLES",
    "ClaimSource",
    "claim_handle",
]
