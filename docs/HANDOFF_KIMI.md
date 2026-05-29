# Liquid Clips — Handoff for Kimi

> **Date**: 2026-05-29
> **Repo**: `~/Desktop/jnr/` (was "Junior", rebranded 2026-05-28)
> **Daniel is solo founder. Kimi joining to accelerate the build.**

---

## 0 · One name clarification first

There is **one app, two names**:

- User-facing brand = **Liquid Clips** (`app.liquidclips.desktop`, `productName` in `desktop/src-tauri/tauri.conf.json`)
- Internal cargo crate name = **junior-desktop** (legacy, never renamed)

When you see `target/debug/junior-desktop` running, that IS Liquid Clips. The bundle in `/Applications/Liquid Clips.app/Contents/MacOS/` is also called `junior-desktop` because the binary keeps the crate name. **Same app. Don't try to "fix" this — it's a Sprint v1.1 cleanup item.**

Other legacy "Junior" names you'll see:
- Backend FastAPI app = `junior-backend/`, prod URL = `api.jnremployee.com` (still on jnremployee domain — separate migration)
- Account app at `account.jnremployee.com` (Clerk callbacks tied here — domain migration deferred)
- Marketing flipped: `jnremployee.com` → 308 → `liquidclips.app`

---

## 1 · Repo map

```
~/Desktop/jnr/
├── desktop/                  ← Tauri 2 + React + Python sidecar. The app.
│   ├── src/                  React 18 + TS + Tailwind 4
│   ├── src-tauri/            Rust shell (Tauri 2.11.2, "unstable" feature ON)
│   ├── python-sidecar/       stdio JSON-RPC: ffmpeg + faster-whisper + OpenCV
│   ├── scripts/ship.sh       Atomic bump + build + sign + notarize + upload + verify
│   ├── CLAUDE.md             ← READ THIS FIRST
│   └── package.json          version = 0.4.34
│
├── junior-backend/           FastAPI + SQLAlchemy (Postgres on Railway).
│                             Whop proxy, Clerk webhooks, license JWT issuance.
│                             LIVE at api.jnremployee.com / junior-backend-production.up.railway.app
│
├── account-app/              Next.js. account.jnremployee.com.
│                             Clerk sign-in → /connect-desktop → liquidclips:// deep link.
│
├── partner-app/              Next.js. partner.jnremployee.com.
│                             Affiliate dashboard for Whop clippers.
│
├── marketing/                Static. liquidclips.app + jnremployee.com (redirected).
│
├── updates-proxy/            Vercel function. Serves Tauri auto-update manifest at
│                             updates.liquidclips.app/latest.json
│
├── simulator/                Same React code built for web (VITE_TARGET=web) — demo URL.
│
└── docs/                     ← All scope docs live here. Read these:
    ├── HANDOFF_KIMI.md                              (this file)
    ├── liquid-clips-end-to-end-system-scope.md      Phase gates 0–8, what "done" means
    ├── reward-clipping-priority-roadmap.md          RC-1 → RC-18 (THE roadmap)
    ├── feature-roadmap-pre-ship.md                  F1–F8 (0.4.34 gate items)
    ├── launch-hardening-checklist.md                P0 audit findings
    ├── ship-0.4.34-preflight.md                     Pre-ship verification list
    ├── customer-journey.md                          All 6 user states + invariants
    └── build-status.md                              Sprint 0–8 status
```

---

## 2 · Product, in one paragraph

Liquid Clips is the **desktop command center for reward clippers** — people who watch Whop "Content Rewards" / Clipping.net / Klipy / Opus campaigns, cut short clips from source footage, post them on TikTok / IG / YT Shorts, and get paid per views. The app: drag-drop video → faster-whisper transcript → GPT-4o clip selection → ffmpeg cuts → reframed for vertical → exported to a campaign folder. It has an in-app browser ("Browse Rewards") so the user can read campaign briefs without leaving the workspace. Whop is the primary campaign source; payouts route through Whop directly or via Stripe Connect for Liquid Clips' own affiliate program.

---

## 3 · Architecture, one diagram

```
┌────────────────────────────────────────────────────────────┐
│ Mac desktop app (Tauri 2)                                  │
│ ┌──────────────────┐ ┌─────────────────────────────────┐   │
│ │  React (Vite)    │ │  Rust shell (src-tauri/)        │   │
│ │  src/            │←→│  - spawns Python sidecar       │   │
│ │  Tailwind 4      │ │  - Tauri commands              │   │
│ │  fuchsia/ink/    │ │  - auto-updater (Ed25519)      │   │
│ │  paper tokens    │ │  - deep-link: liquidclips://   │   │
│ └──────────────────┘ └─────────────┬───────────────────┘   │
│                                    │ stdio JSON-RPC         │
│                       ┌────────────▼──────────┐            │
│                       │ Python sidecar         │            │
│                       │ - ffmpeg (bundled)     │            │
│                       │ - faster-whisper tiny  │            │
│                       │ - OpenCV face crop     │            │
│                       │ - OpenAI structured    │            │
│                       └────────────────────────┘            │
└─────────────────────┬──────────────────────────────────────┘
                      │ HTTPS, license JWT in keychain
                      ▼
┌────────────────────────────────────────────────────────────┐
│ junior-backend (FastAPI on Railway)                        │
│ - Clerk webhooks (users, billing)                          │
│ - Whop webhooks (memberships)                              │
│ - Whop proxy /whop/* (App API Key, server-side)            │
│ - License JWT issuance (Ed25519, 30d, auto-rotate)         │
│ - Postiz publish (DISABLED in prod — beta-labeled)         │
└────────────────────────────────────────────────────────────┘
                      ▲                          ▲
                      │                          │
   account.jnremployee.com (Next.js)    partner.jnremployee.com (Next.js)
   Clerk sign-in → desktop activation   Affiliate dashboard
```

Key conventions:
- **State**: React state + Zustand (no Redux)
- **Styling**: Tailwind 4 `@theme` vars in `src/index.css` — fuchsia / ink / paper only, no other colors
- **No new UI frameworks** (no MUI/Chakra/Mantine) — brand tokens are the system
- **Activation**: deep link `liquidclips://activate?token=...` writes JWT to `video.junior.desktop/JUNIOR_LICENSE_JWT` in macOS keychain

---

## 4 · Currently shipped: 0.4.34

Installed at `/Applications/Liquid Clips.app`. Built from commit `e12f782` + uncommitted changes (the working tree had a swap to "companion window" Browse Rewards before ship).

**What works:**
- Sign in via account-app (Clerk) → deep link → keychain JWT
- Drop video → 7-stage local pipeline → exported clips
- Earn tab: browse Whop Content Rewards via backend proxy
- Affiliate dashboard, QR codes, reward-clip tracking, top-of-Earn cockpit
- Auto-updater (Ed25519 signed manifest)
- Stripe Connect F9 (affiliate payouts onboarding — backend live, UI needs polish)

**What's gated/beta-labeled** (do NOT remove these gates):
- `PUBLISHING_ENABLED = false` (Postiz publish/schedule/drip — not wired in prod)
- `HOSTED_LLM_ENABLED = false` (every tier needs own OpenAI key)
- Marketing/account-app copy says "private beta" for hosted AI

---

## 5 · Browse Rewards architecture — current state 2026-05-29 PM

**EMBEDDED child webview, with a fuchsia edge tab as the trigger.** Reversed from the companion-window state earlier the same day; this is Codex's latest pass.

- Embedded native WKWebView (`Window::add_child`) pinned to the right 560 px of the main window
- React workspace gets `paddingRight: 566` so it doesn't sit under the webview
- **Pink vertical "Browse" / "Close" fuchsia tab** on the right edge — mounted at app-shell level so it's available from any tab, not just Earn (`App.tsx:BrowserEdgeTab`)
- **Browser Control Strip in Earn → Available**: Back / Forward / Reload / URL input / Go / Close (`EarnTab.tsx:BrowserControlStrip`)
- **Smart URL bar**: has `://` → use as-is; bare domain → `https://${domain}`; search phrase → `google.com/search?q=...` (`EarnTab.tsx:normalize()`)
- Quick links row: **Whop Rewards** (renamed from "Whop"), Clipping.net, Klipy, Opus

**Architecture has flipped 3× in one day. Do NOT assume any decision is final** — check `git diff HEAD -- desktop/src-tauri/src/browse.rs` before recommending any change. The "this is locked" memory entry has been wrong twice in 12 hours.

**0.4.34 with this architecture is built and locally installed for QA — NOT shipped.**
- Built: `desktop/src-tauri/target/release/bundle/macos/Liquid Clips.app` (0.4.34, 10m 52s release build, **unsigned, not notarized, no updater manifest**)
- Locally installed: `/Applications/Liquid Clips.app` via `scripts/local-install.sh` (atomic quit + replace + relaunch — for Daniel's manual QA only)
- Running: PID 94121 + sidecar PID 94159, both off the `/Applications/Liquid Clips.app/Contents/MacOS/` path
- **Locally QA-passed** by Daniel from screenshot: main app full-width, companion window opens, Whop scrollable, URL bar present, quick buttons present, no embedded overlap, no right gutter
- Final QA in progress: URL navigation (clipping.net / klipy.com / opus.pro), back/forward/reload, close-state sync, brief deep-link reuses existing window
- **Real ship is still pending** — that means `./desktop/scripts/ship.sh 0.4.34` which signs (Developer ID), notarizes (xcrun notarytool), signs the updater bundle (Ed25519 via `junior-updater.key`), uploads `.dmg` + `latest.json` to `updates.liquidclips.app`, and verifies the live manifest reports 0.4.34. Until that runs, no auto-update goes out to any user.

**Code locations (all under `desktop/`):**
- `src-tauri/src/browse.rs` — `WebviewWindowBuilder` w/ label `browse_browser`, `companion_position()` docks right of main using outer_position + scale_factor, commerce-URL filter bounces to system browser
- `src/components/earn/EarnTab.tsx` — `BrowserControlStrip` component
- `src/lib/browse.ts` — singleton open-state + invoke wrappers + `initBrowseBrowserCloseListener` (native close → React state sync)
- `src/components/BrowseRewardsPanel.tsx` — **no-op shim**, returns `null`. Don't re-implement React chrome here.

**Polish backlog (later, not blocking):**
1. Smarter companion window placement — saved position, edge-of-screen awareness, partial-overlap fallback when no room to the right
2. Default width 560 → 640 so Whop renders desktop layout instead of mobile-ish
3. Slimmer Browser Control Strip
4. Persistent URL + scroll across sessions
5. Main app window is currently too wide / partly off-screen on Daniel's display — pure UI layout polish

---

## 6 · What's left (ranked)

### Immediate (this build window)

| Tag | Item | Where | Effort |
|---|---|---|---|
| **F1** | Browse Rewards embedded panel QA + URL bar v2 | `desktop/src-tauri/src/browse.rs`, `desktop/src/components/BrowseRewardsPanel.tsx` | ½ day |
| F4 | Fresh-Mac first-run test | New email + clean keychain | 1 hr |
| F5 | Replace emoji stand-ins with monochrome PlatformIcon SVGs | ScheduleQueue / DripCalendar / partner ShareButtons / marketing dock | 30 min |
| F6 | Real app icon via gpt-image-1 (HARD RULE: NOT procedural — see `catjack_asset_pipeline` memory) | `desktop/src-tauri/icons/` | 1 hr |
| F7 | OG card at `liquidclips.app/og-product.png` (currently 404) | `marketing/` | 30 min |
| F8 | Shadow elevation token system — collapse 15+ ad-hoc `shadow-[...]` into ladder | `desktop/src/index.css` | 2–3 hr |
| — | Ship 0.4.35 once F1 passes installed-QA | `./desktop/scripts/ship.sh` | 15 min build |

### Reward-clipping PMF roadmap (RC-1 → RC-7 are P0)

Full detail in `docs/reward-clipping-priority-roadmap.md`. Summary:

| ID | Item | Why it matters |
|---|---|---|
| RC-1 | **Campaign Brief v1** — manual entry: URL, payout, platforms, rules, source link | Without this, "campaign workflow" is a claim, not a feature |
| RC-2 | **Save-as-brief** button in Browse Rewards panel | Connects browser to workflow state |
| RC-3 | Campaign context strip on Upload/Results | Makes clipping feel campaign-native |
| RC-4 | **Submission Tracker v1** — manual post URL + status | Closes the loop (post → submit → paid) |
| RC-5 | Payout routing clarity (Whop vs Stripe Connect) | Reduces user confusion at the money step |
| RC-6 | Marketing recopy → reward-campaign workflow hero | Aligns external promise with PMF |
| RC-7 | Demote auto-publish/drip in copy | Avoid overpromising beta features |

RC-8 → RC-18 are P1/P2 (campaign scoring, hook/title generator, variant maker, social view tracking, etc.).

### Bigger arcs

- **Domain migration**: `account.jnremployee.com` → `account.liquidclips.app` (requires re-registering all Clerk OAuth callbacks — deferred to 0.4.35+)
- **Mac App Store** distribution (requires IAP replacing Whop/Stripe — explicitly later)
- **Hosted LLM** proxy (so paid tiers don't need OpenAI key) — keep `HOSTED_LLM_ENABLED=false` until real proxy ships and tests
- **Google Drive integration** for campaign source assets (paste URL + open in browser + download → `~/Liquid Clips/rewards/<campaign>/source/`)

---

## 7 · Where things live

### Credentials (local, chmod 600)
`~/.claude-credentials/`
- `clerk.env` — Clerk publishable + secret keys
- `whop.env` — Whop App API key (server-side only)
- `openai.env` — OpenAI key (for sidecar)
- `stripe.env` — Stripe + Connect keys
- `junior-internal.env` — `APPLE_SIGNING_IDENTITY` for ship.sh
- `junior-updater.key` — Ed25519 private key for auto-updater signing
- `junior-jwt.env` — backend JWT signing key
- `junior-webhooks.env` — Clerk + Whop webhook secrets
- `posthog.env`, `resend.env`, `supabase.env`, `vercel-junior.env`

Source these before any backend or CLI work.

### Live infrastructure
- **Backend**: `junior-backend-production.up.railway.app` → `api.jnremployee.com`
- **Updater**: `updates.liquidclips.app/latest.json` (Vercel function in `updates-proxy/`)
- **Marketing**: `liquidclips.app` (Vercel, repo `marketing/`)
- **Account**: `account.jnremployee.com` (Vercel, repo `account-app/`)
- **Partner**: `partner.jnremployee.com` (Vercel, repo `partner-app/`)
- **Simulator**: `app.jnremployee.com` (Vercel, repo `desktop/` built with `VITE_TARGET=web`)
- **DB**: Postgres on Railway (managed)

---

## 8 · Build + ship process

### Dev loop
```bash
cd ~/Desktop/jnr/desktop
npm install                  # one-time
npm run tauri dev            # opens app with hot reload
```

### Ship a release
Use `desktop/scripts/ship.sh` — **do NOT bypass it**. It enforces a verify step against the live updater manifest. Memory: `junior_ship_protocol` — the 0.4.26/27/28 manifest-stale failures came from manual `tauri build` without manifest verification.

```bash
cd ~/Desktop/jnr/desktop
./scripts/ship.sh 0.4.35     # version arg is mandatory
```

What ship.sh does (atomic):
1. Bump `package.json` + `tauri.conf.json` to the version arg
2. `cargo build --release` + `tauri build` (universal Mac binary, signed via `APPLE_SIGNING_IDENTITY`)
3. Notarize with `xcrun notarytool` (keychain profile `JUNIOR_NOTARIZE`)
4. Sign the updater bundle with `junior-updater.key`
5. Upload `.dmg` + `latest.json` to updates endpoint
6. **Verify the live manifest reports the new version** (this is the step that catches stale uploads)
7. `git commit` the version bump + `git push` (best-effort)

### Ship gates (`docs/ship-0.4.34-preflight.md`)
- Apple Developer Program active + Developer ID cert installed
- Notarytool keychain profile `JUNIOR_NOTARIZE` set
- Working tree clean (no leaked secrets)
- Updater endpoint returns 200 + valid manifest before ship
- `liquidclips.app`, `www.liquidclips.app` return 200
- `jnremployee.com` 308 → `liquidclips.app`
- `account.jnremployee.com` returns 200 (Clerk callbacks still live there)

---

## 9 · Hard rules from Daniel (don't violate)

From CLAUDE.md and persistent memories:

1. **Brand tokens are the design system**: fuchsia, ink, paper. No other colors. No new UI framework with its own tokens.
2. **No mid-build refactors**: if previous code annoys you, write it to `desktop/v1.1.md` — do NOT stop to clean.
3. **Copy rules**: past tense for done ("Transcribed audio"), plain verb for in-progress ("Cutting clips"). No exclamation marks. No emojis in UI.
4. **All visuals come from gpt-image-1**, not procedural / programmatic art. Memory: `catjack_asset_pipeline`.
5. **Don't add features beyond the task** — no abstractions for hypothetical futures, no helper functions for one-shot operations.
6. **Single-word nav labels**: Build / Earn / Clips / Settings. Not "Edit Build View" style.
7. **Direct answers** when responding to Daniel — no menu of alternatives, no "are you sure?". Execute the instruction. Memory: `feedback_direct_answers`.
8. **Predictive diagnostics**: map all gates upfront before acting; verify outcome after every "success"; state-diff when things break. Memory: `feedback_predictive_diagnostics`.

---

## 10 · Open questions Daniel still needs to answer

- Final decision on **Campaign Brief schema** (RC-1) — manual entry only for v1, or auto-extract from Whop campaign pages?
- **Domain migration** timing: when to flip `account.jnremployee.com` → `account.liquidclips.app` (touches Clerk OAuth)
- **Mac App Store path** — accept IAP replacement of Whop/Stripe, or stay direct-distribution forever?
- **Hosted LLM** — build proxy now, or keep "bring your own OpenAI key" indefinitely?

---

## 11 · How to pick up where I left off

1. `cd ~/Desktop/jnr && git status -s` — see uncommitted state (lots of doc additions + a few code fixes that haven't been committed)
2. Read `desktop/CLAUDE.md`
3. Read the F1 entry in §5 above + `feature-roadmap-pre-ship.md`
4. Confirm with Daniel that Browse Rewards now embeds inside the window
5. If yes → ship 0.4.35 → start RC-1 (Campaign Brief v1)
6. If no → debug the embedded panel render. Most likely culprits: React main webview z-order, position math off-screen, or Whop site triggering its own `window.open()`. The wry runtime path is verified correct (`tauri-runtime-wry-2.11.2/src/lib.rs:5245`).

Good luck.
