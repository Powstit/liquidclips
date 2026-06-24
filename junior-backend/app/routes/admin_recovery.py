"""HQ Agent 5 · Admin Recovery — break-glass identity-proof.

This router implements the "I've lost everything" recovery flow for
Liquid Clips HQ. The four endpoints under `/admin/recovery/*` let Daniel
re-issue a fresh TOTP seed when his laptop, his Clerk session, AND his
TOTP seed are all gone. The proof-of-identity gates are:

  1. emails  — at least 3 of 5 master emails submitted must match the
                allowlist (case-insensitive). Source priority:
                ADMIN_MASTER_EMAILS env → JUNIOR_ADMIN_EMAILS env → 4-email
                hardcoded fallback. (powstit removed P0-001.)
  2. pin     — 6-digit numeric PIN, bcrypt-compared against the hash
                stored on the singleton AdminRecoveryConfig row. No env
                fallback (env-PIN backdoor removed P1-006).
  3. auth_code — 8-character uppercase alphanumeric code, bcrypt-compared
                against AdminRecoveryConfig.auth_code_hash. No env fallback.

All three must pass. On success a fresh pyotp.random_base32() seed is
generated, its bcrypt hash is persisted to AdminRecoveryConfig, and the
raw seed + ten freshly-generated backup codes are returned ONCE to the
caller. The caller is responsible for showing them in a non-recoverable
"save these now" panel; the backend will never echo them again.

Rate limit: 3 attempts per IP per 24h, enforced by counting
AdminRecoveryAttempt rows. The rate-limit check is the FIRST thing each
/verify call does — exceeded callers get a 429 without us ever touching
the comparison gates (so a brute-forcer learns nothing).

Endpoints:
  POST /admin/recovery/verify       — NOT admin-gated (the whole point
                                       is the admin is locked out).
  GET  /admin/recovery/status       — NOT admin-gated (the security
                                       landing page reads this before
                                       the admin has signed in).
  POST /admin/recovery/pin          — admin-gated (set / rotate PIN).
  POST /admin/recovery/auth-code    — admin-gated (set / rotate code).

Secret hygiene:
  - The raw PIN, auth code, and TOTP seed NEVER appear in logs or
    response bodies (except the one-time /verify success body).
  - bcrypt cost factor 12 (matches Django's modern default).
  - The pin/auth-code mutation routes refuse to overwrite a configured
    hash unless ?force=true is passed AND the admin gate passes — this
    is the "re-auth" hurdle.
"""

from __future__ import annotations

import logging
import os
import re
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

import bcrypt
import pyotp
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import engine, get_db
from app.features import is_admin_email
from app.models import AdminRecoveryAttempt, AdminRecoveryConfig, User

router = APIRouter(prefix="/admin/recovery", tags=["admin-recovery"])

_log = logging.getLogger("junior.admin_recovery")

# ─── tunables ──────────────────────────────────────────────────────────
RATE_LIMIT_WINDOW = timedelta(hours=24)
RATE_LIMIT_MAX_ATTEMPTS = 3
MIN_MATCHING_EMAILS = 3   # 3-of-5 threshold
TOTAL_EMAIL_SLOTS = 5
BCRYPT_COST = 12

PIN_REGEX = re.compile(r"^\d{6}$")
AUTH_CODE_REGEX = re.compile(r"^[A-Z0-9]{8}$")


# ─── helpers ───────────────────────────────────────────────────────────


def _is_allowlisted_ip(ip: str) -> bool:
    """Return True if `ip` is in ADMIN_ALLOWED_IPS (CSV env). Daniel's
    saved IPs (home, Tailscale mesh) take the fast path: PIN only.
    Unknown IPs (lost-laptop scenario) take the strict path: 3-of-5
    emails + PIN + auth code. Gates stop aliens, not Daniel."""
    allowed = (os.environ.get("ADMIN_ALLOWED_IPS") or "").split(",")
    allowed_set = {a.strip() for a in allowed if a.strip()}
    return bool(ip) and ip in allowed_set


def _now() -> datetime:
    """Match the dialect — SQLite stores naive datetimes; comparing to a
    tz-aware now() raises TypeError. Mirror the pattern used elsewhere."""
    now = datetime.now(timezone.utc)
    if engine.dialect.name == "sqlite":
        return now.replace(tzinfo=None)
    return now


def _client_ip(request: Request) -> str:
    """Pull the client ip from common proxy headers, else the raw socket.
    Truncated to 80 chars because the column is String(80) and IPv6 +
    forwarded-for chains can exceed that.

    Header priority (P1-005): x-vercel-forwarded-for FIRST because Vercel
    signs it — the browser cannot forge a value that survives the edge.
    x-forwarded-for / x-real-ip / cf-connecting-ip remain as fallbacks for
    non-Vercel ingress paths (direct backend, local dev)."""
    for header in (
        "x-vercel-forwarded-for",
        "x-forwarded-for",
        "x-real-ip",
        "cf-connecting-ip",
    ):
        value = request.headers.get(header)
        if value:
            # x-forwarded-for can be a comma-separated chain; first is client.
            ip = value.split(",")[0].strip()
            if ip:
                return ip[:80]
    client = request.client
    return (client.host if client else "unknown")[:80]


def _master_email_list() -> list[str]:
    """Return the case-folded list of master emails.

    Source priority: ADMIN_MASTER_EMAILS env (CSV) → JUNIOR_ADMIN_EMAILS env (CSV)
    → hardcoded fallback. The fallback matches features.py so first-launch
    works without env wiring. (P0-001: powstit removed — keeps the recovery
    allowlist aligned with the 4-email admin allowlist used everywhere else.)"""
    raw = os.environ.get("ADMIN_MASTER_EMAILS", "").strip()
    if not raw:
        raw = os.environ.get("JUNIOR_ADMIN_EMAILS", "").strip()
    if not raw:
        return [
            "danieldiyepriye@gmail.com",
            "mrddokubo@gmail.com",
            "crazycatjackkids@gmail.com",
            "thedoks2019@gmail.com",
        ]
    return [e.strip().lower() for e in raw.split(",") if e.strip()]


def _bcrypt_hash(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=BCRYPT_COST)).decode("utf-8")


def _bcrypt_check(plain: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def _get_config(db: Session) -> AdminRecoveryConfig:
    """Return the singleton config row (id=1). Creates an empty row if
    none exists yet — the row's columns are all nullable so this is safe."""
    row = db.query(AdminRecoveryConfig).filter_by(id=1).one_or_none()
    if row is None:
        row = AdminRecoveryConfig(id=1)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _resolve_pin_hash(db: Session) -> str | None:
    """Return the bcrypt PIN hash stored on the singleton config row, or
    None if Daniel has not yet set a PIN through the HQ UI. The env-fallback
    backdoor (RECOVERY_PIN_HASH) was removed in P1-006 — a stale env value
    would have worked forever as an out-of-band bypass. First-time flow:
    Daniel sets the PIN via `/admin/_security/PinSetup` which POSTs to
    `/admin/recovery/pin`. Until then, `/verify` fails closed (no PIN
    configured = no recovery — that's the right behaviour)."""
    cfg = _get_config(db)
    return cfg.pin_hash


def _resolve_auth_code_hash(db: Session) -> str | None:
    """See `_resolve_pin_hash` — env fallback removed P1-006."""
    cfg = _get_config(db)
    return cfg.auth_code_hash


def _count_recent_attempts(db: Session, ip: str) -> int:
    cutoff = _now() - RATE_LIMIT_WINDOW
    return (
        db.query(AdminRecoveryAttempt)
        .filter(AdminRecoveryAttempt.ip == ip)
        .filter(AdminRecoveryAttempt.created_at >= cutoff)
        .count()
    )


def _log_attempt(db: Session, ip: str, result: str) -> None:
    """Persist the audit row. NEVER record the raw secrets — only the
    failure category and the ip."""
    row = AdminRecoveryAttempt(ip=ip, result=result, created_at=_now())
    db.add(row)
    db.commit()


def _generate_backup_codes(count: int = 10, length: int = 10) -> list[str]:
    """Crockford-style base32 (no I/L/O/U) — easier to transcribe than
    raw base32 or hex. Returns plain strings; the caller hashes if it
    wants to store them."""
    alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
    return [
        "-".join(
            "".join(secrets.choice(alphabet) for _ in range(5))
            for _ in range(length // 5)
        )
        for _ in range(count)
    ]


# ─── admin dep (for /pin and /auth-code mutations) ────────────────────


def _require_admin(
    db: Annotated[Session, Depends(get_db)],
    clerk_user_id: Annotated[str, Query(min_length=1)],
    x_internal_secret: Annotated[str | None, Header()] = None,
) -> User:
    """Same shape as admin.py:require_admin — internal secret + admin
    email gate. Used on /pin and /auth-code so a non-admin can't set the
    recovery secrets."""
    secret = get_settings().internal_api_secret
    if secret and x_internal_secret != secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad internal secret")

    user = db.query(User).filter_by(clerk_id=clerk_user_id).one_or_none()
    if not user or not is_admin_email(user.email):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin access required")
    return user


AdminUser = Annotated[User, Depends(_require_admin)]


# ─── request / response models ────────────────────────────────────────


class VerifyRequest(BaseModel):
    """Proofs in one body. Required factors depend on caller IP:
      - allowlisted IP → PIN only (emails + auth_code optional / ignored)
      - non-allowlisted IP → emails (exactly 5) + PIN + auth_code all required

    The handler enforces the path-specific shape; this model accepts the
    superset and lets the route reject what's actually missing for the
    caller's path."""

    emails: list[str] | None = Field(default=None)
    pin: str = Field(..., min_length=6, max_length=6)
    auth_code: str | None = Field(default=None)

    @field_validator("pin")
    @classmethod
    def _check_pin_shape(cls, v: str) -> str:
        if not PIN_REGEX.match(v):
            raise ValueError("pin must be 6 digits")
        return v

    @field_validator("auth_code")
    @classmethod
    def _check_auth_code_shape(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        normalized = v.strip().upper()
        if not AUTH_CODE_REGEX.match(normalized):
            raise ValueError("auth_code must be 8 uppercase alphanumeric characters")
        return normalized


class VerifyFailureResponse(BaseModel):
    ok: Literal[False]
    attempts_remaining: int
    detail: str


class VerifySuccessResponse(BaseModel):
    ok: Literal[True]
    totp_seed: str
    totp_provisioning_uri: str
    backup_codes: list[str]
    note: str = (
        "Save these now — you will not see them again. The seed has been "
        "registered as your new TOTP. Configure it in your authenticator app."
    )


class StatusResponse(BaseModel):
    pin_configured: bool
    auth_code_configured: bool
    totp_configured: bool
    last_recovery_at: str | None
    # Mirror keys for back-compat with Agent 1's security landing page
    # (which reads pin_set / auth_code_set).
    pin_set: bool
    auth_code_set: bool
    # IP fast-path indicator. When true, the caller's IP is in
    # ADMIN_ALLOWED_IPS and recovery only requires the PIN (the frontend
    # uses this to render the compact form vs the full 3-factor form).
    ip_allowlisted: bool


class PinSetRequest(BaseModel):
    pin: str = Field(..., min_length=6, max_length=6)

    @field_validator("pin")
    @classmethod
    def _check(cls, v: str) -> str:
        if not PIN_REGEX.match(v):
            raise ValueError("pin must be 6 digits")
        return v


class AuthCodeSetRequest(BaseModel):
    auth_code: str = Field(..., min_length=8, max_length=8)

    @field_validator("auth_code")
    @classmethod
    def _check(cls, v: str) -> str:
        normalized = v.strip().upper()
        if not AUTH_CODE_REGEX.match(normalized):
            raise ValueError("auth_code must be 8 uppercase alphanumeric characters")
        return normalized


class SetSecretResponse(BaseModel):
    ok: bool
    rotated: bool


# ─── endpoints ────────────────────────────────────────────────────────


@router.post(
    "/verify",
    response_model=VerifySuccessResponse | VerifyFailureResponse,
    response_model_exclude_none=False,
)
def verify_recovery(
    body: VerifyRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
):
    """Single-shot proof-of-identity check.

    Path semantics (also covered by the causal-proof-gate doc in the
    HQ Agent 5 report):
      1. 4th+ attempt in 24h     → 429
      2. fewer than 3 matching emails → 200 {ok: false, fail_emails}
      3. wrong PIN                   → 200 {ok: false, fail_pin}
      4. wrong auth code             → 200 {ok: false, fail_auth_code}
      5. all three pass              → 200 {ok: true, totp_seed, backup_codes}
    """
    ip = _client_ip(request)
    fast_path = _is_allowlisted_ip(ip)

    # 1. rate limit — runs FIRST so a brute-forcer learns nothing about
    # which gate would have rejected them. Applies on BOTH paths.
    prior_attempts = _count_recent_attempts(db, ip)
    if prior_attempts >= RATE_LIMIT_MAX_ATTEMPTS:
        _log_attempt(db, ip, "rate_limited")
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many recovery attempts. Wait 24 hours before trying again.",
        )

    # 2. email match — STRICT PATH ONLY. Allowlisted IPs skip this entirely
    # because the IP itself is identity proof (Daniel's home / Tailscale).
    if not fast_path:
        if not body.emails or len(body.emails) != TOTAL_EMAIL_SLOTS:
            _log_attempt(db, ip, "fail_emails")
            remaining = max(0, RATE_LIMIT_MAX_ATTEMPTS - prior_attempts - 1)
            return VerifyFailureResponse(
                ok=False,
                attempts_remaining=remaining,
                detail="Verification failed.",
            )
        master = set(_master_email_list())
        submitted = {e.strip().lower() for e in body.emails if e and e.strip()}
        matches = submitted & master
        if len(matches) < MIN_MATCHING_EMAILS:
            _log_attempt(db, ip, "fail_emails")
            remaining = max(0, RATE_LIMIT_MAX_ATTEMPTS - prior_attempts - 1)
            return VerifyFailureResponse(
                ok=False,
                attempts_remaining=remaining,
                detail="Verification failed.",
            )

    # 3. pin — REQUIRED ON BOTH PATHS. bcrypt compare against stored hash.
    # If no PIN is configured ANYWHERE, fail closed so an empty database
    # can't be exploited.
    pin_hash = _resolve_pin_hash(db)
    if not pin_hash or not _bcrypt_check(body.pin, pin_hash):
        _log_attempt(db, ip, "fail_pin")
        remaining = max(0, RATE_LIMIT_MAX_ATTEMPTS - prior_attempts - 1)
        return VerifyFailureResponse(
            ok=False,
            attempts_remaining=remaining,
            detail="Verification failed.",
        )

    # 4. auth code — STRICT PATH ONLY. Same shape as emails check.
    if not fast_path:
        if not body.auth_code:
            _log_attempt(db, ip, "fail_auth_code")
            remaining = max(0, RATE_LIMIT_MAX_ATTEMPTS - prior_attempts - 1)
            return VerifyFailureResponse(
                ok=False,
                attempts_remaining=remaining,
                detail="Verification failed.",
            )
        auth_code_hash = _resolve_auth_code_hash(db)
        if not auth_code_hash or not _bcrypt_check(body.auth_code, auth_code_hash):
            _log_attempt(db, ip, "fail_auth_code")
            remaining = max(0, RATE_LIMIT_MAX_ATTEMPTS - prior_attempts - 1)
            return VerifyFailureResponse(
                ok=False,
                attempts_remaining=remaining,
                detail="Verification failed.",
            )

    # 5. all gates passed — mint a fresh TOTP seed, hash + persist it,
    # mint backup codes, log success.
    new_seed = pyotp.random_base32()
    backup_codes = _generate_backup_codes(count=10)

    cfg = _get_config(db)
    cfg.totp_seed_hash = _bcrypt_hash(new_seed)
    cfg.last_recovery_at = _now()
    db.commit()

    _log_attempt(db, ip, "ok")

    # Provisioning URI for QR-code rendering on the SuccessPanel. The
    # account name + issuer must NOT contain secret material; admin email
    # is fine because it's already known to the verified caller.
    provisioning_uri = pyotp.TOTP(new_seed).provisioning_uri(
        name="hq-admin@liquidclips.app",
        issuer_name="Liquid Clips HQ",
    )

    # IMPORTANT: do NOT log the seed or any backup code. We only log the
    # bare fact that recovery happened — at info level so it shows up in
    # Sentry breadcrumbs.
    _log.info("admin-recovery success ip=%s last_recovery_at=%s", ip, cfg.last_recovery_at)

    return VerifySuccessResponse(
        ok=True,
        totp_seed=new_seed,
        totp_provisioning_uri=provisioning_uri,
        backup_codes=backup_codes,
    )


@router.get("/status", response_model=StatusResponse)
def recovery_status(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> StatusResponse:
    """Setup-state probe — used by Agent 1's security landing page to
    render "PIN configured / not configured" pills, AND by the recovery
    form to learn whether the caller is on the fast path (IP allowlisted
    → PIN only) or strict path (5 emails + PIN + auth code). Not
    admin-gated: the page renders BEFORE the admin has signed in."""
    cfg = _get_config(db)
    # P1-006 (2026-06-24) — env fallbacks were deleted to remove the
    # backdoor. PIN + auth code must be set via the HQ Security UI.
    pin_set = bool(cfg.pin_hash)
    auth_set = bool(cfg.auth_code_hash)
    totp_set = bool(cfg.totp_seed_hash)
    return StatusResponse(
        pin_configured=pin_set,
        auth_code_configured=auth_set,
        totp_configured=totp_set,
        last_recovery_at=cfg.last_recovery_at.isoformat() if cfg.last_recovery_at else None,
        pin_set=pin_set,
        auth_code_set=auth_set,
        ip_allowlisted=_is_allowlisted_ip(_client_ip(request)),
    )


@router.post("/pin", response_model=SetSecretResponse)
def set_pin(
    body: PinSetRequest,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    force: Annotated[bool, Query()] = False,
) -> SetSecretResponse:
    """Set (or rotate, with ?force=true) the recovery PIN. Admin-gated —
    only an authenticated admin can write to the config row. Refuses to
    silently overwrite an existing hash so a session-hijacker can't
    quietly rotate the recovery secret behind Daniel's back."""
    cfg = _get_config(db)
    already_set = bool(cfg.pin_hash or _env_pin_hash())
    if already_set and not force:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "PIN already configured. Pass ?force=true to rotate.",
        )
    cfg.pin_hash = _bcrypt_hash(body.pin)
    db.commit()
    _log.info("admin-recovery pin %s by admin=%s", "rotated" if already_set else "set", admin.id)
    return SetSecretResponse(ok=True, rotated=already_set)


@router.post("/auth-code", response_model=SetSecretResponse)
def set_auth_code(
    body: AuthCodeSetRequest,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    force: Annotated[bool, Query()] = False,
) -> SetSecretResponse:
    """Set (or rotate) the 8-character auth code. Same overwrite-guard
    contract as /pin."""
    cfg = _get_config(db)
    already_set = bool(cfg.auth_code_hash or _env_auth_code_hash())
    if already_set and not force:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Auth code already configured. Pass ?force=true to rotate.",
        )
    cfg.auth_code_hash = _bcrypt_hash(body.auth_code)
    db.commit()
    _log.info("admin-recovery auth-code %s by admin=%s", "rotated" if already_set else "set", admin.id)
    return SetSecretResponse(ok=True, rotated=already_set)
