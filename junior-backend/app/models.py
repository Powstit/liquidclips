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
from sqlalchemy import JSON, BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
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

    # 2026-07-03 · Step 2 batch 2b · server-owned platform role. Replaces
    # runtime email-allowlist inference with a persisted authority. Backfilled
    # from ``ADMIN_EMAILS`` in ``main.py`` lifespan. ``none`` for ordinary
    # users; ``staff`` grants SUPPORT_TENANT_READ only; ``admin`` grants HQ +
    # SUPPORT capabilities. The evaluator NEVER reads email at request time in
    # the new code path; the legacy ``is_admin_email`` helper remains only for
    # backfill and one compat release. See ``app/authz/capabilities.py``
    # (``PlatformRole``).
    platform_role: Mapped[str] = mapped_column(
        String, nullable=False, default="none", index=True
    )
    # 2026-07-03 · Step 2 batch 2b · capability schema version stamped into
    # the license JWT at issuance. On every server mutation the wrapper
    # compares this against ``settings.capability_schema_version``; a
    # mismatch returns 409 ``stale_capabilities`` so the desktop refreshes
    # /sync instantly instead of running on stale entitlements after a
    # policy change or downgrade. See ``app/authz/projection.py``.
    capability_schema_version_at_issue: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1
    )

    # Stage 7 · chat-scoped timed mute. Distinct from `banned_until`
    # (global) so a chat mute doesn't leak into publish / earn / license
    # gates. NULL = not muted. A future date = muted until that date;
    # the /chat/message POST route rejects with 403 while this is > now.
    chat_muted_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # v2.2.10 community chat · per-user role override. "member" is the
    # default; admins can elevate a creator to "mod" via the HQ panel.
    # FOUNDER + STAFF badges derive from founder_flag + is_admin_email
    # at message-insert time and are NOT stored here — only the elevated
    # MOD assignment persists on the User row.
    chat_role: Mapped[str] = mapped_column(String, nullable=False, default="member")

    # 2026-07-02 · Sprint G.1 · Kade Reactive Onboarding milestone stream.
    # JSON dict keyed by milestone name (see app/onboarding_milestones.py)
    # → ISO-8601 timestamp of first occurrence. Missing key = milestone
    # not reached; the mark_milestone() helper is idempotent (only writes
    # when the key is currently None). Read by /sync so the desktop
    # emitter can diff local snapshot → fire onboarding:milestone bus
    # events → Kade reacts with a pose. Never written directly by
    # campaign or settings routes — everything flows through the helper
    # to keep the discipline "Kade never fires its own state events."
    onboarding_status: Mapped[dict] = mapped_column(
        JSON, nullable=False, default=dict,
    )

    # v2.2.11 arcade leaderboard · best-ever Space Invaders score. The
    # desktop POSTs to /chat/game/score on each game-over; the route
    # ratchets this value up (never down) so a refresh / replay cannot
    # erase a record. ChatMessageOut surfaces this via a LEFT JOIN at
    # history time so the chat row can paint a 🏆 [score] badge next to
    # the role tag.
    arcade_high_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)

    # v2.2.14 · unified identity handle. Drives EVERYTHING user-facing:
    #   · chat username in #global-lounge (@handle prefix)
    #   · arcade leaderboard entry
    #   · welcome-bot greeting
    #   · affiliate share URL (liquidclips.app/join/<handle>)
    #   · community leaderboard row
    #   · future public profile at liquidclips.app/@<handle>
    # Backfilled from cached_display_handle → email prefix → clipper-<id>
    # on first migration. Unique + case-insensitive (enforced by app
    # layer since Postgres unique indexes are case-sensitive by default).
    handle: Mapped[str | None] = mapped_column(String(60), nullable=True, unique=True, index=True)

    # v2.2.15 · trial-convert-early tracking. Stamped the moment the
    # user clicks "Approve upgrade now" in the one-click modal. Lets
    # /sync return trial_convert_pending=true so the UI shows
    # "Confirming with Whop…" instead of the paywall between click and
    # Whop's charge webhook landing. Cleared on membership_valid
    # webhook fire (tier flips to paid, pending is naturally false).
    trial_convert_approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # v2.2.17 · thumbnail batch quota tracking. Hosted-AI tiers (Pro,
    # Agency) have a monthly cap so cost never runs away. Counter
    # increments on successful batch. Reset happens on the first /sync
    # of a new UTC month · check by comparing to
    # thumbnail_batches_period_start.
    #
    # Boost packs (plan_xLS3gGsJ16455 · Thumbnail Boost Pack $9 · 25
    # batches one-time) top up thumbnail_batches_boost_credit which is
    # consumed AFTER the included monthly quota is exhausted.
    thumbnail_batches_used_this_period: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    thumbnail_batches_period_start: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    thumbnail_batches_boost_credit: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )

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
    # v2.2.11 money-flow channels · surface bounty verdicts + carrot
    # claims + Whop view-payout receipts directly in the desktop inbox
    # so creators see the verdict the instant they boot the app.
    "wallet",
    "bounty",
    "payout",
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


class DeployerBroadcastTick(Base):
    """F6 · Layer 3 · per-send audit row for the Gmail broadcast queue.

    One row per broadcast attempt (sent · failed · captcha-skipped).
    Powers the backend cross-check on the 100-sends-per-24h cap and gives
    an operator a per-target audit trail if a user reports missing sends.

    Deliberately does NOT store the email body — only the target address,
    a status token, and the user + timestamp. Body content stays client-
    side to keep the metadata surface minimal.
    """

    __tablename__ = "deployer_broadcast_ticks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    target_email: Mapped[str] = mapped_column(String, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String, nullable=False, index=True)   # sent | failed | skipped_captcha
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)


class WebhookDeadLetter(Base):
    """Dead-letter row for a webhook that raised after signature verification.

    Layer 1 · reliability sprint · 2026-07-04. When a Whop webhook handler
    raises (transient DB failure, upstream 5xx from Clerk metadata sync, mailer
    outage), we still let the outer handler re-raise so Whop retries — but we
    also record the failed attempt here so an operator (or the retry helper)
    can replay it manually without waiting on Whop's retry cadence.

    Stores the raw payload as JSON so the retry can re-invoke the same handler
    branch with the same shape. Deliberately does NOT dedupe on external_id at
    this table's level — WebhookEvent's UNIQUE index handles idempotency; a
    dead-letter row is a diagnostic + replay artefact only.
    """

    __tablename__ = "webhook_dead_letters"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    event_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    error: Mapped[str] = mapped_column(String, nullable=False)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)
    last_attempted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


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
    visibility_tiers: Mapped[list] = mapped_column(JSON, nullable=False, default=lambda: ["free","solo","pro","agency","agency_solo","agency_whitelabel"])

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


class WalletLedger(Base):
    """G2 · Layer 6 · wallet reconciliation ledger.

    Append-only journal of every credit, debit, and payout that touches a
    user's wallet balance. Sits alongside :class:`RewardBonusLedger`
    (which is Whop-side-of-truth for sponsored-campaign bonus payouts)
    and complements it:

      * ``credit`` — money owed to the user (e.g. 50% MRR from a Whop
        affiliate payment via the ``payment.affiliate`` webhook)
      * ``debit`` — money reversed / clawed back (chargebacks, refunds)
      * ``payout`` — money we've actually sent to the user via Whop's
        native payout API (recorded here so ``compute_balance`` +
        ``compute_pending`` can subtract them)

    Idempotency: a composite index on ``(whop_membership_id,
    period_start, type)`` ensures a Whop webhook that fires twice for
    the same (membership, billing period) never double-credits. The
    ``source`` column carries a human-readable string so the wallet UI
    can render "50% share of MRR from ``@friend``" without a JOIN
    lookup.
    """

    __tablename__ = "wallet_ledger"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "whop_membership_id",
            "period_start",
            "type",
            name="uq_wallet_ledger_dedupe",
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 'credit' | 'debit' | 'payout'. Kept as free-form string so a new
    # verb (e.g. 'reserve') can be added without a migration.
    type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # ISO-4217 code. Whop bills in USD today; kept as a column so a
    # multi-currency payout rail can land without another migration.
    currency: Mapped[str] = mapped_column(String, nullable=False, default="USD")
    # Short human-readable string ("whop_affiliate_mrr_50pct" ·
    # "whop_payout" · "chargeback"). Reads straight into the wallet UI's
    # recent-ledger row.
    source: Mapped[str] = mapped_column(String, nullable=False, default="")

    # Idempotency + reporting keys. Both nullable because manual admin
    # adjustments (e.g. a goodwill credit) don't carry a Whop
    # membership id or a billing period.
    whop_membership_id: Mapped[str | None] = mapped_column(
        String, nullable=True, index=True
    )
    period_start: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    # Payout-only bookkeeping. `next_scheduled_at` marks a credit as due
    # for payout on the next scheduler run; the scheduler flips it to
    # NULL after emitting the payout row. `whop_payout_id` is the id
    # returned by the Whop payout API for auditability.
    next_scheduled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    whop_payout_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, index=True
    )


class AffiliateAgreementSignature(Base):
    """Click-wrap signature receipt for the Liquid Clips Partner &
    Affiliate Agreement.

    Rendered the moment a user first attempts to withdraw commission from
    their wallet. Persisted before the wallet claim endpoint releases any
    funds. Used later as chargeback-defense evidence — the SHA-256 receipt
    is deterministic over the canonical JSON payload, so we can prove to
    a card issuer that the click-action was signed by the KYC-verified
    Whop identity at a specific timestamp.

    Status transitions:
      * ``active``  — normal state after click-acceptance.
      * ``frozen``  — a Whop ``payment.disputed`` webhook has fired for
        this participant. The nightly payout scheduler skips users whose
        signature row is frozen. Set-off logic nets the $50 admin fee
        against pending credit before freezing.
      * ``revoked`` — reserved for future admin-tools use.

    A user re-signs when the platform pushes a contract update with
    ``require_resign=True`` — the new row uses a new ``contract_version``
    string; the older row(s) remain for audit history.
    """

    __tablename__ = "affiliate_agreement_signatures"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "contract_version",
            name="uq_affiliate_agreement_dedupe",
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    contract_version: Mapped[str] = mapped_column(String, nullable=False, index=True)

    # Whop identity captured at click-time. Kept as a snapshot even though
    # ``users.whop_user_id`` should match, because Whop can reassign a
    # user id in edge cases and this row is a legal receipt.
    whop_user_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    kyc_status: Mapped[str] = mapped_column(String, nullable=False, default="VERIFIED_BY_WHOP")

    # 'BUSINESS' | 'INDIVIDUAL' — captured from the radio button above the
    # agreement checkbox. Consumer capacity triggers the extra Section 2
    # acknowledgment paragraph.
    signing_capacity: Mapped[str] = mapped_column(String, nullable=False, default="BUSINESS")

    # Verbatim strings for the chargeback-evidence packet. Truncated
    # server-side so a giant UA can't blow up the row.
    ip_address: Mapped[str | None] = mapped_column(String, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String, nullable=True)

    scroll_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    signature_action: Mapped[str] = mapped_column(
        String, nullable=False, default="EXPLICIT_CLICK_TO_ACCEPT"
    )
    receipt_sha256: Mapped[str] = mapped_column(String, nullable=False, index=True)

    status: Mapped[str] = mapped_column(String, nullable=False, default="active", index=True)
    frozen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    frozen_reason: Mapped[str | None] = mapped_column(String, nullable=True)

    signed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, index=True
    )


class FounderSeat(Base):
    """Task F · Founder Access seat-cap ledger (2026-07-04).

    One row per Founder Access membership granted. The counter is the
    row count; the ``whop_membership_id`` UNIQUE constraint makes the
    grant idempotent so a webhook re-delivery for the same Whop
    membership cannot double-count against the 12,000 cap.

    Whop remains the source of truth for who bought — this table is
    only the local mirror the seat-cap gate reads before issuing tier
    grants. ``user_id`` is nullable because the buyer may pay on Whop
    before signing up on the website (affiliate flow); once they
    connect their account, ``/onboarding/link-whop`` can back-fill.

    The cap constant lives in ``app/routes/founder.py`` alongside the
    ``founder_seats_used()`` helper.
    """

    __tablename__ = "founder_seats"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    whop_membership_id: Mapped[str] = mapped_column(
        String, nullable=False, unique=True, index=True
    )
    plan_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    user_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    whop_user_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, index=True
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

    # 2026-07-03 · Step 2 batch 2b · support-mode audit columns. Populated
    # on every ``/admin/support/*`` call (batch 2D). NULL on legacy mutation
    # rows written before Step 2. ``support_capability`` mirrors the enum
    # value used at the gate (e.g. ``"support.tenant.read"``). The pair
    # (``actor_email``, ``support_ticket_id``, ``created_at``) forms the
    # forensic key when reviewing a support session in HQ.
    support_ticket_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    support_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    support_capability: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    support_expiry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    support_approver_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)


class ArcadeSubmission(Base):
    """2026-07-03 · D · one row per accepted /chat/game/score submit.

    Enables both the anti-cheat plausibility audit trail (wave, duration,
    shots fired at score-time) and the monthly winner selection query.
    Without this table the arcade prize can't be defensibly paid — the
    ``users.arcade_high_score`` column carries no month-scoped ordering
    signal.
    """

    __tablename__ = "arcade_submissions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    score: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    wave: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    shots_fired: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ip: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, index=True
    )


class Feature(Base):
    """2026-07-03 · Step 6 · registry-driven observability.

    ONE row per user-facing feature. HQ auto-generates the feature's
    detail page (endpoints · errors · stuck users · health) from this
    row + its Endpoint children. Adding a feature = INSERT one row +
    N endpoints. No per-feature code in HQ.

    ``owner`` is a free-text handle (email, GH username) — the human
    to nudge when the feature's error rate spikes. ``canary`` gates
    whether the feature ships to Cohort 0 only (Daniel's own account)
    or the wider fleet. ``baseline_error_rate`` self-tunes: alerts
    fire when observed_rate > baseline + 3σ. Bumping the number is
    an HQ mutation, not a code change.
    """

    __tablename__ = "features"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    feature_id: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    journey: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)  # "clipper" | "agency" | "operations" | None
    owner: Mapped[str] = mapped_column(String(120), nullable=False)  # handle / email
    canary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    baseline_error_rate: Mapped[float] = mapped_column(Numeric(6, 4), nullable=False, default=0)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class Endpoint(Base):
    """2026-07-03 · Step 6 · HTTP-layer registry.

    N rows per Feature. HQ health checks + generic tester read this
    table to know which endpoints to exercise for each feature — no
    per-feature test code. ``health_check_body`` is a small JSON
    template hit against staging/prod at cron cadence.

    Adding a new endpoint = INSERT one row. HQ starts monitoring on
    the next cron tick — no deploy.
    """

    __tablename__ = "feature_endpoints"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    feature_id: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    method: Mapped[str] = mapped_column(String(10), nullable=False)  # GET/POST/…
    path_pattern: Mapped[str] = mapped_column(String(400), nullable=False)  # /me · /agency/{id}/roster
    expected_status: Mapped[int] = mapped_column(Integer, nullable=False, default=200)
    expected_error_codes: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    health_check_body: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)


class TelemetryEvent(Base):
    """2026-07-03 · Step 6 · raw Envelope ingestion.

    Every emit() from the Step 5 adapter POSTs an Envelope here.
    Server RE-sanitizes on ingest (belt-and-suspenders — the client
    already sanitized in redact.ts, but a compromised client shouldn't
    be able to bypass the server contract).

    Partitioning-ready: (release, feature_id, created_at) is the
    natural query key for HQ's grouped views. When we scale past
    1M users this table can be partitioned by created_at without a
    schema rewrite because the fields don't reference each other.
    """

    __tablename__ = "telemetry_events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    event: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    feature_id: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    journey_id: Mapped[str | None] = mapped_column(String(20), nullable=True)
    surface: Mapped[str] = mapped_column(String(200), nullable=False)
    route: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    release: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    build: Mapped[str] = mapped_column(String(80), nullable=False)
    environment: Mapped[str] = mapped_column(String(20), nullable=False, index=True)  # dev/prod/qa
    operating_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="self")
    entitlement_class: Mapped[str] = mapped_column(String(20), nullable=False, default="clipper")
    onboarding_state: Mapped[str | None] = mapped_column(String(60), nullable=True)
    actor_kind: Mapped[str] = mapped_column(String(20), nullable=False, default="anon")  # internal|anon
    actor_id: Mapped[str] = mapped_column(String(120), nullable=False)
    correlation_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    session_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    attempt_id: Mapped[str] = mapped_column(String(80), nullable=False)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    failure: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stable_error_code: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    emitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    stored_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)


class DesktopErrorGroup(Base):
    """2026-07-03 · Step 6 · Fingerprint-grouped desktop error dedupe.

    ``fingerprint`` = sha256(release + feature_id + stable_error_code +
    stack fingerprint). When the SAME failure recurs, the existing
    row's counters bump instead of a new row per occurrence. HQ
    displays groups, not raw events — one group = one actionable
    incident.

    Individual occurrences still land in DesktopErrorEvent for the
    per-user trail; DesktopErrorGroup is the aggregate the HQ view
    reads.
    """

    __tablename__ = "desktop_error_groups"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    fingerprint: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    release: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    feature_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    stable_error_code: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    route: Mapped[str | None] = mapped_column(String(200), nullable=True)
    environment: Mapped[str] = mapped_column(String(20), nullable=False, default="dev")
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    affected_user_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    latest_sanitized_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")  # open|acknowledged|resolved|muted


class Agent(Base):
    """2026-07-03 · Step 7.5 · agent registry.

    ONE row per AI agent instance (10 Codex agents = 10 rows). Adding
    capacity = INSERT one row through HQ · zero code deploy. The
    ``provider`` field picks a concrete AgentProvider class at
    dispatch time · ``credential_id`` points at the credential store
    (never a raw key) · ``role`` selects which capability bundle the
    agent runs with (reused from Step 2 closed capability registry).

    Kill switches:
      * global ``LC_AGENTS_ENABLED`` env var (checked at dispatch)
      * per-agent ``enabled`` flag (checked at dispatch)
      * per-role capability revoke via Step 2's PlatformRole/Capability
        machinery (checked inside every action's authz gate)

    Budget: ``daily_credit_cap_cents`` bounds spend per agent per UTC
    day · ``circuit_breaker_state`` auto-flips to ``open`` after N
    consecutive failures on that agent so a broken agent can't burn
    the fleet's budget.
    """

    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    agent_id: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False, index=True)  # anthropic | codex | openai | mock
    role: Mapped[str] = mapped_column(String(80), nullable=False, index=True)  # bug_fixer | user_replier | monitor | ...
    credential_id: Mapped[str] = mapped_column(String(120), nullable=False)  # NEVER a raw key
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    max_concurrent: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    daily_credit_cap_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=1000)  # $10/day default
    circuit_breaker_state: Mapped[str] = mapped_column(String(20), nullable=False, default="closed")  # closed | open | half_open
    consecutive_failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    parent_agent_id: Mapped[str | None] = mapped_column(String(120), nullable=True)  # delegation graph
    owner: Mapped[str] = mapped_column(String(120), nullable=False)  # who to page when it breaks
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AgentAction(Base):
    """2026-07-03 · Step 7.5 · per-action audit row.

    Every dispatch — allowed or denied — writes a row here so HQ can
    review reasoning. Mirrors SupportContext audit discipline from
    Step 2: same "trust but verify" pattern extended to AI actors.

    ``prompt_redacted`` + ``response_redacted`` run through the Step 5
    sanitizer before writing so no email/JWT/token from tool payloads
    can leak into the audit table.
    """

    __tablename__ = "agent_actions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    agent_id: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    action_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)  # bug_fix | user_reply | monitor_probe | ...
    target_user_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    prompt_redacted: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_redacted: Mapped[str | None] = mapped_column(Text, nullable=True)
    tools_called: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    cost_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    elapsed_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    stable_error_code: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    decision_trace_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    correlation_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)


class DeploymentEvent(Base):
    """2026-07-03 · Step 7 · Railway deployment webhook audit row.

    Every Railway deploy fires POST /webhooks/railway with an HMAC-signed
    payload. Verified events land here so the HQ view can correlate
    error spikes with deploys (i.e. "release 2.2.22 deployed at 10:03
    and error group X spiked at 10:05 · rollback"). ``release_sha`` +
    ``service`` are the natural join keys against
    ``telemetry_events.release`` + ``desktop_error_groups.release``.
    """

    __tablename__ = "deployment_events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    deployment_id: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    service: Mapped[str] = mapped_column(String(80), nullable=False, index=True)  # junior-backend | desktop | account-app
    environment: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    release_sha: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)  # started | succeeded | failed | rolled_back
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    raw_payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    signature_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)


class AlertRule(Base):
    """2026-07-03 · Step 7 · self-tuning alert configuration.

    HQ writes rules via the admin route; the alert engine (cron)
    reads this table and fires notifications with dedup + cooldown.
    Adding a new alert = INSERT ONE row. Owner is a free-text handle;
    when the alert fires we notify that owner via the existing
    notifications router.
    """

    __tablename__ = "alert_rules"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    feature_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    condition_kind: Mapped[str] = mapped_column(String(40), nullable=False)  # error_rate | error_count | stuck_users | deployment_failed
    threshold: Mapped[float] = mapped_column(Numeric(10, 4), nullable=False)
    window_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=15)
    cooldown_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    owner: Mapped[str] = mapped_column(String(120), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_fired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)


class MilestoneTransition(Base):
    """2026-07-03 · Step 4 · onboarding state-transition audit row.

    Complements the existing ``User.onboarding_status`` JSON snapshot
    with a per-transition history — needed by the master doc's Step 4
    contract ("Every transition records actor, journey, previous state,
    next state, timestamp, source surface, schema version, and
    idempotency key.").

    The JSON snapshot on User is the fast-read source for /sync; this
    table is the audit trail for HQ + stuck-user diagnostics + resume
    logic. Both live in the same DB so they can't drift.

    ``idempotency_key`` unique constraint stops accidental double-writes
    from the same source surface. A retry with the same key is a no-op.
    """

    __tablename__ = "milestone_transitions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    journey: Mapped[str] = mapped_column(String(20), nullable=False, index=True)  # "clipper" | "agency"
    prev_state: Mapped[str | None] = mapped_column(String(60), nullable=True)
    next_state: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    source_surface: Mapped[str] = mapped_column(String(80), nullable=False)  # "desktop.publish", "agency.roster.invite", ...
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    idempotency_key: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, index=True
    )


class WinnerPayout(Base):
    """2026-07-03 · D · monthly arcade prize dispatch ledger.

    ONE row per month. The ``month`` UNIQUE constraint is the double-pay
    guard — retrying dispatch is idempotent because the second call
    hits the existing row and short-circuits. ``paid_at`` fills only
    after the Whop transfer returns a completed status; a row can
    exist with paid_at=NULL when the winner still needs to onboard
    their Whop sub-merchant.
    """

    __tablename__ = "winner_payouts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    month: Mapped[str] = mapped_column(String(7), unique=True, nullable=False, index=True)  # "2026-07"
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    paid_sub_count_snapshot: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    whop_transfer_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    state: Mapped[str] = mapped_column(String(40), nullable=False, default="pending")  # pending | pending_winner_onboarding | paid | error
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


class ChatMessage(Base):
    """v2.2.10 native community chat. One row per message in our own
    persistence (NOT Whop chat — that path is exposed via the legacy
    community_channels surface and stays as-is). Roles are derived at
    insert time so a tier or admin change does not silently relabel
    history.

    Channels (v1):
      • "global"     — every authed user can read + write
      • "agency-vip" — gated by whop_user_id presence (paid Whop members)

    Pinning bridges into the existing Announcement layer (v2.2.9): a
    pinned message persists here + writes a sibling Announcement row so
    the AnnouncementBanner stack surfaces it as a sticky tinted header.
    The two writes share the same id prefix so the pin can be undone in
    one atomic step.
    """

    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    # Author. "system-bot" is the reserved id for welcome-bot messages
    # and other server-emitted rows. Foreign-key is intentionally NOT
    # declared so a system-bot row survives a user delete.
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    username: Mapped[str] = mapped_column(String, nullable=False, default="Liquid Clipper")
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    # "global" | "agency-vip"
    channel: Mapped[str] = mapped_column(String, nullable=False, default="global", index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # "founder" | "staff" | "mod" | "bot" | "member"
    role: Mapped[str] = mapped_column(String, nullable=False, default="member")
    # Pinned messages bridge into the active_announcements layer so the
    # AnnouncementBanner stack renders them as sticky tinted headers.
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    # Linked Announcement id when pinned == True. Lets unpin undo both
    # rows in one atomic transaction.
    announcement_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, index=True
    )
    # Stage 7 · moderation. Server-side content scrub — when hidden_at
    # is set, `_serialise` in app/routes/chat.py replaces `content` with
    # "[removed by moderator]" and flags `is_removed=true` BEFORE the row
    # ever leaves the API, per doc §690 ("not merely hidden with CSS").
    hidden_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    hidden_by_user_id: Mapped[str | None] = mapped_column(String, nullable=True)
    hide_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


# =====================================================================
# Stage 5 · Agency roster / invite / payout-split / rules
# ---------------------------------------------------------------------
# Owner identity is IMPLIED — an agency is the User row whose id matches
# `agency_id` and whose effective tier resolves to "agency". This
# matches app/routes/sync.py::_agency_ids_for_user which already treats
# users.id as the agency identifier. No separate `agencies` table.
#
# Audit rows are written to `admin_audit_log` (see AdminAuditLog above)
# with target_type ∈ {"agency_member","agency_invite",
# "agency_payout_split","agency_rule","agency_whop_sync"}. No new audit
# table. All owner+staff mutation endpoints call `_audit_agency()` in
# app/routes/agency.py.
# =====================================================================


class AgencyMember(Base):
    """User↔agency membership.

    An agency owner is NOT stored here — owner status is `user.id ==
    agency_id ∧ resolve_tier(user.tier) == "agency"`. Only invited /
    accepted clippers (and mods) get rows.

    Soft delete via `removed_at` so payout-split history stays queryable
    for old rows; the roster + payout-split invariants filter on
    `removed_at IS NULL`.
    """

    __tablename__ = "agency_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Owner user's id. Not a hard FK so agency-owner soft-deletes don't
    # cascade and lose payout history.
    agency_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    role: Mapped[str] = mapped_column(String, nullable=False, default="member")
    # active | disabled — disabled by whop-sync when subscription lapses;
    # payout splits stay intact until the owner explicitly removes.
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")
    invited_by_user_id: Mapped[str | None] = mapped_column(String, nullable=True)
    invited_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    removed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        UniqueConstraint("agency_id", "user_id", name="uq_agency_member"),
    )


class AgencyInvite(Base):
    """Pending invitation issued by an agency owner or staff.

    An invite may precede the invitee's Liquid Clips account — the
    accept endpoint materialises an AgencyMember row when the JWT-
    authenticated user's email matches the invite's `email`. `token`
    is the opaque bearer used in the accept URL / email.

    Terminal states are `accepted | revoked | expired`; once terminal a
    row is not re-usable and a new invite must be issued.
    """

    __tablename__ = "agency_invites"

    id: Mapped[str] = mapped_column(String, primary_key=True)  # uuid.hex
    agency_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    invited_by_user_id: Mapped[str] = mapped_column(String, nullable=False)
    # Lowercased at write time by the route layer so lookups are cheap.
    email: Mapped[str] = mapped_column(String, nullable=False, index=True)
    token: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    role: Mapped[str] = mapped_column(String, nullable=False, default="member")
    # pending | accepted | revoked | expired
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )


class AgencyPayoutSplit(Base):
    """Per-member percent-share of the agency's payout pool.

    Values are stored in BASIS POINTS (1% = 100 bps; 100% = 10_000) so
    the sum-to-100% invariant is checked in integer arithmetic without
    float rounding drift. One row per (agency, member). Sum of active-
    membership splits per agency MUST equal 10_000 after every
    mutation; the write endpoint enforces this with a Pydantic
    validator plus a server-side member-existence check.
    """

    __tablename__ = "agency_payout_splits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agency_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    member_user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    percent_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_by_user_id: Mapped[str] = mapped_column(String, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "agency_id", "member_user_id", name="uq_payout_split"
        ),
    )


class AgencyRule(Base):
    """Key/value config owned by an agency.

    Editable only by the agency owner or staff (JUNIOR_ADMIN_EMAILS).
    Every mutation writes an admin_audit_log row via `_audit_agency()`
    so config drift is fully traceable. `value_json` is opaque to the
    server — the schema is defined client-side per key.
    """

    __tablename__ = "agency_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agency_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    key: Mapped[str] = mapped_column(String, nullable=False)
    value_json: Mapped[str] = mapped_column(Text, nullable=False, default="null")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_by_user_id: Mapped[str] = mapped_column(String, nullable=False)

    __table_args__ = (
        UniqueConstraint("agency_id", "key", name="uq_agency_rule"),
    )
