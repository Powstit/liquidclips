# Junior — Railway Deployment Checklist (PLAN ONLY — awaiting approval)

Last updated: 2026-05-24. Do not deploy until Daniel approves. Grounded in the
actual code (`junior-backend/app/config.py`, `app/main.py`, `app/cron.py`,
`desktop/src/lib/backend.ts`, `desktop/python-sidecar/whop_client.py`).

## 1. Railway services

| Service | Needed for launch? | Notes |
|---|---|---|
| **FastAPI backend** | ✅ yes | `uvicorn app.main:app --host 0.0.0.0 --port $PORT`; healthcheck `/healthcheck` |
| **Postgres** | ✅ yes | Railway managed add-on; provides `DATABASE_URL` |
| **Scheduler / cron** | ⚠️ NOT a separate service | Cron is **in-process** (APScheduler, 60s tick, started in the backend lifespan). Keep backend at **1 replica** or schedules fire on every replica. |
| **Postiz** | ⛔ Phase 2 (not launch-critical) | Only needed for publish-now / schedule / drip (Growth/Autopilot). The clipper journey (find reward → clip → export → submit manually on Whop) does NOT need Postiz. Deploy `ghcr.io/gitroomhq/postiz-app` at `connect.jnremployee.com` when enabling auto-publish. |

**Launch with just Backend + Postgres.** Add Postiz later.

## 2. Required env vars (exact names — pydantic reads UPPER-case)

| Env var | Value / source | Critical? |
|---|---|---|
| `PORT` | Railway sets automatically; start cmd uses `$PORT` | — |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway ref) | ✅ |
| `WHOP_API_KEY` | App API key (`~/.claude-credentials/whop.env`) | ✅ |
| `WHOP_WEBHOOK_SECRET` | Whop dashboard webhook signing secret | ✅ |
| `WHOP_COMPANY_ID` | `biz_0IMrpJRrTJID1u` (already the default) | optional |
| `WHOP_APP_ID` | `app_hLphExdFzjEQsM` (already the default) | optional |
| `CLERK_WEBHOOK_SECRET` | svix signing secret from Clerk dashboard | ✅ |
| `JWT_PRIVATE_PEM` | Ed25519 private PEM — **generate once, paste** | ✅✅ (see §3) |
| `JWT_PUBLIC_PEM` | Ed25519 public PEM (matching) | ✅✅ |
| `JWT_ISSUER` | `junior-backend` (default) | optional |
| `JWT_TTL_DAYS` | `30` (default) | optional |
| `RESEND_API_KEY` | `~/.claude-credentials/resend.env` | ✅ (emails) |
| `RESEND_FROM` | `Junior <hello@jnremployee.com>` (verified domain) | ✅ |
| `RESEND_REPLY_TO` | `danieldiyepriye@gmail.com` (default) | optional |
| `OPENAI_API_KEY` | hosted LLM proxy for paid tiers (`openai.env`) | ✅ if hosted tiers |
| `ANTHROPIC_API_KEY` | optional `/proxy/llm` | optional |
| `POSTHOG_KEY` | PostHog project key (same as frontends) | optional (analytics) |
| `POSTHOG_HOST` | `https://us.i.posthog.com` (default) | optional |
| `JUNIOR_ADMIN_EMAILS` | comma-sep admin emails (has code fallback incl. Daniel's) | optional |
| `CORS_ORIGINS` | see below | ✅ |
| `PUBLIC_SITE_URL` / `ACCOUNT_SITE_URL` / `APP_DOWNLOAD_URL` | default to the jnremployee.com domains; override only if changed | optional |

`CORS_ORIGINS` (comma-separated, no spaces):
```
https://jnremployee.com,https://account.jnremployee.com,https://partner.jnremployee.com,tauri://localhost,https://tauri.localhost,http://tauri.localhost
```
(`.env.example` already has these; confirm they survive into the Railway value.)

**Postiz (Phase 2 only):** `POSTIZ_CLIENT_ID`, `POSTIZ_CLIENT_SECRET` (`postiz.env`), `POSTIZ_FRONTEND_URL=https://connect.jnremployee.com`, `POSTIZ_BACKEND_URL=https://connect.jnremployee.com`, `POSTIZ_REDIRECT_URL=https://api.jnremployee.com/oauth/postiz/callback`.

## 3. Database migration / init plan
- First boot runs `Base.metadata.create_all(bind=engine)` in the lifespan → tables auto-created. No alembic yet, so **no migration step needed for the first deploy**.
- Set `DATABASE_URL` to the Railway Postgres BEFORE first boot (else it creates a local SQLite file on the ephemeral disk and loses data on restart).
- **JWT keys gotcha:** `jwt_signer` auto-generates a keypair to `.junior-keys/` only if the PEM env vars are empty. Railway's filesystem is ephemeral → a new keypair every restart → **all issued licenses would 401 after a restart.** Therefore `JWT_PRIVATE_PEM` + `JWT_PUBLIC_PEM` MUST be set as env vars. Generate once:
  ```bash
  python3 -c "from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey as K; from cryptography.hazmat.primitives import serialization as s; k=K.generate(); print(k.private_bytes(s.Encoding.PEM,s.PrivateFormat.PKCS8,s.NoEncryption()).decode()); print(k.public_key().public_bytes(s.Encoding.PEM,s.PublicFormat.SubjectPublicKeyInfo).decode())"
  ```
- Future schema changes will need alembic (not in place yet) — note for later.

## 4. Webhook URLs to update
| Provider | URL | Notes |
|---|---|---|
| **Clerk** | `https://api.jnremployee.com/webhooks/clerk` | set `CLERK_WEBHOOK_SECRET`; subscribe to `user.created/updated/deleted`, `subscription.active/canceled/past_due`. In prod the handler verifies the svix signature (no dev bypass). |
| **Whop** | `https://api.jnremployee.com/webhooks/whop` | set `WHOP_WEBHOOK_SECRET`; subscribe to membership/subscription events. |
| **Resend** | none required | Outbound only — no inbound webhook. Just confirm the **sending domain (jnremployee.com) is verified** in Resend and `RESEND_FROM` is on it. (Optional: delivery/bounce webhooks later.) |

## 5. DNS plan
| Host | Target | Phase |
|---|---|---|
| `api.jnremployee.com` | Railway backend service domain (CNAME) | launch |
| `connect.jnremployee.com` | Railway Postiz service | Phase 2 |
| `jnremployee.com` / `account.` / `partner.` | already on Vercel — unchanged | — |
- Whop **desktop** OAuth uses a `localhost` loopback callback (in `whop_client.py`), so no public callback domain is needed for desktop Whop sign-in.

## 6. Smoke test plan (after deploy, against `https://api.jnremployee.com`)
1. `GET /healthcheck` → 200
2. **Signup webhook** → trigger via Clerk "send test event" (or a real signup) → backend creates the user + fires `send_welcome`. (Cannot curl-bypass in prod — svix signature required.)
3. `POST /desktop/connect` with that user's `clerk_user_id` → returns `license_jwt` + tier; fires `send_license_activated`.
4. `GET /me` (Bearer JWT) → correct tier/state.
5. `GET /whop/bounties` (Bearer JWT) → live Content Rewards (needs `WHOP_API_KEY`); confirm `?first=60` clamps to 25, no 502.
6. `GET /notifications/unread-count` (Bearer JWT) → 200; CORS preflight from `tauri://localhost` → 200.
7. **Subscription webhook** → Clerk/Whop test event → tier updates; Whop path fires `send_subscription_activated`.
8. **Resend** → confirm the welcome/license emails arrive (safe address).
9. Backend logs: no 4xx/5xx beyond intended; no Whop complexity 502s.

## 7. Desktop production switch (code change + rebuild — NOT just an env var)
Two hardcoded localhost references must point at prod:
1. **React** `desktop/src/lib/backend.ts:10` — `const BACKEND_URL = "http://localhost:8000"` → `https://api.jnremployee.com` (powers /me, /sync, /connections, /schedules, /notifications, /publish-now). Best: make it build-conditional (e.g. `import.meta.env.VITE_BACKEND_URL` with localhost fallback).
2. **Sidecar** `desktop/python-sidecar/whop_client.py` — `JUNIOR_BACKEND_URL` env, default `http://localhost:8000` (powers the /whop/* proxy). Rust does NOT currently pass `JUNIOR_BACKEND_URL`, so either change the default or set the env when spawning the sidecar in `src-tauri/src/sidecar.rs`.
3. Rebuild + install the packaged app (bump version).
4. **Re-activate** on first launch: a prod keypair differs from the local dev keypair, so any dev-minted license JWT in the keychain will 401 until `/desktop/connect` re-mints against prod. Fresh installs are unaffected.
5. Verify Earn loads + activation works against `https://api.jnremployee.com`.

(Desktop does NOT locally verify the JWT signature — it stores the keychain JWT and the backend verifies — so there is **no bundled public key to keep in sync**.)

## Boundaries
No payment/ledger/marketplace changes. Postiz + auto-publish are Phase 2. This is a plan; nothing is deployed.
