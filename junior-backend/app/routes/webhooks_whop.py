"""Whop webhook handler — see oauth-billing.md §5.

Whop follows the Standard Webhooks specification. We verify the signed
webhook id, timestamp, and raw body before processing.

Event handling:
  - membership_went_valid   → tier=<plan>, subscription_status='trialing'
  - membership_went_invalid → subscription_status='expired'
  - membership_canceled     → retain tier until period end
  - payment_succeeded       → bump paid_until
  - payment_failed          → past_due, retain tier while Whop retries
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from svix.webhooks import Webhook, WebhookVerificationError

from app.config import get_settings
from app.db import get_db
from app.jwt_signer import issue_license_jwt
from app.models import License, PendingWhopMembership, User, WebhookDeadLetter, WebhookEvent
from app.routes.notifications import write_notification

router = APIRouter(prefix="/webhooks/whop", tags=["webhooks"])
settings = get_settings()


# ─────────────────────────────────────────────────────────────────────
# Layer 1 · reliability sprint · 2026-07-04
#
# Observability + dead-letter primitives. Sentry breadcrumbs attach to the
# current scope so a subsequent captured exception carries the last N webhook
# entry/exit events — invaluable when a handler dies mid-transaction. When
# Sentry isn't initialised (dev, tests without DSN) the calls no-op.
#
# The dead-letter table is a diagnostic + replay artefact. Whop's own
# at-least-once retry cadence is still the primary recovery path; the
# dead-letter row lets an operator replay AHEAD of Whop's schedule and gives
# the reconciliation cron something to compare drift against.
# ─────────────────────────────────────────────────────────────────────


def _add_breadcrumb(*, category: str, message: str, data: dict | None = None) -> None:
    """Best-effort Sentry breadcrumb. No-op when sentry_sdk is missing / not
    initialised. Never raises. Called at entry + exit of every _handle_*
    function so a subsequent captured exception carries the sequence."""
    try:
        import sentry_sdk
        sentry_sdk.add_breadcrumb(
            category=category,
            message=message,
            level="info",
            data=data or {},
        )
    except Exception:  # noqa: BLE001 — breadcrumbs must never break the handler
        pass


def _is_duplicate_event(db: Session, external_id: str) -> bool:
    """The outer-guard idempotency check, extracted so every mutating branch
    can be reasoned about explicitly. Returns True when a WebhookEvent row
    already exists for this external_id, meaning the payload has already been
    processed (or is being re-tried by Whop after a network hiccup)."""
    return (
        db.query(WebhookEvent).filter_by(external_id=external_id).one_or_none()
        is not None
    )


def _record_dead_letter(
    db: Session,
    *,
    event_id: str,
    event_type: str,
    payload_json: str,
    error: str,
) -> str:
    """Insert a dead-letter row in a fresh, isolated session so the outer
    handler's rollback doesn't take it with the failed transaction.

    Returns the inserted row id. Best-effort — a dead-letter write failure
    must never mask the underlying handler exception (which the caller
    re-raises so Whop retries).
    """
    from app.db import SessionLocal
    try:
        with SessionLocal() as fresh:
            row = WebhookDeadLetter(
                event_id=event_id or "unknown",
                event_type=event_type or "unknown",
                payload_json=payload_json,
                error=(error or "")[:2000],
                retry_count=0,
            )
            fresh.add(row)
            fresh.commit()
            return row.id
    except Exception:  # noqa: BLE001
        return ""


def retry_dead_letter(db: Session, dead_letter_id: str) -> tuple[bool, str]:
    """Replay a dead-letter row through the appropriate _handle_* branch.

    Returns (success, note). Idempotency is still preserved by the outer
    WebhookEvent guard — a successful replay stamps resolved_at + increments
    retry_count so the row disappears from the "pending replay" query.

    NOT auto-scheduled — an operator or the future reconciliation cron
    triggers this explicitly. Live-fires against the DB session passed in;
    keeps sentry breadcrumbs attached to the replay operation.
    """
    row = db.get(WebhookDeadLetter, dead_letter_id)
    if row is None:
        return False, f"dead_letter_id_not_found:{dead_letter_id}"
    if row.resolved_at is not None:
        return True, "already_resolved"

    _add_breadcrumb(
        category="webhook.whop.retry",
        message=f"replaying dead-letter {row.id}",
        data={"event_type": row.event_type, "event_id": row.event_id, "attempt": row.retry_count + 1},
    )

    try:
        payload = json.loads(row.payload_json)
    except Exception as exc:  # noqa: BLE001
        row.error = f"payload_parse_failed:{exc}"[:2000]
        row.retry_count = (row.retry_count or 0) + 1
        row.last_attempted_at = datetime.now(timezone.utc)
        db.commit()
        return False, "payload_parse_failed"

    data = payload.get("data") or {}
    event_type = row.event_type

    try:
        if event_type in ("membership_went_valid", "membership.went_valid", "membership_activated", "membership.activated"):
            _handle_membership_valid(db, data)
        elif event_type in ("membership_went_invalid", "membership.went_invalid", "membership_deactivated", "membership.deactivated"):
            _handle_membership_invalid(db, data)
        elif event_type in ("membership_canceled", "membership.canceled"):
            _handle_membership_canceled(db, data)
        elif event_type == "membership.cancel_at_period_end_changed":
            _handle_membership_cancel_setting_changed(db, data)
        elif event_type in ("payment_succeeded", "payment.succeeded"):
            _handle_payment_succeeded(db, data)
        elif event_type in ("payment_failed", "payment.failed"):
            _handle_payment_failed(db, data)
        elif event_type in ("payment_refunded", "payment.refunded", "refund_created", "refund.created", "dispute_created", "dispute.created"):
            _handle_payment_refunded(db, data)
        elif event_type in ("bounty_created", "bounty.created", "content_reward.created", "campaign_created", "campaign.created"):
            _handle_bounty_created(db, data)
        else:
            row.error = f"unsupported_event_type:{event_type}"[:2000]
            row.retry_count = (row.retry_count or 0) + 1
            row.last_attempted_at = datetime.now(timezone.utc)
            db.commit()
            return False, "unsupported_event_type"

        row.resolved_at = datetime.now(timezone.utc)
        row.retry_count = (row.retry_count or 0) + 1
        row.last_attempted_at = datetime.now(timezone.utc)
        db.commit()
        return True, "retry_succeeded"
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        # Re-fetch after rollback so we can persist the retry attempt.
        row = db.get(WebhookDeadLetter, dead_letter_id)
        if row is not None:
            row.error = f"retry_failed:{exc}"[:2000]
            row.retry_count = (row.retry_count or 0) + 1
            row.last_attempted_at = datetime.now(timezone.utc)
            db.commit()
        return False, f"retry_failed:{exc}"


# Map Whop plan IDs → our internal tiers.
#
# Public-facing tier names on liquidclips.app are **Free / Solo / Pro / Agency**
# (see liquidclips-marketing/src/app/terms/page.tsx + help/billing-and-plans).
# Internally we still store the legacy values `solo / growth / autopilot`; the
# alias map in app/features.py::_LEGACY_TIER_ALIASES translates `growth → pro`
# and `autopilot → agency` at the entitlement-read layer. Don't rename the
# stored values without migrating every existing row + alias map together.
#
# Keys are lowercased — the lookup lowercases the incoming plan title so a
# title cased differently by Whop ("Liquid Clips Solo") still resolves. We
# carry BOTH the new "liquid clips X" / "jnr X" titles and the legacy
# "junior X" titles so a Whop rename can land without a backend deploy.
PLAN_TIER_BY_TITLE = {
    # New brand — Liquid Clips
    "liquid clips solo": "solo",
    "liquid clips pro": "growth",       # public "Pro" → internal "growth"
    "liquid clips agency": "autopilot", # public "Agency" → internal "autopilot"
    "liquid clips founder": "autopilot",
    # Whop dashboard shorthand — "jnr X"
    "jnr solo": "solo",
    "jnr pro": "growth",
    "jnr agency": "autopilot",
    "jnr founder": "autopilot",
    # Legacy — Junior brand (pre-rebrand). Kept so old memberships keep mapping.
    "junior solo": "solo",
    "junior pro": "growth",      # legacy prod_V8UzHw4fxCqaJ — back-compat
    "junior growth": "growth",
    "junior channel": "growth",  # legacy alias
    "junior autopilot": "autopilot",
    "junior founder": "autopilot",
}

# PRIMARY mapping: Whop plans here carry no `title` (the v2 API returns title=null),
# so title-matching is unreliable — match by the stable plan id first. These are
# the live USD plans on the LiquidClips Whop product (prod_V8UzHw4fxCqaJ),
# created 2026-05-25 under the legacy "Junior" brand and currently labelled
# "jnr X" on the Whop dashboard. Public site copy reads "Liquid Clips Solo / Pro
# / Agency". When new plan IDs are minted under the Liquid Clips brand, add
# them here — do NOT remove the legacy IDs, existing memberships still resolve
# through them.
#
# 2026-07-02 · Phase 2 of the 3-tier agency ladder. The three new price
# points are ENV-DRIVEN so Daniel can create the plans in the Whop
# dashboard (or via scripts/create_whop_agency_plans.py) and paste the
# resulting `plan_xxx` ids into Railway without a code deploy:
#   · WHOP_PLAN_ID_AGENCY_SOLO       → agency_solo       ($50/mo)
#   · WHOP_PLAN_ID_AGENCY            → agency            ($299/mo)
#   · WHOP_PLAN_ID_AGENCY_WHITELABEL → agency_whitelabel ($500/mo)
# Missing env vars mean the mapping is a no-op — existing hardcoded
# rows keep working, so unwiring the env vars never breaks anyone.
PLAN_TIER_BY_ID = {
    "plan_qe8AFXj9J3SWi": "solo",       # Liquid Clips Solo   ($29.99/mo)
    "plan_dhssNse4FfPlI": "growth",     # Liquid Clips Growth ($99.99/mo) · real, separately-purchasable tier — see PricingCards.tsx on the account-app dashboard. Do not repoint Agency checkout here; a buyer would be misclassified.
    "plan_0revJ8hp7YDO6": "autopilot",  # Liquid Clips Agency ($99.99/mo) · minted 2026-08-05 · the actual checkout target now (account-app/src/lib/whopPlans.ts). initial_price=0 matches the Growth/Solo pattern.
    "plan_fcYLS5GWhd3t7": "autopilot",  # Liquid Clips Agency ($99.99/mo) · SUPERSEDED same day · initial_price was mistakenly set to 99.99 alongside renewal_price, doubling day-one checkout to $199.98. No longer a checkout target; kept mapped in case anyone slipped through before the fix.
    "plan_BvDBrtybhbxNg": "autopilot",  # Liquid Clips Agency ($500/mo) · legacy · retired as a checkout target 2026-08-05 (app copy always promised $99.99) · kept mapped so any pre-existing $500 membership still resolves correctly
}


def _load_agency_ladder_plan_map() -> dict[str, str]:
    """Read the three new-tier env vars into a `{plan_id: tier}` fragment
    that gets merged onto `PLAN_TIER_BY_ID` at request time. Called on
    every event so a Railway env-var flip lands without a redeploy."""
    import os
    out: dict[str, str] = {}
    for tier_key, env_name in (
        ("agency_solo",       "WHOP_PLAN_ID_AGENCY_SOLO"),
        ("agency",            "WHOP_PLAN_ID_AGENCY"),
        ("agency_whitelabel", "WHOP_PLAN_ID_AGENCY_WHITELABEL"),
    ):
        plan_id = (os.environ.get(env_name) or "").strip()
        if plan_id:
            out[plan_id] = tier_key
    return out

# Founder unlocks → Autopilot tier + founder_flag while the subscription is
# active. Match by plan id: the webhook can send title=null (like the renewal
# plans above do), so a title-only check would let a Founder buy fall through
# to "growth". Keep this set in sync with the live Whop founder plans.
#
# One-time lifetime founder retains the flag forever (never canceled). The
# monthly Founder Access cohort ($99.99/mo, cap 12,000) keeps the flag while
# their subscription is valid — membership.canceled flips it off, resub flips
# it back on. Cap enforcement lives in the checkout gate, not here.
FOUNDER_PLAN_IDS = {
    "plan_OieNCPrvkw9U4",  # Liquid Clips Founder Lifetime · $500 one-time
    "plan_VWj1uoy2RcOsg",  # LEGACY Founder Access · hidden, grandfathered · retained so pre-2026-07-05 checkouts still resolve
    "plan_svbzoXoT4oj6b",  # PRIOR Founder Access · 365-day trial version · grandfathered · retained so pre-ship-walk checkouts still resolve
    "plan_NMKvKj8SVVKsY",  # Liquid Clips Founder Access v2 · $99.99/mo · immediate charge · unlocks clip 11+ · cap 12,000 · rotated 2026-07-05 post-ship-walk
}

# v2.2.17 · one-time top-up plans that grant metered credit instead of
# a tier upgrade. The webhook branches early when it sees these ids so
# _require_known_tier isn't asked to resolve them (they don't map to a
# subscription tier).
BOOST_PACK_PLAN_IDS = {
    "plan_xLS3gGsJ16455": 25,  # Thumbnail Boost Pack $9 · 25 batches
}

# 2026-07-06 · Whop-authorization plans · $1 one_time card-on-file trust
# wall. User pays $1 at LoginScreen (Gate 1). NO tier upgrade — they stay
# at the default free tier (10-clip cap + feature ransom paywalls do the
# real limiting app-side). Whop is used only to force card entry so the
# downstream ransom paywall (Gate 2 · plan_NMKvKj8SVVKsY) gets one-click
# confirm. Webhook branches early to avoid _require_known_tier ValueError.
# Timestamp is stashed at users.whop_authorized_at so we know card is on file.
WHOP_AUTHORIZATION_PLAN_IDS = {
    "plan_SMaXhQLXpSOaH",  # Liquid Clips Whop authorization · $1 one_time
}


def _verify_signature(body: bytes, headers: dict[str, str]) -> None:
    # Env-gated fail-closed: production refuses when the secret is unset
    # (defense-in-depth on top of main.lifespan boot guard). Non-production
    # keeps the accept-without-verify dev bypass so local iteration and
    # existing tests that monkeypatch ``webhooks_whop.settings`` directly
    # continue to work. Prior behaviour was fail-open in every environment.
    if not settings.whop_webhook_secret:
        if settings.env == "production":
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "server misconfigured · WHOP_WEBHOOK_SECRET unset",
            )
        return  # dev / test bypass
    required = ("webhook-id", "webhook-timestamp", "webhook-signature")
    if any(not headers.get(name) for name in required):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing webhook signature headers")
    try:
        # New Whop webhooks return a Standard Webhooks `whsec_` secret.
        # Older dashboard hooks used a raw `ws_` secret, so retain a
        # compatibility path until all production hooks have rotated.
        secret: str | bytes = settings.whop_webhook_secret
        if not secret.startswith("whsec_"):
            secret = secret.encode()
        Webhook(secret).verify(body, headers)
    except WebhookVerificationError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid signature")
    except Exception as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid signature") from exc


def _tier_from_event(event_data: dict) -> tuple[str, bool] | None:
    """Returns (tier, is_founder). Founder always maps to 'autopilot' tier so
    the £500 one-time unlock gives lifetime Autopilot entitlements. Other
    unknown plans fail closed so an unrelated Whop product can never grant
    paid Liquid Clips access.

    2026-07-02 · Env-driven agency-ladder plan IDs merged in first — Daniel
    pastes them into Railway after dashboard/script plan creation and the
    map lands without a code deploy."""
    plan = event_data.get("plan") or {}
    plan_id = (plan.get("id") or "").strip()
    if plan_id in FOUNDER_PLAN_IDS:
        return "autopilot", True
    # Env-driven agency ladder wins over the hardcoded map so Daniel can
    # remap $500 from legacy `autopilot` to `agency_whitelabel` (or any
    # other reassignment) with a Railway env-var change alone.
    env_map = _load_agency_ladder_plan_map()
    if plan_id in env_map:
        return env_map[plan_id], False
    if plan_id in PLAN_TIER_BY_ID:
        return PLAN_TIER_BY_ID[plan_id], False
    title = (plan.get("title") or "").strip().lower()
    is_founder = "founder" in title
    if is_founder:
        return "autopilot", True
    tier = PLAN_TIER_BY_TITLE.get(title)
    return (tier, False) if tier else None


def _require_known_tier(event_data: dict) -> tuple[str, bool]:
    resolved = _tier_from_event(event_data)
    if resolved is None:
        plan = event_data.get("plan") or {}
        raise ValueError(f"unrecognized Whop plan id={plan.get('id')!r}")
    return resolved


@router.post("")
async def whop_webhook(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    body = await request.body()
    headers = {key.lower(): value for key, value in request.headers.items()}
    _verify_signature(body, headers)
    payload = json.loads(body.decode())
    event_type = payload.get("event") or payload.get("type", "")
    data = payload.get("data") or {}

    external_id = (
        headers.get("webhook-id")
        or payload.get("id")
        or data.get("id")
        or hashlib.sha256(body).hexdigest()
    )
    _add_breadcrumb(
        category="webhook.whop",
        message=f"received {event_type}",
        data={"external_id": external_id, "event_type": event_type},
    )
    if _is_duplicate_event(db, external_id):
        _add_breadcrumb(
            category="webhook.whop",
            message=f"duplicate {event_type}",
            data={"external_id": external_id},
        )
        return {"status": "duplicate", "event": event_type}

    from app.webhook_log import log_webhook
    _MEMBERSHIP_VALID = ("membership_went_valid", "membership.went_valid", "membership_activated", "membership.activated")
    _MEMBERSHIP_INVALID = ("membership_went_invalid", "membership.went_invalid", "membership_deactivated", "membership.deactivated")
    _MEMBERSHIP_CANCELED = ("membership_canceled", "membership.canceled")
    _MEMBERSHIP_CANCEL_SETTING = ("membership.cancel_at_period_end_changed",)
    _PAYMENT = ("payment_succeeded", "payment.succeeded")
    _PAYMENT_FAILED = ("payment_failed", "payment.failed")
    _REFUND = ("payment_refunded", "payment.refunded", "refund_created", "refund.created", "dispute_created", "dispute.created")
    # 2026-06-24 · submission events from Whop content-rewards · flip
    # CampaignSubmission.status + RewardClip.status from "submitted" to the
    # Whop verdict (approved · rejected · paid). Without these, clippers
    # see "submitted · waiting" forever even after Whop pays out.
    _SUBMISSION_APPROVED = ("submission_approved", "submission.approved", "content_reward.submission.approved", "content_reward.approved")
    _SUBMISSION_REJECTED = ("submission_rejected", "submission.rejected", "content_reward.submission.rejected", "content_reward.rejected")
    _SUBMISSION_PAID = ("submission_paid", "submission.paid", "content_reward.payout.paid", "payout.paid")
    # G2 · Layer 6 (2026-07-04) · Whop affiliate payment event ·
    # credits 50% of MRR to the referring user's wallet ledger.
    _PAYMENT_AFFILIATE = ("payment_affiliate", "payment.affiliate", "affiliate_payment", "affiliate.payment")
    recognized = event_type in (
        _MEMBERSHIP_VALID + _MEMBERSHIP_INVALID + _MEMBERSHIP_CANCELED
        + _MEMBERSHIP_CANCEL_SETTING
        + _PAYMENT + _PAYMENT_FAILED + _REFUND
        + _SUBMISSION_APPROVED + _SUBMISSION_REJECTED + _SUBMISSION_PAID
        + _PAYMENT_AFFILIATE
    )

    try:
        if event_type in _MEMBERSHIP_VALID:
            _handle_membership_valid(db, data)
        elif event_type in _MEMBERSHIP_INVALID:
            _handle_membership_invalid(db, data)
        elif event_type in _MEMBERSHIP_CANCELED:
            _handle_membership_canceled(db, data)
        elif event_type in _MEMBERSHIP_CANCEL_SETTING:
            _handle_membership_cancel_setting_changed(db, data)
        elif event_type in _PAYMENT:
            _handle_payment_succeeded(db, data)
        elif event_type in _PAYMENT_FAILED:
            _handle_payment_failed(db, data)
        elif event_type in _REFUND:
            _handle_payment_refunded(db, data)
        elif event_type in _SUBMISSION_APPROVED:
            _handle_submission_verdict(db, data, verdict="approved")
        elif event_type in _SUBMISSION_REJECTED:
            _handle_submission_verdict(db, data, verdict="rejected")
        elif event_type in _SUBMISSION_PAID:
            _handle_submission_verdict(db, data, verdict="paid")
        elif event_type in _PAYMENT_AFFILIATE:
            _handle_payment_affiliate(db, data)
        # else: unsupported — accepted but ignored.

        db.add(WebhookEvent(
            provider="whop",
            external_id=external_id,
            event_type=event_type,
            body_hash=hashlib.sha256(body).hexdigest(),
        ))
        db.commit()
        _add_breadcrumb(
            category="webhook.whop",
            message=f"handled {event_type}",
            data={"external_id": external_id, "recognized": recognized},
        )
    except Exception as exc:  # preserve the existing 500→Whop-retry behaviour
        db.rollback()
        # Layer 1 · dead-letter capture. Writes in a fresh session so the
        # rollback above doesn't take it. Best-effort — a dead-letter failure
        # never masks the original exception (which we re-raise so Whop retries).
        try:
            _record_dead_letter(
                db,
                event_id=external_id,
                event_type=event_type,
                payload_json=body.decode("utf-8", errors="replace"),
                error=f"{type(exc).__name__}: {exc}",
            )
        except Exception:  # noqa: BLE001
            pass
        _add_breadcrumb(
            category="webhook.whop",
            message=f"failed {event_type}",
            data={"external_id": external_id, "error_type": type(exc).__name__},
        )
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
    """Resolve a Whop event to a local user via email or whop_user_id.

    2026-08-11 — was .one_or_none() on both lookups. users.email has no DB
    unique constraint and duplicate-email rows are a confirmed live issue
    (see auth_whop.py's callback fix earlier). A duplicate email threw
    sqlalchemy.exc.MultipleResultsFound here, which the caller's outer
    try/except turns into a 500 → Whop retries the same event against the
    same broken lookup forever, so that user silently stops getting wallet
    ledger credits / tier updates from Whop with no visible error. Most-
    recently-created row wins, matching the same fix applied elsewhere."""
    user_block = data.get("user") or {}
    email = (user_block.get("email") or "").strip().lower()
    whop_user_id = user_block.get("id")

    if whop_user_id:
        user = (
            db.query(User)
            .filter_by(whop_user_id=whop_user_id)
            .order_by(User.created_at.desc())
            .first()
        )
        if user:
            return user
    if email:
        user = (
            db.query(User)
            .filter(User.email.ilike(email))
            .order_by(User.created_at.desc())
            .first()
        )
        if user:
            return user
    return None


def _stash_pending_membership(
    db: Session,
    data: dict,
    *,
    tier: str,
    founder: bool,
    paid: bool = False,
) -> None:
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
        if paid:
            existing.paid = True
        return  # already parked — webhook retry

    renewal_at = data.get("renewal_period_end")
    db.add(
        PendingWhopMembership(
            email=email,
            tier=tier,
            founder=founder,
            paid=paid,
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
    paid: bool = False,
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
    if user.founder_flag or paid:
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

    # 2026-07-02 · Phase 2 · agency-tier 50% MRR commission override.
    # Deck slide 07 promise: agency-tier owners "skip the gate and earn
    # from day one." Whop's default affiliate rate follows the
    # qualification gate (11K views OR 2 paid refs). We push a 50%
    # override onto the owner's Whop user record whenever they land on
    # an agency-family tier so referrals credit 50% recurring
    # immediately.
    #
    # Best-effort: `set_affiliate_custom_commission` never raises. If
    # the Whop API path isn't available on the account, it LOGS the
    # override request so an admin can apply it via dashboard.
    #
    # We import lazily so the webhook module doesn't fail import when
    # whop_payments is missing an env var in dev.
    from app.features import is_agency_tier
    if is_agency_tier(tier) and user.whop_user_id:
        try:
            from app.whop_payments import set_affiliate_custom_commission
            set_affiliate_custom_commission(
                whop_user_id=user.whop_user_id,
                rate_bps=5000,
            )
        except Exception:
            # Never let the commission override break the tier grant.
            import logging
            logging.getLogger(__name__).warning(
                "[whop-agency] custom commission override failed · user_id=%s · tier=%s",
                user.id, tier, exc_info=True,
            )

    return jwt_str


def _populate_whop_company_id(user: User, data: dict) -> None:
    """2026-07-07 · Extract Whop company_id and mirror to users.whop_company_id.

    Surfaced to Agency Campaigns page for openWhopAction(BOUNTY_CREATE, {companyId}).
    Never clobbers a non-null value — a user only belongs to one Whop company
    at a time so overwrites would be a data-integrity bug.

    Ship-lens SF-P1-003 · Whop payload shape varies by event + API version.
    Check all 5 documented locations before giving up."""
    if user.whop_company_id:
        return
    # Path 1: top-level company_id (most common on membership.went_valid)
    candidates: list[str] = [(data.get("company_id") or "").strip()]
    # Path 2: nested company object (some v2 payloads)
    company = data.get("company") or {}
    if isinstance(company, dict):
        candidates.append((company.get("id") or "").strip())
    # Path 3: nested membership.company_id (payment.succeeded sometimes)
    membership = data.get("membership") or {}
    if isinstance(membership, dict):
        candidates.append((membership.get("company_id") or "").strip())
        m_company = membership.get("company") or {}
        if isinstance(m_company, dict):
            candidates.append((m_company.get("id") or "").strip())
    # Path 4: nested plan.company_id (plan-first payloads)
    plan = data.get("plan") or {}
    if isinstance(plan, dict):
        candidates.append((plan.get("company_id") or "").strip())
    # Path 5: nested access_pass.company_id (bundle events)
    access_pass = data.get("access_pass") or {}
    if isinstance(access_pass, dict):
        candidates.append((access_pass.get("company_id") or "").strip())

    for cid in candidates:
        if cid:
            user.whop_company_id = cid
            return


def _handle_bounty_created(db: Session, data: dict) -> None:
    """2026-07-07 · Whop bounty/content-reward created via our openWhopAction
    handoff (Sprint Final §1C · Max Lane 2).

    Delegates to Max's `whop_bounty_mirror.bounty_mirror()` which has the
    correct SponsoredCampaign model shape (slug, name, brand, whop_url,
    budget_cents, type, status, duration_label). My earlier raw-SQL
    version referenced columns that don't exist on the model — every
    write failed silently under the try/except. Lens finding SF-P0-001.

    Payload shape (Whop-verified 2026-07-07 probe):
      { id, company_id, prize, currency, title, description, created_at,
        url, metadata: { liquid_clips_source_campaign_id?, ... } }
    """
    whop_bounty_id = (data.get("id") or "").strip()
    if not whop_bounty_id:
        return
    company_id = (data.get("company_id") or "").strip()
    prize_cents_val = data.get("prize")
    try:
        prize_cents = int(round(float(prize_cents_val) * 100)) if prize_cents_val is not None else 0
    except (TypeError, ValueError):
        prize_cents = 0
    title = (data.get("title") or "")[:200] or "Whop paid post"
    whop_url = (data.get("url") or "").strip() or f"https://whop.com/dashboard/{company_id}/bounties/{whop_bounty_id}"
    metadata = data.get("metadata") or {}
    source_campaign_id: str | None = None
    if isinstance(metadata, dict):
        src = (metadata.get("liquid_clips_source_campaign_id") or "").strip()
        source_campaign_id = src or None
    brand = (data.get("brand") or "").strip() or None
    expires_at = data.get("expires_at")

    from app.routes.whop_bounty_mirror import BountyMirrorPayload, bounty_mirror

    try:
        bounty_mirror(
            BountyMirrorPayload(
                whop_bounty_id=whop_bounty_id,
                whop_bounty_url=whop_url,
                source_campaign_id=source_campaign_id,
                prize_cents=prize_cents,
                title=title,
                brand=brand,
                expires_at=expires_at if isinstance(expires_at, str) else None,
            ),
            db,
        )
    except Exception:  # noqa: BLE001
        # Never break the webhook chain on mirror failure. Whop is the
        # source of truth; reconciler cron will backfill.
        db.rollback()


def _handle_membership_valid(db: Session, data: dict) -> None:
    _add_breadcrumb(category="webhook.whop.membership_valid", message="enter")
    # 2026-07-06 · Whop authorization ($1 one_time) also fires
    # membership.went_valid. Same short-circuit as _handle_payment_succeeded:
    # no tier upgrade, just stamp whop_authorized_at.
    _plan = data.get("plan") or {}
    _plan_id = (_plan.get("id") or "").strip()
    if _plan_id in WHOP_AUTHORIZATION_PLAN_IDS:
        _user = _find_user_for_event(db, data)
        if _user is not None and _user.whop_authorized_at is None:
            _user.whop_authorized_at = datetime.utcnow()
            db.commit()
        _add_breadcrumb(
            category="webhook.whop.membership_valid",
            message="whop_authorization_recorded",
            data={"plan_id": _plan_id},
        )
        return

    user = _find_user_for_event(db, data)
    tier, founder = _require_known_tier(data)

    # Task F · Founder Access seat-cap gate. When the incoming plan is
    # a Founder plan AND the 12,000-seat cap is reached, refuse the
    # tier grant + stashed pending row · we return early after a
    # warning breadcrumb. Whop-side `seat_cap=12000` on
    # plan_VWj1uoy2RcOsg is the parallel enforcement rail; this local
    # gate lets us stay honest even if the Whop metadata drifts.
    plan_block = data.get("plan") or {}
    plan_id = (plan_block.get("id") or "").strip()
    whop_membership_id = (
        data.get("membership_id")
        or data.get("id")
        or (data.get("membership") or {}).get("id")
        or ""
    ).strip()
    if plan_id in FOUNDER_PLAN_IDS:
        from app.routes.founder import try_grant_founder_seat

        if not whop_membership_id:
            # Rare but real · Whop sent a Founder membership webhook
            # without an id. Refuse rather than double-grant on retry.
            _add_breadcrumb(
                category="webhook.whop.membership_valid",
                message="exit_founder_no_membership_id",
                data={"plan_id": plan_id},
            )
            return
        ok, reason = try_grant_founder_seat(
            db,
            whop_membership_id=whop_membership_id,
            plan_id=plan_id,
            user_id=(user.id if user is not None else None),
            whop_user_id=(data.get("user") or {}).get("id"),
        )
        if not ok:
            # TODO(cohort-0-founder-void) · fire the Whop payment-void
            # API here so the buyer isn't charged when we refuse the
            # tier. For Cohort 0 no real Founder payments have hit yet
            # so the parallel Whop-side seat_cap metadata is enough.
            _add_breadcrumb(
                category="webhook.whop.membership_valid",
                message="exit_cohort_full",
                data={
                    "plan_id": plan_id,
                    "membership_id": whop_membership_id,
                    "reason": reason,
                },
            )
            return
        # `granted` or `idempotent` both fall through to the normal
        # tier-application path below.

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

    # 2026-07-07 · Populate whop_company_id for the Agency Campaigns page.
    _populate_whop_company_id(user, data)

    # 2026-07-06 · LC-ID mint + welcome email. Public sign-in ID surfaced
    # to the buyer via a Resend email so they can paste it into the
    # desktop's recovery input as a fallback for the deep link. Idempotent:
    # the mint helper returns the existing lc_id when one is already set;
    # the welcome email is deliberately re-sent so a retried webhook still
    # helps the buyer if the earlier delivery hit spam. Never raises so a
    # Resend outage can't kill the webhook.
    try:
        from app.routes.lc_ids import (
            MintForUserRequest,
            SendWelcomeEmailRequest,
            mint_for_user,
            send_welcome_email,
        )
        whop_receipt_id = (
            (data.get("receipt") or {}).get("id")
            or (data.get("payment") or {}).get("receipt_id")
            or data.get("receipt_id")
        )
        mint_res = mint_for_user(
            body=MintForUserRequest(user_id=user.id),
            db=db,
            _internal=True,
        )
        send_welcome_email(
            body=SendWelcomeEmailRequest(
                user_id=user.id,
                lc_id=mint_res.lc_id,
                whop_receipt_id=(str(whop_receipt_id) if whop_receipt_id else None),
            ),
            db=db,
            _internal=True,
        )
    except Exception:
        import logging as _lc_log
        _lc_log.getLogger(__name__).warning(
            "[whop.lc_id] mint/email failed · user_id=%s", user.id, exc_info=True,
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
        # 2026-07-05 · CM-T3 · Founder cohort copy DRIFT fix. The seat
        # count denominator was "2,000" · master audit + integration-lens
        # flagged this because `founder.py:50 MAX_FOUNDER_SEATS = 12_000`
        # and the marketing site advertises 12,000. Users would screenshot
        # the mismatch. Now sources the canonical cap from
        # `founder.founder_seats_used` + `MAX_FOUNDER_SEATS` so any future
        # cap change flows through without re-editing this message.
        from app.routes.founder import founder_seats_used, MAX_FOUNDER_SEATS
        seat_used = founder_seats_used(db)
        write_notification(
            db,
            user_id=user.id,
            category="junior_message",
            title="Got your founder seat.",
            body=(
                f"You're seat #{seat_used} of {MAX_FOUNDER_SEATS:,}. I locked the receipt "
                "to your account and bumped you to Channel forever. The desktop will pull "
                "a fresh license next time you open it."
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
    _add_breadcrumb(category="webhook.whop.membership_valid", message="exit", data={"tier": tier, "founder": founder})


def _seat_count(db: Session) -> int:
    """DEPRECATED · 2026-07-05 · CM-T3. The canonical founder seat
    counter is `founder.founder_seats_used(db)` which reads the
    `FounderSeat` table (the same row `try_grant_founder_seat` writes).
    This helper counted `User.founder_flag=True` · a mirror that could
    drift from the seat-grant source of truth.

    Kept for one compat release · every caller in this module has been
    migrated to the canonical function. Delete in the next backend
    sprint after confirming no external callers via git-grep."""
    from app.routes.founder import founder_seats_used
    return founder_seats_used(db)


def _reconcile_affiliate_commission_best_effort(
    db: Session,
    user: User,
    *,
    context: str,
) -> None:
    try:
        from app.services.affiliate_commission import reconcile_user

        reconcile_user(db, user)
    except Exception:  # noqa: BLE001
        import logging as _logging

        _logging.getLogger("junior.webhooks").exception(
            "affiliate commission reconcile failed for user=%s context=%s",
            user.id,
            context,
        )


def _handle_membership_invalid(db: Session, data: dict) -> None:
    _add_breadcrumb(category="webhook.whop.membership_invalid", message="enter")
    user = _find_user_for_event(db, data)
    if not user:
        _add_breadcrumb(category="webhook.whop.membership_invalid", message="exit_no_user")
        return
    # Partner Engine — decrement BEFORE mutating subscription_status so the
    # "was this user previously paid?" guard is honest. Only decrement on a
    # true paid→non-paid transition (renewals that briefly toggle don't
    # un-count). Floor at 0 inside _bump_referrer_counter.
    was_paid_before = user.subscription_status == "active"
    if was_paid_before:
        _bump_referrer_counter(db, user, delta=-1)
    user.subscription_status = "expired"
    user.tier = "free"
    _reconcile_affiliate_commission_best_effort(
        db,
        user,
        context="membership_invalid",
    )

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
    _add_breadcrumb(category="webhook.whop.membership_invalid", message="exit")


def _handle_membership_canceled(db: Session, data: dict) -> None:
    """Cancellation stops renewal but must not revoke already-paid access.

    Whop later sends membership.deactivated at period end; that event performs
    the actual downgrade to Free.
    """
    _add_breadcrumb(category="webhook.whop.membership_canceled", message="enter")
    user = _find_user_for_event(db, data)
    if not user:
        _add_breadcrumb(category="webhook.whop.membership_canceled", message="exit_no_user")
        return
    user.subscription_status = "canceled"
    renewal_at = data.get("renewal_period_end")
    if isinstance(renewal_at, (int, float)):
        user.paid_until = datetime.fromtimestamp(renewal_at, tz=timezone.utc)

    from app.clerk_sync import sync_clerk_metadata
    sync_clerk_metadata(
        user.clerk_id,
        tier=user.tier,
        subscription_status="canceled",
        founder=user.founder_flag,
        whop_user_id=user.whop_user_id,
    )
    event_id = data.get("event_id") or data.get("id") or ""
    write_notification(
        db,
        user_id=user.id,
        category="billing",
        title="Subscription canceled.",
        body="Whop stopped renewal. Your paid access stays active until the end of the current billing period.",
        priority="medium",
        external_dedup_key=f"whop-canceled-{event_id}" if event_id else None,
    )
    _add_breadcrumb(category="webhook.whop.membership_canceled", message="exit")


def _handle_membership_cancel_setting_changed(db: Session, data: dict) -> None:
    """Apply Whop's current cancel-at-period-end event in either direction."""
    if bool(data.get("cancel_at_period_end")):
        _handle_membership_canceled(db, data)
        return
    user = _find_user_for_event(db, data)
    if not user:
        return
    reported = str(data.get("status") or "").lower()
    user.subscription_status = "trialing" if reported == "trialing" else "active"
    from app.clerk_sync import sync_clerk_metadata
    sync_clerk_metadata(
        user.clerk_id,
        tier=user.tier,
        subscription_status=user.subscription_status,
        founder=user.founder_flag,
        whop_user_id=user.whop_user_id,
    )


def _handle_payment_failed(db: Session, data: dict) -> None:
    """Keep the tier during Whop's retry window and surface the billing issue."""
    _add_breadcrumb(category="webhook.whop.payment_failed", message="enter")
    user = _find_user_for_event(db, data)
    if not user:
        _add_breadcrumb(category="webhook.whop.payment_failed", message="exit_no_user")
        return
    user.subscription_status = "past_due"
    from app.clerk_sync import sync_clerk_metadata
    sync_clerk_metadata(
        user.clerk_id,
        tier=user.tier,
        subscription_status="past_due",
        founder=user.founder_flag,
        whop_user_id=user.whop_user_id,
    )
    event_id = data.get("event_id") or data.get("id") or ""
    write_notification(
        db,
        user_id=user.id,
        category="billing",
        title="Payment needs attention.",
        body="Whop could not renew your subscription. Update your payment method in Whop while it retries.",
        priority="high",
        external_dedup_key=f"whop-payment-failed-{event_id}" if event_id else None,
    )
    _add_breadcrumb(category="webhook.whop.payment_failed", message="exit")


def _handle_payment_succeeded(db: Session, data: dict) -> None:
    _add_breadcrumb(category="webhook.whop.payment_succeeded", message="enter")
    # v2.2.17 · Boost Pack top-ups fire the same payment_succeeded event
    # as subscription payments. Detect the boost plan first, grant the
    # metered credit, then short-circuit before we try to resolve a
    # (nonexistent) subscription tier. The credit is additive so buying
    # 3 packs = 75 batches, tracked separately from the monthly quota.
    plan = data.get("plan") or {}
    plan_id = (plan.get("id") or "").strip()

    # 2026-07-06 · Whop authorization ($1 one_time · card on file).
    # Short-circuit BEFORE _require_known_tier — this plan does not grant
    # a tier, it only proves the user has a card on Whop's customer profile
    # so downstream ransom paywalls get one-click confirm. User stays at
    # the default free tier; the 10-clip cap + feature ransom paywalls
    # (Gate 2 · plan_NMKvKj8SVVKsY) do the real gating.
    if plan_id in WHOP_AUTHORIZATION_PLAN_IDS:
        user = _find_user_for_event(db, data)
        if user is None:
            log = logging.getLogger("junior.webhooks_whop")
            log.info(
                "[whop_authorization] no matching user for plan=%s · event=%s",
                plan_id, data.get("id"),
            )
            return
        if user.whop_authorized_at is None:
            user.whop_authorized_at = datetime.utcnow()
            db.commit()
        _add_breadcrumb(
            category="webhook.whop.payment_succeeded",
            message="whop_authorization_recorded",
            data={"plan_id": plan_id, "user_id": user.id},
        )
        return

    if plan_id in BOOST_PACK_PLAN_IDS:
        grant = BOOST_PACK_PLAN_IDS[plan_id]
        user = _find_user_for_event(db, data)
        if user is None:
            log = logging.getLogger("junior.webhooks_whop")
            log.info(
                "[boost_pack] no matching user for plan=%s · event=%s",
                plan_id, data.get("id"),
            )
            return
        user.thumbnail_batches_boost_credit = (
            (user.thumbnail_batches_boost_credit or 0) + grant
        )
        db.commit()
        # Best-effort inbox notification so the user sees the top-up
        # instantly instead of guessing why the counter jumped.
        try:
            from app.routes.notifications import write_notification
            write_notification(
                db,
                user_id=user.id,
                category="billing",
                title=f"Boost Pack applied · {grant} thumbnails",
                body=(
                    f"{grant} extra thumbnail batches just landed on your account. "
                    "They stack on top of any monthly allowance and never expire."
                ),
                priority="medium",
                external_dedup_key=f"boost-pack-{data.get('id')}",
            )
        except Exception:  # noqa: BLE001
            pass
        return

    user = _find_user_for_event(db, data)
    tier, founder = _require_known_tier(data)
    if not user:
        _stash_pending_membership(
            db,
            data,
            tier=tier,
            founder=founder,
            paid=True,
        )
        return
    # Capture state BEFORE mutating — affiliate side-effects below only fire on
    # the first true trial→paid transition, never on a renewal of an already-
    # active subscription.
    was_paid_before = user.subscription_status == "active"
    if not was_paid_before and user.first_paid_at is None:
        user.first_paid_at = datetime.now(timezone.utc)
        # 2026-07-07 · Crew referral attribution. When a user makes their
        # first payment, credit the referrer's crew_invites row so the
        # wallet pipeline "paying" count moves + total_earned_cents
        # accumulates the referrer's cut (50% of this payment).
        try:
            from sqlalchemy import text as _sql_text
            payment_cents = int(round(float(data.get("final_amount") or 0) * 100))
            # SF-P2-001 · half-cent rounding fix. int() floors so 4999.5
            # → 4999. Add half before floor to round-half-up.
            referrer_cut = (payment_cents + 1) // 2  # ceil-div for positive int
            db.execute(
                _sql_text(
                    """
                    UPDATE crew_invites
                    SET first_payment_cents = COALESCE(first_payment_cents, :cents),
                        first_payment_at = COALESCE(first_payment_at, now()),
                        total_earned_cents = total_earned_cents + :cut
                    WHERE activated_user_id = :uid
                    """
                ),
                {"cents": payment_cents, "cut": referrer_cut, "uid": user.id},
            )
        except Exception:  # noqa: BLE001
            pass
    # A successful payment is the trial→paid conversion: promote to "active" so the
    # 100 free-export cap lifts (true paid → unlimited entitlement).
    # Whop does not guarantee webhook ordering. If payment.succeeded arrives
    # before membership.activated, apply the purchased tier here as well.
    tier_changed = user.tier != tier or (founder and not user.founder_flag)
    if tier_changed:
        apply_membership_tier(
            db,
            user,
            tier=tier,
            founder=founder,
            whop_user_id=(data.get("user") or {}).get("id"),
            renewal_at=data.get("renewal_period_end"),
            paid=True,
        )
    else:
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

    # A paid Liquid Clips member is eligible to promote. In live mode this
    # provisions their 30%-first-payment baseline overrides immediately;
    # qualification upgrades the same overrides after the 7-day hold.
    _reconcile_affiliate_commission_best_effort(
        db,
        user,
        context="payment_succeeded",
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
    _add_breadcrumb(
        category="webhook.whop.payment_succeeded",
        message="exit",
        data={"tier": user.tier, "first_paid": not was_paid_before},
    )

    # Affiliate lifecycle emails — fire ONLY on the buyer's first paid
    # conversion (not renewals), and ONLY when the referrer is a known Junior
    # user (their whop_affiliate_id was cached at first /me/affiliate read).
    # Notification dedup_key ensures each affiliate gets each email at most once
    # ever, so webhook retries / repeated triggers are safe.
    if not was_paid_before and user.affiliate_id:
        # Partner Engine — bump the referrer's local paid-sub counter BEFORE
        # the lifecycle email so the qualified-email check reads the fresh
        # count. Counter is the transactional source of truth for the unlock
        # state machine (Whop's live active_members_count is read for display
        # only — too racey to gate state on).
        _bump_referrer_counter(db, user, delta=+1)
        _fire_affiliate_lifecycle_emails(
            db,
            buyer_affiliate_id=user.affiliate_id,
            paid_at=user.first_paid_at,
        )
        # Partner Engine unlock — try to flip the referrer to Partner if
        # both conditions are now met (10 paid + verified TikTok). The
        # service is idempotent and safe when conditions aren't met yet.
        # Re-resolve the referrer (lifecycle helper has its own lookup, no
        # shared object).
        referrer = _find_referrer_by_affiliate_token(db, user.affiliate_id)
        if referrer:
            from app.services.partner_unlock import try_unlock_partner
            try:
                try_unlock_partner(db, referrer)
            except Exception:  # noqa: BLE001
                import logging as _log
                _log.getLogger("junior.webhooks").exception(
                    "[partner_unlock] failed for referrer=%s — webhook continues",
                    referrer.id,
                )


def _bump_referrer_counter(db: Session, buyer: User, *, delta: int) -> None:
    """Increment / decrement the referrer's `referred_paid_subs` counter when
    one of their referrals first converts to paid (delta=+1) or churns out
    (delta=-1). Floors at 0. Best-effort — a missing referrer (cold cache or
    no prior `/affiliate/me` view) just no-ops; lifecycle emails handle the
    same edge separately and accept the same skip.

    Resolves referrer by `buyer.affiliate_id → User.whop_affiliate_id`, the
    same reverse-lookup used by `_fire_affiliate_lifecycle_emails`. Skip if
    no referrer or no own-affiliate cached.
    """
    if not buyer.affiliate_id:
        return
    referrer = _find_referrer_by_affiliate_token(db, buyer.affiliate_id)
    if not referrer:
        return
    current = referrer.referred_paid_subs or 0
    referrer.referred_paid_subs = max(0, current + delta)


def _find_referrer_by_affiliate_token(db: Session, token: str | None) -> User | None:
    """Resolve legacy aff_* ids and current Whop username affiliate codes."""
    if not token:
        return None
    return (
        db.query(User)
        .filter(
            or_(
                User.whop_affiliate_id == token,
                User.whop_affiliate_code == token,
            )
        )
        .one_or_none()
    )


def _fire_affiliate_lifecycle_emails(
    db: Session,
    *,
    buyer_affiliate_id: str,
    paid_at: datetime | None,
) -> None:
    """Send the deduped first-paid-referral message.

    Qualification is owned by the 7-day commission reconciler and fires only
    after Whop confirms every required override. Wrapped so mail/analytics
    failures never block the webhook acknowledgment.
    """
    try:
        referrer = _find_referrer_by_affiliate_token(db, buyer_affiliate_id)
        if not referrer or not referrer.email:
            # A legacy referrer may predate eager affiliate provisioning.
            return

        # Whop's buyer payment timestamp is the only truthful source for
        # this milestone. Never substitute the referrer's own first_paid_at.
        if paid_at is not None:
            from app.onboarding_milestones import mark_milestone
            mark_milestone(
                db,
                referrer,
                "first_paid_referral",
                at=paid_at,
            )

        from app.mailer import send_admin_affiliate_milestone, send_first_paid_referral
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
            # Admin alert — Daniel sees every first-paid-referral land. Idempotent
            # by virtue of being inside the dedup-keyed Notification branch.
            send_admin_affiliate_milestone(
                affiliate_email=referrer.email,
                milestone="first_paid_referral",
            )

        # Qualification is intentionally NOT fired here. The commission
        # reconciler waits for two buyers to remain paid for 7 days, creates
        # the Whop overrides, and only then sends the qualified notification.
    except Exception:  # noqa: BLE001
        import logging
        logging.getLogger("junior.webhooks").exception(
            "affiliate lifecycle side-effects failed for aff=%s — webhook continues",
            buyer_affiliate_id,
        )


def _handle_submission_verdict(db: Session, data: dict, *, verdict: str) -> None:
    """2026-06-24 · close the clipper-submission feedback loop.

    Whop fires submission webhooks once moderators flip a submission's status.
    We map the verdict to our CampaignSubmission.status column. Without this,
    clippers see "submitted · waiting" forever even after Whop pays out.

    verdict values map 1:1 to CampaignSubmission.status:
      - "approved" · mod said clip qualifies · still awaiting view-payout
      - "rejected" · violated rules · payout blocked · clipper sees reason
      - "paid"     · view-RPM verified · USD landed in Whop balance

    Resolution strategy (whichever ID Whop sends):
      1. data.submission_id or data.id      → match CampaignSubmission.whop_submission_id
      2. data.clip_url                       → match CampaignSubmission.clip_url
      3. (last resort) data.user.id + recent → most recent submission for the user

    Also mirrors verdict to RewardClip.status when whop_submission_id matches —
    the Earn dashboard / $50 carrot module read this field for the per-clip
    status pill.
    """
    from app.models import CampaignSubmission, RewardClip

    sub_id = (
        data.get("submission_id")
        or data.get("id")
        or (data.get("submission") or {}).get("id")
    )
    clip_url = data.get("clip_url") or (data.get("submission") or {}).get("clip_url")

    row: CampaignSubmission | None = None

    if sub_id:
        row = (
            db.query(CampaignSubmission)
            .filter(CampaignSubmission.whop_submission_id == sub_id)
            .order_by(CampaignSubmission.created_at.desc())
            .first()
        )

    if row is None and clip_url:
        row = (
            db.query(CampaignSubmission)
            .filter(CampaignSubmission.clip_url == clip_url)
            .order_by(CampaignSubmission.created_at.desc())
            .first()
        )

    if row is None:
        # Last resort · match by user + most recent submission. Whop usually
        # includes the buyer in the event payload.
        user = _find_user_for_event(db, data)
        if user:
            row = (
                db.query(CampaignSubmission)
                .filter(CampaignSubmission.user_id == user.id)
                .order_by(CampaignSubmission.created_at.desc())
                .first()
            )

    if row is None:
        # Webhook arrived for a submission we don't know about · idempotent no-op.
        # Whop's at-least-once delivery means this will retry; if it never matches,
        # the audit log shows status="ignored" for the event_type.
        return

    # Apply the verdict. Map "approved" → "accepted" (our existing enum value).
    db_status_for_verdict = {
        "approved": "accepted",
        "rejected": "rejected",
        "paid":     "paid",
    }
    new_status = db_status_for_verdict.get(verdict, row.status)
    row.status = new_status

    # Pull payout amount if Whop sent it on a "paid" event.
    if verdict == "paid":
        amount = (
            data.get("amount_cents")
            or data.get("payout_amount_cents")
            or ((data.get("payout") or {}).get("amount_cents"))
        )
        if amount is not None:
            try:
                row.payout_usd_cents = max(0, int(amount))
            except (TypeError, ValueError):
                pass
        verified_views = (
            data.get("verified_views")
            or ((data.get("submission") or {}).get("verified_views"))
        )
        if verified_views is not None:
            try:
                row.verified_views = max(0, int(verified_views))
            except (TypeError, ValueError):
                pass

    # Pull rejection reason if present.
    if verdict == "rejected":
        reason = (
            data.get("rejection_reason")
            or data.get("reason")
            or ((data.get("submission") or {}).get("rejection_reason"))
        )
        if reason:
            row.rejection_reason = str(reason)[:1000]

    # Stamp the Whop ID on the row if we matched via clip_url or user fallback
    # (idempotent · already stamped when matched via whop_submission_id).
    if sub_id and not row.whop_submission_id:
        row.whop_submission_id = str(sub_id)

    # Mirror to RewardClip if one exists (Earn dashboard reads from here).
    if sub_id:
        rc = (
            db.query(RewardClip)
            .filter(RewardClip.whop_submission_id == sub_id)
            .one_or_none()
        )
        if rc:
            rc.status = new_status

    # v2.2.11 money-flow close-the-loop · on verdict=paid fire the
    # branded receipt email AND drop a payout row into the in-app inbox
    # so creators see "money landed" the moment they boot the desktop.
    # Wrapped in try/except so a mailer or inbox failure cannot 500 the
    # Whop webhook (which would trigger retries and double-fire side
    # effects). external_dedup_key = "submission-paid-{whop_id}" makes
    # the inbox row idempotent across the at-least-once retries Whop
    # is known for.
    if verdict == "paid":
        try:
            from app.mailer import send_bounty_paid
            from app.routes.notifications import write_notification

            # Author lookup · use the row's user_id which is canonical.
            author = db.get(User, row.user_id) if row.user_id else None
            payout_cents = int(getattr(row, "payout_usd_cents", 0) or 0)
            payout_label = f"${payout_cents / 100:,.2f}" if payout_cents else "your earnings"
            bounty_title = getattr(row, "campaign_title", None) or (
                getattr(row.campaign, "title", None) if getattr(row, "campaign", None) else None
            ) or "your reward campaign"
            dedup_key = (
                f"submission-paid-{row.whop_submission_id or row.id}"
            )

            if author and author.email:
                send_bounty_paid(
                    author.email,
                    bounty_title=str(bounty_title)[:120],
                    payout=payout_label,
                )

            if author:
                write_notification(
                    db,
                    user_id=author.id,
                    category="payout",
                    title=f"Paid · {payout_label}",
                    body=(
                        f"Whop verified the view-RPM on {bounty_title!s} "
                        f"and dropped {payout_label} into your wallet."
                    )[:600],
                    priority="high",
                    action_kind="open_wallet",
                    action_data={
                        "submission_id": row.whop_submission_id or row.id,
                        "payout_cents": payout_cents,
                        "campaign_title": str(bounty_title)[:120],
                    },
                    external_dedup_key=dedup_key,
                )
        except Exception:  # noqa: BLE001 · side-effects must never 500 the webhook
            log = logging.getLogger("junior.webhooks_whop")
            log.exception("[submission_paid] side-effects failed for row=%s", row.id)


def _handle_payment_refunded(db: Session, data: dict) -> None:
    """A refund/dispute pulls the entitlement. Critically, if the refunded plan
    was the one-time Founder unlock, clear founder_flag — otherwise a refunded
    founder keeps unlimited Autopilot forever. Drop to Free + mark 'refunded'."""
    _add_breadcrumb(category="webhook.whop.payment_refunded", message="enter")
    user = _find_user_for_event(db, data)
    if not user:
        _add_breadcrumb(category="webhook.whop.payment_refunded", message="exit_no_user")
        return
    resolved = _tier_from_event(data)
    if resolved is None:
        return
    _tier, founder = resolved
    # Partner Engine — decrement the referrer's counter BEFORE mutating, same
    # rule as membership_invalid. Refund of a never-paid sub is a no-op
    # because was_paid_before will be false.
    was_paid_before = user.subscription_status == "active"
    if was_paid_before:
        _bump_referrer_counter(db, user, delta=-1)
    if founder:
        user.founder_flag = False
    user.tier = "free"
    user.subscription_status = "refunded"
    user.paid_until = None
    _reconcile_affiliate_commission_best_effort(
        db,
        user,
        context="payment_refunded",
    )

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

    # Click-wrap agreement · Set-Off · $50 admin fee against pending
    # commissions + freeze the signature row so the nightly scheduler
    # skips this user. Chargeback / dispute variants all land in the
    # same handler; refund events are treated as material breach per
    # Section 3 of `docs/legal/affiliate-agreement-v1.0.md`.
    try:
        _apply_agreement_setoff(db, user, event_type_hint="payment_refunded_or_disputed")
    except Exception as e:  # noqa: BLE001 · never 500 the webhook
        logging.getLogger("junior.webhooks_whop").exception(
            "[affiliate_agreement.setoff] failed for user=%s: %s", user.id, e
        )

    _add_breadcrumb(category="webhook.whop.payment_refunded", message="exit")


ADMIN_FEE_USD_CENTS = 5000  # $50.00 per Section 3.C


def _apply_agreement_setoff(db: Session, user, *, event_type_hint: str) -> None:
    """Right-of-set-off wiring for the Partner & Affiliate Agreement.

    On a dispute/refund/chargeback event:
      1. Debit the pending wallet balance by $50 (admin fee). Bounded
         by the available pending balance so we never take a user's
         balance negative — anything unrecovered is written off. Whop
         owns the actual money movement; we adjust our internal
         ``WalletLedger`` so the scheduler + wallet UI reflect the
         forfeiture.
      2. Freeze every active ``AffiliateAgreementSignature`` row for
         this user. The nightly payout scheduler filters frozen rows
         out of the batch, so no further commissions flow to Whop
         until the freeze clears.

    Idempotent: every debit carries a webhook-derived
    ``whop_membership_id`` + ``period_start`` so replayed webhooks
    dedupe on the ``uq_wallet_ledger_dedupe`` unique index. Freeze is
    idempotent because ``freeze_signature`` no-ops on already-frozen
    rows.
    """
    from app import wallet as _wallet_service
    from app.routes.affiliate_agreement import freeze_signature

    # Debit whichever is smaller — the fee or the current pending balance
    # (never take pending negative on set-off).
    try:
        pending = _wallet_service.compute_pending(db, user.id)
    except Exception:  # noqa: BLE001
        pending = 0
    fee = min(ADMIN_FEE_USD_CENTS, max(pending, 0))
    if fee > 0:
        try:
            _wallet_service.record_debit(
                db,
                user_id=user.id,
                amount_cents=fee,
                currency="USD",
                source="chargeback_admin_fee",
                whop_membership_id=str(_extract_membership_id_hint(user, event_type_hint) or ""),
                period_start=datetime.now(timezone.utc),
            )
        except IntegrityError:
            db.rollback()  # replay already recorded this debit
        except AttributeError:
            # ``record_debit`` lands with Layer 6.5 — no-op until then.
            pass
        except Exception as e:  # noqa: BLE001
            logging.getLogger("junior.webhooks_whop").warning(
                "[affiliate_agreement.setoff] debit failed for user=%s: %s", user.id, e
            )

    freeze_signature(db, user, reason=f"whop:{event_type_hint}")


def _extract_membership_id_hint(user, event_type_hint: str) -> str | None:
    """Best-effort — the caller only has ``user`` in scope, so we fall
    back to a synthetic key that still deduplicates within the same
    day. Real membership id lives on the event data; this hint keeps
    the ledger dedupe key populated when it isn't otherwise available."""
    return f"setoff-{user.id}-{event_type_hint}-{datetime.now(timezone.utc).date().isoformat()}"


# ─────────────────────────────────────────────────────────────────────
# G2 · Layer 6 · payment.affiliate → 50% MRR wallet credit
# ─────────────────────────────────────────────────────────────────────


def _extract_period_start(data: dict) -> datetime:
    """Best-effort period_start extractor. Whop's payment.affiliate
    payload carries either ``period_start`` (unix seconds) or
    ``current_period_start`` on the membership block. Fallback to the
    current UTC time so we still get a dedupe key even if the wire
    shape drifts — a missed key means we might double-credit on a
    replay, but Layer 1 idempotency (WebhookEvent.external_id) still
    catches the same webhook id."""
    for key in ("period_start", "current_period_start", "started_at"):
        v = data.get(key)
        if v is None:
            continue
        try:
            return datetime.fromtimestamp(int(v), tz=timezone.utc)
        except (TypeError, ValueError, OSError):
            continue
    membership = data.get("membership") or {}
    for key in ("period_start", "current_period_start", "started_at"):
        v = membership.get(key)
        if v is None:
            continue
        try:
            return datetime.fromtimestamp(int(v), tz=timezone.utc)
        except (TypeError, ValueError, OSError):
            continue
    return datetime.now(timezone.utc)


def _handle_payment_affiliate(db: Session, data: dict) -> None:
    """Whop ``payment.affiliate`` handler · G2 · Layer 6.

    Whop fires this event when a paid membership renews and an
    affiliate commission is due to the referring user. The payload
    carries the referrer's affiliate_id + the gross paid amount + the
    billing period boundary. We credit 50% (per §13a locked pricing)
    to the referrer's wallet ledger.

    Idempotency: :func:`app.wallet.record_credit` dedupes by
    ``(user_id, whop_membership_id, period_start, type='credit')`` so
    a Whop retry can't double-credit even if the outer
    ``WebhookEvent.external_id`` guard is bypassed.

    Cash amount lookup order (Whop payloads vary by product):
      * ``amount_cents`` (some newer events)
      * ``amount`` in dollars (older + affiliate-specific events)
      * ``paid_amount`` / ``paid_amount_cents``
    """
    from app import wallet
    from app.models import WalletLedger  # noqa: F401 · required for FK insert

    _add_breadcrumb(category="webhook.whop.payment_affiliate", message="enter")

    # Referring user resolution — prefer the explicit affiliate_id
    # field, fall back to whop_affiliate_id on the User row.
    affiliate_id = (
        data.get("affiliate_id")
        or data.get("referrer_affiliate_id")
        or (data.get("referrer") or {}).get("affiliate_id")
        or ""
    ).strip()
    if not affiliate_id:
        _add_breadcrumb(category="webhook.whop.payment_affiliate", message="exit_no_affiliate_id")
        return

    referring_user: User | None = (
        db.query(User)
        .filter(User.whop_affiliate_id == affiliate_id)
        .one_or_none()
    )
    if not referring_user:
        # 2026-08-11 — User.affiliate_id (unlike whop_affiliate_id) has no
        # unique constraint (app/models.py). A collision would crash
        # affiliate-commission crediting the same way the duplicate-email
        # bug crashed _find_user_for_event above; .first() degrades safely
        # instead of throwing MultipleResultsFound.
        referring_user = (
            db.query(User)
            .filter(User.affiliate_id == affiliate_id)
            .order_by(User.created_at.desc())
            .first()
        )
    if not referring_user:
        _add_breadcrumb(
            category="webhook.whop.payment_affiliate",
            message="exit_no_matching_user",
            data={"affiliate_id": affiliate_id},
        )
        return

    # Membership id — required for the dedupe key.
    membership = data.get("membership") or {}
    whop_membership_id = (
        data.get("whop_membership_id")
        or data.get("membership_id")
        or membership.get("id")
        or ""
    ).strip()
    if not whop_membership_id:
        _add_breadcrumb(
            category="webhook.whop.payment_affiliate",
            message="exit_no_membership_id",
        )
        return

    # Gross paid amount → cents. Whop's dollar-denominated fields need
    # rounding; the cents fields are already integers.
    paid_cents: int = 0
    if isinstance(data.get("amount_cents"), int):
        paid_cents = int(data["amount_cents"])
    elif isinstance(data.get("paid_amount_cents"), int):
        paid_cents = int(data["paid_amount_cents"])
    elif isinstance(data.get("amount"), (int, float)):
        paid_cents = int(round(float(data["amount"]) * 100))
    elif isinstance(data.get("paid_amount"), (int, float)):
        paid_cents = int(round(float(data["paid_amount"]) * 100))
    if paid_cents <= 0:
        _add_breadcrumb(
            category="webhook.whop.payment_affiliate",
            message="exit_zero_amount",
        )
        return

    period_start = _extract_period_start(data)

    wallet.credit_affiliate_share(
        db,
        referring_user_id=referring_user.id,
        paid_amount_cents=paid_cents,
        whop_membership_id=whop_membership_id,
        period_start=period_start,
    )
    db.commit()
    _add_breadcrumb(
        category="webhook.whop.payment_affiliate",
        message="exit",
        data={
            "referring_user_id": referring_user.id,
            "whop_membership_id": whop_membership_id,
            "paid_cents": paid_cents,
        },
    )


# ─────────────────────────────────────────────────────────────────────
# Layer 1 · reconciliation entry point (called from cron.py)
# ─────────────────────────────────────────────────────────────────────


def reconcile_whop_memberships(
    db: Session,
    *,
    fetch_memberships,
    since: datetime | None = None,
    logger: logging.Logger | None = None,
) -> dict:
    """Nightly diff between Whop's live memberships list and our local User
    entitlement mirror.

    ``fetch_memberships`` is a callable that returns a list of Whop membership
    dicts shaped ``{"user": {"id": ..., "email": ...}, "status": ...,
    "valid_until": <unix seconds>, "plan": {"id": ...}}``. Passing it in keeps
    the reconciler testable — the cron wrapper injects the live Whop API
    client, tests inject a synthetic list.

    Returns a dict summary suitable for structured logging:

        {
          "checked": <int>,
          "drift_rows": [ {user_id, whop_user_id, reason, our, whop}, ... ],
          "drift_pct": <float>,
          "severity": "ok" | "warn" | "alert",
        }

    Severity thresholds:
      - drift_pct == 0            → ok
      - 0 < drift_pct <= 5.0      → warn (log per row + summary)
      - drift_pct > 5.0           → alert (summary logged at ERROR + Sentry
                                   captured breadcrumb).
    """
    log = logger or logging.getLogger("junior.webhook_reconcile")
    since_dt = since or (datetime.now(timezone.utc) - timedelta(hours=24))

    try:
        memberships = list(fetch_memberships(since_dt)) or []
    except Exception as exc:  # noqa: BLE001
        log.exception("[whop-reconcile] fetch_memberships raised: %s", exc)
        return {"checked": 0, "drift_rows": [], "drift_pct": 0.0, "severity": "alert", "error": str(exc)}

    drift_rows: list[dict] = []
    checked = 0

    for m in memberships:
        checked += 1
        user_block = m.get("user") or {}
        whop_user_id = user_block.get("id")
        email = (user_block.get("email") or "").strip().lower()
        whop_status = str(m.get("status") or "").lower()
        whop_valid_until = m.get("valid_until") or m.get("renewal_period_end")

        # 2026-08-11 — was .one_or_none() on both. This loop's whole job is
        # catching webhook drops within 24h (see the docstring above) —
        # but a single duplicate-email user anywhere in the day's batch
        # threw MultipleResultsFound uncaught here, aborting the ENTIRE
        # reconciliation run for every user, not just the offending one.
        # The one class of bug this job exists to catch could kill the
        # job itself. .first() degrades to picking one row instead.
        user: User | None = None
        if whop_user_id:
            user = (
                db.query(User)
                .filter_by(whop_user_id=whop_user_id)
                .order_by(User.created_at.desc())
                .first()
            )
        if user is None and email:
            user = (
                db.query(User)
                .filter(User.email.ilike(email))
                .order_by(User.created_at.desc())
                .first()
            )
        if user is None:
            drift_rows.append({
                "user_id": None,
                "whop_user_id": whop_user_id,
                "reason": "no_matching_local_user",
                "our": None,
                "whop": {"status": whop_status, "valid_until": whop_valid_until},
            })
            continue

        # Compare paid_until (rounded to whole seconds, ± 60s slack for clock drift)
        drifted = False
        reason = None
        if isinstance(whop_valid_until, (int, float)):
            whop_dt = datetime.fromtimestamp(float(whop_valid_until), tz=timezone.utc)
            our_dt = user.paid_until
            if our_dt is None:
                drifted = True
                reason = "our_paid_until_null_whop_active"
            else:
                delta = abs((our_dt - whop_dt).total_seconds())
                if delta > 60:
                    drifted = True
                    reason = "paid_until_drift"

        # Compare status posture — 'active' on Whop but not 'active'/'trialing' locally = drift
        if whop_status in ("active", "trialing", "valid"):
            if user.subscription_status not in ("active", "trialing"):
                drifted = True
                reason = reason or "status_drift"

        if drifted:
            drift_rows.append({
                "user_id": user.id,
                "whop_user_id": whop_user_id,
                "reason": reason,
                "our": {"status": user.subscription_status, "paid_until": user.paid_until.isoformat() if user.paid_until else None},
                "whop": {"status": whop_status, "valid_until": whop_valid_until},
            })

    drift_pct = (100.0 * len(drift_rows) / checked) if checked else 0.0
    if drift_pct == 0:
        severity = "ok"
    elif drift_pct <= 5.0:
        severity = "warn"
    else:
        severity = "alert"

    summary = {
        "checked": checked,
        "drift_rows": drift_rows,
        "drift_pct": round(drift_pct, 2),
        "severity": severity,
    }

    # Log every drift row so an ops audit trail exists even if Sentry is off.
    for row in drift_rows:
        log.warning("[whop-reconcile] drift · %s", row)
    if severity == "alert":
        log.error("[whop-reconcile] drift ALERT · %s", summary)
        _add_breadcrumb(
            category="webhook.whop.reconcile",
            message="alert",
            data={"drift_pct": summary["drift_pct"], "checked": summary["checked"]},
        )
    else:
        log.info("[whop-reconcile] complete · checked=%s drift=%s pct=%s severity=%s",
                 checked, len(drift_rows), summary["drift_pct"], severity)

    return summary
