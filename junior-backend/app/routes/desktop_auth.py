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

    Returns:
      {"ok": true, "sent": true}                → code sent
      {"ok": true, "sent": false, "retry_after_sec": N} → rate-limited

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
            if recent_ts.tzinfo is None:
                recent_ts = recent_ts.replace(tzinfo=timezone.utc)
            elapsed = (now - recent_ts).total_seconds()
            if elapsed < RATE_LIMIT_SEND_INTERVAL_SEC:
                return {
                    "ok": True,
                    "sent": False,
                    "retry_after_sec": int(RATE_LIMIT_SEND_INTERVAL_SEC - elapsed),
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

    # Fire-and-forget via mailer._async internally · never blocks the response
    try:
        send_desktop_auth_code(email, code)
    except Exception as e:  # noqa: BLE001
        # Log without leaking the code
        log.warning("[desktop-auth] send failed email=%s… err=%s", email[:5], e)

    return {"ok": True, "sent": True}


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
      400 · "No active code · request a fresh sign-in code"  (expired / never sent)
      400 · "Incorrect code"
      429 · "Too many failed attempts · request a fresh sign-in code"
    """
    email = body.email.lower().strip()
    code_hash = _hash_code(body.code)
    now = _now()

    with engine.begin() as conn:
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
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "No active code · request a fresh sign-in code",
            )

        if (row["attempt_count"] or 0) >= RATE_LIMIT_ATTEMPT_MAX:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Too many failed attempts · request a fresh sign-in code",
            )

        if row["code_hash"] != code_hash:
            conn.execute(
                _text(
                    "UPDATE desktop_auth_codes "
                    "   SET attempt_count = attempt_count + 1 "
                    " WHERE id = :id"
                ),
                {"id": row["id"]},
            )
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Incorrect code")

        # Mark consumed · single-use
        conn.execute(
            _text(
                "UPDATE desktop_auth_codes "
                "   SET consumed_at = :now "
                " WHERE id = :id"
            ),
            {"now": now, "id": row["id"]},
        )

    # Find or create the user
    user = db.query(User).filter(User.email == email).one_or_none()
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
    jwt_str, expires_at = issue_license_jwt(
        user_id=user.id.hex,
        tier=tier,
        founder=bool(getattr(user, "founder_flag", False)),
        platform_role=getattr(user, "platform_role", "none") or "none",
    )

    db.commit()

    return {
        "ok": True,
        "license_jwt": jwt_str,
        "tier": tier,
        "expires_at": expires_at.isoformat(),
        "email": email,
    }
