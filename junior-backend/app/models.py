"""ORM models — mirror the schema in oauth-billing.md §4.

Single source of truth for table shapes. Alembic migrations are generated
from these.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    clerk_id: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String, nullable=False, index=True)
    whop_user_id: Mapped[str | None] = mapped_column(String, unique=True, nullable=True, index=True)

    # Tier — free | solo | channel | autopilot. Founders get tier=channel + founder_flag=true.
    tier: Mapped[str] = mapped_column(String, nullable=False, default="free")
    founder_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Locked at signup from the jnr_ref cookie. Never overwritten — see oauth-billing.md §6.
    affiliate_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)

    # Subscription state — trial | active | expired | refunded | canceled.
    subscription_status: Mapped[str] = mapped_column(String, nullable=False, default="trial")
    trial_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    paid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Starter pass — lifetime free clip-EXPORT counter (Junior-enforced, not Whop).
    # Free/starter users get 100 successful exports; #101 requires Solo. Paid tiers
    # are unlimited. Incremented only on a successful export via /usage/clip-exported.
    starter_exports_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

    licenses: Mapped[list["License"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class License(Base):
    __tablename__ = "licenses"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    jwt: Mapped[str] = mapped_column(Text, nullable=False)            # full signed JWT for audit
    tier_at_issue: Mapped[str] = mapped_column(String, nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    user: Mapped[User] = relationship(back_populates="licenses")


class Usage(Base):
    """Monthly usage bucket — enforces Free-tier 3-vid/mo cap via /usage/video-started."""
    __tablename__ = "usage"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    period_start: Mapped[datetime] = mapped_column(Date, primary_key=True)
    videos_processed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Schedule(Base):
    """A scheduled post — clip + platform + time. Cron worker fires these."""
    __tablename__ = "schedules"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    project_slug: Mapped[str] = mapped_column(String, nullable=False)
    clip_idx: Mapped[int] = mapped_column(Integer, nullable=False)        # 0-based position in project.clips
    clip_title: Mapped[str] = mapped_column(String, nullable=False)        # snapshot at schedule time
    vertical_path: Mapped[str] = mapped_column(String, nullable=False)

    platform: Mapped[str] = mapped_column(String, nullable=False)          # youtube | tiktok | x
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)

    # status: pending | uploading | scheduled | published | failed | canceled
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending", index=True)
    postiz_post_id: Mapped[str | None] = mapped_column(String, nullable=True)
    post_url: Mapped[str | None] = mapped_column(String, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Retry policy per spec §1.4 — 3x exponential backoff (1min · 5min · 25min).
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class Notification(Base):
    """Per-user inbox row. See ~/Desktop/jnr/notifications.md for schema rationale."""

    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    category: Mapped[str] = mapped_column(String, nullable=False, index=True)  # one of NOTIFICATION_CATEGORIES
    title: Mapped[str] = mapped_column(String, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    priority: Mapped[str] = mapped_column(String, nullable=False, default="medium")  # low | medium | high
    action_kind: Mapped[str | None] = mapped_column(String, nullable=True)
    action_data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)

    # Dedup webhook-originated rows on retry (Whop / Postiz are at-least-once).
    external_dedup_key: Mapped[str | None] = mapped_column(String, nullable=True, unique=True, index=True)


NOTIFICATION_CATEGORIES = (
    "system_update",
    "post_published",
    "post_failed",
    "drip_summary",
    "quota_warning",
    "billing",
    "affiliate",
    "founder",
    "junior_message",
    "pipeline_event",
)


class PostizConnection(Base):
    """A user's Postiz identity — one per Junior user, established once on first
    Connect-platform action. Holds the pos_* access token used for every
    subsequent publish + integration call.

    The token never expires until the user revokes from their Postiz
    settings (per Postiz OAuth2 docs). When a revocation webhook lands we
    flip `active=False` and require re-auth before next publish.
    """

    __tablename__ = "postiz_connections"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    postiz_org_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    postiz_stripe_cus: Mapped[str | None] = mapped_column(String, nullable=True)
    access_token: Mapped[str] = mapped_column(Text, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    connected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class PendingWhopMembership(Base):
    """Entitlement parked for a buyer who paid on Whop BEFORE creating their
    Junior account (common for affiliate-referred sales).

    The membership_went_valid webhook can't find a local user yet, so instead
    of dropping the sale it stashes the resolved tier here keyed by email.
    /onboarding/link-whop claims the row on first sign-in, applies the tier,
    and stamps consumed_at so it's only ever applied once.

    Intentionally tiny — this is NOT a billing ledger. Whop remains the
    source of truth for the subscription record.
    """

    __tablename__ = "pending_whop_memberships"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    email: Mapped[str] = mapped_column(String, nullable=False, index=True)
    tier: Mapped[str] = mapped_column(String, nullable=False)
    founder: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    whop_user_id: Mapped[str | None] = mapped_column(String, nullable=True)
    renewal_period_end: Mapped[int | None] = mapped_column(Integer, nullable=True)  # unix ts from Whop

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WebhookEvent(Base):
    """Idempotency log for incoming webhooks."""
    __tablename__ = "webhook_events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    provider: Mapped[str] = mapped_column(String, nullable=False)        # 'clerk' | 'whop'
    external_id: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    body_hash: Mapped[str] = mapped_column(String, nullable=False)


class WhopClaimToken(Base):
    """Short-lived, one-use token for the self-serve 'I paid on Whop with a
    different email' claim. The user enters their Whop purchase email; if a
    pending membership exists we email a claim link to THAT address. Ownership
    proof is two-factor: you must control the inbox (to get the link) AND be the
    same signed-in Clerk user that requested it (checked at redeem). Expires
    fast, burns on use. Not a ledger."""

    __tablename__ = "whop_claim_tokens"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    token: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    clerk_user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    whop_purchase_email: Mapped[str] = mapped_column(String, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DesktopErrorEvent(Base):
    """Metadata-only telemetry of desktop-side errors.

    The desktop POSTs to /telemetry/desktop-error (NO auth — must accept reports
    even when the license JWT is rejected or the backend is otherwise unreachable
    from the app's point of view). Powers Admin HQ → Bugs so production failures
    are visible without users having to report them.

    Deliberately stores NO secrets, JWTs, tokens, file paths, or raw payloads —
    only sanitized metadata: the event name, the build/OS/arch, an optional route
    + http_status + error_code, a SANITIZED short message (emails redacted), and
    `user_ref` which is an INTERNAL backend/clerk id the desktop caches for
    grouping (never a JWT/secret). Writing is best-effort; a logging failure must
    never block the report. New table — auto-created by the lifespan create_all.
    """

    __tablename__ = "desktop_error_event"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    event: Mapped[str] = mapped_column(String, nullable=False, index=True)        # license_rejected | backend_offline | update_failed | export_capped | unhandled_error | ...
    app_version: Mapped[str] = mapped_column(String, nullable=False, index=True)
    os: Mapped[str] = mapped_column(String, nullable=False)                       # darwin | win32 | linux ...
    arch: Mapped[str] = mapped_column(String, nullable=False)                     # arm64 | x64 ...
    route: Mapped[str | None] = mapped_column(String, nullable=True)              # logical screen/api route, not a filesystem path
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String, nullable=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)             # sanitized: ~300 chars, emails redacted, whitespace collapsed
    user_ref: Mapped[str | None] = mapped_column(String, nullable=True, index=True)  # internal backend/clerk id only — NEVER a JWT/secret
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)


class WebhookEventLog(Base):
    """Metadata-only audit log of every signature-valid Clerk/Whop webhook.

    Powers the Admin HQ Webhooks tab so failed/ignored events are visible
    without log diving. Deliberately stores NO raw payloads, secrets, emails,
    or tokens — only ids, the event name, an outcome status, and a short
    sanitized error. Writing is best-effort in its OWN session, so a logging
    failure (or a processing rollback) never blocks webhook handling.
    """

    __tablename__ = "webhook_event_log"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    provider: Mapped[str] = mapped_column(String, nullable=False, index=True)   # clerk | whop
    event_name: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, index=True)     # received|handled|ignored|failed
    user_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    pending_whop_membership_id: Mapped[str | None] = mapped_column(String, nullable=True)
    claim_token_id: Mapped[str | None] = mapped_column(String, nullable=True)
    external_event_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    error: Mapped[str | None] = mapped_column(String, nullable=True)            # short sanitized
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
