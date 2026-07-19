# Liquid Clips · Product Overview

**Doc 2 of 12** · RC1 handover series · full index in [`DEV_TEAM_HANDOVER.md`](./DEV_TEAM_HANDOVER.md).
Certified against commit `e446ddb7` · tag `rc1-dev-handover-2.2.36` · shell v2.2.36. ~10 min read.

---

## 1 · One-liner

**Liquid Clips is a macOS desktop app that turns long-form video (YouTube URL, local mp4, drive import) into short vertical clips a creator can caption / style / watermark / schedule / post — while paying the creator every time a clip converts a Whop bounty.**

Legacy name: Junior / JNR Employee Pro. Public brand: **Liquid Clips** (`account.liquidclips.app`, `liquidclips.app`, `api.liquidclips.app`).

---

## 2 · Who it serves

Three overlapping audiences. The app never asks the user to pick one — they self-select via the `App mode` toggle in TopHud (§3).

| Audience | Job to be done | Where they live |
|---|---|---|
| **Clippers** (typ. 17-22, TikTok-native) | Cut clips, submit to Whop bounties, get paid per view. | Clipper mode. Home + Workstation + Wallet + `#/campaigns` + `#/community`. |
| **Agency owners** | Create bounties/campaigns, review submissions, pay out clippers. | Agency mode. Campaign Builder + Submissions + Analytics (Agency-gated). |
| **Whop bounty ecosystem** | Primary revenue rail — Whop owns auth, subs, agents, community, payouts (LOCKED 2026-06-24). | Every earn/withdraw/checkout CTA opens Whop-hosted pages via `openWhopAction()` or the persistent-cookie BrowseOverlay. |

Product target: 19-year-old clippers. Voice rule: **the word "bounty" is banned in customer copy** — use "skill" / "clip job" / "paid post". Enforced by review, not lint.

---

## 3 · Two-mode model · Clipper vs Agency

A `radiogroup aria-label="App mode"` in the TopHud (`src/design-os/components/TopHud.tsx:653-681`) flips between:

- **Clipper** (default). Cutting + submitting + earning. Reads `localStorage["lc.mode"]="clipper"` on boot (`src/design-os/bridge/useMode.ts:18`) and sets `body[data-app-mode="clipper"]` so CSS accent tokens swap.
- **Agency**. Same shell + agency-only surfaces stacked on top: `AgencyPreviewBanner` mounts in every Design-OS route via `AppShell.tsx:241`; Campaigns exposes the `AgencyCampaignsRoute` builder (hash `#/campaign-builder`); Analytics unlocks real roll-ups; Cockpit copy swaps at `Settings.tsx:643`.

Mode is UI-only — no backend persistence. Toggling to Agency without an active `agency` tier shows previews + upgrade CTAs, not real Agency data. As an engineer: force `clipper` for submit flows, force `agency` for create/review/MRR flows via `localStorage.setItem("lc.mode","agency")` + hard refresh.

---

## 4 · Core customer journey (canonical)

Happy path: [`tests/e2e/full-clipping-journey.spec.ts`](../tests/e2e/full-clipping-journey.spec.ts). Twelve steps — Generate (URL/upload → `#/workstation`) → Edit (cockpit opens Reaction) → Reaction (facecam mp4 → bake done) → Caption (`caption-text` → text/style/position → Apply) → Trim (in/out → Apply) → Watermark (Free forced ON; Paid can toggle OFF) → Style (mono only; other presets are `style-*-coming-soon` stubs; shares `deriveWatermarkPromise` with Publish per BUG-036) → Schedule honesty (Publish + Schedule tabs share `deriveSchedulePromise` per BUG-038) → Export (`publish-now`, success exposes `data-export-watermark` + `data-output-path`) → Assisted schedule (durable reminder in `localStorage["lc.assisted-schedule.v1"]`) → Persistence (switch clips + return → caption/style/trim survive).

Publishing is **assisted, not automated**. Scheduler writes a local reminder + fires a native OS notification. User opens the target platform inside the persistent-cookie BrowseOverlay (`src/components/browser/BrowseOverlay.tsx`) and pastes. See memory `liquidclips_publish_walkaround` — **no Ayrshare / OAuth SDK / Profile Key**.

Wallet earn: submitted clip → Whop tracks views → payout on Whop → withdraw via `openWhopAction(WITHDRAW,…)` → ledger row in `WalletDetail` (`src/routes/wallet-detail/WalletDetail.tsx`).

---

## 5 · Pricing + tier behaviour (LOCKED 2026-07-06)

**Agency-only pricing pivot.** One paid plan. Everything else deferred until 100 Agency users convert.

| Tier | Price | Notes |
|---|---|---|
| **Free** | $0 | Capped at **10 clips lifetime**. Clip 11+ fires `AssetRansomPaywall` (`src/components/paywall/AssetRansomPaywall.tsx`). |
| **Agency** | **$99.99/mo** on Whop `plan_NMKvKj8SVVKsY` ("Founder Access v2") | Immediate charge. Unlocks clip 11+, watermark off, agency mode, real analytics, campaign builder. |
| Founder / Solo / Pro / Enterprise | — | **DEFERRED** until 100 Agency users convert. No tier chooser, no `/pricing` page. See `MAX_HANDOFF_RANSOM_PAYWALL_2026-07-06.md` + `src/design-os/copy/copyMap.ts:388`. |

Tier caps: `src/design-os/state/useTierCaps.ts` (backwards-compat with `growth`/`pro` in `mapBackendTier()`). `docs/PRICING_PLAN.md` is a proposed plan superseded by the pivot — historical context only.

Checkout: TopHud "Sign in" → `openSignInOrSignUpBridge()` (`src/lib/whopCheckout.ts`) opens Whop's hosted checkout in the OS default browser. The in-app OAuth webview was deleted in v2.2.24 (`src/App.tsx:69-75`).

Billing: Whop webhook → `junior-backend` → `/me.subscription_status` + `paid_until` → `useMe()` → `MeBackedBillingAdapter` (`src/lib/billing/adapter.ts:141`) → every tier-gated UI.

---

## 6 · Whop's role

Whop is the primary auth/subs/agents/community/payouts rail (memory locked 2026-06-24). Clerk stays as a **secondary sign-in fallback** — Clerk OTP is still wired at `src/components/auth/ClerkOtpPanel.tsx`, but the front-door path is Whop.

Whop touchpoints: **auth+activation** (`src/lib/whopCheckout.ts`, `whopConnect.ts`, `activation.ts`); **deep-link back** (`liquidclips://activate?…` via `src/lib/deepLinkBoot.ts`); **bounty actions** (`openWhopAction(…)` at `src/lib/openWhopAction.ts:55` — the locked pattern for withdraw / bounty-create / tax-docs / payment-methods); **submit-to-Whop** (`src/design-os/components/SubmitToWhopModal.tsx`); **discovery** (BrowseOverlay opens the persistent-cookie webview on `WHOP_REWARDS_URL`); **connection chip** (`WhopStatusChip` in TopHud reads `useMe().snapshot.whopUserId + useAuth().hasJwt`). Company: `biz_0IMrpJRrTJID1u`.

Clerk is the OTP fallback for users who can't checkout on Whop first (regional payment friction). Never plumb new revenue through Clerk alone.

---

## 7 · What runs live vs mocked vs gated vs planned

| Surface | Status | Notes |
|---|---|---|
| Boot + hash router · Home cockpit · Workstation | live | — |
| Clip generation (URL / upload / drive) | live | Python sidecar (Whisper + Anthropic + ffmpeg) in legacy `desktop/`. |
| Whop hosted checkout | live | — |
| Wallet + referral ledger (`#/earn` → WalletDetail) | live | 6-state puppeteer + real `useWalletLedger()`. |
| Campaigns · Community · BrowseOverlay · Assisted schedule | live | 9 seeded rooms + BC-013 layout; always-on side browser; local reminder + native OS notification. |
| Watermark toggle (Free ON forced, Paid choice) | live | Single source: `deriveWatermarkPromise`. |
| Analytics (`#/analytics`) · Style presets | gated / partial | Analytics preview all, real numbers Agency-only. Style: only mono preset applies. |
| Cancellation intercept | live | Real Whop cancel via `POST /me/trial/cancel`. |
| Runtime updates (7-state j015 machine + beacon + restart gate) | live | **BUG-012 open** — activation gated behind quit+relaunch. |
| Sponsored Rewards module + reward-clip mint list | live | Above + below WalletDetail on `#/earn`. |
| Learn (`#/learn`) · Crew onboarding (`#/crew-onboarding`) | live | — |
| Legacy Design-OS `EarnRoute` | deprecated | Kept only as SectionWithFallback fallback. |
| Ayrshare / OAuth SDK / Profile Key publishing | **not planned** | Rejected — memory `feedback_ayrshare_mistake`. |
| Hosted GPU compute (transcribe + proxy_llm) | planned | Env-gated in backend `features.py`, sprint #14b. |
| Multi-region distributed load proof | planned | ≥99% success required per `liquid_clips_distributed_proof_standard`. |

Anything not on this list: `unclear · verify with Daniel`.

---

## 8 · Runtime FROZEN shell (load-bearing rule)

Read `desktop-2/CLAUDE.md` first. Summary:

- **Tauri 2 shell is FROZEN.** No Rust, Cargo, `tauri.conf`, sidecar, `package.json`, native command or shell rebuild without an explicit greenlight from Daniel.
- **Every UI change is a pure-frontend edit.** React + Vite → runtime bundle. The bundle hot-swaps at boot via `api.liquidclips.app/runtime/manifest.json` (`docs/lc2/RUNTIME_UPDATE_ARCHITECTURE.md`). Users see "Liquid Clips has been updated" and restart — no DMG, no notarisation, no reinstall.
- **Two pipelines** (`desktop-2/CLAUDE.md` §"Two-pipeline pattern"): (1) **Section** (`src/routes/**` + `src/sections/**`, registered in `src/shell/sectionRegistry.ts`) — money surfaces (Wallet, Cold entry, Outreach, Cancellation, Catalog) + cross-cutting shells. (2) **Design-OS** (`src/design-os/routes/**`, registered in `SimulatorRouter.tsx`) — tool surfaces (Home cockpit, Workstation, Campaigns, Analytics, Channels, Settings, Support, Submissions, Thumbnail Studio, Login onboarding).
- **Money-surface rule** (LOCKED 2026-07-10): every Section-pipeline money surface needs an approved HTML mockup in `docs/mockups/approved/` + founder video in `public/brand/founder/*.mp4` + 3+ explicit states. Design-OS tool surfaces don't.
- **Fallback resilience is scoped to Wallet only.** `SectionWithFallback` wraps `WalletDetail` and falls back to the deprecated Design-OS `EarnRoute` on crash. Do not claim app-wide fallback resilience.

**Why frozen**: (1) release velocity — runtime push = minutes vs native release = signed DMG + notarisation round-trip; (2) Apple notarisation cost per-release; (3) shell churn breaks Apple Dev enrollment. Business decision, not laziness.

---

## 9 · Related surfaces (outside this repo)

- **Account app** — `account.liquidclips.app`, Next.js 16 on Vercel, `account-app/`. Whop-backed checkout UI + Admin HQ + journey map + state puppeteer. Manual `vercel deploy --prod`.
- **Marketing** — `liquidclips.app`, Next.js on Vercel, `liquidclips-marketing/`. Manual `vercel deploy --prod`.
- **Backend** — `api.liquidclips.app`, FastAPI on Railway, `junior-backend/`. Manual `railway up --service junior-backend --detach`. Seeds auto-run on lifespan startup: 9 community channels + 3 Uncle Daniel funnel rows.
- **Legacy desktop** — `desktop/` at repo root is the v0.7.x predecessor. Primitives ported into `desktop-2/src/lib/*`. Do not build/ship from there.

Full deployment topology: [`DEPLOYMENT.md`](../../DEPLOYMENT.md) at repo root.

---

## 10 · Where to go next

- **Doc 3** — [`ARCHITECTURE_MAP.md`](./ARCHITECTURE_MAP.md).
- **Doc 4** — [`FEATURE_INVENTORY.md`](./FEATURE_INVENTORY.md) — full feature matrix.
- **Video walkthroughs** — TODO: Daniel · generate Dropbox share link for RC1 founder-walkthrough playlist under `Dropbox: /Liquid Clips/RC1 Handover/videos/`.
- **Brand kit + prod screenshots** — TODO: Daniel · generate Dropbox share link for `Dropbox: /Liquid Clips/RC1 Handover/brand/`.

---

## Verification checklist

Files inspected:

- `desktop-2/CLAUDE.md`, repo-root `CLAUDE.md`, `desktop-2/package.json`
- `desktop-2/src/App.tsx`, `shell/sectionRegistry.ts`, `shell/routes.ts`
- `desktop-2/src/design-os/routing/SimulatorRouter.tsx`
- `desktop-2/src/design-os/components/TopHud.tsx` (640-740), `AppShell.tsx`, `bridge/useMode.ts`
- `desktop-2/src/design-os/routes/Settings.tsx`, `WelcomeRoute.tsx`
- `desktop-2/src/lib/billing/adapter.ts`, `openWhopAction.ts`, `updateJourney.ts`
- `desktop-2/src/sections/account/AccountSection.tsx`, `sections/browse/BrowseSection.tsx`
- `desktop-2/src/routes/wallet-detail/WalletDetail.tsx`
- `desktop-2/tests/e2e/full-clipping-journey.spec.ts`
- `desktop-2/docs/PRICING_PLAN.md`, `lc2/RUNTIME_UPDATE_ARCHITECTURE.md`, `mockups/approved/`, `DEV_TEAM_HANDOVER.md`
- `MAX_HANDOFF_RANSOM_PAYWALL_2026-07-06.md`
