"""Common FastAPI dependencies — license JWT auth, etc."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.jwt_signer import verify_license_jwt
from app.models import User


def license_claims(authorization: Annotated[str | None, Header()] = None) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    token = authorization.split(None, 1)[1].strip()
    try:
        return verify_license_jwt(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "license expired") from None
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"invalid license: {e}") from None


def current_user(
    claims: Annotated[dict, Depends(license_claims)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    user = db.get(User, claims["sub"])
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "license user not found")

    from app.features import is_admin_email
    is_admin = is_admin_email(user.email)

    # 2026-08-19 · pre-launch blockers #2 (auto-lock on failed payment)
    # + the banned_until enforcement gap. Both fields were previously
    # write-only — an admin ban or a payment failure changed the row but
    # nothing ever checked it, so neither actually locked anyone out.
    # Admins bypass both (they run moderation/support and must never be
    # able to lock themselves out).
    if not is_admin:
        now = datetime.now(timezone.utc)
        if user.banned_until is not None and user.banned_until > now:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail={
                    "reason": "account_banned",
                    "banned_until": user.banned_until.isoformat(),
                },
            )
        if user.payment_locked_at is not None:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail={
                    "reason": "payment_locked",
                    "locked_at": user.payment_locked_at.isoformat(),
                },
            )

    # Master-admin override — danieldiyepriye@gmail.com and any other email in
    # ADMIN_EMAILS (app/features.py) gets Autopilot+Founder regardless of what
    # Clerk billing says. We mutate the SQLAlchemy session object in-memory
    # only; nothing is committed, so the DB row stays the source of truth for
    # billing reconciliation. Every downstream `user.tier` / `user.founder_flag`
    # read sees the elevated values automatically.
    if is_admin:
        user.tier = "autopilot"
        user.founder_flag = True
        db.expunge(user)  # detach so SQLAlchemy never flushes the in-memory change

    return user


def require_internal_secret(
    x_internal_secret: Annotated[str | None, Header(alias="x-internal-secret")] = None,
) -> bool:
    """Gate server-to-server routes on the shared `x-internal-secret` header.

    Env-gated fail-closed replacement for the ``if settings.internal_api_secret
    and header != secret`` pattern that used to be inlined in every admin
    route. That pattern silently accepted requests when the secret env var
    was unset — production could ship misconfigured and expose HQ / runtime
    / stripe-connect / arcade-prize / promo-code endpoints to the internet.

    Behaviour:
      * production + missing env var → 500 (server misconfigured; the boot
        guard in ``main.lifespan`` refuses to start in this state, so this
        handler check is defense-in-depth for staging + preview envs that
        share ``env=production``)
      * non-production + missing env var → allow (dev/CI bypass, matches
        prior test contract; several tests exercise this path deliberately
        with ``monkeypatch.delenv("INTERNAL_API_SECRET")``)
      * secret set + missing / mismatched header → 401
      * secret set + match → returns True (constant-time compare via
        ``secrets.compare_digest`` blocks timing side-channels)

    Used as ``Depends(require_internal_secret)`` on each of the 14 admin
    routes.
    """
    import secrets as _secrets

    settings = get_settings()
    if not settings.internal_api_secret:
        if settings.env == "production":
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "server misconfigured · INTERNAL_API_SECRET unset",
            )
        return True  # non-production dev/CI bypass
    if not x_internal_secret or not _secrets.compare_digest(
        x_internal_secret, settings.internal_api_secret
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid internal secret")
    return True
