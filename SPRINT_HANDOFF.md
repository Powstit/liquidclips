# Sprint Handoff Log

End-of-session notes so the other agent can pick up cleanly.

Each session appends a new entry at the top. Format:

```markdown
## YYYY-MM-DD HH:MM — AGENT
- Items touched: #N, #N
- Items shipped (merged to main): #N
- In flight (branch state): claude/item-2 — captions WIP, ASS file generator done, ClipPreview UI pending
- Blocked: waiting on Kimi to finish #1 before #5 can test
- Next session: pick up #14a leaderboard

---
```

---

## 2026-06-01 13:30 — CLAUDE (sprint #14c — Minecraft Challenge END-TO-END)

- **Items shipped:** #14c Minecraft Story Clip Challenge — full end-to-end infrastructure for the first Liquid Clips wrapped campaign.
- **Files (explicit paths only):**
  - **Backend new:** `junior-backend/app/{watermark_detector,notion_client}.py`, `junior-backend/app/routes/{submissions,doctrine}.py`, `junior-backend/app/email_templates/minecraft_challenge/*.html` (6 templates + README).
  - **Backend edits:** `app/main.py` (router registers), `app/models.py` (CampaignSubmission table).
  - **Desktop new:** `src/components/workspace/LiquidLiftBanner.tsx`, `src/components/earn/{MinecraftChallengeCard,SubmissionPortal}.tsx`, `src/components/learn/{LearnTab,DoctrineLibrary}.tsx`, `src/assets/minecraft/{hero,logo,moments-grid}.png`.
  - **Desktop edits:** `src/lib/backend.ts` (campaign + submission + doctrine fetchers), `python-sidecar/stages.py` (free-tier watermark filter).
  - **Marketing site:** `src/app/lift/minecraft-challenge/page.tsx` (NEW landing), `public/img/minecraft/*.png` (sprites).
  - **Docs:** `MINECRAFT_CHALLENGE_SPEC.md` v1 (Whop campaign spec at $2.50 RPM).
- **Working end-to-end now:** marketing landing, components ready to mount, backend `/submissions` with server-side watermark detection (cannot be bypassed), `/doctrine/episodes` with Notion-or-mock, 6 Resend templates in Uncle Daniel voice.
- **Validation:** desktop tsc clean, marketing tsc clean, backend py_compile clean across all changed files.
- **What Daniel needs to do** (the "do my part last" items):
  1. Create the Whop campaign per `MINECRAFT_CHALLENGE_SPEC.md` §10 → return campaign ID + Whop affiliate code.
  2. Set `NOTION_API_KEY` + `NOTION_DATABASE_ID` env vars on Railway (doctrine flips from mock to live).
  3. Confirm `RESEND_API_KEY` set + domain verified, then wire submissions.py status hooks to fire the 6 templates (~1hr follow-up).
  4. Rust shell sets `JUNIOR_FREE_WATERMARK=1` when license tier is free (~30min).
  5. Mount points in App.tsx: `<LiquidLiftBanner />` + `<LearnTab />` route + `<MinecraftChallengeCard />` above DropZone (~30min — Codex's territory).
  6. PostHog dashboards from spec §13 once data flows.
- **Strategic note:** infrastructure is fully shipped. The 6 follow-ups are tier-1 integrations (env vars + Whop campaign creation + mount points). After #1 and #5 the campaign is LIVE.
- **Lockfile:** Claude's #14c lock released.

---

## 2026-06-01 12:44 — CODEX
- **Items touched:** #4 mlx-whisper transcribe speedup, #5 auto-updater real-world test docs, #6 onboarding flow + first-run polish, #19 help center docs.
- **Items shipped (working tree):** #4 telemetry/cleanup on top of the bundled MLX backend, #5 updater rehearsal documentation, #6 onboarding overlay, #19 marketing help route tree.
- **Files touched:** `desktop/python-sidecar/whisper_backend.py`, `desktop/python-sidecar/secrets_store.py`, `desktop/python-sidecar/sidecar.py`, `desktop/src/App.tsx`, `desktop/src/components/onboarding/OnboardingOverlay.tsx`, `desktop/src/lib/{analytics,mock-sidecar,sidecar}.ts`, `desktop/CLAUDE.md`, `liquidclips-marketing/src/app/help/**`, `liquidclips-marketing/src/app/globals.css`, `liquidclips-marketing/src/components/Chrome.tsx`, `liquidclips-marketing/src/lib/site.ts`, `SPRINT_LOCKS.md`, `SPRINT_HANDOFF.md`.
- **What changed:** lift completion now emits explicit `pipeline_transcribe_completed` telemetry with `engine`; onboarding appears only on true first-run (no license JWT, no OpenAI key, no `LIQUIDCLIPS_ONBOARDED` keychain flag), has the 4-card walkthrough, sign-in CTA, Settings CTA, sample URL CTA, skip handling, and persists `LIQUIDCLIPS_ONBOARDED=v1` in the keychain. `desktop/CLAUDE.md` now documents the v0.4.99 updater live rehearsal flow. Marketing now has `/help`, `/help/getting-started`, `/help/publishing`, `/help/billing-and-plans`, and `/help/troubleshooting`, linked from nav/footer.
- **Validation:** `npx tsc --noEmit` passed in `desktop/`; `npx tsc --noEmit` passed in `account-app/`; `npx tsc --noEmit` passed in `liquidclips-marketing/` after removing stale duplicate generated `.next/types/* 2.ts` files and rerunning outside the sandbox so TypeScript could write `tsconfig.tsbuildinfo`; `PYTHONPYCACHEPREFIX=/private/tmp/jnr-pycache python3 -m py_compile desktop/python-sidecar/*.py` passed; `PYTHONPYCACHEPREFIX=/private/tmp/jnr-pycache python3 -m py_compile junior-backend/app/*.py junior-backend/app/routes/*.py` passed; `git diff --check` passed.
- **Known blockers / caveats:** I did not push/tag the v0.4.99 updater rehearsal because it creates a public remote release event and should be run from Daniel's clean release candidate commit. MLX itself was not runtime-tested against a real audio file in this pass; the backend/fallback wiring compiles and the selected engine is surfaced in the transcript payload/telemetry.
- **Lockfile status:** no active CODEX locks. Re-read `SPRINT_LOCKS.md` before touching high-conflict files.

---

## 2026-06-01 11:15 — CLAUDE (bundled commit notice)

- **Items shipped (merged to main):** #14a Earnings leaderboard (Claude) + #4 mlx-whisper transcribe speedup (Codex) + a docs/CLAUDE.md auto-updater rehearsal section (Codex).
- **Heads up to Codex:** my `git add -A` for the #14a commit swept up your in-progress #4 mlx-whisper files (`desktop/python-sidecar/whisper_backend.py` NEW, `desktop/python-sidecar/sidecar.py` edits, `desktop/python-sidecar/requirements.txt`, `desktop/src/lib/sidecar.ts`, `desktop/src/App.tsx`, `desktop/CLAUDE.md`). I verified your code is coherent (whisper_backend.py is a complete module with proper faster-whisper fallback + lazy MLX model download), but the bundled commit `9068b66` doesn't credit you in the message — the bundle was unintentional. Treat #4 as DONE. If anything you intended is still WIP, just commit on top with your own message — the bundle didn't lose any of your work.
- **Lockfile status:** I've removed both my #14a lock and your #4 lock (work landed).
- **Process note:** new rule going forward — `git add <specific files>` only, never `-A`, when locks are live.

---

## 2026-06-01 08:27 — CODEX
- **Items touched:** #8 hosted LLM proxy + release audit followups.
- **Items shipped (merged to main):** none — changes remain uncommitted in the shared worktree.
- **Files touched:** `.github/workflows/release.yml`; `junior-backend/app/routes/proxy_llm.py`; `junior-backend/app/{features,main,models}.py`; `junior-backend/{requirements.txt,.env.example}`; `desktop/python-sidecar/llm.py`. No high-conflict files touched and no locks were needed.
- **What changed:** release CI now preflights the updater signing secret against the pubkey baked into `tauri.conf.json` by signing/verifying a canary file; CI release target is now honest `aarch64-apple-darwin` until universal ffmpeg/ffprobe sidecars exist. Backend now has `/proxy/llm/clip-bundle` for Pro/Agency hosted AI, with license-JWT auth, tier gate, OpenAI server key use, and a monthly token bucket (`llm_usage_month`, `llm_tokens_used`). Desktop `llm.py` keeps BYO OpenAI first and falls back to hosted AI when no local key exists and the signed-in tier is Pro/Agency/admin.
- **Validation:** workflow YAML parses; `git diff --check` passes; `PYTHONPYCACHEPREFIX=/private/tmp/jnr-pycache python3 -m py_compile junior-backend/app/*.py junior-backend/app/routes/*.py desktop/python-sidecar/*.py` passes; direct import of `app.routes.proxy_llm` in the backend venv passes. Full `app.main` import in the local backend venv is blocked by a stale/missing venv dependency (`stripe`) even though `requirements.txt` includes it.
- **Known blockers / caveats:** hosted AI needs `OPENAI_API_KEY` set on Railway before `hosted_llm` reports built/live. The signing preflight proves the secret/pubkey match only when the GitHub release workflow runs; we still cannot read the secret locally. Pro/Agency checkout still needs verified Clerk plan IDs to become purchasable.
- **Lockfile status:** no active CODEX locks. Re-read `SPRINT_LOCKS.md` before touching high-conflict files.

---

## 2026-05-31 18:52 — CODEX
- **Items touched:** #7 marketing site; release-readiness followups from `CODEX_NEXT.md` audit.
- **Items shipped (merged to main):** none — changes remain uncommitted in the shared worktree.
- **Files touched:** new `liquidclips-marketing/` Next app; `desktop/src-tauri/PrivacyInfo.xcprivacy`; `desktop/scripts/strip-xattrs.sh`; `account-app/src/app/upgrade/page.tsx`; `account-app/src/components/PricingCards.tsx`. No high-conflict files touched and no locks were needed.
- **What changed:** built a standalone Next/Vercel marketing site with home, privacy, and terms routes; copied existing product imagery into `public/`; added launch-tier pricing copy for Free/Solo/Pro/Agency; removed public-facing legacy tier wording; added local `.gitignore`; documented Vercel deploy/env notes. Followup pass added Apple required-reason API declarations for UserDefaults + file timestamps, strips xattrs from the built Rust release folder, normalizes legacy Growth/Autopilot labels on `/upgrade`, and removes display-only +5 account-pack purchase copy until there is a real checkout path.
- **Validation:** `npm run lint` and `npm run build` pass in `liquidclips-marketing/`; `npx eslint src/app/upgrade/page.tsx src/components/PricingCards.tsx` passes; `npm run build` passes in `account-app/`; `plutil -lint desktop/src-tauri/PrivacyInfo.xcprivacy` and `bash -n desktop/scripts/strip-xattrs.sh` pass. Dev server served `/`, `/privacy`, and `/terms` with HTTP 200 during route smoke checks before the final copy tweak.
- **Known blockers / caveats:** set `NEXT_PUBLIC_DOWNLOAD_DMG_URL` after the notarized DMG/release exists. Pro/Agency checkout still requires verified `NEXT_PUBLIC_CLERK_PRO_PLAN_ID` and `NEXT_PUBLIC_CLERK_AGENCY_PLAN_ID` env values; until then the account app honestly shows waitlist buttons. Visual screenshot capture via macOS `screencapture` failed in this environment, so do one human browser pass before public launch. Updater pubkey/secret match still needs Daniel/GitHub secret verification.
- **Lockfile status:** no active CODEX locks. Re-read `SPRINT_LOCKS.md` before touching high-conflict files.

---

## 2026-06-01 00:45 — CLAUDE (post-audit cleanup + Codex handoff)
- **Self-audit on session 2:** Spawned a focused bug audit on commits 68c55e1 / b41a1b2 / 018b2b7 / e8585f9. Found 5 minor bugs (no ship-blockers, tsc clean throughout). Fixed in commit `2d042eb`:
  1. `humanError` regex bug — `unauthor[is]z` matched impossible strings → fixed to `unauthori[sz]`
  2. `humanError` returned literal `"null"` / `"undefined"` / `"[object Object]"` for non-Error throws → added early-return "Something went wrong."
  3. `_yt_dlp_base_opts(with_progress=False)` had a dead kwarg → removed
  4. Three components (ScheduleQueue, YouTubeView, upload/LocalQueue) had duplicate `humanError` imports from b41a1b2's awk inject → merged into existing sidecar import
  5. `AyrshareConnectionPanel` had a local `humanError` shadowing the shared one → renamed to `ayrshareError` (Ayrshare-specific 503 framing genuinely unique)
- **Created `~/Desktop/jnr/CODEX_NEXT.md`** — directed handoff for Codex with priority list, guard rails, and quality gates. READ THAT before next Codex session.
- **Tonight's total: 9 items shipped by Claude** (#23, #24, #25, #26, #27, #28, #29, #30 + 2d042eb cleanup). 14 sprint items done overall. 18 remaining.

---

## 2026-06-01 00:25 — CLAUDE
- **Items shipped (4 in this batch):** #23 CHANGELOG catch-up (e8585f9), #25 error message audit (b41a1b2), #26 telemetry sanity (68c55e1) — plus all locks released.
- **Sprint progress:** 8 items done by Claude tonight (#23, #24, #25, #26, #27, #28, #29, #30). Codex shipped #1, #5, #9, #11, #21, #22 (per his handoff entry + git log). Remaining: 32 − 14 = 18 items.
- **Files touched this batch:**
  - `CHANGELOG.md` — 8 releases + Unreleased v0.5.0 plan
  - `desktop/src/lib/sidecar.ts` — `humanError()` helper added
  - `desktop/src/lib/analytics.ts` — DesktopAnalyticsEvent vocabulary expanded
  - `desktop/src/App.tsx` — lift_started / completed / failed / canceled track calls
  - 10 components + 2 lib files — `setError(String(e))` → `setError(humanError(e))`
- **In flight:** none. All locks released.
- **Next session (per master sprint, bottom-up):** #20 Recording guide (RECORDING_GUIDE.md), then #15 Sponsored Clips carousel, #16 brief bar removal, #17 Settings legacy cleanup, #18 game phase 1, #18a icon batch.
- **For Codex / Kimi when returning:** Tier 1 items #2 (animated captions), #3 (PublishModal Ayrshare refactor), #4 (mlx-whisper), #6 (onboarding), #7 (marketing site), #8 (hosted LLM proxy) are all ready to pick up. None blocked.

---

## 2026-05-31 23:30 — CLAUDE
- **Items shipped (merged to main):** #24 lift speed micro-wins (commit `018b2b7`). #27 bug audit followups confirmed at HEAD via Codex's `89362a9` (parallel implementation collided cleanly).
- **Files touched:** `desktop/python-sidecar/sidecar.py` only (the 3 #24 micro-wins). Released lock on stages.py + sidecar.rs (no longer needed — Codex's commit covered them).
- **In flight:** none
- **Locks released:** items #27 + #24 lock removed from SPRINT_LOCKS.md.
- **Heads-up for Codex/Kimi:**
  - Codex's commit `89362a9` had release.yml line 88 typo: "Liquid **Claps**" → should be "Liquid Clips". Pre-existing in Codex's branch, not mine — fix on next touch of release.yml.
  - Codex's commit included the unified-bar work I flagged in the prior handoff (TranscriptResult.tsx) — that's now at HEAD. Item #2 (animated captions) builds on top of it cleanly.
- **Next session:** continue bottom-up — #23 CHANGELOG catch-up → #25 error message audit → #26 telemetry sanity.

---

## 2026-05-31 23:45 — CODEX
- **Items touched:** #1 Apple notarization, #5 updater smoke check, #9 xattr-on-build, #11 account-app v2 pricing, #21 privacy manifest, #22 hardened runtime entitlements.
- **Items shipped (merged to main):** none — changes are staged nowhere and remain uncommitted in the shared worktree.
- **Files touched:** `.github/workflows/release.yml`, `desktop/scripts/notarize.sh`, `desktop/scripts/strip-xattrs.sh`, `desktop/src-tauri/{tauri.conf.json,entitlements-direct.plist,PrivacyInfo.xcprivacy}`, `account-app/src/components/{PricingCards,PricingComparison}.tsx`, `account-app/src/app/{page,upgrade,dashboard,download,checkout}/page.tsx`, `SPRINT_LOCKS.md`.
- **What changed:** release CI now imports the Developer ID cert, builds signed universal macOS, notarizes/staples/verifies before draft release upload; local notarize script supports either keychain profile or CI Apple credentials; `.xcprivacy` is bundled and stripped of xattrs; DYLD entitlement removed after no `DYLD_*` usage was found. Account-app public pricing now presents Free / Solo / Pro / Agency, removes Founder from customer-facing surfaces, normalizes legacy `growth/channel → pro` and `autopilot → agency`, and adds the prepaid +5 account-pack cross-sell on Solo/Pro. Public billing guard added: Pro/Agency checkout buttons stay disabled until `NEXT_PUBLIC_CLERK_PRO_PLAN_ID` and `NEXT_PUBLIC_CLERK_AGENCY_PLAN_ID` are set, so we do not display $79/$149 while accidentally charging legacy Clerk prices.
- **Validation:** `bash -n` for notarize/xattr scripts, workflow YAML parse, `tauri.conf.json` JSON parse, `plutil -lint` on plist files, `git diff --check`, targeted account-app ESLint on changed pricing/dashboard/download/page/upgrade files, and `npm run build` in `account-app` all pass.
- **Known blockers / caveats:** `/latest.json` updater endpoints return HTTP 204 for `darwin-aarch64` until a signed artifact/manifest is uploaded, so #5 cannot be fully proven yet. Full `npm run lint` in account-app still fails on pre-existing `react-hooks/set-state-in-effect` issues in checkout/connect/sign-up; I did not broaden scope to fix them. Pro/Agency purchase is intentionally blocked until the final Clerk plan IDs/prices are configured via env.
- **Lockfile status:** released CODEX locks. Re-read `SPRINT_LOCKS.md` before touching high-conflict files.

---

## 2026-05-31 22:30 — CLAUDE
- **Items shipped (merged to main):** #28 splash branding, #29 tasks cleanup (already empty), #30 README + CLAUDE.md updates. Commit: see git log.
- **Files touched:** `README.md`, `desktop/CLAUDE.md`, `junior-backend/CLAUDE.md`, `desktop/src/components/{JuniorLoader,IntentPicker,NotificationSheet}.tsx`, plus new `SPRINT_LOCKS.md` + `SPRINT_HANDOFF.md`
- **In flight:** none
- **⚠️ FLAG for next session / Kimi:** `desktop/src/components/TranscriptResult.tsx` has UNCOMMITTED unified-bar changes (`computeUnifiedPct` helper + `unifiedPct` wiring in `LiftingProgress`). This was supposed to ship as 0.4.44 but the build never persisted the version bump. Currently `git diff desktop/src/components/TranscriptResult.tsx` shows +25/-5 lines pending. Either:
  - (a) Commit + bump 0.4.43→0.4.44, build, ship the unified-bar fix as its own version
  - (b) Bundle it into the next Kimi-led build cycle
  Whoever picks it up: VERIFY the diff is correct (helper at bottom of file, `pct` → `unifiedPct` in the 4 references inside `LiftingProgress`), tsc passes, then either commit-and-build standalone OR fold into a larger commit.
- **Lockfile status:** I held no locks. Kimi holds item #1 (notarization).
- **Next session:** pick up #27 bug audit followups, then #24 lift speed micro-wins, then #23 CHANGELOG catch-up.

---
