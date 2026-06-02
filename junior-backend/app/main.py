"""Junior Backend entry point.

Locally: `uvicorn app.main:app --reload --port 8000`
Railway: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.cron import start_cron, stop_cron
from app.db import Base, engine
from app.routes import admin, affiliate, analytics, channels, connections, desktop, doctrine, leaderboard, me, notifications, onboarding, proxy_llm, publish, redirect, reward_clips, schedules, social, stripe_connect, submissions, sync, telemetry, transcribe, updates, usage, webhooks_clerk, webhooks_stripe, webhooks_whop, whop

settings = get_settings()


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
        # Stripe Connect Express — payout rail for non-Whop affiliates.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_connect_account_id varchar",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_stripe_connect_account_id ON users (stripe_connect_account_id) WHERE stripe_connect_account_id IS NOT NULL",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_connect_status varchar NOT NULL DEFAULT 'none'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_connect_payouts_enabled boolean NOT NULL DEFAULT false",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_connect_charges_enabled boolean NOT NULL DEFAULT false",
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
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS llm_usage_month varchar",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS llm_tokens_used integer NOT NULL DEFAULT 0",
        # Earnings leaderboard cache (sprint #14a). Refreshed every 6h by
        # app/cron.py:_refresh_affiliate_cache_tick. Read by routes/leaderboard.py.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS cached_lifetime_earnings_usd numeric(10,2) NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS cached_paid_referrals integer NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS cached_display_handle varchar",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS cached_earnings_at timestamptz",
        "CREATE INDEX IF NOT EXISTS ix_users_cached_earnings ON users (cached_lifetime_earnings_usd DESC) WHERE cached_lifetime_earnings_usd > 0",
        "CREATE INDEX IF NOT EXISTS ix_users_ip_address ON users (ip_address) WHERE ip_address IS NOT NULL",
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
    start_cron()
    try:
        yield
    finally:
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

app.include_router(webhooks_clerk.router)
app.include_router(webhooks_whop.router)
app.include_router(webhooks_stripe.router)
app.include_router(stripe_connect.router)
app.include_router(desktop.router)
app.include_router(sync.router)
app.include_router(schedules.router)
app.include_router(usage.router)
app.include_router(updates.router)
app.include_router(notifications.router)
app.include_router(transcribe.router)
app.include_router(telemetry.router)
app.include_router(publish.router)
app.include_router(social.router)
app.include_router(connections.router)
app.include_router(whop.router)
app.include_router(me.router)
app.include_router(onboarding.router)
app.include_router(affiliate.router)
app.include_router(admin.router)
app.include_router(redirect.router)
app.include_router(reward_clips.router)
app.include_router(proxy_llm.router)
app.include_router(leaderboard.router)
app.include_router(submissions.router)
app.include_router(doctrine.router)
app.include_router(channels.router)
app.include_router(analytics.router)


@app.get("/healthcheck")
def healthcheck() -> dict:
    from app import ayrshare as _ayr
    return {
        "status": "ok",
        "service": "junior-backend",
        "version": "0.1.0",
        # Surface integration health so Railway alerts can fire on a missing
        # AYRSHARE_API_KEY without us having to add a separate readiness probe.
        # `null` = not configured (publishing in beta); `true` = key set.
        "ayrshare_configured": _ayr.is_configured(),
    }


# /health alias — Railway's default healthcheck path. Same body as /healthcheck.
@app.get("/health")
def health() -> dict:
    return healthcheck()
