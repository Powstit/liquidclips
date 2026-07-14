"""Junior Backend entry point.

Locally: `uvicorn app.main:app --reload --port 8000`
Railway: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.cron import start_cron, stop_cron
# 2026-06-24 · Whop chat-agent fleet (Option B · co-hosted async coroutines).
# Defaults to DISABLED via WHOP_AGENT_ENABLED=false · safe to import without
# keys. start_agent_fleet() returns None when disabled, so the lifespan
# block is a no-op until Daniel flips the env.
from app.agents import start_agent_fleet, stop_agent_fleet
from app.db import Base, SessionLocal, engine
from app.routes import admin, admin_alerts_unified, admin_mutations, admin_recovery, affiliate, affiliate_agreement, agency_campaigns, analytics, auth_clerk_exchange, auth_whop, beta_cohort, bonus_ledger, campaign_asset_links, campaigns, canary, carousel, carrot, channels, clip_runs, cold_leads, community, connections, constellation, crew, desktop, doctrine, hq, lc_ids, leaderboard, login_telemetry, me, me_lifetime_views, me_wallet, notifications, onboarding, promo, promo_codes, proxy_anthropic, proxy_llm, publish, redirect, reward_clips, runtime, schedules, social, stripe_connect, submissions, sync, tiktok_verify, transcribe, troubleshoot, updates, usage, webhooks_ayrshare, webhooks_clerk, webhooks_stripe, webhooks_whop, whop, whop_bounty_mirror, whop_payments_proxy

settings = get_settings()

# Sentry — Layer 12 observability (v0.7.34). Init BEFORE FastAPI instantiation
# so the FastAPI integration hooks the ASGI middleware. Empty DSN = no-op.
if settings.sentry_dsn:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        integrations=[
            StarletteIntegration(transaction_style="endpoint"),
            FastApiIntegration(transaction_style="endpoint"),
        ],
        # Don't ship PII to Sentry — user IDs are OK (they're opaque), but we
        # never want request bodies or headers (which may contain JWTs).
        send_default_pii=False,
    )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Auto-create tables locally so the dev loop is fast. Alembic owns schema
    # in production — we drop the create_all once the first migration is in.
    Base.metadata.create_all(bind=engine)
    # No alembic yet: create_all adds missing TABLES but not new COLUMNS on
    # existing tables. Idempotently ensure every column added after a table's
    # first deploy exists in prod (Postgres). ADD COLUMN IF NOT EXISTS is a
    # no-op when the column already exists; NOT NULL columns carry a DEFAULT so
    # they backfill existing rows. Each runs in its own transaction so one
    # failure can't abort the rest. New TABLES (claims, webhook logs, pending
    # memberships, telemetry) are created whole by create_all above.
    import logging as _logging
    from sqlalchemy import text as _text

    _COLUMN_MIGRATIONS = [
        # users — billing / affiliate / whop / starter-pass columns added over time
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS whop_user_id varchar",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS tier varchar NOT NULL DEFAULT 'free'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS founder_flag boolean NOT NULL DEFAULT false",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS affiliate_id varchar",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status varchar NOT NULL DEFAULT 'trial'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_started_at timestamptz NOT NULL DEFAULT now()",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS paid_until timestamptz",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS starter_exports_used integer NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS whop_affiliate_id varchar",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_whop_affiliate_id ON users (whop_affiliate_id) WHERE whop_affiliate_id IS NOT NULL",
        "ALTER TABLE pending_whop_memberships ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT false",
        # Stripe Connect Express — payout rail for non-Whop affiliates.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_connect_account_id varchar",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_stripe_connect_account_id ON users (stripe_connect_account_id) WHERE stripe_connect_account_id IS NOT NULL",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_connect_status varchar NOT NULL DEFAULT 'none'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_connect_payouts_enabled boolean NOT NULL DEFAULT false",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_connect_charges_enabled boolean NOT NULL DEFAULT false",
        # v0.7.34 — Ayrshare 429 backoff. Set to a future timestamp when
        # Ayrshare rate-limits us; reconcile/publish callers skip the API
        # call while now() < this value. Cleared (set NULL) on the next
        # successful Ayrshare response from that user.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS ayrshare_backoff_until timestamptz",
        # schedules — retry policy + postiz result columns added after it shipped
        "ALTER TABLE schedules ADD COLUMN IF NOT EXISTS status varchar NOT NULL DEFAULT 'pending'",
        "ALTER TABLE schedules ADD COLUMN IF NOT EXISTS postiz_post_id varchar",
        "ALTER TABLE schedules ADD COLUMN IF NOT EXISTS post_url varchar",
        "ALTER TABLE schedules ADD COLUMN IF NOT EXISTS error text",
        "ALTER TABLE schedules ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0",
        "ALTER TABLE schedules ADD COLUMN IF NOT EXISTS next_retry_at timestamptz",
        # P2 — tier matrix v2 (Free / Solo / Pro / Agency + prepaid packs).
        # IP captured at signup gates the 100-clip free quota across all
        # accounts on that IP. clips_created is the canonical counter (was
        # starter_exports_used). active_at tracks the 2,000-user threshold
        # for the Founder flash-sale unlock.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS ip_address varchar",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS clips_created integer NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS active_at timestamptz",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_accounts_purchased integer NOT NULL DEFAULT 0",
        # 2026-06-24 · carrot rail · Whop sub-merchant id (for transfers.create
        # destination_id) + onboarding status (pending|onboarded|rejected) +
        # lifetime payout ledger (cents) + last_claim_at for idempotence checks.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS whop_sub_merchant_id varchar",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_whop_sub_merchant_id ON users (whop_sub_merchant_id) WHERE whop_sub_merchant_id IS NOT NULL",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS whop_sub_merchant_status varchar NOT NULL DEFAULT 'none'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS carrot_total_paid_usd_cents bigint NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS carrot_last_claim_at timestamptz",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS llm_usage_month varchar",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS llm_tokens_used integer NOT NULL DEFAULT 0",
        # Control Tower #1 · 2026-07-09 — hosted Anthropic clip-judge dollar
        # quota (cents). Shares llm_usage_month for monthly rollover.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS hosted_ai_usd_cents_used integer NOT NULL DEFAULT 0",
        # Earnings leaderboard cache (sprint #14a). Refreshed every 6h by
        # app/cron.py:_refresh_affiliate_cache_tick. Read by routes/leaderboard.py.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS cached_lifetime_earnings_usd numeric(10,2) NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS cached_paid_referrals integer NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS cached_display_handle varchar",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS cached_earnings_at timestamptz",
        "CREATE INDEX IF NOT EXISTS ix_users_cached_earnings ON users (cached_lifetime_earnings_usd DESC) WHERE cached_lifetime_earnings_usd > 0",
        "CREATE INDEX IF NOT EXISTS ix_users_ip_address ON users (ip_address) WHERE ip_address IS NOT NULL",
        # Partner Engine (LiquidClips-Partner-Engine.md). The YT-Partner-style
        # ladder: clip bounties (open) → dedicated TikTok ($10 RPM) → Partner
        # campaign access at 10 paid referrals + verified dedicated account.
        # referred_paid_subs is incremented by webhooks_whop._handle_payment_succeeded
        # on the first trial→paid transition (and decremented on invalid/refund).
        # Affiliate commission qualification is a separate 2-referral/7-day
        # service; these fields remain adjacent for migration compatibility.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_paid_subs integer NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS whop_affiliate_code varchar",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_whop_affiliate_code ON users (whop_affiliate_code) WHERE whop_affiliate_code IS NOT NULL",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS first_paid_at timestamptz",
        "CREATE INDEX IF NOT EXISTS ix_users_first_paid_at ON users (first_paid_at) WHERE first_paid_at IS NOT NULL",
        "UPDATE users SET first_paid_at = COALESCE(trial_started_at, created_at) WHERE subscription_status = 'active' AND first_paid_at IS NULL",
        # 2026-07-06 · Whop-authorization ($1 card-on-file trust wall · Gate 1
        # of ransom-paywall architecture · plan_SMaXhQLXpSOaH).
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS whop_authorized_at timestamptz",
        # 2026-07-07 · Whop company id · needed for BOUNTY_CREATE openWhopAction
        # url on the Agency Campaigns page (Sprint Final §1C · Max Lane 2).
        # Populated from the user.company_id field on membership.went_valid.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS whop_company_id varchar(80)",
        "CREATE INDEX IF NOT EXISTS ix_users_whop_company_id ON users (whop_company_id) WHERE whop_company_id IS NOT NULL",
        # 2026-07-07 · system_flags · key-value store for launch dials
        # (canary %, killswitches, reconciler drift counter). Per-key
        # updates via UPSERT · read paths cache in-process.
        """CREATE TABLE IF NOT EXISTS system_flags (
            key varchar(120) PRIMARY KEY,
            value text NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now()
        )""",
        # 2026-07-07 · beta cohort · early partners with higher revenue
        # split. Sprint Final §1I · pre-canary trust circle.
        """CREATE TABLE IF NOT EXISTS beta_partners (
            id serial PRIMARY KEY,
            email varchar(200) NOT NULL UNIQUE,
            handle varchar(80),
            invited_at timestamptz NOT NULL DEFAULT now(),
            activated_at timestamptz,
            revenue_split_multiplier numeric(4,2) NOT NULL DEFAULT 2.0,
            invite_code varchar(24) UNIQUE,
            notes text,
            active boolean NOT NULL DEFAULT true,
            feedback_count integer NOT NULL DEFAULT 0
        )""",
        "CREATE INDEX IF NOT EXISTS ix_beta_partners_active ON beta_partners (active) WHERE active",
        """CREATE TABLE IF NOT EXISTS beta_feedback (
            id serial PRIMARY KEY,
            partner_id integer NOT NULL REFERENCES beta_partners(id) ON DELETE CASCADE,
            body text NOT NULL,
            category varchar(40) NOT NULL DEFAULT 'general',
            created_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_beta_feedback_partner ON beta_feedback (partner_id)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS tiktok_handle varchar",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS tiktok_verification_code varchar",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS tiktok_verified_at timestamptz",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS partner_unlocked_at timestamptz",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS whop_commission_override_id varchar",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS affiliate_qualified_at timestamptz",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS affiliate_commission_override_ids jsonb NOT NULL DEFAULT '[]'::jsonb",
        # 2026-07-02 · Sprint G.1 · Kade Reactive Onboarding milestone stream.
        # JSON dict keyed by milestone name → ISO-8601 timestamp of first
        # occurrence. Idempotent — the mark_milestone helper only writes when
        # the key is currently None. Read by /sync so the desktop emitter
        # can diff, fire the onboarding:milestone bus event, and let Kade
        # react with a pose. NOT NULL default '{}' so every existing user
        # row lands with an empty stream on the first read (no migration
        # noise, no NULL-vs-empty ambiguity in the JSON diff).
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_status jsonb NOT NULL DEFAULT '{}'::jsonb",
        # Legacy tier rename — "channel" was the 0.4.x name for what is now "pro"
        # in the v2 matrix. Idempotent because rerun affects zero rows after first pass.
        "UPDATE users SET tier = 'pro' WHERE tier = 'channel'",
        # Backfill stripe_connect_* NULLs that crept in pre-migration. The
        # NOT NULL DEFAULT 'none' only applies to NEW rows; rows created
        # before the ALTER ran can have NULL. Pydantic then 500s on /status.
        "UPDATE users SET stripe_connect_status = 'none' WHERE stripe_connect_status IS NULL",
        "UPDATE users SET stripe_connect_payouts_enabled = false WHERE stripe_connect_payouts_enabled IS NULL",
        "UPDATE users SET stripe_connect_charges_enabled = false WHERE stripe_connect_charges_enabled IS NULL",
        # P1 — Ayrshare replaces Postiz. social_connections lives alongside the
        # legacy postiz_connections table (which becomes inert). One row per
        # Junior user; profile_key is opaque to us, returned by Ayrshare on
        # link. connected_platforms is a JSON array of strings (tiktok, etc).
        """CREATE TABLE IF NOT EXISTS social_connections (
            user_id varchar PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            ayrshare_profile_key varchar NOT NULL,
            connected_platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
            active boolean NOT NULL DEFAULT true,
            connected_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )""",
        # Schedule v2 — multi-channel scheduling. social_channels replaces the
        # single-row social_connections model. Each row = one Ayrshare sub-
        # profile = one platform handle. Users add channels one at a time.
        """CREATE TABLE IF NOT EXISTS social_channels (
            id varchar PRIMARY KEY,
            user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            label varchar NOT NULL,
            platform varchar NOT NULL,
            ayrshare_profile_key varchar NOT NULL UNIQUE,
            ayrshare_ref_id varchar,
            handle varchar,
            status varchar NOT NULL DEFAULT 'pending_link',
            last_refreshed_at timestamptz,
            total_posts integer NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (user_id, label)
        )""",
        "CREATE INDEX IF NOT EXISTS ix_social_channels_user ON social_channels (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_social_channels_status ON social_channels (status)",
        # TikTok-hardening observability — every refresh/create/relink stamps
        # last_probe_at + the soft error (NULL on success). link_attempts ticks
        # on every fresh link URL mint so we can see in prod how many OAuth
        # round-trips a user takes to land a working channel.
        "ALTER TABLE social_channels ADD COLUMN IF NOT EXISTS last_probe_at timestamptz",
        "ALTER TABLE social_channels ADD COLUMN IF NOT EXISTS last_probe_error varchar",
        "ALTER TABLE social_channels ADD COLUMN IF NOT EXISTS link_attempts integer NOT NULL DEFAULT 0",
        # ship-lens v0.7.8 P1 — stamp when a channel.unlinked webhook flips
        # the row to 'unlinked'. Distinguishes platform-side revoke (TikTok
        # expired my token) from user-side never-linked (pending_link) so
        # the UI can show the right copy ("Disconnected — reconnect" vs.
        # "Finish linking"). New column, NULL on legacy rows.
        "ALTER TABLE social_channels ADD COLUMN IF NOT EXISTS last_unlinked_at timestamptz",
        # schedules extended for channel_id + caption_override + Ayrshare ids
        "ALTER TABLE schedules ADD COLUMN IF NOT EXISTS channel_id varchar REFERENCES social_channels(id) ON DELETE SET NULL",
        "ALTER TABLE schedules ADD COLUMN IF NOT EXISTS caption_override text",
        "ALTER TABLE schedules ADD COLUMN IF NOT EXISTS ayrshare_scheduled_post_id varchar",
        "ALTER TABLE schedules ADD COLUMN IF NOT EXISTS actual_post_url varchar",
        "CREATE INDEX IF NOT EXISTS ix_schedules_channel ON schedules (channel_id)",
        "ALTER TABLE schedules ALTER COLUMN platform DROP NOT NULL",
        # post_analytics — refreshed by cron every 30 min for the last 90 days
        # of published rows. Views is bigint because viral can hit >2.1B.
        """CREATE TABLE IF NOT EXISTS post_analytics (
            schedule_id varchar PRIMARY KEY REFERENCES schedules(id) ON DELETE CASCADE,
            channel_id varchar NOT NULL REFERENCES social_channels(id) ON DELETE CASCADE,
            platform varchar NOT NULL,
            views bigint NOT NULL DEFAULT 0,
            likes integer NOT NULL DEFAULT 0,
            comments integer NOT NULL DEFAULT 0,
            shares integer NOT NULL DEFAULT 0,
            saves integer NOT NULL DEFAULT 0,
            engagement_rate numeric(5,2),
            refreshed_at timestamptz NOT NULL DEFAULT now(),
            raw_payload jsonb
        )""",
        "CREATE INDEX IF NOT EXISTS ix_post_analytics_channel ON post_analytics (channel_id)",
        "CREATE INDEX IF NOT EXISTS ix_post_analytics_refreshed ON post_analytics (refreshed_at)",
        # v0.7.55 (Uncle Daniel funnel — Phase 1) — sponsored_campaigns
        # tier-aware payout columns + mission classification + Whop linkage.
        # All nullable / default-zero so existing rows survive without seed.
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS base_rpm_cents integer NOT NULL DEFAULT 0",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS premium_rpm_cents integer NOT NULL DEFAULT 0",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS premium_bonus_cents integer NOT NULL DEFAULT 0",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS free_banner_text varchar",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS premium_banner_text varchar",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS mission_type varchar",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS mission_lane varchar",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS requires_membership boolean NOT NULL DEFAULT false",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS watermark_allowed boolean NOT NULL DEFAULT true",
        # 2026-07-05 · Per-campaign agency watermark overlay config.
        # NULL = default Liquid Clips watermark. See SponsoredCampaign.
        # watermark_overlay_config docstring for the JSON shape.
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS watermark_overlay_config jsonb",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS whop_campaign_id varchar",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS whop_campaign_url varchar",
        "CREATE INDEX IF NOT EXISTS ix_sponsored_campaigns_mission_type ON sponsored_campaigns (mission_type)",
        # ─── Phase 6N-E · Whop reward connection ──────────────────────
        # New columns for the canonical reward-source-of-truth model.
        # `whop_reward_id` / `whop_reward_url` carry the renamed semantics;
        # the legacy `whop_campaign_id` / `_url` columns stay for one
        # release as fallback reads, then drop in a follow-up.
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS whop_reward_id varchar",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS whop_reward_url varchar",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS whop_reward_snapshot jsonb",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS whop_reward_snapshot_business_goal varchar",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS whop_reward_snapshot_bounty_type varchar",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS whop_reward_synced_at timestamptz",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS whop_reward_last_error text",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS whop_reward_state varchar",
        # 6N-E correction patch · URL-first enrichment state tag
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS whop_reward_snapshot_status varchar NOT NULL DEFAULT 'not_attempted'",
        "CREATE INDEX IF NOT EXISTS ix_sponsored_campaigns_whop_reward_snapshot_status ON sponsored_campaigns (whop_reward_snapshot_status)",
        # `campaign_type` discriminator (clip / coordination / affiliate /
        # submission). Default 'clip' so legacy rows pass the not-null
        # gate during the migration window.
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS campaign_type varchar NOT NULL DEFAULT 'clip'",
        # Agency identity. NULL on legacy rows; future agency creation
        # flow writes the user id.
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS created_by varchar",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT ''",
        "CREATE INDEX IF NOT EXISTS ix_sponsored_campaigns_whop_reward_id ON sponsored_campaigns (whop_reward_id)",
        "CREATE INDEX IF NOT EXISTS ix_sponsored_campaigns_whop_reward_synced ON sponsored_campaigns (whop_reward_synced_at)",
        "CREATE INDEX IF NOT EXISTS ix_sponsored_campaigns_whop_reward_state ON sponsored_campaigns (whop_reward_state)",
        "CREATE INDEX IF NOT EXISTS ix_sponsored_campaigns_campaign_type ON sponsored_campaigns (campaign_type)",
        # Backfill: copy legacy whop_campaign_id → whop_reward_id where
        # the latter is null. Idempotent (NULL guard).
        "UPDATE sponsored_campaigns SET whop_reward_id = whop_campaign_id WHERE whop_reward_id IS NULL AND whop_campaign_id IS NOT NULL",
        "UPDATE sponsored_campaigns SET whop_reward_url = whop_campaign_url WHERE whop_reward_url IS NULL AND whop_campaign_url IS NOT NULL",
        # reward_bonus_ledger — Phase 1 premium bonus tracker. Whop owns
        # the submission flow + base $1 RPM payout; this ledger mirrors
        # approved Whop submissions and tracks the +$4 RPM bonus due to
        # paid users. Keyed by whop_submission_id (unique). Phase 2 will
        # flip the mark-paid action to a Whop transfer; schema unchanged.
        """CREATE TABLE IF NOT EXISTS reward_bonus_ledger (
            id varchar PRIMARY KEY,
            whop_submission_id varchar NOT NULL UNIQUE,
            whop_bounty_id varchar,
            whop_user_id varchar,
            liquid_clips_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
            email varchar,
            campaign_id varchar,
            mission_lane varchar,
            submitted_post_url varchar NOT NULL,
            whop_status varchar NOT NULL DEFAULT 'approved',
            approved_views integer NOT NULL DEFAULT 0,
            membership_status_at_export varchar NOT NULL DEFAULT 'free',
            export_watermark_status varchar NOT NULL DEFAULT 'unknown',
            base_rpm_cents integer NOT NULL DEFAULT 0,
            premium_bonus_rpm_cents integer NOT NULL DEFAULT 0,
            base_payout_cents integer NOT NULL DEFAULT 0,
            premium_bonus_due_cents integer NOT NULL DEFAULT 0,
            total_effective_payout_cents integer NOT NULL DEFAULT 0,
            bonus_payout_status varchar NOT NULL DEFAULT 'pending',
            bonus_payout_notes varchar,
            bonus_marked_paid_at timestamptz,
            ledger_created_at timestamptz NOT NULL DEFAULT now(),
            ledger_updated_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_reward_bonus_ledger_lcuser ON reward_bonus_ledger (liquid_clips_user_id)",
        "CREATE INDEX IF NOT EXISTS ix_reward_bonus_ledger_campaign ON reward_bonus_ledger (campaign_id)",
        "CREATE INDEX IF NOT EXISTS ix_reward_bonus_ledger_status ON reward_bonus_ledger (bonus_payout_status)",
        "CREATE INDEX IF NOT EXISTS ix_reward_bonus_ledger_whop_bounty ON reward_bonus_ledger (whop_bounty_id)",
        # 2026-07-04 · G2 · Layer 6 · wallet reconciliation ledger.
        # Append-only journal keyed by (whop_membership_id, period_start,
        # type) so a webhook re-delivery for the same (membership,
        # billing period) never double-credits. next_scheduled_at drives
        # the nightly payout cron.
        """CREATE TABLE IF NOT EXISTS wallet_ledger (
            id varchar PRIMARY KEY,
            user_id varchar NOT NULL,
            type varchar NOT NULL,
            amount_cents integer NOT NULL DEFAULT 0,
            currency varchar NOT NULL DEFAULT 'USD',
            source varchar NOT NULL DEFAULT '',
            whop_membership_id varchar,
            period_start timestamptz,
            next_scheduled_at timestamptz,
            whop_payout_id varchar,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_wallet_ledger_dedupe UNIQUE (
                user_id, whop_membership_id, period_start, type
            )
        )""",
        "CREATE INDEX IF NOT EXISTS ix_wallet_ledger_user ON wallet_ledger (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_wallet_ledger_type ON wallet_ledger (type)",
        "CREATE INDEX IF NOT EXISTS ix_wallet_ledger_whop_membership ON wallet_ledger (whop_membership_id)",
        "CREATE INDEX IF NOT EXISTS ix_wallet_ledger_period_start ON wallet_ledger (period_start)",
        "CREATE INDEX IF NOT EXISTS ix_wallet_ledger_next_scheduled ON wallet_ledger (next_scheduled_at)",
        "CREATE INDEX IF NOT EXISTS ix_wallet_ledger_whop_payout ON wallet_ledger (whop_payout_id)",
        "CREATE INDEX IF NOT EXISTS ix_wallet_ledger_created ON wallet_ledger (created_at)",
        # 2026-07-04 · Task F · Founder Access seat-cap ledger.
        # UNIQUE(whop_membership_id) makes seat grants idempotent under
        # webhook retry. Counter = row count · read by
        # ``app/routes/founder.py founder_seats_used()``.
        """CREATE TABLE IF NOT EXISTS founder_seats (
            id varchar PRIMARY KEY,
            whop_membership_id varchar NOT NULL UNIQUE,
            plan_id varchar NOT NULL,
            user_id varchar,
            whop_user_id varchar,
            granted_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_founder_seats_plan ON founder_seats (plan_id)",
        "CREATE INDEX IF NOT EXISTS ix_founder_seats_user ON founder_seats (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_founder_seats_whop_user ON founder_seats (whop_user_id)",
        "CREATE INDEX IF NOT EXISTS ix_founder_seats_granted ON founder_seats (granted_at)",
        # v0.7.55 (community architecture) — sponsored_campaigns gains 7
        # columns for channel binding + brand metadata + funnel flags.
        # All nullable / default false so existing rows survive untouched.
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS brand_name varchar",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS business_unit varchar",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS required_tier varchar",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS community_channel_id varchar",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS affiliate_enabled boolean NOT NULL DEFAULT false",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS is_high_rpm boolean NOT NULL DEFAULT false",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS is_invite_only boolean NOT NULL DEFAULT false",
        "CREATE INDEX IF NOT EXISTS ix_sponsored_campaigns_brand ON sponsored_campaigns (brand_name)",
        "CREATE INDEX IF NOT EXISTS ix_sponsored_campaigns_business_unit ON sponsored_campaigns (business_unit)",
        "CREATE INDEX IF NOT EXISTS ix_sponsored_campaigns_channel ON sponsored_campaigns (community_channel_id)",
        # community_channels — tier-gated rooms with locked-preview support.
        # whop_channel_id nullable in Phase 1 (rooms can be created on the
        # LC side before the Whop chat feed exists). is_admin_only =
        # announcements-mode (read-only for members). section drives the
        # UI grouping: announcements | free_lobby | paid_core | mission.
        """CREATE TABLE IF NOT EXISTS community_channels (
            id varchar PRIMARY KEY,
            slug varchar NOT NULL UNIQUE,
            name varchar NOT NULL,
            purpose varchar,
            whop_channel_id varchar,
            required_tier varchar NOT NULL DEFAULT 'paid',
            business_unit varchar,
            mission_lane varchar,
            is_admin_only boolean NOT NULL DEFAULT false,
            is_locked_preview_enabled boolean NOT NULL DEFAULT true,
            section varchar NOT NULL DEFAULT 'mission',
            sort_order integer NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_community_channels_section ON community_channels (section)",
        "CREATE INDEX IF NOT EXISTS ix_community_channels_business ON community_channels (business_unit)",
        "CREATE INDEX IF NOT EXISTS ix_community_channels_sort ON community_channels (sort_order)",
        # v0.7.55 (admin mission control) — banners + announcements.
        # `placement` enum + priority drives which banner wins per surface.
        """CREATE TABLE IF NOT EXISTS banners (
            id varchar PRIMARY KEY,
            title varchar NOT NULL,
            subtitle varchar,
            image_url varchar,
            cta_text varchar,
            cta_url varchar,
            placement varchar NOT NULL DEFAULT 'earn_hero',
            target_tier varchar,
            target_mission_id varchar,
            priority integer NOT NULL DEFAULT 0,
            starts_at timestamptz,
            ends_at timestamptz,
            is_active boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_banners_placement ON banners (placement)",
        "CREATE INDEX IF NOT EXISTS ix_banners_mission ON banners (target_mission_id)",
        # Announcements table — Whop channel posts originate here so we
        # have a write-side ledger even when the chat feed is not yet
        # provisioned. body_markdown is rendered client-side.
        """CREATE TABLE IF NOT EXISTS announcements (
            id varchar PRIMARY KEY,
            title varchar NOT NULL,
            body_markdown text,
            kind varchar NOT NULL DEFAULT 'other',
            cta_text varchar,
            cta_url varchar,
            target_tier varchar,
            pinned boolean NOT NULL DEFAULT false,
            published_at timestamptz,
            is_active boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_announcements_kind ON announcements (kind)",
        "CREATE INDEX IF NOT EXISTS ix_announcements_pinned ON announcements (pinned)",
        # HQ Agent 3 · Management Gap mutations (2026-06-24).
        # users.banned_until — NULL = not banned. Far-future date = indefinite.
        # Read by license-mint + Earn/Publish gates in a follow-up. The column
        # lands here so the /admin/mutations/users/{id}/ban endpoint can write
        # to it without a separate ALTER round-trip.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_until timestamptz",
        "CREATE INDEX IF NOT EXISTS ix_users_banned_until ON users (banned_until) WHERE banned_until IS NOT NULL",
        # admin_audit_log — one row per admin mutation (success or failure).
        # payload_json stores the REDACTED request body (secrets → first4+...).
        # Indexed on actor_email + action + target_id so the Audit panel can
        # filter cheaply. created_at index for the default time-window scan.
        """CREATE TABLE IF NOT EXISTS admin_audit_log (
            id bigserial PRIMARY KEY,
            actor_email varchar(255) NOT NULL,
            action varchar(120) NOT NULL,
            target_type varchar(60) NOT NULL,
            target_id varchar(120) NOT NULL,
            payload_json text NOT NULL DEFAULT '{}',
            result varchar(20) NOT NULL DEFAULT 'ok',
            error_message text,
            created_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_admin_audit_log_actor ON admin_audit_log (actor_email)",
        "CREATE INDEX IF NOT EXISTS ix_admin_audit_log_action ON admin_audit_log (action)",
        "CREATE INDEX IF NOT EXISTS ix_admin_audit_log_target ON admin_audit_log (target_id)",
        "CREATE INDEX IF NOT EXISTS ix_admin_audit_log_created ON admin_audit_log (created_at)",
        # agent_personas — admin-controllable lifecycle for the Whop chat-agent
        # fleet. The runtime fleet (app/agents/whop_chat.py) still boots from
        # WHOP_AGENT_KEYS env; this table tracks active/restart/key-rotation
        # state so HQ can mutate the lifecycle without a redeploy. The runtime
        # ↔ table handshake lands in a follow-up sprint.
        """CREATE TABLE IF NOT EXISTS agent_personas (
            id varchar(120) PRIMARY KEY,
            label varchar(120) NOT NULL,
            kind varchar(60) NOT NULL DEFAULT 'whop_chat',
            active boolean NOT NULL DEFAULT true,
            api_key_hash varchar(128),
            api_key_preview varchar(40),
            restart_count integer NOT NULL DEFAULT 0,
            last_rotated_at timestamptz,
            notes text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_agent_personas_kind ON agent_personas (kind)",
        "CREATE INDEX IF NOT EXISTS ix_agent_personas_active ON agent_personas (active)",
        # HQ Agent 5 · Admin Recovery (break-glass identity proof).
        # `admin_recovery_config` is a singleton (id=1) holding bcrypt hashes
        # for the PIN, auth code, and most-recently-issued TOTP seed. Raw
        # values are never stored. `admin_recovery_attempt` is the audit log
        # used by the rate limiter (3 attempts per IP per 24h).
        """CREATE TABLE IF NOT EXISTS admin_recovery_config (
            id integer PRIMARY KEY,
            pin_hash varchar(255),
            auth_code_hash varchar(255),
            totp_seed_hash varchar(255),
            last_recovery_at timestamptz,
            updated_at timestamptz NOT NULL DEFAULT now()
        )""",
        """CREATE TABLE IF NOT EXISTS admin_recovery_attempt (
            id bigserial PRIMARY KEY,
            ip varchar(80) NOT NULL,
            result varchar(20) NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_admin_recovery_attempt_ip ON admin_recovery_attempt (ip)",
        "CREATE INDEX IF NOT EXISTS ix_admin_recovery_attempt_created ON admin_recovery_attempt (created_at)",
        # 2026-06-25 · Promo / discount-code system. Two tables:
        #   • promo_codes — admin-issued codes (PromoCode model)
        #   • promo_code_redemptions — one row per successful apply
        # Idempotent so re-run on every redeploy is a no-op once tables exist.
        """CREATE TABLE IF NOT EXISTS promo_codes (
            id serial PRIMARY KEY,
            code varchar(40) NOT NULL UNIQUE,
            percent_off integer NOT NULL,
            max_uses integer,
            used_count integer NOT NULL DEFAULT 0,
            scopes_json text NOT NULL DEFAULT '[]',
            stripe_coupon_id varchar(120),
            revoked_at timestamptz,
            expires_at timestamptz,
            created_by varchar(255) NOT NULL,
            notes text,
            created_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_promo_codes_code ON promo_codes (code)",
        """CREATE TABLE IF NOT EXISTS promo_code_redemptions (
            id serial PRIMARY KEY,
            promo_code_id integer NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
            user_id varchar(120) NOT NULL,
            stripe_subscription_id varchar(120),
            discount_applied_usd_cents bigint NOT NULL DEFAULT 0,
            applied_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_promo_code_redemptions_promo ON promo_code_redemptions (promo_code_id)",
        "CREATE INDEX IF NOT EXISTS ix_promo_code_redemptions_user ON promo_code_redemptions (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_promo_code_redemptions_applied ON promo_code_redemptions (applied_at)",
        # ─── 2026-06-25 · Runtime Update v1 · Phase 1 ──────────────────
        # Frontend bundle manifest. The desktop shell hits /runtime/manifest.json
        # on boot; the ship_lens_verdict gate prevents an active user ever
        # downloading a bundle the reviewer subagent marked broken.
        # See docs/lc2/RUNTIME_UPDATE_ARCHITECTURE.md §13.
        """CREATE TABLE IF NOT EXISTS runtime_manifests (
            version varchar(64) PRIMARY KEY,
            channel varchar(32) NOT NULL DEFAULT 'stable',
            sha256 varchar(64) NOT NULL,
            signature text NOT NULL,
            file varchar(255) NOT NULL,
            notes text NOT NULL DEFAULT '',
            pub_date timestamptz NOT NULL DEFAULT now(),
            ship_lens_verdict varchar(16) NOT NULL DEFAULT 'PENDING',
            ship_lens_review_url text,
            promoted_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_runtime_manifests_channel_verdict ON runtime_manifests (channel, ship_lens_verdict, pub_date DESC)",
        # ─── 2026-07-08 · Desktop backend-owned OTP · Recovery brief P0 ──
        # Daniel-mandated simple email→code→JWT flow. Table stores the
        # sha256 hash of each code with a 10-min TTL. Single-use.
        """CREATE TABLE IF NOT EXISTS desktop_auth_codes (
            id serial PRIMARY KEY,
            email varchar(200) NOT NULL,
            code_hash varchar(80) NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            expires_at timestamptz NOT NULL,
            consumed_at timestamptz,
            attempt_count integer NOT NULL DEFAULT 0
        )""",
        "CREATE INDEX IF NOT EXISTS ix_desktop_auth_codes_email_created ON desktop_auth_codes (email, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_desktop_auth_codes_email_active ON desktop_auth_codes (email, expires_at) WHERE consumed_at IS NULL",
        # v2.2.9 broadcast layer — extend the existing announcements table
        # with severity + scope + agency_id so /sync can fan out global
        # alerts AND agency-scoped messages without a parallel table.
        "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS severity varchar NOT NULL DEFAULT 'info'",
        "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS scope varchar NOT NULL DEFAULT 'global'",
        "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS agency_id varchar",
        "CREATE INDEX IF NOT EXISTS ix_announcements_scope_agency ON announcements (scope, agency_id, is_active)",
        # v2.2.10 native chat persistence (separate from Whop chat feeds
        # routed via community_channels). user_id is intentionally NOT a
        # FK so a system-bot row survives a real user being deleted.
        """CREATE TABLE IF NOT EXISTS chat_messages (
            id varchar PRIMARY KEY,
            user_id varchar NOT NULL,
            username varchar NOT NULL DEFAULT 'Liquid Clipper',
            avatar_url varchar,
            channel varchar NOT NULL DEFAULT 'global',
            content text NOT NULL,
            role varchar NOT NULL DEFAULT 'member',
            pinned boolean NOT NULL DEFAULT false,
            announcement_id varchar,
            created_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_chat_messages_channel_created ON chat_messages (channel, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_chat_messages_user ON chat_messages (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_chat_messages_pinned ON chat_messages (channel, pinned) WHERE pinned = true",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_role varchar NOT NULL DEFAULT 'member'",
        # Stage 7 · chat-scoped timed mute + moderation state on chat_messages.
        # All four are additive · Postgres/sqlite compatible · no backfill
        # needed (NULL semantics == not moderated / not muted).
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_muted_until timestamptz",
        "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS hidden_at timestamptz",
        "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS hidden_by_user_id varchar",
        "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS hide_reason text",
        "CREATE INDEX IF NOT EXISTS ix_chat_messages_hidden_at ON chat_messages (hidden_at) WHERE hidden_at IS NOT NULL",
        # v2.2.11 arcade leaderboard — Space Invaders best-ever score.
        # Indexed because /chat/game/leaderboard orders the top-10 desc.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS arcade_high_score integer NOT NULL DEFAULT 0",
        "CREATE INDEX IF NOT EXISTS ix_users_arcade_high_score ON users (arcade_high_score DESC)",
        # v2.2.14 unified handle — one field drives chat username, arcade
        # leaderboard, affiliate share URL, and future public profile.
        # Nullable during migration; backfilled below in the seed step so
        # existing users get a handle without a forced re-onboard.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS handle varchar(60)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_handle ON users (LOWER(handle)) WHERE handle IS NOT NULL",
        # v2.2.15 · trial-convert-early click marker. Stamped when the
        # user hits "Approve upgrade" in the one-click modal · cleared
        # when the Whop membership_valid webhook lands with tier=solo.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_convert_approved_at timestamptz",
        # v2.2.17 · thumbnail batch quota + boost-pack credit. Pro/Agency
        # get monthly caps (100 / 500) enforced server-side. Boost pack
        # (plan_xLS3gGsJ16455 · $9 · 25 batches) tops up when they run
        # out. Solo is BYO OpenAI · no cap needed there.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS thumbnail_batches_used_this_period integer NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS thumbnail_batches_period_start timestamptz",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS thumbnail_batches_boost_credit integer NOT NULL DEFAULT 0",
        # 2026-07-03 · Step 2 batch 2b · server-owned platform authority +
        # capability schema version stamp. Backfill runs one time to lift
        # existing admin emails into platform_role='admin' — subsequent
        # boots are a no-op because the WHERE only matches platform_role='none'.
        # Legacy `is_admin_email()` still fires for one compat release; the
        # new evaluator reads user.platform_role instead.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_role varchar NOT NULL DEFAULT 'none'",
        "CREATE INDEX IF NOT EXISTS ix_users_platform_role ON users (platform_role) WHERE platform_role != 'none'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS capability_schema_version_at_issue integer NOT NULL DEFAULT 1",
        # AdminAuditLog · support-mode columns. NULL on legacy rows.
        # ix on ticket + capability so HQ can filter forensically.
        "ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS support_ticket_id varchar(120)",
        "CREATE INDEX IF NOT EXISTS ix_admin_audit_log_support_ticket ON admin_audit_log (support_ticket_id) WHERE support_ticket_id IS NOT NULL",
        "ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS support_reason text",
        "ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS support_capability varchar(80)",
        "CREATE INDEX IF NOT EXISTS ix_admin_audit_log_support_capability ON admin_audit_log (support_capability) WHERE support_capability IS NOT NULL",
        "ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS support_expiry_at timestamptz",
        "ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS support_approver_id varchar(120)",
        # 2026-07-03 · D · arcade prize ledger. arcade_submissions carries
        # month-scoped score history for the winner query + anti-cheat
        # audit trail; winner_payouts is the idempotent dispatch record
        # keyed by month (UNIQUE) so retries can never double-pay.
        """CREATE TABLE IF NOT EXISTS arcade_submissions (
            id varchar PRIMARY KEY,
            user_id varchar NOT NULL,
            score integer NOT NULL,
            wave integer NOT NULL DEFAULT 1,
            duration_ms integer NOT NULL DEFAULT 0,
            shots_fired integer NOT NULL DEFAULT 0,
            ip varchar,
            created_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_arcade_submissions_user ON arcade_submissions (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_arcade_submissions_score ON arcade_submissions (score DESC)",
        "CREATE INDEX IF NOT EXISTS ix_arcade_submissions_created_at ON arcade_submissions (created_at DESC)",
        """CREATE TABLE IF NOT EXISTS winner_payouts (
            id varchar PRIMARY KEY,
            month varchar(7) UNIQUE NOT NULL,
            user_id varchar NOT NULL,
            score integer NOT NULL,
            amount_cents integer NOT NULL,
            paid_sub_count_snapshot integer NOT NULL DEFAULT 0,
            whop_transfer_id varchar,
            paid_at timestamptz,
            state varchar(40) NOT NULL DEFAULT 'pending',
            error_message text,
            created_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_winner_payouts_month ON winner_payouts (month)",
        "CREATE INDEX IF NOT EXISTS ix_winner_payouts_user ON winner_payouts (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_winner_payouts_transfer ON winner_payouts (whop_transfer_id) WHERE whop_transfer_id IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS ix_winner_payouts_created_at ON winner_payouts (created_at DESC)",
        # 2026-07-03 · Step 4 · milestone transition audit trail. Complements
        # the User.onboarding_status JSON snapshot with a per-transition
        # history keyed by idempotency_key (unique).
        """CREATE TABLE IF NOT EXISTS milestone_transitions (
            id varchar PRIMARY KEY,
            user_id varchar NOT NULL,
            journey varchar(20) NOT NULL,
            prev_state varchar(60),
            next_state varchar(60) NOT NULL,
            source_surface varchar(80) NOT NULL,
            schema_version integer NOT NULL DEFAULT 1,
            idempotency_key varchar(160) UNIQUE NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_milestone_transitions_user ON milestone_transitions (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_milestone_transitions_journey ON milestone_transitions (journey)",
        "CREATE INDEX IF NOT EXISTS ix_milestone_transitions_next_state ON milestone_transitions (next_state)",
        "CREATE INDEX IF NOT EXISTS ix_milestone_transitions_created_at ON milestone_transitions (created_at DESC)",
        # 2026-07-03 · Step 6 · registry-driven observability substrate.
        # Feature + Endpoint registry, generic TelemetryEvent ingestion,
        # DesktopErrorGroup fingerprint dedupe. Everything HQ reads is
        # generic — new features = new rows, not new code.
        """CREATE TABLE IF NOT EXISTS features (
            id varchar PRIMARY KEY,
            feature_id varchar(120) UNIQUE NOT NULL,
            name varchar(200) NOT NULL,
            journey varchar(20),
            owner varchar(120) NOT NULL,
            canary boolean NOT NULL DEFAULT true,
            enabled boolean NOT NULL DEFAULT true,
            baseline_error_rate numeric(6,4) NOT NULL DEFAULT 0,
            schema_version integer NOT NULL DEFAULT 1,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_features_journey ON features (journey)",
        """CREATE TABLE IF NOT EXISTS feature_endpoints (
            id varchar PRIMARY KEY,
            feature_id varchar(120) NOT NULL,
            method varchar(10) NOT NULL,
            path_pattern varchar(400) NOT NULL,
            expected_status integer NOT NULL DEFAULT 200,
            expected_error_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
            health_check_body jsonb,
            enabled boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_feature_endpoints_feature ON feature_endpoints (feature_id)",
        """CREATE TABLE IF NOT EXISTS telemetry_events (
            id varchar PRIMARY KEY,
            event varchar(80) NOT NULL,
            schema_version integer NOT NULL DEFAULT 1,
            feature_id varchar(120) NOT NULL,
            journey_id varchar(20),
            surface varchar(200) NOT NULL,
            route varchar(200) NOT NULL DEFAULT '',
            release varchar(80) NOT NULL,
            build varchar(80) NOT NULL,
            environment varchar(20) NOT NULL,
            operating_mode varchar(20) NOT NULL DEFAULT 'self',
            entitlement_class varchar(20) NOT NULL DEFAULT 'clipper',
            onboarding_state varchar(60),
            actor_kind varchar(20) NOT NULL DEFAULT 'anon',
            actor_id varchar(120) NOT NULL,
            correlation_id varchar(80) NOT NULL,
            session_id varchar(80) NOT NULL,
            attempt_id varchar(80) NOT NULL,
            success boolean NOT NULL DEFAULT true,
            failure text,
            duration_ms integer,
            stable_error_code varchar(120),
            payload_json text NOT NULL DEFAULT '{}',
            metadata_json text,
            emitted_at timestamptz NOT NULL,
            stored_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_telemetry_events_feature_release ON telemetry_events (feature_id, release)",
        "CREATE INDEX IF NOT EXISTS ix_telemetry_events_event ON telemetry_events (event)",
        "CREATE INDEX IF NOT EXISTS ix_telemetry_events_error_code ON telemetry_events (stable_error_code) WHERE stable_error_code IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS ix_telemetry_events_stored_at ON telemetry_events (stored_at DESC)",
        """CREATE TABLE IF NOT EXISTS desktop_error_groups (
            id varchar PRIMARY KEY,
            fingerprint varchar(80) UNIQUE NOT NULL,
            release varchar(80) NOT NULL,
            feature_id varchar(120),
            stable_error_code varchar(120),
            route varchar(200),
            environment varchar(20) NOT NULL DEFAULT 'dev',
            count integer NOT NULL DEFAULT 0,
            affected_user_count integer NOT NULL DEFAULT 0,
            latest_sanitized_message text,
            first_seen_at timestamptz NOT NULL DEFAULT now(),
            last_seen_at timestamptz NOT NULL DEFAULT now(),
            status varchar(20) NOT NULL DEFAULT 'open'
        )""",
        "CREATE INDEX IF NOT EXISTS ix_desktop_error_groups_release ON desktop_error_groups (release)",
        "CREATE INDEX IF NOT EXISTS ix_desktop_error_groups_feature ON desktop_error_groups (feature_id) WHERE feature_id IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS ix_desktop_error_groups_last_seen ON desktop_error_groups (last_seen_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_desktop_error_groups_status ON desktop_error_groups (status)",
        # 2026-07-03 · Step 7 · Railway deployment ingestion + alert rules
        """CREATE TABLE IF NOT EXISTS deployment_events (
            id varchar PRIMARY KEY,
            deployment_id varchar(120) UNIQUE NOT NULL,
            service varchar(80) NOT NULL,
            environment varchar(20) NOT NULL,
            release_sha varchar(80) NOT NULL,
            event_type varchar(40) NOT NULL,
            occurred_at timestamptz NOT NULL,
            raw_payload_json text,
            signature_verified boolean NOT NULL DEFAULT false,
            created_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_deployment_events_service ON deployment_events (service)",
        "CREATE INDEX IF NOT EXISTS ix_deployment_events_release_sha ON deployment_events (release_sha)",
        "CREATE INDEX IF NOT EXISTS ix_deployment_events_environment ON deployment_events (environment)",
        "CREATE INDEX IF NOT EXISTS ix_deployment_events_occurred_at ON deployment_events (occurred_at DESC)",
        """CREATE TABLE IF NOT EXISTS alert_rules (
            id varchar PRIMARY KEY,
            name varchar(200) NOT NULL,
            feature_id varchar(120),
            condition_kind varchar(40) NOT NULL,
            threshold numeric(10,4) NOT NULL,
            window_minutes integer NOT NULL DEFAULT 15,
            cooldown_minutes integer NOT NULL DEFAULT 60,
            owner varchar(120) NOT NULL,
            enabled boolean NOT NULL DEFAULT true,
            last_fired_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_alert_rules_feature ON alert_rules (feature_id) WHERE feature_id IS NOT NULL",
        # 2026-07-03 · Step 7.5 · agent substrate.
        """CREATE TABLE IF NOT EXISTS agents (
            id varchar PRIMARY KEY,
            agent_id varchar(120) UNIQUE NOT NULL,
            name varchar(200) NOT NULL,
            provider varchar(40) NOT NULL,
            role varchar(80) NOT NULL,
            credential_id varchar(120) NOT NULL,
            enabled boolean NOT NULL DEFAULT true,
            max_concurrent integer NOT NULL DEFAULT 1,
            daily_credit_cap_cents integer NOT NULL DEFAULT 1000,
            circuit_breaker_state varchar(20) NOT NULL DEFAULT 'closed',
            consecutive_failures integer NOT NULL DEFAULT 0,
            parent_agent_id varchar(120),
            owner varchar(120) NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_agents_provider ON agents (provider)",
        "CREATE INDEX IF NOT EXISTS ix_agents_role ON agents (role)",
        """CREATE TABLE IF NOT EXISTS agent_actions (
            id varchar PRIMARY KEY,
            agent_id varchar(120) NOT NULL,
            action_type varchar(80) NOT NULL,
            target_user_id varchar(120),
            prompt_redacted text,
            response_redacted text,
            tools_called jsonb NOT NULL DEFAULT '[]'::jsonb,
            cost_cents integer NOT NULL DEFAULT 0,
            elapsed_ms integer NOT NULL DEFAULT 0,
            success boolean NOT NULL DEFAULT true,
            stable_error_code varchar(120),
            decision_trace_id varchar(80) NOT NULL,
            correlation_id varchar(80),
            created_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_agent_actions_agent ON agent_actions (agent_id)",
        "CREATE INDEX IF NOT EXISTS ix_agent_actions_action_type ON agent_actions (action_type)",
        "CREATE INDEX IF NOT EXISTS ix_agent_actions_target_user ON agent_actions (target_user_id) WHERE target_user_id IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS ix_agent_actions_error ON agent_actions (stable_error_code) WHERE stable_error_code IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS ix_agent_actions_created_at ON agent_actions (created_at DESC)",
        # ─── Constellation Engine · 2026-07-06 ────────────────────────────
        # Self-healing node runtime. Every user-reachable surface in
        # desktop-2 is wrapped in a Watchdog that POSTs failures here.
        # Coordinator dispatches per-node LLMs (HQ-hired) or the fallback
        # Anthropic key ("Claude 1") when no LLM is assigned. HQ controls
        # everything through the admin panel — pool inserts load LIVE.
        # See docs/PROTOCOL_SELF_HEALING_NODES.md + HQ_CONSTELLATION_ENGINE_SPEC.
        #
        # node_failures — append-only crash journal. Every Watchdog trip
        # + every watchdogWrap async throw lands one row. rolling_score
        # is computed at read time (SUM(weight) WHERE ts > now() - 5min)
        # so we don't have to maintain a materialised counter.
        """CREATE TABLE IF NOT EXISTS constellation_node_failures (
            id bigserial PRIMARY KEY,
            node_id varchar(240) NOT NULL,
            cluster varchar(40) NOT NULL,
            weight integer NOT NULL DEFAULT 1,
            message text NOT NULL,
            stack text,
            context jsonb,
            user_id varchar,
            app_version varchar(40),
            ts timestamptz NOT NULL DEFAULT now(),
            resolved_at timestamptz,
            resolution varchar(40)
        )""",
        "CREATE INDEX IF NOT EXISTS ix_constellation_node_failures_node ON constellation_node_failures (node_id, ts DESC)",
        "CREATE INDEX IF NOT EXISTS ix_constellation_node_failures_cluster ON constellation_node_failures (cluster, ts DESC)",
        "CREATE INDEX IF NOT EXISTS ix_constellation_node_failures_unresolved ON constellation_node_failures (node_id) WHERE resolved_at IS NULL",
        # constellation_node_meta — HQ-editable metadata about each node.
        # Populated on first failure ingest (from the Watchdog payload) so
        # HQ sees an accurate list without a pre-seed step. Fields Daniel
        # can enrich: owner, money_critical, runbook_url.
        """CREATE TABLE IF NOT EXISTS constellation_node_meta (
            node_id varchar(240) PRIMARY KEY,
            label varchar(200) NOT NULL,
            cluster varchar(40) NOT NULL,
            source varchar(400),
            owner varchar(80),
            money_critical boolean NOT NULL DEFAULT false,
            runbook_url varchar(400),
            first_seen_at timestamptz NOT NULL DEFAULT now(),
            last_seen_at timestamptz NOT NULL DEFAULT now()
        )""",
        # constellation_node_overrides — per-node admin control. Set by
        # either our admin panel or HQ's admin panel. Last-write-wins;
        # updated_by lets us audit which surface issued the mutation.
        """CREATE TABLE IF NOT EXISTS constellation_node_overrides (
            node_id varchar(240) PRIMARY KEY,
            disabled boolean NOT NULL DEFAULT false,
            api_key_override_enc text,
            cleared_at timestamptz,
            updated_at timestamptz NOT NULL DEFAULT now(),
            updated_by varchar(40) NOT NULL DEFAULT 'system'
        )""",
        # constellation_node_assignments — per-node LLM hire record. HQ
        # populates via the admin panel. Only one active assignment per
        # node (PK on node_id). Fired assignments are deleted (audit via
        # constellation_node_events row instead of soft-delete).
        """CREATE TABLE IF NOT EXISTS constellation_node_assignments (
            node_id varchar(240) PRIMARY KEY,
            provider varchar(40) NOT NULL,
            model varchar(80) NOT NULL,
            api_key_enc text NOT NULL,
            system_prompt text,
            budget_cents integer NOT NULL DEFAULT 50000,
            used_cents integer NOT NULL DEFAULT 0,
            hired_at timestamptz NOT NULL DEFAULT now(),
            hired_by varchar(40) NOT NULL DEFAULT 'hq',
            last_dispatch_at timestamptz
        )""",
        # constellation_node_patches — every LLM-proposed patch. Status
        # transitions: proposed → (approved | rejected | failed_tsc).
        # diff_text held in-row (bounded, patches are small). commit_sha
        # populated when Daniel merges the constellation/patch_<id> branch.
        """CREATE TABLE IF NOT EXISTS constellation_node_patches (
            id varchar(40) PRIMARY KEY,
            node_id varchar(240) NOT NULL,
            proposed_by varchar(80) NOT NULL,
            proposed_at timestamptz NOT NULL DEFAULT now(),
            summary varchar(400) NOT NULL,
            diff_text text NOT NULL,
            touched_files jsonb NOT NULL DEFAULT '[]'::jsonb,
            status varchar(20) NOT NULL DEFAULT 'proposed',
            tsc_ok boolean,
            approved_at timestamptz,
            approved_by varchar(40),
            rejected_at timestamptz,
            rejection_reason text,
            branch_name varchar(200),
            commit_sha varchar(40),
            failure_ids jsonb NOT NULL DEFAULT '[]'::jsonb
        )""",
        "CREATE INDEX IF NOT EXISTS ix_constellation_node_patches_node ON constellation_node_patches (node_id, proposed_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_constellation_node_patches_status ON constellation_node_patches (status) WHERE status = 'proposed'",
        # constellation_pool_members — 3-slot Railway failover pool. HQ
        # pastes URL + key into a slot via the admin panel; loads live.
        # slot 1 = primary, 2 = hq-backup, 3 = third. Empty slots are
        # skipped in failover.
        """CREATE TABLE IF NOT EXISTS constellation_pool_members (
            slot integer PRIMARY KEY,
            name varchar(40) NOT NULL,
            url varchar(400),
            api_key_enc text,
            enabled boolean NOT NULL DEFAULT true,
            last_reachable_at timestamptz,
            last_latency_ms integer,
            last_error varchar(200),
            updated_at timestamptz NOT NULL DEFAULT now()
        )""",
        # Seed the 3 empty slots on first boot so HQ sees the pool grid.
        "INSERT INTO constellation_pool_members (slot, name, url, api_key_enc, enabled) VALUES (1, 'primary', NULL, NULL, true) ON CONFLICT (slot) DO NOTHING",
        "INSERT INTO constellation_pool_members (slot, name, url, api_key_enc, enabled) VALUES (2, 'hq-backup', NULL, NULL, false) ON CONFLICT (slot) DO NOTHING",
        "INSERT INTO constellation_pool_members (slot, name, url, api_key_enc, enabled) VALUES (3, 'third', NULL, NULL, false) ON CONFLICT (slot) DO NOTHING",
        # constellation_fallback_config — my Anthropic key (Claude 1) as
        # the always-on fallback when no LLM is assigned to a node. Single
        # row (id='fallback'). HQ can rotate via the admin panel.
        """CREATE TABLE IF NOT EXISTS constellation_fallback_config (
            id varchar(20) PRIMARY KEY,
            provider varchar(40) NOT NULL DEFAULT 'anthropic',
            model varchar(80) NOT NULL DEFAULT 'claude-opus-4-7',
            api_key_enc text,
            budget_cents integer,
            used_cents integer NOT NULL DEFAULT 0,
            updated_at timestamptz NOT NULL DEFAULT now(),
            updated_by varchar(40) NOT NULL DEFAULT 'coordinator'
        )""",
        "INSERT INTO constellation_fallback_config (id, provider, model, api_key_enc) VALUES ('fallback', 'anthropic', 'claude-opus-4-7', NULL) ON CONFLICT (id) DO NOTHING",
        # ─── Login-screen carousel · 2026-07-06 ──────────────────────────
        # Curated clip roster shown on the LoginScreen carousel for cold-
        # traffic users. HQ populates this table with real cold-lead
        # preview MP4s from the Remotion pipeline. Empty is a valid state
        # · the desktop client renders bundled fallback clips when this
        # returns no rows.
        """CREATE TABLE IF NOT EXISTS login_carousel_clips (
            id varchar(80) PRIMARY KEY,
            url text NOT NULL,
            handle varchar(80) NOT NULL,
            earnings_cents integer NOT NULL DEFAULT 0,
            platform varchar(40),
            campaign_id varchar(80),
            priority integer NOT NULL DEFAULT 0,
            active boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_login_carousel_clips_active ON login_carousel_clips (active, priority DESC) WHERE active = true",
        # ─── Login-step telemetry · 2026-07-06 ───────────────────────────
        # Append-only funnel event log. Every strategic step in the login
        # flow lands one row via POST /telemetry/login-step. Session id
        # is a per-boot uuid from the desktop so we can trace a single
        # user through the funnel without needing an account.
        """CREATE TABLE IF NOT EXISTS login_step_events (
            id bigserial PRIMARY KEY,
            session_id varchar(80) NOT NULL,
            step varchar(60) NOT NULL,
            app_version varchar(40),
            ctx jsonb,
            ip_address varchar(80),
            ts timestamptz NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_login_step_events_session ON login_step_events (session_id, ts)",
        "CREATE INDEX IF NOT EXISTS ix_login_step_events_step ON login_step_events (step, ts DESC)",
        # ─── Control Tower · Clip Runs ledger · 2026-07-09 ────────────────
        # One row per clipping attempt. Sidecar upserts by run_id at
        # pipeline end. Admin HQ Clip Runs tab reads directly from here —
        # no external log system, no Sentry archaeology.
        """CREATE TABLE IF NOT EXISTS clip_runs (
            id bigserial PRIMARY KEY,
            run_id varchar(64) NOT NULL UNIQUE,
            user_id varchar NOT NULL,
            workspace_id varchar,
            tier varchar(32),
            app_version varchar(32),
            runtime_version varchar(32),
            sidecar_version varchar(32),
            source_type varchar(32),
            source_url_or_file_type varchar(500),
            video_duration_seconds integer,
            requested_clip_count integer,
            status varchar(20) NOT NULL,
            current_stage varchar(30),
            failure_layer varchar(30),
            failure_reason varchar(500),
            customer_visible_error varchar(500),
            clip_judge_provider varchar(50),
            clip_judge_model varchar(80),
            input_tokens integer NOT NULL DEFAULT 0,
            output_tokens integer NOT NULL DEFAULT 0,
            cost_usd_cents integer NOT NULL DEFAULT 0,
            clips_generated integer NOT NULL DEFAULT 0,
            stages jsonb NOT NULL DEFAULT '[]'::jsonb,
            created_at timestamptz NOT NULL DEFAULT now(),
            completed_at timestamptz
        )""",
        "CREATE INDEX IF NOT EXISTS ix_clip_runs_user_created ON clip_runs (user_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_clip_runs_status_created ON clip_runs (status, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_clip_runs_failure ON clip_runs (failure_layer, created_at DESC) WHERE status = 'failed'",
        "CREATE INDEX IF NOT EXISTS ix_clip_runs_created ON clip_runs (created_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_clip_runs_provider ON clip_runs (clip_judge_provider, created_at DESC)",
        # RPC JWT injection · 2026-07-09 (keychain regression guard)
        # Sidecar bumps `keychain_read_attempted_count` on every keychain
        # touch attempt in hosted mode. Backend fires HQ alert when > 0
        # and mode == "hosted". Both columns are nullable so pre-2.2.36
        # sidecars still upsert cleanly.
        "ALTER TABLE clip_runs ADD COLUMN IF NOT EXISTS keychain_read_attempted_count integer",
        "ALTER TABLE clip_runs ADD COLUMN IF NOT EXISTS clip_judge_mode varchar(20)",
        # ─── Cold-lead pre-registration · 2026-07-06 ─────────────────────
        # HQ populates when Instantly reports open/click. Powers the
        # LoginScreen State B (welcome by handle · personalized preview
        # MP4 in the carousel). Idempotent upsert on (email, campaign_id).
        """CREATE TABLE IF NOT EXISTS cold_leads (
            email varchar(200) NOT NULL,
            handle varchar(80) NOT NULL,
            campaign_id varchar(80) NOT NULL,
            preview_clip_url text,
            platform varchar(40),
            first_seen_at timestamptz NOT NULL DEFAULT now(),
            last_seen_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (email, campaign_id)
        )""",
        "CREATE INDEX IF NOT EXISTS ix_cold_leads_email ON cold_leads (email)",
        "CREATE INDEX IF NOT EXISTS ix_cold_leads_last_seen ON cold_leads (last_seen_at DESC)",
        # 2026-07-07 · crew-match enrichment columns · HQ contract.
        # Reply doc: REPLY_HQ_CREW_MATCH_2026-07-07.md.
        # The core insight: current earnings sets the stage · the OPPORTUNITY
        # (missing money on platforms they're absent from) drives conversion.
        "ALTER TABLE cold_leads ADD COLUMN IF NOT EXISTS niche varchar(80)",
        "ALTER TABLE cold_leads ADD COLUMN IF NOT EXISTS audience_size bigint",
        "ALTER TABLE cold_leads ADD COLUMN IF NOT EXISTS estimated_monthly_earnings_cents integer",
        # THE gap · missing money across platforms the creator is absent from.
        "ALTER TABLE cold_leads ADD COLUMN IF NOT EXISTS estimated_opportunity_cents integer",
        # Honest range (Social Blade style · not fake precision).
        "ALTER TABLE cold_leads ADD COLUMN IF NOT EXISTS earnings_low_cents integer",
        "ALTER TABLE cold_leads ADD COLUMN IF NOT EXISTS earnings_high_cents integer",
        # Platforms the creator is ABSENT from · drives the gap explanation
        # and the "post here" CTA. JSON array or comma-separated string.
        "ALTER TABLE cold_leads ADD COLUMN IF NOT EXISTS absent_platforms varchar(200)",
        # Multi-platform handles · lifts match rate above single ambiguous handle.
        "ALTER TABLE cold_leads ADD COLUMN IF NOT EXISTS handle_youtube varchar(80)",
        "ALTER TABLE cold_leads ADD COLUMN IF NOT EXISTS handle_tiktok varchar(80)",
        "ALTER TABLE cold_leads ADD COLUMN IF NOT EXISTS handle_twitter varchar(80)",
        "CREATE INDEX IF NOT EXISTS ix_cold_leads_handle_youtube ON cold_leads (LOWER(handle_youtube)) WHERE handle_youtube IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS ix_cold_leads_handle_tiktok ON cold_leads (LOWER(handle_tiktok)) WHERE handle_tiktok IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS ix_cold_leads_handle_twitter ON cold_leads (LOWER(handle_twitter)) WHERE handle_twitter IS NOT NULL",
        # Owner-verified flag · flips true when a claimed creator confirms.
        # Trust flywheel: verified data trains the model for other creators.
        "ALTER TABLE cold_leads ADD COLUMN IF NOT EXISTS earnings_verified_by_owner boolean NOT NULL DEFAULT false",
        # 2026-07-07 · crew invite log · every "Send invite" click in the
        # Wallet CrewMatchTool writes a row. Enables referral-pipeline
        # tile (invited → activated → earning-from → total-earned).
        #
        # ⚠️  FK TYPE AUDIT · 2026-07-11 — users.id is `varchar` (uuid4().hex),
        # NOT integer. The pre-2026-07-11 DDL declared `referrer_user_id integer
        # REFERENCES users(id)` which is a type mismatch: every INSERT from
        # crew.py binds `user.id` (varchar) into an integer column and would
        # cast-fail on Postgres. `CREATE TABLE IF NOT EXISTS` means any table
        # already created with the wrong types will be left alone here — if
        # Railway crew_invites was created before 2026-07-11 with integer FKs,
        # it must be dropped + recreated manually (there's currently no crew
        # invite production data to protect · confirm with `SELECT count(*)`
        # before dropping).
        """CREATE TABLE IF NOT EXISTS crew_invites (
            id bigserial PRIMARY KEY,
            invite_id varchar(24) NOT NULL UNIQUE,
            referrer_user_id varchar NOT NULL REFERENCES users(id),
            recipient_email varchar(200) NOT NULL,
            recipient_handle varchar(80),
            sent_at timestamptz NOT NULL DEFAULT now(),
            resend_message_id varchar(80),
            opened_at timestamptz,
            clicked_at timestamptz,
            activated_user_id varchar REFERENCES users(id),
            activated_at timestamptz,
            first_payment_cents integer,
            first_payment_at timestamptz,
            total_earned_cents integer NOT NULL DEFAULT 0
        )""",
        "CREATE INDEX IF NOT EXISTS ix_crew_invites_referrer ON crew_invites (referrer_user_id)",
        "CREATE INDEX IF NOT EXISTS ix_crew_invites_recipient ON crew_invites (recipient_email)",
        "CREATE INDEX IF NOT EXISTS ix_crew_invites_activated ON crew_invites (activated_user_id) WHERE activated_user_id IS NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_crew_invites_invite_id ON crew_invites (invite_id)",
        # Ship-lens SF-P1-006 · prevent double-insert race on rapid clicks.
        # App layer also dedups but DB layer is the honest gate.
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_crew_invites_referrer_recipient ON crew_invites (referrer_user_id, recipient_email)",
        # Ship-lens P1-03 · 2026-07-11 · idempotent FK-type migration for
        # Railway crew_invites tables that were created before this fix
        # with integer FKs. `USING <col>::text` casts any existing integer
        # rows to varchar in-place. Postgres will no-op these when the
        # column type is already varchar. The migration loop's try/except
        # swallows unsupported-cast errors so this never bricks boot on
        # dev DBs that predate the crew_invites table entirely.
        "ALTER TABLE crew_invites ALTER COLUMN referrer_user_id TYPE varchar USING referrer_user_id::text",
        "ALTER TABLE crew_invites ALTER COLUMN activated_user_id TYPE varchar USING activated_user_id::text",
        # 2026-07-06 · LC-ID public sign-in identifier. Minted on Whop
        # membership_valid and pasted back into the desktop recovery input
        # as a fallback for the liquidclips://activate deep link.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS lc_id varchar(20)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_lc_id ON users (lc_id) WHERE lc_id IS NOT NULL",
        # 2026-07-12 · RC1 Train B3 · LCOS persistent event store.
        # BC-005 class-elimination · durable mirror of the lcDiag
        # `/telemetry/diagnostic` stream so HQ and Doctor Full can
        # query real transition proofs instead of grep-scraping Railway
        # stdout. Idempotency guarded by (topic, ts_ms, payload_hash)
        # UNIQUE — re-flushed batches during transient failures
        # dedupe at INSERT-time. Postgres branch below; the base
        # `Base.metadata.create_all` above already handles SQLite via
        # the SQLAlchemy `LcosEvent` model.
        """CREATE TABLE IF NOT EXISTS lcos_event (
            id bigserial PRIMARY KEY,
            topic varchar(120) NOT NULL,
            payload_json text NOT NULL DEFAULT '{}',
            ts_ms bigint NOT NULL,
            source_sha varchar(40),
            session_id varchar(80),
            payload_hash varchar(80),
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_lcos_event_dedupe UNIQUE (topic, ts_ms, payload_hash)
        )""",
        "CREATE INDEX IF NOT EXISTS ix_lcos_event_topic_ts ON lcos_event (topic, ts_ms DESC)",
        "CREATE INDEX IF NOT EXISTS ix_lcos_event_session ON lcos_event (session_id, ts_ms DESC)",
    ]
    if engine.dialect.name == "postgresql":
        for _stmt in _COLUMN_MIGRATIONS:
            try:
                with engine.begin() as _conn:
                    _conn.execute(_text(_stmt))
            except Exception as _e:  # noqa: BLE001
                _logging.getLogger("junior.schema").warning(
                    "[schema] idempotent ALTER skipped: %s (%s)", _stmt, _e
                )

    # 2026-07-11 · SQLite parity for the crew tables. `_COLUMN_MIGRATIONS`
    # above is Postgres-only DDL (bigserial, timestamptz, partial indexes),
    # which left local SQLite dev without `crew_invites` and `cold_leads`.
    # Result: `GET /me/crew/pipeline` and `POST /me/crew/match` both 500'd
    # with `no such table: crew_invites` on every local run. Same table
    # SHAPE, SQLite-compatible types:
    #   • INTEGER PRIMARY KEY AUTOINCREMENT (rowid alias on SQLite)
    #   • VARCHAR for FKs matching users.id (users.id is uuid4 hex, not int)
    #   • DATETIME instead of timestamptz
    #   • Simple indexes without WHERE partial-index syntax
    # Postgres branch above is authoritative for prod; this is dev only.
    if engine.dialect.name == "sqlite":
        _SQLITE_CREW_TABLES = [
            # crew_invites — mirror of the Postgres DDL above (users.id fk = varchar).
            """CREATE TABLE IF NOT EXISTS crew_invites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invite_id VARCHAR(24) NOT NULL UNIQUE,
                referrer_user_id VARCHAR NOT NULL REFERENCES users(id),
                recipient_email VARCHAR(200) NOT NULL,
                recipient_handle VARCHAR(80),
                sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                resend_message_id VARCHAR(80),
                opened_at DATETIME,
                clicked_at DATETIME,
                activated_user_id VARCHAR REFERENCES users(id),
                activated_at DATETIME,
                first_payment_cents INTEGER,
                first_payment_at DATETIME,
                total_earned_cents INTEGER NOT NULL DEFAULT 0
            )""",
            "CREATE INDEX IF NOT EXISTS ix_crew_invites_referrer ON crew_invites (referrer_user_id)",
            "CREATE INDEX IF NOT EXISTS ix_crew_invites_recipient ON crew_invites (recipient_email)",
            "CREATE INDEX IF NOT EXISTS ix_crew_invites_activated ON crew_invites (activated_user_id)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_crew_invites_invite_id ON crew_invites (invite_id)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_crew_invites_referrer_recipient ON crew_invites (referrer_user_id, recipient_email)",
            # cold_leads — HQ-owned pool, but crew_match reads it. Empty on
            # SQLite is honest (no leads locally); the endpoint returns
            # not_matched_count == inputs, matched == [].
            """CREATE TABLE IF NOT EXISTS cold_leads (
                email VARCHAR(200) NOT NULL,
                handle VARCHAR(80) NOT NULL,
                campaign_id VARCHAR(80) NOT NULL,
                preview_clip_url TEXT,
                platform VARCHAR(40),
                first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                niche VARCHAR(80),
                audience_size BIGINT,
                estimated_monthly_earnings_cents INTEGER,
                estimated_opportunity_cents INTEGER,
                earnings_low_cents INTEGER,
                earnings_high_cents INTEGER,
                absent_platforms VARCHAR(200),
                handle_youtube VARCHAR(80),
                handle_tiktok VARCHAR(80),
                handle_twitter VARCHAR(80),
                earnings_verified_by_owner BOOLEAN NOT NULL DEFAULT 0,
                PRIMARY KEY (email, campaign_id)
            )""",
            "CREATE INDEX IF NOT EXISTS ix_cold_leads_email ON cold_leads (email)",
            "CREATE INDEX IF NOT EXISTS ix_cold_leads_last_seen ON cold_leads (last_seen_at DESC)",
        ]
        for _stmt in _SQLITE_CREW_TABLES:
            try:
                with engine.begin() as _conn:
                    _conn.execute(_text(_stmt))
            except Exception as _e:  # noqa: BLE001
                _logging.getLogger("junior.schema").warning(
                    "[schema] sqlite crew DDL skipped: %s (%s)", _stmt, _e
                )

    # 2026-07-14 · SQLite parity for desktop_auth_codes. Same gap as the
    # crew tables above: the Postgres-only `_COLUMN_MIGRATIONS` block never
    # created this table on local SQLite, so `POST /desktop/auth/start` and
    # `/desktop/auth/verify` 500'd with `no such table: desktop_auth_codes`
    # on every local run. SQLite-compatible shape (matches the fixture
    # already used in tests/test_desktop_auth_hardening.py).
    if engine.dialect.name == "sqlite":
        _SQLITE_DESKTOP_AUTH_TABLES = [
            """CREATE TABLE IF NOT EXISTS desktop_auth_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email VARCHAR(200) NOT NULL,
                code_hash VARCHAR(80) NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL,
                consumed_at TIMESTAMP,
                attempt_count INTEGER NOT NULL DEFAULT 0
            )""",
            "CREATE INDEX IF NOT EXISTS ix_desktop_auth_codes_email_created ON desktop_auth_codes (email, created_at DESC)",
        ]
        for _stmt in _SQLITE_DESKTOP_AUTH_TABLES:
            try:
                with engine.begin() as _conn:
                    _conn.execute(_text(_stmt))
            except Exception as _e:  # noqa: BLE001
                _logging.getLogger("junior.schema").warning(
                    "[schema] sqlite desktop_auth DDL skipped: %s (%s)", _stmt, _e
                )

    # 2026-07-14 · SQLite parity, round 2. Same gap as crew_invites/
    # cold_leads/desktop_auth_codes above: every one of these 13 tables
    # is Postgres-only DDL, so all of them were silently missing on
    # local SQLite dev. Confirmed live via GET /hq/nodes/state 500ing
    # with "no such table: constellation_pool_members" — the
    # Constellation Engine's background node-state poller (30s
    # interval, desktop-2 watchdog/interceptionBus.ts) fails on every
    # local boot. All 13 are actively referenced by real route/module
    # code (canary.py, beta_cohort.py, runtime.py, app/constellation/*,
    # carousel.py + admin.py, login_telemetry.py) — none are dead.
    # Same conversion rules as the crew-tables block:
    #   • serial/bigserial -> INTEGER PRIMARY KEY AUTOINCREMENT
    #   • timestamptz DEFAULT now() -> DATETIME DEFAULT CURRENT_TIMESTAMP
    #   • jsonb -> TEXT (store JSON as text)
    #   • boolean DEFAULT true/false -> BOOLEAN DEFAULT 1/0
    #   • Simple indexes without WHERE partial-index syntax
    # Postgres branch above (_COLUMN_MIGRATIONS) is authoritative for
    # prod; this is dev only.
    if engine.dialect.name == "sqlite":
        _SQLITE_ROUND2_TABLES = [
            """CREATE TABLE IF NOT EXISTS system_flags (
                key VARCHAR(120) PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS beta_partners (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email VARCHAR(200) NOT NULL UNIQUE,
                handle VARCHAR(80),
                invited_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                activated_at DATETIME,
                revenue_split_multiplier NUMERIC NOT NULL DEFAULT 2.0,
                invite_code VARCHAR(24) UNIQUE,
                notes TEXT,
                active BOOLEAN NOT NULL DEFAULT 1,
                feedback_count INTEGER NOT NULL DEFAULT 0
            )""",
            "CREATE INDEX IF NOT EXISTS ix_beta_partners_active ON beta_partners (active)",
            """CREATE TABLE IF NOT EXISTS beta_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                partner_id INTEGER NOT NULL REFERENCES beta_partners(id) ON DELETE CASCADE,
                body TEXT NOT NULL,
                category VARCHAR(40) NOT NULL DEFAULT 'general',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_beta_feedback_partner ON beta_feedback (partner_id)",
            """CREATE TABLE IF NOT EXISTS runtime_manifests (
                version VARCHAR(64) PRIMARY KEY,
                channel VARCHAR(32) NOT NULL DEFAULT 'stable',
                sha256 VARCHAR(64) NOT NULL,
                signature TEXT NOT NULL,
                file VARCHAR(255) NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                pub_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                ship_lens_verdict VARCHAR(16) NOT NULL DEFAULT 'PENDING',
                ship_lens_review_url TEXT,
                promoted_at DATETIME,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_runtime_manifests_channel_verdict ON runtime_manifests (channel, ship_lens_verdict, pub_date DESC)",
            """CREATE TABLE IF NOT EXISTS constellation_node_failures (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                node_id VARCHAR(240) NOT NULL,
                cluster VARCHAR(40) NOT NULL,
                weight INTEGER NOT NULL DEFAULT 1,
                message TEXT NOT NULL,
                stack TEXT,
                context TEXT,
                user_id VARCHAR,
                app_version VARCHAR(40),
                ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                resolved_at DATETIME,
                resolution VARCHAR(40)
            )""",
            "CREATE INDEX IF NOT EXISTS ix_constellation_node_failures_node ON constellation_node_failures (node_id, ts DESC)",
            "CREATE INDEX IF NOT EXISTS ix_constellation_node_failures_cluster ON constellation_node_failures (cluster, ts DESC)",
            "CREATE INDEX IF NOT EXISTS ix_constellation_node_failures_unresolved ON constellation_node_failures (node_id, resolved_at)",
            """CREATE TABLE IF NOT EXISTS constellation_node_meta (
                node_id VARCHAR(240) PRIMARY KEY,
                label VARCHAR(200) NOT NULL,
                cluster VARCHAR(40) NOT NULL,
                source VARCHAR(400),
                owner VARCHAR(80),
                money_critical BOOLEAN NOT NULL DEFAULT 0,
                runbook_url VARCHAR(400),
                first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS constellation_node_overrides (
                node_id VARCHAR(240) PRIMARY KEY,
                disabled BOOLEAN NOT NULL DEFAULT 0,
                api_key_override_enc TEXT,
                cleared_at DATETIME,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_by VARCHAR(40) NOT NULL DEFAULT 'system'
            )""",
            """CREATE TABLE IF NOT EXISTS constellation_node_assignments (
                node_id VARCHAR(240) PRIMARY KEY,
                provider VARCHAR(40) NOT NULL,
                model VARCHAR(80) NOT NULL,
                api_key_enc TEXT NOT NULL,
                system_prompt TEXT,
                budget_cents INTEGER NOT NULL DEFAULT 50000,
                used_cents INTEGER NOT NULL DEFAULT 0,
                hired_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                hired_by VARCHAR(40) NOT NULL DEFAULT 'hq',
                last_dispatch_at DATETIME
            )""",
            """CREATE TABLE IF NOT EXISTS constellation_node_patches (
                id VARCHAR(40) PRIMARY KEY,
                node_id VARCHAR(240) NOT NULL,
                proposed_by VARCHAR(80) NOT NULL,
                proposed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                summary VARCHAR(400) NOT NULL,
                diff_text TEXT NOT NULL,
                touched_files TEXT NOT NULL DEFAULT '[]',
                status VARCHAR(20) NOT NULL DEFAULT 'proposed',
                tsc_ok BOOLEAN,
                approved_at DATETIME,
                approved_by VARCHAR(40),
                rejected_at DATETIME,
                rejection_reason TEXT,
                branch_name VARCHAR(200),
                commit_sha VARCHAR(40),
                failure_ids TEXT NOT NULL DEFAULT '[]'
            )""",
            "CREATE INDEX IF NOT EXISTS ix_constellation_node_patches_node ON constellation_node_patches (node_id, proposed_at DESC)",
            "CREATE INDEX IF NOT EXISTS ix_constellation_node_patches_status ON constellation_node_patches (status)",
            """CREATE TABLE IF NOT EXISTS constellation_pool_members (
                slot INTEGER PRIMARY KEY,
                name VARCHAR(40) NOT NULL,
                url VARCHAR(400),
                api_key_enc TEXT,
                enabled BOOLEAN NOT NULL DEFAULT 1,
                last_reachable_at DATETIME,
                last_latency_ms INTEGER,
                last_error VARCHAR(200),
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS constellation_fallback_config (
                id VARCHAR(20) PRIMARY KEY,
                provider VARCHAR(40) NOT NULL DEFAULT 'anthropic',
                model VARCHAR(80) NOT NULL DEFAULT 'claude-opus-4-7',
                api_key_enc TEXT,
                budget_cents INTEGER,
                used_cents INTEGER NOT NULL DEFAULT 0,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_by VARCHAR(40) NOT NULL DEFAULT 'coordinator'
            )""",
            """CREATE TABLE IF NOT EXISTS login_carousel_clips (
                id VARCHAR(80) PRIMARY KEY,
                url TEXT NOT NULL,
                handle VARCHAR(80) NOT NULL,
                earnings_cents INTEGER NOT NULL DEFAULT 0,
                platform VARCHAR(40),
                campaign_id VARCHAR(80),
                priority INTEGER NOT NULL DEFAULT 0,
                active BOOLEAN NOT NULL DEFAULT 1,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_login_carousel_clips_active ON login_carousel_clips (active, priority DESC)",
            """CREATE TABLE IF NOT EXISTS login_step_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id VARCHAR(80) NOT NULL,
                step VARCHAR(60) NOT NULL,
                app_version VARCHAR(40),
                ctx TEXT,
                ip_address VARCHAR(80),
                ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_login_step_events_session ON login_step_events (session_id, ts)",
            "CREATE INDEX IF NOT EXISTS ix_login_step_events_step ON login_step_events (step, ts DESC)",
        ]
        for _stmt in _SQLITE_ROUND2_TABLES:
            try:
                with engine.begin() as _conn:
                    _conn.execute(_text(_stmt))
            except Exception as _e:  # noqa: BLE001
                _logging.getLogger("junior.schema").warning(
                    "[schema] sqlite round2 DDL skipped: %s (%s)", _stmt, _e
                )

    # 2026-07-03 · Step 2 batch 2b · one-time backfill: lift ADMIN_EMAILS
    # into the persisted platform_role column. Env-driven allowlist means we
    # can't hardcode the WHERE list — we hand it to Postgres as a bound
    # parameter. Idempotent by the ``platform_role = 'none'`` guard: emails
    # already elevated (or an admin later demoted through HQ) are never
    # overwritten by a subsequent boot. Runs on every startup so newly
    # added ADMIN_EMAILS get lifted without a manual step.
    try:
        from app.features import ADMIN_EMAILS  # local import — avoid cycle at module load
        if ADMIN_EMAILS and engine.dialect.name in {"postgresql", "sqlite"}:
            with engine.begin() as _conn:
                _conn.execute(
                    _text(
                        "UPDATE users SET platform_role = 'admin' "
                        "WHERE platform_role = 'none' "
                        "AND LOWER(email) IN :emails"
                    ).bindparams(
                        __import__("sqlalchemy").bindparam("emails", expanding=True)
                    ),
                    {"emails": tuple(sorted(ADMIN_EMAILS))},
                )
    except Exception as _e:  # noqa: BLE001
        _logging.getLogger("junior.schema").warning(
            "[schema] platform_role backfill skipped: %s", _e
        )

    # 2026-07-08 · one-shot data migration: fix legacy banner_urls that
    # point at the retired api.jnremployee.com domain (broke the
    # desktop carousel because every image 404'd through the browser
    # timeout ladder). Also swaps affiliate.mp4 (2.9MB video) for
    # affiliate.png (188KB) so carousel tiles paint fast. Idempotent
    # by definition — after the first run, zero rows match the WHERE.
    try:
        with engine.begin() as _conn:
            _r1 = _conn.execute(_text(
                "UPDATE sponsored_campaigns "
                "SET banner_url = REPLACE(banner_url, 'api.jnremployee.com', 'api.liquidclips.app') "
                "WHERE banner_url LIKE '%jnremployee%'"
            ))
            _r2 = _conn.execute(_text(
                "UPDATE sponsored_campaigns "
                "SET banner_url = REPLACE(banner_url, 'affiliate.mp4', 'affiliate.png') "
                "WHERE banner_url LIKE '%affiliate.mp4'"
            ))
            if _r1.rowcount or _r2.rowcount:
                _logging.getLogger("junior.schema").info(
                    "[banners] legacy fix: %d domain swaps, %d mp4->png",
                    _r1.rowcount, _r2.rowcount,
                )
    except Exception as _e:  # noqa: BLE001
        _logging.getLogger("junior.schema").warning(
            "[banners] legacy fix skipped: %s", _e
        )

    # v0.7.55 — idempotent first-run seeds. Both seed scripts use
    # `upsert` semantics keyed by slug, so they're safe to call on every
    # boot. They only insert rows for slugs that don't exist yet; rows
    # already populated via Admin HQ are left untouched. Wrapped in a
    # broad try/except so a seed failure (e.g. transient DB blip mid-
    # startup) doesn't take the whole app down.
    try:
        from scripts.seed_community_channels import main as _seed_channels  # type: ignore
        _seed_channels()
    except Exception as _e:  # noqa: BLE001
        _logging.getLogger("junior.seed").warning(
            "[seed] community_channels skipped: %s", _e
        )
    try:
        from scripts.seed_uncle_daniel_campaigns import main as _seed_campaigns  # type: ignore
        _seed_campaigns()
    except Exception as _e:  # noqa: BLE001
        _logging.getLogger("junior.seed").warning(
            "[seed] uncle_daniel_campaigns skipped: %s", _e
        )

    # v2.2.14 · one-shot handle backfill for existing users. Idempotent:
    # only touches rows where handle IS NULL. Derives from the most
    # meaningful source available (cached_display_handle → email prefix
    # → clipper-<uid8>) and sanitises to Whop's affiliate-code shape so
    # the same handle works as both the chat @name and the share-URL
    # slug. Collisions get a trailing -N counter.
    try:
        from app.handle_backfill import backfill_missing_handles
        with SessionLocal() as _db:
            _count = backfill_missing_handles(_db)
            if _count:
                _logging.getLogger("junior.seed").info(
                    "[seed] backfilled %d user.handle rows", _count
                )
    except Exception as _e:  # noqa: BLE001
        _logging.getLogger("junior.seed").warning(
            "[seed] handle backfill skipped: %s", _e
        )

    start_cron()
    # Whop chat-agent fleet · guarded by WHOP_AGENT_ENABLED env (default false).
    # When Daniel supplies WHOP_AGENT_KEYS + flips the enable flag, 100 async
    # tasks spin up alongside the FastAPI process. Until then this is a no-op.
    await start_agent_fleet()

    # Fail-closed webhook + internal-secret guard. In production the process
    # refuses to start if any of the signature verification secrets are
    # unset — the old `if secret: verify else pass` pattern silently accepted
    # unverified webhooks whenever an env var was missing on Railway. Any
    # config-drift regression that drops one of these now surfaces at boot,
    # not at first attack. Development skips this so local dev + smoke tests
    # keep working without a full Railway env vault.
    if settings.env == "production":
        _required_prod_secrets = [
            ("CLERK_WEBHOOK_SECRET", settings.clerk_webhook_secret),
            ("WHOP_WEBHOOK_SECRET", settings.whop_webhook_secret),
            ("STRIPE_CONNECT_WEBHOOK_SECRET", settings.stripe_connect_webhook_secret),
            ("AYRSHARE_WEBHOOK_SECRET", settings.ayrshare_webhook_secret),
            ("RAILWAY_WEBHOOK_SECRET", settings.railway_webhook_secret),
            ("INTERNAL_API_SECRET", settings.internal_api_secret),
        ]
        _missing = [name for name, value in _required_prod_secrets if not value]
        if _missing:
            raise RuntimeError(
                "Refusing to start in production without: "
                + ", ".join(_missing)
                + ". Set these Railway env vars before boot."
            )
    try:
        yield
    finally:
        await stop_agent_fleet()
        stop_cron()


app = FastAPI(
    title="Liquid Clips Backend",
    version="0.1.0",
    description="License issuance, tier resolution, webhook reconciliation for Liquid Clips.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Sponsored-campaign banner art lives at /static/campaigns/*.
# Campaign records reference these URLs; without the mount the desktop's
# SponsoredBannerCarousel silently renders empty cards.
_STATIC_DIR = Path(__file__).parent / "static"
if _STATIC_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")

app.include_router(webhooks_clerk.router)
app.include_router(webhooks_whop.router)
app.include_router(webhooks_stripe.router)
app.include_router(webhooks_ayrshare.router)
app.include_router(stripe_connect.router)
app.include_router(desktop.router)
# 2026-07-08 · Desktop backend-owned OTP · Recovery brief P0 · Daniel:
# "Make login brutally simple." Two POSTs · email→code→JWT · no Clerk SDK.
from app.routes import desktop_auth as _desktop_auth_router  # noqa: E402
app.include_router(_desktop_auth_router.router)
app.include_router(auth_whop.router)
app.include_router(auth_clerk_exchange.router)
app.include_router(sync.router)
app.include_router(schedules.router)
app.include_router(usage.router)
app.include_router(updates.router)
app.include_router(updates._admin_updates_router)  # 2026-07-08 · CI manifest publish endpoint
app.include_router(runtime.router)
app.include_router(notifications.router)
app.include_router(transcribe.router)
# 2026-06-30 · POST /me/troubleshoot · AI troubleshooting stub.
# Returns 503 until ANTHROPIC_API_KEY is set on Railway and the python
# `anthropic` package is added to requirements.txt. Frontend falls back
# to the static Kade speech bubble copy.
app.include_router(troubleshoot.router)
# v2.2.14 · unified user.handle CRUD + /link-resolve/{handle} public
# lookup used by marketing /join/[handle] redirect.
from app.routes import handle as _handle_router  # noqa: E402
app.include_router(_handle_router.router)

# 2026-07-05 · 2.2.24 · Whop checkout success redirect handler.
# Registered as the post-checkout success URL on Founder Access plan
# (`plan_svbzoXoT4oj6b` current · `plan_VWj1uoy2RcOsg` grandfathered).
# Reads membership_id from Whop, mints a license
# JWT, deep-links back to the desktop app. Idempotent per membership_id.
from app.routes import whop_checkout_success as _whop_checkout_success_router  # noqa: E402
app.include_router(_whop_checkout_success_router.router)

# 2026-07-05 · 2.2.24 · persistent audit endpoint. Single-call ship gate.
# GET /audit/state aggregates backend health + integrations + journey
# success rates + recent tick activity. POST /audit/tick receives
# lifecycle events from every user-facing button (via useAuditableAction).
# scripts/audit-gate.sh curls /audit/state before any deploy — non-zero
# `blocking_findings` blocks the ship. See docs/AUDIT_SYSTEM.md.
from app.routes import audit as _audit_router  # noqa: E402
app.include_router(_audit_router.router)
# v2.2.15 · one-click trial-to-paid convert · POST /me/trial/approve.
from app.routes import trial_convert as _trial_convert_router  # noqa: E402
app.include_router(_trial_convert_router.router)
# v2.2.17 · thumbnail batch quota + boost-pack top-up · GET /me/thumbnail-quota
# + POST /me/thumbnail-quota/spend.
from app.routes import thumbnail_quota as _thumb_quota_router  # noqa: E402
app.include_router(_thumb_quota_router.router)
# Lane 2 (Max · SPRINT_FINAL §1C · 2026-07-07) · Whop paid-post mirror.
# POST /internal/whop/bounty-mirror upserts Whop marketplace clip jobs
# back into sponsored_campaigns so LC discovery surfaces see them.
# Called by the webhooks_whop.py handler on bounty_created events.
from app.routes import whop_bounty_mirror as _whop_bounty_mirror_router  # noqa: E402
app.include_router(_whop_bounty_mirror_router.router)
# v2.2.10 native community chat — separate from Whop chat feeds routed
# through community_channels. Owns chat_messages persistence + Pexels/
# Giphy proxies + the pin → Announcement bridge.
from app.routes import chat as _chat_router  # noqa: E402
app.include_router(_chat_router.router)
# Stage 5 · agency roster / invite / payout-split / rules / whop-sync.
# Distinct from `agency_campaigns` — that file owns Whop-reward-backed
# campaigns; this one owns the agency's own membership + payout + config
# state and reuses admin_audit_log for every mutation.
from app.routes import agency as _agency_router  # noqa: E402
app.include_router(_agency_router.router)
# Stage 7 · chat-message moderation (hide / warn / mute24h). Sits on the
# same `/chat/*` prefix as `chat.py` but owns only the moderation
# mutations; `chat.py` still owns history + post + pin. Both reuse
# admin_audit_log with target_type="chat_moderation".
from app.routes import moderation as _moderation_router  # noqa: E402
app.include_router(_moderation_router.router)
# NOTE · legacy `telemetry.router` (routes/telemetry.py) is intentionally
# NOT included. Its `POST /telemetry/desktop-error` handler shadowed the
# Step-6 fingerprint-dedupe route in `routes/telemetry_ingest.py` (both
# registered on the same path — Starlette picks the first match, which
# was the legacy one). Result: desktop error reports silently dropped
# `release`, `feature_id`, `stable_error_code`, and never wrote a
# `DesktopErrorGroup` row. Removed 2026-07-03 to restore SO-GATE-6
# guarantees. The module stays on disk for its sanitize helpers; the
# new handler is a superset for both v0.7.x and v2.2.x desktop payloads.
app.include_router(publish.router)
app.include_router(social.router)
app.include_router(connections.router)
app.include_router(whop.router)
app.include_router(me.router)
# 2026-06-24 · /me/lifetime-views · aggregates PostAnalytic for the $50 carrot
app.include_router(me_lifetime_views.router)
# 2026-06-24 · /me/carrot · real Whop transfers + sub-merchant onboarding (IG-SOV-2.2-001)
app.include_router(carrot.router)
# 2026-06-24 · /me/wallet/summary · unified clipper wallet payload (replaces 4 round-trips)
app.include_router(me_wallet.router)
# Train C2 (2026-07-12) · canonical money-rollup endpoint · one source
# of truth for every visible money value (Wallet · Cancellation · HQ
# mirror). GET /me/money-rollup + GET /admin/money-rollup/{user_id}.
from app.routes import money_rollup as _money_rollup_router  # noqa: E402
app.include_router(_money_rollup_router.router)
app.include_router(onboarding.router)
app.include_router(affiliate.router)
app.include_router(affiliate_agreement.router)
app.include_router(hq.router)
app.include_router(tiktok_verify.router)
app.include_router(admin.router)
# AU-D-2 (2026-07-10) · unified admin alerts endpoint (/admin/alerts-unified)
# joins notifications + admin_audit_log (state_puppet) + desktop_error_event
# into a single time-sorted 50-row list so AlertsTab isn't blind to
# high-signal failures that don't land in the notifications table. Read-only.
# See junior-backend/app/routes/admin_alerts_unified.py.
app.include_router(admin_alerts_unified.router)
# v2.2.9 · /agency/* — JWT-gated agency self-service for announcement
# issue + terminate. Lives in admin.py beside the existing global
# /admin/announcements CRUD so the serializer + Pydantic models stay
# co-located, but uses current_user (Bearer JWT) instead of the
# internal-secret console gate.
app.include_router(admin.agency_router)
# HQ Agent 3 · /admin/mutations/* — 11 management-gap mutations.
# Mounted alongside the existing read-only /admin router so the same
# require_admin gate guards both. Sibling routers (recovery, ai-terminal)
# come from other HQ agents and are wired separately.
app.include_router(admin_mutations.router)
# HQ Agent 5 · /admin/recovery/* — break-glass identity-proof + TOTP re-issue.
# /verify and /status are intentionally NOT behind require_admin (the admin is
# locked out by definition); /pin and /auth-code use their own admin gate via
# Depends(_require_admin) inside the module.
app.include_router(admin_recovery.router)
# 2026-07-03 · Step 2 batch 2d · sanctioned cross-tenant support routes.
# Replaces the admin bypass severed from customer /agency/* in batch 2c.
# Every call carries an audited SupportContext (ticket, reason, expiry,
# capability, optional second approver); writes require the second
# approver. See app/routes/admin_support.py.
from app.routes import admin_support as _admin_support_router  # noqa: E402
app.include_router(_admin_support_router.router)
# 2026-07-03 · Step 2 batch 2e · server-authoritative capability whoami
# for the account-app proxy layer. Uses x-internal-secret + clerk_user_id
# (same pattern as /admin/*) so the Next.js gates can drop the legacy
# email allowlist inference and read capabilities from the persisted
# projection. See app/routes/authz_whoami.py.
from app.routes import authz_whoami as _authz_whoami_router  # noqa: E402
app.include_router(_authz_whoami_router.router)
# 2026-07-03 · D · monthly $1,000 arcade prize wire. Public
# /arcade/prize/current for the splash LEADER chip; admin-only
# /arcade/prize/dispatch reuses whop_payments.create_transfer with
# month-scoped idempotence.
from app.routes import arcade_prize as _arcade_prize_router  # noqa: E402
app.include_router(_arcade_prize_router.router)
# 2026-07-03 · Step 6 · registry-driven observability.
# /telemetry/event · generic Envelope ingestion
# /telemetry/desktop-error · fingerprint dedupe (sole owner — legacy
#   telemetry.router NOT included; see note above `moderation.router`)
# /admin/hq/features · feature + endpoint registry CRUD
# /admin/hq/desktop-errors · grouped incident view
from app.routes import telemetry_ingest as _telemetry_ingest_router  # noqa: E402
from app.routes import hq_features as _hq_features_router  # noqa: E402
app.include_router(_telemetry_ingest_router.router)
app.include_router(_hq_features_router.router)
app.include_router(_hq_features_router.error_group_router)
# 2026-07-10 · Lane B · Chapter 5 · State Puppeteer admin routes.
# POST/DELETE/GET /admin/user/{user_id}/state-override[s] — admin flips
# the wallet-detail / sync-mail-money-drop / catalog-carousel /
# cancellation-intercept surfaces into one of six documented states via
# TTL-bound override rows. `me_wallet.py` reads the same table.
from app.routes import admin_state_override as _admin_state_override_router  # noqa: E402
app.include_router(_admin_state_override_router.router)
# 2026-07-10 · Chapter 6 · Money Funnel HQ endpoints.
# GET /admin/money-funnel/{summary,per-surface,recent-events}
# Read-only; honest-empty-state when the behavioural events pipeline
# isn't yet persisted (today `/telemetry/diagnostic` logs to stdout).
from app.routes import admin_money_funnel as _admin_money_funnel_router  # noqa: E402
app.include_router(_admin_money_funnel_router.router)
# 2026-07-10 · Phase 1 · Cold-entry Mode B · Launch War Room summary.
# GET /admin/launch-war-room/summary → 16-tile dual-signal rollup
# (build readiness + live health) powering the HQ LaunchWarRoomTab.
# 30s in-memory cache · honest AMBER when the events pipeline is
# still pending.
from app.routes import admin_launch_war_room as _admin_launch_war_room_router  # noqa: E402
app.include_router(_admin_launch_war_room_router.router)
# 2026-07-03 · Step 7 · Railway signed webhook + HQ funnel/stuck-user
from app.routes import webhooks_railway as _webhooks_railway_router  # noqa: E402
from app.routes import hq_journeys as _hq_journeys_router  # noqa: E402
app.include_router(_webhooks_railway_router.router)
app.include_router(_hq_journeys_router.router)
# 2026-07-04 · Layer 3 · Gmail broadcast queue backend cross-check.
# /deployer/broadcast-start · returns preview URLs per target
# /deployer/broadcast-tick  · records one send + returns 24h caps
from app.routes import deployer as _deployer_router  # noqa: E402
app.include_router(_deployer_router.router)
# 2026-07-04 · Layer 4 · F7 YouTube batch-lookup worker.
# /yt/batch-lookup · resolves video_id → channel_id + channel_handle + subs
# License-JWT gated · 24h in-memory cache · 100/min + 10k/day quota ·
# scraper stub fallback when quota exhausted.
from app import yt_worker as _yt_worker_module  # noqa: E402
app.include_router(_yt_worker_module.router)
# 2026-07-04 · Task F · Founder Access seat-cap runtime gate + status.
# /founder/seat-status · public · marketing + checkout fail-safe.
# Cap enforcement fires inside webhooks_whop._handle_membership_valid
# via try_grant_founder_seat before any tier lands.
from app.routes import founder as _founder_router  # noqa: E402
app.include_router(_founder_router.router)
app.include_router(campaigns.router)
app.include_router(campaign_asset_links.router)
app.include_router(agency_campaigns.router)
app.include_router(bonus_ledger.router)
app.include_router(community.router)
app.include_router(promo.router)
# 2026-06-25 · Promo / discount codes — public /promo/validate + /promo/apply
# and admin /admin/promo/* CRUD + stats. Sibling to the existing `promo`
# router (which despite its name owns banners + announcements, kept as-is
# to avoid touching its callers).
app.include_router(promo_codes.router)
app.include_router(promo_codes.admin_router)
app.include_router(redirect.router)
app.include_router(reward_clips.router)
app.include_router(proxy_llm.router)
# Control Tower #1 · 2026-07-09 — hosted Anthropic clip-judge default.
app.include_router(proxy_anthropic.router)
# Control Tower #5-9 · 2026-07-09 — clip runs ledger + admin HQ list/detail.
# Also fires the 5 auto-alert types into the existing /admin/alerts feed.
app.include_router(clip_runs.telemetry_router)
app.include_router(clip_runs.admin_router)
app.include_router(leaderboard.router)
app.include_router(submissions.router)
app.include_router(doctrine.router)
app.include_router(channels.router)
# v0.7.x — admin_router exposes /admin/channels/{id}/diagnose for the
# desktop's per-channel Diagnose button + the probe script. Same prefix
# pattern as other admin endpoints.
if hasattr(channels, "admin_router"):
    app.include_router(channels.admin_router)
app.include_router(analytics.router)
# Constellation Engine · self-healing node runtime. Two routers:
#   * admin_router at /admin/constellation/* — HQ + our admin panel
#   * client_router at /hq/nodes/*           — desktop Watchdog reporter
# See app/constellation/ module for coordinator + pool + LLM dispatcher.
app.include_router(constellation.admin_router)
app.include_router(constellation.client_router)
# Public login-screen carousel · returns curated cold-lead preview clips
# for the desktop LoginScreen. Empty list is valid · client falls to
# bundled /public/demos/*.mp4. HQ populates login_carousel_clips as they
# curate real preview MP4s from the Remotion pipeline.
app.include_router(carousel.router)
# Login-step telemetry · anonymous POST from LoginScreen + activation.ts
# so we can measure funnel drop-off (login_screen_shown → clipper_clicked
# / agency_clicked / paste_code_* → deep_link_arrived → activation_*).
app.include_router(login_telemetry.router)
# Cold-lead pre-registration · HQ populates when Instantly reports open/click.
# Desktop LoginScreen reads via ?e=&u=&c= URL params on the download link
# and renders State B (welcome by handle · personalized preview MP4) instead
# of State A (fresh install picker).
app.include_router(cold_leads.router)
app.include_router(crew.router)
app.include_router(crew.tracking_router)  # /i/{invite_id} public tracking redirect
app.include_router(crew.resend_webhook_router)  # /crew/webhook/resend (open/click)

# 2026-07-10 · Crew onboarding · Google OAuth callback for F5 scanner.
# GET /auth/google/callback exchanges Google's `code` for tokens and
# fires a `liquidclips://google-oauth?token=...` deep-link back into
# the desktop app. Stateless: no server-side token persistence.
from app.routes import auth_google as _auth_google_router  # noqa: E402
app.include_router(_auth_google_router.router)
app.include_router(canary.router)  # /admin/canary/* · HQ dials
app.include_router(canary.me_router)  # /me/canary · desktop reads
app.include_router(beta_cohort.router)  # /admin/beta/* · early partners
app.include_router(whop_bounty_mirror.router)  # /internal/whop/bounty-mirror (Max Lane 2)
app.include_router(whop_payments_proxy.router)  # /me/whop/payments + /me/whop/wallet
app.include_router(lc_ids.router)

# 2026-07-08 · edge-first ingestion. Consumer endpoints for the
# Cloudflare Worker's queue() drain — POST /internal/queues/cold-leads-prep
# + POST /internal/queues/whop-webhook. Both gated by require_internal_secret.
from app.routes import internal_queues as _internal_queues_router  # noqa: E402
app.include_router(_internal_queues_router.router)
# 2026-07-12 · RC1 Train B3 · LCOS event persistence (BC-005 elimination).
# POST /lcos/events/ingest       · public · idempotent by
#                                    (topic, ts_ms, payload_hash).
# GET  /admin/lcos-events        · admin-only · filter + paginate.
# GET  /admin/lcos-events/topics · admin-only · topic aggregates.
# Companion to the stdout-only /telemetry/diagnostic path; existing
# lcDiag flush is left in place — the persistence router dual-writes.
from app.routes import lcos_events as _lcos_events_router  # noqa: E402
app.include_router(_lcos_events_router.router)
app.include_router(_lcos_events_router.admin_router)


@app.get("/healthcheck")
def healthcheck() -> dict:
    import os as _os
    from app import ayrshare as _ayr
    return {
        "status": "ok",
        "service": "junior-backend",
        "version": "0.1.0",
        # Surface integration health so Railway alerts can fire on a missing
        # AYRSHARE_API_KEY without us having to add a separate readiness probe.
        # `null` = not configured (publishing in beta); `true` = key set.
        "ayrshare_configured": _ayr.is_configured(),
        # v0.7.x — JWT linking is the platform-specific path (TikTok needs it).
        # When false, channel-link silently falls back to the org-branded
        # picker which TikTok refuses to OAuth from. Detected by harden A3.
        "ayrshare_jwt_configured": _ayr.is_jwt_link_configured(),
        # Webhook secret presence — when false, signature verification is
        # bypassed (dev mode). Should be true in prod or any sender can
        # forge channel-state events.
        "ayrshare_webhook_secured": bool(_os.environ.get("AYRSHARE_WEBHOOK_SECRET", "").strip()),
    }


# /health alias — Railway's default healthcheck path. Same body as /healthcheck.
@app.get("/health")
def health() -> dict:
    return healthcheck()


@app.get("/status")
def public_status() -> dict:
    """Customer-safe public status payload.

    Uses the same function heat-map as Admin HQ, but redacts internal URLs,
    errors, owners, environment details, and remediation notes.
    """
    from app.function_heatmap import latest_function_heatmap, public_function_heatmap, run_function_heatmap

    result = latest_function_heatmap()
    if result is None:
        result = run_function_heatmap(notify=False, source="public-lazy-load")
    return public_function_heatmap(result)


@app.get("/status/page", response_class=HTMLResponse)
def public_status_page() -> HTMLResponse:
    """Static HTML status page served from the backend so it survives even
    when the marketing/account-app deploy is down."""
    from app.function_heatmap import latest_function_heatmap, public_function_heatmap, run_function_heatmap

    result = latest_function_heatmap()
    if result is None:
        result = run_function_heatmap(notify=False, source="public-lazy-load")
    view = public_function_heatmap(result)

    tone_class = {
        "ok": "ok",
        "warn": "warn",
        "fail": "fail",
    }.get(str(view.get("overall") or "warn"), "warn")
    headline = {
        "ok": "All systems normal",
        "warn": "Degraded — some checks are warning",
        "fail": "Issues detected — engineering notified",
    }.get(tone_class, "Degraded")
    score = view.get("score")
    generated_at = view.get("generated_at") or ""

    rows = []
    for gate in view.get("gates", []):
        gtone = str(gate.get("status") or "warn")
        rows.append(
            f'<li class="row {gtone}"><span class="dot"></span>'
            f'<span class="label">{gate.get("label", "Service")}</span>'
            f'<span class="state">{gtone.upper()}</span></li>'
        )
    rows_html = "\n".join(rows) or '<li class="row warn"><span class="dot"></span><span class="label">No checks recorded yet</span><span class="state">PENDING</span></li>'

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Liquid Clips · Service status</title>
<meta http-equiv="refresh" content="60" />
<style>
  :root {{
    --paper: #f7f4ee;
    --ink: #161312;
    --line: rgba(22, 19, 18, 0.12);
    --muted: rgba(22, 19, 18, 0.55);
    --ok: #1f9d55;
    --warn: #b07a09;
    --fail: #b8237f;
  }}
  * {{ box-sizing: border-box; }}
  html, body {{ margin: 0; background: var(--paper); color: var(--ink); }}
  body {{ font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; }}
  .wrap {{ max-width: 720px; margin: 0 auto; padding: 56px 24px; }}
  .eyebrow {{ font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }}
  h1 {{ font-size: clamp(28px, 5vw, 40px); line-height: 1.1; margin: 8px 0 4px; letter-spacing: -0.02em; font-weight: 600; }}
  .ok h1 {{ color: var(--ok); }}
  .warn h1 {{ color: var(--warn); }}
  .fail h1 {{ color: var(--fail); }}
  .meta {{ font-size: 12px; color: var(--muted); margin-bottom: 28px; }}
  ul {{ list-style: none; padding: 0; margin: 0; border-top: 1px solid var(--line); }}
  .row {{
    display: flex; align-items: center; gap: 12px;
    padding: 14px 6px; border-bottom: 1px solid var(--line);
  }}
  .label {{ flex: 1; }}
  .state {{
    font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--muted); font-variant-numeric: tabular-nums;
  }}
  .dot {{ width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }}
  .row.ok .dot {{ background: var(--ok); }}
  .row.warn .dot {{ background: var(--warn); }}
  .row.fail .dot {{ background: var(--fail); }}
  .row.ok .state {{ color: var(--ok); }}
  .row.warn .state {{ color: var(--warn); }}
  .row.fail .state {{ color: var(--fail); }}
  footer {{ margin-top: 36px; font-size: 11px; color: var(--muted); }}
</style>
</head>
<body>
<div class="wrap {tone_class}">
  <div class="eyebrow">Liquid Clips · Status</div>
  <h1>{headline}</h1>
  <div class="meta">Score {score}/100 · checked {generated_at} · auto-refreshes every 60s</div>
  <ul>
    {rows_html}
  </ul>
  <footer>This page reflects automated read-only checks against public endpoints. For incident updates, contact support@jnremployee.com.</footer>
</div>
</body>
</html>"""
    return HTMLResponse(html)
