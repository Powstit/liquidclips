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
        (empty secret = local dev → allowed, same as /affiliate/me), AND
    (b) resolves the ?clerk_user_id (or body field) to a User and checks
        app.features.is_admin_email(user.email) — else 403.
  The account-app admin page ALSO gates in its server component, but this
  backend gate is the real enforcement (frontend gating is not enough).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import engine, get_db
from app.features import is_admin_email
from app.models import (
    License,
    Notification,
    PendingWhopMembership,
    PostizConnection,
    Schedule,
    User,
    WebhookEvent,
    WhopClaimToken,
)
from app.routes.usage import STARTER_EXPORT_CAP, starter_export_remaining

router = APIRouter(prefix="/admin", tags=["admin"])


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
    x_internal_secret: Annotated[str | None, Header()] = None,
) -> User:
    """Server-side admin gate for EVERY /admin/* endpoint.

    (a) internal secret check (mirrors /affiliate/me _require_internal), then
    (b) resolve clerk_user_id → User and require is_admin_email(user.email).
    Returns the admin User so handlers can log/attribute if needed."""
    secret = get_settings().internal_api_secret
    if secret and x_internal_secret != secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad internal secret")

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
    return {
        "backend_user_id": user.id,
        "clerk_id": user.clerk_id,
        "email": user.email,  # full email — single-user detail only
        "whop_user_id": user.whop_user_id,
        "affiliate_id": user.affiliate_id,
        "raw_tier": user.tier,
        "raw_founder": user.founder_flag,
        "effective_tier": eff_tier,
        "effective_founder": eff_founder,
        "admin_override": is_admin,
        "subscription_status": user.subscription_status,
        "billing_provider": "whop" if user.whop_user_id else "clerk",
        "trial_started_at": _iso(user.trial_started_at),
        "paid_until": _iso(user.paid_until),
        "starter_exports_used": user.starter_exports_used or 0,
        "starter_export_cap": STARTER_EXPORT_CAP,
        "remaining_exports": None if is_admin else starter_export_remaining(user),
        "created_at": _iso(user.created_at),
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
    }


def _user_list_row(user: User) -> dict[str, Any]:
    """Masked list row for search results — full email withheld."""
    return {
        "backend_user_id": user.id,
        "clerk_id": user.clerk_id,
        "email_masked": _mask_email(user.email),
        "whop_user_id": user.whop_user_id,
        "affiliate_id": user.affiliate_id,
        "tier": user.tier,
        "founder": user.founder_flag,
        "subscription_status": user.subscription_status,
        "billing_provider": "whop" if user.whop_user_id else "clerk",
        "created_at": _iso(user.created_at),
    }


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
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Tier/status buckets. "paid" = active & non-free; "trialing" = trial/ing;
    # everything else (free, expired, canceled-past-period) → free bucket.
    users = db.query(User).all()
    paid = sum(1 for u in users if u.subscription_status == "active" and u.tier != "free")
    trialing = sum(1 for u in users if u.subscription_status in ("trial", "trialing"))
    free = len(users) - paid - trialing

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
    }

    return {
        "config": config,
        "counts": counts,
        "notes": {
            "http_4xx_5xx_last_hour": "not available — request error rates are not persisted in v0",
            "webhook_failures_24h": "not available — WebhookEvent stores only idempotency metadata (no status/error) in v0",
        },
        "generated_at": _iso(datetime.now(timezone.utc)),
    }


# ======================================================================
# 2. User search + detail
# ======================================================================

@router.get("/users")
def search_users(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    query: Annotated[str, Query(min_length=1)],
    limit: int = 50,
) -> dict[str, Any]:
    """Search by email / clerk id / whop user id / backend id / affiliate id.
    Substring match on email; exact-ish elsewhere. Returns masked list rows."""
    q = query.strip()
    like = f"%{q.lower()}%"
    rows = (
        db.query(User)
        .filter(
            or_(
                User.email.ilike(like),
                User.clerk_id == q,
                User.whop_user_id == q,
                User.id == q,
                User.affiliate_id == q,
            )
        )
        .order_by(User.created_at.desc())
        .limit(min(limit, 200))
        .all()
    )
    return {"query": q, "count": len(rows), "results": [_user_list_row(u) for u in rows]}


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


@router.get("/users/{user_id}/timeline")
def user_timeline(
    user_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Best-effort chronological view built ONLY from timestamps that already
    exist in the DB. There is no event store in v0 — this is NOT a full audit
    log. Each row carries `source` so the UI can label what is / isn't backed
    by real data. Events the spec lists but we don't persist (affiliate click,
    checkout view, desktop activation, individual clip exports) are reported in
    `unavailable` rather than invented."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")

    events: list[dict[str, Any]] = []

    def add(ts: datetime | None, kind: str, label: str, source: str) -> None:
        if ts is None:
            return
        events.append({"at": _iso(ts), "kind": kind, "label": label, "source": source})

    add(user.created_at, "signup", "Junior account created", "users.created_at")
    add(user.trial_started_at, "trial_started", "Trial started", "users.trial_started_at")

    # Licenses (desktop license JWT mints).
    for lic in db.query(License).filter(License.user_id == user.id).all():
        add(lic.issued_at, "license_issued", f"License issued ({lic.tier_at_issue})", "licenses.issued_at")
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

    # WebhookEvent has no user/pending FK in v0 — can't link rows to this user
    # without storing PII, so we surface that gap rather than guessing.

    events.sort(key=lambda e: e["at"] or "", reverse=True)

    return {
        "user_id": user.id,
        "email_masked": _mask_email(user.email),
        "events": events,
        "unavailable": [
            "affiliate_link_clicked (not stored in DB; lives in PostHog)",
            "checkout_viewed / completed (PostHog only)",
            "desktop_activated (no activation timestamp persisted in v0)",
            "individual clip_exported events (only the running counter is stored)",
            "webhook rows for this user (WebhookEvent has no user/pending link in v0)",
            "subscription/payment transitions (Whop/Clerk own the ledger; not mirrored as events)",
        ],
        "note": "Timeline is built from existing DB timestamps only. No event store was added in v0.",
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
    limit: int = 100,
) -> dict[str, Any]:
    """Recent rows from the EXISTING WebhookEvent table. In v0 this table is an
    idempotency log only — it stores provider / event_type / received_at, NOT
    handled-status or error. We surface that limitation instead of faking it."""
    rows = (
        db.query(WebhookEvent)
        .order_by(WebhookEvent.received_at.desc())
        .limit(min(limit, 500))
        .all()
    )
    out = [
        {
            "id": w.id,
            "provider": w.provider,
            "event_type": w.event_type,
            "received_at": _iso(w.received_at),
        }
        for w in rows
    ]
    return {
        "count": len(out),
        "rows": out,
        "note": (
            "WebhookEvent is an idempotency log in v0 — handled status, error, and "
            "linked user/pending are NOT persisted. Delivery/processing detail lives "
            "in Railway logs + the Clerk/Whop dashboards."
        ),
    }


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
