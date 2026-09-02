"""Read-only Admin HQ v0 — inspection + light support tooling.

This router gives a Junior admin (Daniel + the JUNIOR_ADMIN_EMAILS allowlist)
one place to inspect customer/business state without grepping logs:

  - who a user is + their tier / billing / export state
  - Whop pending memberships + claim tokens (no raw token leakage)
  - recent webhook + notification rows
  - Postiz configured/health status

It is READ-ONLY apart from two explicitly-safe support actions on claim tokens
(expire / resend). It NEVER mutates billing, tier, entitlement, or payment
state, and adds NO new tables — it reads the existing ORM models only.

Auth (server-side, defence in depth):
  Every endpoint depends on `require_admin`, which:
    (a) requires x-internal-secret == settings.internal_api_secret
        (fail-closed via `deps.require_internal_secret`; missing env = 500,
        mismatched/absent header = 401), AND
    (b) resolves the ?clerk_user_id (or body field) to a User and checks
        app.features.is_admin_email(user.email) — else 403.
  The account-app admin page ALSO gates in its server component, but this
  backend gate is the real enforcement (frontend gating is not enough).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any, Literal

import httpx
import uuid
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, text as _sql_text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import engine, get_db
from app.deps import require_internal_secret
from app.features import is_admin_email
from app.models import (
    AdminAuditLog,
    Announcement,
    Banner,
    CampaignSubmission,
    ChatMessage,
    ClipRun,
    CommunityChannel,
    DesktopErrorEvent,
    RewardBonusLedger,
    License,
    Notification,
    PendingWhopMembership,
    PostizConnection,
    PostAnalytic,
    Schedule,
    SocialChannel,
    SocialConnection,
    SponsoredCampaign,
    User,
    WalletLedger,
    WebhookEvent,
    WebhookEventLog,
    WhopClaimToken,
)
from app.routes.usage import STARTER_EXPORT_CAP, starter_export_remaining

router = APIRouter(prefix="/admin", tags=["admin"])


# 2026-06-24 · Whop chat-agent fleet observability. Returns the live
# fleet stats (uptime, per-agent polls / messages / errors). Returns
# {"enabled": false, ...} when the fleet isn't running (default state
# until Daniel flips WHOP_AGENT_ENABLED + drops in WHOP_AGENT_KEYS).
@router.get("/whop-agents")
def list_whop_agents(_: "AdminUser") -> dict:
    from app.agents.whop_chat import get_fleet, AGENT_ENABLED
    fleet = get_fleet()
    if fleet is None:
        return {
            "enabled": AGENT_ENABLED,
            "running": False,
            "fleet_size": 0,
            "note": "fleet not started · WHOP_AGENT_ENABLED=true + WHOP_AGENT_KEYS required",
        }
    return {
        "enabled": True,
        "running": True,
        **fleet.stats(),
    }


# --- datetime helpers --------------------------------------------------
# SQLite stores tz-aware DateTime columns as naive; comparing them against a
# tz-aware now() raises TypeError. Match the dialect like cron.py does.

def _now() -> datetime:
    now = datetime.now(timezone.utc)
    if engine.dialect.name == "sqlite":
        return now.replace(tzinfo=None)
    return now


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt is not None else None


def _age_seconds(created: datetime | None) -> int | None:
    if created is None:
        return None
    now = _now()
    c = created
    # Normalise both to naive-or-aware so subtraction works on either dialect.
    if now.tzinfo is None and c.tzinfo is not None:
        c = c.replace(tzinfo=None)
    elif now.tzinfo is not None and c.tzinfo is None:
        c = c.replace(tzinfo=timezone.utc)
    try:
        return int((now - c).total_seconds())
    except TypeError:
        return None


# --- privacy helpers ---------------------------------------------------

def _mask_email(email: str | None) -> str:
    """a***@gmail.com — enough to recognise, not enough to leak. Single-user
    detail view shows the full email; list/table views use this."""
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


def _short_id(value: str | None, keep: int = 8) -> str | None:
    """Safe short id for display. NEVER used to render the raw claim token."""
    if not value:
        return None
    return value[:keep]


# --- auth dependency ---------------------------------------------------

def require_admin(
    db: Annotated[Session, Depends(get_db)],
    clerk_user_id: Annotated[str, Query(min_length=1)],
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
) -> User:
    """Server-side admin gate for EVERY /admin/* endpoint.

    (a) internal secret check — fail-closed via require_internal_secret
        (missing env → 500, missing/mismatched header → 401). Every route
        that used `require_admin` transitively inherits this fix.
    (b) resolve clerk_user_id → User and require is_admin_email(user.email).
    Returns the admin User so handlers can log/attribute if needed."""
    user = db.query(User).filter_by(clerk_id=clerk_user_id).one_or_none()
    if not user or not is_admin_email(user.email):
        # Same 403 whether the user is missing or simply not an admin — don't
        # leak which clerk ids exist.
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin access required")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


# --- shared user shaping ----------------------------------------------

def _latest_license(db: Session, user_id: str) -> License | None:
    return (
        db.query(License)
        .filter(License.user_id == user_id)
        .order_by(License.issued_at.desc())
        .first()
    )


def _user_detail(db: Session, user: User) -> dict[str, Any]:
    """Full single-user detail (spec §2). Raw vs effective tier are separated —
    admins are elevated in-memory by deps.current_user but here we read the
    untouched DB row so the panel shows billing truth, not the override."""
    is_admin = is_admin_email(user.email)
    lic = _latest_license(db, user.id)
    eff_tier = "autopilot" if is_admin else user.tier
    eff_founder = True if is_admin else user.founder_flag
    from app.services.affiliate_commission import eligible_referral_count
    from app.wallet import compute_balance, compute_lifetime_paid, compute_pending

    last_active = _last_active_at(user, lic)
    now = datetime.now(timezone.utc)

    clips_total = db.query(func.count(ClipRun.id)).filter(ClipRun.user_id == user.id).scalar() or 0
    campaigns_total = (
        db.query(func.count(CampaignSubmission.id)).filter(CampaignSubmission.user_id == user.id).scalar() or 0
    )
    community_messages_total = (
        db.query(func.count(ChatMessage.id)).filter(ChatMessage.user_id == user.id).scalar() or 0
    )

    return {
        "backend_user_id": user.id,
        "clerk_id": user.clerk_id,
        "email": user.email,  # full email — single-user detail only
        "handle": user.handle,
        "whop_user_id": user.whop_user_id,
        "affiliate_id": user.affiliate_id,
        "whop_affiliate_id": user.whop_affiliate_id,
        "whop_affiliate_code": user.whop_affiliate_code,
        "is_affiliate": bool(user.whop_affiliate_id or user.affiliate_qualified_at),
        "referred_paid_subs": user.referred_paid_subs or 0,
        "eligible_affiliate_referrals": eligible_referral_count(db, user),
        "first_paid_at": _iso(user.first_paid_at),
        "affiliate_qualified_at": _iso(user.affiliate_qualified_at),
        "affiliate_commission_override_ids": list(user.affiliate_commission_override_ids or []),
        "raw_tier": user.tier,
        "raw_founder": user.founder_flag,
        "effective_tier": eff_tier,
        "effective_founder": eff_founder,
        "admin_override": is_admin,
        "role": _platform_role_label(user),
        "subscription_status": user.subscription_status,
        "is_paid": _is_paid(user),
        "payment_state": _payment_state(user),
        "billing_provider": "whop" if user.whop_user_id else "clerk",
        "trial_started_at": _iso(user.trial_started_at),
        "paid_until": _iso(user.paid_until),
        "starter_exports_used": user.starter_exports_used or 0,
        "starter_export_cap": STARTER_EXPORT_CAP,
        "remaining_exports": None if is_admin else starter_export_remaining(user),
        "created_at": _iso(user.created_at),
        "last_active_at": _iso(last_active),
        "activity_status": _activity_status(last_active),
        "banned": user.banned_until is not None and user.banned_until > now,
        "banned_until": _iso(user.banned_until),
        "payment_locked": user.payment_locked_at is not None,
        "payment_locked_at": _iso(user.payment_locked_at),
        "latest_license": (
            {
                "id": lic.id,
                "tier_at_issue": lic.tier_at_issue,
                "issued_at": _iso(lic.issued_at),
                "expires_at": _iso(lic.expires_at),
                "revoked": lic.revoked,
            }
            if lic
            else None
        ),
        # Lightweight cross-surface counts only — full lists live behind
        # their own paginated endpoints (GET /admin/users/{id}/clips etc.)
        # so opening a user profile never fires N unbounded queries.
        "summary": {
            "clips_total": int(clips_total),
            "campaign_submissions_total": int(campaigns_total),
            "community_messages_total": int(community_messages_total),
            "wallet_balance_cents": compute_balance(db, user.id),
            "wallet_pending_cents": compute_pending(db, user.id),
            "wallet_lifetime_paid_cents": compute_lifetime_paid(db, user.id),
        },
    }



# --- User 360 (2026-09-02) · activity classification --------------------
#
# Canonical activity signal: `User.active_at` (ticks on every successful
# clip export — see models.py) OR the most recent `License.issued_at`
# (a license is (re)minted on every desktop sign-in / /desktop/connect,
# so it doubles as the closest thing this schema has to a login log).
# No other "last active" timestamp exists anywhere in the schema — this
# function is the ONE place that definition lives; every endpoint below
# calls it instead of re-deriving its own notion of "active".
#
# Windows are explicit, not arbitrary vibes: 7 days = "active", 30 days
# = "recently active", beyond that (with at least one signal ever) =
# "inactive", zero signals ever = "never logged in". These thresholds
# are a judgment call with no prior canonical definition in the repo —
# documented here, and surfaced in the UI, rather than hidden in code.
_ACTIVE_WINDOW_DAYS = 7
_RECENTLY_ACTIVE_WINDOW_DAYS = 30


def _last_active_at(user: User, latest_license: License | None) -> datetime | None:
    candidates = [t for t in (user.active_at, latest_license.issued_at if latest_license else None) if t is not None]
    return max(candidates) if candidates else None


def _activity_status(last_active: datetime | None) -> str:
    """One of: active | recently_active | inactive | never_logged_in."""
    if last_active is None:
        return "never_logged_in"
    now = datetime.now(timezone.utc)
    la = last_active if last_active.tzinfo else last_active.replace(tzinfo=timezone.utc)
    age_days = (now - la).total_seconds() / 86400
    if age_days <= _ACTIVE_WINDOW_DAYS:
        return "active"
    if age_days <= _RECENTLY_ACTIVE_WINDOW_DAYS:
        return "recently_active"
    return "inactive"


def _is_paid(user: User) -> bool:
    """PAID = effective tier isn't free. Matches the resolution every
    other paywall in the codebase already uses (tier != 'free'); does
    NOT additionally require subscription_status == 'active' because a
    'past_due'/'cancelled' user often still has tier set until the grace
    period actually lapses — that nuance is exposed separately via
    subscription_status, not folded into this boolean."""
    return (user.tier or "free") != "free"


def _payment_state(user: User) -> str:
    """One of: locked | trial | paid | free — a single, mutually-exclusive
    display label for the Users list badge + filter and User 360 Billing.

    Not a new calculation: it's a priority-ordered label over the exact
    same three fields every other payment surface already reads —
    `payment_locked_at`, `subscription_status`, and `tier` (via
    `_is_paid`) — so it can never disagree with `is_paid`/`payment_locked`/
    `subscription_status`, which all remain unchanged on the response.

    Precedence, most urgent first:
      1. locked — `payment_locked_at` set (Whop payment_failed webhook;
         cleared on next successful charge). Shown regardless of tier,
         since a locked-but-still-tiered user needs attention first.
      2. trial  — `subscription_status == 'trial'` and not locked.
      3. paid   — `_is_paid(user)` (tier != 'free') and neither of the above.
      4. free   — everything else.
    """
    if user.payment_locked_at is not None:
        return "locked"
    if user.subscription_status == "trial":
        return "trial"
    if _is_paid(user):
        return "paid"
    return "free"


def _user_list_row(user: User, latest_license: License | None = None) -> dict[str, Any]:
    """Masked list row for search/browse results — full email withheld."""
    last_active = _last_active_at(user, latest_license)
    return {
        "backend_user_id": user.id,
        "clerk_id": user.clerk_id,
        "email_masked": _mask_email(user.email),
        "handle": user.handle,
        "whop_user_id": user.whop_user_id,
        "affiliate_id": user.affiliate_id,
        "tier": user.tier,
        "is_paid": _is_paid(user),
        "payment_state": _payment_state(user),
        "founder": user.founder_flag,
        "role": _platform_role_label(user),
        "subscription_status": user.subscription_status,
        "billing_provider": "whop" if user.whop_user_id else "clerk",
        "created_at": _iso(user.created_at),
        "last_active_at": _iso(last_active),
        "activity_status": _activity_status(last_active),
        "banned": user.banned_until is not None and user.banned_until > datetime.now(timezone.utc),
        "payment_locked": user.payment_locked_at is not None,
    }


def _platform_role_label(user: User) -> str:
    """Reuses chat.py's _derive_role ordering (staff > founder > mod >
    member) so 'role' means the same thing everywhere in the product,
    rather than inventing a second role taxonomy for this screen."""
    if is_admin_email(user.email):
        return "staff"
    if user.founder_flag:
        return "founder"
    if user.chat_role == "mod":
        return "mod"
    return "member"


# ======================================================================
# 1. Overview
# ======================================================================

@router.get("/overview")
def overview(admin: AdminUser, db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    """Config booleans + headline counts. 'configured' booleans come from
    Settings/env — they say whether a secret is set, never what it is."""
    s = get_settings()

    # DB reachability — a trivial query; if it raises we report disconnected.
    db_connected = True
    try:
        db.query(User).limit(1).all()
    except Exception:  # noqa: BLE001
        db_connected = False

    from app import postiz

    config = {
        "db_connected": db_connected,
        "db_dialect": engine.dialect.name,
        "clerk_configured": bool(s.clerk_secret_key),
        "clerk_webhook_secret_configured": bool(s.clerk_webhook_secret),
        "whop_api_key_configured": bool(s.whop_api_key),
        "whop_webhook_secret_configured": bool(s.whop_webhook_secret),
        "resend_configured": bool(s.resend_api_key),
        "posthog_configured": bool(s.posthog_key),
        "postiz_configured": postiz.is_live(),
        "internal_secret_configured": bool(s.internal_api_secret),
    }

    now = _now()
    day_ago = now - timedelta(hours=24)
    week_ago = now - timedelta(days=7)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Tier/status buckets. "paid" = active & non-free; "trialing" = trial/ing;
    # everything else (free, expired, canceled-past-period) → free bucket.
    users = db.query(User).all()
    paid = sum(1 for u in users if u.subscription_status == "active" and u.tier != "free")
    trialing = sum(1 for u in users if u.subscription_status in ("trial", "trialing"))
    free = len(users) - paid - trialing

    # Signups this week (from DB — mirrors Clerk via /webhooks/clerk).
    signups_this_week = db.query(User).filter(User.created_at >= week_ago).count()

    # Users who exported ≥1 clip in the last 7 days. `User.active_at` is
    # written by /usage/clip-exported (usage.py:233) on successful export.
    # NULL active_at never counts — a new signup who has never exported
    # is not "using" the app in the engagement sense.
    exports_this_week = db.query(User).filter(
        User.active_at.is_not(None),
        User.active_at >= week_ago,
    ).count()

    # Whop active membership count + MRR. Live API call — 0/0 on outage.
    from app import whop_payments
    whop_active_count, mrr_cents = whop_payments.active_membership_count_and_mrr_cents()

    counts = {
        "users_total": len(users),
        "users_today": db.query(User).filter(User.created_at >= today_start).count(),
        "paid": paid,
        "trialing": trialing,
        "free": free,
        "pending_whop_open": db.query(PendingWhopMembership)
        .filter(PendingWhopMembership.consumed_at.is_(None))
        .count(),
        "claim_tokens_open": db.query(WhopClaimToken)
        .filter(
            WhopClaimToken.consumed_at.is_(None),
            WhopClaimToken.expires_at > now,
        )
        .count(),
        "webhook_events_24h": db.query(WebhookEvent)
        .filter(WebhookEvent.received_at >= day_ago)
        .count(),
        "signups_this_week": signups_this_week,
        "exports_this_week": exports_this_week,
        "whop_active_memberships": whop_active_count,
        "mrr_cents": mrr_cents,
    }

    return {
        "config": config,
        "counts": counts,
        "notes": {
            "http_4xx_5xx_last_hour": "not available — request error rates are not persisted in v0",
            "webhook_failures_24h": "not available — WebhookEvent stores only idempotency metadata (no status/error) in v0",
            "exports_this_week": "Users who exported ≥1 clip in the last 7 days (User.active_at from usage.py:233). Not app-opens — heartbeat field deferred.",
            "whop_mrr": "Live Whop API · zero if WHOP_API_KEY missing or API down. Yearly plans normalized to monthly.",
        },
        "generated_at": _iso(datetime.now(timezone.utc)),
    }


# ======================================================================
# 1b. Launch Health — one green-gate endpoint
# ======================================================================

def _gate(
    key: str,
    label: str,
    status: str,
    detail: str,
    *,
    value: Any = None,
    action: str | None = None,
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "status": status,
        "detail": detail,
        "value": value,
        "action": action,
    }


def _count_status(rows: list[Any]) -> dict[str, int]:
    out: dict[str, int] = {}
    for row in rows:
        key = str(getattr(row, "status", "unknown") or "unknown")
        out[key] = out.get(key, 0) + 1
    return out


def _check_public_updater(endpoint: str, targets_csv: str) -> dict[str, Any]:
    """Probe the exact updater URL baked into the shipped Tauri app.

    A local manifest file only proves the backend has *something* on disk. This
    proves the customer path: updates.liquidclips.app -> backend manifest ->
    signed platform block -> downloadable artifact URL.
    """
    targets = [t.strip() for t in targets_csv.split(",") if t.strip()]
    if not endpoint or not targets:
        return _gate(
            "updates_public",
            "Public updater endpoint",
            "fail",
            "Updater endpoint or target list is not configured.",
            action="Set TAURI_UPDATE_ENDPOINT and TAURI_UPDATE_TARGETS.",
        )

    results: dict[str, Any] = {}
    failures: list[str] = []
    warnings: list[str] = []
    versions: set[str] = set()
    artifact_urls: list[str] = []
    ok_targets = 0

    try:
        with httpx.Client(timeout=8.0, follow_redirects=True) as client:
            for target in targets:
                response = client.get(endpoint, params={"target": target, "current_version": "0.0.0"})
                if response.status_code == 204:
                    warnings.append(f"{target}: no update returned")
                    results[target] = {"status": "warn", "http_status": 204}
                    continue
                if response.status_code >= 400:
                    failures.append(f"{target}: HTTP {response.status_code}")
                    results[target] = {"status": "fail", "http_status": response.status_code}
                    continue

                try:
                    payload = response.json()
                except ValueError:
                    failures.append(f"{target}: non-JSON manifest")
                    results[target] = {"status": "fail", "http_status": response.status_code}
                    continue

                platform = (payload.get("platforms") or {}).get(target) or {}
                signature = str(platform.get("signature") or "").strip()
                artifact_url = str(platform.get("url") or "").strip()
                version = str(payload.get("version") or "").strip()
                if version:
                    versions.add(version)
                if not signature or not artifact_url:
                    missing = "signature" if not signature else "artifact URL"
                    failures.append(f"{target}: missing {missing}")
                    results[target] = {"status": "fail", "version": version or None}
                    continue

                artifact_status = None
                try:
                    artifact_response = client.head(artifact_url)
                    artifact_status = artifact_response.status_code
                    if artifact_status == 405:
                        artifact_response = client.get(artifact_url, headers={"Range": "bytes=0-0"})
                        artifact_status = artifact_response.status_code
                    if artifact_status >= 400:
                        failures.append(f"{target}: artifact HTTP {artifact_status}")
                    else:
                        artifact_urls.append(artifact_url)
                except httpx.HTTPError as exc:
                    failures.append(f"{target}: artifact {type(exc).__name__}")

                target_ok = artifact_status is not None and artifact_status < 400
                if target_ok:
                    ok_targets += 1
                results[target] = {
                    "status": "ok" if target_ok else "fail",
                    "http_status": response.status_code,
                    "artifact_http_status": artifact_status,
                    "version": version or None,
                    "has_signature": bool(signature),
                    "artifact_url": artifact_url,
                }
    except httpx.HTTPError as exc:
        return _gate(
            "updates_public",
            "Public updater endpoint",
            "fail",
            f"Updater probe failed: {type(exc).__name__}",
            value={"endpoint": endpoint, "targets": targets},
            action="Check updates.liquidclips.app DNS/proxy and api.jnremployee.com /updates/latest.json.",
        )

    if len(versions) > 1:
        failures.append("targets return different versions")

    status_value = "fail" if failures else "warn" if warnings else "ok"
    detail_parts = []
    if versions:
        detail_parts.append(f"version {', '.join(sorted(versions))}")
    detail_parts.append(f"{ok_targets}/{len(targets)} target(s) downloadable")
    if failures:
        detail_parts.append("; ".join(failures[:3]))
    elif warnings:
        detail_parts.append("; ".join(warnings[:3]))
    detail = " · ".join(detail_parts)

    return _gate(
        "updates_public",
        "Public updater endpoint",
        status_value,
        detail,
        value={
            "endpoint": endpoint,
            "targets": results,
            "versions": sorted(versions),
            "artifact_urls": sorted(set(artifact_urls)),
        },
        action="Publish signed updater artifacts for both Mac targets through /updates/upload." if status_value != "ok" else None,
    )


@router.get("/health")
def launch_health(admin: AdminUser, db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    """One read-only launch gate for Admin HQ.

    This is deliberately *not* a synthetic transaction runner: it never posts a
    clip, charges a card, mutates Stripe/Whop, or hits user social profiles.
    It checks the gates that should be green before launch from one endpoint:
    configured secrets, DB reachability, release/update manifest, scheduling
    tables, webhook failures, bug telemetry, and payout/publishing rails.
    """
    s = get_settings()
    gates: list[dict[str, Any]] = []
    now = _now()
    day_ago = now - timedelta(hours=24)
    hour_ago = now - timedelta(hours=1)

    # DB
    try:
        db.query(User).limit(1).all()
        gates.append(_gate("db", "Database", "ok", f"Connected ({engine.dialect.name})."))
    except Exception as exc:  # noqa: BLE001
        gates.append(_gate("db", "Database", "fail", f"DB query failed: {type(exc).__name__}", action="Check DATABASE_URL / Railway Postgres."))

    # Required-ish config for public launch.
    config_checks = [
        ("internal_secret", "Internal API secret", bool(s.internal_api_secret), "Server-to-server admin/account proxy auth."),
        ("clerk", "Clerk API", bool(s.clerk_secret_key), "Account metadata sync."),
        ("clerk_webhook", "Clerk webhook", bool(s.clerk_webhook_secret), "Signup/account lifecycle webhooks."),
        ("whop_api", "Whop API", bool(s.whop_api_key), "Content Rewards + Whop billing reconciliation."),
        ("whop_webhook", "Whop webhook", bool(s.whop_webhook_secret), "Whop purchase/entitlement events."),
        ("resend", "Resend email", bool(s.resend_api_key), "Transactional onboarding/support emails."),
        ("stripe_connect", "Stripe Connect", bool(s.stripe_secret_key), "Non-Whop affiliate payout onboarding."),
        ("stripe_connect_webhook", "Stripe Connect webhook", bool(s.stripe_connect_webhook_secret), "Stripe payout/KYC callbacks."),
        ("ayrshare", "Ayrshare publishing", bool(os.environ.get("AYRSHARE_API_KEY", "").strip()), "Hosted multi-channel publishing."),
        ("ayrshare_jwt", "Ayrshare linker JWT", bool(os.environ.get("AYRSHARE_JWT_PRIVATE_KEY", "").strip() and os.environ.get("AYRSHARE_DOMAIN", "").strip()), "In-app social-account linking."),
    ]
    for key, label, ok, detail in config_checks:
        gates.append(_gate(key, label, "ok" if ok else "fail", detail if ok else f"Missing env for {detail}", action=None if ok else "Set the production env var."))

    # Release/update manifest.
    release_dir = Path(os.environ.get("JUNIOR_RELEASES_DIR", str(Path.home() / "Desktop/jnr/desktop/src-tauri/target/release/bundle")))
    manifest_path = release_dir / "manifest.json"
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            platforms = manifest.get("platforms") or {}
            missing_artifacts = []
            for target, block in platforms.items():
                fname = block.get("file")
                if fname and not (release_dir / Path(fname).name).is_file():
                    missing_artifacts.append(target)
            if missing_artifacts:
                gates.append(_gate("updates", "Updater manifest", "fail", f"Manifest exists, but artifacts missing for {', '.join(missing_artifacts)}.", value=manifest.get("version")))
            else:
                gates.append(_gate("updates", "Updater manifest", "ok", f"Version {manifest.get('version', 'unknown')} · {len(platforms)} target(s).", value=manifest.get("version")))
        except Exception as exc:  # noqa: BLE001
            gates.append(_gate("updates", "Updater manifest", "fail", f"Manifest unreadable: {type(exc).__name__}", action="Re-upload release artifact."))
    else:
        gates.append(_gate("updates", "Updater manifest", "warn", "No backend updater manifest found. GitHub DMG may still exist, but auto-update is not ready.", action="Publish signed updater artifact to /updates/upload."))
    gates.append(_check_public_updater(s.tauri_update_endpoint, s.tauri_update_targets))

    # Schedule v2.
    channels = db.query(SocialChannel).all()
    active_channels = sum(1 for c in channels if c.status == "active")
    pending_channels = sum(1 for c in channels if c.status == "pending_link")
    error_channels = sum(1 for c in channels if c.status == "error")
    channel_status = "fail" if error_channels else "ok" if active_channels else "warn"
    gates.append(_gate(
        "channels",
        "Social channels",
        channel_status,
        f"{active_channels} active · {pending_channels} pending · {error_channels} error.",
        value={"active": active_channels, "pending_link": pending_channels, "error": error_channels, "total": len(channels)},
        action="Refresh errored channels in Schedule → Loadout." if error_channels else None,
    ))

    schedules = db.query(Schedule).all()
    schedule_counts = _count_status(schedules)
    failed_schedules_24h = (
        db.query(Schedule)
        .filter(Schedule.status == "failed", Schedule.updated_at >= day_ago)
        .count()
    )
    stuck_uploading = (
        db.query(Schedule)
        .filter(Schedule.status == "uploading", Schedule.updated_at <= hour_ago)
        .count()
    )
    schedule_status = "fail" if failed_schedules_24h or stuck_uploading else "ok"
    gates.append(_gate(
        "schedule_queue",
        "Schedule queue",
        schedule_status,
        f"{failed_schedules_24h} failed in 24h · {stuck_uploading} uploading >1h.",
        value=schedule_counts,
        action="Open Admin HQ → Postiz/Schedules and inspect failed rows." if schedule_status == "fail" else None,
    ))

    latest_analytics = db.query(PostAnalytic).order_by(PostAnalytic.refreshed_at.desc()).first()
    analytics_age = _age_seconds(latest_analytics.refreshed_at) if latest_analytics else None
    analytics_total = db.query(PostAnalytic).count()
    analytics_status = "ok"
    analytics_detail = f"{analytics_total} cached analytics row(s)."
    if analytics_total == 0:
        analytics_status = "warn"
        analytics_detail = "No cached analytics yet; expected before first published post."
    elif analytics_age is not None and analytics_age > 3 * 3600:
        analytics_status = "warn"
        analytics_detail = f"Latest analytics refresh is {ageLabelBackend(analytics_age)} old."
    gates.append(_gate("analytics", "Analytics cache", analytics_status, analytics_detail, value={"rows": analytics_total, "latest_age_seconds": analytics_age}))

    webhook_failures = (
        db.query(WebhookEventLog)
        .filter(WebhookEventLog.status == "failed", WebhookEventLog.received_at >= day_ago)
        .count()
    )
    gates.append(_gate(
        "webhooks",
        "Webhook processing",
        "ok" if webhook_failures == 0 else "fail",
        f"{webhook_failures} failed webhook(s) in 24h.",
        action="Open Admin HQ → Webhooks filtered to failed." if webhook_failures else None,
    ))

    bug_events_24h = db.query(DesktopErrorEvent).filter(DesktopErrorEvent.created_at >= day_ago).count()
    bug_status = "ok" if bug_events_24h == 0 else "warn" if bug_events_24h < 5 else "fail"
    gates.append(_gate(
        "desktop_errors",
        "Desktop bug telemetry",
        bug_status,
        f"{bug_events_24h} desktop error event(s) in 24h.",
        action="Open Admin HQ → Bugs." if bug_events_24h else None,
    ))

    # Admin visibility itself.
    admin_ok = is_admin_email(admin.email)
    gates.append(_gate(
        "admin_access",
        "Admin dashboard access",
        "ok" if admin_ok else "fail",
        f"{admin.email} is {'on' if admin_ok else 'not on'} JUNIOR_ADMIN_EMAILS.",
        value=admin.email,
    ))

    status_order = {"fail": 0, "warn": 1, "ok": 2}
    overall = "ok"
    if any(g["status"] == "fail" for g in gates):
        overall = "fail"
    elif any(g["status"] == "warn" for g in gates):
        overall = "warn"
    score = round(100 * sum(1 for g in gates if g["status"] == "ok") / max(1, len(gates)))
    return {
        "overall": overall,
        "score": score,
        "generated_at": _iso(datetime.now(timezone.utc)),
        "gates": sorted(gates, key=lambda g: (status_order.get(g["status"], 9), g["label"])),
        "public_urls": {
            "account": s.account_site_url,
            "download": s.app_download_url,
            "partner": s.whop_partner_dashboard_url,
            "whop": s.whop_manage_url,
        },
        "note": "One read-only admin launch gate. It does not run destructive live transactions (no card charge, post publish, payout mutation, or user OAuth).",
    }


@router.get("/function-heatmap")
def function_heatmap_latest(admin: AdminUser) -> dict[str, Any]:
    """Latest automated Railway function heat-map.

    Returns the in-memory latest result for this backend process. If Railway has
    just booted and no 5-hour tick has run yet, run one read-only pass now so
    Admin HQ never shows a blank panel.
    """
    from app.function_heatmap import latest_function_heatmap, run_function_heatmap

    result = latest_function_heatmap()
    if result is None:
        result = run_function_heatmap(notify=False, source="admin-lazy-load")
    return result


@router.post("/function-heatmap/run")
def function_heatmap_run(admin: AdminUser) -> dict[str, Any]:
    """Manual admin-triggered heat-map run.

    Still read-only. `notify=False` because a human is already looking at the
    result; the Railway 5-hour cron is responsible for email alerts.
    """
    from app.function_heatmap import run_function_heatmap

    return run_function_heatmap(notify=False, source="admin-manual")


@router.get("/alerts")
def admin_alerts(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    unread_only: bool = False,
    priority: str | None = None,
    limit: int = 30,
) -> dict[str, Any]:
    """Current admin's in-app alert history.

    This surfaces the same Notification rows written by Railway's function
    heat-map, without exposing other users' inboxes.
    """
    q = (
        db.query(Notification)
        .filter(Notification.user_id == admin.id, Notification.dismissed_at.is_(None))
        .order_by(Notification.created_at.desc())
    )
    if unread_only:
        q = q.filter(Notification.read_at.is_(None))
    if priority in {"low", "medium", "high"}:
        q = q.filter(Notification.priority == priority)
    rows = q.limit(max(1, min(limit, 100))).all()
    unread = (
        db.query(Notification)
        .filter(
            Notification.user_id == admin.id,
            Notification.dismissed_at.is_(None),
            Notification.read_at.is_(None),
        )
        .count()
    )
    return {
        "unread": unread,
        "alerts": [
            {
                "id": n.id,
                "category": n.category,
                "title": n.title,
                "body": n.body,
                "priority": n.priority,
                "action_kind": n.action_kind,
                "action_data": n.action_data or {},
                "read_at": _iso(n.read_at),
                "created_at": _iso(n.created_at),
            }
            for n in rows
        ],
    }


@router.post("/alerts/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def admin_alert_mark_read(
    notification_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    row = db.get(Notification, notification_id)
    if not row or row.user_id != admin.id or row.dismissed_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "alert not found")
    if row.read_at is None:
        row.read_at = datetime.now(timezone.utc)
        db.commit()


def ageLabelBackend(seconds: int | None) -> str:
    if seconds is None:
        return "unknown"
    days = seconds // 86400
    if days:
        return f"{days}d"
    hours = seconds // 3600
    if hours:
        return f"{hours}h"
    minutes = seconds // 60
    return f"{minutes}m"


# ======================================================================
# 2. User search + detail
# ======================================================================

def _bulk_latest_licenses(db: Session, user_ids: list[str]) -> dict[str, License]:
    """One query for a whole page's worth of 'latest license' rows,
    instead of N+1 per-row lookups. Keeps GET /admin/users cheap even
    at a few thousand users per page — see Section 25 (performance)."""
    if not user_ids:
        return {}
    rows = (
        db.query(License)
        .filter(License.user_id.in_(user_ids))
        .order_by(License.user_id, License.issued_at.desc())
        .all()
    )
    out: dict[str, License] = {}
    for r in rows:
        if r.user_id not in out:  # first row per user_id wins (already ordered desc)
            out[r.user_id] = r
    return out


@router.get("/users")
def search_users(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    query: Annotated[str | None, Query(min_length=1)] = None,
    payment: Annotated[str | None, Query(description="all|free|paid|trial|locked")] = None,
    activity: Annotated[
        str | None,
        Query(description="all|active|recently_active|inactive|never_logged_in"),
    ] = None,
    subscription_status: str | None = None,
    role: Annotated[str | None, Query(description="all|member|mod|founder|staff")] = None,
    banned: bool | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict[str, Any]:
    """Search (identity ids + affiliate tokens + email substring) OR, when
    `query` is omitted, browse the full user base with filters + real
    pagination — this is the data source for the Users overview table.
    `activity`/`role` are computed in Python, `payment` is pushed into SQL
    directly (see below) — all three against the same definitions
    (`_activity_status`/`_payment_state`/`_platform_role_label`) used
    everywhere else, so a filter here always means the same thing the
    detail page shows. Everything else is a real SQL WHERE clause."""
    db_query = db.query(User)

    if query and query.strip():
        q = query.strip()
        like = f"%{q.lower()}%"
        db_query = db_query.filter(
            or_(
                User.email.ilike(like),
                User.clerk_id == q,
                User.whop_user_id == q,
                User.id == q,
                User.affiliate_id == q,
                User.whop_affiliate_id == q,
                User.whop_affiliate_code == q,
            )
        )
    else:
        q = None

    # Mirrors _payment_state()'s exact precedence (locked > trial > paid >
    # free) as SQL, over the same three columns, so "Paid" here can never
    # show a user whose badge reads TRIAL or PAYMENT LOCKED — the filter
    # and the badge are guaranteed to agree because they're the same rule.
    if payment == "locked":
        db_query = db_query.filter(User.payment_locked_at.is_not(None))
    elif payment == "trial":
        db_query = db_query.filter(
            User.payment_locked_at.is_(None), User.subscription_status == "trial"
        )
    elif payment == "paid":
        db_query = db_query.filter(
            User.payment_locked_at.is_(None),
            User.subscription_status != "trial",
            User.tier != "free",
        )
    elif payment == "free":
        db_query = db_query.filter(
            User.payment_locked_at.is_(None),
            User.subscription_status != "trial",
            User.tier == "free",
        )

    if subscription_status and subscription_status != "all":
        db_query = db_query.filter(User.subscription_status == subscription_status)

    if banned is True:
        db_query = db_query.filter(
            User.banned_until.is_not(None), User.banned_until > datetime.now(timezone.utc)
        )
    elif banned is False:
        db_query = db_query.filter(
            or_(User.banned_until.is_(None), User.banned_until <= datetime.now(timezone.utc))
        )

    # Total BEFORE the in-Python activity/role filters below — those two
    # need the joined license data to evaluate, so they can't be pushed
    # into SQL without a correlated subquery. Cheap trade-off: we fetch
    # a slightly larger candidate set (capped) rather than paginate
    # after a full-table Python filter. `truncated` tells the caller
    # honestly when that cap was actually hit, so a filtered count is
    # never silently wrong at scale — same disclosure GET /admin/users/
    # summary already makes, now on this endpoint too.
    candidate_cap = 5000
    sql_matched_count = db_query.order_by(None).count()
    candidates = db_query.order_by(User.created_at.desc()).limit(candidate_cap).all()
    licenses = _bulk_latest_licenses(db, [u.id for u in candidates])

    def matches(u: User) -> bool:
        if activity and activity != "all":
            if _activity_status(_last_active_at(u, licenses.get(u.id))) != activity:
                return False
        if role and role != "all":
            if _platform_role_label(u) != role:
                return False
        return True

    filtered = [u for u in candidates if matches(u)]
    total = len(filtered)
    start = (page - 1) * page_size
    page_rows = filtered[start : start + page_size]

    return {
        "query": q,
        "count": len(page_rows),
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_more": start + page_size < total,
        "truncated": sql_matched_count > candidate_cap,
        "results": [_user_list_row(u, licenses.get(u.id)) for u in page_rows],
    }


@router.get("/users/summary")
def users_summary(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Overview cards for the Users dashboard. Every number here is a
    real aggregate over `users`/`licenses` — nothing is estimated.
    Definitions (also shown in the UI so they're never a mystery):
      total              — count(users)
      paid / free        — tier != 'free' / tier == 'free'
      new_7d / new_30d   — created_at within the window
      active             — active_at OR latest License.issued_at within
                            7 days (see _activity_status)
      recently_active    — same signal, 8-30 days
      inactive           — has a signal, but older than 30 days
      never_logged_in    — zero signal ever (no active_at, no License row)
      active_subscriptions — subscription_status == 'active'
    Capped at the same 5000-row candidate window as GET /admin/users so
    the two screens never disagree with each other; documented rather
    than silently inconsistent if the user base grows past that.
    """
    candidate_cap = 5000
    users = db.query(User).order_by(User.created_at.desc()).limit(candidate_cap).all()
    licenses = _bulk_latest_licenses(db, [u.id for u in users])

    now = datetime.now(timezone.utc)
    total = len(users)
    paid = sum(1 for u in users if _is_paid(u))
    free = total - paid
    new_7d = sum(1 for u in users if u.created_at and (now - _as_aware(u.created_at)).days < 7)
    new_30d = sum(1 for u in users if u.created_at and (now - _as_aware(u.created_at)).days < 30)
    active_subs = sum(1 for u in users if u.subscription_status == "active")

    buckets = {"active": 0, "recently_active": 0, "inactive": 0, "never_logged_in": 0}
    for u in users:
        buckets[_activity_status(_last_active_at(u, licenses.get(u.id)))] += 1

    return {
        "counted_of": total,
        "truncated": total >= candidate_cap,
        "total_users": total,
        "paid_users": paid,
        "free_users": free,
        "new_users_7d": new_7d,
        "new_users_30d": new_30d,
        "active_users": buckets["active"],
        "recently_active_users": buckets["recently_active"],
        "inactive_users": buckets["inactive"],
        "never_logged_in_users": buckets["never_logged_in"],
        "logged_in_users": total - buckets["never_logged_in"],
        "active_subscriptions": active_subs,
        "definitions": {
            "active": f"activity signal within {_ACTIVE_WINDOW_DAYS} days",
            "recently_active": f"activity signal within {_RECENTLY_ACTIVE_WINDOW_DAYS} days, but not within {_ACTIVE_WINDOW_DAYS}",
            "inactive": f"has an activity signal, but older than {_RECENTLY_ACTIVE_WINDOW_DAYS} days",
            "never_logged_in": "no active_at and no License row ever",
            "activity_signal": "User.active_at (ticks on clip export) OR most recent License.issued_at (minted on desktop sign-in)",
            "paid": "tier != 'free'",
        },
    }


@router.get("/users/{user_id}")
def user_detail(
    user_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    return _user_detail(db, user)


def _as_aware(ts: datetime) -> datetime:
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


@router.get("/users/{user_id}/clips")
def user_clips(
    user_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    before_id: int | None = None,
) -> dict[str, Any]:
    """Clip Runs for this user — same table the Clip Runs HQ tab reads
    (Control Tower #5). No duplicate storage; this is just a user_id-
    scoped, paginated projection of it."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    q = db.query(ClipRun).filter(ClipRun.user_id == user_id)
    if before_id is not None:
        q = q.filter(ClipRun.id < before_id)
    rows = q.order_by(ClipRun.id.desc()).limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    return {
        "user_id": user_id,
        "has_more": has_more,
        "clips": [
            {
                "run_id": r.run_id,
                "status": r.status,
                "current_stage": r.current_stage,
                "failure_layer": r.failure_layer,
                "customer_visible_error": r.customer_visible_error,
                "source_type": r.source_type,
                "clips_generated": r.clips_generated,
                "cost_usd_cents": r.cost_usd_cents,
                "tier": r.tier,
                "created_at": _iso(r.created_at),
                "completed_at": _iso(r.completed_at),
            }
            for r in rows
        ],
    }


@router.get("/users/{user_id}/campaigns")
def user_campaigns(
    user_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict[str, Any]:
    """Sponsored-campaign submissions this user has made. Real rows from
    `campaign_submissions` — the same table the public campaigns flow
    and the CampaignSubmissionsTab already write/read."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    rows = (
        db.query(CampaignSubmission)
        .filter(CampaignSubmission.user_id == user_id)
        .order_by(CampaignSubmission.created_at.desc())
        .limit(limit)
        .all()
    )
    return {
        "user_id": user_id,
        "submissions": [
            {
                "id": s.id,
                "campaign_id": s.campaign_id,
                "clip_url": s.clip_url,
                "status": s.status,
                "rejection_reason": s.rejection_reason,
                "verified_views": s.verified_views,
                "payout_usd_cents": s.payout_usd_cents,
                "created_at": _iso(s.created_at),
                "updated_at": _iso(s.updated_at),
            }
            for s in rows
        ],
    }


@router.get("/users/{user_id}/wallet")
def user_wallet(
    user_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict[str, Any]:
    """Wallet balance + recent ledger rows — reuses app.wallet's own
    compute_balance/compute_pending/compute_lifetime_paid (the SAME
    functions /me/wallet uses) rather than re-deriving the math here.
    Read-only: no payout-trigger action exists on this endpoint."""
    from app.wallet import compute_balance, compute_lifetime_paid, compute_pending

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    rows = (
        db.query(WalletLedger)
        .filter(WalletLedger.user_id == user_id)
        .order_by(WalletLedger.created_at.desc())
        .limit(limit)
        .all()
    )
    return {
        "user_id": user_id,
        "balance_cents": compute_balance(db, user_id),
        "pending_cents": compute_pending(db, user_id),
        "lifetime_paid_cents": compute_lifetime_paid(db, user_id),
        "ledger": [
            {
                "id": r.id,
                "type": r.type,
                "amount_cents": r.amount_cents,
                "currency": r.currency,
                "source": r.source,
                "created_at": _iso(r.created_at),
            }
            for r in rows
        ],
    }


@router.get("/users/{user_id}/community")
def user_community(
    user_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict[str, Any]:
    """Community relationship: message count/first/last activity per
    channel this user has actually posted in, plus recent messages.
    There is no separate 'membership' table — native community access
    is tier-gated at read/write time (see CommunityChannel), so
    'membership' here honestly means 'has posted', not a join record
    that doesn't exist."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")

    per_channel = (
        db.query(
            ChatMessage.channel,
            func.count(ChatMessage.id).label("count"),
            func.min(ChatMessage.created_at).label("first_at"),
            func.max(ChatMessage.created_at).label("last_at"),
        )
        .filter(ChatMessage.user_id == user_id)
        .group_by(ChatMessage.channel)
        .all()
    )
    recent = (
        db.query(ChatMessage)
        .filter(ChatMessage.user_id == user_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(limit)
        .all()
    )
    support_slug = f"support-{user_id}"
    return {
        "user_id": user_id,
        "support_channel_slug": support_slug,
        "channels": [
            {
                "channel": c.channel,
                "message_count": c.count,
                "first_message_at": _iso(c.first_at),
                "last_message_at": _iso(c.last_at),
            }
            for c in per_channel
        ],
        "recent_messages": [
            {
                "id": m.id,
                "channel": m.channel,
                "content": m.content,
                "role": m.role,
                "hidden": m.hidden_at is not None,
                "created_at": _iso(m.created_at),
            }
            for m in recent
        ],
    }


@router.get("/users/{user_id}/timeline")
def user_timeline(
    user_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> dict[str, Any]:
    """Best-effort chronological view built ONLY from timestamps that already
    exist in the DB. There is still no dedicated event store — this stays a
    projection over existing tables, not a new audit log. Each row carries
    `source` so the UI can label what is / isn't backed by real data.

    2026-09-02 · Bucket "User 360" — added ClipRun, CampaignSubmission,
    WalletLedger, and public ChatMessage activity (all genuinely user_id-
    linked tables that either didn't exist or weren't wired in when this
    endpoint was first written). Deliberately did NOT add TelemetryEvent:
    I could not verify within this pass what value its `actor_id` column
    actually holds for authenticated users (Clerk id? backend User.id?
    session id? — no existing caller in the codebase queries it by user),
    and showing activity under the wrong user would be worse than not
    showing it. Left in `unavailable` rather than guessed."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")

    events: list[dict[str, Any]] = []

    def add(
        ts: datetime | None, kind: str, label: str, source: str, status_val: str | None = None
    ) -> None:
        if ts is None:
            return
        events.append(
            {"at": _iso(ts), "kind": kind, "label": label, "source": source, "status": status_val}
        )

    add(user.created_at, "signup", "Junior account created", "users.created_at")
    add(user.trial_started_at, "trial_started", "Trial started", "users.trial_started_at")

    # Licenses (desktop license JWT mints · closest thing to a login log).
    for lic in db.query(License).filter(License.user_id == user.id).all():
        add(lic.issued_at, "login", f"License issued ({lic.tier_at_issue})", "licenses.issued_at")
        if lic.revoked:
            # No revoked_at column — flag it on the issued row's source instead.
            add(lic.issued_at, "license_revoked", f"License revoked ({lic.tier_at_issue})", "licenses.revoked (no timestamp)")

    # Pending Whop membership(s) keyed by this user's email.
    pendings = (
        db.query(PendingWhopMembership)
        .filter(PendingWhopMembership.email == (user.email or "").strip().lower())
        .all()
    )
    for p in pendings:
        add(p.created_at, "pending_stashed", f"Whop pending stashed ({p.tier})", "pending_whop_memberships.created_at")
        add(p.consumed_at, "pending_consumed", "Whop pending claimed", "pending_whop_memberships.consumed_at")

    # Claim tokens requested by this Clerk user (never render the raw token).
    for tok in db.query(WhopClaimToken).filter(WhopClaimToken.clerk_user_id == (user.clerk_id or "")).all():
        add(tok.created_at, "claim_created", "Whop claim link emailed", "whop_claim_tokens.created_at")
        add(tok.consumed_at, "claim_redeemed", "Whop claim redeemed", "whop_claim_tokens.consumed_at")

    # Notifications (welcome / billing / founder / publish, etc.).
    for n in (
        db.query(Notification)
        .filter(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc())
        .limit(100)
        .all()
    ):
        add(n.created_at, f"notification_{n.category}", n.title, "notifications.created_at")

    # Clip runs — one event per attempt (Control Tower #5 ledger).
    for r in (
        db.query(ClipRun)
        .filter(ClipRun.user_id == user.id)
        .order_by(ClipRun.created_at.desc())
        .limit(200)
        .all()
    ):
        label = f"Clip run · {r.clips_generated} clip(s) generated" if r.status == "success" else f"Clip run {r.status}"
        add(r.created_at, "clip_run", label, "clip_runs.created_at", r.status)

    # Campaign submissions.
    for s in (
        db.query(CampaignSubmission)
        .filter(CampaignSubmission.user_id == user.id)
        .order_by(CampaignSubmission.created_at.desc())
        .limit(200)
        .all()
    ):
        add(
            s.created_at,
            "campaign_submission",
            f"Submitted clip to campaign '{s.campaign_id}'",
            "campaign_submissions.created_at",
            s.status,
        )
        if s.updated_at and s.updated_at != s.created_at and s.status in {"accepted", "rejected", "paid"}:
            add(
                s.updated_at,
                f"campaign_submission_{s.status}",
                f"Submission to '{s.campaign_id}' {s.status}",
                "campaign_submissions.updated_at",
                s.status,
            )

    # Wallet ledger — credits/debits/payouts.
    for w in (
        db.query(WalletLedger)
        .filter(WalletLedger.user_id == user.id)
        .order_by(WalletLedger.created_at.desc())
        .limit(200)
        .all()
    ):
        add(
            w.created_at,
            f"wallet_{w.type}",
            f"Wallet {w.type} · ${w.amount_cents / 100:.2f} ({w.source})",
            "wallet_ledger.created_at",
        )

    # Public community activity (support-channel DMs are surfaced via
    # GET /admin/users/{id}/messages instead — kept out of this general
    # timeline so a private support conversation doesn't leak into a
    # general-purpose activity feed a wider set of admin eyes might see).
    for m in (
        db.query(ChatMessage)
        .filter(ChatMessage.user_id == user.id, ~ChatMessage.channel.startswith("support-"))
        .order_by(ChatMessage.created_at.desc())
        .limit(100)
        .all()
    ):
        add(m.created_at, "community_message", f"Posted in #{m.channel}", "chat_messages.created_at")

    # WebhookEvent has no user/pending FK in v0 — can't link rows to this user
    # without storing PII, so we surface that gap rather than guessing.

    events.sort(key=lambda e: e["at"] or "", reverse=True)
    total = len(events)
    events = events[:limit]

    return {
        "user_id": user.id,
        "email_masked": _mask_email(user.email),
        "events": events,
        "total_events": total,
        "has_more": total > limit,
        "unavailable": [
            "affiliate_link_clicked (not stored in DB; lives in PostHog)",
            "checkout_viewed / completed (PostHog only)",
            "desktop_activated (no activation timestamp persisted in v0)",
            "individual clip_exported events beyond the ClipRun ledger (pre-Control-Tower-#5 exports aren't backfilled)",
            "webhook rows for this user (WebhookEvent has no user/pending link in v0)",
            "generic subscription/payment transitions beyond wallet_ledger + license issuance (Whop/Clerk own the full ledger; not mirrored as events)",
            "TelemetryEvent-sourced activity (actor_id's meaning for authenticated users isn't verified — see docstring; would need instrumentation confirmation, not a guess)",
            "explicit logout events (no logout timestamp is persisted anywhere)",
            "failed-login attempts (not persisted — only successful license issuance is)",
        ],
        "note": "Timeline is built from existing DB timestamps across users/licenses/pending-whop/claim-tokens/notifications/clip_runs/campaign_submissions/wallet_ledger/chat_messages. No new event store was added.",
    }


# ======================================================================
# 3. Pending Whop memberships (read-only)
# ======================================================================

@router.get("/pending-whop")
def pending_whop(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    limit: int = 100,
) -> dict[str, Any]:
    rows = (
        db.query(PendingWhopMembership)
        .order_by(PendingWhopMembership.created_at.desc())
        .limit(min(limit, 500))
        .all()
    )
    out = []
    for p in rows:
        out.append(
            {
                "id": p.id,
                "email_masked": _mask_email(p.email),
                "tier": p.tier,
                "founder": p.founder,
                "whop_user_id": p.whop_user_id,
                "renewal_period_end": p.renewal_period_end,
                "created_at": _iso(p.created_at),
                "consumed_at": _iso(p.consumed_at),
                "status": "consumed" if p.consumed_at else "open",
                "age_seconds": _age_seconds(p.created_at),
            }
        )
    return {
        "count": len(out),
        "rows": out,
        "note": (
            "resend-claim is intentionally NOT offered for pending rows in v0: a "
            "pending has no requester user yet, so a claim token can't be safely "
            "minted (would be an unverified instant link). The buyer self-serves "
            "via /get → claim flow."
        ),
    }


# ======================================================================
# 4. Claims (read-only) + safe actions
# ======================================================================

def _claim_status(tok: WhopClaimToken, now: datetime) -> str:
    if tok.consumed_at is not None:
        return "used"
    if tok.expires_at <= now:
        return "expired"
    return "open"


@router.get("/claims")
def claims(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    limit: int = 100,
) -> dict[str, Any]:
    """Read-only. NEVER returns the raw token — only a short safe id derived
    from the primary key (not the secret token value)."""
    now = _now()
    rows = (
        db.query(WhopClaimToken)
        .order_by(WhopClaimToken.created_at.desc())
        .limit(min(limit, 500))
        .all()
    )
    out = []
    for tok in rows:
        out.append(
            {
                "id": tok.id,
                "short_id": _short_id(tok.id),
                "target_email_masked": _mask_email(tok.whop_purchase_email),
                "requester_clerk_id": tok.clerk_user_id,
                "created_at": _iso(tok.created_at),
                "expires_at": _iso(tok.expires_at),
                "used_at": _iso(tok.consumed_at),
                "status": _claim_status(tok, now),
            }
        )
    return {"count": len(out), "rows": out}


class SafeActionResult(BaseModel):
    ok: bool
    id: str
    action: str
    status: str
    message: str


@router.post("/claims/{token_id}/expire", response_model=SafeActionResult)
def expire_claim(
    token_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> SafeActionResult:
    """Safe support action: expire a claim token by stamping consumed_at=now.
    Idempotent — a token already used/expired is reported, not re-mutated. This
    only burns a one-use link; it does NOT touch billing or entitlement."""
    tok = db.get(WhopClaimToken, token_id)
    if not tok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "claim token not found")

    now = _now()
    current = _claim_status(tok, now)
    if current != "open":
        return SafeActionResult(
            ok=True,
            id=tok.id,
            action="expire",
            status=current,
            message=f"No-op: token already {current}.",
        )

    tok.consumed_at = now
    db.commit()
    return SafeActionResult(
        ok=True,
        id=tok.id,
        action="expire",
        status="used",
        message="Token expired (consumed_at stamped). The link no longer redeems.",
    )


@router.post("/claims/{token_id}/resend", response_model=SafeActionResult)
def resend_claim(
    token_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> SafeActionResult:
    """Safe support action: re-email the EXISTING claim link to the same Whop
    purchase email, ONLY while the token is still open. We reconstruct the same
    claim URL the onboarding flow uses and reuse the existing one-use token — no
    new token is minted, nothing about billing/entitlement changes. If the
    token is used/expired we refuse (a stale link is useless and re-minting
    would be an unverified instant link, which v0 must not do)."""
    tok = db.get(WhopClaimToken, token_id)
    if not tok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "claim token not found")

    now = _now()
    current = _claim_status(tok, now)
    if current != "open":
        return SafeActionResult(
            ok=False,
            id=tok.id,
            action="resend",
            status=current,
            message=(
                f"Refused: token is {current}. v0 will not mint a fresh token (that "
                "would be an unverified instant link). The buyer can re-request via /get."
            ),
        )

    s = get_settings()
    claim_url = f"{s.account_site_url}/get?claim={tok.token}"
    try:
        from app.mailer import send_whop_claim_link

        send_whop_claim_link(tok.whop_purchase_email, claim_url=claim_url)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"resend failed: {type(exc).__name__}"
        ) from exc

    return SafeActionResult(
        ok=True,
        id=tok.id,
        action="resend",
        status="open",
        message=f"Re-sent the existing claim link to {_mask_email(tok.whop_purchase_email)}.",
    )


# ======================================================================
# 5. Webhooks (read-only)
# ======================================================================

@router.get("/webhooks")
def webhooks(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    provider: str | None = None,
    status: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    """Recent rows from the metadata-only WebhookEventLog: provider, event name,
    outcome status (received|handled|ignored|failed), linked user/pending ids, and
    a short sanitized error. No raw payloads, emails, secrets, or tokens stored.
    Optional ?provider=clerk|whop and ?status=... filters."""
    q = db.query(WebhookEventLog)
    if provider in ("clerk", "whop"):
        q = q.filter(WebhookEventLog.provider == provider)
    if status in ("received", "handled", "ignored", "failed"):
        q = q.filter(WebhookEventLog.status == status)
    rows = q.order_by(WebhookEventLog.received_at.desc()).limit(min(limit, 500)).all()
    out = [
        {
            "id": w.id,
            "provider": w.provider,
            "event_name": w.event_name,
            "status": w.status,
            "user_id": w.user_id,
            "pending_whop_membership_id": w.pending_whop_membership_id,
            "claim_token_id": w.claim_token_id,
            "external_event_id": w.external_event_id,
            "error": w.error,
            "received_at": _iso(w.received_at),
            "handled_at": _iso(w.handled_at),
        }
        for w in rows
    ]
    return {"count": len(out), "rows": out}


# ======================================================================
# 6. Postiz (status display only — no Postiz changes)
# ======================================================================

@router.get("/postiz")
def postiz_status(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    limit: int = 50,
) -> dict[str, Any]:
    """Production status for the hidden publisher: configured yes/no, schedule
    health (status counts + last error), and connection counts per user that
    are cheap to read locally (the PostizConnection row — NOT a live Postiz API
    fan-out). Display only; this endpoint never calls or mutates Postiz."""
    from app import postiz

    schedules = db.query(Schedule).all()
    status_counts: dict[str, int] = {}
    last_error: dict[str, Any] | None = None
    for sch in schedules:
        status_counts[sch.status] = status_counts.get(sch.status, 0) + 1
    # Most recent failed schedule's error (best-effort).
    last_failed = (
        db.query(Schedule)
        .filter(Schedule.status == "failed", Schedule.error.isnot(None))
        .order_by(Schedule.updated_at.desc())
        .first()
    )
    if last_failed:
        last_error = {
            "schedule_id": last_failed.id,
            "platform": last_failed.platform,
            "error": last_failed.error,
            "at": _iso(last_failed.updated_at),
            "retry_count": last_failed.retry_count,
        }

    recent = (
        db.query(Schedule)
        .order_by(Schedule.updated_at.desc())
        .limit(min(limit, 200))
        .all()
    )
    recent_rows = [
        {
            "id": sch.id,
            "platform": sch.platform,
            "status": sch.status,
            "scheduled_for": _iso(sch.scheduled_for),
            "post_url": sch.post_url,
            "retry_count": sch.retry_count,
            "updated_at": _iso(sch.updated_at),
        }
        for sch in recent
    ]

    # Cheap local connection counts (one row per connected user). We do NOT
    # fan out to the Postiz API to enumerate per-platform integrations.
    conns = db.query(PostizConnection).all()
    connection_summary = {
        "users_with_connection": len(conns),
        "active_connections": sum(1 for c in conns if c.active),
    }

    return {
        "configured": postiz.is_live(),
        "status_counts": status_counts,
        "schedules_total": len(schedules),
        "last_error": last_error,
        "connections": connection_summary,
        "recent_schedules": recent_rows,
        "note": (
            "Status display only — Admin HQ never calls or changes Postiz. Per-user "
            "per-platform integration detail lives in Postiz; counts here are the "
            "local PostizConnection rows. published/scheduled/failed are in status_counts."
        ),
    }


# ======================================================================
# 6b. Ayrshare publishing status (2026-06-25 · the live rail today)
# ======================================================================

@router.get("/ayrshare")
def ayrshare_status(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    limit: int = 50,
) -> dict[str, Any]:
    """Production status for the Ayrshare publishing rail (the live publisher
    today; Postiz is retained as a fallback architecture). Mirrors the shape
    of /admin/postiz so the HQ tab can render identically. Status display
    only — never mutates Ayrshare."""
    from app import ayrshare

    schedules = db.query(Schedule).all()
    status_counts: dict[str, int] = {}
    last_error: dict[str, Any] | None = None
    for sch in schedules:
        status_counts[sch.status] = status_counts.get(sch.status, 0) + 1
    last_failed = (
        db.query(Schedule)
        .filter(Schedule.status == "failed", Schedule.error.isnot(None))
        .order_by(Schedule.updated_at.desc())
        .first()
    )
    if last_failed:
        last_error = {
            "schedule_id": last_failed.id,
            "platform": last_failed.platform,
            "error": last_failed.error,
            "at": _iso(last_failed.updated_at),
            "retry_count": last_failed.retry_count,
        }

    recent = (
        db.query(Schedule)
        .order_by(Schedule.updated_at.desc())
        .limit(min(limit, 200))
        .all()
    )
    recent_rows = [
        {
            "id": sch.id,
            "platform": sch.platform,
            "status": sch.status,
            "scheduled_for": _iso(sch.scheduled_for),
            "post_url": sch.post_url,
            "retry_count": sch.retry_count,
            "updated_at": _iso(sch.updated_at),
        }
        for sch in recent
    ]

    # SocialConnection rows (Ayrshare Profile Keys pasted by each user in
    # Settings → Connections). Counts only — no per-platform fan-out.
    conns = db.query(SocialConnection).all()
    connection_summary = {
        "users_with_connection": len(conns),
        "active_connections": sum(1 for c in conns if getattr(c, "active", True) is True),
    }

    return {
        "configured": ayrshare.is_configured(),
        "status_counts": status_counts,
        "schedules_total": len(schedules),
        "last_error": last_error,
        "connections": connection_summary,
        "recent_schedules": recent_rows,
        "note": (
            "Status display only — Admin HQ never calls or changes Ayrshare. "
            "Per-user per-platform integration detail lives in Ayrshare; counts "
            "here are the local SocialConnection rows."
        ),
    }


# ======================================================================
# 7. Desktop bug telemetry (read-only)
# ======================================================================

# A group (event or error_code) is flagged needs_action when it has spiked
# recently or just appeared. Tunable thresholds.
_BUGS_SPIKE_COUNT = 5        # ≥ this many in the last 24h → spike
_BUGS_SPIKE_WINDOW_H = 24
_BUGS_NEW_WINDOW_H = 1       # first seen within the last hour → brand-new


def _bug_row(e: DesktopErrorEvent) -> dict[str, Any]:
    """All fields of one event. Already sanitized at ingest (telemetry.py):
    message has emails redacted + is truncated; user_ref is an internal id, never
    a JWT/secret; no file paths/tokens are stored. We surface them verbatim."""
    return {
        "id": e.id,
        "event": e.event,
        "app_version": e.app_version,
        "os": e.os,
        "arch": e.arch,
        "route": e.route,
        "http_status": e.http_status,
        "error_code": e.error_code,
        "message": e.message,
        "user_ref": e.user_ref,
        "created_at": _iso(e.created_at),
    }


@router.get("/bugs")
def bugs(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    event: str | None = None,
    app_version: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    """Desktop error telemetry for Admin HQ → Bugs. Read-only over the
    metadata-only DesktopErrorEvent table (no secrets/tokens/paths stored).

    Returns the recent events (newest first, all fields) plus aggregations:
      - count by app_version
      - count by event and by error_code
      - distinct affected users (non-null user_ref)
      - per-group last_seen
      - needs_action flags: a group seen ≥ 5 times in the last 24h, OR a
        brand-new error_code first seen in the last hour.

    Optional ?event= and ?app_version= filters narrow BOTH the recent list and
    the aggregations so a drill-down is self-consistent."""
    now = _now()
    spike_since = now - timedelta(hours=_BUGS_SPIKE_WINDOW_H)
    new_since = now - timedelta(hours=_BUGS_NEW_WINDOW_H)

    base = db.query(DesktopErrorEvent)
    if event:
        base = base.filter(DesktopErrorEvent.event == event)
    if app_version:
        base = base.filter(DesktopErrorEvent.app_version == app_version)

    # Pull recent rows (newest first) for the table.
    recent_rows = (
        base.order_by(DesktopErrorEvent.created_at.desc())
        .limit(min(max(limit, 1), 500))
        .all()
    )

    # For aggregations we scan the filtered set. Telemetry is metadata-only and
    # low-volume; a single ordered scan keeps the dialect-portable logic simple
    # (works identically on SQLite-dev and Postgres-prod) without per-group SQL.
    all_rows = base.order_by(DesktopErrorEvent.created_at.desc()).all()

    by_app_version: dict[str, int] = {}
    by_event: dict[str, int] = {}
    by_error_code: dict[str, int] = {}

    # Per-group tracking for last_seen + needs_action. We track BOTH event and
    # error_code groupings (error_code may be null → bucketed as "(none)").
    # group key → {count, count_24h, last_seen, first_seen}
    def _empty() -> dict[str, Any]:
        return {"count": 0, "count_24h": 0, "last_seen": None, "first_seen": None}

    event_groups: dict[str, dict[str, Any]] = {}
    code_groups: dict[str, dict[str, Any]] = {}
    affected_users: set[str] = set()

    def _track(groups: dict[str, dict[str, Any]], key: str, ts: datetime | None) -> None:
        g = groups.setdefault(key, _empty())
        g["count"] += 1
        if ts is not None:
            iso = _iso(ts)
            if g["last_seen"] is None or (iso or "") > g["last_seen"]:
                g["last_seen"] = iso
            if g["first_seen"] is None or (iso or "") < g["first_seen"]:
                g["first_seen"] = iso
            if ts >= spike_since:
                g["count_24h"] += 1

    for e in all_rows:
        by_app_version[e.app_version] = by_app_version.get(e.app_version, 0) + 1
        by_event[e.event] = by_event.get(e.event, 0) + 1
        code_key = e.error_code or "(none)"
        by_error_code[code_key] = by_error_code.get(code_key, 0) + 1
        if e.user_ref:
            affected_users.add(e.user_ref)
        _track(event_groups, e.event, e.created_at)
        _track(code_groups, code_key, e.created_at)

    # needs_action: spike (≥N in 24h) OR brand-new error_code (first seen in last
    # hour). New-detection applies to real error_codes only, not the "(none)"
    # bucket. A spike can fire on either an event group or an error_code group.
    needs_action: list[dict[str, Any]] = []

    def _consider(kind: str, key: str, g: dict[str, Any], allow_new: bool) -> None:
        reasons: list[str] = []
        if g["count_24h"] >= _BUGS_SPIKE_COUNT:
            reasons.append(f"spike: {g['count_24h']} in last {_BUGS_SPIKE_WINDOW_H}h")
        if allow_new and g["first_seen"] is not None:
            try:
                first_dt = datetime.fromisoformat(g["first_seen"])
            except ValueError:
                first_dt = None
            if first_dt is not None:
                # Normalise to compare against `new_since` on either dialect.
                cmp_first = first_dt
                if new_since.tzinfo is None and cmp_first.tzinfo is not None:
                    cmp_first = cmp_first.replace(tzinfo=None)
                elif new_since.tzinfo is not None and cmp_first.tzinfo is None:
                    cmp_first = cmp_first.replace(tzinfo=timezone.utc)
                if cmp_first >= new_since:
                    reasons.append(f"new: first seen within last {_BUGS_NEW_WINDOW_H}h")
        if reasons:
            needs_action.append(
                {
                    "kind": kind,            # "event" | "error_code"
                    "key": key,
                    "count": g["count"],
                    "count_24h": g["count_24h"],
                    "last_seen": g["last_seen"],
                    "first_seen": g["first_seen"],
                    "reasons": reasons,
                }
            )

    for key, g in event_groups.items():
        _consider("event", key, g, allow_new=False)
    for key, g in code_groups.items():
        # Brand-new detection only for real error codes, not the null bucket.
        _consider("error_code", key, g, allow_new=(key != "(none)"))

    # Per-group last_seen surfaced for the UI (event + error_code groupings).
    last_seen_by_event = {k: g["last_seen"] for k, g in event_groups.items()}
    last_seen_by_error_code = {k: g["last_seen"] for k, g in code_groups.items()}

    return {
        "filters": {"event": event, "app_version": app_version},
        "total_events": len(all_rows),
        "recent": [_bug_row(e) for e in recent_rows],
        "aggregations": {
            "by_app_version": by_app_version,
            "by_event": by_event,
            "by_error_code": by_error_code,
            "affected_users": len(affected_users),  # distinct non-null user_ref
            "last_seen_by_event": last_seen_by_event,
            "last_seen_by_error_code": last_seen_by_error_code,
        },
        "needs_action": needs_action,
        "thresholds": {
            "spike_count": _BUGS_SPIKE_COUNT,
            "spike_window_hours": _BUGS_SPIKE_WINDOW_H,
            "new_window_hours": _BUGS_NEW_WINDOW_H,
        },
        "generated_at": _iso(datetime.now(timezone.utc)),
        "note": (
            "Metadata only — no secrets, JWTs, tokens, or file paths are stored. "
            "message is sanitized at ingest (emails redacted, truncated); user_ref "
            "is an internal backend/clerk id used only for grouping."
        ),
    }


# ── Reward bonus ledger (v0.7.55, Uncle Daniel funnel — Phase 1) ─────
# Whop owns submission flow + base $1 RPM. LC tracks the $4 premium
# bonus on rows mirrored from approved Whop submissions. Admin imports
# manually here in Phase 1; Phase 2 wires a Whop webhook.


class BonusLedgerImportPayload(BaseModel):
    """Admin payload to mirror an approved Whop submission into the LC
    bonus ledger. Whop has already approved + validated + paid the base
    $1 RPM by the time this is called — we only record the bonus due."""
    whop_submission_id: str = Field(..., min_length=1, max_length=80)
    whop_bounty_id: str | None = Field(None, max_length=80)
    whop_user_id: str | None = Field(None, max_length=80)
    liquid_clips_user_id: str | None = Field(None, max_length=80)
    email: str | None = Field(None, max_length=240)
    campaign_id: str | None = Field(None, max_length=120)
    mission_lane: str | None = Field(None, max_length=60)
    submitted_post_url: str = Field(..., min_length=8, max_length=600)
    whop_status: str = Field("approved", max_length=40)
    approved_views: int = Field(0, ge=0)
    membership_status_at_export: str = Field("free", max_length=40)
    export_watermark_status: str = Field(
        "unknown",
        pattern=r"^(true|false|unknown)$",
        description="'true' = export had watermark, 'false' = clean (premium bonus eligible).",
    )
    base_rpm_cents: int | None = Field(None, ge=0, description="Override campaign base RPM. Defaults to campaign value.")
    premium_bonus_rpm_cents: int | None = Field(None, ge=0, description="Override campaign premium bonus per 1k. Defaults to campaign value.")
    notes: str | None = Field(None, max_length=400)


class BonusMarkPaidPayload(BaseModel):
    approved_views: int | None = Field(None, ge=0, description="Update view count at payout time (optional).")
    notes: str | None = Field(None, max_length=400)


def _admin_serialize_ledger(
    row: RewardBonusLedger,
    user: User | None,
    campaign: SponsoredCampaign | None,
) -> dict[str, Any]:
    return {
        "id": row.id,
        "whop_submission_id": row.whop_submission_id,
        "whop_bounty_id": row.whop_bounty_id,
        "whop_user_id": row.whop_user_id,
        "liquid_clips_user_id": row.liquid_clips_user_id,
        "email": row.email or (user.email if user else ""),
        "campaign_id": row.campaign_id,
        "campaign_name": campaign.name if campaign else None,
        "mission_lane": row.mission_lane,
        "submitted_post_url": row.submitted_post_url,
        "whop_status": row.whop_status,
        "approved_views": row.approved_views,
        "membership_status_at_export": row.membership_status_at_export,
        "export_watermark_status": row.export_watermark_status,
        "base_rpm_cents": row.base_rpm_cents,
        "premium_bonus_rpm_cents": row.premium_bonus_rpm_cents,
        "base_payout_cents": row.base_payout_cents,
        "premium_bonus_due_cents": row.premium_bonus_due_cents,
        "total_effective_payout_cents": row.total_effective_payout_cents,
        "bonus_payout_status": row.bonus_payout_status,
        "bonus_payout_notes": row.bonus_payout_notes,
        # Existing per-user counter incremented by Whop webhook on first
        # trial→paid; use as the affiliate signal in the admin panel.
        "affiliate_referrals": user.referred_paid_subs if user else 0,
        "bonus_marked_paid_at": (
            row.bonus_marked_paid_at.isoformat() if row.bonus_marked_paid_at else None
        ),
        "ledger_created_at": row.ledger_created_at.isoformat(),
    }


def _compute_ledger_amounts(
    *,
    approved_views: int,
    base_rpm_cents: int,
    premium_bonus_rpm_cents: int,
    is_premium: bool,
    watermark_status: str,
) -> tuple[int, int, int]:
    """Return (base_payout, premium_bonus_due, total_effective) in cents.

    Premium bonus only accrues for paid users with a clean (no-watermark)
    export — matches Daniel's payout_logic spec verbatim:
      free_user   → base=$1 RPM, bonus=$0, total=$1 RPM
      paid_user   → base=$1 RPM, bonus=$4 RPM, total=$5 RPM
    `watermark_status === "true"` means the export HAD a watermark, so
    bonus is zero regardless of tier.
    """
    base_payout = int((approved_views * base_rpm_cents) / 1000)
    bonus_eligible = is_premium and watermark_status != "true"
    bonus = (
        int((approved_views * premium_bonus_rpm_cents) / 1000) if bonus_eligible else 0
    )
    return base_payout, bonus, base_payout + bonus


@router.get("/bonus-ledger")
def list_admin_bonus_ledger(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    status_filter: str | None = Query(default=None, alias="status", pattern=r"^(pending|paid|waived)$"),
    mission_lane: str | None = Query(default=None, max_length=60),
) -> dict[str, Any]:
    """Admin ledger of every premium-bonus row mirrored from Whop.
    Filterable by bonus payout status and mission lane so the unpaid
    queue is one click away."""
    q = db.query(RewardBonusLedger).order_by(RewardBonusLedger.ledger_created_at.desc())
    if status_filter:
        q = q.filter(RewardBonusLedger.bonus_payout_status == status_filter)
    if mission_lane:
        q = q.filter(RewardBonusLedger.mission_lane == mission_lane)
    rows = q.limit(500).all()

    user_ids = {r.liquid_clips_user_id for r in rows if r.liquid_clips_user_id}
    campaign_ids = {r.campaign_id for r in rows if r.campaign_id}
    users_by_id: dict[str, User] = (
        {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()}
        if user_ids
        else {}
    )
    campaigns_by_id: dict[str, SponsoredCampaign] = (
        {c.id: c for c in db.query(SponsoredCampaign).filter(SponsoredCampaign.id.in_(campaign_ids)).all()}
        if campaign_ids
        else {}
    )
    return {
        "rows": [
            _admin_serialize_ledger(
                r,
                users_by_id.get(r.liquid_clips_user_id) if r.liquid_clips_user_id else None,
                campaigns_by_id.get(r.campaign_id) if r.campaign_id else None,
            )
            for r in rows
        ],
    }


@router.post("/bonus-ledger/import")
def import_whop_submission_to_ledger(
    payload: BonusLedgerImportPayload,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Mirror an approved Whop submission into the bonus ledger. Idempotent
    on `whop_submission_id`: a re-import patches the existing row instead
    of duplicating. Computes base + bonus from per-row RPMs at mirror
    time so the liability is locked against later campaign edits.

    v0.7.55 P1-001 — auto-resolve the clipper's `liquid_clips_user_id`
    from the supplied email or whop_user_id when the admin doesn't pass
    one explicitly. Pre-fix the import form had no LC user input and the
    backend never resolved one, so every imported row was unreachable
    from /bonus-ledger/me (the clipper-facing read filters by
    liquid_clips_user_id == self.id) — every clipper saw their bonus
    queue empty even after a successful import.
    """
    existing = (
        db.query(RewardBonusLedger)
        .filter(RewardBonusLedger.whop_submission_id == payload.whop_submission_id)
        .one_or_none()
    )

    # v0.7.55 P1-001 — auto-resolve LC user from email or whop_user_id.
    # Both lookups fall back gracefully (resolved_user stays None and the
    # row simply isn't owned yet; admin can patch later by re-importing).
    resolved_user_id: str | None = payload.liquid_clips_user_id
    resolved_user: User | None = None
    if not resolved_user_id and payload.email:
        resolved_user = (
            db.query(User).filter(User.email == payload.email.lower()).one_or_none()
        )
        if resolved_user:
            resolved_user_id = resolved_user.id
    if not resolved_user_id and payload.whop_user_id:
        resolved_user = (
            db.query(User).filter(User.whop_user_id == payload.whop_user_id).one_or_none()
        )
        if resolved_user:
            resolved_user_id = resolved_user.id
    if resolved_user_id and resolved_user is None:
        resolved_user = db.query(User).filter(User.id == resolved_user_id).one_or_none()

    campaign: SponsoredCampaign | None = None
    if payload.campaign_id:
        campaign = (
            db.query(SponsoredCampaign)
            .filter(
                (SponsoredCampaign.id == payload.campaign_id)
                | (SponsoredCampaign.slug == payload.campaign_id)
            )
            .one_or_none()
        )

    base_rpm = (
        payload.base_rpm_cents
        if payload.base_rpm_cents is not None
        else ((campaign.base_rpm_cents or campaign.rpm_cents or 0) if campaign else 0)
    )
    premium_bonus_rpm = (
        payload.premium_bonus_rpm_cents
        if payload.premium_bonus_rpm_cents is not None
        else (campaign.premium_bonus_cents if campaign else 0)
    )
    is_premium = payload.membership_status_at_export in {"solo", "pro", "agency", "agency_solo", "agency_whitelabel"}
    base_payout, bonus_due, total = _compute_ledger_amounts(
        approved_views=payload.approved_views,
        base_rpm_cents=base_rpm,
        premium_bonus_rpm_cents=premium_bonus_rpm,
        is_premium=is_premium,
        watermark_status=payload.export_watermark_status,
    )

    if existing:
        existing.whop_bounty_id = payload.whop_bounty_id
        existing.whop_user_id = payload.whop_user_id
        existing.liquid_clips_user_id = resolved_user_id
        existing.email = payload.email
        existing.campaign_id = payload.campaign_id
        existing.mission_lane = payload.mission_lane
        existing.submitted_post_url = payload.submitted_post_url
        existing.whop_status = payload.whop_status
        existing.approved_views = payload.approved_views
        existing.membership_status_at_export = payload.membership_status_at_export
        existing.export_watermark_status = payload.export_watermark_status
        existing.base_rpm_cents = base_rpm
        existing.premium_bonus_rpm_cents = premium_bonus_rpm
        existing.base_payout_cents = base_payout
        existing.premium_bonus_due_cents = bonus_due
        existing.total_effective_payout_cents = total
        if payload.notes:
            existing.bonus_payout_notes = payload.notes
        row = existing
    else:
        row = RewardBonusLedger(
            whop_submission_id=payload.whop_submission_id,
            whop_bounty_id=payload.whop_bounty_id,
            whop_user_id=payload.whop_user_id,
            liquid_clips_user_id=resolved_user_id,
            email=payload.email,
            campaign_id=payload.campaign_id,
            mission_lane=payload.mission_lane,
            submitted_post_url=payload.submitted_post_url,
            whop_status=payload.whop_status,
            approved_views=payload.approved_views,
            membership_status_at_export=payload.membership_status_at_export,
            export_watermark_status=payload.export_watermark_status,
            base_rpm_cents=base_rpm,
            premium_bonus_rpm_cents=premium_bonus_rpm,
            base_payout_cents=base_payout,
            premium_bonus_due_cents=bonus_due,
            total_effective_payout_cents=total,
            bonus_payout_status="pending",
            bonus_payout_notes=payload.notes,
        )
        db.add(row)
    db.commit()
    db.refresh(row)

    # v0.7.55 P1-001 — reuse the user we already resolved instead of a
    # third query. Also signals to the admin in the response whether the
    # row is now attributable: `liquid_clips_user_id` non-null means the
    # clipper will see it on /bonus-ledger/me.
    user = resolved_user
    return {"row": _admin_serialize_ledger(row, user, campaign)}


@router.post("/bonus-ledger/{row_id}/mark-paid")
def mark_bonus_paid(
    row_id: str,
    payload: BonusMarkPaidPayload,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Admin records the premium bonus has been paid out of band.
    Optionally updates approved_views if Whop revised the count after
    import. Phase 2 will replace the side-effect with a Whop transfer."""
    row = db.query(RewardBonusLedger).filter(RewardBonusLedger.id == row_id).one_or_none()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"ledger row not found: {row_id}")

    if payload.approved_views is not None and payload.approved_views != row.approved_views:
        # Recompute liability if views changed.
        is_premium = row.membership_status_at_export in {"solo", "pro", "agency", "agency_solo", "agency_whitelabel"}
        base_payout, bonus_due, total = _compute_ledger_amounts(
            approved_views=payload.approved_views,
            base_rpm_cents=row.base_rpm_cents,
            premium_bonus_rpm_cents=row.premium_bonus_rpm_cents,
            is_premium=is_premium,
            watermark_status=row.export_watermark_status,
        )
        row.approved_views = payload.approved_views
        row.base_payout_cents = base_payout
        row.premium_bonus_due_cents = bonus_due
        row.total_effective_payout_cents = total

    row.bonus_payout_status = "paid"
    if payload.notes:
        row.bonus_payout_notes = payload.notes
    row.bonus_marked_paid_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)

    user = (
        db.query(User).filter(User.id == row.liquid_clips_user_id).one_or_none()
        if row.liquid_clips_user_id
        else None
    )
    campaign = (
        db.query(SponsoredCampaign).filter(SponsoredCampaign.id == row.campaign_id).one_or_none()
        if row.campaign_id
        else None
    )
    return {"row": _admin_serialize_ledger(row, user, campaign)}


# ── Community channels (v0.7.55) ──────────────────────────────────────


class CommunityChannelPayload(BaseModel):
    """Create + patch share a shape so the admin form is one component.
    Required fields are enforced at create-time only (we accept missing
    keys on PATCH via the partial=True flag below)."""
    slug: str = Field(..., min_length=2, max_length=80, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    name: str = Field(..., min_length=2, max_length=120)
    purpose: str | None = Field(None, max_length=400)
    whop_channel_id: str | None = Field(None, max_length=80)
    required_tier: str = Field(
        "paid",
        pattern=r"^(free|free_paid|paid|paid_admin)$",
        description="free / free_paid = open · paid / paid_admin = locked for free users.",
    )
    business_unit: str | None = Field(None, max_length=80)
    mission_lane: str | None = Field(None, max_length=60)
    is_admin_only: bool = False
    is_locked_preview_enabled: bool = True
    section: str = Field(
        "mission",
        pattern=r"^(announcements|free_lobby|paid_core|mission)$",
    )
    sort_order: int = 0


class CommunityChannelPatch(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=120)
    purpose: str | None = Field(None, max_length=400)
    whop_channel_id: str | None = Field(None, max_length=80)
    required_tier: str | None = Field(
        None, pattern=r"^(free|free_paid|paid|paid_admin)$"
    )
    business_unit: str | None = Field(None, max_length=80)
    mission_lane: str | None = Field(None, max_length=60)
    is_admin_only: bool | None = None
    is_locked_preview_enabled: bool | None = None
    section: str | None = Field(
        None, pattern=r"^(announcements|free_lobby|paid_core|mission)$"
    )
    sort_order: int | None = None


def _admin_serialize_channel(c: CommunityChannel) -> dict[str, Any]:
    return {
        "id": c.id,
        "slug": c.slug,
        "name": c.name,
        "purpose": c.purpose,
        "whop_channel_id": c.whop_channel_id,
        "required_tier": c.required_tier,
        "business_unit": c.business_unit,
        "mission_lane": c.mission_lane,
        "is_admin_only": bool(c.is_admin_only),
        "is_locked_preview_enabled": bool(c.is_locked_preview_enabled),
        "section": c.section,
        "sort_order": c.sort_order,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


@router.get("/community/channels")
def list_admin_channels(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    rows = (
        db.query(CommunityChannel)
        .order_by(CommunityChannel.section.asc(), CommunityChannel.sort_order.asc(), CommunityChannel.created_at.asc())
        .all()
    )
    return {"channels": [_admin_serialize_channel(c) for c in rows]}


@router.post("/community/channels", status_code=status.HTTP_201_CREATED)
def create_channel(
    payload: CommunityChannelPayload,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    if db.query(CommunityChannel).filter_by(slug=payload.slug).first():
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"channel slug already exists: {payload.slug}"
        )
    c = CommunityChannel(**payload.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"channel": _admin_serialize_channel(c)}


@router.patch("/community/channels/{slug}")
def update_channel(
    slug: str,
    payload: CommunityChannelPatch,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    c = db.query(CommunityChannel).filter_by(slug=slug).one_or_none()
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"channel not found: {slug}")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    db.commit()
    db.refresh(c)
    return {"channel": _admin_serialize_channel(c)}


@router.delete("/community/channels/{slug}", status_code=status.HTTP_204_NO_CONTENT)
def delete_channel(
    slug: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    c = db.query(CommunityChannel).filter_by(slug=slug).one_or_none()
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"channel not found: {slug}")
    db.delete(c)
    db.commit()


# ── Banners (v0.7.55) ─────────────────────────────────────────────────


class BannerPayload(BaseModel):
    title: str = Field(..., min_length=2, max_length=200)
    subtitle: str | None = Field(None, max_length=400)
    image_url: str | None = Field(None, max_length=600)
    cta_text: str | None = Field(None, max_length=80)
    cta_url: str | None = Field(None, max_length=600)
    placement: str = Field(
        "earn_hero",
        pattern=r"^(earn_hero|mission_card|mission_detail|upgrade_modal|community_top|home_hero|checkout_modal)$",
    )
    target_tier: str | None = Field(None, pattern=r"^(free|paid)$")
    target_mission_id: str | None = Field(None, max_length=120)
    priority: int = Field(0, ge=0, le=1000)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    is_active: bool = True


class BannerPatch(BaseModel):
    title: str | None = Field(None, min_length=2, max_length=200)
    subtitle: str | None = Field(None, max_length=400)
    image_url: str | None = Field(None, max_length=600)
    cta_text: str | None = Field(None, max_length=80)
    cta_url: str | None = Field(None, max_length=600)
    placement: str | None = Field(
        None,
        pattern=r"^(earn_hero|mission_card|mission_detail|upgrade_modal|community_top|home_hero|checkout_modal)$",
    )
    target_tier: str | None = Field(None, pattern=r"^(free|paid)$")
    target_mission_id: str | None = Field(None, max_length=120)
    priority: int | None = Field(None, ge=0, le=1000)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    is_active: bool | None = None


def _admin_serialize_banner(b: Banner) -> dict[str, Any]:
    return {
        "id": b.id,
        "title": b.title,
        "subtitle": b.subtitle,
        "image_url": b.image_url,
        "cta_text": b.cta_text,
        "cta_url": b.cta_url,
        "placement": b.placement,
        "target_tier": b.target_tier,
        "target_mission_id": b.target_mission_id,
        "priority": b.priority,
        "starts_at": b.starts_at.isoformat() if b.starts_at else None,
        "ends_at": b.ends_at.isoformat() if b.ends_at else None,
        "is_active": bool(b.is_active),
        "created_at": b.created_at.isoformat() if b.created_at else None,
        "updated_at": b.updated_at.isoformat() if b.updated_at else None,
    }


@router.get("/banners")
def list_admin_banners(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    rows = (
        db.query(Banner)
        .order_by(Banner.placement.asc(), Banner.priority.desc(), Banner.created_at.desc())
        .all()
    )
    return {"banners": [_admin_serialize_banner(b) for b in rows]}


@router.post("/banners", status_code=status.HTTP_201_CREATED)
def create_banner(
    payload: BannerPayload,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    b = Banner(**payload.model_dump())
    db.add(b)
    db.commit()
    db.refresh(b)
    return {"banner": _admin_serialize_banner(b)}


@router.patch("/banners/{banner_id}")
def update_banner(
    banner_id: str,
    payload: BannerPatch,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    b = db.query(Banner).filter(Banner.id == banner_id).one_or_none()
    if not b:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"banner not found: {banner_id}")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(b, k, v)
    db.commit()
    db.refresh(b)
    return {"banner": _admin_serialize_banner(b)}


@router.delete("/banners/{banner_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_banner(
    banner_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    b = db.query(Banner).filter(Banner.id == banner_id).one_or_none()
    if not b:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"banner not found: {banner_id}")
    db.delete(b)
    db.commit()


# ── Kill switches (2026-08-30 · launch incident-response levers) ────
#
# GET-only visibility. Every registered kill-switch flag + whether
# it's currently disabled via env var. Admin sets/clears the flag
# on Railway (env var + redeploy · takes ~30s) — we deliberately
# don't expose a PATCH here because env-var management belongs to
# the platform, and giving anyone with a stolen admin cookie the
# ability to disable submissions app-wide is a much worse blast
# radius than Railway's own auth. See app/kill_switches.py.


@router.get("/kill-switches")
def kill_switches(admin: AdminUser) -> dict[str, Any]:  # noqa: ARG001 — dep enforces auth
    from app.kill_switches import KILL_SWITCH_FLAGS, kill_switches_snapshot

    snapshot = kill_switches_snapshot()
    return {
        "flags": [
            {
                "name": flag,
                "env_var": f"KILL_{flag.upper()}",
                "killed": snapshot[flag],
            }
            for flag in KILL_SWITCH_FLAGS
        ],
        "any_killed": any(snapshot.values()),
        "how_to_flip": (
            "Set the env var to `1` on Railway (Service settings → Variables) "
            "and redeploy · takes ~30 seconds. Set to empty / delete / `0` to "
            "re-enable. Server restart is required for the change to land."
        ),
    }


# ── Announcements (v0.7.55) ──────────────────────────────────────────


class AnnouncementPayload(BaseModel):
    title: str = Field(..., min_length=2, max_length=200)
    body_markdown: str | None = Field(None, max_length=8000)
    kind: str = Field(
        "other",
        pattern=r"^(mission_drop|payout|rule_change|deadline|other)$",
    )
    cta_text: str | None = Field(None, max_length=80)
    cta_url: str | None = Field(None, max_length=600)
    target_tier: str | None = Field(None, pattern=r"^(free|paid)$")
    pinned: bool = False
    published_at: datetime | None = None
    is_active: bool = True
    # v2.2.9 broadcast layer · global HQ defaults to global+info; HQ can
    # override scope=agency + supply agency_id to target one agency only.
    severity: str = Field("info", pattern=r"^(info|warning|critical)$")
    scope: str = Field("global", pattern=r"^(global|agency)$")
    agency_id: str | None = Field(None, min_length=1, max_length=120)


class AnnouncementPatch(BaseModel):
    title: str | None = Field(None, min_length=2, max_length=200)
    body_markdown: str | None = Field(None, max_length=8000)
    kind: str | None = Field(
        None, pattern=r"^(mission_drop|payout|rule_change|deadline|other)$"
    )
    cta_text: str | None = Field(None, max_length=80)
    cta_url: str | None = Field(None, max_length=600)
    target_tier: str | None = Field(None, pattern=r"^(free|paid)$")
    pinned: bool | None = None
    published_at: datetime | None = None
    is_active: bool | None = None
    severity: str | None = Field(None, pattern=r"^(info|warning|critical)$")
    scope: str | None = Field(None, pattern=r"^(global|agency)$")
    agency_id: str | None = Field(None, min_length=1, max_length=120)


def _admin_serialize_announcement(a: Announcement) -> dict[str, Any]:
    return {
        "id": a.id,
        "title": a.title,
        "body_markdown": a.body_markdown,
        "kind": a.kind,
        "cta_text": a.cta_text,
        "cta_url": a.cta_url,
        "target_tier": a.target_tier,
        "pinned": bool(a.pinned),
        "severity": a.severity,
        "scope": a.scope,
        "agency_id": a.agency_id,
        "published_at": a.published_at.isoformat() if a.published_at else None,
        "is_active": bool(a.is_active),
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }


@router.get("/announcements")
def list_admin_announcements(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    rows = (
        db.query(Announcement)
        .order_by(Announcement.pinned.desc(), Announcement.created_at.desc())
        .all()
    )
    return {"announcements": [_admin_serialize_announcement(a) for a in rows]}


@router.post("/announcements", status_code=status.HTTP_201_CREATED)
def create_announcement(
    payload: AnnouncementPayload,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    a = Announcement(**payload.model_dump())
    db.add(a)
    db.commit()
    db.refresh(a)
    return {"announcement": _admin_serialize_announcement(a)}


@router.patch("/announcements/{announcement_id}")
def update_announcement(
    announcement_id: str,
    payload: AnnouncementPatch,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    a = db.query(Announcement).filter(Announcement.id == announcement_id).one_or_none()
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"announcement not found: {announcement_id}")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(a, k, v)
    db.commit()
    db.refresh(a)
    return {"announcement": _admin_serialize_announcement(a)}


@router.delete("/announcements/{announcement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_announcement(
    announcement_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    a = db.query(Announcement).filter(Announcement.id == announcement_id).one_or_none()
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"announcement not found: {announcement_id}")
    db.delete(a)
    db.commit()


# ======================================================================
# 2026-06-24 · HQ Demo-Data Wipe — live-data endpoints for tabs that used
# to render hardcoded sample arrays. EVERY endpoint here is a thin read
# over the real DB (or an env-flag derived view). For dimensions that
# don't have a backing table yet, the endpoint returns an empty list +
# an honest "note" explaining why. The frontend renders "No X yet" — it
# never falls back to demo data. NO new tables. NO writes.
# ======================================================================


# ── Revenue summary (real, computed from users table) ────────────────

def _day_key(dt: datetime) -> str:
    return dt.date().isoformat()


def _week_start(dt: datetime) -> str:
    """ISO Monday for the week containing dt. Date-only string."""
    d = dt.date()
    monday = d - timedelta(days=d.weekday())
    return monday.isoformat()


def _month_key(dt: datetime) -> str:
    return dt.date().strftime("%Y-%m")


# Pricing baseline — Pro / Growth / Agency monthly cents. Used to estimate
# MRR from the live users table. These are pricing constants, not mock
# data; if Daniel re-prices, update here.
#
# 2026-08-05 — autopilot/agency was 50000 ($500/mo), a stale pre-pivot
# price. oauth-billing.md §7: "Agency ($99.99/mo) is the one
# customer-facing paid plan" as of the 2026-07-06 pivot — same class of
# bug as the $500 Whop checkout plan fixed earlier this session, just a
# second undetected copy. Inflated headline MRR (and every daily/weekly/
# monthly bucket below, which reuse this same table) ~5x for any
# Agency-tier user.
_TIER_PRICE_CENTS = {
    "free": 0,
    "solo": 2999,
    "channel": 9999,    # legacy alias for Growth
    "pro": 9999,        # legacy direct-billing value
    "growth": 9999,
    "autopilot": 9999,  # legacy alias for Agency
    "agency": 9999,
}


def _tier_price_cents(tier: str) -> int:
    return _TIER_PRICE_CENTS.get((tier or "free").lower(), 0)


@router.get("/revenue/summary")
def revenue_summary(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    days: int = 14,
    weeks: int = 6,
    months: int = 6,
) -> dict[str, Any]:
    """Live revenue rollups computed from the real `users` table.

    NOT a payments-system source of truth — Stripe/Whop own that. This is
    Junior's view of "who signed up, who's paid, what tier are they" so
    Admin HQ can show a useful pulse without inventing numbers. All counts
    are derived from User.created_at + User.subscription_status + User.tier.
    """
    days = max(1, min(days, 90))
    weeks = max(1, min(weeks, 26))
    months = max(1, min(months, 24))

    now = _now()
    users = db.query(User).all()

    # MRR + headline counts (live).
    paid_users = [u for u in users if u.subscription_status == "active" and (u.tier or "free") != "free"]
    free_users = [u for u in users if (u.tier or "free") == "free"]
    canceled_users = [u for u in users if u.subscription_status in ("canceled", "expired", "refunded")]
    mrr_cents = sum(_tier_price_cents(u.tier) for u in paid_users)

    # Daily bucket (new signups + new paid + canceled per day, based on
    # User.created_at and User.subscription_status). We do not have a
    # historical events table, so "newPaidToday" approximates as users
    # created in the day window who are currently paid.
    day_buckets: dict[str, dict[str, Any]] = {}
    for i in range(days):
        d = (now - timedelta(days=i)).date().isoformat()
        day_buckets[d] = {
            "date": d,
            "new_signups": 0,
            "new_paid": 0,
            "canceled": 0,
            "gross_cents": 0,
            "note": "",
        }

    for u in users:
        if not u.created_at:
            continue
        key = _day_key(u.created_at)
        if key in day_buckets:
            day_buckets[key]["new_signups"] += 1
            if u.subscription_status == "active" and (u.tier or "free") != "free":
                day_buckets[key]["new_paid"] += 1
                day_buckets[key]["gross_cents"] += _tier_price_cents(u.tier)
        # Canceled approximation — use updated_at if it's recent.
        if u.subscription_status in ("canceled", "refunded", "expired") and u.updated_at:
            ck = _day_key(u.updated_at)
            if ck in day_buckets:
                day_buckets[ck]["canceled"] += 1

    daily = sorted(day_buckets.values(), key=lambda r: r["date"])

    # Weekly bucket — same idea, keyed by ISO week start.
    weekly_buckets: dict[str, dict[str, Any]] = {}
    for i in range(weeks):
        d = (now - timedelta(days=i * 7))
        key = _week_start(d)
        weekly_buckets.setdefault(key, {
            "week_starting": key,
            "new_signups": 0,
            "new_paid": 0,
            "canceled": 0,
            "gross_cents": 0,
        })

    for u in users:
        if not u.created_at:
            continue
        key = _week_start(u.created_at)
        if key in weekly_buckets:
            weekly_buckets[key]["new_signups"] += 1
            if u.subscription_status == "active" and (u.tier or "free") != "free":
                weekly_buckets[key]["new_paid"] += 1
                weekly_buckets[key]["gross_cents"] += _tier_price_cents(u.tier)
        if u.subscription_status in ("canceled", "refunded", "expired") and u.updated_at:
            ck = _week_start(u.updated_at)
            if ck in weekly_buckets:
                weekly_buckets[ck]["canceled"] += 1

    weekly = sorted(weekly_buckets.values(), key=lambda r: r["week_starting"])

    # Monthly bucket.
    month_buckets: dict[str, dict[str, Any]] = {}
    cursor = now
    for _ in range(months):
        key = _month_key(cursor)
        month_buckets.setdefault(key, {
            "month": key,
            "new_signups": 0,
            "new_paid": 0,
            "canceled": 0,
            "gross_cents": 0,
            "mrr_cents": 0,
            "paid_users": 0,
            "free_users": 0,
        })
        # Step back ~one month.
        cursor = cursor - timedelta(days=30)

    for u in users:
        if u.created_at:
            mk = _month_key(u.created_at)
            if mk in month_buckets:
                month_buckets[mk]["new_signups"] += 1
                if u.subscription_status == "active" and (u.tier or "free") != "free":
                    month_buckets[mk]["new_paid"] += 1
                    month_buckets[mk]["gross_cents"] += _tier_price_cents(u.tier)

    # The current month gets the live MRR snapshot; older months stay
    # signups-only since we don't have historical state.
    current_month_key = _month_key(now)
    if current_month_key in month_buckets:
        month_buckets[current_month_key]["mrr_cents"] = mrr_cents
        month_buckets[current_month_key]["paid_users"] = len(paid_users)
        month_buckets[current_month_key]["free_users"] = len(free_users)

    monthly = sorted(month_buckets.values(), key=lambda r: r["month"])

    # Control Tower #8 · 2026-07-09 — AI economics inline in Revenue tab.
    # Reads clip_runs directly · 24h/30d rollups · gross-margin vs Agency.
    from app.models import ClipRun
    ai_since_24h = now - timedelta(hours=24)
    ai_since_30d = now - timedelta(days=30)
    ai_24h_rows = db.query(
        func.coalesce(func.sum(ClipRun.cost_usd_cents), 0),
        func.count(ClipRun.id),
        func.coalesce(func.sum(ClipRun.clips_generated), 0),
    ).filter(ClipRun.created_at >= ai_since_24h).one()
    ai_30d_rows = db.query(
        func.coalesce(func.sum(ClipRun.cost_usd_cents), 0),
        func.count(ClipRun.id),
        func.coalesce(func.sum(ClipRun.clips_generated), 0),
        func.count(ClipRun.id).filter(ClipRun.status == "failed"),
        func.coalesce(
            func.sum(ClipRun.cost_usd_cents).filter(ClipRun.status == "failed"), 0
        ),
    ).filter(ClipRun.created_at >= ai_since_30d).one()

    ai_spend_24h_cents = int(ai_24h_rows[0] or 0)
    runs_24h = int(ai_24h_rows[1] or 0)
    clips_24h = int(ai_24h_rows[2] or 0)

    ai_spend_30d_cents = int(ai_30d_rows[0] or 0)
    runs_30d = int(ai_30d_rows[1] or 0)
    clips_30d = int(ai_30d_rows[2] or 0)
    failed_runs_30d = int(ai_30d_rows[3] or 0)
    failed_spend_30d_cents = int(ai_30d_rows[4] or 0)

    avg_cost_per_run_cents = (
        int(round(ai_spend_30d_cents / runs_30d)) if runs_30d else 0
    )
    avg_cost_per_clip_cents = (
        int(round(ai_spend_30d_cents / clips_30d)) if clips_30d else 0
    )

    # Gross margin against Agency $99.99/mo (launch price). Anchors the
    # 15-year-old scan: green if positive, red if AI spend >= MRR.
    # Reuses _TIER_PRICE_CENTS (single source of truth) rather than a
    # second hardcoded copy — the two had drifted (50000 vs 9999) before
    # the 2026-08-05 fix above.
    agency_price_cents = _tier_price_cents("agency")
    agency_paid_users = [
        u for u in paid_users if (u.tier or "").startswith("agency") or u.tier == "autopilot"
    ]
    agency_users_count = len(agency_paid_users)
    agency_mrr_cents = agency_users_count * agency_price_cents
    # 30-day AI spend belonging to Agency users only (best-effort · we
    # match on cached tier column at run time).
    agency_ai_spend_30d_cents = int(
        db.query(func.coalesce(func.sum(ClipRun.cost_usd_cents), 0))
        .filter(ClipRun.created_at >= ai_since_30d, ClipRun.tier.like("agency%"))
        .scalar() or 0
    )
    agency_gross_margin_cents = agency_mrr_cents - agency_ai_spend_30d_cents

    return {
        "headline": {
            "mrr_cents": mrr_cents,
            "paid_users": len(paid_users),
            "free_users": len(free_users),
            "canceled_users": len(canceled_users),
            "users_total": len(users),
            "target_mrr_cents": 30000_00,
            "gap_to_target_cents": max(0, 30000_00 - mrr_cents),
        },
        # Control Tower #8 · Clip Economics · read by admin/Revenue tab.
        "clip_economics": {
            "ai_spend_24h_cents": ai_spend_24h_cents,
            "runs_24h": runs_24h,
            "clips_24h": clips_24h,
            "ai_spend_30d_cents": ai_spend_30d_cents,
            "runs_30d": runs_30d,
            "clips_30d": clips_30d,
            "failed_runs_30d": failed_runs_30d,
            "failed_spend_30d_cents": failed_spend_30d_cents,
            "avg_cost_per_run_cents": avg_cost_per_run_cents,
            "avg_cost_per_clip_cents": avg_cost_per_clip_cents,
            "agency_users": agency_users_count,
            "agency_mrr_cents": agency_mrr_cents,
            "agency_ai_spend_30d_cents": agency_ai_spend_30d_cents,
            "agency_gross_margin_cents": agency_gross_margin_cents,
        },
        "daily": daily,
        "weekly": weekly,
        "monthly": monthly,
        "generated_at": _iso(datetime.now(timezone.utc)),
        "note": (
            "MRR is computed live from users.tier × baseline price (Solo $29.99, "
            "Pro/Growth/Agency $99.99 — a single paid plan since the 2026-07-06 "
            "pivot; legacy tier names persist in the backend matrix for existing "
            "rows). Historical daily/weekly counts are based on "
            "User.created_at; refund/cancel counts use User.updated_at as an approximation "
            "since per-day revenue events aren't persisted in v0. Stripe/Whop own the ledger. "
            "Clip Economics reads live from clip_runs · 30d rolling window."
        ),
    }


# ── Revenue blockers (real, from desktop error telemetry) ────────────

@router.get("/revenue/blockers")
def revenue_blockers(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    limit: int = 20,
) -> dict[str, Any]:
    """Top error groups from DesktopErrorEvent in the last 24h — what's
    actively breaking customer flows. Not a synthetic 'blocker' list, just
    the real error_code groups ordered by frequency."""
    since = _now() - timedelta(hours=24)
    rows = (
        db.query(DesktopErrorEvent)
        .filter(DesktopErrorEvent.created_at >= since)
        .all()
    )
    by_code: dict[str, dict[str, Any]] = {}
    for e in rows:
        code = e.error_code or e.event or "(unknown)"
        g = by_code.setdefault(code, {
            "code": code,
            "count": 0,
            "affected_users": set(),
            "latest_message": None,
            "latest_at_dt": None,
            "route": e.route,
        })
        g["count"] += 1
        if e.user_ref:
            g["affected_users"].add(e.user_ref)
        if e.created_at and (g["latest_at_dt"] is None or e.created_at > g["latest_at_dt"]):
            g["latest_message"] = e.message
            g["latest_at_dt"] = e.created_at

    blockers = [
        {
            "code": g["code"],
            "count": g["count"],
            "affected_users": len(g["affected_users"]),
            "latest_message": g["latest_message"],
            "latest_at": _iso(g["latest_at_dt"]),
            "route": g["route"],
        }
        for g in by_code.values()
    ]
    blockers.sort(key=lambda b: b["count"], reverse=True)
    return {
        "rows": blockers[:limit],
        "window_hours": 24,
        "generated_at": _iso(datetime.now(timezone.utc)),
        "note": (
            "Top error groups from desktop telemetry in the last 24h. "
            "These are the real things breaking customer flows right now."
        ),
    }


# ── Customer signals (real, from User + DesktopErrorEvent) ───────────

@router.get("/customer-signals")
def customer_signals(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    limit: int = 50,
) -> dict[str, Any]:
    """Recent signups + activity signal per user. Emails masked. Drawn
    from User + Usage + DesktopErrorEvent. No demo data."""
    users = (
        db.query(User)
        .order_by(User.created_at.desc())
        .limit(min(max(limit, 1), 200))
        .all()
    )
    # Pull recent error refs once, group by user_ref so we can attach.
    since = _now() - timedelta(days=14)
    err_rows = (
        db.query(DesktopErrorEvent)
        .filter(DesktopErrorEvent.created_at >= since)
        .all()
    )
    err_by_user: dict[str, dict[str, Any]] = {}
    for e in err_rows:
        if not e.user_ref:
            continue
        slot = err_by_user.setdefault(e.user_ref, {"count": 0, "latest_dt": None})
        slot["count"] += 1
        if e.created_at and (slot["latest_dt"] is None or e.created_at > slot["latest_dt"]):
            slot["latest_dt"] = e.created_at

    rows: list[dict[str, Any]] = []
    for u in users:
        # user_ref convention in telemetry.py: backend user id. Best effort.
        e = err_by_user.get(u.id, {"count": 0, "latest_dt": None})
        is_paid = u.subscription_status == "active" and (u.tier or "free") != "free"
        rows.append({
            "id": u.id,
            "email_masked": _mask_email(u.email),
            "tier": u.tier,
            "subscription_status": u.subscription_status,
            "billing_provider": "whop" if u.whop_user_id else "clerk",
            "created_at": _iso(u.created_at),
            "active_at": _iso(u.active_at),
            "clips_created": u.clips_created or 0,
            "starter_exports_used": u.starter_exports_used or 0,
            "is_paid": is_paid,
            "recent_error_count": e["count"],
            "recent_error_at": _iso(e["latest_dt"]),
            "first_clip_created": (u.clips_created or 0) > 0,
        })
    return {
        "rows": rows,
        "generated_at": _iso(datetime.now(timezone.utc)),
        "note": (
            "Most-recent signups with live activity + error counts in the last 14 days. "
            "Real users only; emails masked in this list."
        ),
    }


# ── Inbox (empty in v0 — no inbox_messages table) ────────────────────

@router.get("/inbox")
def inbox_messages(admin: AdminUser) -> dict[str, Any]:
    """Inbound user-to-HQ support board. No table yet — returns empty
    list + the migration path. Frontend renders an honest empty state."""
    return {
        "rows": [],
        "note": (
            "No inbox_messages table in v0. Once /webhooks/support or a "
            "contact form posts to a new table, this endpoint will list "
            "real customer messages. Until then there is no inbox to show."
        ),
    }


# ── Employees (live, derived from admin allowlist + this user) ───────

@router.get("/employees")
def employees(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Live employees view drawn from the admin allowlist + each user row.
    Returns one row per admin email that actually exists in the User
    table. No people directory table in v0 — costs/hours are unknown
    and intentionally left as null instead of being invented."""
    from app.features import ADMIN_EMAILS

    allow = ADMIN_EMAILS  # frozenset[str] of lowercase emails
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for email in sorted(allow):
        u = db.query(User).filter_by(email=email).one_or_none()
        seen.add(email)
        if u is None:
            rows.append({
                "id": f"allow:{email}",
                "name": email.split("@")[0],
                "email": email,
                "role": "Admin",
                "status": "invited",
                "created_at": None,
                "last_active": None,
                "tier": "—",
                "founder": False,
                "monthly_cost_cents": None,
                "hourly_rate_cents": None,
                "can_access_hq": True,
                "emergency_contact": email == "danieldiyepriye@gmail.com",
                "notes": "On admin allowlist but no User row yet.",
            })
            continue
        rows.append({
            "id": u.id,
            "name": email.split("@")[0],
            "email": email,
            "role": "Admin",
            "status": "active" if u.subscription_status == "active" else u.subscription_status,
            "created_at": _iso(u.created_at),
            "last_active": _iso(u.active_at),
            "tier": u.tier,
            "founder": bool(u.founder_flag),
            "monthly_cost_cents": None,
            "hourly_rate_cents": None,
            "can_access_hq": True,
            "emergency_contact": email == "danieldiyepriye@gmail.com",
            "notes": "From admin allowlist.",
        })
    return {
        "rows": rows,
        "generated_at": _iso(datetime.now(timezone.utc)),
        "note": (
            "Employees = JUNIOR_ADMIN_EMAILS allowlist joined to live User "
            "rows. No people-directory table in v0 — costs/hours are not "
            "stored, so they show null. Add an `employees` table to track "
            "monthly cost / rate / role."
        ),
    }


# ── Agents (live env-flag derived) ───────────────────────────────────

@router.get("/agents")
def agents_status(admin: AdminUser) -> dict[str, Any]:
    """Live agent fleet status derived from env-flag presence. Returns
    one entry per agent lane the env exposes. Never returns demo costs."""
    s = get_settings()

    def env(name: str) -> str | None:
        return os.environ.get(name) or None

    raw = [
        ("auth", "Auth Agent", "Kimi", "Auth / Account / Upgrade", env("KIMI_AUTH_AGENT_API_KEY")),
        ("projects", "Projects Agent", "Kimi", "Projects Manager", env("KIMI_PROJECTS_AGENT_API_KEY")),
        ("earn", "Earn Agent", "Kimi", "Earn Workflow", env("KIMI_EARN_AGENT_API_KEY")),
        ("ui", "UI Agent", "Kimi", "UI Polish", env("KIMI_UI_AGENT_API_KEY")),
        ("codex", "Codex Agent", "OpenAI", "Upgrade + Self-Onboarding", env("OPENAI_CODEX_AGENT_API_KEY")),
        ("claude", "Claude Agent", "Claude", "Backend / Release", env("CLAUDE_AGENT_API_KEY")),
        ("hq_internal", "HQ Internal", "Internal", "Operator tooling", env("HQ_INTERNAL_SECRET")),
    ]
    rows = [
        {
            "id": f"agent:{key}",
            "key": key,
            "name": name,
            "provider": provider,
            "lane": lane,
            "configured": bool(value),
            "status": "active" if value else "missing key",
            "monthly_budget_cents": None,
            "spent_this_month_cents": None,
            "note": "Cost telemetry not wired in v0.",
        }
        for key, name, provider, lane, value in raw
    ]
    _ = s  # touch settings dependency so import stays warm
    return {
        "rows": rows,
        "generated_at": _iso(datetime.now(timezone.utc)),
        "note": (
            "Agent fleet derived from env-flag presence. Cost/spend not "
            "tracked in v0 — those columns show null. Wire a per-agent "
            "billing event table to populate."
        ),
    }


# ── API services (live env-flag derived) ─────────────────────────────

@router.get("/api-services")
def api_services_status(admin: AdminUser) -> dict[str, Any]:
    """Live API/service dependency map. Configured flag is real (env var
    presence); cost/spend are null because Junior doesn't store billing
    events for third-party APIs in v0."""
    def env(*names: str) -> bool:
        return any(bool(os.environ.get(n)) for n in names)

    services = [
        ("openai", "OpenAI", "AI", "OPENAI_API_KEY", env("OPENAI_API_KEY")),
        ("kimi", "Kimi", "AI", "KIMI_API_KEY", env("KIMI_API_KEY", "KIMI_AUTH_AGENT_API_KEY")),
        ("claude", "Claude", "AI", "CLAUDE_API_KEY", env("CLAUDE_API_KEY", "CLAUDE_AGENT_API_KEY")),
        ("whop", "Whop", "payments", "WHOP_API_KEY", env("WHOP_API_KEY")),
        ("clerk", "Clerk", "auth", "CLERK_SECRET_KEY", env("CLERK_SECRET_KEY")),
        ("stripe", "Stripe", "payments", "STRIPE_SECRET_KEY", env("STRIPE_SECRET_KEY")),
        ("railway", "Railway", "infra", "RAILWAY_TOKEN", env("RAILWAY_TOKEN")),
        ("vercel", "Vercel", "hosting", "VERCEL_TOKEN", env("VERCEL_TOKEN")),
        ("supabase", "Supabase", "storage", "SUPABASE_SERVICE_ROLE_KEY", env("SUPABASE_SERVICE_ROLE_KEY")),
        ("resend", "Resend", "email", "RESEND_API_KEY", env("RESEND_API_KEY")),
        ("ayrshare", "Ayrshare", "social", "AYRSHARE_API_KEY", env("AYRSHARE_API_KEY")),
        ("postiz", "Postiz", "social", "POSTIZ_API_KEY", env("POSTIZ_API_KEY")),
        ("storage", "S3 / R2 Storage", "storage", "AWS_ACCESS_KEY_ID / R2_ACCESS_KEY_ID",
            env("AWS_ACCESS_KEY_ID", "S3_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID")),
        ("sentry", "Sentry", "analytics", "SENTRY_AUTH_TOKEN", env("SENTRY_AUTH_TOKEN")),
        ("posthog", "PostHog", "analytics", "POSTHOG_KEY", env("POSTHOG_KEY")),
    ]
    rows = [
        {
            "id": f"svc:{key}",
            "key": key,
            "name": name,
            "category": category,
            "env_var": env_var,
            "configured": configured,
            "monthly_cost_cents": None,
            "current_month_spend_cents": None,
            "note": "Cost telemetry not wired in v0.",
        }
        for key, name, category, env_var, configured in services
    ]
    return {
        "rows": rows,
        "generated_at": _iso(datetime.now(timezone.utc)),
        "note": (
            "Service registry by env-flag presence. Costs aren't tracked "
            "in v0 (we don't pull provider invoices yet)."
        ),
    }


# ── Iron Gates / Releases / Bug intake / Agent reports — no-table v0 ──

@router.get("/iron-gates")
def iron_gates(admin: AdminUser) -> dict[str, Any]:
    """Iron-gate tracker. No backing table in v0 — agents record their
    iron-gate state in markdown files in the repo, not the DB. Returns
    an empty list so the UI can render an honest empty state."""
    return {
        "rows": [],
        "note": (
            "No iron_gate_runs table in v0. Iron-gate state lives in "
            "docs/IRON_GATES.md and the per-agent reports. Wire a real "
            "table to surface here."
        ),
    }


@router.get("/releases")
def releases(admin: AdminUser) -> dict[str, Any]:
    """Recent release records. No release_history table in v0 — the
    desktop updater manifest holds the latest version only. Returns
    an empty list."""
    return {
        "rows": [],
        "note": (
            "No release_history table in v0. The Tauri updater manifest "
            "holds only the latest signed release; per-build hand-walk "
            "metadata isn't persisted. Wire a release-history table to "
            "show real rows here."
        ),
    }


@router.get("/bug-intake")
def bug_intake(admin: AdminUser) -> dict[str, Any]:
    """User-reported bug intake. No bug_intake table in v0 — the
    DesktopErrorEvent table (already surfaced under /admin/bugs) covers
    auto-captured errors. Returns empty + the migration path."""
    return {
        "rows": [],
        "note": (
            "No bug_intake table in v0. DesktopErrorEvent (/admin/bugs) "
            "covers auto-captured desktop errors. A separate intake table "
            "would track user-reported bugs with lane assignment + status."
        ),
    }


@router.get("/agent-reports")
def agent_reports(admin: AdminUser) -> dict[str, Any]:
    """Per-lane agent report stream. No agent_reports table in v0."""
    return {
        "rows": [],
        "note": (
            "No agent_reports table in v0. Agents log to local files; "
            "wire a real ingest endpoint to populate this stream."
        ),
    }


# ======================================================================
# v2.2.9 · Agency-scoped Announcement controllers
# ----------------------------------------------------------------------
# /admin/* routes above use the (clerk_user_id + x-internal-secret)
# console gate via `require_admin`. Agencies don't have the internal
# secret — they call from the desktop with a Bearer JWT. This sub-router
# uses `current_user` (JWT) + a tier check so an Agency-tier user can
# broadcast / terminate announcements scoped to their own agency_id.
# Mounted in main.py via app.include_router(admin.agency_router).
# ======================================================================

from app.deps import current_user as _agency_current_user  # noqa: E402


def require_agency_user(
    user: Annotated[User, Depends(_agency_current_user)],
) -> User:
    """Permit Agency-tier users (or admin / founder override) to manage
    their own agency broadcasts. Tier aliases per features.py: 'agency'
    is the v2 name; 'autopilot' is the legacy alias still on a few rows."""
    if is_admin_email(user.email):
        return user
    if user.founder_flag:
        return user
    # 2026-07-02 · added agency_solo + agency_whitelabel for 3-tier ladder.
    if user.tier in {"agency", "autopilot", "agency_solo", "agency_whitelabel"}:
        return user
    raise HTTPException(
        status.HTTP_403_FORBIDDEN,
        "agency profile required",
    )


AgencyUser = Annotated[User, Depends(require_agency_user)]


class AgencyAnnouncementPayload(BaseModel):
    title: str = Field(..., min_length=2, max_length=200)
    body_markdown: str | None = Field(None, max_length=8000)
    severity: str = Field("info", pattern=r"^(info|warning|critical)$")
    # Required on agency POSTs · admins may target any agency_id; non-admin
    # agency callers may only post for their own user.id (enforced below).
    agency_id: str = Field(..., min_length=1, max_length=120)
    cta_text: str | None = Field(None, max_length=80)
    cta_url: str | None = Field(None, max_length=600)
    pinned: bool = False


agency_router = APIRouter(prefix="/agency", tags=["agency"])


@agency_router.post(
    "/announcements",
    status_code=status.HTTP_201_CREATED,
)
def create_agency_announcement(
    payload: AgencyAnnouncementPayload,
    user: AgencyUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Issue an agency-scoped broadcast. Non-admin agency callers can
    only set agency_id == their own user.id; admin override permits any
    target so HQ can post on an agency's behalf during incident response."""
    if not is_admin_email(user.email) and payload.agency_id != user.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "agency_id must match caller user.id",
        )
    a = Announcement(
        title=payload.title,
        body_markdown=payload.body_markdown,
        severity=payload.severity,
        scope="agency",
        agency_id=payload.agency_id,
        cta_text=payload.cta_text,
        cta_url=payload.cta_url,
        pinned=payload.pinned,
        is_active=True,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return {"announcement": _admin_serialize_announcement(a)}


@agency_router.delete(
    "/announcements/{announcement_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def terminate_agency_announcement(
    announcement_id: str,
    user: AgencyUser,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    """Soft-terminate (is_active=False) an agency-scoped broadcast. Hard
    delete is reserved for /admin/announcements/{id}; agencies only flip
    the active flag so HQ retains the audit trail."""
    a = (
        db.query(Announcement)
        .filter(Announcement.id == announcement_id)
        .one_or_none()
    )
    if not a:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"announcement not found: {announcement_id}",
        )
    if a.scope != "agency":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "global announcements terminate via /admin route",
        )
    if not is_admin_email(user.email) and a.agency_id != user.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "agency_id mismatch",
        )
    a.is_active = False
    db.commit()


# ── Login-screen carousel clips (2026-07-06) ─────────────────────────
#
# CRUD surface for the login-screen carousel clip roster
# (login_carousel_clips table). Companion write path to the public
# GET /hq/carousel/clips reader in routes/carousel.py. HQ curates rows
# here; the desktop LoginScreen renders bundled fallbacks when empty.
#
# The table has a varchar PK (no ORM model — created by the idempotent
# CREATE TABLE block in app/main.py::_COLUMN_MIGRATIONS). We hand-roll
# raw SQL to stay consistent with routes/carousel.py + routes/cold_leads.py.


_CAROUSEL_PLATFORM_PATTERN = r"^(TikTok|YT Shorts|Reels)$"


class CarouselClipPayload(BaseModel):
    url: str = Field(..., min_length=5, max_length=600)
    handle: str = Field(..., min_length=1, max_length=80)
    earnings_cents: int = Field(0, ge=0)
    platform: str = Field(..., pattern=_CAROUSEL_PLATFORM_PATTERN)
    campaign_id: str | None = Field(None, max_length=80)
    priority: int = Field(0, ge=0, le=1000)
    active: bool = True


def _serialize_carousel_clip(row: Any) -> dict[str, Any]:
    m = row._mapping
    return {
        "id": m["id"],
        "url": m["url"],
        "handle": m["handle"],
        "earnings_cents": int(m["earnings_cents"] or 0),
        "platform": m["platform"],
        "campaign_id": m["campaign_id"],
        "priority": int(m["priority"] or 0),
        "active": bool(m["active"]),
        "created_at": m["created_at"].isoformat() if m["created_at"] else None,
        "updated_at": m["updated_at"].isoformat() if m["updated_at"] else None,
    }


@router.get("/carousel-clips")
def list_carousel_clips_admin(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """HQ curation view · all rows (active + paused), newest first."""
    try:
        rows = db.execute(
            _sql_text(
                """
                SELECT id, url, handle, earnings_cents, platform, campaign_id,
                       priority, active, created_at, updated_at
                FROM login_carousel_clips
                ORDER BY created_at DESC
                """
            )
        ).fetchall()
    except Exception:
        rows = []
    return {
        "rows": [_serialize_carousel_clip(r) for r in rows],
        "generated_at": _now().isoformat() if hasattr(_now(), "isoformat") else None,
        "note": (
            "Empty list is a valid state — LoginScreen renders bundled "
            "/public/demos/*.mp4 fallbacks when no rows exist."
        ),
    }


@router.post("/carousel-clips", status_code=status.HTTP_201_CREATED)
def create_carousel_clip(
    payload: CarouselClipPayload,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Insert a new curated clip. `id` is generated server-side (uuid hex).

    Field validation:
      * `url` must end with `.mp4` (client hint — enforced at UI layer too).
      * `handle` free-text, 1-80 chars.
      * `earnings_cents` integer ≥ 0.
      * `platform` locked to TikTok | YT Shorts | Reels.
    """
    clip_id = uuid.uuid4().hex
    if not payload.url.lower().split("?", 1)[0].endswith(".mp4"):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "url must be an MP4 (path ends with .mp4)",
        )
    try:
        db.execute(
            _sql_text(
                """
                INSERT INTO login_carousel_clips
                    (id, url, handle, earnings_cents, platform, campaign_id,
                     priority, active, created_at, updated_at)
                VALUES
                    (:id, :url, :handle, :earnings, :platform, :campaign,
                     :priority, :active, now(), now())
                """
            ),
            {
                "id": clip_id,
                "url": payload.url.strip(),
                "handle": payload.handle.strip(),
                "earnings": payload.earnings_cents,
                "platform": payload.platform,
                "campaign": payload.campaign_id,
                "priority": payload.priority,
                "active": payload.active,
            },
        )
        db.commit()
        row = db.execute(
            _sql_text(
                """
                SELECT id, url, handle, earnings_cents, platform, campaign_id,
                       priority, active, created_at, updated_at
                FROM login_carousel_clips
                WHERE id = :id
                """
            ),
            {"id": clip_id},
        ).one()
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"carousel-clip insert failed: {exc.__class__.__name__}",
        ) from exc
    return {"clip": _serialize_carousel_clip(row)}


@router.delete("/carousel-clips/{clip_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_carousel_clip(
    clip_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    """Hard-delete a curated clip row by primary key."""
    try:
        result = db.execute(
            _sql_text("DELETE FROM login_carousel_clips WHERE id = :id"),
            {"id": clip_id},
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"carousel-clip delete failed: {exc.__class__.__name__}",
        ) from exc
    if result.rowcount == 0:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"carousel clip not found: {clip_id}",
        )


# ── Cold-leads (2026-07-06) ──────────────────────────────────────────
#
# HQ inspection + delete surface for the cold_leads table.
# Companion to POST /cold-leads/prep (writer) in routes/cold_leads.py.
#
# The cold_leads PK is composite (email, campaign_id) — no serial id —
# so the row identity for delete is (email, campaign_id) tuple in the
# URL. Base64/URL-encoded so slashes-in-campaign-id can't split the path.


class ColdLeadCreatePayload(BaseModel):
    email: EmailStr
    handle: str = Field(..., min_length=1, max_length=80)
    campaign_id: str = Field(..., min_length=1, max_length=80)
    preview_clip_url: str | None = Field(None, max_length=600)
    platform: str | None = Field(None, max_length=40)


def _serialize_cold_lead(row: Any) -> dict[str, Any]:
    m = row._mapping
    return {
        "email": m["email"],
        "handle": m["handle"],
        "campaign_id": m["campaign_id"],
        "preview_clip_url": m["preview_clip_url"],
        "platform": m["platform"],
        "first_seen_at": m["first_seen_at"].isoformat() if m["first_seen_at"] else None,
        "last_seen_at": m["last_seen_at"].isoformat() if m["last_seen_at"] else None,
    }


@router.get("/cold-leads")
def list_cold_leads(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    campaign_id: Annotated[str | None, Query(max_length=80)] = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 500,
) -> dict[str, Any]:
    """HQ list of staged cold leads. Optional campaign filter."""
    try:
        if campaign_id:
            rows = db.execute(
                _sql_text(
                    """
                    SELECT email, handle, campaign_id, preview_clip_url, platform,
                           first_seen_at, last_seen_at
                    FROM cold_leads
                    WHERE campaign_id = :campaign
                    ORDER BY last_seen_at DESC
                    LIMIT :lim
                    """
                ),
                {"campaign": campaign_id, "lim": limit},
            ).fetchall()
        else:
            rows = db.execute(
                _sql_text(
                    """
                    SELECT email, handle, campaign_id, preview_clip_url, platform,
                           first_seen_at, last_seen_at
                    FROM cold_leads
                    ORDER BY last_seen_at DESC
                    LIMIT :lim
                    """
                ),
                {"lim": limit},
            ).fetchall()
    except Exception:
        rows = []

    # Distinct campaign list for the filter dropdown.
    try:
        campaign_rows = db.execute(
            _sql_text(
                "SELECT DISTINCT campaign_id FROM cold_leads ORDER BY campaign_id ASC"
            )
        ).fetchall()
        campaigns = [r._mapping["campaign_id"] for r in campaign_rows if r._mapping["campaign_id"]]
    except Exception:
        campaigns = []

    try:
        total = db.execute(_sql_text("SELECT COUNT(*) AS c FROM cold_leads")).scalar()
    except Exception:
        total = 0

    return {
        "rows": [_serialize_cold_lead(r) for r in rows],
        "campaigns": campaigns,
        "total": int(total or 0),
        "note": "Empty list is a valid state — cold_leads is HQ-populated.",
    }


@router.post("/cold-leads", status_code=status.HTTP_201_CREATED)
def create_cold_lead(
    payload: ColdLeadCreatePayload,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Admin-side upsert (mirrors POST /cold-leads/prep exactly). Powers
    the CSV upload widget in the HQ ColdLeadsTab so CSV rows can be
    staged without going through the Instantly webhook rail."""
    try:
        db.execute(
            _sql_text(
                """
                INSERT INTO cold_leads
                    (email, handle, campaign_id, preview_clip_url, platform,
                     first_seen_at, last_seen_at)
                VALUES
                    (:email, :handle, :campaign, :preview, :platform, now(), now())
                ON CONFLICT (email, campaign_id) DO UPDATE SET
                    handle = EXCLUDED.handle,
                    preview_clip_url = COALESCE(EXCLUDED.preview_clip_url, cold_leads.preview_clip_url),
                    platform = COALESCE(EXCLUDED.platform, cold_leads.platform),
                    last_seen_at = now()
                """
            ),
            {
                "email": payload.email.lower().strip(),
                "handle": payload.handle.strip(),
                "campaign": payload.campaign_id.strip(),
                "preview": payload.preview_clip_url,
                "platform": payload.platform,
            },
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"cold-lead upsert failed: {exc.__class__.__name__}",
        ) from exc
    return {"ok": True}


@router.delete("/cold-leads", status_code=status.HTTP_204_NO_CONTENT)
def delete_cold_lead(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    email: Annotated[str, Query(min_length=3, max_length=200)] = ...,
    campaign_id: Annotated[str, Query(min_length=1, max_length=80)] = ...,
) -> None:
    """Delete a single cold_lead row by (email, campaign_id).

    Using query params so campaign ids that contain slashes don't
    ambiguate the URL path.
    """
    try:
        result = db.execute(
            _sql_text(
                """
                DELETE FROM cold_leads
                WHERE email = :email AND campaign_id = :campaign
                """
            ),
            {"email": email.lower().strip(), "campaign": campaign_id.strip()},
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"cold-lead delete failed: {exc.__class__.__name__}",
        ) from exc
    if result.rowcount == 0:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"cold lead not found: {email} · {campaign_id}",
        )


# ── AI Terminal audit-log write ─────────────────────────────────────────────
#
# AdminHQ audit (2026-08-26) · account-app/src/app/api/admin/ai/run/route.ts
# and .../ai/audit/route.ts have POSTed to `{BACKEND_URL}/admin/audit-log`
# since the AI Terminal shipped, but this route never existed on the
# backend — only `GET /admin/mutations/audit-log` (a different path AND a
# different method) did. Every audit write 404'd and was silently
# swallowed by the proxy's try/catch, so no AI Terminal action was ever
# actually being recorded. This is the missing write side, reusing the
# same `AdminAuditLog` table and `_write_audit` helper every other
# mutation endpoint already writes through (deferred import to avoid a
# circular import — admin_mutations.py imports AdminUser from this file).


class AuditLogWriteIn(BaseModel):
    actor_email: EmailStr
    action: str = Field(..., min_length=1, max_length=120)
    target_type: str = Field(..., min_length=1, max_length=40)
    target_id: str = Field(..., min_length=1, max_length=200)
    payload_json: dict[str, Any] = Field(default_factory=dict)
    result: Literal["ok", "error"] = "ok"


class AuditLogWriteOut(BaseModel):
    # `_write_audit` is best-effort by contract (never raises — a logging
    # blip can't take down the caller). Both fields stay unset on that
    # fallback path, since the row was never actually flushed to the DB.
    id: int | None
    created_at: datetime | None


@router.post("/audit-log", response_model=AuditLogWriteOut)
def write_audit_log(
    body: AuditLogWriteIn,
    _admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> AuditLogWriteOut:
    from app.routes.admin_mutations import _write_audit

    row = _write_audit(
        db,
        actor_email=body.actor_email,
        action=body.action,
        target_type=body.target_type,
        target_id=body.target_id,
        payload=body.payload_json,
        result=body.result,
    )
    return AuditLogWriteOut(id=row.id, created_at=row.created_at)
