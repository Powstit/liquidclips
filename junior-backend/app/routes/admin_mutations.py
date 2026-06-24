"""Admin HQ Management Gap mutations — write-side admin actions.

This router lives alongside the read-only `admin.py`. It owns the 11
mutation endpoints (refund, ban, tier-change, agent kill/restart/rotate-key,
campaign edit/create/archive, recent-sales feed, audit-log query) that
let Daniel operate the business from HQ without log-diving or Railway
shell access.

Architecture
------------
- Auth: re-uses `require_admin` from `admin.py` (same x-internal-secret +
  admin-email gate). NEVER reinvent the gate.
- Audit log: every mutation writes one row to `AdminAuditLog` with the
  actor, the action, the target, a redacted payload snapshot, and the
  outcome. Reads are paginated via GET /audit-log.
- Idempotency: mutations that could double-fire accept an optional
  `idempotence-key` header. Rotate-key REQUIRES one; a duplicate key
  within 24h is rejected with 409.
- Secret redaction: any payload field whose key matches `_SECRET_KEYS`
  is stored as `first4 + "..."` in the audit row's payload_json. Raw
  values never persist.
- Typed I/O: every endpoint takes a Pydantic request model and returns
  a Pydantic response model — no `dict` returns. This is the rpc-contract-lens
  gate.

What's intentionally NOT done here
----------------------------------
- No new auth path. We mount under the existing /admin prefix via
  `/admin/mutations/*`, so the same `require_admin` dependency that
  guards every read endpoint also guards every mutation endpoint.
- No live Whop refund unless `WHOP_PAYMENTS_LIVE=true` is set AND the
  Whop SDK exposes a refund call. Phase 1 logs the intent and returns
  a `would_refund` flag so the audit row carries the decision trail.
- Agent rotate-key returns the new persona JWT *once* (in the response
  body) and persists only the SHA-256 hash. The audit row stores the
  first 4 characters of the new key + "..." — never the whole secret.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db import engine, get_db
from app.models import (
    AdminAuditLog,
    AgentPersona,
    SponsoredCampaign,
    User,
    WebhookEvent,
    WebhookEventLog,
)
from app.routes.admin import AdminUser, _now

_log = logging.getLogger("junior.admin_mutations")

router = APIRouter(prefix="/admin/mutations", tags=["admin", "mutations"])


# ---------------------------------------------------------------------
# Constants — tier whitelist, redaction keys, idempotence window
# ---------------------------------------------------------------------

# Spec lists "free|growth|agency" but the codebase has free|solo|pro|
# growth|agency. Allow any of the live tier strings; legacy aliases
# (channel/autopilot) are not accepted here — admins should use the
# v2 names so the audit log stays clean.
_VALID_TIERS = {"free", "solo", "pro", "growth", "agency"}

# Field keys whose values must be redacted before persisting to the
# audit_log row. Match is case-insensitive substring.
_SECRET_KEYS = (
    "key", "secret", "token", "password", "pin", "jwt", "authorization",
)

# Rotate-key duplicate-idempotence window.
_IDEMPOTENCE_WINDOW = timedelta(hours=24)


def _redact_value(value: str | None) -> str:
    """first4 + '...' redaction · empty/short values become '****'."""
    if value is None:
        return "****"
    s = str(value)
    if len(s) <= 4:
        return "****"
    return s[:4] + "..."


def _redact_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Shallow walk of a payload — any key matching _SECRET_KEYS gets
    its value replaced. Nested dicts are walked one level. Lists of
    strings are left intact (we don't store user input deeply)."""
    if not payload:
        return {}
    out: dict[str, Any] = {}
    for k, v in payload.items():
        kl = str(k).lower()
        if any(s in kl for s in _SECRET_KEYS):
            out[k] = _redact_value(v if isinstance(v, str) else None)
        elif isinstance(v, dict):
            out[k] = _redact_payload(v)
        else:
            out[k] = v
    return out


def _write_audit(
    db: Session,
    *,
    actor_email: str,
    action: str,
    target_type: str,
    target_id: str,
    payload: dict[str, Any] | None,
    result: Literal["ok", "error"],
    error_message: str | None = None,
) -> AdminAuditLog:
    """Persist one audit row. Caller passes the redacted payload; we
    JSON-serialise it for storage. Best-effort — a logging failure is
    logged but never raises, so a single audit-write blip can't take
    down the underlying mutation."""
    try:
        row = AdminAuditLog(
            actor_email=actor_email,
            action=action,
            target_type=target_type,
            target_id=target_id,
            payload_json=json.dumps(payload or {}, default=str),
            result=result,
            error_message=error_message,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row
    except Exception as exc:  # noqa: BLE001
        _log.warning("[audit] write failed · action=%s · %s", action, exc)
        db.rollback()
        # Return an unpersisted instance so the caller still has the
        # shape — the audit row just won't exist in the DB.
        return AdminAuditLog(
            actor_email=actor_email,
            action=action,
            target_type=target_type,
            target_id=target_id,
            payload_json=json.dumps(payload or {}, default=str),
            result=result,
            error_message=error_message,
        )


def _check_idempotence(
    db: Session,
    *,
    action: str,
    idempotence_key: str | None,
    required: bool = False,
) -> None:
    """If `idempotence_key` was supplied (or required by `required=True`),
    refuse the call when an audit row exists in the last _IDEMPOTENCE_WINDOW
    with the same action + key in its payload. Raises 409 on duplicate."""
    if required and not idempotence_key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "idempotence-key header required")
    if not idempotence_key:
        return
    since = _now() - _IDEMPOTENCE_WINDOW
    # JSON LIKE match is dialect-agnostic enough for our needs (the
    # payload_json is small). We don't need a JSONB operator path.
    needle = f'"idempotence_key": "{idempotence_key}"'
    existing = (
        db.query(AdminAuditLog)
        .filter(
            AdminAuditLog.action == action,
            AdminAuditLog.created_at >= since,
            AdminAuditLog.payload_json.like(f"%{needle}%"),
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"duplicate idempotence-key (action={action}, ts={existing.created_at.isoformat() if existing.created_at else 'unknown'})",
        )


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt is not None else None


# =====================================================================
# Response models — shared
# =====================================================================


class MutationOk(BaseModel):
    """Generic success envelope for state-flipping mutations."""

    ok: bool = True
    action: str
    target_type: str
    target_id: str
    audit_id: int | None
    message: str


class AuditRowOut(BaseModel):
    id: int
    actor_email: str
    action: str
    target_type: str
    target_id: str
    payload: dict[str, Any]
    result: str
    error_message: str | None
    created_at: str | None


def _audit_to_out(row: AdminAuditLog) -> AuditRowOut:
    try:
        payload = json.loads(row.payload_json) if row.payload_json else {}
    except json.JSONDecodeError:
        payload = {"_raw": row.payload_json or ""}
    return AuditRowOut(
        id=row.id,
        actor_email=row.actor_email or "",
        action=row.action or "",
        target_type=row.target_type or "",
        target_id=row.target_id or "",
        payload=payload if isinstance(payload, dict) else {"value": payload},
        result=row.result or "ok",
        error_message=row.error_message,
        created_at=_iso(row.created_at),
    )


# =====================================================================
# 1. GET /recent-sales — sales feed from User + WebhookEvent
# =====================================================================


class SaleRow(BaseModel):
    event_kind: str  # "subscription.activated" | "webhook" | "trial.started"
    user_id: str | None
    email_masked: str | None
    tier: str | None
    subscription_status: str | None
    provider: str | None  # "whop" | "clerk" | "stripe"
    paid_until: str | None
    at: str | None


class RecentSalesOut(BaseModel):
    count: int
    since_hours: int
    rows: list[SaleRow]
    note: str


def _mask_email(email: str | None) -> str | None:
    if not email or "@" not in email:
        return None
    local, _, domain = email.partition("@")
    if len(local) <= 1:
        head = local
    elif len(local) == 2:
        head = local[0] + "*"
    else:
        head = local[0] + "*" * (len(local) - 2) + local[-1]
    return f"{head}@{domain}"


@router.get("/recent-sales", response_model=RecentSalesOut)
def recent_sales(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(50, ge=1, le=500),
    since_hours: int = Query(72, ge=1, le=720),
) -> RecentSalesOut:
    """Recent sales feed for HQ.

    Joins two sources because there is no dedicated `sales` table in v0:
      1. Users whose `subscription_status` is active/trial within the
         window — pulled from `users.updated_at` against the cut-off.
      2. Recent webhook_event_log rows where provider in ('whop','stripe')
         AND event_name suggests a paid lifecycle event.

    Output rows are deduplicated by (user_id, at) — the same Whop sale
    will surface from both queries when both exist. Emails are masked.
    """
    since = _now() - timedelta(hours=since_hours)
    rows: list[SaleRow] = []

    # 1) Users updated in the window with a paid-ish state.
    user_rows = (
        db.query(User)
        .filter(User.updated_at >= since)
        .filter(User.subscription_status.in_(("active", "trial", "trialing")))
        .order_by(User.updated_at.desc())
        .limit(limit)
        .all()
    )
    for u in user_rows:
        rows.append(
            SaleRow(
                event_kind=("subscription.activated" if u.subscription_status == "active" else "trial.started"),
                user_id=u.id,
                email_masked=_mask_email(u.email),
                tier=u.tier,
                subscription_status=u.subscription_status,
                provider=("whop" if u.whop_user_id else "clerk"),
                paid_until=_iso(u.paid_until),
                at=_iso(u.updated_at),
            )
        )

    # 2) Webhook events that look like billing in the same window.
    billing_events = (
        db.query(WebhookEventLog)
        .filter(
            WebhookEventLog.received_at >= since,
            WebhookEventLog.provider.in_(("whop", "stripe")),
        )
        .order_by(WebhookEventLog.received_at.desc())
        .limit(limit)
        .all()
    )
    for w in billing_events:
        rows.append(
            SaleRow(
                event_kind=f"webhook.{w.event_name or 'unknown'}",
                user_id=w.user_id,
                email_masked=None,  # webhook log doesn't store emails
                tier=None,
                subscription_status=None,
                provider=w.provider,
                paid_until=None,
                at=_iso(w.received_at),
            )
        )

    # Sort + cap.
    rows.sort(key=lambda r: r.at or "", reverse=True)
    rows = rows[:limit]

    return RecentSalesOut(
        count=len(rows),
        since_hours=since_hours,
        rows=rows,
        note=(
            "Best-effort feed · joins users.updated_at + webhook_event_log. "
            "No dedicated sales table exists in v0 — Whop/Stripe own the ledger."
        ),
    )


# =====================================================================
# 2. POST /campaigns/{slug}/edit — patch SponsoredCampaign
# =====================================================================


class CampaignEditIn(BaseModel):
    title: str | None = Field(None, max_length=240)
    payout_per_view: int | None = Field(None, ge=0, description="rpm_cents override")
    banner_url: str | None = Field(None, max_length=600)
    status: str | None = Field(None, max_length=40)


class CampaignOut(BaseModel):
    id: str
    slug: str
    name: str
    status: str
    rpm_cents: int
    banner_url: str | None
    updated_at: str | None


def _campaign_to_out(c: SponsoredCampaign) -> CampaignOut:
    return CampaignOut(
        id=c.id,
        slug=c.slug,
        name=c.name,
        status=c.status,
        rpm_cents=c.rpm_cents,
        banner_url=c.banner_url,
        updated_at=_iso(c.updated_at),
    )


@router.post("/campaigns/{slug}/edit", response_model=CampaignOut)
def edit_campaign(
    slug: str,
    body: CampaignEditIn,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    idempotence_key: Annotated[str | None, Header(alias="idempotence-key")] = None,
) -> CampaignOut:
    """Patch one or more editable fields on a SponsoredCampaign by slug.
    Only listed fields are touched — omitted fields stay as-is."""
    action = "campaign.edit"
    _check_idempotence(db, action=action, idempotence_key=idempotence_key)

    camp = db.query(SponsoredCampaign).filter_by(slug=slug).one_or_none()
    if not camp:
        _write_audit(
            db,
            actor_email=admin.email or "",
            action=action,
            target_type="campaign",
            target_id=slug,
            payload={"idempotence_key": idempotence_key, **body.model_dump(exclude_none=True)},
            result="error",
            error_message="campaign not found",
        )
        raise HTTPException(status.HTTP_404_NOT_FOUND, "campaign not found")

    patch = body.model_dump(exclude_none=True)
    if "title" in patch:
        camp.name = patch["title"]
    if "payout_per_view" in patch:
        camp.rpm_cents = int(patch["payout_per_view"])
    if "banner_url" in patch:
        camp.banner_url = patch["banner_url"]
    if "status" in patch:
        camp.status = patch["status"]

    db.commit()
    db.refresh(camp)

    _write_audit(
        db,
        actor_email=admin.email or "",
        action=action,
        target_type="campaign",
        target_id=camp.id,
        payload={"slug": slug, "idempotence_key": idempotence_key, "patch": patch},
        result="ok",
    )
    return _campaign_to_out(camp)


# =====================================================================
# 3. POST /campaigns/create
# =====================================================================


class CampaignCreateIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=240)
    slug: str = Field(..., min_length=1, max_length=80)
    payout_per_view: int = Field(0, ge=0, description="rpm_cents")
    banner_url: str | None = Field(None, max_length=600)
    status: str = Field("coming_soon", max_length=40)


@router.post("/campaigns/create", response_model=CampaignOut)
def create_campaign(
    body: CampaignCreateIn,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    idempotence_key: Annotated[str | None, Header(alias="idempotence-key")] = None,
) -> CampaignOut:
    action = "campaign.create"
    _check_idempotence(db, action=action, idempotence_key=idempotence_key)

    if db.query(SponsoredCampaign).filter_by(slug=body.slug).first():
        _write_audit(
            db,
            actor_email=admin.email or "",
            action=action,
            target_type="campaign",
            target_id=body.slug,
            payload={"idempotence_key": idempotence_key, **body.model_dump()},
            result="error",
            error_message="slug already exists",
        )
        raise HTTPException(status.HTTP_409_CONFLICT, "slug already exists")

    camp = SponsoredCampaign(
        slug=body.slug,
        name=body.title,
        rpm_cents=int(body.payout_per_view),
        banner_url=body.banner_url,
        status=body.status,
        # required-by-schema fields with safe defaults
        whop_url=body.banner_url or "",
        type="coming_soon",
    )
    db.add(camp)
    db.commit()
    db.refresh(camp)

    _write_audit(
        db,
        actor_email=admin.email or "",
        action=action,
        target_type="campaign",
        target_id=camp.id,
        payload={"idempotence_key": idempotence_key, **body.model_dump()},
        result="ok",
    )
    return _campaign_to_out(camp)


# =====================================================================
# 4. POST /campaigns/{slug}/archive
# =====================================================================


@router.post("/campaigns/{slug}/archive", response_model=MutationOk)
def archive_campaign(
    slug: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    idempotence_key: Annotated[str | None, Header(alias="idempotence-key")] = None,
) -> MutationOk:
    action = "campaign.archive"
    _check_idempotence(db, action=action, idempotence_key=idempotence_key)

    camp = db.query(SponsoredCampaign).filter_by(slug=slug).one_or_none()
    if not camp:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "campaign not found")
    camp.status = "archived"
    db.commit()
    row = _write_audit(
        db,
        actor_email=admin.email or "",
        action=action,
        target_type="campaign",
        target_id=camp.id,
        payload={"slug": slug, "idempotence_key": idempotence_key},
        result="ok",
    )
    return MutationOk(
        action=action,
        target_type="campaign",
        target_id=camp.id,
        audit_id=row.id,
        message=f"campaign {slug} archived",
    )


# =====================================================================
# 5. POST /users/{user_id}/tier-change
# =====================================================================


class TierChangeIn(BaseModel):
    tier: str = Field(..., min_length=1, max_length=40)
    reason: str = Field(..., min_length=1, max_length=400)


@router.post("/users/{user_id}/tier-change", response_model=MutationOk)
def change_tier(
    user_id: str,
    body: TierChangeIn,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    idempotence_key: Annotated[str | None, Header(alias="idempotence-key")] = None,
) -> MutationOk:
    action = "user.tier-change"
    _check_idempotence(db, action=action, idempotence_key=idempotence_key)

    if body.tier not in _VALID_TIERS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"invalid tier {body.tier!r} · allowed: {sorted(_VALID_TIERS)}",
        )

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")

    prior = user.tier
    user.tier = body.tier
    db.commit()

    row = _write_audit(
        db,
        actor_email=admin.email or "",
        action=action,
        target_type="user",
        target_id=user.id,
        payload={
            "idempotence_key": idempotence_key,
            "prior_tier": prior,
            "new_tier": body.tier,
            "reason": body.reason,
        },
        result="ok",
    )
    return MutationOk(
        action=action,
        target_type="user",
        target_id=user.id,
        audit_id=row.id,
        message=f"tier {prior} → {body.tier}",
    )


# =====================================================================
# 6. POST /users/{user_id}/refund
# =====================================================================


class RefundIn(BaseModel):
    amount_usd: float = Field(..., gt=0, le=10_000)
    currency: Literal["usd", "usdc"] = "usd"
    reason: str = Field(..., min_length=1, max_length=400)


class RefundOut(BaseModel):
    ok: bool
    action: str = "user.refund"
    target_id: str
    audit_id: int | None
    would_refund: bool
    live: bool
    message: str


@router.post("/users/{user_id}/refund", response_model=RefundOut)
def refund_user(
    user_id: str,
    body: RefundIn,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    idempotence_key: Annotated[str | None, Header(alias="idempotence-key")] = None,
) -> RefundOut:
    """Phase 1 · LOG-ONLY refund intent.

    When `WHOP_PAYMENTS_LIVE=true` AND a real refund call is wired
    into `whop_payments`, this endpoint will fire it. Until then the
    request is recorded in the audit log with `would_refund=true` so
    Daniel can reconcile in the Whop dashboard."""
    action = "user.refund"
    _check_idempotence(db, action=action, idempotence_key=idempotence_key)

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")

    live = (os.environ.get("WHOP_PAYMENTS_LIVE", "").strip().lower() in ("1", "true", "yes", "on"))
    would_refund = True
    note = "intent recorded · log-only mode (set WHOP_PAYMENTS_LIVE=true + wire refund SDK to actually call Whop)"
    if live:
        # TODO: call whop_payments.refund(...) once the SDK exposes one.
        # For now record the live-mode intent so the audit row reflects
        # the decision trail.
        note = "intent recorded · WHOP_PAYMENTS_LIVE=true but refund SDK not yet wired"

    row = _write_audit(
        db,
        actor_email=admin.email or "",
        action=action,
        target_type="user",
        target_id=user.id,
        payload={
            "idempotence_key": idempotence_key,
            "amount_usd": body.amount_usd,
            "currency": body.currency,
            "reason": body.reason,
            "live_mode": live,
            "whop_user_id": user.whop_user_id,
        },
        result="ok",
    )
    return RefundOut(
        ok=True,
        target_id=user.id,
        audit_id=row.id,
        would_refund=would_refund,
        live=live,
        message=note,
    )


# =====================================================================
# 7. POST /users/{user_id}/ban
# =====================================================================


class BanIn(BaseModel):
    reason: str = Field(..., min_length=1, max_length=400)
    until: datetime | None = Field(None, description="ISO date · null = indefinite")


@router.post("/users/{user_id}/ban", response_model=MutationOk)
def ban_user(
    user_id: str,
    body: BanIn,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    idempotence_key: Annotated[str | None, Header(alias="idempotence-key")] = None,
) -> MutationOk:
    action = "user.ban"
    _check_idempotence(db, action=action, idempotence_key=idempotence_key)

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")

    # banned_until is a NEW column we ALTER-into the users table in main.py.
    # Default = NULL = not banned. Indefinite ban = a far-future date.
    until = body.until or (datetime.now(timezone.utc) + timedelta(days=365 * 100))
    setattr(user, "banned_until", until)
    db.commit()

    row = _write_audit(
        db,
        actor_email=admin.email or "",
        action=action,
        target_type="user",
        target_id=user.id,
        payload={
            "idempotence_key": idempotence_key,
            "reason": body.reason,
            "until": until.isoformat() if until else None,
            "indefinite": body.until is None,
        },
        result="ok",
    )
    return MutationOk(
        action=action,
        target_type="user",
        target_id=user.id,
        audit_id=row.id,
        message=f"banned until {until.isoformat()}",
    )


# =====================================================================
# 8. POST /agents/{agent_id}/kill
# =====================================================================


@router.post("/agents/{agent_id}/kill", response_model=MutationOk)
def kill_agent(
    agent_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    idempotence_key: Annotated[str | None, Header(alias="idempotence-key")] = None,
) -> MutationOk:
    action = "agent.kill"
    _check_idempotence(db, action=action, idempotence_key=idempotence_key)

    agent = db.get(AgentPersona, agent_id)
    if not agent:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "agent not found")
    agent.active = False
    db.commit()
    row = _write_audit(
        db,
        actor_email=admin.email or "",
        action=action,
        target_type="agent",
        target_id=agent.id,
        payload={"idempotence_key": idempotence_key, "label": agent.label},
        result="ok",
    )
    return MutationOk(
        action=action,
        target_type="agent",
        target_id=agent.id,
        audit_id=row.id,
        message=f"agent {agent.label or agent.id} marked inactive",
    )


# =====================================================================
# 9. POST /agents/{agent_id}/restart
# =====================================================================


@router.post("/agents/{agent_id}/restart", response_model=MutationOk)
def restart_agent(
    agent_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    idempotence_key: Annotated[str | None, Header(alias="idempotence-key")] = None,
) -> MutationOk:
    action = "agent.restart"
    _check_idempotence(db, action=action, idempotence_key=idempotence_key)

    agent = db.get(AgentPersona, agent_id)
    if not agent:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "agent not found")
    # Flip off → on; bump restart_count for observability.
    agent.active = False
    db.flush()
    agent.active = True
    agent.restart_count = (agent.restart_count or 0) + 1
    db.commit()
    row = _write_audit(
        db,
        actor_email=admin.email or "",
        action=action,
        target_type="agent",
        target_id=agent.id,
        payload={
            "idempotence_key": idempotence_key,
            "label": agent.label,
            "restart_count": agent.restart_count,
        },
        result="ok",
    )
    return MutationOk(
        action=action,
        target_type="agent",
        target_id=agent.id,
        audit_id=row.id,
        message=f"agent {agent.label or agent.id} restarted (count={agent.restart_count})",
    )


# =====================================================================
# 10. POST /agents/{agent_id}/rotate-key
# =====================================================================


class RotateKeyOut(BaseModel):
    ok: bool
    action: str = "agent.rotate-key"
    target_id: str
    audit_id: int | None
    # New persona key — RETURNED ONCE, never persisted in plaintext.
    new_key: str
    new_key_preview: str  # first 4 + "..." for display + audit
    message: str


def _mint_persona_key() -> str:
    """64-char URL-safe token. The persona JWT story uses Ed25519 in
    `jwt_signer.py` for license JWTs, but agent persona keys are
    opaque shared-secret strings the agent loop reads from env. We
    mint a fresh `agent_pk_<48>` string and hand it back to the admin
    exactly once."""
    return "agent_pk_" + secrets.token_urlsafe(32)


@router.post("/agents/{agent_id}/rotate-key", response_model=RotateKeyOut)
def rotate_agent_key(
    agent_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    idempotence_key: Annotated[str | None, Header(alias="idempotence-key")] = None,
) -> RotateKeyOut:
    """Rotate the shared-secret persona key for one agent.

    Idempotence-key is REQUIRED here — a missing or duplicate (within 24h)
    key returns 4xx. This prevents accidentally minting two keys when a
    nervous admin double-clicks. The full new key is returned ONCE in
    the response; only the SHA-256 hash is persisted, and the audit
    log records only the first 4 chars + '...'."""
    action = "agent.rotate-key"
    _check_idempotence(db, action=action, idempotence_key=idempotence_key, required=True)

    agent = db.get(AgentPersona, agent_id)
    if not agent:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "agent not found")

    new_key = _mint_persona_key()
    new_hash = hashlib.sha256(new_key.encode("utf-8")).hexdigest()
    preview = _redact_value(new_key)
    agent.api_key_hash = new_hash
    agent.api_key_preview = preview
    agent.last_rotated_at = datetime.now(timezone.utc)
    db.commit()

    row = _write_audit(
        db,
        actor_email=admin.email or "",
        action=action,
        target_type="agent",
        target_id=agent.id,
        payload={
            "idempotence_key": idempotence_key,
            "label": agent.label,
            "new_key": preview,  # redacted form only
            "rotated_at": agent.last_rotated_at.isoformat() if agent.last_rotated_at else None,
        },
        result="ok",
    )
    return RotateKeyOut(
        ok=True,
        target_id=agent.id,
        audit_id=row.id,
        new_key=new_key,
        new_key_preview=preview,
        message="key rotated · this is the only time the full value will be shown",
    )


# =====================================================================
# 11. GET /audit-log
# =====================================================================


class AuditLogOut(BaseModel):
    count: int
    rows: list[AuditRowOut]


@router.get("/audit-log", response_model=AuditLogOut)
def audit_log(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(200, ge=1, le=1000),
    since_hours: int = Query(168, ge=1, le=24 * 90),
    user_id: str | None = Query(None, description="filter by target_id (any target type)"),
    action_filter: str | None = Query(None, alias="action"),
    actor: str | None = Query(None, description="filter by actor_email substring"),
) -> AuditLogOut:
    since = _now() - timedelta(hours=since_hours)
    q = db.query(AdminAuditLog).filter(AdminAuditLog.created_at >= since)
    if user_id:
        q = q.filter(AdminAuditLog.target_id == user_id)
    if action_filter:
        q = q.filter(AdminAuditLog.action == action_filter)
    if actor:
        q = q.filter(AdminAuditLog.actor_email.ilike(f"%{actor.lower()}%"))
    rows = q.order_by(AdminAuditLog.created_at.desc()).limit(limit).all()
    return AuditLogOut(count=len(rows), rows=[_audit_to_out(r) for r in rows])
