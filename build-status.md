# Junior — Build Status

**Snapshot:** 2026-05-23
**One-line:** Desktop app is feature-complete locally. Backend is built but not deployed. The remaining gates are Railway hosting, Apple cert, and 4 external API approvals — all are wait-queue work that can start in parallel.

---

## 🟢 What's built and live in production

### Marketing site · `jnremployee.com`

| URL | What it is | Status |
|---|---|---|
| `/` | Main creator landing | ✅ Live |
| `/affiliate` | Whop clippers landing | ✅ Live |
| `/affiliates` | General affiliate program | ✅ Live |
| `/security` | Trust + architecture | ✅ Live |
| `/privacy` | Privacy policy | ⚠️ Placeholder banner — needs jurisdiction details |
| `/terms` | Terms of service | ⚠️ Placeholder banner — needs company entity |
| `/refunds` | Refund policy (14d / 30d Founder) | ⚠️ Placeholder banner |
| `/founder` | Founder Lifetime pitch | ✅ Live (stub copy) |
| `/changelog` | Release history | ✅ Live (stub copy) |

### Affiliate dashboard · `partner.jnremployee.com`
All v1 surfaces live (referral link, stat tiles, OAuth, logout).

### Product simulator · `app.jnremployee.com`
**No longer the static demo. It's now the actual desktop app built as a web target** (`VITE_TARGET=web`) — same React code, mock-sidecar shim instead of Tauri, demo-grade data persisted to localStorage. Every flow described in §🟢 Desktop App below is testable here.

### Whop integration
App, all 14 scopes, affiliate enrolment, app-scoped API key in `~/.claude-credentials/whop.env`. Referral URL pattern needs live click-test.

### Infrastructure
Vercel projects live (jnremployee, partner-app, junior-app-simulator). Domains resolved. Credentials in `~/.claude-credentials/`.

---

## 🟢 Desktop app — what's complete (Sprints 0–8, mostly)

### Sprint 0 — Foundations ✅
- Tauri 2.11 shell + Python sidecar via stdio JSON-RPC
- Brand tokens, fuchsia ladder, Geist + Fraunces fonts
- Drag-drop file probe working
- Web-shim layer (`tauri-web-shims/`) so the same React app builds for the simulator

### Sprint 1 — Local pipeline core ✅
- All 7 stages: ingest · audio · transcribe (faster-whisper bundled tiny) · llm (OpenAI structured outputs) · cut (ffmpeg) · reframe (face-detected crop, 3 ratios) · thumbs
- Drop video → vertical clips on disk in ~3 min for a 10-min input
- Caption burn-in skipped on macOS Homebrew ffmpeg (libass not bundled) — flagged v1.1
- Cancel + retry mid-pipeline working

### Sprint 2 — Workspace UI + output bundle ✅
- ResultsGrid with feed-style ClipCards, hover-to-preview
- ClipPreview editor modal with cells, layout icons, music bed, b-roll picker, **editable Title/Caption/Pinned with Save/Discard + char counters**
- Per-clip thumbnail selection (AI variants behind `JUNIOR_THUMBS_AI=1`)
- Files tab + open-in-Finder
- Copy buttons everywhere
- LinkedIn + Threads removed from primary tabs (live in Publish-now only)
- Chapters fixture wired in mock

### Sprint 3 — Settings + onboarding + license/key ✅
- FirstRun screen
- Settings panel with API key management (Bring-Your-Own), OS keychain via Python `keyring`
- Hardware probe with warnings
- Update banner (auto-updater scaffold, real updater binary in Sprint 9)

### Sprint 4 — Junior Backend (built locally, not deployed) ⚠️
**Code complete:** FastAPI + SQLAlchemy + SQLite. All routes built:
- Clerk webhooks (idempotent)
- Whop webhooks (idempotent)
- `/desktop/connect`, `/sync`, `/desktop/heartbeat`
- `/usage/video-started` (Free-tier quota enforcement)
- `/schedules` + cron worker (poll-based, exponential backoff retries)
- `/notifications` + read/dismiss
- `/transcribe-stream` (hosted Whisper for paid tiers)
- `/publish-now` (multipart upload + immediate publish)
- `/oauth/postiz/start` + `/oauth/postiz/callback` + `/connections` (new in §🟢 Sprint 5)
- License JWT issuance, Ed25519 signed, 30d expiry, auto-rotate via `/sync` when ≤5d remaining

**Blocker:** Railway hosting (see §🟡).

### Sprint 5 — Postiz wiring (code complete, deploy pending) ⚠️
**Architecture decision (2026-05-22): Postiz is hidden.** Self-hosted on Railway at `connect.jnremployee.com` (custom domain, white-labelled). Customers never see "Postiz" anywhere in the UI.

Built:
- `app/postiz.py` — full Postiz public-API client (OAuth `exchange_code`, `list_integrations`, `upload_file`, `create_post`, `delete_integration`)
- `PostizConnection` ORM table (user_id, postiz_org_id, access_token, stripe_cus)
- `/oauth/postiz/start` + `/oauth/postiz/callback` + `/connections` routes with tier gates
- OAuth app registered on Postiz Cloud (`pca_8Vc1CaIT77LSZCwGbYWFj2rBUCziNIgF`)
- Credentials in `~/.claude-credentials/postiz.env`

**Blocker:** Railway hosting + DNS for `connect.jnremployee.com`.

### Sprint 6 — Publish-now ✅
- PublishModal rebuilt with per-platform tiles + per-account dropdowns when user has >1 account on a platform
- Brand SVG icons (YT/TT/IG/X) — simple-icons paths inlined, no extra dep
- Tier-gated: Free → upgrade wall; Solo → single-platform; Growth+ → multi-platform
- "Connecting your account…" loader matches Junior voice (no "Postiz" copy)
- Right-click to disconnect

### Sprint 7 — Schedule + cron ⚠️
**UI complete:** "Schedule one" mode in PublishModal with datetime picker. ScheduleQueue panel (top-right) reads from backend with 30s refresh.
**Backend complete:** Cron worker fires due schedules. State lives in Junior DB; calls Postiz at fire time.
**Blocker:** Railway (cron worker needs a deployed env).

### Sprint 8 — Drip mode ✅ (UI) ⚠️ (depends on Sprint 7)
- DripCalendar with 1/2/3/4-week distribution
- Bundled into one Postiz batched create-post call (per docs recommendation, dodges rate limit)
- Gated behind Autopilot tier — Solo/Growth users see the upsell pill

---

## 🟢 Newly added beyond original spec

### Lift transcript flow ✅
**Why:** users want to grab the words from inspiration posts (IG reels etc) without running the full clipping pipeline.
**How:** yt-dlp audio-only → ffmpeg → faster-whisper. ~15–25s for a 75s reel. Poster preview, original caption, copy-all transcript.

### Intent picker (Clips vs YouTube vs Both) ✅
**Why:** the two customer journeys (short-form clipper vs YouTube long-form uploader) were bleeding into each other.
**How:** Junior-agent style picker between drop/fetch and pipeline. YouTube intent skips cut/reframe/thumbs (3-5× faster). Persisted to `project.json`.

### YouTube long-form view ✅
Beats TubeBuddy / VidIQ / 1of10 / Submagic:
- **Scored title variants** (0–100 CTR + one-line reasoning per variant — beats 1of10's gimmick)
- Editable Description with YT 5000-char counter
- Editable Chapters (timestamps + titles, add/remove)
- Hashtag chips (cap 15, YT 2026 best practice)
- Tag chips (cap 500 total chars, YT hard limit)
- Pinned-comment editor
- End-screen CTAs (cue → payoff)
- **"Copy in Studio paste order"** — single click bundles everything in the order YT Studio asks for it
- Save / dirty-state indicator

### Tier system end-to-end ✅
- `features.py` matrix with Free / Solo / Growth / Autopilot
- Mirrored client-side in `useTier.ts` so upgrade walls render instantly
- Free-tier clip-grid blur after clip 3 with UpgradeLockCard
- Upgrade walls integrated into PublishModal
- Quota check on `/usage/video-started`

### Web preview at app.jnremployee.com ✅
Same React code as the Tauri build. Mock-sidecar + mock-backend layer (`isWebPreview()` detection in `backend.ts`). Schedules, notifications, connections all persist to localStorage so the demo survives refresh. **This replaces the old static simulator.**

---

## 🟡 Blocked on Railway hosting

Everything backend-dependent is built but needs a deployed FastAPI + Postgres + Postiz docker. Until then, the desktop runs against `localhost:8000` (dev) or the mock-backend (preview).

**Pending Railway work** (once user provides credentials):
1. Provision Railway project + Postgres add-on
2. Deploy two services:
   - Junior Backend (`uvicorn app.main:app --host 0.0.0.0 --port $PORT`)
   - Postiz docker (`ghcr.io/gitroomhq/postiz-app`) with `API_LIMIT=10000`
3. Custom domains: `api.jnremployee.com` (backend) + `connect.jnremployee.com` (Postiz)
4. Env vars on backend service (POSTIZ_CLIENT_ID/SECRET already saved locally)
5. Update Postiz OAuth app's redirect URL to match
6. After first deploy, run migration (currently `Base.metadata.create_all` in lifespan; alembic when first migration lands)

---

## 🟡 Blocked on external approvals (start in parallel TODAY)

### Apple Developer Program — $99/yr — 24-48h
**For:** Sprint 9 Mac code signing + notarization. Direct-download .dmg distribution (NOT Mac App Store — competitors all direct-download).
**Type:** Individual is fastest (24-48h). Organisation needs D-U-N-S (5-7 days extra).
**Pending Daniel's choice:** Individual or Organisation enrolment.

### Windows EV code-signing cert — $200-400/yr — 1-5 days
**For:** Sprint 9 Windows installer + SmartScreen trust.
**Vendors:** SSL.com or DigiCert.

### YouTube Data API v3 OAuth verification — Free — 4-6 weeks ⚠️ LONGEST POLE
**For:** Hidden inside self-hosted Postiz, but Google still requires the dev app verification at scale (>100 users).
**Action:** Create Google Cloud project + OAuth app + submit for verification.

### TikTok for Developers — Free — 2-4 weeks
**For:** Hidden inside Postiz, but TikTok audits the dev app.

### X Developer Basic — $200/mo — 24h
**For:** Hidden inside Postiz, X just needs an account.

### Instagram via Meta Business
**For:** Hidden inside Postiz. The existing "Liquidsend" Meta App you use for DDB can be reused.

---

## 🟡 Sprint 9 — packaging + signing (next, after Apple cert lands)

- Apple Developer ID Application certificate → Tauri's `signingIdentity` config
- Bundle ffmpeg-static + faster-whisper-tiny inside Tauri resources (currently ffmpeg is system-installed via Homebrew)
- Code signing + notarization workflow (Tauri 2 has docs)
- Windows EV-sign + installer (Wix or NSIS via Tauri)
- Auto-updater wiring (`UpdateState` scaffold + endpoint exists, needs signing key)
- Ed25519 update signing key generated (separate from the JWT keypair)
- Build matrix: macOS Universal (arm64+x86_64) + Windows x86_64

---

## 🔴 Sprint 10 — launch polish

- Stress test: 4h podcast doesn't crash
- Landing page polish (current site is decent but never reviewed end-to-end as a creator funnel)
- `support@jnremployee.com` configured
- Forum welcome post (blocked on agent moderator perms — see junior_project.md)

---

## 🟠 Static content gaps (still pending, ~30 min each)

| Page | What needs filling |
|---|---|
| `/privacy` | Company entity, jurisdiction, DPO contact |
| `/terms` | Company entity, governing law, dispute venue |
| `/refunds` | Final refund window decision (currently 14d / 30d Founder) |
| `/founder` | Real founder-story copy |
| `/changelog` | Real version history once shipping starts |

---

## 🔴 Partner dashboard depth (post-launch, ~1 day total)

- `/payouts` — full payout history + CSV export
- `/assets` — promo kit (tweets, banners, demo clips) — **5–10× activation lever**
- `/referrals` — per-customer attribution detail
- `/settings` — notification prefs, payout method link
- `/leaderboard` — optional public proof
- Real-time `/api/whop/webhook` handler

---

## What's actually left, in shipping order

### Today / this week (no engineering, just paperwork)
1. **Apply to Apple Developer Program (Individual)** — 24-48h queue, $99
2. **Apply Windows EV cert** — 1-5 days, $200-400
3. **Submit YouTube OAuth verification** — 4-6 week queue (longest pole)
4. **TikTok dev app** — 2-4 week queue
5. **X Developer account** — fast, $200/mo (decide when to pull trigger)

### Whenever Railway creds arrive
6. Provision Railway, deploy backend + Postiz, set DNS

### Whenever Apple cert arrives
7. Sprint 9 — sign + notarize Mac installer

### v1.0 ship gate
8. Backend deployed + Mac installer signed + Windows installer signed + 2+ platform OAuths cleared = ready to launch v1.0

### Pre-launch chores
9. Privacy / terms / refunds final copy
10. Landing page once-over
11. `support@` mail set up

---

## Single-line status

**Desktop feature-complete (sprints 0-8). Backend code-complete. Blocked only on Railway hosting + external approval queues — both can start today.**
