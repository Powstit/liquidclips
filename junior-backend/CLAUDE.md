# Liquid Clips Backend (junior-backend) — agent guide

FastAPI on Railway. Auth + tier resolution + license JWT issuance for the desktop + account-app, plus the Ayrshare social-publishing proxy + Stripe Connect + Whop webhooks.

## Production

- **Live URL:** `https://junior-backend-production.up.railway.app` + custom domain `https://api.jnremployee.com`
- **Health:** `GET /healthcheck` → `{status:"ok", ayrshare_configured: bool, ...}`. `/health` is an alias.
- **Deploy method:** `railway up --service junior-backend` from this folder. GitHub source on the Railway service is DISCONNECTED (local main was 31 commits ahead of origin when deployed — git-triggered deploy would have rolled prod back).
- **Source of truth:** local `main` is ahead of GitHub origin in some sessions. Confirm with `git log --oneline -10` before pushing.

## Run locally

```bash
.venv/bin/uvicorn app.main:app --reload --port 8000
```

First boot generates an Ed25519 keypair in `.junior-keys/`. Don't commit it. Production uses `JWT_PRIVATE_PEM` / `JWT_PUBLIC_PEM` env vars.

## Smoke endpoints

```bash
# health (includes Ayrshare config status)
curl http://localhost:8000/healthcheck

# fake a Clerk user creation (dev mode bypasses svix verification)
curl -X POST http://localhost:8000/webhooks/clerk -H "content-type: application/json" -d '{
  "type": "user.created",
  "data": {
    "id": "user_test_abc",
    "primary_email_address_id": "idn_1",
    "email_addresses": [{"id": "idn_1", "email_address": "test@example.com"}],
    "unsafe_metadata": {"affiliate_id": "aff_test123"}
  }
}'

# mint a license JWT
curl -X POST http://localhost:8000/desktop/connect -H "content-type: application/json" -d '{
  "clerk_user_id": "user_test_abc",
  "challenge": "ch_xxx"
}'

# /sync with the JWT
JWT="<paste from above>"
curl http://localhost:8000/sync -H "authorization: Bearer $JWT"
```

## Major routes

| Route | Purpose |
|---|---|
| `/healthcheck`, `/health` | Liveness + `ayrshare_configured` |
| `/webhooks/clerk`, `/webhooks/whop`, `/webhooks/stripe` | svix + HMAC-verified webhook handlers (idempotent via `WebhookEvent.external_id`) |
| `/desktop/connect`, `/desktop/public-key` | License JWT issuance + offline public key |
| `/sync` | Tier + entitlement refresh, auto-rotate JWT when ≤5 days remaining |
| `/me`, `/me/affiliate` | Self-info (debug panel + affiliate dashboard) |
| `/social/*` | Ayrshare connection management (connect, refresh, disconnect, list) |
| `/publish-now` | Multi-platform Ayrshare post (multipart upload from desktop) |
| `/schedules` | Per-clip scheduling (currently legacy Postiz model; sprint #3 refactor in flight) |
| `/usage/*` | Free-tier 100-clip starter pass + IP-pool gate |
| `/whop/*` | Whop content rewards proxy |
| `/stripe-connect/*` | Stripe Connect Express onboarding for affiliate payouts |
| `/affiliate/*` + `/redirect/*` | First-touch affiliate attribution + tracking link redirects |
| `/notifications`, `/updates`, `/telemetry`, `/onboarding`, `/admin` | Supporting endpoints |

Pending: `/leaderboard/earnings` (sprint #14a), `/proxy/llm` for hosted LLM (sprint #8).

## Architecture rules

- **Don't mirror Whop's full subscription record.** Cache `whop_user_id`, `paid_until`, `subscription_status` only. Whop is the source of truth.
- **NEVER overwrite `users.affiliate_id`** — first-touch locked at signup per `oauth-billing.md` §6.
- **Webhooks are idempotent.** `WebhookEvent.external_id` is unique; check it before processing.
- **License JWTs are Ed25519, 30-day expiry, auto-rotated by `/sync` when ≤5 days remaining.** Bundle the public key in the desktop binary; don't fetch it at runtime.
- **No async DB.** Sync SQLAlchemy 2.x with FastAPI's threadpool. Don't migrate to async without a real perf reason.
- **Idempotent schema migrations.** `app/main.py` lifespan runs `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` blocks per column. New columns get added there; alembic not adopted yet.
- **Legacy tier aliases:** `channel/growth → pro`, `autopilot → agency` via `_LEGACY_TIER_ALIASES` in `app/features.py`. The 4-tier matrix (Free / Solo / Pro / Agency) is the v2 truth; legacy names map to it transparently. Founder kept as backend flag only — UI hides it (per Daniel's 2026-05-31 decision).

## Tier matrix v2 (free / solo / pro / agency)

Defined in `app/features.py FEATURES_BY_TIER`. Each tier has `clips_per_ip`, `accounts_included`, `watermark`, `sub_accounts`, `white_label`, plus the existing feature flags (publish_now, schedule_one, drip_scheduling, hosted_transcribe, hosted_llm, etc).

`account_limit(tier, extra_packs, founder)` helper returns the social-account ceiling. Each Account Pack unit ($6/mo Clerk add-on) adds 1 extra account (was 5 per $40 pack pre-2026-06-01 — switched to per-account economics when the per-pack price proved unprofitable).

## Ayrshare integration

- Library: `app/ayrshare.py` — httpx-based client. `post()`, `media_upload()`, `history()`, `analytics()`, `cancel_scheduled()`, `check_key()`, `is_configured()`.
- Auth: org-wide `AYRSHARE_API_KEY` (set on Railway) + per-user `Profile-Key` header.
- Users connect by pasting their Profile Key in Settings → Connections (no OAuth dance — Ayrshare's hosted linking page handles the actual social OAuth on their domain).
- Storage: `social_connections` table, one row per user.

## Deploy to Railway

```bash
cd ~/Desktop/jnr/junior-backend
railway up --service junior-backend
```

`railway.json` pins:
- start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- healthcheckPath: `/healthcheck`
- numReplicas: 1 (mandatory — in-process APScheduler cron)

## Env vars (see `.env.example`)

`DATABASE_URL`, `JWT_PRIVATE_PEM`, `JWT_PUBLIC_PEM`, `CORS_ORIGINS`, `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `CLERK_WEBHOOK_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, `OPENAI_API_KEY`, `POSTHOG_KEY`, `POSTHOG_HOST`, `JUNIOR_ADMIN_EMAILS`, `AYRSHARE_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

## Current sprint

See `~/Desktop/COMPLETION_SPRINT.md`. Backend items for the public-launch sprint:
- #8 `/proxy/llm` hosted LLM proxy + tier-gate (Kimi)
- #14a `/leaderboard/earnings` (Claude)
- #12 Stripe Connect + Whop sign-in polish (Claude, partially backend)
