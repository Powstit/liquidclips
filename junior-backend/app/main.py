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
from app.db import Base, engine
from app.routes import admin, affiliate, analytics, auth_whop, bonus_ledger, campaigns, channels, community, connections, desktop, doctrine, leaderboard, me, notifications, onboarding, promo, proxy_llm, publish, redirect, reward_clips, schedules, social, stripe_connect, submissions, sync, telemetry, tiktok_verify, transcribe, updates, usage, webhooks_ayrshare, webhooks_clerk, webhooks_stripe, webhooks_whop, whop

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
        # Partner Engine (LiquidClips-Partner-Engine.md). The YT-Partner-style
        # ladder: clip bounties (open) → dedicated TikTok ($10 RPM) → Partner
        # (50% recurring) at 10 paid referrals + verified dedicated account.
        # referred_paid_subs is incremented by webhooks_whop._handle_payment_succeeded
        # on the first trial→paid transition (and decremented on invalid/refund).
        # The unlock service POSTs a per-affiliate Whop commission override and
        # records its id here so we can later archive/update it.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_paid_subs integer NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS tiktok_handle varchar",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS tiktok_verification_code varchar",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS tiktok_verified_at timestamptz",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS partner_unlocked_at timestamptz",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS whop_commission_override_id varchar",
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
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS whop_campaign_id varchar",
        "ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS whop_campaign_url varchar",
        "CREATE INDEX IF NOT EXISTS ix_sponsored_campaigns_mission_type ON sponsored_campaigns (mission_type)",
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
app.include_router(auth_whop.router)
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
app.include_router(tiktok_verify.router)
app.include_router(admin.router)
app.include_router(campaigns.router)
app.include_router(bonus_ledger.router)
app.include_router(community.router)
app.include_router(promo.router)
app.include_router(redirect.router)
app.include_router(reward_clips.router)
app.include_router(proxy_llm.router)
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
