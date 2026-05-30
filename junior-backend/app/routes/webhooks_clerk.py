"""Clerk webhook handler — see oauth-billing.md §5.

Clerk signs every webhook delivery using svix. We verify the signature
before doing any DB work.

Handled events:
  - user.created          → insert into `users`, lock affiliate_id from metadata,
                            issue first license JWT.
  - user.updated          → sync email (never overwrite affiliate_id).
  - user.deleted          → mark subscription_status='canceled', revoke licenses.
  - subscription.active   → upgrade user.tier from the plan slug, set paid_until.
  - subscription.canceled → mark subscription_status='canceled'; keep tier until period end.
  - subscription.past_due → mark subscription_status='past_due' (license stays live).
  - subscriptionItem.updated → handles upgrade/downgrade (plan change) within an active sub.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from svix.webhooks import Webhook, WebhookVerificationError

from app.config import get_settings
from app.db import get_db
from app.jwt_signer import issue_license_jwt
from app.models import License, User, WebhookEvent
from app.routes.notifications import write_notification

router = APIRouter(prefix="/webhooks/clerk", tags=["webhooks"])
settings = get_settings()


# Clerk plan slug → backend tier value. Slug = brand name, tier = backend value.
# Kept as a map (not identity) so a future brand rename doesn't require touching
# any tier-check logic — just edit this dict.
CLERK_SLUG_TO_TIER: dict[str, str] = {
    "free_user": "free",
    "solo": "solo",
    "growth": "growth",
    "autopilot": "autopilot",
}


def _verify_and_parse(request: Request, body: bytes) -> dict:
    if not settings.clerk_webhook_secret:
        # Dev mode without secret — still parse so we can iterate. Production
        # always sets CLERK_WEBHOOK_SECRET; assert if missing in prod-ish env.
        return json.loads(body.decode())
    headers = {k.lower(): v for k, v in request.headers.items()}
    try:
        wh = Webhook(settings.clerk_webhook_secret)
        return wh.verify(body, headers)
    except WebhookVerificationError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid svix signature") from None


def _already_processed(db: Session, svix_id: str, body_hash: str) -> bool:
    existing = db.query(WebhookEvent).filter_by(external_id=svix_id).one_or_none()
    return existing is not None


@router.post("")
async def clerk_webhook(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    body = await request.body()
    payload = _verify_and_parse(request, body)
    event_type = payload.get("type", "")
    data: dict[str, Any] = payload.get("data", {}) or {}

    svix_id = request.headers.get("svix-id") or hashlib.sha256(body).hexdigest()
    body_hash = hashlib.sha256(body).hexdigest()
    if _already_processed(db, svix_id, body_hash):
        return {"status": "duplicate", "event": event_type}

    from app.webhook_log import log_webhook
    _KNOWN = (
        "user.created", "user.updated", "user.deleted",
        "subscription.active", "subscriptionItem.updated",
        "subscription.canceled", "subscription.past_due",
    )
    recognized = event_type in _KNOWN
    try:
        if event_type == "user.created":
            _handle_user_created(db, data, _client_ip(request))
        elif event_type == "user.updated":
            _handle_user_updated(db, data)
        elif event_type == "user.deleted":
            _handle_user_deleted(db, data)
        elif event_type in ("subscription.active", "subscriptionItem.updated"):
            _handle_subscription_active(db, data)
        elif event_type == "subscription.canceled":
            _handle_subscription_canceled(db, data)
        elif event_type == "subscription.past_due":
            _handle_subscription_past_due(db, data)
        # else: unsupported — accepted but ignored.

        db.add(WebhookEvent(provider="clerk", external_id=svix_id, event_type=event_type, body_hash=body_hash))
        db.commit()
    except Exception as exc:  # preserve existing failure→retry behaviour; log first
        db.rollback()
        log_webhook(provider="clerk", event_name=event_type, status="failed",
                    external_event_id=svix_id, user_id=_clerk_user_id_for_log(db, data), error=exc)
        raise

    log_webhook(
        provider="clerk", event_name=event_type,
        status="handled" if recognized else "ignored",
        external_event_id=svix_id,
        user_id=_clerk_user_id_for_log(db, data),
        handled=recognized,
    )
    return {"status": "ok", "event": event_type}


def _clerk_user_id_for_log(db: Session, data: dict) -> str | None:
    """Best-effort backend user id for the webhook audit log (id only, never email)."""
    try:
        cid = data.get("id") or _user_id_from_payer(data)
        if not cid:
            return None
        u = db.query(User).filter_by(clerk_id=cid).one_or_none()
        return u.id if u else None
    except Exception:  # noqa: BLE001 — logging metadata is best-effort
        return None


def _primary_email(data: dict) -> str:
    primary_id = data.get("primary_email_address_id")
    for entry in data.get("email_addresses", []) or []:
        if entry.get("id") == primary_id:
            return entry.get("email_address", "")
    # Fallback: first email address.
    addrs = data.get("email_addresses") or []
    return addrs[0].get("email_address", "") if addrs else ""


def _client_ip(request: Request) -> str | None:
    """Best-effort IP capture for free-tier abuse gating. Prefer X-Forwarded-For
    (Railway/Cloudflare set this) then request.client. Trim port if present.
    Returns None for the dev curl path with no client info."""
    xff = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
    if xff:
        # Take the first hop, that's the originating client.
        return xff.split(",")[0].strip() or None
    real = request.headers.get("x-real-ip") or request.headers.get("X-Real-IP")
    if real:
        return real.strip() or None
    if request.client and request.client.host:
        return request.client.host
    return None


def _handle_user_created(db: Session, data: dict, ip_address: str | None = None) -> None:
    clerk_id = data.get("id")
    if not clerk_id:
        return
    if db.query(User).filter_by(clerk_id=clerk_id).one_or_none():
        return  # idempotency — webhook re-delivery

    metadata = (data.get("unsafe_metadata") or {})
    affiliate_id = metadata.get("affiliate_id") if isinstance(metadata.get("affiliate_id"), str) else None

    user = User(
        clerk_id=clerk_id,
        email=_primary_email(data),
        tier="free",
        subscription_status="trial",
        affiliate_id=affiliate_id,
        ip_address=ip_address,
    )
    db.add(user)
    db.flush()

    jwt_str, expires_at = issue_license_jwt(
        user_id=user.id,
        tier="free",
        quota_videos_per_month=None,  # free is gated by the 100 clip-export starter pass
    )
    db.add(License(user_id=user.id, jwt=jwt_str, tier_at_issue="free", expires_at=expires_at))

    # Brand-voice welcome — the §3.9 chat-rotator finally has a permanent home.
    write_notification(
        db,
        user_id=user.id,
        category="junior_message",
        title="Liquid Clips is ready.",
        body=(
            "Drop a recording in and I'll cut it. 100 free clip exports to start, your keys, "
            "your files. When you outgrow it, upgrading is one click."
        ),
        priority="high",
        external_dedup_key=f"junior-welcome-{user.id}",
    )

    # Branded onboarding email — non-blocking. Resend errors don't break
    # the webhook ack; failures are logged in app.mailer.
    from app.mailer import send_welcome
    first_name = (data.get("first_name") or None) if isinstance(data.get("first_name"), str) else None
    send_welcome(user.email, first_name=first_name)

    # PostHog: signup completed + affiliate attribution locked. We identify
    # with the Clerk id so the frontend's signup_started (also keyed on
    # clerk_id) and our server-side signup_completed are on the same person.
    from app import analytics
    analytics.identify(
        user_id=clerk_id,
        clerk_id=clerk_id,
        affiliate_id=affiliate_id,
        tier="free",
    )
    analytics.capture(
        user_id=clerk_id,
        event="signup_completed",
        properties={"has_affiliate": bool(affiliate_id)},
    )
    if affiliate_id:
        analytics.capture(
            user_id=clerk_id,
            event="affiliate_attribution_locked",
            properties={"affiliate_id": affiliate_id},
        )


def _handle_user_updated(db: Session, data: dict) -> None:
    clerk_id = data.get("id")
    if not clerk_id:
        return
    user = db.query(User).filter_by(clerk_id=clerk_id).one_or_none()
    if not user:
        # Webhook arrived out of order — create the user via the same path.
        # No request context here; IP is captured only on the canonical
        # user.created delivery.
        _handle_user_created(db, data, ip_address=None)
        return
    new_email = _primary_email(data)
    if new_email and new_email != user.email:
        user.email = new_email
    # NEVER touch user.affiliate_id — first-touch locked per oauth-billing.md §6.


def _handle_user_deleted(db: Session, data: dict) -> None:
    clerk_id = data.get("id")
    if not clerk_id:
        return
    user = db.query(User).filter_by(clerk_id=clerk_id).one_or_none()
    if not user:
        return
    user.subscription_status = "canceled"
    for lic in user.licenses:
        lic.revoked = True


# --- Billing subscription events -------------------------------------------

def _user_id_from_payer(data: dict) -> str | None:
    """Clerk subscription payloads carry the user id under data.payer.user_id
    (for user-payer subs) — fall back to a few alternate shapes."""
    payer = data.get("payer") or {}
    return (
        payer.get("user_id")
        or data.get("user_id")
        or data.get("subscriber_id")
        or None
    )


def _plan_slug_from_subscription(data: dict) -> str | None:
    """Pull the active plan slug out of a subscription / subscriptionItem
    payload. Subscriptions carry items[].plan.slug; item events carry
    plan.slug directly. Both shapes are handled here."""
    items = data.get("items") or []
    for item in items:
        plan = item.get("plan") or {}
        slug = plan.get("slug")
        if slug:
            return slug
    plan = data.get("plan") or {}
    return plan.get("slug")


def _parse_period_end(data: dict) -> datetime | None:
    raw = (
        data.get("period_end")
        or data.get("current_period_end")
        or data.get("ends_at")
    )
    if raw is None:
        return None
    try:
        if isinstance(raw, (int, float)):
            # Clerk timestamps are seconds, not ms — but be defensive.
            if raw > 10**12:
                raw = raw / 1000.0
            return datetime.fromtimestamp(raw, tz=timezone.utc)
        if isinstance(raw, str):
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (ValueError, OSError):
        return None
    return None


def _handle_subscription_active(db: Session, data: dict) -> None:
    clerk_id = _user_id_from_payer(data)
    if not clerk_id:
        return
    user = db.query(User).filter_by(clerk_id=clerk_id).one_or_none()
    if not user:
        # Out-of-order delivery: subscription event arrived before user.created.
        # Skip; the next re-delivery (or the user's first /sync) will reconcile.
        return

    slug = _plan_slug_from_subscription(data)
    new_tier = CLERK_SLUG_TO_TIER.get(slug or "")
    if new_tier:
        user.tier = new_tier
    user.subscription_status = "active"
    period_end = _parse_period_end(data)
    if period_end:
        user.paid_until = period_end

    # Mirror to Clerk publicMetadata — nothing else writes tier there, so the
    # upgrade page / PostHogBoot / dashboard fallback would otherwise read "free".
    from app.clerk_sync import sync_clerk_metadata
    sync_clerk_metadata(clerk_id, tier=user.tier, subscription_status="active", founder=user.founder_flag)

    from app import analytics
    analytics.capture(
        user_id=clerk_id,
        event="subscription_activated",
        properties={
            "tier": user.tier,
            "via": "clerk",
            # Affiliate attribution for the conversion funnel — paid conversion
            # is the event the affiliate flywheel optimises for. ID only.
            "affiliate_id": user.affiliate_id,
            "billing_provider": "whop" if user.whop_user_id else "clerk",
        },
    )
    analytics.identify(user_id=clerk_id, tier=user.tier)

    write_notification(
        db,
        user_id=user.id,
        category="billing",
        title=f"You're on {user.tier.capitalize()}.",
        body="Upgraded. New limits and features apply immediately.",
        priority="medium",
        external_dedup_key=f"sub-active-{user.id}-{user.tier}-{period_end.isoformat() if period_end else 'now'}",
    )


def _handle_subscription_canceled(db: Session, data: dict) -> None:
    clerk_id = _user_id_from_payer(data)
    if not clerk_id:
        return
    user = db.query(User).filter_by(clerk_id=clerk_id).one_or_none()
    if not user:
        return
    user.subscription_status = "canceled"
    # We DO NOT downgrade tier here — the user keeps access through paid_until.
    # The /sync endpoint issues licenses with tier=user.tier, the entitlement
    # grace in starter_export_remaining keeps exports unlimited until paid_until,
    # and the hourly billing-sweep cron drops them to Free once it passes.
    period_end = _parse_period_end(data)
    if period_end:
        user.paid_until = period_end

    from app.clerk_sync import sync_clerk_metadata
    sync_clerk_metadata(clerk_id, tier=user.tier, subscription_status="canceled", founder=user.founder_flag)

    # Cancellation email — the Whop path already sends one; the Clerk path didn't.
    from app.mailer import send_subscription_canceled
    first_name = user.email.split("@")[0] if user.email else None
    send_subscription_canceled(
        user.email,
        paid_until_iso=user.paid_until.isoformat() if user.paid_until else None,
        first_name=first_name,
    )

    from app import analytics
    analytics.capture(
        user_id=clerk_id,
        event="subscription_canceled",
        properties={"tier": user.tier, "via": "clerk"},
    )


def _handle_subscription_past_due(db: Session, data: dict) -> None:
    clerk_id = _user_id_from_payer(data)
    if not clerk_id:
        return
    user = db.query(User).filter_by(clerk_id=clerk_id).one_or_none()
    if not user:
        return
    user.subscription_status = "past_due"
    from app.clerk_sync import sync_clerk_metadata
    sync_clerk_metadata(clerk_id, tier=user.tier, subscription_status="past_due", founder=user.founder_flag)
    write_notification(
        db,
        user_id=user.id,
        category="billing",
        title="Payment didn't go through.",
        body="Clerk will retry. Update your card to avoid losing access.",
        priority="high",
        external_dedup_key=f"sub-pastdue-{user.id}-{datetime.now(timezone.utc).date().isoformat()}",
    )
