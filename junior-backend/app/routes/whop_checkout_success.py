"""Whop checkout success redirect handler · 2.2.24.

The success URL configured on the Founder Access plan (currently
`plan_svbzoXoT4oj6b`, rotated 2026-07-05 · $99.99/mo · 365-day trial ·
cap 12,000). Legacy `plan_VWj1uoy2RcOsg` is kept in `FOUNDER_PLAN_IDS`
so pre-rotation checkouts still resolve to the founder tier.

Whop redirects here after a user completes the hosted checkout page:

    https://whop.com/checkout/plan_svbzoXoT4oj6b
        ↓ (user enters email + card, no charge yet)
    https://api.jnremployee.com/whop/checkout-success?membership_id=X
        ↓ (this handler)
    HTMLResponse that auto-fires liquidclips://activate?token=<jwt>
    with a fallback copy-token card.

Reuses the exact activation-fallback pattern from `auth_whop.py` so
the same Rust deep-link handler + activation.ts state machine catch
the token — no new frontend plumbing needed.

Idempotency: hitting this URL twice with the same membership_id is
safe. We upsert the User row by whop_user_id / email and mint a
fresh JWT each time (the old JWT stays valid until natural expiry —
30-day Ed25519, auto-rotated by /sync when ≤5 days remaining).
"""

from __future__ import annotations

import logging
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import User
from app.routes.auth_whop import _back_to_account, _render_activation_fallback
from app.routes.founder import try_grant_founder_seat
from app.routes.webhooks_whop import FOUNDER_PLAN_IDS, apply_membership_tier

log = logging.getLogger("junior.whop_checkout_success")

router = APIRouter(prefix="/whop", tags=["whop-checkout"])

_WHOP_MEMBERSHIP_URL = "https://api.whop.com/api/v2/memberships/{id}"


@router.get("/checkout-success", response_model=None)
def whop_checkout_success(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    membership_id: str | None = Query(None, alias="membership_id"),
    receipt_id: str | None = Query(None, alias="receipt_id"),
) -> HTMLResponse | RedirectResponse:
    """Whop's post-checkout landing.

    Whop's plan-level success URL supports the standard `{membership_id}`
    substitution — configure the plan's success URL as:
        https://api.jnremployee.com/whop/checkout-success?membership_id={membership_id}

    Some Whop configs also emit `receipt_id`; accept either.
    """
    settings = get_settings()

    mid = (membership_id or "").strip()
    if not mid and receipt_id:
        # Fall back: look up the membership behind a receipt id if that's
        # all Whop passed. Same auth as the primary lookup below.
        try:
            with httpx.Client(timeout=8.0) as client:
                r = client.get(
                    f"https://api.whop.com/api/v2/receipts/{receipt_id}",
                    headers={"Authorization": f"Bearer {settings.whop_api_key}"},
                )
                if r.status_code < 400:
                    mid = (r.json().get("membership_id") or "").strip()
        except httpx.HTTPError:
            pass

    if not mid or not settings.whop_api_key:
        # No membership id + no API key means we can't verify. Send them
        # to the account-app connect-desktop page as a graceful fallback
        # so they can retry the sign-in from a known-good surface.
        return _back_to_account("/connect-desktop?whop_missing_membership=1")

    # Fetch the membership so we get the buyer's email + whop_user_id.
    try:
        with httpx.Client(timeout=10.0) as client:
            m_resp = client.get(
                _WHOP_MEMBERSHIP_URL.format(id=mid),
                headers={"Authorization": f"Bearer {settings.whop_api_key}"},
            )
            if m_resp.status_code >= 400:
                log.info("[whop_checkout_success] membership %s lookup HTTP %s", mid, m_resp.status_code)
                return _back_to_account(f"/connect-desktop?whop_error=membership_{m_resp.status_code}")
            membership = m_resp.json()
    except httpx.HTTPError as e:
        log.info("[whop_checkout_success] membership %s lookup error: %s", mid, e)
        return _back_to_account("/connect-desktop?whop_error=network")

    # Whop's membership shape includes `user_id` (whop user) + `email`.
    # Different SDK revisions have used slightly different keys; accept
    # any of the known aliases so a Whop API rev doesn't break us.
    whop_user_id = (
        membership.get("user_id")
        or membership.get("user")
        or (membership.get("member") or {}).get("id")
        or ""
    ).strip()
    whop_email = (
        membership.get("email")
        or (membership.get("member") or {}).get("email")
        or ""
    ).strip().lower()

    if not whop_user_id and not whop_email:
        log.info("[whop_checkout_success] membership %s missing user identity", mid)
        return _back_to_account("/connect-desktop?whop_error=identity")

    # Look up an existing User row. This endpoint ONLY mints a JWT
    # for users who already exist in our DB (they signed up via Clerk
    # at some prior point). New Whop-only buyers must complete Clerk
    # signup before we can mint a JWT — the User model requires
    # `clerk_id` (nullable=False, unique=True), so a bare row without
    # a Clerk identity would crash with an IntegrityError.
    #
    # Whop webhooks separately fire `_stash_pending_whop_membership`
    # into the PendingWhopMembership table (see webhooks_whop.py) —
    # that parks the trial/subscription for the buyer's email. When
    # they later sign up via Clerk, the /onboarding/link-whop flow
    # (webhooks_clerk.py) drains the pending row and grants the tier.
    #
    # So the two paths are:
    #   · returning user (has Clerk id) → mint JWT + deep link now
    #   · brand-new Whop-only buyer     → redirect to account-app
    #     /connect-desktop which handles Clerk signup, then the
    #     backfill promotes them to the Founder tier automatically.
    user: User | None = None
    if whop_user_id:
        user = db.query(User).filter_by(whop_user_id=whop_user_id).one_or_none()
    if not user and whop_email:
        user = db.query(User).filter(User.email == whop_email).one_or_none()
        if user and whop_user_id and not user.whop_user_id:
            user.whop_user_id = whop_user_id
    if not user:
        # New Whop-only buyer. The Whop webhook has (or will) parked
        # a PendingWhopMembership row keyed on this email. Send them
        # to account-app for Clerk signup — the drain happens
        # automatically on the Clerk `user.created` webhook.
        log.info(
            "[whop_checkout_success] new buyer without Clerk · membership=%s email=%s → redirecting to /connect-desktop",
            mid, whop_email or "<unknown>",
        )
        params = f"?whop_checkout=1&membership_id={mid}"
        if whop_email:
            from urllib.parse import quote_plus
            params += f"&email={quote_plus(whop_email)}"
        return _back_to_account(f"/connect-desktop{params}")

    # Ship-lens P0-3 fix · plan-id whitelist. This endpoint is
    # configured only for the Founder Access plan. If the incoming
    # membership belongs to a different plan (URL reused for Solo /
    # Pro / Agency in future), refuse the founder-tier mint and punt
    # to the webhook path which resolves the correct tier from
    # `_require_known_tier`.
    plan_obj = membership.get("plan") or {}
    plan_id = (plan_obj.get("id") if isinstance(plan_obj, dict) else "") or membership.get("plan_id") or ""
    if plan_id and plan_id not in FOUNDER_PLAN_IDS:
        log.info(
            "[whop_checkout_success] non-founder plan hit success URL · plan=%s membership=%s · refusing tier grant",
            plan_id, mid,
        )
        return _back_to_account(f"/connect-desktop?whop_wrong_plan=1&membership_id={mid}")

    # Ship-lens P0-3 fix · Founder seat-cap enforcement. Mirror the
    # webhook's `try_grant_founder_seat` gate so a buyer past the
    # 12,000-seat cap can't slip past the checkout redirect and get
    # a live JWT for a seat that will later be refused.
    granted, reason = try_grant_founder_seat(
        db,
        whop_membership_id=mid,
        plan_id=plan_id or next(iter(FOUNDER_PLAN_IDS)),
        user_id=str(user.id),
        whop_user_id=whop_user_id or None,
    )
    if not granted:
        log.warning(
            "[whop_checkout_success] founder seat refused · reason=%s membership=%s user=%s",
            reason, mid, user.id,
        )
        return _back_to_account(f"/connect-desktop?whop_cohort_full=1&membership_id={mid}")

    # Ship-lens P0-2 fix · route through the canonical
    # `apply_membership_tier` helper so the same side-effects fire
    # for a checkout-success as for a webhook `membership_went_valid`
    # — sync_clerk_metadata, agency commission override, paid_until,
    # License row + freshly issued JWT. Previously the inline mint
    # skipped all of these silently.
    renewal_at = membership.get("renewal_period_end") or membership.get("expires_at")
    renewal_val: int | float | None
    if isinstance(renewal_at, (int, float)):
        renewal_val = renewal_at
    else:
        renewal_val = None
    jwt_str = apply_membership_tier(
        db,
        user,
        tier="autopilot",  # Founder Access grants autopilot-tier entitlements
        founder=True,
        whop_user_id=whop_user_id or None,
        renewal_at=renewal_val,
        paid=False,  # trial start · payment_succeeded webhook flips to paid
    )
    db.commit()

    # Same activation-fallback page as /auth/whop/callback — auto-fires
    # `liquidclips://activate?token=<jwt>` and offers a copy-token card
    # if the browser blocks the scheme handler (Safari, some Chrome
    # configs). Reuse the exact helper so the UX stays consistent
    # across both sign-in entry points.
    deep_link = f"liquidclips://activate?token={jwt_str}&source=whop-checkout"
    return HTMLResponse(_render_activation_fallback(deep_link, jwt_str))
