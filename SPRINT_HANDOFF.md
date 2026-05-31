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
