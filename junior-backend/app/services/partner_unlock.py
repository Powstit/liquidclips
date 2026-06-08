"""Partner Engine unlock service (LIQUIDCLIPS-PARTNER-ENGINE.md §6).

The single conditional unlock the spec describes. Two callers:

  - app/routes/webhooks_whop.py::_handle_payment_succeeded — every time a
    referrer's paid count is incremented.
  - app/routes/tiktok_verify.py::confirm_verification — every time the
    second condition (TikTok verified) flips true.

Both call try_unlock_partner(db, user); the service is idempotent and
guards on partner_unlocked_at IS NULL.

What it does when conditions are met:

  1. If PARTNER_UNLOCK_LIVE=true and whop_api_key is set, POST a per-
     affiliate commission override to Whop (50%, all_payments, recurring).
     Store the returned override id on User.whop_commission_override_id.
  2. Stamp partner_unlocked_at = now() (regardless of Whop write success
     when LIVE=false — local state must be honest for Campaign B gating).
  3. Fire PostHog partner_unlocked + admin alert + user notification.

When PARTNER_UNLOCK_LIVE=false, step 1 is skipped. This is the default
until the exact Whop commission-override endpoint + payload is confirmed
from their API docs (spec §13 Q2). Step 2 still runs so Campaign B
gating is wired and we can dry-run the funnel end-to-end without paying
out the 50%.

Whop API note: the override endpoint is documented as
POST https://api.whop.com/api/v1/affiliates/{affiliate_id}/commission_overrides
with body {commission_type, commission_value, applies_to_payments,
product_id?}. The path shape needs live verification before LIVE=true —
the docs use both `/commission_overrides` and a `/overrides` shorthand
in different places. See WHOP.md §9 open questions.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import User

log = logging.getLogger("junior.partner_unlock")

PAID_REFERRAL_THRESHOLD = 10  # spec §2 — 10 referred paid subs.
COMMISSION_PERCENT = 50       # spec §6 — 50% recurring.

WHOP_OVERRIDE_URL_TMPL = (
    "https://api.whop.com/api/v1/affiliates/{affiliate_id}/commission_overrides"
)


def _qualifies(user: User) -> bool:
    """Returns True iff the user meets both Partner conditions."""
    if (user.referred_paid_subs or 0) < PAID_REFERRAL_THRESHOLD:
        return False
    if user.tiktok_verified_at is None:
        return False
    return True


def _post_whop_override(affiliate_id: str) -> str | None:
    """POST the 50% recurring commission override to Whop. Returns the
    override id on success, None on any error. Caller decides what to do
    with the local stamp when this returns None.
    """
    settings = get_settings()
    if not settings.whop_api_key:
        log.warning("[partner_unlock] no whop_api_key — skipping override POST")
        return None
    url = WHOP_OVERRIDE_URL_TMPL.format(affiliate_id=affiliate_id)
    payload: dict[str, Any] = {
        "commission_type": "percentage",
        "commission_value": COMMISSION_PERCENT,
        "applies_to_payments": "all_payments",
    }
    try:
        with httpx.Client(timeout=20.0) as client:
            r = client.post(
                url,
                headers={
                    "Authorization": f"Bearer {settings.whop_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if r.status_code >= 400:
            log.error(
                "[partner_unlock] override POST failed: aff=%s status=%d body=%s",
                affiliate_id, r.status_code, r.text[:300],
            )
            return None
        body = r.json()
        override_id = body.get("id") or body.get("override_id")
        if not override_id:
            log.error(
                "[partner_unlock] override POST returned no id: aff=%s body=%s",
                affiliate_id, str(body)[:300],
            )
            return None
        return str(override_id)
    except (httpx.HTTPError, ValueError) as e:
        log.exception("[partner_unlock] override POST errored: aff=%s err=%s", affiliate_id, e)
        return None


def try_unlock_partner(db: Session, user: User) -> bool:
    """Idempotent. Returns True if this call performed the unlock (state
    transitioned from prospect → partner), False otherwise.

    Three guards:
      - already unlocked → no-op
      - conditions not met → no-op
      - no whop_affiliate_id cached → no-op (caller should ensure the
        Whop affiliate record exists; webhooks_clerk._handle_user_created
        and build_affiliate_me_response both populate this)
    """
    if user.partner_unlocked_at is not None:
        return False
    if not _qualifies(user):
        return False

    settings = get_settings()
    override_id: str | None = None

    if settings.partner_unlock_live:
        if not user.whop_affiliate_id:
            # Can't POST an override without the affiliate id. Bail without
            # stamping unlocked so the next call (after the lazy affiliate
            # backfill in /affiliate/me) can retry.
            log.warning(
                "[partner_unlock] user=%s qualifies but has no whop_affiliate_id — deferring",
                user.id,
            )
            return False
        override_id = _post_whop_override(user.whop_affiliate_id)
        if override_id is None:
            # Live mode requires a successful POST. Don't stamp local state
            # if the override didn't land — otherwise we'd advertise Partner
            # status to the user without the commission rate actually being
            # active on Whop.
            return False

    # Local stamp — happens in both LIVE and dry-run modes once guards
    # pass. Campaign B gating in /whop/bounties reads partner_unlocked_at.
    user.partner_unlocked_at = datetime.now(timezone.utc)
    if override_id:
        user.whop_commission_override_id = override_id
    db.commit()

    _fire_unlock_side_effects(db, user)
    return True


def _fire_unlock_side_effects(db: Session, user: User) -> None:
    """PostHog + notification + admin alert + branded email. Best-effort:
    a failure here can't unwind the unlock (the row is committed) but it
    also can't bubble up. Mirrored from
    webhooks_whop._fire_affiliate_lifecycle_emails."""
    try:
        from app import analytics
        from app.mailer import send_admin_affiliate_milestone
        from app.routes.notifications import write_notification

        if user.clerk_id:
            analytics.capture(
                user_id=user.clerk_id,
                event="partner_unlocked",
                properties={
                    "referred_paid_subs": user.referred_paid_subs,
                    "whop_affiliate_id": user.whop_affiliate_id,
                    "commission_override_id": user.whop_commission_override_id,
                    "live": bool(get_settings().partner_unlock_live),
                },
            )

        write_notification(
            db,
            user_id=user.id,
            category="affiliate",
            title="Partner status unlocked.",
            body=(
                "50% recurring is live on every customer you refer from here on. "
                "Your first 10 stay at 100% to the company — that gate's done."
            ),
            priority="high",
            external_dedup_key=f"partner-unlocked-{user.id}",
        )

        if user.email:
            send_admin_affiliate_milestone(
                affiliate_email=user.email,
                milestone="partner_unlocked",
                note=(
                    f"referred_paid_subs={user.referred_paid_subs}, "
                    f"override_id={user.whop_commission_override_id or '(dry-run)'}"
                ),
            )
    except Exception:  # noqa: BLE001
        log.exception(
            "[partner_unlock] side-effects failed for user=%s — unlock row stays committed",
            user.id,
        )
