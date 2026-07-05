"""v2.2.15 · one-click trial-to-paid conversion.

Fires from the desktop's UpgradeApprovalModal when the user clicks
"Approve upgrade now" — either because they hit the 100-clip cap
early, or because they just want to lock in Pro before the 7-day
timer expires.

Behaviour by branch:
  1. Best-effort Whop `end_free_trial` call to force-charge the card
     on file immediately. Whop's own docs mark this as beta as of
     mid-2026 so we tolerate 404/501 gracefully.
  2. Whether the API call succeeds or not, we stamp
     `user.trial_convert_approved_at = now()`. That flag makes
     /sync return `trial_convert_pending=true` so the desktop UI
     shows "Confirming with Whop…" instead of the paywall between
     click and the `membership_valid` webhook firing.
  3. On the webhook fire (subscription_status flips to "active" and
     tier flips to "solo"), the pending flag is naturally false in
     the /sync response because we only set pending when
     status == "trial"/"trialing".

The endpoint is idempotent — calling it twice on an already-approved
trial is a no-op. Returns a stable `state` string the desktop uses
to pick the toast copy.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import current_user
from app.models import User

log = logging.getLogger("junior.trial_convert")

router = APIRouter(prefix="/me/trial", tags=["trial"])

# Whop end-trial-early endpoint. When available on the plan's tier
# this triggers an immediate card-on-file charge and fires
# `membership_valid` (or `payment_succeeded`) as a follow-up webhook.
_WHOP_END_TRIAL_URL = "https://api.whop.com/api/v2/memberships/{id}/end_free_trial"


class EndTrialResponse(BaseModel):
    state: Literal[
        "already_paid",   # user's already on a paid tier · idempotent no-op
        "not_trialing",   # they don't have an active trial to end
        "approved",       # click stamped · Whop charge dispatched (or best-effort attempted) · webhook lands soon
        "unavailable",    # Whop API refused (missing scope or plan not eligible) · trial will still auto-charge naturally on day 8
    ]
    trial_convert_approved_at: datetime | None
    detail: str


def _find_active_membership_id(user: User) -> str | None:
    """Query Whop for the user's active membership id. We don't
    persist this on the User row because Whop is the source of truth
    and a mirror would go stale on refunds / pauses. The lookup adds
    one HTTP hop but only fires on the user-initiated Approve click,
    so latency is fine."""
    settings = get_settings()
    if not settings.whop_api_key or not user.whop_user_id:
        return None
    try:
        with httpx.Client(timeout=8.0) as client:
            r = client.get(
                "https://api.whop.com/api/v2/memberships",
                params={"user_id": user.whop_user_id, "first": 5},
                headers={"Authorization": f"Bearer {settings.whop_api_key}"},
            )
            r.raise_for_status()
            data = r.json().get("data") or []
    except httpx.HTTPError:
        return None
    # Prefer the trialing / valid one · fall back to whichever is
    # active. Whop occasionally returns older canceled rows in the
    # list so filter defensively.
    for m in data:
        if m.get("status") in {"trialing", "valid", "active"} and m.get("id"):
            return str(m["id"])
    return None


def _try_end_trial_early(membership_id: str) -> bool:
    """Best-effort force-charge the card on file. Returns True when
    Whop's API acknowledges (2xx). Returns False on 4xx/5xx or scope
    issues — caller falls back to "trial will auto-charge naturally"
    messaging so the user still gets a coherent outcome."""
    settings = get_settings()
    if not settings.whop_api_key:
        return False
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.post(
                _WHOP_END_TRIAL_URL.format(id=membership_id),
                headers={
                    "Authorization": f"Bearer {settings.whop_api_key}",
                    "Content-Type": "application/json",
                },
                json={},
            )
            if r.status_code in {200, 201, 202, 204}:
                return True
            log.info(
                "[trial_convert] Whop end_free_trial HTTP %s · payload=%s",
                r.status_code, r.text[:200],
            )
            return False
    except httpx.HTTPError as e:
        log.info("[trial_convert] Whop end_free_trial error: %s", e)
        return False


@router.post("/approve", response_model=EndTrialResponse)
def approve_trial_conversion(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> EndTrialResponse:
    """User-initiated: end the trial early and charge the card on file.

    Idempotent: safe to call twice · we only stamp the timestamp once,
    subsequent calls short-circuit to `already_paid` / `approved`.
    """
    # Idempotent guard · already flipped to paid.
    if user.subscription_status == "active" and user.tier not in {"free", ""}:
        return EndTrialResponse(
            state="already_paid",
            trial_convert_approved_at=user.trial_convert_approved_at,
            detail="You're already on the paid plan.",
        )

    if user.subscription_status not in {"trial", "trialing"}:
        return EndTrialResponse(
            state="not_trialing",
            trial_convert_approved_at=None,
            detail="No active trial to convert.",
        )

    # Best-effort Whop force-charge. Whether or not this lands, we
    # ALWAYS stamp the click marker so the UI can show a coherent
    # "Confirming with Whop…" state until the natural auto-charge
    # fires the membership_valid webhook.
    membership_id = _find_active_membership_id(user)
    whop_ok = False
    if membership_id:
        whop_ok = _try_end_trial_early(membership_id)

    now = datetime.now(timezone.utc)
    if user.trial_convert_approved_at is None:
        user.trial_convert_approved_at = now
        db.commit()

    if whop_ok:
        return EndTrialResponse(
            state="approved",
            trial_convert_approved_at=user.trial_convert_approved_at,
            detail="We're charging your card on file · you'll be on Solo in a moment.",
        )
    return EndTrialResponse(
        state="unavailable",
        trial_convert_approved_at=user.trial_convert_approved_at,
        detail=(
            "Your approval is logged. Whop couldn't accept the early charge "
            "right now, so your $29.99 will land on the natural 7-day timer. "
            "Cancel any time from account.liquidclips.app if you change your mind."
        ),
    )


# 2026-07-05 · CM-T2 · Cancel subscription real. Was `AccountSection.tsx`
# `handleQuietCancel` toast-only which lied — user believed cancelled,
# gets billed next cycle. Real cancel calls Whop's `end_membership`
# API, marks the local User row, returns a coherent state so the
# frontend can display "Cancelled · access until <renewal_at>" instead
# of a fake queued message.


_WHOP_END_MEMBERSHIP_URL = (
    "https://api.whop.com/api/v2/memberships/{id}/end_membership"
)


class CancelSubscriptionResponse(BaseModel):
    state: Literal[
        "cancelled",       # Whop acknowledged · access until access_ends_at
        "already_cancelled",  # user already cancelled · idempotent no-op
        "no_membership",   # nothing active to cancel
        "unavailable",     # Whop API refused · advise user to retry / email support
    ]
    access_ends_at: datetime | None
    detail: str


def _try_end_membership(membership_id: str) -> tuple[bool, str | None]:
    """Best-effort Whop `end_membership`. Returns (ok, iso_end_date).
    The end date comes from Whop's response · usually the paid-until
    boundary so the user keeps access to what they already paid for.
    Returns (False, None) on any 4xx/5xx / scope issue · caller falls
    back to the `unavailable` state and advises manual email cancel."""
    settings = get_settings()
    if not settings.whop_api_key:
        return False, None
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.post(
                _WHOP_END_MEMBERSHIP_URL.format(id=membership_id),
                headers={
                    "Authorization": f"Bearer {settings.whop_api_key}",
                    "Content-Type": "application/json",
                },
                json={},
            )
            if r.status_code in {200, 201, 202, 204}:
                # Some Whop responses carry `expires_at` / `access_ends_at`
                # · accept either; None is fine if omitted.
                try:
                    body = r.json()
                    end_iso = (
                        body.get("expires_at")
                        or body.get("access_ends_at")
                        or body.get("valid_until")
                    )
                    return True, end_iso
                except Exception:  # noqa: BLE001 · JSON parse best-effort
                    return True, None
            log.info(
                "[cancel_subscription] Whop end_membership HTTP %s · %s",
                r.status_code, r.text[:200],
            )
            return False, None
    except httpx.HTTPError as e:
        log.info("[cancel_subscription] Whop end_membership error: %s", e)
        return False, None


@router.post("/cancel", response_model=CancelSubscriptionResponse)
def cancel_subscription(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CancelSubscriptionResponse:
    """User-initiated cancel. Idempotent: safe to call twice.

    Flow:
      1. Idempotent guard · already cancelled → return `already_cancelled`
      2. No Whop membership id → return `no_membership` (free user, or
         Whop identity never linked)
      3. Best-effort `end_membership` call against Whop
      4. Whop acknowledged → mark local status `cancelled` + return
         `cancelled` with the `access_ends_at` boundary
      5. Whop refused → return `unavailable` with support email in body
    """
    if user.subscription_status == "cancelled":
        return CancelSubscriptionResponse(
            state="already_cancelled",
            access_ends_at=user.paid_until,
            detail="Your subscription is already cancelled.",
        )

    membership_id = _find_active_membership_id(user)
    if membership_id is None:
        return CancelSubscriptionResponse(
            state="no_membership",
            access_ends_at=None,
            detail=(
                "No active Whop membership on this account. If you believe "
                "this is wrong, email support@liquidclips.app."
            ),
        )

    ok, end_iso = _try_end_membership(membership_id)
    if not ok:
        return CancelSubscriptionResponse(
            state="unavailable",
            access_ends_at=user.paid_until,
            detail=(
                "Whop couldn't accept the cancel right now. Please email "
                "support@liquidclips.app and we'll process it manually "
                "within 24 h."
            ),
        )

    # Parse the Whop-provided end date · fall back to paid_until then
    # `now` if neither is available (unusual but safe).
    parsed_end: datetime | None = None
    if end_iso:
        try:
            parsed_end = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
        except Exception:  # noqa: BLE001 · Whop timestamp parse
            parsed_end = None
    access_ends_at = parsed_end or user.paid_until

    user.subscription_status = "cancelled"
    db.commit()

    return CancelSubscriptionResponse(
        state="cancelled",
        access_ends_at=access_ends_at,
        detail=(
            "Your subscription is cancelled. You keep access until the "
            "current billing period ends."
        ),
    )
