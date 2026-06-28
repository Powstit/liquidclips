"""Partner Engine unlock service (LIQUIDCLIPS-PARTNER-ENGINE.md §6).

The single conditional unlock the spec describes. Two callers:

  - app/routes/webhooks_whop.py::_handle_payment_succeeded — every time a
    referrer's paid count is incremented.
  - app/routes/tiktok_verify.py::confirm_verification — every time the
    second condition (TikTok verified) flips true.

Both call try_unlock_partner(db, user); the service is idempotent and
guards on partner_unlocked_at IS NULL.

This service controls Partner-only campaign access. Affiliate commission
qualification is handled independently by app.services.affiliate_commission
(2 paid referrals held 7 days). Keeping the gates separate prevents a
campaign-access rule from silently changing live payout terms.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.models import User

log = logging.getLogger("junior.partner_unlock")

PAID_REFERRAL_THRESHOLD = 10  # spec §2 — 10 referred paid subs.


def _qualifies(user: User) -> bool:
    """Returns True iff the user meets both Partner conditions."""
    if (user.referred_paid_subs or 0) < PAID_REFERRAL_THRESHOLD:
        return False
    if user.tiktok_verified_at is None:
        return False
    return True


def try_unlock_partner(db: Session, user: User) -> bool:
    """Idempotent. Returns True if this call performed the unlock (state
    transitioned from prospect → partner), False otherwise.

    Three guards:
      - already unlocked → no-op
      - conditions not met → no-op
      - conditions not met → no-op
    """
    if user.partner_unlocked_at is not None:
        return False
    if not _qualifies(user):
        return False

    # Campaign-access stamp only. No money settings are mutated here.
    user.partner_unlocked_at = datetime.now(timezone.utc)
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
                },
            )

        write_notification(
            db,
            user_id=user.id,
            category="affiliate",
            title="Partner status unlocked.",
            body=(
                "Your dedicated-channel Partner access is unlocked. "
                "Affiliate commission qualification is tracked separately."
            ),
            priority="high",
            external_dedup_key=f"partner-unlocked-{user.id}",
        )

        if user.email:
            send_admin_affiliate_milestone(
                affiliate_email=user.email,
                milestone="partner_unlocked",
                note=f"referred_paid_subs={user.referred_paid_subs}",
            )
    except Exception:  # noqa: BLE001
        log.exception(
            "[partner_unlock] side-effects failed for user=%s — unlock row stays committed",
            user.id,
        )
