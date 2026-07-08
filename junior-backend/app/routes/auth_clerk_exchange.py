"""Clerk session → Liquid Clips license JWT exchange.

P0 first-run access · 2026-07-08 · replaces the pre-existing "paste
LC-ID" first-touch flow with Clerk OTP (email + optional SMS). Clerk
already owns identity + OTP delivery on the account; this endpoint is
the last hop from Clerk auth to a Liquid Clips license the desktop app
speaks natively.

Routes:
  POST /auth/clerk/exchange       - PUBLIC · Clerk session JWT → LC JWT
  POST /admin/dev-issue-license   - INTERNAL-SECRET + env-gated · ops
                                    helper to mint an LC JWT for an
                                    admin email (Daniel's laptop) without
                                    going through Clerk OTP.

Verification model:
  1. Decode the Clerk session token header for `kid`.
  2. Fetch Clerk JWKS (cached in-process, 30min TTL).
  3. Verify RS256 signature + issuer + expiry.
  4. Extract `sub` = Clerk user id.
  5. Fetch the user record from Clerk backend API (secret-key auth) to
     get the authoritative email + primary email verification status.
  6. Upsert Liquid Clips User row by clerk_id · mint LC license JWT.

Never trust client-supplied user metadata. Never log the Clerk token.
Never log the minted LC JWT. Never fall back to unverified decode.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone
from typing import Annotated, Any
from uuid import uuid4

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from jwt import PyJWKClient
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import require_internal_secret
from app.jwt_signer import issue_license_jwt
from app.models import User

log = logging.getLogger("junior.auth_clerk_exchange")

router = APIRouter(tags=["auth"])

# ─── JWKS cache ──────────────────────────────────────────────────────────
_JWKS_CACHE: dict[str, tuple[PyJWKClient, float]] = {}
_JWKS_TTL_SECONDS = 30 * 60


def _clerk_jwks_url() -> str:
    """Clerk's JWKS lives on the Frontend API domain. The env var
    ``CLERK_FRONTEND_API_URL`` overrides · falls back to a canonical
    hosted domain when unset (dev instance)."""
    url = os.environ.get("CLERK_FRONTEND_API_URL", "").strip().rstrip("/")
    if not url:
        # Some accounts use api.clerk.com/v1/jwks with backend secret;
        # public JWKS route on the frontend URL is the modern default.
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "clerk auth misconfigured · CLERK_FRONTEND_API_URL unset",
        )
    return f"{url}/.well-known/jwks.json"


def _jwks_client() -> PyJWKClient:
    """Cached PyJWKClient · re-fetches JWKS every _JWKS_TTL_SECONDS."""
    url = _clerk_jwks_url()
    now = time.monotonic()
    cached = _JWKS_CACHE.get(url)
    if cached and (now - cached[1]) < _JWKS_TTL_SECONDS:
        return cached[0]
    client = PyJWKClient(url, cache_keys=True, lifespan=_JWKS_TTL_SECONDS)
    _JWKS_CACHE[url] = (client, now)
    return client


# ─── clerk backend API user fetch ────────────────────────────────────────
def _clerk_get_user(clerk_user_id: str) -> dict[str, Any]:
    settings = get_settings()
    secret = getattr(settings, "clerk_secret_key", "") or ""
    if not secret:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "clerk auth misconfigured · CLERK_SECRET_KEY unset",
        )
    try:
        r = httpx.get(
            f"https://api.clerk.com/v1/users/{clerk_user_id}",
            headers={"Authorization": f"Bearer {secret}"},
            timeout=6.0,
        )
    except httpx.RequestError as e:
        log.warning("[clerk-exchange] user fetch network error · %s", e.__class__.__name__)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "clerk backend unreachable",
        )
    if r.status_code == 404:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "clerk user not found")
    if r.status_code != 200:
        log.warning("[clerk-exchange] user fetch non-200 · status=%s", r.status_code)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "clerk backend returned error",
        )
    return r.json()


def _primary_email(clerk_user: dict[str, Any]) -> str | None:
    """Extract the primary email address · fails closed if not verified."""
    primary_id = clerk_user.get("primary_email_address_id")
    addresses = clerk_user.get("email_addresses") or []
    for addr in addresses:
        if addr.get("id") == primary_id:
            # Only trust verified addresses. Verification status is at
            # `verification.status == "verified"`.
            verif = addr.get("verification") or {}
            if verif.get("status") == "verified":
                return (addr.get("email_address") or "").strip().lower() or None
            return None
    return None


# ─── LC user upsert ──────────────────────────────────────────────────────
def _upsert_lc_user(db: Session, clerk_user_id: str, email: str) -> User:
    """Idempotent upsert keyed by clerk_id · falls back to email match
    when a legacy row (email-only, pre-Clerk) exists so we don't create
    a duplicate.

    ``users.clerk_id`` has a UNIQUE constraint (models.py:31) so the
    race window between check + insert is closed by the DB level.
    """
    from sqlalchemy.exc import IntegrityError

    for _attempt in range(3):
        existing = db.query(User).filter(User.clerk_id == clerk_user_id).first()
        if existing:
            return existing
        # No row for this clerk_id yet. Legacy row-by-email merge · if a
        # prior LC-ID or Whop flow created a row for the same email, take
        # it over instead of duplicating.
        legacy = db.query(User).filter(User.email.ilike(email)).first()
        if legacy:
            legacy.clerk_id = clerk_user_id
            db.commit()
            db.refresh(legacy)
            log.info(
                "[clerk-exchange] merged legacy row · user_id=%s email=%s",
                legacy.id, email,
            )
            return legacy
        # Fresh user · tier=free · MembershipGate handles Whop upsell.
        new_user = User(
            id=uuid4().hex,
            clerk_id=clerk_user_id,
            email=email,
            tier="free",
            subscription_status="inactive",
        )
        db.add(new_user)
        try:
            db.commit()
            log.info(
                "[clerk-exchange] created user · user_id=%s clerk_id=%s email=%s",
                new_user.id, clerk_user_id, email,
            )
            return new_user
        except IntegrityError:
            db.rollback()
            log.info("[clerk-exchange] insert race · retrying · clerk_id=%s", clerk_user_id)
            continue

    raise HTTPException(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        "user creation contended · try again",
    )


# ─── exchange endpoint ───────────────────────────────────────────────────
class ClerkExchangeRequest(BaseModel):
    clerk_session_token: str


class ClerkExchangeResponse(BaseModel):
    license_jwt: str


@router.post("/auth/clerk/exchange", response_model=ClerkExchangeResponse)
def clerk_exchange(
    body: ClerkExchangeRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> ClerkExchangeResponse:
    """Verify a Clerk session token and mint a Liquid Clips license JWT.

    Public endpoint. Token comes from the desktop client's Clerk SDK
    (`getToken()` after email/SMS OTP verify). Signature verified via
    Clerk JWKS · email verified server-side against Clerk backend API.
    """
    token = (body.clerk_session_token or "").strip()
    if not token or len(token) < 32:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "token missing")

    try:
        client = _jwks_client()
        signing_key = client.get_signing_key_from_jwt(token)
        decoded = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            # Clerk sets `iss` to the frontend API URL. Verify against
            # the same env we sourced JWKS from · defends against a
            # cross-instance token replay if we ever migrate accounts.
            issuer=os.environ.get("CLERK_FRONTEND_API_URL", "").strip().rstrip("/") or None,
            options={
                "require": ["exp", "iat", "sub", "iss"],
                "verify_aud": False,  # Clerk tokens are audience-less by default.
            },
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "session token expired")
    except jwt.InvalidIssuerError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "session token issuer mismatch")
    except (jwt.InvalidTokenError, Exception) as e:  # noqa: BLE001
        log.warning("[clerk-exchange] token verify failed · %s", e.__class__.__name__)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "session token invalid")

    clerk_user_id = decoded.get("sub")
    if not clerk_user_id or not isinstance(clerk_user_id, str):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "session token missing sub")

    # Fetch authoritative user record from Clerk backend API.
    clerk_user = _clerk_get_user(clerk_user_id)
    email = _primary_email(clerk_user)
    if not email:
        # OTP flow requires a verified email · reject soft-verified users.
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "primary email not verified",
        )

    user = _upsert_lc_user(db, clerk_user_id, email)
    jwt_str, expires_at = issue_license_jwt(
        user_id=user.id,
        tier=user.tier,
        founder=bool(getattr(user, "founder_flag", False)),
        platform_role=getattr(user, "platform_role", None) or "none",
    )
    log.info(
        "[clerk-exchange] ok · user=%s tier=%s exp=%s",
        user.id, user.tier, expires_at.isoformat(),
    )
    return ClerkExchangeResponse(license_jwt=jwt_str)


# ─── admin dev-issue license (E) ─────────────────────────────────────────
def _dev_issue_enabled() -> bool:
    v = os.environ.get("LC_DEV_ISSUE_LICENSE_ENABLED", "").strip().lower()
    return v in {"1", "true", "yes", "on"}


class DevIssueLicenseRequest(BaseModel):
    email: str


class DevIssueLicenseResponse(BaseModel):
    license_jwt: str
    user_id: str
    tier: str
    expires_at: str


@router.post("/admin/dev-issue-license", response_model=DevIssueLicenseResponse)
def dev_issue_license(
    body: DevIssueLicenseRequest,
    db: Annotated[Session, Depends(get_db)],
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
) -> DevIssueLicenseResponse:
    """Ops-only: mint an LC JWT for an existing admin user by email.

    Two gates on top of the router:
      1. `x-internal-secret` header (already enforced by dependency)
      2. `LC_DEV_ISSUE_LICENSE_ENABLED=1` env var

    NOT a customer path. Refuses to mint if the email is not in the
    admin allowlist (features.is_admin_email) · ops laptops for Daniel
    only. Not a permanent bypass · toggle the env flag off after use.

    Never logs the minted JWT.
    """
    if not _dev_issue_enabled():
        raise HTTPException(status.HTTP_403_FORBIDDEN, "dev-issue disabled")

    from app.features import is_admin_email  # local import · avoid boot cycle

    email_clean = (body.email or "").strip().lower()
    if "@" not in email_clean or not is_admin_email(email_clean):
        # Same 403 either way · don't enumerate admin membership.
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not eligible")

    user = db.query(User).filter(User.email.ilike(email_clean)).first()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user row missing")

    jwt_str, expires_at = issue_license_jwt(
        user_id=user.id,
        tier=user.tier,
        founder=bool(getattr(user, "founder_flag", False)),
        platform_role=getattr(user, "platform_role", None) or "none",
    )
    log.info(
        "[dev-issue-license] ok · admin_email=%s user_id=%s tier=%s exp=%s",
        email_clean, user.id, user.tier, expires_at.isoformat(),
    )
    return DevIssueLicenseResponse(
        license_jwt=jwt_str,
        user_id=user.id,
        tier=user.tier,
        expires_at=expires_at.isoformat(),
    )
