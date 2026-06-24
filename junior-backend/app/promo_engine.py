"""Promo / discount code engine.

Pure logic + Stripe coupon wrapper for the influencer/clipper discount-code
system. Routes live in app/routes/promo_codes.py.

Design rules:
  • Codes are case-insensitive, stored UPPER.
  • percent_off in 1..100 inclusive.
  • Validation checks (ordered): unknown → revoked → expired → exhausted →
    plan_mismatch. Order matters: a revoked exhausted expired code reports
    the most actionable reason first.
  • Stripe coupon creation is idempotent at two layers:
      1. We cache stripe_coupon_id on the PromoCode row after first success.
      2. We pass the LC code itself as the Stripe coupon `id` (uppercased,
         deterministic) so even if our cached id was lost mid-flight, Stripe
         dedupes on the second create attempt (returns the existing coupon).
  • No raw stripe keys ever leave this module. The Stripe SDK reads
    `stripe.api_key` set inside the wrapper.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Iterable

from app.config import get_settings
from app.models import PromoCode

logger = logging.getLogger("junior.promo")


# --- normalisation --------------------------------------------------------

_CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9_\-]{1,39}$")


def normalize_code(raw: str | None) -> str | None:
    """Return uppercased trimmed code if valid shape, else None."""
    if not raw:
        return None
    code = raw.strip().upper()
    if not _CODE_RE.match(code):
        return None
    return code


def parse_scopes(scopes_json: str | None) -> list[str]:
    """Decode the scopes_json column into a python list. Tolerates legacy
    rows that may have stored a comma-string."""
    if not scopes_json:
        return []
    try:
        loaded = json.loads(scopes_json)
        if isinstance(loaded, list):
            return [str(s).strip().lower() for s in loaded if str(s).strip()]
    except Exception:  # noqa: BLE001
        pass
    # Fallback: treat as comma-separated.
    return [s.strip().lower() for s in str(scopes_json).split(",") if s.strip()]


def serialize_scopes(scopes: Iterable[str]) -> str:
    cleaned = sorted({str(s).strip().lower() for s in (scopes or []) if str(s).strip()})
    return json.dumps(cleaned)


# --- validation -----------------------------------------------------------

VALIDATION_REASONS = (
    "unknown_code",
    "revoked",
    "expired",
    "exhausted",
    "plan_mismatch",
    "shape",
)


def validate(
    promo: PromoCode | None,
    *,
    plan_slug: str | None = None,
    now: datetime | None = None,
) -> tuple[bool, str | None]:
    """Pure validation. Caller resolves the PromoCode lookup, this only
    enforces the business rules so the same logic backs both /validate and
    /apply (race-condition safe)."""
    if promo is None:
        return False, "unknown_code"
    now = now or datetime.now(timezone.utc)
    if promo.revoked_at is not None:
        return False, "revoked"
    if promo.expires_at is not None and promo.expires_at <= now:
        return False, "expired"
    if promo.max_uses is not None and (promo.used_count or 0) >= promo.max_uses:
        return False, "exhausted"
    scopes = parse_scopes(promo.scopes_json)
    if scopes and plan_slug and plan_slug.strip().lower() not in scopes:
        return False, "plan_mismatch"
    return True, None


# --- Stripe wrapper -------------------------------------------------------

class StripeNotConfigured(RuntimeError):
    """Raised when an apply path needs Stripe but STRIPE_SECRET_KEY isn't set."""


def stripe_configured() -> bool:
    return bool(get_settings().stripe_secret_key)


def ensure_stripe_coupon(promo: PromoCode) -> str:
    """Idempotently create (or retrieve) a Stripe Coupon for this promo and
    return its id.

    We use the LC code itself (UPPER) as the Stripe coupon id so the second
    creation attempt returns a duplicate-key error we can recover from by
    retrieving the existing coupon. Stripe IDs accept [a-zA-Z0-9_-]{1,500}.
    """
    if promo.stripe_coupon_id:
        return promo.stripe_coupon_id

    if not stripe_configured():
        raise StripeNotConfigured("STRIPE_SECRET_KEY is not set")

    import stripe  # local import keeps the module importable in stripe-less envs

    s = get_settings()
    stripe.api_key = s.stripe_secret_key

    coupon_id = promo.code  # already uppercased

    try:
        coupon = stripe.Coupon.create(
            id=coupon_id,
            percent_off=promo.percent_off,
            duration="forever",
            name=f"LC promo {promo.code}",
            metadata={"liquid_clips_promo_id": str(promo.id)},
        )
        return str(coupon.id)
    except Exception as create_err:  # stripe.error.InvalidRequestError covers dup id
        # Try to fetch — if it exists, this is a benign idempotence hit.
        try:
            existing = stripe.Coupon.retrieve(coupon_id)
            return str(existing.id)
        except Exception:
            # Re-raise the ORIGINAL create error; never echo the Stripe key
            # or internal stack into the response — caller wraps to 502.
            logger.warning("[promo] stripe coupon create failed code=%s", promo.code)
            raise create_err
