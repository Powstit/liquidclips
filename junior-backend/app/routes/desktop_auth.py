"""Desktop-only backend-owned OTP sign-in · Recovery brief 2026-07-08.

Daniel's directive: "Make login brutally simple." The Clerk OTP path had
too many failure modes (origin config, publishable key baking, the
"signed-out" toast fighting with in-progress activation, etc). This is
the replacement · two POSTs, no client SDK, no dependency on Clerk being
present or configured.

Flow:
    1. Frontend POSTs {email} to /desktop/auth/start
    2. Backend generates a 6-digit code, stores its sha256 hash with a
       10-minute TTL, sends the email via Resend.
    3. Frontend POSTs {email, code} to /desktop/auth/verify
    4. Backend verifies hash, mints an Ed25519 license JWT keyed to the
       user's tier (creates a User row on first sign-in), returns
       {license_jwt, tier, expires_at}.
    5. Frontend stores JWT via authStorage.setJwt + emits `auth:signed-in`.

Rate limits (in DB via the code row):
    - One code per email per 60 seconds
    - Max 5 verify attempts per code
    - Codes expire after 10 minutes

Idempotency: repeated POST /start within the rate-limit window returns
{"ok": true, "sent": false, "retry_after_sec": N} · never leaks whether
the email already has a code queued.

No PII beyond the email is logged. Codes are never logged (only hashes).
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import text as _text
from sqlalchemy.orm import Session

from app.db import engine, get_db
from app.jwt_signer import issue_license_jwt
from app.mailer import send_desktop_auth_code
from app.models import User

log = logging.getLogger("junior.desktop-auth")

router = APIRouter(prefix="/desktop/auth", tags=["desktop-auth"])

CODE_TTL_MINUTES = 10
RATE_LIMIT_SEND_INTERVAL_SEC = 60
RATE_LIMIT_ATTEMPT_MAX = 5


class StartRequest(BaseModel):
    email: EmailStr


class VerifyRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)

    @field_validator("code")
    @classmethod
    def _digits_only(cls, v: str) -> str:
        v = v.strip()
        if not v.isdigit():
            raise ValueError("code must be 6 digits")
        return v


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


@router.post("/start")
def start_auth(body: StartRequest) -> dict[str, object]:
    """Send a 6-digit sign-in code to the email.

    IRON GATE IG-OTP-B · 2026-07-19 · Response schema is HONEST.

    Returns (successful send):
      {"ok": true, "sent": true, "resend_id": "<id>", "send_ms": <int>}
    Returns (rate-limited · unchanged from prior contract):
      {"ok": true, "sent": false, "retry_after_sec": N, "reason": "rate_limited"}
    Returns (Resend timed out / errored):
      {"ok": true, "sent": false, "resend_error": "timeout"|"resend_error"|"no_api_key", "send_ms": <int>}

    NOTE (regression guard, see feedback_never_regress_4_layer_defense.md):
    the response used to be a bare `{"ok": true, "sent": true}` regardless
    of whether Resend actually accepted the payload. Users hit "login failed"
    5 min before the code arrived because the frontend advanced blindly on
    that lie. The response now reflects reality. If you're editing this
    endpoint and about to hardcode `sent: true` again — stop and read the
    memory file.

    Never surfaces whether the email is registered (privacy · anti-enumeration).
    """
    email = body.email.lower().strip()
    now = _now()

    with engine.begin() as conn:
        # Rate limit · reject if a code was created within the last 60s
        recent = conn.execute(
            _text(
                "SELECT created_at FROM desktop_auth_codes "
                "WHERE email = :email ORDER BY created_at DESC LIMIT 1"
            ),
            {"email": email},
        ).fetchone()
        if recent:
            recent_ts = recent[0]
            # SQLite returns TIMESTAMP columns as ISO strings · Postgres
            # returns them as datetime. Convert-if-string keeps local dev
            # (SQLite) working without touching the Postgres prod path.
            if isinstance(recent_ts, str):
                recent_ts = datetime.fromisoformat(recent_ts.replace(" ", "T").rstrip("Z"))
            if recent_ts.tzinfo is None:
                recent_ts = recent_ts.replace(tzinfo=timezone.utc)
            elapsed = (now - recent_ts).total_seconds()
            if elapsed < RATE_LIMIT_SEND_INTERVAL_SEC:
                return {
                    "ok": True,
                    "sent": False,
                    "retry_after_sec": int(RATE_LIMIT_SEND_INTERVAL_SEC - elapsed),
                    "reason": "rate_limited",
                }

        # Generate + store
        code = f"{secrets.randbelow(1_000_000):06d}"
        code_hash = _hash_code(code)
        expires_at = now + timedelta(minutes=CODE_TTL_MINUTES)
        conn.execute(
            _text(
                "INSERT INTO desktop_auth_codes "
                "  (email, code_hash, created_at, expires_at, attempt_count) "
                "VALUES (:email, :hash, :now, :expires, 0)"
            ),
            {"email": email, "hash": code_hash, "now": now, "expires": expires_at},
        )

    # IG-OTP-B · blocking send with 3s cap · returns real delivery status.
    # DO NOT swap this for `_async(...)` or wrap in a try/except that
    # discards the return value · that's the exact regression this iron
    # gate exists to prevent.
    result = send_desktop_auth_code(email, code)

    if result.ok:
        return {
            "ok": True,
            "sent": True,
            "resend_id": result.resend_id,
            "send_ms": result.send_ms,
        }
    # Honest failure surface · frontend uses this to show a real error
    # instead of advancing to code entry as if the send succeeded.
    log.warning(
        "[desktop-auth] send failed email=%s… error=%s send_ms=%d",
        email[:5], result.error, result.send_ms,
    )
    return {
        "ok": True,
        "sent": False,
        "resend_error": result.error or "unknown",
        "send_ms": result.send_ms,
    }


@router.post("/verify")
def verify_auth(
    body: VerifyRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    """Verify the 6-digit code and issue a license JWT.

    Response body:
        {"ok": true, "license_jwt": "...", "tier": "clipper|solo|pro|agency",
         "expires_at": "2026-08-07T20:00:00Z"}

    Errors are honest:
      400 · "We never sent a code to this email · request a fresh sign-in code"
      400 · "That code was already used · request a fresh sign-in code"
      400 · "That code expired · request a fresh sign-in code"
      400 · "Incorrect code"
      429 · "Too many failed attempts · request a fresh sign-in code"

    2026-07-16 · the three "no active code" causes (never sent / expired /
    already consumed) used to share one generic message, which made a
    real user-reported login failure impossible to diagnose after the
    fact. The distinguishing lookup below only runs on this failure path
    (zero cost to the happy path) and never touches the code or its hash
    — just timestamps already visible to whoever owns this row.
    """
    email = body.email.lower().strip()
    code_hash = _hash_code(body.code)
    now = _now()

    # Two-phase verify to survive a JWT-mint failure without burning the
    # code · look up + validate first (no writes), only mark consumed
    # AFTER we've successfully minted the JWT. If mint fails the user can
    # retry the same code within its TTL.
    with engine.connect() as conn:
        row = conn.execute(
            _text(
                "SELECT id, code_hash, expires_at, attempt_count "
                "  FROM desktop_auth_codes "
                " WHERE email = :email "
                "   AND consumed_at IS NULL "
                "   AND expires_at > :now "
                " ORDER BY created_at DESC LIMIT 1"
            ),
            {"email": email, "now": now},
        ).mappings().first()

    if not row:
        with engine.connect() as conn:
            latest = conn.execute(
                _text(
                    "SELECT consumed_at, expires_at "
                    "  FROM desktop_auth_codes "
                    " WHERE email = :email "
                    " ORDER BY created_at DESC LIMIT 1"
                ),
                {"email": email},
            ).mappings().first()
        if latest is None:
            detail = "We never sent a code to this email · request a fresh sign-in code"
        elif latest["consumed_at"] is not None:
            detail = "That code was already used · request a fresh sign-in code"
        else:
            detail = "That code expired · request a fresh sign-in code"
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail)

    if (row["attempt_count"] or 0) >= RATE_LIMIT_ATTEMPT_MAX:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many failed attempts · request a fresh sign-in code",
        )

    if row["code_hash"] != code_hash:
        with engine.begin() as conn:
            conn.execute(
                _text(
                    "UPDATE desktop_auth_codes "
                    "   SET attempt_count = attempt_count + 1 "
                    " WHERE id = :id"
                ),
                {"id": row["id"]},
            )
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Incorrect code")

    # Find or create the user.
    # 2026-07-10 · resilient to duplicate rows on the same email. Daniel
    # hit MultipleResultsFound in prod when his Clerk-seeded row +
    # admin-seed row both matched `.one_or_none()` and threw a 500. The
    # OTP verify user-lookup now picks the MOST RECENT row (higher tier
    # = admin-seed wins over first-touch Clerk row in practice), so
    # login always succeeds even when e-mail uniqueness slips.
    user = (
        db.query(User)
        .filter(User.email == email)
        .order_by(User.created_at.desc().nullslast(), User.id.desc())
        .first()
    )
    if user is None:
        # New user · synthetic clerk_id so the NOT NULL / UNIQUE column
        # constraint is respected. If this email later signs up through
        # Clerk, the webhook can adopt the clerk_id via the affiliate
        # linkback path (User.email is our real key).
        synthetic_clerk_id = f"lc-desktop-otp-{uuid4().hex}"
        user = User(
            clerk_id=synthetic_clerk_id,
            email=email,
            tier="free",
            subscription_status="trial",
        )
        db.add(user)
        db.flush()

    tier = user.tier or "free"
    # User.id is a String primary key populated from uuid4().hex ·
    # already a plain str. Do NOT call .hex again.
    jwt_str, expires_at = issue_license_jwt(
        user_id=str(user.id),
        tier=tier,
        founder=bool(getattr(user, "founder_flag", False)),
        platform_role=getattr(user, "platform_role", "none") or "none",
    )

    # JWT minted OK · now consume the code (single-use).
    # Route the consume UPDATE through the Session's connection so it
    # commits atomically with any user-row creation above. Using
    # engine.begin() here opens a second write connection · under
    # SQLite that deadlocks against the Session's held transaction,
    # and under Postgres it would still leave a two-phase window where
    # a JWT could ship without the consume landing. One transaction,
    # both writes, or neither.
    db.execute(
        _text(
            "UPDATE desktop_auth_codes "
            "   SET consumed_at = :now "
            " WHERE id = :id"
        ),
        {"now": now, "id": row["id"]},
    )
    db.commit()

    return {
        "ok": True,
        "license_jwt": jwt_str,
        "tier": tier,
        "expires_at": expires_at.isoformat(),
        "email": email,
    }
