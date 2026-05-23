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

    # Clerk — webhook signing secret only (no SDK call from backend in v1.0).
    clerk_webhook_secret: str = ""  # svix signing secret from Clerk dashboard

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

    # Resend — transactional onboarding email. Free dev tier is 100/day; pro
    # tier kicks in when we wire billing properly. Domain jnremployee.com is
    # verified in Resend already; the from address must be on a verified domain.
    resend_api_key: str = ""
    resend_from: str = "Junior <hello@jnremployee.com>"
    resend_reply_to: str = "danieldiyepriye@gmail.com"

    # Public site URL — used inside email templates for absolute links to
    # /privacy /terms /unsubscribe etc. so creators can verify the brand in
    # any mail client.
    public_site_url: str = "https://jnremployee.com"
    account_site_url: str = "https://account.jnremployee.com"
    app_download_url: str = "https://jnremployee.com/download"

    # PostHog — observability only (funnel events, attribution debugging).
    # Backend uses the PROJECT key, same as the frontends — there's no need
    # for a personal API key. Empty key disables sends so we can run the
    # backend locally without a PostHog account.
    posthog_key: str = ""
    posthog_host: str = "https://us.i.posthog.com"

    # CORS — which origins can hit us. Railway sets the real list.
    cors_origins: str = "http://localhost:3000,http://localhost:3500,http://localhost:1420"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
