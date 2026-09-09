"""POST /me/contact-check — K-factor existing-user gate.

Native-Contacts K-factor (desktop) needs to know, before showing an
"invite" UI for a picked contact, whether that contact is already a
Liquid Clips user — K-factor exists to acquire NEW users, not to
present an invite affordance for someone who already has an account.

This endpoint answers exactly that one boolean question and nothing
else. It is intentionally NOT a general user-lookup endpoint:

  * Authenticated only (license JWT via app.deps.current_user — the
    same dependency already used by /me/crew/match).
  * Returns ONLY {"is_user": bool} — no user id, name, tier, Whop id,
    or any other detail. Same response shape for true and false, so
    there's no shape/size difference to fingerprint.
  * Rate-limited per authenticated caller (see _rate_limited below) —
    same in-memory sliding-window pattern already used by
    app/routes/promo_codes.py's _rate_limit. This backend runs with
    numReplicas=1 (railway.json), so in-process state is safe; no
    Redis/shared-cache dependency needed.
  * Email-only. Phone lookup is intentionally out of scope — the User
    model has no phone column (see the phone-identity audit); adding
    one is a separate, later decision.

Matches desktop_auth.py's own stated privacy rule for its /start
endpoint: "Never surfaces whether the email is registered (privacy ·
anti-enumeration)." — this endpoint follows the same discipline.
"""

from __future__ import annotations

import time
from collections import deque
from threading import Lock
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.models import User

router = APIRouter(prefix="/me", tags=["contact-check"])

# ── Rate limit ──────────────────────────────────────────────────────────
# Keyed by the AUTHENTICATED caller's user id (not IP) — this endpoint
# already requires auth, so the caller's own identity is the right key.
# 20 lookups/minute is generous for one user checking contacts one at a
# time through the native picker, but tight enough to blunt a scripted
# enumeration pass through many emails.
_RATE_LIMIT_WINDOW_SECONDS = 60
_RATE_LIMIT_MAX_HITS = 20
_rate_hits: dict[str, deque[float]] = {}
_rate_lock = Lock()


def _rate_limited(user_id: str) -> bool:
    """Returns True if the call should be rejected (limit exceeded)."""
    now = time.monotonic()
    cutoff = now - _RATE_LIMIT_WINDOW_SECONDS
    with _rate_lock:
        dq = _rate_hits.setdefault(user_id, deque())
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= _RATE_LIMIT_MAX_HITS:
            return True
        dq.append(now)
        return False


class ContactCheckIn(BaseModel):
    email: EmailStr


class ContactCheckOut(BaseModel):
    is_user: bool


@router.post("/contact-check", response_model=ContactCheckOut)
def contact_check(
    body: ContactCheckIn,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ContactCheckOut:
    if _rate_limited(user.id):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "too many lookups — try again shortly",
        )

    # Same normalize-then-case-insensitive-match convention already used
    # for existing-row lookups elsewhere (auth_clerk_exchange.py,
    # desktop.py): strip whitespace, match case-insensitively rather than
    # relying on every stored row already being lowercased.
    email = body.email.strip()
    exists = db.query(User.id).filter(User.email.ilike(email)).first() is not None
    return ContactCheckOut(is_user=exists)
