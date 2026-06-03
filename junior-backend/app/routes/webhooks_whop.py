"""Whop webhook handler — see oauth-billing.md §5.

Whop signs deliveries with HMAC-SHA256 against the webhook secret. We
verify before processing.

Event handling:
  - membership_went_valid   → tier=<plan>, subscription_status='active'
  - membership_went_invalid → subscription_status='expired'
  - membership_canceled     → same as invalid for now
  - payment_succeeded       → bump paid_until
  - payment_failed          → no-op (Whop retries; final failure fires _invalid)
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.jwt_signer import issue_license_jwt
from app.models import License, PendingWhopMembership, User, WebhookEvent
from app.routes.notifications import write_notification

router = APIRouter(prefix="/webhooks/whop", tags=["webhooks"])
settings = get_settings()


# Map Whop plan IDs → our internal tiers.
# Whop is for affiliate-tracked + one-time sales (Founder £500 is the only
# active Whop product right now). Recurring tiers go through Clerk Billing.
# Keys are lowercased — the lookup lowercases the incoming plan title so a
# title cased differently by Whop ("Junior Solo") still resolves.
PLAN_TIER_BY_TITLE = {
    "junior pro": "growth",      # legacy prod_V8UzHw4fxCqaJ — back-compat
    "junior solo": "solo",
    "junior growth": "growth",
    "junior channel": "growth",  # legacy alias
    "junior autopilot": "autopilot",
    # Founder is a one-time £500 unlock; founder_flag also gets set in
    # _tier_from_event so they get Autopilot entitlements forever.
    "junior founder": "autopilot",
}

# PRIMARY mapping: Whop plans here carry no `title` (the v2 API returns title=null),
# so title-matching is unreliable — match by the stable plan id first. These are
# the live USD plans on Junior Pro (prod_V8UzHw4fxCqaJ), created 2026-05-25.
PLAN_TIER_BY_ID = {
    "plan_qe8AFXj9J3SWi": "solo",       # Junior Solo  $29.99/mo
    "plan_dhssNse4FfPlI": "growth",     # Junior Growth $99.99/mo
    "plan_BvDBrtybhbxNg": "autopilot",  # Junior Autopilot $199.99/mo
}

# Founder is a $500 one-time unlock → Autopilot tier + founder_flag forever.
# Match by plan id: the webhook can send title=null (like the renewal plans
# above do), so a title-only check would let a Founder buy fall through to
# "growth". Keep this set in sync with the live Whop "Founder Lifetime" plan.
FOUNDER_PLAN_IDS = {"plan_OieNCPrvkw9U4"}  # "Founder Lifetime" $500 one-time


def _verify_signature(body: bytes, header_sig: str | None) -> None:
    if not settings.whop_webhook_secret:
        return  # dev mode — skip
    if not header_sig:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing signature header")
    expected = hmac.new(settings.whop_webhook_secret.encode(), body, hashlib.sha256).hexdigest()
    # Whop sends the hex digest; some integrations prefix with "sha256=".
    received = header_sig.split("=")[-1].strip()
    if not hmac.compare_digest(expected, received):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid signature")


def _tier_from_event(event_data: dict) -> tuple[str, bool]:
    """Returns (tier, is_founder). Founder always maps to 'autopilot' tier so
    the £500 one-time unlock gives lifetime Autopilot entitlements. Other
    paid plans default to 'growth' if the title doesn't match the map."""
    plan = event_data.get("plan") or {}
    plan_id = (plan.get("id") or "").strip()
    if plan_id in FOUNDER_PLAN_IDS:
        return "autopilot", True
    if plan_id in PLAN_TIER_BY_ID:
        return PLAN_TIER_BY_ID[plan_id], False
    title = (plan.get("title") or "").strip().lower()
    is_founder = "founder" in title
    if is_founder:
        return "autopilot", True
    tier = PLAN_TIER_BY_TITLE.get(title, "growth")
    return tier, False


@router.post("")
async def whop_webhook(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    body = await request.body()
    _verify_signature(body, request.headers.get("x-whop-signature"))
    payload = json.loads(body.decode())
    event_type = payload.get("event") or payload.get("type", "")
    data = payload.get("data") or {}

    external_id = (
        payload.get("id")
        or data.get("id")
        or hashlib.sha256(body).hexdigest()
    )
    if db.query(WebhookEvent).filter_by(external_id=external_id).one_or_none():
        return {"status": "duplicate", "event": event_type}

    from app.webhook_log import log_webhook
    _MEMBERSHIP_VALID = ("membership_went_valid", "membership.went_valid", "membership_activated", "membership.activated")
    _MEMBERSHIP_INVALID = ("membership_went_invalid", "membership.went_invalid", "membership_canceled", "membership.canceled", "membership_deactivated", "membership.deactivated")
    _PAYMENT = ("payment_succeeded", "payment.succeeded")
    _REFUND = ("payment_refunded", "payment.refunded", "refund_created", "refund.created", "dispute_created", "dispute.created")
    recognized = event_type in (_MEMBERSHIP_VALID + _MEMBERSHIP_INVALID + _PAYMENT + _REFUND)

    try:
        if event_type in _MEMBERSHIP_VALID:
            _handle_membership_valid(db, data)
        elif event_type in _MEMBERSHIP_INVALID:
            _handle_membership_invalid(db, data)
        elif event_type in _PAYMENT:
            _handle_payment_succeeded(db, data)
        elif event_type in _REFUND:
            _handle_payment_refunded(db, data)
        # else: unsupported — accepted but ignored.

        db.add(WebhookEvent(
            provider="whop",
            external_id=external_id,
            event_type=event_type,
            body_hash=hashlib.sha256(body).hexdigest(),
        ))
        db.commit()
    except Exception as exc:  # preserve the existing 500→Whop-retry behaviour
        db.rollback()
        log_webhook(provider="whop", event_name=event_type, status="failed",
                    external_event_id=external_id, user_id=_user_id_for_log(db, data), error=exc)
        raise

    log_webhook(
        provider="whop", event_name=event_type,
        status="handled" if recognized else "ignored",
        external_event_id=external_id,
        user_id=_user_id_for_log(db, data),
        pending_whop_membership_id=_pending_id_for_log(db, data) if recognized else None,
        handled=recognized,
    )
    return {"status": "ok", "event": event_type}


def _user_id_for_log(db: Session, data: dict) -> str | None:
    """Best-effort backend user id for the webhook audit log (id only, never email)."""
    try:
        u = _find_user_for_event(db, data)
        return u.id if u else None
    except Exception:  # noqa: BLE001 — logging metadata is best-effort
        return None


def _pending_id_for_log(db: Session, data: dict) -> str | None:
    """Best-effort latest pending-membership id for this event's buyer email."""
    try:
        email = ((data.get("user") or {}).get("email") or "").strip().lower()
        if not email:
            return None
        row = (
            db.query(PendingWhopMembership)
            .filter(PendingWhopMembership.email == email)
            .order_by(PendingWhopMembership.created_at.desc())
            .first()
        )
        return row.id if row else None
    except Exception:  # noqa: BLE001
        return None


def _find_user_for_event(db: Session, data: dict) -> User | None:
    """Resolve a Whop event to a local user via email or whop_user_id."""
    user_block = data.get("user") or {}
    email = (user_block.get("email") or "").strip().lower()
    whop_user_id = user_block.get("id")

    if whop_user_id:
        user = db.query(User).filter_by(whop_user_id=whop_user_id).one_or_none()
        if user:
            return user
    if email:
        user = db.query(User).filter(User.email.ilike(email)).one_or_none()
        if user:
            return user
    return None


def _stash_pending_membership(db: Session, data: dict, *, tier: str, founder: bool) -> None:
    """Persist an entitlement for a buyer who paid before signing up.

    Keyed by email so /onboarding/link-whop can claim it on first sign-in.
    Idempotent: a webhook retry for the same email+tier that's still
    unconsumed is a no-op. The Whop membership webhook is at-least-once, so
    we de-dup on (email, tier, consumed_at IS NULL) rather than spawn rows.
    """
    user_block = data.get("user") or {}
    email = (user_block.get("email") or "").strip().lower()
    if not email:
        # Nothing to key on — Whop didn't include the buyer email. Drop it;
        # the outer webhook still records the WebhookEvent for idempotency.
        return

    existing = (
        db.query(PendingWhopMembership)
        .filter(
            PendingWhopMembership.email == email,
            PendingWhopMembership.tier == tier,
            PendingWhopMembership.consumed_at.is_(None),
        )
        .one_or_none()
    )
    if existing:
        return  # already parked — webhook retry

    renewal_at = data.get("renewal_period_end")
    db.add(
        PendingWhopMembership(
            email=email,
            tier=tier,
            founder=founder,
            whop_user_id=user_block.get("id"),
            renewal_period_end=int(renewal_at) if isinstance(renewal_at, (int, float)) else None,
        )
    )

    # PostHog: buyer paid on Whop before a Junior user existed; entitlement
    # parked for /onboarding/link-whop to claim. No user id yet, so key the
    # event on the Whop membership/user id. ID + tier only — no email.
    whop_user_id = user_block.get("id")
    if whop_user_id:
        from app import analytics
        analytics.capture(
            user_id=str(whop_user_id),
            event="pending_whop_membership_stashed",
            properties={"tier": tier, "founder": bool(founder), "billing_provider": "whop"},
        )


def apply_membership_tier(
    db: Session,
    user: User,
    *,
    tier: str,
    founder: bool,
    whop_user_id: str | None = None,
    renewal_at: int | float | None = None,
) -> str:
    """Apply a paid Whop tier to a user and issue a fresh license JWT.

    This is the minimal, side-effect-free core shared by the membership
    webhook and the /onboarding/link-whop backfill: it sets tier,
    subscription_status, whop_user_id, paid_until and mints a License row.
    It deliberately does NOT send notifications or email — the webhook path
    layers those on top; the onboarding backfill stays quiet.

    Returns the freshly issued license JWT.
    """
    user.tier = tier
    user.founder_flag = user.founder_flag or founder
    # A membership going valid is the trial/activation, NOT a confirmed recurring
    # payment. Keep non-founder users starter-limited ("trialing") so they can't
    # bypass the 100 free-export cap during a Whop trial; payment_succeeded then
    # promotes them to "active" (true paid → unlimited). Founder is a one-time
    # paid unlock. Never downgrade an already-active (paying) customer.
    if user.founder_flag:
        user.subscription_status = "active"
    elif user.subscription_status != "active":
        user.subscription_status = "trialing"
    if whop_user_id:
        user.whop_user_id = whop_user_id

    if isinstance(renewal_at, (int, float)):
        user.paid_until = datetime.fromtimestamp(renewal_at, tz=timezone.utc)
    elif founder:
        user.paid_until = None  # one-time

    # Keep Clerk publicMetadata in step with the DB — account-app surfaces that
    # still read Clerk metadata (upgrade page, PostHogBoot, dashboard fallback)
    # otherwise show a stale "free". Best-effort; the DB stays source of truth.
    from app.clerk_sync import sync_clerk_metadata
    sync_clerk_metadata(
        user.clerk_id,
        tier=user.tier,
        subscription_status=user.subscription_status,
        founder=user.founder_flag,
        whop_user_id=user.whop_user_id,
    )

    jwt_str, expires_at = issue_license_jwt(
        user_id=user.id,
        tier=tier,
        founder=user.founder_flag,
        quota_videos_per_month=None,
    )
    db.add(License(user_id=user.id, jwt=jwt_str, tier_at_issue=tier, expires_at=expires_at))
    return jwt_str


def _handle_membership_valid(db: Session, data: dict) -> None:
    user = _find_user_for_event(db, data)
    tier, founder = _tier_from_event(data)
    if not user:
        # No Clerk user yet — the buyer paid on Whop before signing up on the
        # website (common for affiliate-referred sales). Park the entitlement
        # in a pending row keyed by email; /onboarding/link-whop applies it
        # the moment they create / sign into their Junior account.
        _stash_pending_membership(db, data, tier=tier, founder=founder)
        return
    apply_membership_tier(
        db,
        user,
        tier=tier,
        founder=founder,
        whop_user_id=(data.get("user") or {}).get("id"),
        renewal_at=data.get("renewal_period_end"),
    )

    # Inbox notification — billing category, dedup-keyed on whop event id so
    # webhook retries don't double-up.
    event_id = data.get("event_id") or data.get("id") or ""
    if user.founder_flag and founder:
        write_notification(
            db,
            user_id=user.id,
            category="founder",
            title=f"Welcome, founder seat #{_seat_count(db)}.",
            body="Channel tier locked for you forever. Liquid Clips is yours from day one of every sprint.",
            priority="high",
            external_dedup_key=f"whop-founder-{event_id}" if event_id else None,
        )
        # Plus a junior_message brand card — the §3.9 voice in action.
        write_notification(
            db,
            user_id=user.id,
            category="junior_message",
            title="Got your founder seat.",
            body=(
                "You're seat #" + str(_seat_count(db)) + " of 2,000. I locked the receipt to your account "
                "and bumped you to Channel forever. The desktop will pull a fresh license next time you open it."
            ),
            priority="medium",
            external_dedup_key=f"junior-founder-welcome-{event_id}" if event_id else None,
        )
    else:
        write_notification(
            db,
            user_id=user.id,
            category="billing",
            title=f"{tier.capitalize()} tier active.",
            body=f"Subscription live. Renews on the date Whop holds. Cancel any time inside Whop.",
            priority="medium",
            external_dedup_key=f"whop-valid-{event_id}" if event_id else None,
        )

    # Branded onboarding email. Founder gets the special welcome; everyone
    # else gets the standard "your plan is live" copy. Non-blocking.
    from app.mailer import send_admin_paid_customer_alert, send_founder_welcome, send_subscription_activated
    first_name = (data.get("user") or {}).get("first_name")
    if user.founder_flag and founder:
        send_founder_welcome(user.email, first_name=first_name if isinstance(first_name, str) else None)
        send_admin_paid_customer_alert(
            customer_email=user.email,
            tier=tier,
            source="founder_unlock",
            monthly_usd="£1 commit",
            note=f"founder seat #{_seat_count(db)} of 2000",
        )
    else:
        send_subscription_activated(
            user.email,
            tier=tier,
            first_name=first_name if isinstance(first_name, str) else None,
            trial=(user.subscription_status == "trialing"),
        )
        send_admin_paid_customer_alert(
            customer_email=user.email,
            tier=tier,
            source="whop_subscription_active",
            note=("trialing" if user.subscription_status == "trialing" else None),
        )

    # PostHog: paid membership went valid via Whop. Distinct event from the
    # Clerk-billing subscription_activated so we can compare funnels.
    if user.clerk_id:
        from app import analytics
        analytics.identify(
            user_id=user.clerk_id,
            tier=tier,
            whop_user_id=user.whop_user_id,
            affiliate_id=user.affiliate_id,
        )
        analytics.capture(
            user_id=user.clerk_id,
            event="whop_membership_valid",
            properties={"tier": tier, "founder": bool(founder)},
        )
        # A non-founder membership going valid is the trial/starter activation
        # (status set to "trialing" by apply_membership_tier). Distinct funnel
        # step from the paid conversion (whop_payment_succeeded).
        if user.subscription_status == "trialing":
            analytics.capture(
                user_id=user.clerk_id,
                event="whop_trial_started",
                properties={
                    "tier": tier,
                    "subscription_status": user.subscription_status,
                    "billing_provider": "whop",
                },
            )


def _seat_count(db: Session) -> int:
    """Best-effort founder seat counter. Sprint 7+: proper sequence."""
    return db.query(User).filter(User.founder_flag.is_(True)).count()


def _handle_membership_invalid(db: Session, data: dict) -> None:
    user = _find_user_for_event(db, data)
    if not user:
        return
    user.subscription_status = "expired"
    user.tier = "free"

    from app.clerk_sync import sync_clerk_metadata
    sync_clerk_metadata(user.clerk_id, tier="free", subscription_status="expired", founder=user.founder_flag)

    jwt_str, expires_at = issue_license_jwt(
        user_id=user.id,
        tier="free",
        quota_videos_per_month=None,
    )
    db.add(License(user_id=user.id, jwt=jwt_str, tier_at_issue="free", expires_at=expires_at))

    event_id = data.get("event_id") or data.get("id") or ""
    write_notification(
        db,
        user_id=user.id,
        category="billing",
        title="Subscription expired.",
        body=(
            "Back to Free — your 100 free clip exports, with your own keys. "
            "Your projects, clips, and folder stay where they are."
        ),
        priority="medium",
        external_dedup_key=f"whop-invalid-{event_id}" if event_id else None,
    )

    # Branded cancellation email — soft retention copy + "reactivate anytime".
    from app.mailer import send_subscription_canceled
    first_name = (data.get("user") or {}).get("first_name")
    paid_until_iso = user.paid_until.isoformat() if user.paid_until else None
    send_subscription_canceled(
        user.email,
        paid_until_iso=paid_until_iso,
        first_name=first_name if isinstance(first_name, str) else None,
    )

    # PostHog: membership went invalid/canceled → tier downgraded to free.
    if user.clerk_id:
        from app import analytics
        analytics.capture(
            user_id=user.clerk_id,
            event="whop_membership_invalid",
            properties={"reason": "canceled", "tier": "free"},
        )


def _handle_payment_succeeded(db: Session, data: dict) -> None:
    user = _find_user_for_event(db, data)
    if not user:
        return
    # Capture state BEFORE mutating — affiliate side-effects below only fire on
    # the first true trial→paid transition, never on a renewal of an already-
    # active subscription.
    was_paid_before = user.subscription_status == "active"
    # A successful payment is the trial→paid conversion: promote to "active" so the
    # 100 free-export cap lifts (true paid → unlimited entitlement).
    user.subscription_status = "active"
    renewal_at = data.get("renewal_period_end")
    if isinstance(renewal_at, (int, float)):
        user.paid_until = datetime.fromtimestamp(renewal_at, tz=timezone.utc)
    else:
        # No explicit renewal date — push out 30 days.
        user.paid_until = datetime.now(timezone.utc) + timedelta(days=30)

    from app.clerk_sync import sync_clerk_metadata
    sync_clerk_metadata(
        user.clerk_id,
        tier=user.tier,
        subscription_status="active",
        founder=user.founder_flag,
        whop_user_id=user.whop_user_id,
    )

    # Admin alert — Daniel gets pinged on every successful invoice. First-paid
    # conversions and renewals both fire, but the `note` distinguishes them.
    from app.mailer import send_admin_paid_customer_alert
    send_admin_paid_customer_alert(
        customer_email=user.email,
        tier=user.tier,
        source="whop_payment_succeeded",
        note=("first paid invoice" if not was_paid_before else "renewal"),
    )

    # PostHog: trial→paid conversion. User is now "active" (true paid). Keyed
    # on clerk_id so it lands on the same person as the frontend funnel.
    if user.clerk_id:
        from app import analytics
        analytics.capture(
            user_id=user.clerk_id,
            event="whop_payment_succeeded",
            properties={
                "tier": user.tier,
                "subscription_status": user.subscription_status,
                "billing_provider": "whop",
            },
        )

    # Affiliate lifecycle emails — fire ONLY on the buyer's first paid
    # conversion (not renewals), and ONLY when the referrer is a known Junior
    # user (their whop_affiliate_id was cached at first /me/affiliate read).
    # Notification dedup_key ensures each affiliate gets each email at most once
    # ever, so webhook retries / repeated triggers are safe.
    if not was_paid_before and user.affiliate_id:
        _fire_affiliate_lifecycle_emails(db, buyer_affiliate_id=user.affiliate_id)


def _fire_affiliate_lifecycle_emails(db: Session, *, buyer_affiliate_id: str) -> None:
    """Side-effect emails to the affiliate (the referrer) when one of their
    referrals first converts to paid. Two emails, both deduped per-affiliate:
      - first_paid_referral: any time their first referral pays
      - affiliate_qualified: once they cross 2 paid referrals (50% unlock)

    Wrapped in try/except so a logging or external-API failure here can never
    block the webhook from acknowledging."""
    try:
        referrer = (
            db.query(User).filter_by(whop_affiliate_id=buyer_affiliate_id).one_or_none()
        )
        if not referrer or not referrer.email:
            # Referrer not cached yet — they haven't viewed /me/affiliate. We
            # can't email them this time; we'll get the next paid conversion
            # after they engage with their dashboard.
            return

        from app.mailer import send_affiliate_qualified, send_first_paid_referral
        from app.routes.affiliate import QUALIFY_PAID_REFERRALS, _fetch_whop_affiliate
        from app.routes.notifications import write_notification

        # First-paid-referral email — write_notification's dedup_key check is
        # the source of truth. If the row inserts, this is the first time;
        # if it returns None, we've already emailed and can skip.
        first_row = write_notification(
            db,
            user_id=referrer.id,
            category="affiliate",
            title="First paid referral landed.",
            body="Someone you referred just converted to a paid Liquid Clips plan. Commission is live on Whop's cycle.",
            priority="medium",
            external_dedup_key=f"first-paid-referral-{referrer.id}",
        )
        if first_row is not None:
            send_first_paid_referral(referrer.email)

        # Qualification email — fires when the affiliate's live paid count
        # reaches the threshold. Re-query Whop for the authoritative count
        # since the dashboard cache could be stale.
        aff = _fetch_whop_affiliate((referrer.email or "").strip().lower())
        if not aff:
            return
        try:
            paid_count = int(aff.get("active_members_count") or 0)
        except (TypeError, ValueError):
            paid_count = 0
        if paid_count >= QUALIFY_PAID_REFERRALS:
            qual_row = write_notification(
                db,
                user_id=referrer.id,
                category="affiliate",
                title="50% recurring unlocked.",
                body="Two paid referrals confirmed. 50% recurring is now active on every customer you refer.",
                priority="high",
                external_dedup_key=f"affiliate-qualified-{referrer.id}",
            )
            if qual_row is not None:
                send_affiliate_qualified(referrer.email)
    except Exception:  # noqa: BLE001
        import logging
        logging.getLogger("junior.webhooks").exception(
            "affiliate lifecycle side-effects failed for aff=%s — webhook continues",
            buyer_affiliate_id,
        )


def _handle_payment_refunded(db: Session, data: dict) -> None:
    """A refund/dispute pulls the entitlement. Critically, if the refunded plan
    was the one-time Founder unlock, clear founder_flag — otherwise a refunded
    founder keeps unlimited Autopilot forever. Drop to Free + mark 'refunded'."""
    user = _find_user_for_event(db, data)
    if not user:
        return
    _tier, founder = _tier_from_event(data)
    if founder:
        user.founder_flag = False
    user.tier = "free"
    user.subscription_status = "refunded"
    user.paid_until = None

    from app.clerk_sync import sync_clerk_metadata
    sync_clerk_metadata(user.clerk_id, tier="free", subscription_status="refunded", founder=user.founder_flag)

    jwt_str, expires_at = issue_license_jwt(user_id=user.id, tier="free", quota_videos_per_month=None)
    db.add(License(user_id=user.id, jwt=jwt_str, tier_at_issue="free", expires_at=expires_at))

    event_id = data.get("event_id") or data.get("id") or ""
    write_notification(
        db,
        user_id=user.id,
        category="billing",
        title="Refund processed.",
        body="Your payment was refunded and access returned to Free. Your projects stay on disk.",
        priority="medium",
        external_dedup_key=f"whop-refund-{event_id}" if event_id else None,
    )

    # PostHog: refund pulled the entitlement → same "invalid" funnel signal as
    # cancellation but with reason="refunded" so we can distinguish in dashboards.
    if user.clerk_id:
        from app import analytics
        analytics.capture(
            user_id=user.clerk_id,
            event="whop_membership_invalid",
            properties={"reason": "refunded", "tier": "free"},
        )
