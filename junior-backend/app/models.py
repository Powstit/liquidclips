"""ORM models — mirror the schema in oauth-billing.md §4.

Single source of truth for table shapes. Alembic migrations are generated
from these.

ship-lens v0.7.8 P1 — SocialChannel.status now includes "unlinked" so the
UI can distinguish "I never linked this" (pending_link) from "the platform
revoked my access" (unlinked). last_unlinked_at stamps when the revoke
happened so we can surface "Disconnected 2h ago" copy if needed later.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import JSON, BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
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

    # This user's OWN Whop affiliate ID. Provisioned eagerly at signup and
    # backfilled by /me/affiliate after transient Whop failures.
    whop_affiliate_id: Mapped[str | None] = mapped_column(String, nullable=True, unique=True, index=True)
    # Whop's checkout embed expects the affiliate CODE (normally username),
    # not the aff_* record id. Keep both so legacy aff_* links and current
    # username links resolve to the same referrer.
    whop_affiliate_code: Mapped[str | None] = mapped_column(String, nullable=True, unique=True, index=True)

    # Subscription state — trial | active | expired | refunded | canceled.
    subscription_status: Mapped[str] = mapped_column(String, nullable=False, default="trial")
    trial_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    paid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # First successful paid invoice. Used by the affiliate 7-day good-standing
    # hold; renewals never move this timestamp.
    first_paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    # Starter pass — lifetime free clip-EXPORT counter (Junior-enforced, not Whop).
    # Free/starter users get 100 successful exports; #101 requires Solo. Paid tiers
    # are unlimited. Incremented only on a successful export via /usage/clip-exported.
    starter_exports_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # P2 — tier matrix v2 (Free/Solo/Pro/Agency + Founder).
    # ip_address captured at signup; same IP creating a second Free account is
    # gated by clips_created summed across all users on that IP. active_at
    # ticks on each clip export and feeds the Founder-flash-sale unlock at
    # active_users >= 2,000. extra_accounts_purchased adds 1 social account
    # per Account Pack unit ($6/mo Clerk add-on) on top of the tier's base.
    ip_address: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    clips_created: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    extra_accounts_purchased: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    llm_usage_month: Mapped[str | None] = mapped_column(String, nullable=True)
    llm_tokens_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Earnings leaderboard cache (sprint #14a). The per-user fetch path in
    # affiliate.py hits Whop on every request and would rate-limit us
    # immediately under a leaderboard fanout. cron.py refreshes these every
    # 6h from Whop's /affiliates/{id} record; routes/leaderboard.py reads
    # ONLY from this cache so the board is fast + Whop-independent at
    # request time.
    cached_lifetime_earnings_usd: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=Decimal("0"))
    cached_paid_referrals: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cached_display_handle: Mapped[str | None] = mapped_column(String, nullable=True)
    cached_earnings_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Stripe Connect Express — payout rail for non-Whop affiliates. Columns
    # are ALTERed-in via main.py lifespan but were missing from the SQLAlchemy
    # model, so /stripe-connect/status used to AttributeError-500. Declared
    # here so the ORM can read them.
    stripe_connect_account_id: Mapped[str | None] = mapped_column(String, nullable=True, unique=True, index=True)
    stripe_connect_status: Mapped[str] = mapped_column(String, nullable=False, default="none")
    stripe_connect_payouts_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    stripe_connect_charges_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Partner Engine (LiquidClips-Partner-Engine.md). referred_paid_subs is the
    # local transactional counter (Whop's active_members_count is read live for
    # the dashboard but is not safe to gate state changes on). tiktok_handle +
    # tiktok_verification_code + tiktok_verified_at drive the code-in-bio gate.
    # partner_unlocked_at + whop_commission_override_id mark the user as a
    # Partner — set together when the unlock service POSTs the 50% override.
    # 2026-06-24 · carrot rail · Whop sub-merchant ID for transfers.create
    # destination_id + onboarding status. Set via POST /me/carrot/onboard.
    # carrot_total_paid_usd_cents is the lifetime sum of net payouts (5% LC
    # fee already deducted). carrot_last_claim_at gates retries / idempotence.
    whop_sub_merchant_id: Mapped[str | None] = mapped_column(String, nullable=True, unique=True, index=True)
    whop_sub_merchant_status: Mapped[str] = mapped_column(String, nullable=False, default="none")
    carrot_total_paid_usd_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    carrot_last_claim_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    referred_paid_subs: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tiktok_handle: Mapped[str | None] = mapped_column(String, nullable=True)
    tiktok_verification_code: Mapped[str | None] = mapped_column(String, nullable=True)
    tiktok_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    partner_unlocked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    whop_commission_override_id: Mapped[str | None] = mapped_column(String, nullable=True)
    affiliate_qualified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    affiliate_commission_override_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    # 2026-06-24 · Admin HQ Management Gap — soft ban marker. NULL =
    # not banned. A future date = banned until that date. A far-future
    # date (≈ year 2126) is the convention for an indefinite ban.
    # Read by the gate that mints licenses + by Earn/Publish gates.
    banned_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

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

    # Schedule v2 (sprint multi-channel): channel_id, per-channel caption,
    # Ayrshare's scheduled-post id (for cancel) + the final published URL.
    # platform stays for back-compat with legacy rows; new rows infer it from
    # the channel.
    channel_id: Mapped[str | None] = mapped_column(ForeignKey("social_channels.id", ondelete="SET NULL"), nullable=True, index=True)
    caption_override: Mapped[str | None] = mapped_column(Text, nullable=True)
    ayrshare_scheduled_post_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    actual_post_url: Mapped[str | None] = mapped_column(String, nullable=True)

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
    """LEGACY — kept so existing rows don't 500 on table reflection. Replaced
    by SocialConnection at P1 (Ayrshare). Do not write to this table from new
    code paths."""

    __tablename__ = "postiz_connections"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    postiz_org_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    postiz_stripe_cus: Mapped[str | None] = mapped_column(String, nullable=True)
    access_token: Mapped[str] = mapped_column(Text, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    connected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class SocialConnection(Base):
    """A user's Ayrshare profile — one row per Junior user, established when
    they paste their Ayrshare Profile Key. Profile key is the bearer for all
    publish + analytics calls. connected_platforms mirrors what's linked on
    Ayrshare's side so the desktop can render platform chips without an
    extra round-trip on every PublishModal open.
    """

    __tablename__ = "social_connections"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    ayrshare_profile_key: Mapped[str] = mapped_column(String, nullable=False)
    connected_platforms: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
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
    # True once a payment.succeeded event has been seen. Membership activation
    # can precede payment for trials; this flag prevents an out-of-order paid
    # checkout from being claimed later as merely "trialing".
    paid: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    whop_user_id: Mapped[str | None] = mapped_column(String, nullable=True)
    renewal_period_end: Mapped[int | None] = mapped_column(Integer, nullable=True)  # unix ts from Whop

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SocialChannel(Base):
    """One social channel = one Ayrshare sub-profile = one platform handle
    (sprint Schedule v2). A user can have N channels; each is created
    independently via /channels POST → Ayrshare /profiles/profile → user OAuths
    one social account on the new profile via Ayrshare's browser-based linker.

    Replaces the single-row SocialConnection model for new users. Legacy users
    with a SocialConnection row get auto-backfilled into a single channel on
    their first /channels GET (see routes/channels.py for the backfill helper).
    """

    __tablename__ = "social_channels"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String, nullable=False)                         # user-facing name
    platform: Mapped[str] = mapped_column(String, nullable=False)                      # tiktok | instagram | youtube | x | linkedin | facebook | threads
    ayrshare_profile_key: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    ayrshare_ref_id: Mapped[str | None] = mapped_column(String, nullable=True)
    handle: Mapped[str | None] = mapped_column(String, nullable=True)                  # @username, pulled from Ayrshare /user
    # ship-lens v0.7.8 P1 — Added "unlinked" so a platform-side revoke (TikTok
    # token expiry / user manually disconnecting on the social side) is
    # distinguishable from "user never finished the OAuth dance" (pending_link).
    # No SQL enum constraint — string column, normalized in the webhook + UI.
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending_link")  # pending_link | active | error | paused | deleted | unlinked
    last_refreshed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # ship-lens v0.7.8 P1 — Stamped when channel.unlinked / channel.disconnected
    # fires. Lets admin + UI surface "Disconnected 3h ago" copy without
    # inferring it from last_probe_at (which ticks on every refresh and would
    # lie about how long ago the revoke actually happened).
    last_unlinked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    total_posts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)        # denormalized for fast list views
    # Observability — every time we PROBE the channel against Ayrshare (refresh,
    # create, relink), stamp the wall clock and (if it failed) the short error.
    # link_attempts ticks every time we mint a fresh link URL (create / relink)
    # so we can SEE in prod how many round-trips users take to get a working
    # OAuth (a high number = our linking flow is broken or confusing).
    last_probe_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    last_probe_error: Mapped[str | None] = mapped_column(String, default=None)
    link_attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class PostAnalytic(Base):
    """Per-published-post engagement snapshot — refreshed by cron every 30 min
    for posts in the last 90 days. Reads ONLY from this cache (not Ayrshare
    directly) so the AnalyticsView renders fast + rate-limit safe."""

    __tablename__ = "post_analytics"

    schedule_id: Mapped[str] = mapped_column(ForeignKey("schedules.id", ondelete="CASCADE"), primary_key=True)
    channel_id: Mapped[str] = mapped_column(ForeignKey("social_channels.id", ondelete="CASCADE"), nullable=False, index=True)
    platform: Mapped[str] = mapped_column(String, nullable=False)
    views: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    likes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    comments: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    shares: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    saves: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    engagement_rate: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    refreshed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)
    raw_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)


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


class TrackingLink(Base):
    """A user-owned trackable short link. Resolves at GET /r/{id} → 302 to
    destination_url. Click logging is best-effort and never blocks the redirect.

    Slugs are public (`trk_<16hex>`) since they appear in shared URLs. Disable
    by stamping `disabled_at` rather than hard-deleting, so historical
    link_clicks keep their FK target and analytics survive disablement.

    Foundation lands ahead of the desktop UI — rows are created later by the
    reward-clip pipeline and (eventually) by a user-facing 'Create tracking
    link' surface in Earn.
    """

    __tablename__ = "tracking_links"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: "trk_" + uuid.uuid4().hex[:16])
    # Owner may be null for system-generated campaign links; SET NULL on user
    # delete so the link keeps resolving (it's already been shared publicly).
    owner_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    affiliate_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    campaign_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    reward_clip_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    label: Mapped[str | None] = mapped_column(String, nullable=True)
    platform: Mapped[str | None] = mapped_column(String, nullable=True)
    account_label: Mapped[str | None] = mapped_column(String, nullable=True)
    destination_url: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LinkClick(Base):
    """One row per resolved /r/{id} hit. Privacy-tight:
      - no raw IP (sha256 with daily-rotating salt → ip_hash)
      - no full user agent (truncated/sanitized family string)
      - no full referer (host only)
      - destination_url is snapshotted so analytics survive link edits

    Written best-effort in a fresh session — a logging failure must never
    block the redirect itself.
    """

    __tablename__ = "link_clicks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    tracking_link_id: Mapped[str] = mapped_column(ForeignKey("tracking_links.id", ondelete="CASCADE"), nullable=False, index=True)
    clicked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)
    ip_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    user_agent_family: Mapped[str | None] = mapped_column(String, nullable=True)
    referer_host: Mapped[str | None] = mapped_column(String, nullable=True)
    destination_url: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class RewardClip(Base):
    """A Junior reward-clip record — bridges a locally generated clip to two
    external systems: a Whop Content Reward submission (status + payout) and
    a Junior tracking link (clicks → signups → paid → MRR).

    Created by POST /me/reward-clips on clip generation. The tracking link is
    minted in the same transaction so the dashboard row can show both Whop and
    Junior numbers side-by-side.

    Status is an intentionally loose string (no enum). Whop's submission states
    evolve faster than our schema, and we display them verbatim where useful.
    Common values: draft | generated | submitted | approved | denied.
    """

    __tablename__ = "reward_clips"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: "rclip_" + uuid.uuid4().hex[:16])
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    whop_reward_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    whop_reward_title: Mapped[str | None] = mapped_column(String, nullable=True)
    clip_idx: Mapped[int] = mapped_column(Integer, nullable=False)
    platform: Mapped[str | None] = mapped_column(String, nullable=True)
    account_label: Mapped[str | None] = mapped_column(String, nullable=True)
    campaign_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    # Tracking link points the OTHER direction too (tracking_links.reward_clip_id).
    # SET NULL so a deleted tracking link doesn't take the reward clip with it —
    # the Whop submission record on the reward clip stays meaningful on its own.
    tracking_link_id: Mapped[str | None] = mapped_column(ForeignKey("tracking_links.id", ondelete="SET NULL"), nullable=True, index=True)
    whop_submission_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    status: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


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


class CampaignSubmission(Base):
    """A clipper's submission to a sponsored Liquid Clips campaign
    (sprint #14c — Minecraft Story Clip Challenge being the first).

    The flow:
      1. Clipper exports a clip via Liquid Lift (clean if paid tier, watermarked
         if free).
      2. Posts the clip to TikTok / Instagram Reels / YouTube Shorts.
      3. Submits the public clip URL + metadata via POST /submissions.
      4. Backend downloads the clip via yt-dlp, runs watermark_detector.
      5. Watermarked → rejected with `upgrade` reason. Clean → status=pending
         (manual mod review until Whop campaign forwarding is wired).
      6. (Future) on accept, forward to the Whop campaign for view-payout.

    NO clip BYTES are stored — only the public URL + metadata. The clip lives
    on TikTok/Reels/YouTube; we just track its existence + status.
    """

    __tablename__ = "campaign_submissions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    campaign_id: Mapped[str] = mapped_column(String, nullable=False, index=True)  # whop campaign id OR slug (e.g. "minecraft_v1")

    clip_url: Mapped[str] = mapped_column(String, nullable=False)               # the public posted clip url
    source_url: Mapped[str | None] = mapped_column(String, nullable=True)       # long-form source video
    moment_type: Mapped[str] = mapped_column(String, nullable=False)            # betrayal | war | villain_speech | etc
    hook_timestamp: Mapped[str | None] = mapped_column(String, nullable=True)   # hh:mm:ss within clipper's clip
    why_this_moment: Mapped[str | None] = mapped_column(Text, nullable=True)    # clipper's narration

    permission_type: Mapped[str] = mapped_column(String, nullable=False)        # my_own_footage | creator_licensed | transformative_commentary
    disclosure_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Watermark detector result snapshot (JSON-serialised WatermarkResult).
    # Kept for audit + mod review even after status flips.
    watermark_check: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # status: submitted (initial after watermark pass)
    #       | rejected (auto or manual — see rejection_reason)
    #       | accepted (mod approved → will forward to Whop)
    #       | forwarded (sent to Whop, awaiting view-payout)
    #       | paid (Whop confirmed payout — view-RPM verified)
    status: Mapped[str] = mapped_column(String, nullable=False, default="submitted", index=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Filled when the submission graduates to Whop's content reward queue
    whop_submission_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    verified_views: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    payout_usd_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class SponsoredCampaign(Base):
    """v0.7.0 (Sprint 2) — Liquid Clips owned campaign banners.

    Replaces generic Whop affiliate cards on the workspace dashboard with
    full-width sponsored banners we control. Statuses (coming_soon /
    partially_funded / funded / live / closed / invite_only) drive the
    visual treatment; visibility_tiers gates which user tiers see the
    banner (lower tiers see a locked + upgrade CTA per Sprint 4).

    Source of truth = admin CRUD. Auto-funding sums + Stripe pledge ledger
    arrive in Sprint 5. For now `funded_pct` is hand-set per record.
    """

    __tablename__ = "sponsored_campaigns"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    slug: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    brand: Mapped[str | None] = mapped_column(String, nullable=True)
    subtitle: Mapped[str | None] = mapped_column(String, nullable=True)

    # type drives the homepage SECTION the banner lands in:
    #   public | coming_soon | funded | invite_only | recurring
    type: Mapped[str] = mapped_column(String, nullable=False, default="coming_soon", index=True)
    # status is the lifecycle bucket:
    #   coming_soon | partially_funded | funded | live | closed
    status: Mapped[str] = mapped_column(String, nullable=False, default="coming_soon", index=True)

    rpm_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    budget_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    funded_pct: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_label: Mapped[str | None] = mapped_column(String, nullable=True)

    whop_url: Mapped[str] = mapped_column(String, nullable=False)
    banner_url: Mapped[str | None] = mapped_column(String, nullable=True)

    eligibility: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    visibility_tiers: Mapped[list] = mapped_column(JSON, nullable=False, default=lambda: ["free","solo","pro","agency"])

    min_lc_score: Mapped[int] = mapped_column(Integer, nullable=False, default=75)
    cta_text: Mapped[str] = mapped_column(String, nullable=False, default="View Campaign Brief →")

    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)

    # v0.7.55 (Uncle Daniel funnel) — tier-aware payout ladder.
    # `rpm_cents` (above) stays as the legacy single value the existing
    # surfaces read; new surfaces read `base_rpm_cents` (free payout) +
    # `premium_rpm_cents` (paid total). `premium_bonus_cents` is the
    # admin-paid delta for reporting (= premium - base).
    base_rpm_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    premium_rpm_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    premium_bonus_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Top-of-card copy per tier. Server-rendered so the wire stays
    # cache-friendly; the Earn UI chooses which one to display from the
    # caller's tier.
    free_banner_text: Mapped[str | None] = mapped_column(String, nullable=True)
    premium_banner_text: Mapped[str | None] = mapped_column(String, nullable=True)

    # Mission classification — `mission_type` is the high-level bucket
    # (uncle_daniel | viral_reaction | software_proof | NULL=legacy);
    # `mission_lane` is a free-form sub-label (training | main | proof | …).
    mission_type: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    mission_lane: Mapped[str | None] = mapped_column(String, nullable=True)

    # Gating flags. `requires_membership` hides the campaign for free
    # users (rendered as "Premium only" pill if listed). `watermark_allowed`
    # lets free users participate via watermarked exports — separate from
    # premium because some lanes are watermark-forbidden by sponsor.
    requires_membership: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    watermark_allowed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Whop Content Reward linkage — both nullable in Phase 1 because the
    # Whop campaign may not exist yet (admin pays the base $1 manually
    # alongside the premium bonus until the Whop side is created).
    whop_campaign_id: Mapped[str | None] = mapped_column(String, nullable=True)
    whop_campaign_url: Mapped[str | None] = mapped_column(String, nullable=True)

    # v0.7.55 (community architecture) — campaign↔channel binding +
    # brand metadata so the campaign card knows which Whop chat feed to
    # link to, which business unit the budget belongs to, and whether
    # this campaign should render in the affiliate room (separate from
    # the main rewards HQ). Matches Daniel's locked field list verbatim.
    brand_name: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    business_unit: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    required_tier: Mapped[str | None] = mapped_column(String, nullable=True)
    community_channel_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    affiliate_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_high_rpm: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_invite_only: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # ─── Phase 6N-E · Whop reward connection ─────────────────────────────
    # Locked rule: Whop is the source of truth for reward funding,
    # bounty/reward pool, attribution, payout eligibility, approval.
    # Liquid Clips caches a snapshot for cheap discovery-card reads but
    # NEVER forks the accounting ledger.
    #
    # `whop_reward_id` / `whop_reward_url` rename the legacy
    # `whop_campaign_id` / `whop_campaign_url` fields. Old columns stay
    # as fallback reads until one release rotates everything to the new
    # names. Idempotent ALTER TABLE statements in app/main.py:lifespan
    # add the new columns and copy values from the legacy fields.
    whop_reward_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    whop_reward_url: Mapped[str | None] = mapped_column(String, nullable=True)
    # Cached normalized response from `_normalize_bounty`. Capped at
    # top-level fields so the row doesn't grow unbounded with deep
    # discussion-post / attachment trees.
    whop_reward_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # `business_goal_type` maps to our `campaign_type` discriminator.
    # `bounty_type` is captured for analytics (`classic / user_funded /
    # workforce`). Both nullable until first sync.
    whop_reward_snapshot_business_goal: Mapped[str | None] = mapped_column(
        String, nullable=True, index=True
    )
    whop_reward_snapshot_bounty_type: Mapped[str | None] = mapped_column(
        String, nullable=True
    )
    # Last successful sync · drives the 6h stale calculation + cron
    # pickup. Indexed so the cron query is cheap.
    whop_reward_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    whop_reward_last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Cached reward-state enum from the 6N-E plan §1.b. Indexed for
    # discovery-card filtering. Values:
    #   unlinked / pending_reward / connected / live / funded /
    #   partially_funded / capacity_reached / closed / unreachable /
    #   not_visible / stale
    whop_reward_state: Mapped[str | None] = mapped_column(
        String, nullable=True, index=True
    )
    # ─── 6N-E correction patch · URL-first ──────────────────────────
    # Separates "we tried to enrich" from "we never tried" so the UI
    # can render the right empty state. Default 'not_attempted' on row
    # create. The reward enrichment is BONUS · campaign creation +
    # publish do NOT require this to be `enriched`.
    #   not_attempted · no enrichment fetch yet (id couldn't be extracted)
    #   enriched      · publicBounty returned a usable snapshot
    #   not_enriched  · 404 / not_visible / Partner-gated (deliberate)
    #   unreachable   · 5xx / network error (transient)
    whop_reward_snapshot_status: Mapped[str] = mapped_column(
        String, nullable=False, default="not_attempted", index=True
    )

    # Discriminator from Phase 6N-A architecture. Defaults to "clip" so
    # legacy rows don't trip the not-null check during migration.
    campaign_type: Mapped[str] = mapped_column(
        String, nullable=False, default="clip", index=True
    )

    # Agency identity. SET NULL on user delete so the row survives.
    created_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Long-form description body for the campaign page. Defaults to ''
    # for legacy rows. Agency creation flow's Step 2 writes this.
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class CommunityChannel(Base):
    """v0.7.55 — tier-gated community rooms. One row per Whop chat feed
    that Liquid Clips routes to.

    Architecture (locked by Daniel):
      • Free rooms: Free Clipper Lobby + Announcements. Open to all.
      • Paid core: Premium Rewards HQ + Affiliate Growth Room. Members
        only. Locked preview shown to free users with an upgrade CTA.
      • Mission rooms: Uncle Daniel · Viral Reaction · DDB Beauty · DDB
        Fashion · Sponsor Campaigns. Tier-gated AND mission-specific.

    `whop_channel_id` is the chat_feed_* id from Whop. Nullable in Phase
    1 because the Whop channels can be provisioned later; the UI
    surfaces a "Coming soon" state when the id is missing.

    `is_admin_only` flips the room to announcements-mode (read-only for
    members). `is_locked_preview_enabled` controls whether free users
    see a teaser card OR get the room hidden entirely from the listing.
    """

    __tablename__ = "community_channels"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    slug: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    purpose: Mapped[str | None] = mapped_column(String, nullable=True)

    whop_channel_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # 'free' | 'free_paid' | 'paid' | 'paid_admin' — drives the locked/
    # unlocked render. 'free_paid' = open to everyone signed in (the
    # lobby + announcements). 'paid' = solo|pro|agency. 'paid_admin' =
    # paid users + admins can post; everyone else is read-only.
    required_tier: Mapped[str] = mapped_column(String, nullable=False, default="paid")

    business_unit: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    mission_lane: Mapped[str | None] = mapped_column(String, nullable=True)

    is_admin_only: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_locked_preview_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Section drives the grouping in the UI. Free locks the room into
    # the lobby/announcements section; everything else groups by purpose.
    # Values: 'announcements' | 'free_lobby' | 'paid_core' | 'mission'.
    section: Mapped[str] = mapped_column(String, nullable=False, default="mission", index=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class Banner(Base):
    """v0.7.55 — admin-managed promotional placements.

    Renders across the app surfaces listed in `placement`. Per spec:
      earn_hero · mission_card · mission_detail · upgrade_modal ·
      community_top · home_hero · checkout_modal.

    `target_tier` (free | paid | null) gates which audience sees it.
    `target_mission_id` optionally pins the banner to one campaign's
    detail view. `priority` decides which banner wins when multiple are
    eligible (higher number wins).
    """

    __tablename__ = "banners"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    title: Mapped[str] = mapped_column(String, nullable=False)
    subtitle: Mapped[str | None] = mapped_column(String, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String, nullable=True)
    cta_text: Mapped[str | None] = mapped_column(String, nullable=True)
    cta_url: Mapped[str | None] = mapped_column(String, nullable=True)
    # earn_hero | mission_card | mission_detail | upgrade_modal |
    # community_top | home_hero | checkout_modal
    placement: Mapped[str] = mapped_column(String, nullable=False, default="earn_hero", index=True)
    # null = open to every tier · "free" | "paid" — see _is_premium in
    # routes/campaigns.py for tier resolution.
    target_tier: Mapped[str | None] = mapped_column(String, nullable=True)
    target_mission_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class Announcement(Base):
    """v0.7.55 — admin posts surfaced in the Announcements community
    room AND on first-paint of the dashboard. `kind` segments the feed
    so the UI can filter (mission_drop, payout, rule_change, deadline,
    other). `pinned` keeps a row at the top until manually unpinned.
    """

    __tablename__ = "announcements"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    title: Mapped[str] = mapped_column(String, nullable=False)
    body_markdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    # mission_drop | payout | rule_change | deadline | other
    kind: Mapped[str] = mapped_column(String, nullable=False, default="other", index=True)
    cta_text: Mapped[str | None] = mapped_column(String, nullable=True)
    cta_url: Mapped[str | None] = mapped_column(String, nullable=True)
    target_tier: Mapped[str | None] = mapped_column(String, nullable=True)
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # v2.2.9 broadcast layer · severity drives banner tint
    # ("info" → fuchsia, "warning" → amber, "critical" → red). scope
    # decides who sees the row in /sync.active_announcements: "global"
    # → every authed user; "agency" → restricted to agency_id matches
    # (the agency owner themselves + any clipper enrolled in their
    # campaigns, resolved at /sync time). Defaults make every legacy row
    # behave like a global info banner so existing data renders cleanly.
    severity: Mapped[str] = mapped_column(String, nullable=False, default="info", index=True)
    scope: Mapped[str] = mapped_column(String, nullable=False, default="global", index=True)
    agency_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class RewardBonusLedger(Base):
    """v0.7.55 (Uncle Daniel funnel — Phase 1) — premium bonus ledger
    keyed by Whop submission id.

    Whop is the source of truth for: bounty creation, post URL submission,
    bot/fraud detection, view validation, approval/rejection, and the
    base $1 RPM payout. Liquid Clips never re-implements any of that.

    This ledger mirrors approved Whop submissions and tracks ONLY the
    +$4 RPM PREMIUM BONUS due to paid users with no-watermark exports.
    Free users have a row only if we want the audit trail (bonus_due=0
    on those rows). Phase 2 will replace the manual mark-paid with a
    Whop transfer via sub-merchant accounts; the schema doesn't change.

    Distinct from `CampaignSubmission` (which is the older Whop bounty
    proxy that didn't carry tier or bonus liability).
    """

    __tablename__ = "reward_bonus_ledger"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    # Whop side — primary correlation key. Unique because every Whop
    # submission maps to exactly one ledger row.
    whop_submission_id: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    whop_bounty_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    whop_user_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)

    # Liquid Clips side — null when the clipper hasn't connected their
    # Whop account to LC yet (Phase 1 admin can resolve manually).
    liquid_clips_user_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    email: Mapped[str | None] = mapped_column(String, nullable=True)

    # LC campaign correlation — references sponsored_campaigns.id (or .slug).
    campaign_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    mission_lane: Mapped[str | None] = mapped_column(String, nullable=True)

    submitted_post_url: Mapped[str] = mapped_column(String, nullable=False)
    # Whop's lifecycle: pending | claimed | submitted | approved | denied
    # | expired | unclaimed | paid. We only mirror non-pending rows, but
    # the field stays free-form so a new Whop state doesn't break decode.
    whop_status: Mapped[str] = mapped_column(String, nullable=False, default="approved", index=True)

    approved_views: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Snapshot of the user's membership state at the moment Whop approved
    # the submission. Used to lock bonus liability against later changes.
    membership_status_at_export: Mapped[str] = mapped_column(
        String, nullable=False, default="free"
    )
    # true | false | unknown — watermark-free exports are the gate for the
    # premium bonus on certain lanes (e.g. software_proof).
    export_watermark_status: Mapped[str] = mapped_column(
        String, nullable=False, default="unknown"
    )

    # Per-submission RPM snapshot in cents. Locks the rate at mirror time
    # so a campaign edit later doesn't retroactively change what we owe.
    base_rpm_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    premium_bonus_rpm_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Computed payout values in cents.
    # base_payout = approved_views/1000 * base_rpm_cents (paid by Whop).
    # premium_bonus_due = approved_views/1000 * premium_bonus_rpm_cents
    # (paid by LC admin in Phase 1, paid by Whop transfer in Phase 2).
    base_payout_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    premium_bonus_due_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_effective_payout_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # pending | paid | waived
    bonus_payout_status: Mapped[str] = mapped_column(
        String, nullable=False, default="pending", index=True
    )
    bonus_payout_notes: Mapped[str | None] = mapped_column(String, nullable=True)

    bonus_marked_paid_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ledger_created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    ledger_updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )


# ─── v2 · Asset Infrastructure · DORMANT FOR V1 ─────────────────────────
#
# Reserved for the future Drive/Dropbox/ingestion model.
# V1 Campaign assets are BRIEF LINKS (see `CampaignAssetLink` below).
# V1 does NOT touch these tables. Removing forces a future session to
# re-derive the schema from `docs/asset-source-foundation-audit.md`.
#
# Tables:
#   - external_credentials        · per-user OAuth tokens (Drive, Dropbox)
#   - campaign_asset_sources      · per-campaign source attachment + manifest
#   - asset_source_ingestion_jobs · cron queue for re-ingest runs
#
# When create_all runs on deploy these tables get created empty.
# Nothing reads or writes them in v1 · zero v1 risk.
#
# Tokens are encrypted at rest via Fernet (key from EXTERNAL_CREDENTIALS_KEY
# env var). See `app/credentials_crypto.py` for the wrapper · also dormant.
# ────────────────────────────────────────────────────────────────────────


class ExternalCredential(Base):
    """Per-user OAuth credential for an external provider (Drive, Dropbox,
    future Whop user-OAuth). Tokens are stored encrypted at rest; never
    return raw token material to the desktop.

    One row per (user, provider, account) so a user can attach more than
    one Drive account (personal + brand) without overwriting the prior.
    """

    __tablename__ = "external_credentials"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: "ec_" + uuid.uuid4().hex
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String, nullable=False, index=True)
    # provider ∈ {"google_drive", "dropbox", "whop_user"}

    # Encrypted token material · NEVER write the raw token here.
    # See `app/credentials_crypto.py:encrypt_token / decrypt_token`.
    access_token_enc: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    scope: Mapped[str] = mapped_column(String, nullable=False, default="")

    # Display metadata so the desktop can show "you're connected as ..."
    account_label: Mapped[str | None] = mapped_column(String, nullable=True)
    account_email: Mapped[str | None] = mapped_column(String, nullable=True)
    provider_account_id: Mapped[str | None] = mapped_column(
        String, nullable=True, index=True
    )

    status: Mapped[str] = mapped_column(String, nullable=False, default="active", index=True)
    # status ∈ {"active", "expired", "revoked", "error"}
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    last_refreshed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )


# ─── HQ Agent 5 · Recovery Flow ─────────────────────────────────────────
# Break-glass mechanism: if Daniel loses his laptop AND Clerk session AND
# TOTP seed, the recovery flow proves identity via 3-of-5 master emails +
# 6-digit PIN + 8-character auth code (strict path) OR PIN only when the
# caller's IP is in ADMIN_ALLOWED_IPS (fast path). Success re-issues a
# fresh TOTP seed whose hash is persisted on the singleton
# AdminRecoveryConfig row (id=1).
#
# All secret material (pin, auth code, totp seed) is bcrypt-hashed before
# storage. Raw values are NEVER persisted and NEVER logged. The fresh TOTP
# seed is returned ONCE on a successful /verify and never displayed again.
#
# Rate limiting: 3 attempts per IP per 24h. Each attempt (success or fail)
# logs a row to AdminRecoveryAttempt with the failure category — the route
# counts the prior 24h rows for the IP to enforce the cap.


class AdminRecoveryConfig(Base):
    """Singleton row (id=1) holding bcrypt hashes for the recovery PIN,
    auth code, and the most recently issued TOTP seed. The route layer
    upserts the singleton; if id!=1 rows exist (test fixture pollution)
    only id=1 is read."""

    __tablename__ = "admin_recovery_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pin_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    auth_code_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    totp_seed_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_recovery_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )


class AdminRecoveryAttempt(Base):
    """One row per recovery attempt. `result` is the failure category so we
    can audit which gate failed without ever recording raw secrets. The
    route enforces 3-per-24h-per-IP by counting rows where ip == this ip
    and created_at >= now-24h."""

    __tablename__ = "admin_recovery_attempt"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ip: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    # result ∈ {"ok", "fail_emails", "fail_pin", "fail_auth_code", "rate_limited"}
    result: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, index=True
    )



# ─── HQ Agent 3 · Management Gap Mutations ─────────────────────────────
# Persistence backing for the 11 admin mutation endpoints (refund, ban,
# tier-change, agent kill/restart/rotate-key, campaign edit/create/archive,
# recent-sales feed, audit-log query). Every mutation writes one row to
# AdminAuditLog. Agents are managed via AgentPersona (replaces the in-memory
# WhopChatFleet dict for admin-controllable state — the fleet still runs
# from env vars at boot, this table tracks the admin-mutable lifecycle).


class AdminAuditLog(Base):
    """One row per admin mutation attempt — success or failure.

    Source of truth for "what did Daniel (or another admin) do, when, to
    what, and what happened?" Powers the HQ Audit panel. Reads are
    pagination-cheap thanks to the actor_email / action / target_id
    indices.

    `payload_json` is the JSON-serialised request body AFTER secrets
    redaction (`first4 + "..."` for any key containing key/secret/token/
    pin/password/jwt/authorization). Raw secrets NEVER hit this table.

    `result` is "ok" for completed mutations, "error" for refused or
    crashed attempts (with a sanitized `error_message`)."""

    __tablename__ = "admin_audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(60), nullable=False)
    target_id: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    result: Mapped[str] = mapped_column(String(20), nullable=False, default="ok")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, index=True
    )


class AgentPersona(Base):
    """One row per admin-controllable agent persona.

    The Whop chat-agent fleet (app/agents/whop_chat.py) currently runs
    100% from env vars (WHOP_AGENT_KEYS) — its in-memory `WhopChatFleet`
    dict has no DB backing. This table lets HQ flip an individual agent
    on/off, count restarts, and rotate its persona key WITHOUT a Railway
    redeploy.

    `api_key_hash` is the SHA-256 of the most recently rotated key. The
    raw key is returned to the admin ONCE at rotation time and never
    persisted. `api_key_preview` (first4 + '...') is the display form
    surfaced in admin reads.

    `active` flips on `agent.kill` / `agent.restart`. `restart_count`
    bumps on every restart so a flap is visible in the Audit panel.

    The runtime agent loop is NOT yet wired to read this table — that
    handshake lands in a follow-up sprint. For now the table records
    admin intent so the operator UX works while the fleet implementation
    catches up."""

    __tablename__ = "agent_personas"

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    # "whop_chat" | "engagement" | future
    kind: Mapped[str] = mapped_column(String(60), nullable=False, default="whop_chat", index=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    api_key_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    api_key_preview: Mapped[str | None] = mapped_column(String(40), nullable=True)
    restart_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_rotated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )


class CampaignAssetSource(Base):
    """Per-campaign asset-source attachment. Polymorphic by `kind`.

    A Campaign may have N rows (Drive folder + Dropbox file + direct upload
    pack + Whop attachments dump). Each row's manifest is cached separately
    so the ingestion cron can re-pull one without touching the others.
    """

    __tablename__ = "campaign_asset_sources"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: "asrc_" + uuid.uuid4().hex
    )
    # Campaign FK is a string id matching `sponsored_campaigns.id`
    # (the canonical Campaign table per Phase 6N-A). We don't FK it
    # explicitly here because the column may rename during the 6N-A
    # schema delta — the column stays scoped to that table by convention.
    campaign_id: Mapped[str] = mapped_column(String, nullable=False, index=True)

    kind: Mapped[str] = mapped_column(String, nullable=False, index=True)
    # kind ∈ {"drive_folder", "drive_file", "dropbox_folder",
    #         "dropbox_file", "whop_assets", "direct_upload"}

    label: Mapped[str] = mapped_column(String, nullable=False)
    url: Mapped[str] = mapped_column(String, nullable=False)
    external_id: Mapped[str | None] = mapped_column(
        String, nullable=True, index=True
    )

    credential_id: Mapped[str | None] = mapped_column(
        ForeignKey("external_credentials.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Cached manifest computed by the ingestion cron · null until first run.
    manifest_file_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    manifest_total_bytes: Mapped[int | None] = mapped_column(
        BigInteger, nullable=True
    )
    manifest_sample_names: Mapped[list | None] = mapped_column(JSON, nullable=True)
    manifest_cached_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    status: Mapped[str] = mapped_column(
        String, nullable=False, default="pending_link", index=True
    )
    # status ∈ {"pending_link", "ready", "stale", "error"}
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    added_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )


class AssetSourceIngestionJob(Base):
    """One row per ingestion run. The APScheduler cron picks up `queued`
    rows; transitions to `running`; records the outcome.

    Why a separate table:
      - Backpressure · stuck-in-running rows recover via timestamp comparison.
      - Audit · "why is this folder stale?" answers from the row history.
      - Per-source throttling · one job in flight per
        (credential_id, kind) keeps providers happy.
    """

    __tablename__ = "asset_source_ingestion_jobs"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: "aij_" + uuid.uuid4().hex
    )
    asset_source_id: Mapped[str] = mapped_column(
        ForeignKey("campaign_asset_sources.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    status: Mapped[str] = mapped_column(
        String, nullable=False, default="queued", index=True
    )
    # status ∈ {"queued", "running", "ok", "failed", "cancelled"}

    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    files_seen: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bytes_seen: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    triggered_by: Mapped[str] = mapped_column(
        String, nullable=False, default="cron"
    )
    # triggered_by ∈ {"cron", "agency_save", "manual_refresh"}

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, index=True
    )


# ─── Phase 6N-D v1 · Campaign Asset Links ───────────────────────────────
#
# V1 Campaign assets are BRIEF LINKS. Agency pastes a Drive URL,
# Dropbox URL, Whop URL, generic URL, or a free-text upload note.
# Clipper opens the URL externally and follows the brief.
#
# NO OAuth, NO manifest, NO ingestion, NO folder crawl.
# Whatever's on the other end of the URL is governed by the host
# platform's own sharing rules. The backend just stores the row.
#
# Visibility gating is the only smart part:
#   - "all"      · visible to anyone who can see the campaign card
#   - "joined"   · visible after the clipper joins the campaign
#   - "approved" · visible after the clipper has 1+ approved submission
#
# Per-campaign cardinality is small (typically 1-5 rows). Reorder is a
# single bulk endpoint to keep the round-trip count low.
# ────────────────────────────────────────────────────────────────────────


class CampaignAssetLink(Base):
    """Per-campaign asset brief link · v1.

    Agency pastes an external URL. Clipper opens it in their browser.
    Not managed, not ingested.
    """

    __tablename__ = "campaign_asset_links"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: "lnk_" + uuid.uuid4().hex
    )
    # Campaign FK is a string id matching `sponsored_campaigns.id`. Not a
    # hard FK so the Phase 6N-A rename can land without breaking this row.
    campaign_id: Mapped[str] = mapped_column(String, nullable=False, index=True)

    type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    # type ∈ {"google_drive", "dropbox", "whop", "direct_url", "upload_note"}

    title: Mapped[str] = mapped_column(String, nullable=False)
    url: Mapped[str] = mapped_column(String, nullable=False, default="")
    # `url` is empty when type == "upload_note" · the row is then a
    # text-only instruction surface, not a clickable link.
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    visibility: Mapped[str] = mapped_column(
        String, nullable=False, default="all", index=True
    )
    # visibility ∈ {"all", "joined", "approved"}

    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, index=True
    )

    added_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )


# ─── Promo / Discount Codes (2026-06-25) ────────────────────────────────
#
# Influencer / clipper discount-code system. Daniel hands a short code
# (e.g. "FOUNDER25") to a creator; they apply it at sign-up + checkout
# to receive a percent_off discount on their subscription. Codes are
# case-insensitive (stored upper), optionally capped (max_uses) and/or
# time-limited (expires_at), optionally scoped to specific plan slugs.
#
# This is the LIQUID-CLIPS side ledger. The actual discount on Stripe
# subscriptions is applied by creating a Stripe Coupon on first apply
# (id cached in stripe_coupon_id for idempotence). Whop discount codes
# are managed in the Whop dashboard out-of-band — see PromoCodesTab in
# the admin HQ for the static "how to set up the Whop side" reference.
#
# Both tables are created in main.py's lifespan migrations so they
# survive every redeploy.


class PromoCode(Base):
    """Influencer / clipper discount code · admin-issued."""

    __tablename__ = "promo_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False, index=True)  # stored uppercase
    percent_off: Mapped[int] = mapped_column(Integer, nullable=False)  # 1-100
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)  # None = unlimited
    used_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # JSON list of plan slugs (e.g. ["solo","growth"]). Empty list = all plans.
    # Stored as Text so we can round-trip via json.loads/dumps regardless of dialect.
    scopes_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    # Cached on first successful apply so we don't hit Stripe twice.
    stripe_coupon_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str] = mapped_column(String(255), nullable=False)  # admin email
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )


class PromoCodeRedemption(Base):
    """One row per successful promo-code apply on a checkout."""

    __tablename__ = "promo_code_redemptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    promo_code_id: Mapped[int] = mapped_column(
        ForeignKey("promo_codes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Stored as the clerk_user_id string so we don't depend on the local
    # users.id row existing at apply-time (clerk webhook race) and so the
    # admin stats panel can join either way.
    user_id: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # Discount applied in USD cents — admin Stats panel uses this for the
    # "revenue impact" rollup. Snapshotted at apply time so a later
    # percent_off edit doesn't retroactively change the reported impact.
    discount_applied_usd_cents: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0
    )
    applied_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, index=True
    )
