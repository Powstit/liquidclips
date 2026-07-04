"""Promo / discount code routes (2026-06-25).

Endpoints:
  POST /promo/validate                  — public (rate-limited per IP)
  POST /promo/apply                     — admin-internal (x-internal-secret)
  GET  /admin/promo                     — admin list
  POST /admin/promo                     — admin create
  POST /admin/promo/{code}/revoke       — admin revoke
  GET  /admin/promo/{code}/stats        — redemption stats

Public /promo/validate is allowed without auth (the discount code IS the
secret-of-knowledge) but is rate-limited 30 req / 5 min / IP to prevent
brute-force enumeration.

The admin endpoints reuse the same `require_admin` gate as routes/admin.py
so the existing Admin HQ proxy + email allowlist + internal secret apply
without divergence.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from datetime import datetime, timezone
from threading import Lock
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_internal_secret
from app.models import PromoCode, PromoCodeRedemption, User
from app.promo_engine import (
    StripeNotConfigured,
    ensure_stripe_coupon,
    normalize_code,
    parse_scopes,
    serialize_scopes,
    stripe_configured,
    validate,
)
from app.routes.admin import require_admin

logger = logging.getLogger("junior.promo")

# Public router — /promo/* (validate is public + rate-limited; apply is gated).
router = APIRouter(prefix="/promo", tags=["promo"])
# Admin router — /admin/promo/*. Mounted alongside the existing admin router
# in main.py. Re-uses the same require_admin dependency so the Admin HQ
# proxy + internal-secret + email-allowlist behaviour is identical.
admin_router = APIRouter(prefix="/admin/promo", tags=["promo", "admin"])


# ── Rate limiter ────────────────────────────────────────────────────────
# In-process sliding-window limiter — sufficient for the single-replica
# backend (numReplicas=1 in railway.json). Each IP gets a deque of recent
# hit timestamps; we drop expired entries and count what remains.

_RATE_LIMIT_WINDOW_SECONDS = 5 * 60
_RATE_LIMIT_MAX_HITS = 30
_rate_hits: dict[str, deque[float]] = {}
_rate_lock = Lock()


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        # The first comma-separated entry is the original client.
        return fwd.split(",")[0].strip() or (request.client.host if request.client else "unknown")
    return request.client.host if request.client else "unknown"


def _rate_limit(ip: str) -> bool:
    """Returns True if the call is allowed, False if rate-limited."""
    now = time.monotonic()
    cutoff = now - _RATE_LIMIT_WINDOW_SECONDS
    with _rate_lock:
        dq = _rate_hits.setdefault(ip, deque())
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= _RATE_LIMIT_MAX_HITS:
            return False
        dq.append(now)
        return True


# ── Schemas ─────────────────────────────────────────────────────────────


class ValidateRequest(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    plan_slug: str | None = Field(default=None, max_length=64)


class ValidateResponse(BaseModel):
    valid: bool
    percent_off: int | None = None
    expires_at: str | None = None
    reason: str | None = None
    code: str | None = None  # echoed normalised (uppercased) form when valid


class ApplyRequest(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    clerk_user_id: str = Field(min_length=1, max_length=120)
    plan_slug: str | None = Field(default=None, max_length=64)
    plan_price_usd_cents: int | None = Field(default=None, ge=0, le=10_000_000)
    stripe_subscription_id: str | None = Field(default=None, max_length=120)


class ApplyResponse(BaseModel):
    ok: bool
    stripe_coupon_id: str | None = None
    percent_off: int | None = None
    discount_applied_usd_cents: int | None = None
    reason: str | None = None


class CreateRequest(BaseModel):
    code: str = Field(min_length=2, max_length=40)
    percent_off: int = Field(ge=1, le=100)
    max_uses: int | None = Field(default=None, ge=1)
    expires_at: datetime | None = None
    scopes: list[str] = Field(default_factory=list)
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("code")
    @classmethod
    def _normalize_code(cls, v: str) -> str:
        n = normalize_code(v)
        if not n:
            raise ValueError("code must be alphanumeric + _/- (2–40 chars)")
        return n


class PromoCodeOut(BaseModel):
    id: int
    code: str
    percent_off: int
    max_uses: int | None
    used_count: int
    scopes: list[str]
    stripe_coupon_id: str | None
    revoked_at: str | None
    expires_at: str | None
    created_by: str
    created_at: str | None
    notes: str | None


def _serialize_promo(row: PromoCode) -> dict[str, Any]:
    return {
        "id": row.id,
        "code": row.code,
        "percent_off": row.percent_off,
        "max_uses": row.max_uses,
        "used_count": row.used_count,
        "scopes": parse_scopes(row.scopes_json),
        "stripe_coupon_id": row.stripe_coupon_id,
        "revoked_at": row.revoked_at.isoformat() if row.revoked_at else None,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "created_by": row.created_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "notes": row.notes,
    }


# ── /promo/validate ─────────────────────────────────────────────────────


@router.post("/validate", response_model=ValidateResponse)
def validate_code(
    body: ValidateRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> ValidateResponse:
    """Public read-only validation. Returns 200 in both valid + invalid
    cases so the UI can render a friendly chip instead of a network error."""
    ip = _client_ip(request)
    if not _rate_limit(ip):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "too many validation attempts — try again in a few minutes",
        )

    code = normalize_code(body.code)
    if not code:
        return ValidateResponse(valid=False, reason="shape")

    promo = db.query(PromoCode).filter(PromoCode.code == code).one_or_none()
    ok, reason = validate(promo, plan_slug=body.plan_slug)
    if not ok or promo is None:
        return ValidateResponse(valid=False, reason=reason)
    return ValidateResponse(
        valid=True,
        percent_off=promo.percent_off,
        expires_at=promo.expires_at.isoformat() if promo.expires_at else None,
        code=promo.code,
    )


# ── /promo/apply (admin-internal) ───────────────────────────────────────


# The apply endpoint is called server-to-server from the account-app at
# checkout-complete time, never from the browser. The `x-internal-secret`
# gate is enforced via `deps.require_internal_secret` — fail-closed
# (missing env → 500, missing/mismatched header → 401), replacing the
# earlier `if secret and header != secret` fail-open pattern.


@router.post("/apply", response_model=ApplyResponse)
def apply_code(
    body: ApplyRequest,
    db: Annotated[Session, Depends(get_db)],
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
) -> ApplyResponse:
    """Idempotently apply a promo code to a user's Stripe customer.

    Re-validates BEFORE creating the Stripe coupon — a code that was valid
    at /validate-time but got revoked / exhausted in the interim returns a
    structured `reason` instead of charging the user the wrong amount.
    """

    code = normalize_code(body.code)
    if not code:
        return ApplyResponse(ok=False, reason="shape")

    promo = db.query(PromoCode).filter(PromoCode.code == code).one_or_none()
    ok, reason = validate(promo, plan_slug=body.plan_slug)
    if not ok or promo is None:
        return ApplyResponse(ok=False, reason=reason)

    # Stripe coupon — idempotent at two layers (cached id + Stripe-side dedupe).
    try:
        coupon_id = ensure_stripe_coupon(promo)
    except StripeNotConfigured:
        # In stripe-less envs we still record the redemption + return ok=True
        # so dev/staging can exercise the flow without Stripe wired. Production
        # always has STRIPE_SECRET_KEY set per junior-backend/CLAUDE.md.
        coupon_id = None
    except Exception as e:  # noqa: BLE001
        # Never echo raw error material — log + return 502.
        logger.warning("[promo] stripe coupon path failed code=%s err=%s", code, type(e).__name__)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "stripe coupon provisioning failed")

    if coupon_id and not promo.stripe_coupon_id:
        promo.stripe_coupon_id = coupon_id

    discount_cents = 0
    if body.plan_price_usd_cents is not None:
        # round to nearest cent — Python int division would floor; banker's
        # rounding isn't worth the dep, plain // is fine for a snapshot.
        discount_cents = int(body.plan_price_usd_cents * promo.percent_off // 100)

    # Ledger row — used for admin Stats panel + revenue-impact rollup.
    db.add(
        PromoCodeRedemption(
            promo_code_id=promo.id,
            user_id=body.clerk_user_id,
            stripe_subscription_id=body.stripe_subscription_id,
            discount_applied_usd_cents=discount_cents,
        )
    )
    # Increment counter inside the same transaction so a max_uses cap is
    # enforced atomically across concurrent applies of the same code.
    promo.used_count = (promo.used_count or 0) + 1
    db.commit()

    return ApplyResponse(
        ok=True,
        stripe_coupon_id=coupon_id,
        percent_off=promo.percent_off,
        discount_applied_usd_cents=discount_cents,
    )


# ── /admin/promo (gated by require_admin) ───────────────────────────────


@admin_router.get("")
def list_codes(
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[User, Depends(require_admin)],
) -> dict[str, Any]:
    rows = db.query(PromoCode).order_by(PromoCode.created_at.desc()).all()
    return {
        "codes": [_serialize_promo(r) for r in rows],
        "stripe_configured": stripe_configured(),
    }


@admin_router.post("")
def create_code(
    body: CreateRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[User, Depends(require_admin)],
) -> dict[str, Any]:
    code = body.code  # already normalised by validator
    existing = db.query(PromoCode).filter(PromoCode.code == code).one_or_none()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "code already exists")

    # Normalise expires_at to UTC if naive.
    expires_at = body.expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "expires_at must be in the future")

    row = PromoCode(
        code=code,
        percent_off=body.percent_off,
        max_uses=body.max_uses,
        scopes_json=serialize_scopes(body.scopes),
        expires_at=expires_at,
        created_by=admin.email,
        notes=body.notes,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize_promo(row)


@admin_router.post("/{code}/revoke")
def revoke_code(
    code: str,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[User, Depends(require_admin)],
) -> dict[str, Any]:
    normalised = normalize_code(code)
    if not normalised:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid code shape")
    row = db.query(PromoCode).filter(PromoCode.code == normalised).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "code not found")
    if row.revoked_at is None:
        row.revoked_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(row)
    return _serialize_promo(row)


@admin_router.get("/{code}/stats")
def code_stats(
    code: str,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[User, Depends(require_admin)],
) -> dict[str, Any]:
    normalised = normalize_code(code)
    if not normalised:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid code shape")
    row = db.query(PromoCode).filter(PromoCode.code == normalised).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "code not found")

    reds = (
        db.query(PromoCodeRedemption)
        .filter(PromoCodeRedemption.promo_code_id == row.id)
        .order_by(PromoCodeRedemption.applied_at.desc())
        .all()
    )

    total_discount = (
        db.query(func.coalesce(func.sum(PromoCodeRedemption.discount_applied_usd_cents), 0))
        .filter(PromoCodeRedemption.promo_code_id == row.id)
        .scalar()
        or 0
    )

    # Resolve clerk_user_id → email (masked) so the admin panel shows
    # something more useful than an opaque id. Single-batch lookup.
    clerk_ids = [r.user_id for r in reds]
    users_by_clerk: dict[str, str] = {}
    if clerk_ids:
        for u in db.query(User).filter(User.clerk_id.in_(clerk_ids)).all():
            users_by_clerk[u.clerk_id] = u.email or ""

    def _mask(email: str) -> str:
        if not email or "@" not in email:
            return "—"
        local, _, domain = email.partition("@")
        if len(local) <= 1:
            head = local
        elif len(local) == 2:
            head = local[0] + "*"
        else:
            head = local[0] + "*" * (len(local) - 2) + local[-1]
        return f"{head}@{domain}"

    return {
        "code": _serialize_promo(row),
        "redemption_count": len(reds),
        "discount_applied_usd_cents_total": int(total_discount),
        "redemptions": [
            {
                "user_id": r.user_id,
                "email_masked": _mask(users_by_clerk.get(r.user_id, "")),
                "stripe_subscription_id": r.stripe_subscription_id,
                "discount_applied_usd_cents": r.discount_applied_usd_cents,
                "applied_at": r.applied_at.isoformat() if r.applied_at else None,
            }
            for r in reds
        ],
    }
