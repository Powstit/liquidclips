# Liquid Clips · Day-Zero Developer Cold-Start Guide

**Read time: 45 minutes. After this you can launch alongside me tomorrow.**

Prepared: 2026-07-23 · Prepared by: Daniel · Founder / Liquid Clips
Assumed reader: senior generalist. You've never seen this codebase. You know TypeScript / React / a bit of Rust / a bit of Python. You've heard of Tauri and Whop but never shipped with them.

If you only read three files it's this one, then `02-technical-documentation/PRODUCT_OVERVIEW.md`, then `02-technical-documentation/ARCHITECTURE_MAP.md`. Everything else is depth.

---

## 0 · Context on the person who wrote this + what I'm asking of you

I'm a solo founder. Public brand is **Liquid Clips**. Internal / repo name is still `jnr` (was Junior Employee Pro before the rebrand). No cofounder, no team — just me, Claude, and a growing bench of dev candidates including you.

**What I'm asking:** be my launch co-pilot for the next 7 days. Tomorrow (2026-07-24) I open the Cohort-0 cold-invite drip — old Founder seats getting a personal note, "hey come try what I finally built." Somewhere between 20 and 200 people will install the app in the first 48 hours. I need someone who has enough context to (a) triage bugs in real time, (b) push a runtime hot-swap fix within an hour if a money surface breaks, (c) NOT panic-rebuild the shell.

**What I'm not asking:** ground-up rebuild, refactor sweep, or opinions on tooling. The code is what it is. It ships tomorrow.

**Two rules that override anything else in this doc if there's a conflict:**

1. **Shell is FROZEN.** No `tauri build`, no Rust edits, no `Cargo.toml` bumps, no shell rebuild on a user's machine — ever. Every change ships via `updates.liquidclips.app/latest.json` (Apple-model auto-update) or the runtime hot-swap channel at `api.liquidclips.app/runtime/manifest.json`. See §10.
2. **Truth over completion theatre.** If you ship a "fix" and can't prove the fix landed in the exact artifact a user runs, downgrade the claim to "in progress" and say what's missing. I've been burned by false-green claims. `~/.claude/skills/completion-discipline/SKILL.md` in the source tree is the enforced standard.

---

## 1 · What Liquid Clips IS (in plain English)

**Liquid Clips is a macOS desktop app that turns long-form video into short vertical clips a creator can caption, style, watermark, and post — while paying the creator every time one of those clips converts a Whop bounty.**

- **Input**: YouTube URL, local MP4, drag-drop, or Drive import.
- **Processing**: on-device Whisper transcription + Anthropic Claude clip-picking + FFmpeg cut/reframe/thumbnail — all local, in a Python sidecar bundled inside the .app.
- **Output**: 9:16 vertical clips with animated captions, optional watermark, ready to post to TikTok / Reels / YouTube Shorts.
- **Money loop**: each clip can be submitted to a Whop bounty. When it accrues views, the clipper gets paid by the agency that posted the bounty. Liquid Clips takes a 5% fee at withdraw (see `src/lib/carrot.ts` · IG-SOV-2.2-001).

**Three audiences share the same shell.** The app never asks who you are — you flip an `App mode` toggle in the top HUD.

| Audience | What they do | Where they live in the UI |
|---|---|---|
| **Clippers** (typ. 17–22, TikTok-native) | Cut clips → submit to bounties → get paid per view. | Clipper mode. Home + Workstation + Wallet + `#/campaigns` + `#/community`. |
| **Agency owners** | Create bounties, review submissions, pay out clippers. | Agency mode ($99.99/mo). Campaign Builder + Submissions + Analytics. |
| **Whop bounty ecosystem** | Primary revenue rail — Whop owns the actual subs / payouts / view tracking. | Every earn/withdraw CTA opens Whop-hosted pages via `openWhopAction()` or the persistent-cookie browser overlay. |

**Voice rule** (product copy): the word "bounty" is BANNED in customer-facing UI. Use "skill" / "clip job" / "paid post." Enforced by review, not lint. Product target is 19-year-old clippers — treat the copy like it.

**Legacy name:** Junior / JNR Employee Pro. You'll see it in the repo path (`jnr/`), the sidecar folder (`python-sidecar/`), the backend service name (`junior-backend`), the old marketing domain (`jnremployee.com`, still in CORS whitelist), and old bundle-id fragments. The public brand is **Liquid Clips** everywhere the customer sees text.

---

## 2 · Why anyone pays — the flywheel (understand this or you can't triage bugs)

There are two payments in Liquid Clips, and they finance each other.

**Payment 1: Agencies pay Liquid Clips $99.99/mo.** One tier, `Agency`, sold through Whop plan `plan_NMKvKj8SVVKsY` ("Founder Access v2"). It unlocks:
- Watermark toggle-off (Free users have watermark forced ON).
- Clip 11+ (Free users hit `AssetRansomPaywall` at clip 10).
- Campaign Builder (create bounties on Whop from inside the app).
- Real analytics (Free users see previews only).
- Sub-account seats.

**Payment 2: Agencies pay Clippers via Whop bounties.** Agency posts a bounty ("$1 per 1k views on a clip of my podcast, verified via Whop"). Clipper cuts the clip in Liquid Clips, submits it via `SubmitToWhopModal`, and Whop tracks the view count on the destination platform. When the clipper crosses a payout threshold ($10 minimum withdraw per IG-SOV-2.2-001), they hit **Withdraw** in the Wallet, which opens Whop's hosted withdraw page via `openWhopAction(WITHDRAW, …)`.

**The flywheel:** free clips ship with a "Made with Liquid Clips" watermark that links to `liquidclips.app/r/{whop_username}`. That URL 302s to `whop.com/checkout/studio?a={username}`. Whop's 60-day affiliate cookie fires. When a viewer of the clip installs and subscribes to Agency within 60 days, the original clipper gets **30% recurring revenue share** — auto-created via `whop.affiliates.create({user_identifier}).createOverride({rev_share: 30%})` at desktop signup.

So one clipper who ships 10 clips can be:
- Earning per-view from the agency who posted the bounty (Payment 2 above).
- Earning 30% MRR from every viewer of their watermarked clips who subscribes to Agency (affiliate flywheel).
- Feeding the top of the Agency-signup funnel (which raises Payment 1).

**Whop is the affiliate system. We NEVER rebuild attribution, payouts, or 60-day cookie tracking.** Locked in memory `liquid_clips_whop_affiliate_system`.

**Two lanes stay separate.** Payment webhooks activate subscriptions + reconcile existing overrides — they do NOT mint affiliate identities. Identity minting fires only from `POST /me/affiliate/enroll` called from Earn tab / Crew-invite / reminder. If you see a webhook trying to create an affiliate, that's a bug (memory `liquid_clips_two_lanes_billing_affiliate`).

---

## 3 · The golden path (12 canonical steps)

This is the happy path a first-time Cohort-0 user walks tomorrow. If any step breaks in production, the launch is fire. Every step has a Playwright spec that drives it — `desktop-2/tests/e2e/full-clipping-journey.spec.ts` is the canonical fixture. Run it locally before ANY frontend PR: `npm run test:e2e -- full-clipping-journey`.

| # | Step | User sees | Under the hood | File / handle |
|---|------|-----------|---------------|---------------|
| 1 | **Boot** | Cinematic intro splash (skippable) → cockpit. | Tauri window loads `runtime://app/index.html`, hash router at `#/home`. Runtime bundle already hot-swapped if the update pill has been shown. | `src/overlays/IntroSplash.tsx` (IG-003 sentinel), `src/App.tsx` |
| 2 | **Sign in / activate** | "Sign in" opens Whop's hosted checkout in the OS default browser. Whop 302s to `liquidclips://activate?token=…`. App re-focuses. | Deep link → `src/lib/deepLinkBoot.ts` → `activation.ts` state machine → JWT written to macOS Keychain via `authStorage.ts`. Fallback: Clerk OTP at `ClerkOtpPanel.tsx` for regional payment friction. | `src/lib/whopCheckout.ts:openSignInOrSignUpBridge`, `src/lib/activation.ts:34` |
| 3 | **Generate** | Paste a YouTube URL or drop an MP4 on Home. Kade (the animated mascot) narrates progress. | Sidecar IPC: `ingest_url` → yt-dlp → `lift_transcript` → faster-whisper tiny → Anthropic Claude `/proxy/anthropic/clip-bundle` on backend picks the clips. | Sidecar: `desktop/python-sidecar/sidecar.py`. Wrapper: `desktop-2/src/lib/sidecar.ts` |
| 4 | **Workstation opens** | 4-panel workspace. Left = clip strip. Center = preview. Right = tools. Bottom = trim scrubber. | Hash route `#/workstation`. Renders `WorkstationRoute` in the Design-OS pipeline. Each clip is a `data-clip-id` element (NEVER `data-clip-idx` — memory `feedback_clip_actionability_proof`). | `src/design-os/routes/WorkstationRoute.tsx` |
| 5 | **Reaction** | User uploads a facecam MP4 to overlay on their clip. Progress bar bakes it in. | Sidecar composites via FFmpeg. Output written under `~/LiquidClips/Projects/{id}/`. | Sidecar method `reaction_bake` |
| 6 | **Caption** | Types caption. Picks style (mono only currently applies — other presets are `style-*-coming-soon` stubs). Positions on preview. Hits Apply. | React state updates → sidecar `apply_caption` bakes the burn-in. Style bake shares `deriveWatermarkPromise` with Publish (BUG-036). | Design-OS caption panel |
| 7 | **Trim** | Drags in/out handles on the bottom scrubber. Hits Apply. | Sidecar `trim` re-cuts. Non-destructive on the source. | Design-OS trim panel |
| 8 | **Watermark toggle** | Free users see watermark forced ON. Agency can toggle OFF. | Single source `deriveWatermarkPromise` — both Style bake AND Export bake read the same promise (BUG-036 close). If you see a state fork, it's a regression. | `src/lib/watermark.ts` |
| 9 | **Publish honesty** | Publish + Schedule tabs share the same schedule ledger. | `deriveSchedulePromise` — single source. BUG-038 close. | `src/lib/assistedSchedule.ts` |
| 10 | **Export** | "Publish now" button. Success screen shows the output file path + watermark status via `data-export-watermark` + `data-output-path`. | Sidecar `publish_now`. No cloud upload — final MP4 lands on disk. | `publish-now` handler |
| 11 | **Assisted schedule** | If the user picks "Schedule instead", they get a local reminder + native OS notification at fire time. User opens the target platform inside the persistent-cookie **BrowseOverlay** (`browse.rs:189`) and pastes manually. | **NO Ayrshare / OAuth SDK / Profile Key.** The webview stays signed in because the child webview persists cookies. | `src/components/browser/BrowseOverlay.tsx`, `assistedSchedule.ts` |
| 12 | **Persistence** | User closes app mid-flow. Reopens. Their clip strip, captions, style, trim survive. | State written to `localStorage["lc.assisted-schedule.v1"]` + IndexedDB. Persistence rehydration is a common bug surface (memory `feedback_clip_actionability_proof`). | State keys are namespaced under `lc.*` |

**Wallet loop (parallel to the clip loop):**

Submit → Whop tracks views → payout accrues on Whop → user hits **Withdraw** → `openWhopAction(WITHDRAW, …)` opens Whop's hosted withdraw page → funds move via Stripe Connect on Whop's side → withdrawal shows as a row in `WalletDetail` via `useWalletLedger()`.

---

## 4 · What "successful app" means for Liquid Clips

Not "bugs fixed." Not "TSC green." The lens is: **would I let 40k paying customers depend on this every day?**

**Scale target: 40,000 paying users in 6 months.** Locked in memory `liquid_clips_scale_target_40k`.

Because Liquid Clips is local-first (compute runs on the user's Mac, not our servers), the scaling bottleneck is NOT CPU/GPU/GB-seconds. It's the **8 business-critical loops**:

| # | Loop | What breaks if this fails |
|---|------|---------------------------|
| 1 | **Enter** — install, first launch, activation deep-link | User bounces before value; refunds; support tickets |
| 2 | **Value** — first clip generated within 3 minutes | First-session churn |
| 3 | **Subscribe** — Whop checkout completes, entitlement lands in-app within 30s | Paid customer with no unlock = angriest possible customer |
| 4 | **Continue** — clip 2, 3, … n. Persistence survives close/reopen | Weekly churn |
| 5 | **Earn** — clipper submits to Whop, sees views accrue in-app | No payout evidence = no engagement |
| 6 | **Invite** — Crew invite / affiliate link works | Flywheel breaks; growth stalls at LTV/CAC |
| 7 | **Get paid** — withdraw completes, ledger row shows | User posts angrily on Twitter |
| 8 | **Stay subscribed** — cancellation intercept respects intent + real Whop cancel via `POST /me/trial/cancel` | Churn rate exits the model |

If a bug touches any of these 8, it's P0. If it doesn't, it's P1 or lower.

**Local-first = optimize for correctness / trust / recoverability / observability / entitlement / journey / runtime — NOT compute.** Every new feature must answer:
- **Journey**: which of the 8 loops does this strengthen?
- **State**: what shapes must the UI render (loading, empty, error, populated, stale, offline)?
- **Invariant**: what's the money-truth this must never violate (e.g. carrot fee, watermark forced-on for Free, entitlement gate)?
- **Telemetry**: which `lcDiag(topic, data)` event proves it's working in production?
- **Regression**: which Playwright spec + Vitest test catches the next time this breaks?

The **Admin HQ Journey Map tab** at `account-app/src/components/admin/JourneyMapTab.tsx` is the ground truth for wire state across 80 customer journeys (currently 76% wired). It's the first place to look during launch triage.

---

## 5 · System architecture (4 surfaces + 2 supporting)

Repo root: `/Users/dipdip/code/jnr` (canonical — legacy `desktop/jnr_STALE_*` folders exist on Desktop; ignore them). Remote: `github.com/Powstit/liquidclips` (private).

### 5.1 · `desktop-2/` — the app the user runs (Tauri 2 shell + Vite/React frontend)

Shell version **2.3.18** (as of `tauri.conf.json`). Runtime hot-swap bundle promoted to **2.3.16**. FROZEN shell — no Rust edits.

- **Frontend:** React 18 + Vite + TypeScript + Tailwind 4. Entrypoint `src/App.tsx`. Hash router.
- **Shell:** Tauri 2 + Rust. Entrypoint `src-tauri/src/lib.rs`. Sidecar spawner at `src-tauri/src/sidecar.rs`. Persistent-cookie child webview at `src-tauri/src/browse.rs`. **Do not touch these.**
- **Sidecar:** Python via `desktop/python-sidecar/sidecar.py` — one method per RPC over stdio JSON. Heavy modules (faster-whisper, OpenCV, Anthropic SDK) import lazily inside method bodies; `check_deps` preflight runs at boot.
- **Two pipelines** (LOCKED 2026-07-10):
  1. **Section pipeline** (`src/routes/**` + `src/sections/**`, registered in `src/shell/sectionRegistry.ts`) — money surfaces: Wallet, Cold entry, Outreach, Cancellation, Catalog + cross-cutting shells (Account, Diagnostics, HQ Bridge, Learn). Reached via outer hash (`#/account`, `#/outreach`).
  2. **Design-OS pipeline** (`src/design-os/routes/**`, registered in `src/design-os/routing/SimulatorRouter.tsx`) — tool surfaces: Home cockpit, Workstation, Campaigns, Analytics, Channels, Settings, Support, Submissions, Thumbnail Studio, Login onboarding. Reached via `bus.emit("nav:click", { route })`.
- **State**: Zustand stores in `src/design-os/state/**` (one per domain — `useCampaigns`, `useCommunity`, `useEarnSummary`, `useChannels`, `useEngineSession`, `useMe`, `useRewardClips`, `useSchedule`, `useTierCaps`, `useWhopReward`). **No fixture data** — real hooks only. Render honest empty states.
- **Bus contract**: `src/design-os/bridge/events.ts` — typed `RouteId` + `KadeState` unions. `bus.emit(...)` / `useEvent(...)` from `bridge/index.ts`. Rule: Kade never emits its own state events; user actions do.
- **Auto-updater**: Tauri updater plugin points at `updates.liquidclips.app/latest.json`. Minisign public key embedded in `tauri.conf.json`. Endpoint serves the whole `.app` for full-binary updates.
- **Runtime hot-swap**: separate channel at `api.liquidclips.app/runtime/manifest.json`. Serves a signed tarball of the frontend `dist/` folder. See §10.

### 5.2 · `junior-backend/` — FastAPI on Railway

- **Live URL**: `api.liquidclips.app` (custom domain) + `api.jnremployee.com` (legacy CORS whitelist).
- **Deploy method**: **Manual** via `railway up --service junior-backend --detach` from `junior-backend/`. GitHub source is **deliberately disconnected** on Railway — an accidental push once rolled prod back 31 commits. **Never re-enable GitHub deploys.**
- **Purpose**: auth + tier resolution + license JWT issuance + webhook handling (Clerk, Whop, Stripe) + Anthropic proxy for hosted clip judgment (so new users don't paste API keys) + Ayrshare proxy (retired but still wired — see §7).
- **Database**: PostgreSQL managed by Railway. Connection uses Railway private DNS `postgres.railway.internal` — **only resolves inside Railway's private network**. Local dev falls back to `sqlite:///./junior-backend.db`. Never try to run seed scripts against prod from your laptop.
- **License JWT**: Ed25519, 30-day expiry, auto-rotated by `/sync` when ≤5 days remaining. Public key is baked into the desktop bundle at build time — not fetched at runtime. Ed25519 keypair on first boot writes to `.junior-keys/` (gitignored).
- **Seeds**: auto-run on lifespan startup. `scripts/seed_community_channels.py` (9 default rooms) + `scripts/seed_uncle_daniel_campaigns.py` (3 mission-lane rows). Both upsert by slug. Values pasted via Admin HQ (like `whop_channel_id`) survive every redeploy.

### 5.3 · `account-app/` — Next.js 16 on Vercel

- **Live URL**: `account.liquidclips.app`.
- **Deploy method**: **Manual** `vercel deploy --prod --yes` from `account-app/`. Canonical project = `danieldiyepriye-gmailcoms-projects/account` (project ID `prj_eIPnzibZFvuw6I9T4AHJAoA3GJRZ`). **Never create duplicate projects on other teams** — two were deleted after they caused a wasted deploy session (memory `vercel_account_canonical`).
- **Purpose**: Whop-backed checkout UI + Admin HQ + Journey Map + State Puppeteer + Money Funnel dashboard.
- **Admin HQ tabs** (all under `src/components/admin/`): `AdminHQ.tsx`, `MoneyFunnelTab.tsx`, `ClipRunsTab.tsx`, `ColdLeadsTab.tsx`, `ConstellationTab.tsx`, `SignInOpsTab.tsx`, `SurfacesTab.tsx`, `StatePuppeteerTab.tsx`, `SystemMapTab.tsx`, `LcosEventsTab.tsx`, `LaunchWarRoomTab.tsx`, `CanaryTab.tsx`, `BetaCohortTab.tsx`, `PromoCodesTab.tsx`, `CarouselClipsTab.tsx`, **`JourneyMapTab.tsx` (primary state-of-truth)**.
- **HQ wire**: proxies to backend admin endpoints (`/admin/community/channels`, `/admin/banners`, `/admin/announcements`, `/admin/bonus-ledger`) via `INTERNAL_API_SECRET`.
- **Iframe embed**: `/embed/earn` iframe is consumed by the desktop's Tauri child webview for the Wallet's cinematic earn view.
- **CAVEAT — `account-app/AGENTS.md`**: "This is NOT the Next.js you know. This version has breaking changes." Read `node_modules/next/dist/docs/` before writing Next.js code in this folder. It's Next 16 App Router with a lot of Cache Components + `use cache` directives.

### 5.4 · `liquidclips-marketing/` — Next.js on Vercel

- **Live URL**: `liquidclips.app`.
- **Deploy method**: **Manual** `vercel deploy --prod --yes` from `liquidclips-marketing/`.
- **Purpose**: marketing site + `/download` route surfaces latest GitHub Release asset + Clerk native `/sign-in`, `/sign-up`, `/connect-desktop` pages.
- **DB**: Neon Postgres via Vercel Marketplace integration (Phase 2, optional).

### 5.5 · `updates-proxy/` — Cloudflare / Railway auxiliary

Serves `updates.liquidclips.app/latest.json` for the Tauri full-binary updater AND `/runtime/manifest.json` for runtime frontend hot-swap. Signed with `.junior-updater/junior-updater.key` (minisign).

### 5.6 · `edge-worker/` — Cloudflare Worker

Auxiliary edge routing (e.g. `liquidclips.app/r/{username}` 302 to `whop.com/checkout/studio?a={username}` for affiliate attribution).

### 5.7 · Legacy `desktop/` — v0.7.x predecessor

Still holds the Python sidecar source, FFmpeg binaries, sidecar ship script, and many primitives that `desktop-2/src/lib/*` imports. **Don't build / edit / compare from here for new work** — but don't delete either. See memory `liquid_clips_source_of_truth`.

---

## 6 · Every `.env` file catalogued (Section 5 of the Eazisols audit already lists services; this section lists the FILES + VARIABLES)

**Rule**: No live secrets are in this handoff. All `.env`, `.env.local`, `.env.production.local`, `.junior-keys/*.pem` are excluded from `liquid-clips-source-1b96ec81.zip`. `.env.example` templates ARE included. When you need real values, ask via the shared channel; I'll share over a secure line.

### 6.1 · `desktop-2/` — the app itself

**Files:**
- No traditional `.env.example` at repo root.
- `desktop-2/required-env.json` — **authoritative manifest** consumed by `scripts/assert-env.mjs` (runs as `beforeBuildCommand` + as a CI step). Missing var or shape mismatch exits 1 without echoing values.
- `desktop-2/.env.sovereign-2.2.example` — Sovereign 2.2 sprint stubs (zkLogin + Sui USDC + proxy pool). **NOT WIRED in current build** — documentation for when 2.2 lands. Skip for launch.
- Live files (gitignored, not in source zip): `desktop-2/.env.local` (dev) + `desktop-2/.env.production.local` (build-time prod inject).
- `scripts/dev-with-keys.sh` — 1Password-backed dev-mode key injector (if you have `op` CLI configured; otherwise just set `.env.local` manually).

**Strictly required to boot (both safe to share — client-bundle keys):**

| Var | Shape | Prod value (public, safe) |
|---|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_live_...` / `pk_test_...` | Publishable key from Clerk dashboard — publishable = designed to be exposed in client JS. Ask Daniel for the exact `pk_live_...` string; it's baked into the built app anyway (grep the compiled `dist/` and you'll find it). |
| `VITE_BACKEND_URL` | `https://...` | `https://api.liquidclips.app` |

**Additionally read at runtime (all client-safe):**

| Var | Purpose | Prod value or shape |
|---|---|---|
| `VITE_POSTHOG_KEY` | Client analytics | `phc_...` from PostHog dashboard. Client-side by design. |
| `VITE_POSTHOG_HOST` | PostHog region | `https://us.i.posthog.com` or `https://eu.i.posthog.com` |
| `VITE_SENTRY_DSN` | Client error monitoring | `https://...@sentry.io/...` — DSN is public by design. |

**Note on `VITE_*` prefix:** any variable NOT prefixed `VITE_` is NOT exposed to the client bundle. If you see a secret being read via `import.meta.env.VITE_*` — that secret is already in the client bundle and NOT actually a secret. If you see it read via `process.env.SOMETHING` — that's build-time only, not runtime.

**No server-side secrets belong in `desktop-2/`.** All server-side wiring (Anthropic key, OpenAI key, Whop API key, Stripe secret, Clerk secret, Resend, etc.) lives in `junior-backend/` on Railway. Desktop only calls the backend; it never holds a server secret. This is by design — the desktop bundle ships to end-user Macs and can be trivially unzipped.

### 6.2 · `junior-backend/` — FastAPI

**File**: `junior-backend/.env.example` (44 lines, template only).

| Var | Purpose |
|---|---|
| `PORT` | Railway sets automatically. |
| `DATABASE_URL` | SQLite locally; Railway private-DNS Postgres in prod. |
| `CLERK_WEBHOOK_SECRET` | Verifies Clerk `user.created` / `user.updated` webhooks via svix. |
| `WHOP_WEBHOOK_SECRET` | HMAC-verifies incoming Whop webhooks. |
| `WHOP_API_KEY` | Outbound Whop API calls (affiliate mirroring, subscription reads). |
| `WHOP_COMPANY_ID` | **`biz_0IMrpJRrTJID1u`** (Liquid Clips company on Whop). |
| `WHOP_APP_ID` | `app_hLphExdFzjEQsM`. |
| `AFFILIATE_COMMISSION_LIVE` | `false` locally, `true` in prod when live payouts should mint. |
| `JWT_PRIVATE_PEM`, `JWT_PUBLIC_PEM` | Ed25519 keypair for license JWTs. Blank locally → autogen into `.junior-keys/` on first boot. **In prod, paste both values, commit only public PEM to desktop bundle.** |
| `JWT_ISSUER`, `JWT_TTL_DAYS` | `junior-backend`, `30`. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | For the hosted `/proxy/anthropic/clip-bundle` + `/proxy/llm` endpoints (Pro / Agency tiers). |
| `CLAUDE_API_KEY`, `CLAUDE_AGENT_API_KEY`, `CLAUDE_ADMIN_API_KEY` | Distinct scopes for HQ admin agents. |
| `AYRSHARE_API_KEY` | **RETIRED but env still read.** When unset (current prod state), `/publish-now` returns `503 "beta"` and `features.publish_now` reports `built=false` so the desktop degrades cleanly. Do NOT set this — the walk-around is the persistent-cookie webview per memory `feedback_ayrshare_mistake`. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Legacy secondary billing path. Present, not primary. |
| `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO` | Transactional email. |
| `JUNIOR_ADMIN_EMAILS` | Admin email allowlist (comma-separated). `ADMIN_MASTER_EMAILS` was removed in P0-001. |
| `POSTHOG_KEY`, `POSTHOG_HOST` | Server-side analytics. |
| `CORS_ORIGINS` | See file — includes `tauri://localhost` + `https://tauri.localhost` (required or packaged desktop CORS preflight fails). |

### 6.3 · `account-app/` — Next.js account app

**File**: `account-app/.env.example` (40 lines).

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk auth. |
| `NEXT_PUBLIC_CLERK_SOLO_PLAN_ID` | `cplan_3E4VBeiWtZP0CJsvPwrIz91uDFk` — **legacy tier, no longer sold** per pricing pivot. |
| `NEXT_PUBLIC_CLERK_PRO_PLAN_ID` | `cplan_3EV9Jjn8qLG130iSSRpAUOmqAfm` — legacy. |
| `NEXT_PUBLIC_CLERK_AGENCY_PLAN_ID` | `cplan_3E4VBfKWkQlIuYRQG0YE5LfJPjx` — **THE plan.** |
| `NEXT_PUBLIC_CLERK_ACCOUNT_PACK_PLAN_ID` | `cplan_3EV9znSsguzmwoQoEr5kXpumkfM` — sub-account add-ons. |
| `NEXT_PUBLIC_JUNIOR_BACKEND_URL` | `https://api.jnremployee.com` (legacy domain, still works — alias of `api.liquidclips.app`). |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Frontend analytics. |
| `KIMI_AUTH_AGENT_API_KEY`, `KIMI_PROJECTS_AGENT_API_KEY`, `KIMI_EARN_AGENT_API_KEY`, `KIMI_UI_AGENT_API_KEY`, `OPENAI_CODEX_AGENT_API_KEY`, `CLAUDE_AGENT_API_KEY` | HQ agent lane API keys. Source of truth for bug-command-centre. Empty in dev. UI shows Configured / Missing — never the value. |
| `HQ_INTERNAL_SECRET` | Signs requests from account-app to `junior-backend` `/admin/*` endpoints. |
| `ADMIN_ALLOWED_IPS` | **IG-HQ-001**. Comma-separated IPs read from the SIGNED `x-vercel-forwarded-for` header (P1-005 trust boundary). Empty = `/admin/*` locked out entirely. |

### 6.4 · `liquidclips-marketing/` — Next.js marketing

**File**: `liquidclips-marketing/.env.example` (50 lines).

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Same Clerk project as account-app. Primary domain = `liquidclips.app`, satellite = `account.liquidclips.app`. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-in`, `/sign-up`. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `/connect-desktop` — the deep-link handoff page. |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | Wired in `next.config.ts`. Optional locally. |
| `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_PRODUCT_HUNT_URL`, `NEXT_PUBLIC_GITHUB_REPO`, `NEXT_PUBLIC_PARTNER_URL` | Domain / links (defaults baked into `src/lib/env.ts`). |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Neon Postgres via Vercel Marketplace (Phase 2, optional). |

### 6.5 · `desktop/` — legacy shell (sidecar host)

**File**: `desktop/.env.example` (7 lines — just BYO provider keys for Assets picker).

| Var | Purpose |
|---|---|
| `GIPHY_API_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY` | Read by Python sidecar as fallback after macOS Keychain lookup. |

### 6.6 · Where secrets actually live (not committed anywhere)

- **Local mirror**: `~/.claude-credentials/` on my laptop.
- **Backend prod**: Railway dashboard → `junior-backend` service → Variables.
- **account-app / marketing prod**: Vercel dashboard → project → Settings → Environment Variables.
- **Desktop bundle**: hardcoded public keys only (JWT verify pubkey, minisign updater pubkey, Whop plan IDs). No secret keys ever cross-compile into the .app.
- **After any rotation**: sync to every mirrored location AND to Vercel / Railway env vars per the table in `DEPLOYMENT.md` §7.

**Secret hygiene rule from `CLAUDE.md`:** never `echo`, `cat`, or `grep` raw secret values into chat output. If a secret must be shown, show only the first 4 chars + `…`.

---

## 7 · Whop — the primary rail (understand this deeply)

Whop owns auth, subscriptions, agents, community, view tracking, payouts, and affiliate attribution. We integrate — we do NOT rebuild. This was locked 2026-06-24 and reinforced 2026-07-18 (memory `liquid_clips_whop_affiliate_system`).

**Company:** `biz_0IMrpJRrTJID1u`
**App ID:** `app_hLphExdFzjEQsM`
**Primary plan (only one sold):** `plan_NMKvKj8SVVKsY` ("Founder Access v2" — internal name; UI reads "Agency $99.99/mo")

**Touchpoints in the codebase:**

| Function | File | Purpose |
|---|---|---|
| `openSignInOrSignUpBridge()` | `src/lib/whopCheckout.ts` | Opens Whop hosted checkout in OS default browser (not in an in-app OAuth webview — that was deleted in v2.2.24 at `App.tsx:69-75`). |
| `openWhopAction(action, …)` | `src/lib/openWhopAction.ts:55` | The **locked pattern** for every out-of-app Whop CTA: `WITHDRAW`, `BOUNTY_CREATE`, `TAX_DOCS`, `PAYMENT_METHODS`. Never build a custom API call for these — always route through here. |
| `activation.ts` state machine | `src/lib/activation.ts:34` | Handles the `liquidclips://activate?token=…` deep-link callback after Whop checkout. Emits `activation:complete` on the bus. **Read the whole file before wiring a new activation event — memory `feedback_three_questions_gate` was born from a 4-batch plan that collapsed to 2 files after finding this state machine.** |
| `whopConnect.ts` | `src/lib/whopConnect.ts` | Deep-link handshake helpers. |
| `SubmitToWhopModal.tsx` | `src/design-os/components/SubmitToWhopModal.tsx` | Clipper submits a clip to a bounty via Whop's submit API. |
| `WhopStatusChip` | Inside `TopHud.tsx` | Reads `useMe().snapshot.whopUserId + useAuth().hasJwt`. Shows connection state. |
| Persistent-cookie **BrowseOverlay** | `src/components/browser/BrowseOverlay.tsx` (frontend), `src-tauri/src/browse.rs:189` (Rust child webview) | Users open `WHOP_REWARDS_URL` inside a child webview whose cookies survive across sessions. This is HOW they discover bounties AND how they paste-to-post during assisted schedule. |
| `/whop/webhook` on backend | `junior-backend/app/routes/whop.py` | HMAC-verifies incoming Whop events. Activates subscriptions. Reconciles existing affiliate overrides. **Does NOT mint affiliate identities** (memory `liquid_clips_two_lanes_billing_affiliate`). |
| `/whop/*` proxy | Backend | Read-through for content rewards, community rooms, view counts. |

**What we cache in our DB (only these fields — Whop is source of truth):**
- `whop_user_id`
- `paid_until`
- `subscription_status`

**What we NEVER cache or mirror**: subscription records, view counts, payout ledgers, community rooms, affiliate identities, connected-account state. If a bug seems to require reading Whop's subscription record, use the `/whop/*` proxy at request time — don't add a column.

**Affiliate mint (single call site):** `POST /me/affiliate/enroll` on backend. Called from Earn tab / Crew-invite / reminder ONLY. Creates the Whop affiliate identity + 30% rev-share override in one call. This is the ONLY place identity minting fires. If you see one anywhere else, delete it.

**Watermark → 302 → Whop checkout:** watermark on every free clip links `liquidclips.app/r/{whop_username}`. That URL 302s to `whop.com/checkout/studio?a={username}` via the edge-worker. 60-day cookie fires on Whop's side.

---

## 8 · Clipping rewards (how the earn side of the flywheel actually moves money)

Agencies fund bounties on Whop. Clippers cut clips that satisfy bounty terms. Views accrue via Whop's tracking. Payouts flow via Whop → Stripe Connect on Whop's side. Liquid Clips takes 5% at withdraw.

**Where the code lives in the desktop app:**

| Surface | Route | File |
|---|---|---|
| Wallet | `#/wallet-detail` (Section pipeline) | `src/routes/wallet-detail/WalletDetail.tsx` |
| Wallet fallback | Deprecated | `src/design-os/routes/EarnRoute.tsx` (only kept as `SectionWithFallback` fallback for Wallet — DON'T remove) |
| Earn view (cinematic) | Iframe from account-app | `account-app/src/app/embed/earn/page.tsx` |
| Ledger hook | Real live data | `src/lib/wallet.ts:useWalletLedger()` |
| Sponsored Rewards module | `#/earn` | Above WalletDetail |
| Reward clip mint list | `#/earn` | Below WalletDetail |
| Withdraw button | Wallet | Calls `openWhopAction(WITHDRAW, { amount, currency })` |
| Submit clip | Workstation | `SubmitToWhopModal.tsx` posts to Whop's submit API |
| Bounty discovery | Community | `BrowseOverlay` opens Whop's bounty list |

**Carrot economics (IG-SOV-2.2-001, locked)**:
- 5% Liquid Clips fee.
- $10 min withdraw.
- $50 payout threshold shown as goal state.
- Codified in `src/lib/carrot.ts`.

**Agency side — Campaign Builder:**
- `src/design-os/routes/CampaignsRoute.tsx` in Agency mode exposes `#/campaign-builder`.
- POSTs to Whop's bounty API to create the campaign.
- Reads back via `/whop/*` proxy.
- Legacy desktop had scoped attribution / MRR distribution / payout engine — **all deleted** per Whop-owns-affiliates memory. Do not re-add.

**Sponsored campaigns table** (backend Postgres) tracks the seeded "Uncle Daniel" mission-lane campaigns (3 rows auto-seeded on lifespan). These are Liquid Clips-owned metadata that binds to a Whop bounty ID.

---

## 9 · Auth flow (Whop primary → Clerk OTP fallback)

**Primary path (Whop, desktop):**

1. User clicks "Sign in" in TopHud.
2. `openSignInOrSignUpBridge()` opens `whop.com/…` in the OS default browser.
3. Whop hosts the entire checkout / OAuth dance.
4. Whop 302s to `liquidclips://activate?token=…`.
5. macOS routes the deep-link to the running Liquid Clips app.
6. Tauri deep-link plugin fires. `src/lib/deepLinkBoot.ts` catches it.
7. `activation.ts:34` state machine progresses: `IDLE → RECEIVED → SYNCING → COMPLETE`.
8. JWT lands in macOS Keychain via `authStorage.ts` (namespace `app.liquidclips.auth.v1` — IG-014).
9. `activation:complete` bus event fires.
10. `useAuth().hasJwt` flips to `true`. Every gated surface unlocks.

**Fallback path (Clerk OTP):**

For users who can't complete Whop checkout first (regional payment friction), Clerk OTP is a secondary sign-in surface. `src/components/auth/ClerkOtpPanel.tsx`. Clerk metadata syncs to backend via `/webhooks/clerk` (svix-verified). Backend mints a license JWT. Same activation flow from step 7 onward.

**Never route new revenue through Clerk alone.** Whop is the money rail.

**Session-reset regression (IG-014-B/C):** two iron gates guard against a session reset regression that shipped 2026-07-18. If you see any code path that clears `authStorage` state without going through the documented reset flow, that's IG-014-B territory — pre-commit will refuse the diff.

---

## 10 · Runtime hot-swap — the update mechanism (the single most important thing to understand)

**Two update paths. Very different.**

### Path A: Full binary update (Tauri auto-updater)

- Triggered by: shell version bump in `tauri.conf.json` + tag push.
- CI (`.github/workflows/release.yml`) builds signed DMGs for both architectures, notarises + staples, uploads to draft GitHub Release.
- Updater endpoint at `updates.liquidclips.app/latest.json` serves the DMG URL + minisign signature.
- User clicks "Update" → Tauri swaps the .app in place → **restart required**.

**When to use Path A**: never, tomorrow. Only for Rust-level changes (Cargo deps, new native commands, shell rebuild) — which are FROZEN.

### Path B: Runtime frontend hot-swap (`scripts/runtime-ship.sh`)

- Triggered by: any pure-frontend change (React / CSS / TypeScript / Zustand state / new panel).
- Local: `vite build` → `dist/` → tar → `liquidclips-runtime-<version>.tar.gz` → minisign-sign with the same updater key.
- Upload: `POST /runtime/upload` (backend records with verdict `PENDING`).
- ship-lens-reviewer runs against the uploaded bundle.
- If lens passes: `POST /runtime/promote` flips verdict to `PASS`.
- Manifest at `/runtime/manifest.json` now serves the promoted bundle.
- Active users see an "Update Ready" pill (mounted in `AppShell.tsx`).
- **Click pill → Tauri `relaunch()`** (NOT `window.location.reload()` — memory `liquid_clips_update_pill_bug_reload_vs_relaunch`).
- Relaunch triggers `runtime.rs` swap → next boot serves the new bundle.

**When to use Path B**: every fix tomorrow. **This is your launch tool.**

**The pill contract (IRON GATE — do not violate):**
- Mounted app-wide in `src/App.tsx` via `AppShell.tsx`.
- Polls `/runtime/manifest.json` every 60s.
- One click → Tauri `relaunch()`.
- **NEVER `window.location.reload()`** — reload keeps serving pre-swap bundle; only relaunch triggers the runtime.rs swap.

Prior bundles live in `dist-runtime-pack/` (11 GB of historical runtime tarballs — excluded from the source zip; ask me if you need one for rollback).

**Rollback drill:** `POST /runtime/promote` with a prior bundle version. Pill shows again next poll. Users click, relaunch, rolled back.

**Why frozen shell + Path B is the whole business:**
1. Release velocity — runtime push = minutes vs Apple notarisation = 20-40 min round-trip.
2. Apple notarisation cost per-release.
3. Shell churn breaks Apple Dev enrollment (memory `feedback_cloud_updates_only_never_rebuild_shell`).
4. Same Developer ID `KT68NGT4LX` on every CI signed build → stable designated requirement → keychain ACLs survive updates → no re-prompt.

---

## 11 · Build, sign, ship (what you'll actually run)

**Fastest — dev iteration (frontend only):**

```bash
cd desktop-2 && npm install && npm run dev
# Vite HMR at http://localhost:1420
```

**Tauri dev (native shell wired to sidecar):**

```bash
cd desktop-2 && npm run tauri:dev
# Or, with 1Password-injected OpenAI key:
bash scripts/dev-with-keys.sh
```

**Runtime hot-swap release (this is what you'll cut tomorrow if we need a fix):**

```bash
cd desktop-2 && bash scripts/runtime-ship.sh <version> "<release notes>"
# Signs with .junior-updater/junior-updater.key, uploads PENDING, waits for ship-lens verdict
```

**Full native release build (macOS only — DO NOT RUN without explicit greenlight from me):**

```bash
cd desktop-2 && npm run tauri build   # 5-13 min · signs + notarises
# OR the sanctioned release cut:
bash desktop/scripts/ship.sh <version> "<notes>"
```

`ship.sh` enforces clean git tree, on `main`, unshipped version, signs + notarises + staples the DMG, uploads a draft Release, and verifies the live manifest before claiming success. Never bypass it.

**Cohort-0 = macOS only.** Windows is deferred until we procure an EV code-signing cert (~$300/yr DigiCert EV, or ~$200/yr SSL.com EV) or Azure Trusted Signing (~$10/mo). Without EV, every Windows install gets a SmartScreen warning. Not shipping to Windows until this lands — memory `liquid_clips_windows_ev_cert`.

**Auto-updater identity constants (freeze in your head):**
- Bundle identifier: `app.liquidclips.desktop`
- Product name: `Liquid Clips`
- Signing identity: `Developer ID Application: daniel diyepriye dokubo (KT68NGT4LX)`
- Team ID: `KT68NGT4LX`
- Deep-link scheme: `liquidclips://`
- Min macOS: `13.0` (Ventura)
- Updater endpoint: `https://updates.liquidclips.app/latest.json`
- Runtime endpoint: `https://api.liquidclips.app/runtime/manifest.json`

---

## 12 · Money surfaces vs tool surfaces (which pipeline & why it matters)

Money surface = anything where the customer sees money, entitlements, checkout, cancellation, or a paid deliverable. These MUST have:

1. An approved HTML mockup in `desktop-2/docs/mockups/approved/*.html`.
2. A matching founder video in `public/brand/founder/*.mp4`.
3. **3+ explicit states** in the built React route (loading, empty, error at minimum — money surfaces additionally require the cinematic scrubber states declared in the approved HTML).

**Money surfaces (Section pipeline):**
- Wallet (`#/wallet-detail`)
- Cold entry (`#/outreach`)
- Cancellation intercept
- Catalog
- Cross-cutting: Account, Diagnostics, HQ Bridge, Learn

**Tool surfaces (Design-OS pipeline) — DO NOT need mockups + videos:**
- Home cockpit, Workstation, Campaigns, Analytics, Channels, Settings, Support, Submissions, Thumbnail Studio, Login onboarding.

**Ship-lens enforces this per pipeline.** Scaffold new money surfaces via the `new-money-surface` skill so all 3 artefacts land together. Adding a money surface WITHOUT the mockup/video/states is a lens failure and pre-commit will refuse the diff.

**Fallback resilience is scoped to WALLET ONLY.** `SectionWithFallback` wraps `WalletDetail` — falls back to Design-OS `EarnRoute` on crash. **Do not claim app-wide fallback resilience.** Adding `SectionWithFallback` around a route with no genuine legacy fallback is theatre and pre-commit lens rule 5b refuses it.

---

## 13 · Iron gates — the rules that survive every edit

`IRON GATE IG-NNN` sentinel comments mark load-bearing invariants. Pre-commit hook (`.githooks/pre-commit`) greps for the sentinel and refuses commits that delete one without documented override.

**Before editing ANY file:**

```bash
grep -n "IRON GATE" <files-you-plan-to-edit>
```

If you find a hit inside or adjacent to your edit → STOP. Open `desktop/docs/IRON_GATES.md` or `desktop-2/docs/IRON_GATES_REGISTRY.md`, read the gate, confirm your change preserves the contract. If it can't, override requires `IRON_GATE_OVERRIDE=1` env AND explicit greenlight quoted in commit message.

**Currently active gates you'll encounter:**

| Gate | Lives in | What it protects |
|---|---|---|
| IG-001 | Import pipeline | yt-dlp + faster-whisper wire; cancel-marker pattern; generation guards. |
| IG-002 | Sidecar RPC | `sidecar.py` newline-delimited JSON contract; lazy-load pattern; `check_deps` preflight. |
| IG-003 | `src/overlays/IntroSplash.tsx` | Cinematic intro splash contract. |
| IG-004 | Auth + activation | Whop → deep-link → keychain → `hasJwt` chain. |
| IG-005 | Workspace UI design | Design tokens invariants. |
| IG-006 | Cockpit handoff contracts | Bus event schemas Kade ↔ user actions. |
| IG-007 | `ClipCard` structure | Data-attribute contract (`data-clip-id`, NEVER `-idx`). |
| IG-008 | Cockpit room scrollability + BottomCockpit clearance | Layout invariants. |
| IG-009 | `scripts/cloud-ship.sh` | Cloud release flow. |
| IG-010 | v0.8.0 non-blocking architecture | Sidecar METHODS dispatcher + background bridges + event listener pairs + `useGlobalBakeEvents` on-mount attach. |
| IG-011 | Webview room height cascade | RoomShell `align="stretch"` for native-webview rooms. |
| IG-012 | Brand-token parity | `src/brand/brandTheme.css` mirrors `../liquidclips-marketing/src/app/globals.css`. Enforced by `scripts/brand-kit-drift-check.sh`. Hex drift blocks commit. |
| IG-013 | Apple notarisation chain | `.github/workflows/release.yml` + `scripts/notarize.sh` + 5 GH secrets; canonical `xcrun notarytool submit --wait` + `xcrun stapler staple`. |
| IG-014 | `src/lib/authStorage.ts` | Central keychain module + `app.liquidclips.auth.v1` namespace + `scripts/assert-no-passive-keychain.sh` pre-commit + `tests/no-passive-keychain.test.mjs`. |
| IG-014-B/C | Session-reset guard + prod-URL guard | Sister gates. Never clear `authStorage` without documented reset flow. |
| IG-015 | `scripts/iron-gates/bug-015.sh` | Keychain passive-read guard. |
| IG-LC2-017 / IG-LC2-018 | `src/design-os/studio/ClipPreviewShell.tsx` | Clip preview overlay reads. |
| IG-SOV-2.2-001 | `src/lib/carrot.ts` | Carrot economics (5% fee · $10 min withdraw · $50 threshold). |
| IG-HQ-001 | Middleware.ts | `ADMIN_ALLOWED_IPS` from signed `x-vercel-forwarded-for` header. |

**Six Iron Gate pool fences installed (LOCKED 2026-07-20):** RUST-PANIC · IPC-CONTRACT · AUTH-KEYCHAIN · AUTH-KEYCHAIN L5 · COMPOSER-VISUAL · GOLDEN-JOURNEY. All wired via `desktop-2/scripts/iron-gates.sh {fast|pr|release}` + `.githooks/pre-commit`. Full registry: `desktop-2/docs/IRON_GATES_REGISTRY.md`.

---

## 14 · Known bugs (what to watch tomorrow)

Full ledger: `02-technical-documentation/09_BUG_LEDGER.md` + `KNOWN_ISSUES_AND_DEBT.md` + `BUGS_ERRORS_FIXES.md`.

**Currently OPEN (tomorrow is a coin flip whether these fire):**

| ID | What breaks | Where | Severity if it fires in Cohort-0 |
|---|---|---|---|
| **BUG-005** | Notifications badge count desync — badge shows stale number after user reads notifications. | `src/design-os/components/TopHud.tsx` + `useNotifications.ts`. | P2. Cosmetic. Log it, ignore during launch. |
| **BUG-012** | Runtime hot-swap activation gated behind quit+relaunch — pill click sometimes doesn't trigger `relaunch()` cleanly. | `src/App.tsx` update pill + `runtime.rs`. | **P0.** If this fires, users are stranded on old bundles. Docs on rollback in `docs/lc2/RUNTIME_UPDATE_ARCHITECTURE.md`. Ping me immediately. |

**FIXED_UNPROVEN (fixed in code, not yet proven in the wild — watch these):**

- BUG-001 through BUG-017 tracked in `09_BUG_LEDGER.md`. Notable ones:
  - **BUG-036**: Watermark forced-ON for Free — single source `deriveWatermarkPromise`. If Free user sees no watermark, that's a P0 revenue leak.
  - **BUG-038**: Publish + Schedule tabs share `deriveSchedulePromise`. If they diverge, honesty rule breaks.
  - **BUG-006/007/009/012**: Runtime channel constraints. Regressions there strand active users on a broken bundle.

**Not-planned (do not accept these as bugs to fix):**
- Ayrshare / OAuth SDK / Profile Key publishing — memory `feedback_ayrshare_mistake`. If a user asks "when does auto-publish come back?", the answer is "the persistent-cookie browser overlay IS publish now."
- Windows launch — deferred until EV cert.
- Multi-region distributed load proof — planned but not launch-blocking.

---

## 15 · Do NOT touch list (blast radius / hard boundaries)

- **`src-tauri/` — never edit without explicit greenlight from me on this turn.** Not "last week." Not "in a previous session." This turn.
- **Never rebuild the shell on a user's machine.** No local `tauri build → rsync → codesign --force` on installed `.app`. All ship via `updates.liquidclips.app/latest.json`.
- **`account-app/src/components/admin/*Tab.tsx`** — Lane B territory. Only edit if I ask.
- **`junior-backend/`** — Lane B territory. Frontend devs don't touch backend without a synced plan.
- **Never mirror Whop's full subscription record.** Cache only `whop_user_id`, `paid_until`, `subscription_status`.
- **Never overwrite `users.affiliate_id`** — first-touch locked at signup (`oauth-billing.md` §6).
- **Never re-enable GitHub → Railway deploy.** Manual `railway up --service junior-backend --detach` only. Rolling prod back 31 commits is a bad day.
- **Never create duplicate Vercel projects** on other teams for account-app or marketing. Canonical projects are locked (memory `vercel_account_canonical` + `liquidclips-vercel-map`).
- **Never remove `SectionWithFallback` from `WalletDetail`** — kept as legacy fallback only for Wallet. Not app-wide.
- **Never remove `EarnRoute.tsx`** — deprecated but kept as fallback surface.
- **Never delete iron-gate sentinels** without `IRON_GATE_OVERRIDE=1` + documented reason.
- **Never touch `pool_run`** (memory `dd_shopify_guardrails` — that's a Shopify guardrail, not Liquid Clips, but if I mention it, listen).
- **Never build with `--target aarch64-apple-darwin`** on my dev machine — it's Intel (Core i5-1038NG7). Use no `--target` (host) or universal (memory `daniel_mac_arch_intel`).
- **Never say "moving / rolling / running / live" without visible evidence** on-screen. Backend snapshot ≠ UI motion. Silent backends destroy launch trust (memory `feedback_never_claim_moving_without_visible_evidence`).

---

## 16 · Launch-day playbook (tomorrow, 2026-07-24)

### T-minus 12 hours (morning of launch)

1. **Verify prod is healthy:**
   ```bash
   curl https://api.liquidclips.app/healthcheck
   curl -I https://updates.liquidclips.app/latest.json
   curl https://api.liquidclips.app/runtime/manifest.json
   ```
   Expect `200 OK` on all three. `/healthcheck` returns `{status:"ok", ayrshare_configured: <bool>}`.

2. **Verify latest signed DMG is on the marketing download page:**
   ```bash
   curl -s https://liquidclips.app/download | grep -E "Liquid.Clips.*\.dmg"
   ```

3. **Open Admin HQ:** `https://account.liquidclips.app/admin` (requires your IP in `ADMIN_ALLOWED_IPS`).
   - Journey Map tab: watch for red states.
   - Money Funnel tab: activation → subscription conversion rate.
   - Launch War Room tab: real-time signals.
   - Canary tab: any bad-runtime signals from users.

### During the drip (T-0 through T+48 hours)

1. **Sentry** — front-and-center. `desktop-2` frontend errors + `junior-backend` server errors.
2. **PostHog** — funnel: sign-in → activation → first clip generated → export → submit.
3. **Railway logs** — `railway logs -s junior-backend --follow`.
4. **Admin HQ Journey Map** — refresh every 5 min.
5. **Whop dashboard** — subscription events + payouts.

### If a P0 fires

1. **Reproduce in dev**: `npm run dev` → walk the same journey the affected user described.
2. **Fix on a branch off `next-release/liquid-studio-v2.3`.**
3. **Run local invariants**: `npm run test:invariant` (chains tsc + shell guard + brand-kit drift + agency-preview paywall gate + `verify-app`).
4. **Run the golden path spec**: `npm run test:e2e -- full-clipping-journey`.
5. **Ship a runtime hot-swap**: `bash scripts/runtime-ship.sh <version> "<what fixed>"`.
6. **Wait for ship-lens verdict**: green = auto-promoted, red = it will tell you what failed.
7. **Manually promote** via `POST /runtime/promote` if lens is green.
8. **Watch for pill activation** on `/runtime/manifest.json` — users start seeing "Update Ready."
9. **Confirm relaunch works** in your own instance FIRST — click pill, watch `relaunch()` fire, confirm new bundle serves.

### If the runtime hot-swap chain itself is broken (BUG-012 fires)

1. Rollback: `POST /runtime/promote` with prior known-good version. Prior bundles are in `dist-runtime-pack/` in the repo.
2. If update pill isn't showing at all for users: check `AppShell.tsx` — the pill mount is app-wide, if it's gone that's an iron-gate violation.
3. Nuclear option: Path A (full binary update). But this requires notarisation round-trip; you can't do it in an hour.

### Launch-window red flags (any of these = ping me immediately)

- Watermark stripping on Free tier (revenue leak).
- Withdraw button opens the wrong Whop URL (support flood).
- Activation deep-link doesn't fire → users stuck at "signed in on browser, still signed out in app."
- Sidecar `check_deps` fails at boot (Python 3.13 framework Python missing on user's Mac — very common on Ventura installs).
- Any Rust panic in shell (unrecoverable — DMG reinstall required).

---

## 17 · What to expect from me (Daniel) during launch

- I'm active on the shared channel where I dropped the Dropbox link. Response time <15 min during launch window.
- Whop dashboard access, Vercel dashboard, Railway dashboard — read-only creds can be provisioned within 30 min if you need them.
- **Do NOT ask me "is it live? can you test it?"** — I built HQ so you can verify yourself. Mint JWT, curl endpoint, check Sentry, Admin HQ, Railway logs. Report state as a table, don't request it (memory `feedback_never_ask_verify_yourself`).
- If you need approval for a Rust-level change → ask on the shared channel with a 1-sentence "why" and I'll respond in minutes.
- If you're about to say "done / fixed / green / live / ready" → run through `~/.claude/skills/completion-discipline/SKILL.md` first (bundled in the source zip).

---

## 18 · Reading order after this file (for the next 2 hours)

1. This file (you're done).
2. `00-README.md` — the audit-scoped index (5 min).
3. `02-technical-documentation/DEV_TEAM_HANDOVER.md` — doc index (2 min).
4. `02-technical-documentation/PRODUCT_OVERVIEW.md` — product context (10 min).
5. `02-technical-documentation/ARCHITECTURE_MAP.md` — the mermaid diagram + boundaries (15 min).
6. `02-technical-documentation/LOCAL_SETUP.md` — boot the app locally (15 min).
7. `02-technical-documentation/KNOWN_ISSUES_AND_DEBT.md` + `09_BUG_LEDGER.md` — bug ledger (30 min).
8. `02-technical-documentation/TEST_AND_RELEASE_RUNBOOK.md` — how tests + releases run (10 min).
9. `02-technical-documentation/OWNERSHIP_AND_ESCALATION.md` — what NOT to touch (10 min).
10. `03-mac-build-info.md` + `04-apis-and-third-party-services.md` — operational context (10 min).

**Total: ~2 hours of reading + this doc = fully oriented before tomorrow's launch.**

---

## 19 · Contact + escalation

**Daniel** · founder / Liquid Clips
- Repo owner: `github.com/Powstit/liquidclips` (private)
- Reachable via the shared channel where this folder was linked.
- Timezone: London / GMT (mostly).

**One rule that answers most questions I get asked mid-launch:**

> When in doubt, DO NOT ship a shell change. Ship a runtime bundle. If a runtime bundle can't fix it, ping me before touching anything else.

Ship-lens is your safety net. Iron gates are your railings. Runtime hot-swap is your ambulance. Use all three.

Welcome to Liquid Clips. Tomorrow we find out if 40k people would depend on this every day.
