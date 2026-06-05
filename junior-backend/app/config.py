"""Backend configuration loaded from env vars.

Local dev defaults work without a `.env` file. Railway injects all of these
as managed env vars in production.
"""

from __future__ import annotations

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Where the API runs. Railway sets PORT; we honour it.
    port: int = 8000

    # Database. Local SQLite by default; Railway sets DATABASE_URL to Postgres.
    database_url: str = "sqlite:///./junior-backend.db"

    # Clerk — webhook signing secret + a secret key for writing user metadata
    # back (so publicMetadata.tier/status/founder stays in sync with the DB on
    # Whop/Clerk billing transitions; empty disables the write-back).
    clerk_webhook_secret: str = ""  # svix signing secret from Clerk dashboard
    clerk_secret_key: str = ""      # sk_live_… — Clerk Backend API (metadata sync)

    # Whop — webhook signing + outbound API for affiliate updates etc.
    whop_webhook_secret: str = ""
    whop_api_key: str = ""
    whop_company_id: str = "biz_0IMrpJRrTJID1u"
    whop_app_id: str = "app_hLphExdFzjEQsM"

    # License JWT signing — Ed25519. Generated on first boot if absent and
    # written to JUNIOR_JWT_PRIVATE_PEM (env) for Railway persistence.
    jwt_private_pem: str = ""  # PEM-encoded private key; auto-generated locally
    jwt_public_pem: str = ""   # PEM-encoded public key
    jwt_issuer: str = "junior-backend"
    jwt_ttl_days: int = 30

    # OpenAI / Anthropic — for the /proxy/llm endpoint (embedded-key tiers).
    openai_api_key: str = ""
    anthropic_api_key: str = ""

    # Resend — transactional onboarding email. v0.6.11 — Switched to the brand
    # domain `liquidclips.app` (was `jnremployee.com`, which leaked the old
    # internal brand to customers and looked promotional to spam filters).
    #
    # REQUIRED before this flips live in prod:
    #   1. Verify `liquidclips.app` in Resend dashboard (https://resend.com/domains)
    #   2. Publish SPF + DKIM + DMARC DNS records Resend provides
    #   3. Optionally publish BIMI for the brand glyph in Gmail
    # Without those, Gmail/Outlook drop sends to Spam — which is exactly the
    # bug a tester reported.
    resend_api_key: str = ""
    resend_from: str = "Liquid Clips <hello@liquidclips.app>"
    resend_reply_to: str = "hello@liquidclips.app"

    # Internal admin notification recipients — receive the "new paid customer"
    # alert every time someone activates a subscription (Whop), pays a
    # successful invoice, or unlocks the founder £1 commit. Comma-separated
    # in the env var; defaults to the same address used for reply-to.
    # Override on Railway with `JUNIOR_ADMIN_EMAILS=a@x.com,b@x.com`.
    admin_emails: str = "danieldiyepriye@gmail.com"

    # Public site URL — used inside email templates for absolute links to
    # /privacy /terms /unsubscribe etc. so creators can verify the brand in
    # any mail client.
    public_site_url: str = "https://liquidclips.app"
    account_site_url: str = "https://account.liquidclips.app"
    app_download_url: str = "https://liquidclips.app/download"
    tauri_update_endpoint: str = "https://updates.liquidclips.app/latest.json"
    tauri_update_targets: str = "darwin-aarch64,darwin-x86_64"
    whop_manage_url: str = "https://whop.com/jnremployee"
    # partner.liquidclips.app was a planned subdomain that never had a Vercel
    # deployment, so clicks from AffiliateHero / PayoutsTab landed on a
    # Vercel DEPLOYMENT_NOT_FOUND. Pointing at the working jnremployee.com
    # partner redirect chain (307 → /affiliates) until partner.liquidclips.app
    # ships a real deployment. Override per-env on Railway via
    # WHOP_PARTNER_DASHBOARD_URL when ready.
    whop_partner_dashboard_url: str = "https://partner.liquidclips.app"
    whop_payouts_url: str = "https://whop.com/dashboard/payouts"
    stripe_connect_onboarding_url: str = "https://account.liquidclips.app/dashboard#payouts"

    # Stripe Connect — Express accounts for non-Whop affiliate payouts. When
    # stripe_secret_key is empty, the onboarding endpoint returns 503; Whop
    # affiliates still work because they use the Whop partner dashboard URL.
    stripe_secret_key: str = ""
    stripe_connect_webhook_secret: str = ""   # whsec_… for /webhooks/stripe-connect
    stripe_connect_default_country: str = "GB"
    stripe_connect_return_url: str = "https://account.liquidclips.app/dashboard?stripe_return=1"
    stripe_connect_refresh_url: str = "https://account.liquidclips.app/dashboard?stripe_refresh=1"

    # PostHog — observability only (funnel events, attribution debugging).
    # Backend uses the PROJECT key, same as the frontends — there's no need
    # for a personal API key. Empty key disables sends so we can run the
    # backend locally without a PostHog account.
    posthog_key: str = ""
    posthog_host: str = "https://us.i.posthog.com"

    # Server-to-server shared secret for the account-app dashboard → backend
    # reads (e.g. /affiliate/me). The account-app server component sends it as
    # x-internal-secret; never exposed to the browser. Empty = allow (local dev).
    internal_api_secret: str = ""

    # CORS — which origins can hit us. Railway sets the real list.
    # Includes the packaged Tauri webview origins: macOS serves the app from
    # tauri://localhost; Windows/Linux from http(s)://tauri.localhost. Without
    # these, browser-side packaged calls (e.g. notifications/unread-count) fail
    # the CORS preflight with 400 even though sidecar→backend calls are fine.
    cors_origins: str = (
        "http://localhost:3000,http://localhost:3500,http://localhost:1420,"
        "tauri://localhost,https://tauri.localhost,http://tauri.localhost"
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
