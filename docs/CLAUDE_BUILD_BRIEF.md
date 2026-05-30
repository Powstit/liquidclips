# Claude Build Brief — Liquid Clips v0.4.34 Pre-Ship Sprint

**Prepared by:** Kimi (2026-05-31)  
**Target:** `main` branch at `ea6f3e7`  
**Goal:** Everything wired, tested, and ready for Daniel to notarize + ship to Whop community.

---

## Sprint Overview

Five workstreams. Priority order matters — some block others.

```
P0 ──► Transcript hang fixes (safety — no ship without this)
P1 ──► Ayrshare replaces Postiz (unblocks publishing)
P2 ──► New tier matrix + per-account pricing (revenue model)
P3 ──► Railway backend deploy prep (ops)
P4 ──► Invaders mini-game wiring (polish — already built)
```

---

## P0: Transcript Hang Fixes — SAFETY

**Root cause:** `faster-whisper` `model.transcribe()` with `vad_filter=True` loops infinitely on music-only / corrupt audio. No timeout at Python, Rust, or frontend layer.

**Files to touch:**

| File | Change |
|------|--------|
| `desktop/python-sidecar/sidecar.py` | Wrap `model.transcribe()` in `ThreadPoolExecutor(timeout=120)`. Disable `vad_filter` for `method_lift_transcript`. Add ffprobe duration validation (>30min reject). Add pre-transcribe heartbeat event. Add `_check_cancel()` hook in transcription loop. |
| `desktop/src-tauri/src/sidecar.rs` | Wrap `rx.await` in `tokio::time::timeout` with per-method limits (120s for lift_transcript, 600s for run_stage, 5s for ping/probe). |
| `desktop/src/lib/sidecar.ts` | Wrap `invoke()` in `Promise.race` timeout. Add `SidecarTimeoutError` class. |
| `desktop/src/App.tsx` | Catch timeout errors in `onLiftTranscript()`, show user-friendly "Transcription timed out — try a shorter video" message. |
| `desktop/src/components/TranscriptResult.tsx` | Add Cancel button to `LiftingProgress` that calls new `sidecar.cancelLift()` (writes cancel marker file). |

**Full root-cause + code snippets:** See `docs/TRANSCRIPT_HANG_REPORT.md` (committed at `1c0dd19`).

---

## P1: Ayrshare Replaces Postiz — UNBLOCKS PUBLISHING

**Why:** Postiz is broken (self-host needed, OAuth queues, `AttributeError` on publish). Ayrshare is live API, Bearer token auth, 13+ platforms.

**Files to create:**

| File | Purpose |
|------|---------|
| `junior-backend/app/ayrshare.py` | Client: `post()`, `analytics()`, `history()`, `check_key()`. ~120 lines. |
| `junior-backend/app/routes/social.py` | New routes: `/social/connections`, `/social/connect`, `/social/disconnect/{platform}`. |

**Files to modify:**

| File | Change |
|------|--------|
| `junior-backend/app/models/connections.py` | Rename `PostizConnection` → `SocialConnection`. Add `ayrshare_profile_key` (str), `connected_platforms` (JSON list). Drop `postiz_org_id` / `postiz_access_token`. |
| `junior-backend/app/routes/publish.py` | Replace `postiz.publish_now()` stub with `ayrshare.post()`. Pass `profile_key` from `SocialConnection`. |
| `junior-backend/app/cron.py` | Replace `postiz.publish_now()` stub in `_fire_schedule()` with `ayrshare.post(scheduledAt=...)`. |
| `junior-backend/app/features.py` | Flip `publish_now`, `publish_multi_platform`, `schedule_one`, `drip_scheduling` → `built: True` (remove `_PUBLISHING_LIVE` override or set env `POSTIZ_CLIENT_ID=dummy` to force on). Actually — just set `_PUBLISHING_LIVE = True` hardcoded for this ship, or better: delete the `_NOT_LIVE_UNLESS` block entirely for publishing features. |
| `junior-backend/app/routes/oauth.py` | **DELETE** entire file. Remove Postiz OAuth start + callback. Ayrshare handles user OAuth. |
| `desktop/src/lib/backend.ts` | Replace `connections.list()`, `connections.startConnect()`, `connections.disconnect()` endpoints. Point to new `/social/*` routes. |
| `desktop/src/components/Settings.tsx` `ConnectionsSection` | Keep UI shell. Update `connect()` to open Ayrshare dashboard URL in browser (copy-paste Profile Key flow). Update `disconnect()` to call new backend route. |
| `desktop/src/components/ResultsGrid.tsx` `PublishModal` | Replace `backend.listPostizAccounts()` with `backend.listSocialConnections()`. Show connected platforms as tiles. Multi-select for Growth+. |
| `desktop/src/lib/flags.ts` | `PUBLISHING_ENABLED = true` (currently `false`). |

**Env vars to add to Railway:**
```bash
AYRSHARE_API_KEY=your_api_key_here
# Remove: POSTIZ_CLIENT_ID, POSTIZ_CLIENT_SECRET, POSTIZ_WEBHOOK_SECRET
```

**Full spec with code snippets:** See `docs/AYRSHARE_INTEGRATION_SPEC.md` (committed at `51c0ac6`).

**Account linking flow (simplest v1):**
1. User clicks "Connect accounts" in Settings → opens `https://www.ayrshare.com/profile/connect` in browser
2. User copies their Profile Key from Ayrshare dashboard
3. Pastes into input in Settings → clicks Save → POST `/social/connect` with `profile_key` + `platforms`
4. Backend stores in DB
5. PublishModal reads from `/social/connections` to show what's connected

**V2 improvement (optional, don't block ship):** OAuth callback capture so user doesn't copy-paste.

---

## P2: New Tier Matrix + Per-Account Pricing — REVENUE MODEL

**Current tiers:** Free → Solo $29 → Growth $49 → Autopilot $99

**New tiers (Daniel's decision):**

| Tier | Monthly | Clips | Accounts | Publish | Schedule | Drip |
|------|---------|-------|----------|---------|----------|------|
| **Free** | $0 | 100 | 1 (watermarked) | ❌ | ❌ | ❌ |
| **Solo** | $29.99 | Unlimited | 5 | Now, 1 platform | ❌ | ❌ |
| **Pro** | $79 | Unlimited | 10 | Now, all platforms | ✅ | ✅ Drip |
| **Agency** | $149 | Unlimited | 25 | All + sub-accounts | ✅ | ✅ Drip |

**Per-account overage:** $8 for each account beyond tier limit.

**Files to modify:**

| File | Change |
|------|--------|
| `junior-backend/app/features.py` | Replace `FEATURES_BY_TIER` matrix. Solo gets 5 accounts, publish_now single-platform. Pro gets 10 accounts, schedule, drip. Agency gets 25 accounts, sub-accounts flag. Free stays 100 clips, 1 account, no publish. |
| `junior-backend/app/models/connections.py` | Add `is_active` to `SocialConnection`. Add `extra_accounts_purchased` (int) to `User` model. |
| `junior-backend/app/routes/social.py` | Enforce account limit on connect. Return `limit` + `used` + `can_add_more` in list response. |
| `junior-backend/app/routes/billing.py` (or new) | Calculate monthly charge = base tier + (active_accounts - included) × overage_rate. Return breakdown in `/sync-status`. |
| `junior-backend/app/db.py` (migration) | Add `extra_accounts_purchased` to users table. Rename postiz_connections → social_connections (if not done in P1). |
| `desktop/src/components/Settings.tsx` | Show account usage meter: "Connected: 7/10 on Pro plan" + "$8/mo for 1 extra" when over limit. |
| `desktop/src/components/ResultsGrid.tsx` | Upgrade wall for publish: Free → "Upgrade to Solo"; Solo multi-platform → "Upgrade to Pro"; Pro sub-accounts → "Upgrade to Agency". |
| `desktop/src/lib/backend.ts` | Add `purchaseAccountPack()` endpoint (if doing prepaid packs). Or just show upgrade prompt. |
| `desktop/src/App.tsx` | Read account limit from sync status. Block connect if at limit with upsell. |

**Billing architecture decision needed:**
- **Option A (simplest):** Whop handles subscription tiers. Overage is manual (invoice at month end) or ignored for now.
- **Option B (best):** Stripe metered billing for overages. Whop for base tier. Backend calls Stripe to update subscription item quantity when accounts change.
- **Option C (Daniel's preference, per previous message):** Prepaid account packs — user buys "+5 accounts for $40" that never expire. Simplest for v1.

**Recommendation:** Option C for ship. User buys account packs. Backend tracks `extra_accounts_purchased`. No metered billing complexity.

---

## P3: Railway Backend Deploy — OPS

**Current state:** Backend exists, works locally, not deployed.

**What Claude needs to do (if Daniel hasn't):**

1. **Dockerfile check** — `junior-backend/Dockerfile` exists? Verify it builds.
2. **Health check endpoint** — Add `/health` to FastAPI that returns `{"status": "ok", "version": "0.4.34"}`.
3. **Database migration** — Alembic setup? Or just `Base.metadata.create_all()` on boot (acceptable for v1 with small userbase).
4. **Env var template** — `.env.example` with all required vars:
   ```bash
   DATABASE_URL=postgresql://...
   CLERK_SECRET_KEY=...
   WHOP_WEBHOOK_SECRET=...
   AYRSHARE_API_KEY=...
   JUNIOR_ADMIN_EMAILS=danieldiyepriye@gmail.com,...
   # Remove: POSTIZ_CLIENT_ID, POSTIZ_CLIENT_SECRET, MODAL_TRANSCRIBE_URL, REPLICATE_API_TOKEN
   ```
5. **Cron worker** — Currently in `app/cron.py`. On Railway, this can be a separate worker process or a scheduled job. Verify `SCHEDULER_INTERVAL_MINUTES` env var works.
6. **Webhook endpoints** — Whop purchase webhook at `/whop/webhook`. Verify it updates `users` table with `tier` + `paid_until`.

**What Daniel does (not Claude):**
- Sign up Railway, create Postgres, deploy container
- Add env vars in Railway dashboard
- Point Whop webhook to Railway URL
- Test end-to-end: purchase on Whop → webhook fires → DB updated → desktop syncs

---

## P4: Invaders Mini-Game Wiring — POLISH

**Already built by Kimi** at `9286755` (6 files in `src/lib/invaders/` + `src/components/invaders/`). Just needs Claude to wire into the app.

**Files to modify:**

| File | Change |
|------|--------|
| `desktop/src/App.tsx` | Mount `<InvadersOverlay />` at root level (portals to body, only renders when `useInvadersOpen()` is true). Import from `components/invaders/InvadersOverlay`. |
| `desktop/src/App.tsx` | Add `<InvadersTrigger />` inside the pipeline loading state (when `stage.kind` is `transcribing`, `llm`, `reframe`, `exporting`, etc. — or just when `percent` is not null and elapsed > 5s). Import from `components/invaders/InvadersTrigger`. |
| `desktop/src/App.tsx` | **Autoclose hook:** When pipeline reaches a terminal state (`done` or `error`), call `closeInvaders()`. Also call on `esc` key (already handled in overlay). |
| `desktop/src/lib/sidecar.ts` (or `backend.ts`) | Add `cancelInvaders()` method that writes cancel marker? Not needed — overlay handles its own close. |

**Spec reference:** `docs/KIMI_INVADERS_BUILD.md` §10 (committed with build doc).

---

## Verification Checklist (Before Daniel Ships)

- [ ] `tsc --noEmit` clean
- [ ] `cargo check` in `src-tauri/` clean
- [ ] `npm run tauri build -- --bundles app` succeeds (or at least frontend build)
- [ ] Fresh-Mac test: drop video → pipeline completes → clips export
- [ ] Transcript lift: paste YouTube URL → transcript returns <30s, never hangs
- [ ] Music-only video: times out gracefully with error message
- [ ] Cancel during lift: stops, UI returns to empty state
- [ ] Ayrshare: `/social/connections` returns `connected: false` for new user
- [ ] Ayrshare: paste Profile Key → save → connections list returns platforms
- [ ] PublishModal: shows connected platforms
- [ ] Solo user: can publish to 1 platform
- [ ] Pro user: can publish to 3 platforms simultaneously
- [ ] Scheduled post: appears in Ayrshare dashboard
- [ ] Cron fires scheduled post at correct time
- [ ] Tier gating: Free sees upgrade wall on publish
- [ ] Tier gating: Solo sees "Upgrade to Pro" for multi-platform
- [ ] Account meter: Settings shows "Connected: 3/5 on Solo"
- [ ] Invaders: appears after 5s during transcribing/llm/export
- [ ] Invaders: esc closes, clicking outside closes, pipeline completion closes
- [ ] Invaders: game plays, score saves, replay works
- [ ] Apple notarization: app opens without right-click → Open
- [ ] Whop: purchase flows, webhook updates tier, desktop syncs

---

## File Inventory (What Already Exists vs. What Claude Creates)

### Already Exists (Kimi built, committed)

| File | Commit | Status |
|------|--------|--------|
| `docs/TRANSCRIPT_HANG_REPORT.md` | `1c0dd19` | Reference only |
| `docs/SYSTEMS_IMPROVEMENT_MAP.md` | `6049929` | Reference only |
| `docs/AYRSHARE_INTEGRATION_SPEC.md` | `51c0ac6` | Reference only — full code snippets inside |
| `docs/LOCAL_FIRST_ARCHITECTURE_CLARIFICATION.md` | `13a8a64` | Reference only |
| `docs/1M_MRR_REVENUE_MODEL.md` | `bff723a` | Reference only |
| `docs/PER_ACCOUNT_PRICING_MODEL.md` | `ea6f3e7` | Reference only |
| `desktop/src/lib/invaders/store.ts` | `9286755` | Ready — pub/sub open/close |
| `desktop/src/lib/invaders/highScore.ts` | `9286755` | Ready — $APPDATA persistence |
| `desktop/src/lib/invaders/engine.ts` | `9286755` | Ready — pure game logic |
| `desktop/src/components/invaders/InvadersCanvas.tsx` | `9286755` | Ready — DPR canvas, RAF loop |
| `desktop/src/components/invaders/InvadersOverlay.tsx` | `9286755` | Ready — portal modal, keyboard, replay |
| `desktop/src/components/invaders/InvadersTrigger.tsx` | `9286755` | Ready — 5s delayed button |

### Claude Creates/Modifies

| File | Workstream |
|------|-----------|
| `desktop/python-sidecar/sidecar.py` | P0 — timeouts, VAD disable, ffprobe validation |
| `desktop/src-tauri/src/sidecar.rs` | P0 — tokio timeout on `call()` |
| `desktop/src/lib/sidecar.ts` | P0 — Promise.race timeout wrapper |
| `desktop/src/App.tsx` | P0, P1, P4 — lift error handling, Invaders mount, tier gating |
| `desktop/src/components/TranscriptResult.tsx` | P0 — Cancel button for LiftingProgress |
| `junior-backend/app/ayrshare.py` | P1 — new |
| `junior-backend/app/routes/social.py` | P1 — new |
| `junior-backend/app/models/connections.py` | P1, P2 — rename + new columns |
| `junior-backend/app/routes/publish.py` | P1 — swap Postiz→Ayrshare |
| `junior-backend/app/cron.py` | P1 — swap Postiz→Ayrshare |
| `junior-backend/app/routes/oauth.py` | P1 — DELETE |
| `junior-backend/app/features.py` | P2 — new tier matrix |
| `junior-backend/app/routes/billing.py` (or inline) | P2 — account overage calculation |
| `desktop/src/lib/backend.ts` | P1, P2 — new endpoints |
| `desktop/src/components/Settings.tsx` | P1, P2 — Ayrshare connect flow + account meter |
| `desktop/src/components/ResultsGrid.tsx` | P1, P2 — PublishModal platform tiles + tier walls |
| `desktop/src/lib/flags.ts` | P1 — `PUBLISHING_ENABLED = true` |
| `junior-backend/app/routes/health.py` (or inline) | P3 — `/health` endpoint |
| `junior-backend/Dockerfile` | P3 — verify + fix if needed |
| `junior-backend/.env.example` | P3 — template |

---

## Open Questions for Daniel (Answer Before Claude Starts)

1. **Billing for overages:** Prepaid account packs ($40 for 5 extras), or Stripe metered, or ignore for v1?
2. **Ayrshare tier:** Launch ($299/10 profiles), Business ($599/30), or start with Premium ($149/1 brand) and upgrade when you hit 10 users?
3. **Windows build:** Is it needed for Whop community launch, or Mac-only first?
4. **Founder tier:** Keep the £500 lifetime deal, or sunset it?
5. **Free tier clip limit:** Keep 100 lifetime, or 100/month, or 3/month (current coded cap)?

---

## Commit Message Template

When Claude is done:

```
feat: pre-ship sprint — Ayrshare, tier matrix, transcript safety, Invaders

- Replaces Postiz with Ayrshare (social auto-post, 13+ platforms)
- Restructures tiers: Free → Solo $29 → Pro $79 → Agency $149
- Adds per-account overage ($8/extra beyond tier limit)
- Fixes transcript hang: 120s Python timeout, tokio Rust timeout,
  frontend Promise.race, VAD disable for lift_transcript
- Wires Invaders mini-game into App.tsx + autoclose on pipeline done
- Deletes Postiz OAuth routes, migrates DB to social_connections
- Enables publishing flags, deploy-ready with Railway health endpoint

Co-Authored-By: Kimi <noreply@kimi>
```

**Handoff to Daniel when complete:**
"Pre-ship sprint is in `<base_sha>..<your_sha>`. All five workstreams done. Ready for Apple notarization + Railway deploy."

---

## How to Use This Brief

1. **Read the reference docs** — each P0-P4 section links to a committed doc with full code snippets.
2. **Start with P0** — no ship without transcript safety.
3. **Do P1 next** — unblocks the money feature (publishing).
4. **P2 and P3 can parallelize** — tier changes are backend+frontend, Railway is backend+ops.
5. **P4 last** — it's polish, already built, just wiring.
6. **Run the verification checklist** before any commit.
7. **If stuck:** Add `// QUESTION FOR CLAUDE:` inline comment, ship the file anyway, Daniel reviews.

**Co-Authored-By:** Kimi <noreply@kimi>
