# Liquid Clips 2.0 — Master Reference

Operator handoff document. Single source of truth for every service, dashboard,
URL, env var, deploy path, and webhook used by Liquid Clips. Pair this with the
2.0 dependency map at `~/Desktop/LIQUID_CLIPS_2_DEPENDENCY_MAP.md` (the
architectural plan).

**Source-of-truth rule.** If anything below conflicts with
`/Users/dipdip/code/jnr/DEPLOYMENT.md`, that file wins. Update both when
topology changes.

---

## 0. Identity, repos, brand

| Item                       | Value                                                    |
| -------------------------- | -------------------------------------------------------- |
| Brand (public)             | Liquid Clips                                             |
| Bundle ID (Tauri / Apple)  | `app.liquidclips.desktop`                                |
| Source-tree codename       | `junior-desktop` (legacy folder name; do not rename)     |
| Canonical repo             | `/Users/dipdip/code/jnr`                                 |
| Frozen stale copy          | `/Users/dipdip/Desktop/jnr_STALE_DO_NOT_USE_0.7.56`      |
| Marketing site             | https://liquidclips.app                                  |
| Account / embed app        | https://account.liquidclips.app                          |
| Backend (FastAPI)          | https://api.liquidclips.app                              |
| Legacy alias (still live)  | https://api.jnremployee.com (backend), https://account.jnremployee.com (account) |
| GitHub repo                | (in `/Users/dipdip/code/jnr`, push to `main`)            |
| Deep-link scheme           | `liquidclips://`                                         |

Brand tokens (one fuchsia, one ink, one paper):
- Fuchsia `#FF1A8C`
- Ink `#0B0B10`
- Paper (light surface)

---

## 1. Service inventory — every account we touch

Each row tells the operator: what it does, the production dashboard URL,
where the keys live locally, where the keys live remotely, and which
surface uses it.

### 1.1 Clerk — auth, sessions, billing

| Field                | Value                                                                       |
| -------------------- | --------------------------------------------------------------------------- |
| Purpose              | User auth (sign-in, sessions). Webhooks notify backend of user lifecycle.   |
| Dashboard            | https://dashboard.clerk.com                                                 |
| Local secret file    | `~/.claude-credentials/clerk.env`                                           |
| Used by              | account-app (frontend + middleware), junior-backend (webhook verification)  |
| Webhook endpoint     | `POST https://api.liquidclips.app/webhooks/clerk`                           |
| Webhook signing      | svix — secret env name `CLERK_WEBHOOK_SECRET` on Railway                    |
| Vercel env (account-app) | `CLERK_SECRET_KEY` + `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`                |
| Rotation             | Dashboard → API Keys → rotate. Update local file + Vercel env + restart.    |
| Note                 | Billing API is **read-only** (`Allow: GET`). Plan CRUD is dashboard-only.   |

### 1.2 Whop — license, checkout, community, affiliate

| Field                | Value                                                                        |
| -------------------- | ---------------------------------------------------------------------------- |
| Purpose              | Affiliate checkout door, license verification, community rooms (paid users). |
| Dashboard            | https://whop.com/dashboard                                                   |
| Local secret file    | `~/.claude-credentials/whop.env`                                             |
| Used by              | junior-backend (`/whop/*` proxy + `/webhooks/whop`), account-app `/upgrade`  |
| Company ID           | `biz_0IMrpJRrTJID1u`                                                         |
| App ID               | `app_hLphExdFzjEQsM`                                                         |
| Webhook endpoint     | `POST https://api.liquidclips.app/webhooks/whop`                             |
| Webhook signing      | HMAC — secret env name `WHOP_WEBHOOK_SECRET` on Railway                      |
| Backend API key env  | `WHOP_API_KEY` on Railway                                                    |
| Vercel env (account-app) | `NEXT_PUBLIC_WHOP_CHECKOUT_PLAN_ID`                                      |
| Rotation             | Whop dashboard → Developer → rotate; update Railway + Vercel + local mirror. |

### 1.3 Stripe — direct subscriptions, Connect for affiliate payouts

| Field                | Value                                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| Purpose              | Direct (non-affiliate) checkout. Stripe Connect Express for payouts.   |
| Dashboard            | https://dashboard.stripe.com                                           |
| Local secret file    | `~/.claude-credentials/stripe.env`                                     |
| Used by              | junior-backend (`/webhooks/stripe` + `/stripe-connect/*`), account-app |
| Webhook endpoint     | `POST https://api.liquidclips.app/webhooks/stripe`                     |
| Backend env vars     | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` on Railway                |
| Rotation             | Stripe dashboard → Developers → rotate; update Railway + local mirror. |

### 1.4 Ayrshare — social publishing backend

| Field                | Value                                                                            |
| -------------------- | -------------------------------------------------------------------------------- |
| Purpose              | Multi-platform posting + scheduling (TikTok / IG / YT / X / FB / LinkedIn / etc).|
| Dashboard            | https://app.ayrshare.com                                                         |
| Plan                 | Business plan (was $599/mo, 30 profiles) — confirm current tier in dashboard.    |
| Local secret file    | `~/.claude-credentials/ayrshare.env`                                             |
| Local RSA key        | `~/.claude-credentials/ayrshare-rsa-private.key`                                 |
| Used by              | junior-backend (`/social/*`, `/publish-now`); desktop calls backend, not Ayrshare|
| Backend env var      | `AYRSHARE_API_KEY` on Railway (org-wide)                                         |
| Per-user keys        | Stored on backend in `social_connections.ayrshare_profile_key` (pasted in UI)    |
| Auth flow            | User pastes Profile Key in Settings → Connections. No OAuth dance on desktop.    |
| Failure mode         | When env unset, backend returns 503 "beta" → desktop publish UI degrades gracefully. |

### 1.5 Railway — backend hosting + Postgres

| Field                  | Value                                                                |
| ---------------------- | -------------------------------------------------------------------- |
| Purpose                | Runs `junior-backend` FastAPI service + managed Postgres.            |
| Dashboard              | https://railway.app                                                  |
| Local secret file      | `~/.claude-credentials/railway.env` (`RAILWAY_API_TOKEN`)            |
| Service name           | `junior-backend`                                                     |
| Live URL               | https://junior-backend-production.up.railway.app                     |
| Custom domain          | https://api.liquidclips.app (primary) + https://api.jnremployee.com (legacy) |
| Healthcheck            | `GET /healthcheck` → 200 with JSON                                   |
| GitHub source          | **DISCONNECTED ON PURPOSE.** Pushing to main does NOT redeploy.      |
| Why disconnected       | Local main has been 31+ commits ahead of GH; auto-deploy would roll back prod. |
| Number of replicas     | 1 (mandatory — in-process APScheduler cron).                         |
| Deploy command         | `cd /Users/dipdip/code/jnr/junior-backend && railway up --service junior-backend --detach` |
| Required Railway vars  | See §2 below (full list).                                            |
| Postgres host          | `postgres.railway.internal` — resolves ONLY inside Railway private network. Do not seed from local. |
| Seed semantics         | Community channels + Uncle Daniel campaigns auto-seed idempotently on lifespan startup. |

### 1.6 Vercel — marketing + account-app + (future) admin

| Field                | Value                                                                       |
| -------------------- | --------------------------------------------------------------------------- |
| Purpose              | Hosts `liquidclips-marketing` (public site) and `account-app` (Clerk app).  |
| Dashboard            | https://vercel.com/dashboard                                                |
| Local secret files   | `~/.claude-credentials/vercel.env`, `~/.claude-credentials/vercel-junior.env` |
| GitHub link          | **Not git-linked.** Pushing to main does NOT auto-deploy either project.    |
| Deploy method        | Vercel CLI, manual, per project. See §3.                                    |
| Account-app project  | Production alias `account.liquidclips.app` (also serves `account.jnremployee.com`) |
| Marketing project    | Production alias `liquidclips.app`                                          |
| Account ownership    | mrddokubo owns "Liquidclips" team. account-app/marketing deploy to a separate team. Use dashboard for switch. |
| CLI version          | Keep `vercel@latest` (currently outdated locally — upgrade with `npm i -g vercel@latest`). |

### 1.7 GitHub — source + Actions + Releases (desktop ship)

| Field                | Value                                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| Purpose              | Code host + CI/CD for desktop notarisation + Release hosting.          |
| Dashboard            | https://github.com (repo URL stored locally)                           |
| CI workflow          | `.github/workflows/release.yml` — tag-triggered `on: push: tags: ['v*']`.|
| Triggered by         | `git push origin v0.7.63` (or any `v*` tag).                           |
| Not triggered by     | Pushing to `main`.                                                     |
| Required secrets     | 5 Apple notarisation secrets (see §1.8) + updater signing key.         |
| Auto-update manifest | Latest GitHub Release `latest.json` is fetched by installed desktop apps. |
| Marketing `/download`| Resolves the latest published GH Release asset.                        |

### 1.8 Apple Developer — Developer ID + notarisation

| Field                | Value                                                                         |
| -------------------- | ----------------------------------------------------------------------------- |
| Purpose              | Code signing + notarisation so macOS Gatekeeper allows the DMG.               |
| Dashboard            | https://developer.apple.com/account                                           |
| Team ID              | `KT68NGT4LX`                                                                  |
| Common Name          | `Developer ID Application: daniel diyepriye dokubo (KT68NGT4LX)`              |
| Local cert location  | Login keychain (already imported)                                             |
| CI secrets (GH)      | All 5 set 2026-06-02. CI auto-notarises. Do NOT re-ask.                       |
| Iron-gate            | IG-013 locks notarisation chain (`scripts/notarize.sh` + workflow + 5 secrets) |
| Local cloud-ship     | `scripts/cloud-ship.sh` does NOT notarise; CI is the only signed-DMG path.    |
| Ship-script          | `desktop/scripts/ship.sh <version> "notes"` — enforces clean tree + verifies live manifest before claiming success. |

### 1.9 OpenAI — LLM clip-pick + hosted LLM proxy

| Field                | Value                                                            |
| -------------------- | ---------------------------------------------------------------- |
| Purpose              | LLM clip selection (Free tier = BYO key, Pro+ tier = backend proxy). |
| Dashboard            | https://platform.openai.com                                      |
| Local secret file    | `~/.claude-credentials/openai.env`                               |
| Backend env var      | `OPENAI_API_KEY` on Railway                                      |
| Desktop env var      | Read from keychain (user pastes BYO key) OR falls back to `.env` |
| Rotation             | OpenAI dashboard → API Keys → rotate; update Railway + local mirror. |

### 1.10 Anthropic — LLM clip-pick (alternative provider)

| Field                | Value                                                            |
| -------------------- | ---------------------------------------------------------------- |
| Purpose              | Alternative LLM for clip selection via Claude.                   |
| Dashboard            | https://console.anthropic.com                                    |
| Local secret file    | Not currently mirrored as a dedicated `.env`. Stored in user keychain when BYO. |
| Backend env var      | `ANTHROPIC_API_KEY` on Railway                                   |

### 1.11 Resend — transactional email

| Field                | Value                                                  |
| -------------------- | ------------------------------------------------------ |
| Purpose              | Email (signup, password reset, payment receipts).      |
| Dashboard            | https://resend.com                                     |
| Local secret file    | `~/.claude-credentials/resend.env`                     |
| Backend env vars     | `RESEND_API_KEY`, `RESEND_FROM` on Railway             |
| Domain setup         | DNS records (SPF / DKIM / DMARC) on Liquid Clips domain — verify in Resend dashboard. |

### 1.12 PostHog — product analytics

| Field                | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| Purpose              | Funnel + event tracking (Phase 1 events shipped 2026-05-24).      |
| Dashboard            | https://posthog.com (US instance unless configured otherwise)     |
| Local secret file    | `~/.claude-credentials/posthog.env`                               |
| Backend env vars     | `POSTHOG_KEY`, `POSTHOG_HOST` on Railway                          |
| Frontend env vars    | `NEXT_PUBLIC_POSTHOG_KEY` + `NEXT_PUBLIC_POSTHOG_HOST` on Vercel (account-app + marketing) |
| Rule                 | Keep event names stable across 2.0 cutover so funnel reports continue. |

### 1.13 Sentry — error tracking

| Field                | Value                                                  |
| -------------------- | ------------------------------------------------------ |
| Purpose              | Error tracking for marketing + account-app (and backend if configured). |
| Dashboard            | https://sentry.io                                      |
| Local secret file    | `~/.claude-credentials/sentry-auth-token`              |
| Frontend configs     | `liquidclips-marketing/sentry.edge.config.ts`, `sentry.server.config.ts`, `instrumentation-client.ts` |
| Vercel env vars      | `SENTRY_AUTH_TOKEN`, `NEXT_PUBLIC_SENTRY_DSN`          |

### 1.14 Cloudinary — image / video CDN

| Field                | Value                                                  |
| -------------------- | ------------------------------------------------------ |
| Purpose              | Marketing assets, sponsored-rewards card art, story keyframes. |
| Dashboard            | https://cloudinary.com                                 |
| Cloud name           | `dot2wsqmd` (Catjack tenant — also used for Liquid)    |
| API key              | Stored in API Keys note (see §1.16)                    |
| Used by              | Marketing site `<Image>` tags + backend OG-image generator (if used). |

### 1.15 Modal + Replicate — hosted GPU compute (Pro+ moat)

| Field                | Value                                                       |
| -------------------- | ----------------------------------------------------------- |
| Purpose              | GPU transcribe (faster-whisper) + LLM proxy (Pro/Agency).   |
| Dashboards           | https://modal.com · https://replicate.com                   |
| Backend env vars     | Feature-flag gated in `app/features.py`. Not yet live in prod (sprint #14b). |
| Used by              | junior-backend `/proxy/llm` (planned), `/proxy/transcribe`. |
| Note                 | Stay env-var-off until sprint #14b lands.                   |

### 1.16 BYO content / generation services (operator info)

These are Daniel's content tools — not part of the Liquid Clips runtime, but
the operator should know which dashboard owns which asset.

| Service              | Dashboard                              | Local file                                 | Plan / Note                                 |
| -------------------- | -------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| fal.ai               | https://fal.ai                         | (in API Keys note)                         | Seedance video / image gen.                 |
| Leonardo             | https://leonardo.ai                    | (in API Keys note)                         | Image gen.                                  |
| Higgsfield           | https://higgsfield.ai                  | `~/.config/higgsfield/credentials.json`    | Ultra plan. Web UI + CLI (`higgsfield`).    |
| Giphy / Pexels / Pixabay | (individual)                       | Desktop `.env` BYO                         | Asset / Reactions picker fallback.          |

API key reference doc (per memory): always check `[[api_keys]]` before saying
"key not available."

---

## 2. junior-backend on Railway — full env var list

Source: `junior-backend/.env.example` + backend `CLAUDE.md`.

**Set these on Railway dashboard → `junior-backend` service → Variables.**

```
# Server
PORT                          (Railway sets automatically)
DATABASE_URL                  (auto-injected by Railway when Postgres is linked)

# Auth + webhooks
CLERK_WEBHOOK_SECRET          (from Clerk dashboard → Webhooks → svix secret)
WHOP_WEBHOOK_SECRET           (from Whop dashboard → Developer)
WHOP_API_KEY                  (from Whop dashboard → Developer)
WHOP_COMPANY_ID=biz_0IMrpJRrTJID1u
WHOP_APP_ID=app_hLphExdFzjEQsM
STRIPE_SECRET_KEY             (Stripe dashboard → Developers → API keys)
STRIPE_WEBHOOK_SECRET         (Stripe dashboard → Developers → Webhooks)

# License JWT (Ed25519, PEM-encoded)
JWT_PRIVATE_PEM               (generate once, paste here)
JWT_PUBLIC_PEM                (paste; also bundle in desktop binary)
JWT_ISSUER=junior-backend
JWT_TTL_DAYS=30

# LLM (Pro/Agency tiers)
OPENAI_API_KEY                (OpenAI dashboard)
ANTHROPIC_API_KEY             (Anthropic console)

# Social publishing
AYRSHARE_API_KEY              (Ayrshare dashboard → Profile → API key)

# Email
RESEND_API_KEY                (Resend dashboard → API Keys)
RESEND_FROM                   (verified sender email)

# Analytics
POSTHOG_KEY                   (PostHog dashboard → Project → API key)
POSTHOG_HOST                  (e.g. https://us.i.posthog.com)

# Admin
JUNIOR_ADMIN_EMAILS           (comma-separated, emails that get /admin access)
INTERNAL_API_SECRET           (long random string — also set on account-app Vercel)

# CORS (must include tauri:// origins for the desktop webview)
CORS_ORIGINS=http://localhost:3000,http://localhost:3500,http://localhost:1420,https://account.liquidclips.app,https://account.jnremployee.com,https://liquidclips.app,tauri://localhost,https://tauri.localhost,http://tauri.localhost
```

**Local-only seed defaults** (sqlite + autogen keys). When `DATABASE_URL`
is unset, backend falls back to `sqlite:///./junior-backend.db`. When
`JWT_PRIVATE_PEM` is unset, lifespan generates a keypair in
`.junior-keys/`. **Never commit either.**

### Railway-specific gotchas

1. `postgres.railway.internal` only resolves inside Railway. Local seeds will
   fail with "could not translate host name." Use Admin HQ CRUD endpoints
   instead (`/admin/community/channels`, `/admin/banners`,
   `/admin/announcements`, `/admin/bonus-ledger`).
2. Seeds run automatically on lifespan startup since commit `d849b69`.
   Idempotent (upsert by slug). Pre-existing values (e.g. `whop_channel_id`
   pasted via Admin HQ) survive every redeploy.
3. `numReplicas` MUST stay at 1. In-process APScheduler cron breaks with >1.
4. GitHub source is intentionally disconnected. Re-connecting would roll
   prod back to whatever was last on GH `main`.

---

## 3. Deploy commands per surface

All from `/Users/dipdip/code/jnr`. Source the relevant credential env file
before running.

### 3.1 account-app

```bash
source ~/.claude-credentials/vercel-junior.env
cd /Users/dipdip/code/jnr/account-app
vercel deploy --prod --yes --token "$VERCEL_TOKEN"
```

After: confirm `/embed/earn` has no `frame-ancestors` deny (it must embed in
the desktop child webview):

```bash
curl -sI https://account.liquidclips.app/embed/earn | grep -iE 'content-security|x-frame'
# Pass = NO output.
```

### 3.2 liquidclips-marketing

```bash
source ~/.claude-credentials/vercel-junior.env
cd /Users/dipdip/code/jnr/liquidclips-marketing
vercel deploy --prod --yes --token "$VERCEL_TOKEN"
```

After: `curl -sI https://liquidclips.app/ | head -3` → 200. Verify
`/download` route resolves the latest GitHub Release asset.

### 3.3 junior-backend

```bash
cd /Users/dipdip/code/jnr/junior-backend
railway up --service junior-backend --detach
until curl -s -o /dev/null -w "%{http_code}" https://api.liquidclips.app/healthcheck | grep -q "200"; do sleep 5; done
```

Verify:

```bash
curl -s https://api.liquidclips.app/healthcheck | python3 -m json.tool
curl -s https://api.liquidclips.app/community/channels \
  | python3 -c "import json,sys; print('channels:', len(json.load(sys.stdin)['channels']))"
# expected: 9
```

### 3.4 Desktop (Liquid Clips.app)

Tag-triggered CI only. Local builds are review-only.

```bash
cd /Users/dipdip/code/jnr
bash desktop/scripts/ship.sh 0.8.0 "release notes"
```

`ship.sh` enforces clean tree, on main, version not already shipped, signs
+ notarises + staples DMG, uploads to draft GH Release, verifies live
manifest before claiming success.

**Hard rule:** never hand-distribute a locally built DMG. CI is the only
signed-DMG path.

---

## 4. Webhook routing — who calls what

| Caller                | Path on `api.liquidclips.app`     | Verification               | Backend handler                          |
| --------------------- | ---------------------------------- | -------------------------- | ---------------------------------------- |
| Clerk                 | `POST /webhooks/clerk`            | svix sig + `CLERK_WEBHOOK_SECRET` | user.created / user.updated / session.* |
| Whop                  | `POST /webhooks/whop`             | HMAC + `WHOP_WEBHOOK_SECRET`      | subscription.* + affiliate.commission   |
| Stripe                | `POST /webhooks/stripe`           | Stripe sig + `STRIPE_WEBHOOK_SECRET` | invoice.* + customer.subscription.*    |

All webhooks are idempotent via `WebhookEvent.external_id` UNIQUE constraint.
Replays are silently no-op.

In each dashboard, point the webhook URL to the production backend URL
above, paste the signing secret into Railway, and confirm "send test event"
returns 200.

---

## 5. Domain / DNS — who owns what

| Domain                          | DNS provider     | Purpose                              | Set up                                       |
| ------------------------------- | ---------------- | ------------------------------------ | -------------------------------------------- |
| `liquidclips.app`               | (check registrar) | Marketing site (Vercel)              | Vercel project → Domains → add               |
| `account.liquidclips.app`       | same             | account-app (Vercel)                 | Vercel project → Domains → add               |
| `api.liquidclips.app`           | same             | junior-backend (Railway)             | Railway service → Settings → Domains → add custom domain → set CNAME |
| `api.jnremployee.com` (legacy)  | jnremployee.com  | Legacy backend alias                 | Already configured; keep until 2.0 cutover.  |
| `account.jnremployee.com` (legacy) | same          | Legacy account-app alias             | Already configured; keep until 2.0 cutover.  |
| `connect.jnremployee.com`       | same             | Postiz multi-tenant (if used)        | Hidden surface; rarely visited.              |
| Resend DKIM / SPF / DMARC       | per-domain       | Email auth                           | Resend dashboard → Domains → verify DNS rows.|

---

## 6. Auth-keychain invariant (IG-014) — operator must not violate

**Rule.** The desktop must never read the macOS keychain on app launch.
Reads only happen when the user clicks a reveal button.

| Item                  | Value                                                              |
| --------------------- | ------------------------------------------------------------------ |
| Central module        | `desktop/src/lib/authStorage.ts`                                   |
| Keychain namespace    | `app.liquidclips.auth.v1`                                          |
| Pre-commit guard      | `desktop/scripts/assert-no-passive-keychain.sh`                    |
| Test                  | `desktop/tests/no-passive-keychain.test.mjs`                       |
| Canonical doc         | `desktop/docs/auth-keychain-invariant.md`                          |
| Why this matters      | v1 prompted keychain access on launch + on Settings open; Daniel hated it. |
| 2.0 corollary         | EARN section must not call Whop on launch either (see dependency map FLOW_011). |

---

## 7. Iron gates (locked sections) — never delete without explicit override

Sentinels in code: `IRON GATE IG-NNN`. Pre-commit hook blocks any diff that
removes a sentinel unless `IRON_GATE_OVERRIDE=1` is set with a reason.

| ID     | Locks                                                                  |
| ------ | ---------------------------------------------------------------------- |
| IG-001 | Import pipeline                                                        |
| IG-002 | Sidecar RPC contract                                                   |
| IG-003 | Cinematic intro                                                        |
| IG-004 | Auth + activation                                                      |
| IG-005 | Workspace UI design                                                    |
| IG-006 | Cockpit handoff contracts                                              |
| IG-007 | ClipCard structure                                                     |
| IG-008 | Cockpit room scrollability + BottomCockpit clearance                   |
| IG-009 | Cloud release flow (`scripts/cloud-ship.sh`)                           |
| IG-010 | v0.8.0 non-blocking architecture (sidecar METHODS + 10 bg bridges)     |
| IG-011 | Webview room height cascade (RoomShell `align="stretch"`)              |
| IG-012 | Brand-kit single source of truth (`src/index.css` ↔ demo HTML)         |
| IG-013 | Apple notarisation chain (release.yml + notarize.sh + 5 GH secrets)    |
| IG-014 | Auth-keychain invariant                                                |

Registry: `desktop/docs/IRON_GATES.md`.

When 2.0 starts in `desktop-2/`, it adopts a NEW iron-gate prefix
(`IG-LC2-NNN`) per phase. Old `IG-NNN` gates stay in `desktop/` until
cutover.

---

## 8. v0.7.55 → v0.7.63 live state (last known)

Pulled from `DEPLOYMENT.md §5` + memory (v0.7.63). Confirm before
acting on stale rows.

| Surface          | Status      | Detail                                                                            |
| ---------------- | ----------- | --------------------------------------------------------------------------------- |
| account-app      | READY       | account.liquidclips.app                                                           |
| marketing        | READY       | liquidclips.app                                                                   |
| backend          | HEALTHY     | api.liquidclips.app — `/healthcheck` returns 200 with `ayrshare_configured: true` |
| community seed   | 9 channels  | announcements · free-clipper-lobby · uncle-daniel-clips · viral-reaction-missions · ddb-beauty-clips · ddb-fashion-clips · sponsor-campaigns · premium-rewards-hq · affiliate-growth-room |
| campaigns        | 10          | 7 legacy + 3 Uncle Daniel funnel                                                  |
| desktop          | v0.7.63 not yet released | Public release awaits Daniel's ship-gate sign-off (per [[feedback_ship_gate]]) |

---

## 9. Required smoke tests before every desktop release

From `DEPLOYMENT.md §6`. Walk these against the live deploys before
running `ship.sh`.

- [ ] Free dashboard shows `X / 100 clips remaining` copy.
- [ ] Paid dashboard shows `Premium · no watermark` pill.
- [ ] Free export burns the watermark (pixel invader + `MADE WITH /
      LIQUID/CLIPS` wordmark visible in bottom-right of the exported MP4).
- [ ] Paid export has no watermark.
- [ ] Captions toggle ON burns captions into MP4 bytes.
- [ ] Captions toggle OFF skips captions.
- [ ] Earn page shows `$1 free / $5 premium` ladder, mission filter chips
      with counts, BonusEarnings panel.
- [ ] Upgrade opens Whop checkout embed at `/upgrade`.
- [ ] Checkout complete at `/checkout/complete` clears the sidecar's 10-min
      watermark cache (next export is clean).
- [ ] Admin HQ loads all 5 tabs: Missions, Banners, Announcements,
      Community Channels, Bonus Ledger.
- [ ] Community fallback opens `https://whop.com/liquidclips/` when a room
      has no `whop_channel_id`.
- [ ] Configured rooms open `whop.com/c/<chat_feed_id>`.

Probe a frame from an exported MP4:

```bash
ffmpeg -i /path/to/exported.mp4 -ss 5 -frames:v 1 /tmp/wm-check.png
open /tmp/wm-check.png
```

---

## 10. Secret rotation playbook

Run after every stable release locks. Source: `DEPLOYMENT.md §7`.

| Secret                  | Where to rotate                            | Where to sync                                                          |
| ----------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| OpenAI                  | https://platform.openai.com/api-keys       | `~/.claude-credentials/openai.env` + Railway `OPENAI_API_KEY`          |
| Vercel personal token   | https://vercel.com/account/tokens          | `~/.claude-credentials/vercel-junior.env` + `vercel.env`               |
| `INTERNAL_API_SECRET`   | Railway → junior-backend → Variables       | `~/.claude-credentials/junior-internal.env` + account-app Vercel env   |
| Clerk Secret Key        | Clerk → API Keys                           | `~/.claude-credentials/clerk.env` + account-app Vercel `CLERK_SECRET_KEY` |
| Clerk Webhook Secret    | Clerk → Webhooks → svix                    | Railway `CLERK_WEBHOOK_SECRET` (separate from API key)                 |
| Whop API Key            | Whop → Developer                           | Railway `WHOP_API_KEY` + `~/.claude-credentials/whop.env`              |
| Whop Webhook Secret     | Whop → Developer → Webhooks                | Railway `WHOP_WEBHOOK_SECRET`                                          |
| Stripe Secret Key       | Stripe → Developers → API keys             | Railway `STRIPE_SECRET_KEY` + `~/.claude-credentials/stripe.env`       |
| Stripe Webhook Secret   | Stripe → Developers → Webhooks             | Railway `STRIPE_WEBHOOK_SECRET`                                        |
| Ayrshare API Key        | Ayrshare → Profile                         | Railway `AYRSHARE_API_KEY` + `~/.claude-credentials/ayrshare.env`      |
| Resend API Key          | Resend → API Keys                          | Railway `RESEND_API_KEY` + `~/.claude-credentials/resend.env`          |
| PostHog Project Key     | PostHog → Project Settings                 | Railway `POSTHOG_KEY` + Vercel `NEXT_PUBLIC_POSTHOG_KEY`               |
| Sentry Auth Token       | Sentry → Settings → Auth Tokens            | `~/.claude-credentials/sentry-auth-token` + Vercel `SENTRY_AUTH_TOKEN` |
| Railway / DB password   | Railway → Postgres service → reset         | Auto-injected to linked services. Restart backend.                     |
| Apple updater key       | Local file `desktop/.tauri-updater-key`    | Bundle in CI; rotate carefully — old apps lose update path.            |

### Hard rule on secrets

- Never echo, `cat`, or `grep` raw secret values into terminal output that
  Daniel or an operator can paste into chat.
- If a secret must be shown for confirmation, show only first 4 chars + `…`.
- Mirrored credential files live in `~/.claude-credentials/`. After
  rotation, sync EVERY mirrored location.

---

## 11. 2.0 architecture summary (one paragraph for operator)

Liquid Clips 2.0 rebuilds the desktop shell in `/Users/dipdip/code/jnr/desktop-2/`
alongside the frozen `/desktop/`. Same bundle ID (`app.liquidclips.desktop`).
Same OAuth callbacks. Same `liquidclips://` deep-link scheme. Same backend
(`api.liquidclips.app`). What changes: every primary section (Home / Create /
Browse / Engine / Projects / Schedule / Channels / Community / Earn / Campaigns
/ Settings) owns its own state; Account, Diagnostics, and HQ Bridge render as
Settings sub-tabs; Clipper is a hidden mode/skin route for the supply-side
persona; no global right-side panel; no passive auth or keychain on launch;
no passive Whop calls in Earn. Phases lock incrementally; at Phase 12 the
folders are renamed in one commit (`/desktop` → `/desktop-legacy`,
`/desktop-2` → `/desktop`) and a new desktop release ships under v0.8.0. Full
plan: `~/Desktop/LIQUID_CLIPS_2_DEPENDENCY_MAP.md`.

---

## 12. What an operator does in the first 30 minutes

If a new operator (or future Claude session) has to take over without
context, this is the path.

1. Read this file end to end. Read `~/Desktop/LIQUID_CLIPS_2_DEPENDENCY_MAP.md`.
2. `cd /Users/dipdip/code/jnr && git status` — confirm you're on `main`,
   clean. Confirm version (`grep '"version"' desktop/package.json`).
3. Check live state of every surface:
   ```bash
   curl -sI https://liquidclips.app | head -1
   curl -sI https://account.liquidclips.app | head -1
   curl -s https://api.liquidclips.app/healthcheck | python3 -m json.tool
   ```
   All three must return 200 / `status: ok`.
4. Read `desktop/docs/IRON_GATES.md` before editing anything in
   `desktop/`. Run `grep -rn "IRON GATE" desktop/src` on a file before
   editing.
5. Confirm credentials store is intact: `ls -la ~/.claude-credentials/` —
   24 files, mode 600.
6. Before any deploy: `cat DEPLOYMENT.md` for the canonical recipe.
7. Before any desktop ship: walk §9 smoke tests on a real free + paid
   account.
8. Never push without Daniel's explicit ship-gate sign-off
   ([[feedback_no_push_until_confirmed]]).

---

## 13. Where to find context when this doc is stale

| Question                                  | Source of truth                                            |
| ----------------------------------------- | ---------------------------------------------------------- |
| Deployment topology                       | `/Users/dipdip/code/jnr/DEPLOYMENT.md`                     |
| Desktop architecture, build, iron gates   | `/Users/dipdip/code/jnr/desktop/CLAUDE.md`                 |
| Account-app architecture                  | `/Users/dipdip/code/jnr/account-app/CLAUDE.md`             |
| Backend architecture + routes             | `/Users/dipdip/code/jnr/junior-backend/CLAUDE.md`          |
| Iron-gate registry                        | `/Users/dipdip/code/jnr/desktop/docs/IRON_GATES.md`        |
| Auth-keychain invariant                   | `/Users/dipdip/code/jnr/desktop/docs/auth-keychain-invariant.md` |
| 2.0 dependency map + phases               | `~/Desktop/LIQUID_CLIPS_2_DEPENDENCY_MAP.md`               |
| Brand surface vocabulary                  | `~/.claude/skills/liquid-clips-brand-kit/`                 |
| Ship blockers                             | `/Users/dipdip/code/jnr/desktop/docs/SHIP_v*_BLOCKERS.md`  |
| Forward schedule                          | `/Users/dipdip/code/jnr/desktop/docs/ROADMAP_LOCK.md`      |
| Auto-memory (Claude sessions)             | `~/.claude/projects/-Users-dipdip/memory/MEMORY.md`        |

---

## 14. Operator boundaries — what NOT to do without Daniel's sign-off

- Do NOT push to `main` if working on a multi-phase sequence
  ([[feedback_no_push_until_confirmed]]).
- Do NOT cut a git tag (which triggers desktop CI release) without Daniel
  saying "ship" in the same turn ([[feedback_ship_gate]],
  [[feedback_build_gate]]).
- Do NOT reconnect Railway → GitHub source on `junior-backend`. Local main
  is intentionally ahead.
- Do NOT seed Postgres from a local shell. Use Admin HQ CRUD endpoints.
- Do NOT bypass `desktop/scripts/ship.sh`. It is the only signed-DMG path
  for users.
- Do NOT remove iron-gate sentinels without `IRON_GATE_OVERRIDE=1` AND a
  reason quoted from Daniel's current-turn message.
- Do NOT introduce a second styling library, a UI framework with its own
  tokens (MUI / Chakra / Mantine), Electron, or Redux. All are explicitly
  banned in `desktop/CLAUDE.md`.
- Do NOT add emojis to UI copy.
- Do NOT echo raw secret values into chat output.
- Do NOT renames legacy domains (`*.jnremployee.com`) until 2.0 cutover —
  they're still live for backwards compatibility.

---

## 15. Document hygiene

- Update this file when topology changes. Never let it disagree with
  `DEPLOYMENT.md` or surface-level `CLAUDE.md` files.
- When an operator finishes a session, append a one-line entry to a
  `CHANGELOG` section at the bottom of this file noting what changed (no
  full diff — just the topology fact).

```
CHANGELOG
---------
2026-06-16  Initial master reference created for Liquid Clips 2.0 handoff.
2026-06-16  Primary nav simplified to 10 items; Account/Diagnostics/HQ Bridge moved into Settings sub-tabs; Editor nav label changed to Engine.
2026-06-16  Added Campaigns and Clipper mode; primary nav now 11 items; Earn rewritten as Whop launchpad; two-persona UI simulator documented.
```
