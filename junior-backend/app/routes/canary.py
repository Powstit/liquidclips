"""Canary rollout · feature-flag dial for launch safety.

Every user-facing feature that could regress in production gets a
percentage gate. HQ dials it up (0 → 5 → 25 → 100) as confidence grows,
or crashes it back to 0 as an emergency killswitch.

Storage: single row in ``system_flags`` per feature key. Read path is
cached in-process for 60s so the desktop's `useFeature("ransom_paywall")`
hook doesn't hammer the DB on every render.

Endpoints:
  GET  /admin/canary                 — list all features + current %
  POST /admin/canary/{feature}       — set percent (0-100)
  GET  /me/canary                    — desktop reads · returns { feature: bool }
                                        based on user.id % 100 vs each feature's %

Bucketing is deterministic: same user always gets the same verdict for
a given percent, so an in-flight upgrade never randomly kicks a user
back to the old flow. Uses FNV-1a hash of user_id · fast + stable.
"""

from __future__ import annotations

import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.models import User
# AdminHQ audit (2026-08-26) · the two /admin/canary/* endpoints below
# were built against `current_user` (Depends(license_claims)) — the
# desktop app's Bearer-JWT auth. AdminHQ's proxy authenticates with
# `x-internal-secret` + `?clerk_user_id=` instead (see admin.py's
# `require_admin`), which every OTHER /admin/* route uses. The mismatch
# meant these two endpoints 401'd on every real AdminHQ call even after
# the proxy's own path-allowlist bug (a separate, now-fixed issue) was
# corrected. `/me/canary` below stays on `current_user` on purpose —
# it's the desktop's own read, not an admin path.
from app.routes.admin import AdminUser

router = APIRouter(prefix="/admin/canary", tags=["canary"])
me_router = APIRouter(prefix="/me/canary", tags=["canary"])

# Locked feature keys · adding a new one requires a code change so we
# don't get schema-free flags proliferating. Every entry should match
# a call site in the desktop or account-app that gates on `useFeature`.
FEATURE_KEYS: set[str] = {
    "ransom_paywall",       # 6 trigger sites · Sprint Final §1A
    "crew_match",           # Wallet retention loop · §1D-CREW
    "whop_bounty_syndicate",# Agency campaigns → Whop marketplace · §1C
    "sui_payouts",          # Reserved · deferred per 2026-07-07 wallet pivot
    "wallet_dashboard_v2",  # Beautiful branded dashboard replacing WalletPanel
    "referral_pipeline",    # ReferralPipelineTile visibility
    "gap_email_subject",    # Loss-aversion subject line for crew invites
}


class CanaryEntry(BaseModel):
    feature: str = Field(..., min_length=1, max_length=80)
    percent: int = Field(..., ge=0, le=100)


class CanaryListOut(BaseModel):
    features: list[CanaryEntry]


class CanaryMeOut(BaseModel):
    features: dict[str, bool]


# Simple in-process cache · 60s TTL. Not shared across replicas but each
# replica converges within 60s of a dial change, which is fine for canary.
_CACHE: dict[str, tuple[float, int]] = {}
_CACHE_TTL_S = 60.0


def _get_percent(db: Session, feature: str) -> int:
    """Read one feature's canary %, cache-aware."""
    now = time.time()
    cached = _CACHE.get(feature)
    if cached and now - cached[0] < _CACHE_TTL_S:
        return cached[1]
    row = db.execute(
        text("SELECT value FROM system_flags WHERE key = :k"),
        {"k": f"canary.{feature}"},
    ).scalar_one_or_none()
    percent = 0
    if row is not None:
        try:
            percent = max(0, min(100, int(row)))
        except (TypeError, ValueError):
            percent = 0
    _CACHE[feature] = (now, percent)
    return percent


def _set_percent(db: Session, feature: str, percent: int) -> None:
    """Write one feature's canary %. Invalidates in-process cache."""
    db.execute(
        text(
            """
            INSERT INTO system_flags (key, value, updated_at)
            VALUES (:k, :v, now())
            ON CONFLICT (key) DO UPDATE SET
                value = EXCLUDED.value,
                updated_at = now()
            """
        ),
        {"k": f"canary.{feature}", "v": str(percent)},
    )
    db.commit()
    _CACHE[feature] = (time.time(), percent)


def _bucket(user_id: int, feature: str) -> int:
    """Deterministic 0-99 bucket per (user, feature).

    Uses FNV-1a on `f"{feature}:{user_id}"` so different features shuffle
    users independently — the user in bucket 3 for `ransom_paywall` may
    be in bucket 87 for `crew_match`. Prevents correlation-induced
    self-selection bias in the rollout.
    """
    h = 2166136261  # FNV offset basis (32-bit)
    for c in f"{feature}:{user_id}":
        h ^= ord(c)
        h = (h * 16777619) & 0xFFFFFFFF
    return h % 100


@router.get("", response_model=CanaryListOut)
def list_canaries(
    db: Annotated[Session, Depends(get_db)],
    _admin: AdminUser,
) -> CanaryListOut:
    return CanaryListOut(
        features=[
            CanaryEntry(feature=k, percent=_get_percent(db, k))
            for k in sorted(FEATURE_KEYS)
        ]
    )


class SetCanaryIn(BaseModel):
    percent: int = Field(..., ge=0, le=100)


@router.post("/{feature}", response_model=CanaryEntry)
def set_canary(
    feature: str,
    body: SetCanaryIn,
    db: Annotated[Session, Depends(get_db)],
    _admin: AdminUser,
) -> CanaryEntry:
    if feature not in FEATURE_KEYS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"unknown feature '{feature}' · known: {sorted(FEATURE_KEYS)}",
        )
    _set_percent(db, feature, body.percent)
    return CanaryEntry(feature=feature, percent=body.percent)


@me_router.get("", response_model=CanaryMeOut)
def my_canaries(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
) -> CanaryMeOut:
    """Return this user's feature verdicts. Desktop reads on boot +
    every 5 min to pick up dial changes."""
    return CanaryMeOut(
        features={
            k: _bucket(user.id, k) < _get_percent(db, k) for k in FEATURE_KEYS
        }
    )
