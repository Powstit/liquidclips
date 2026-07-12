# RC1 · P3 Walk Signoff

**Walker:** Claude (integration lead)
**Executed:** 2026-07-12T11:23–11:35Z (~12 min · walk halted at architectural gap · not the full 30-40 min budget)
**Source SHA (git HEAD):** `5ce8849cd200adf3a19a0c1cf7282a0ce0743107`
**Branch:** `integration/cold-entry-mode-b`
**Installed app version:** 2.2.36 (Tauri shell)
**Pre-walk bundle:** `2.2.36-state-drift-fixed` @ `2cf87fc6026f49a4f3f768ae12ae1bdc793d58890bebd8d43576dfbe4c0beb7b`
**Promoted bundle (staged then rolled back):** `rc1-p3-5ce8849c-1783855426` @ `8408e28748995432efd992418d6534a34057fd78824e7fc8fcce7979adb64807`
**Rollback:** executed cleanly · machine back at `2.2.36-state-drift-fixed`

---

## Verdict

**RC1 DO NOT SHIP**

Not because RC1 code is broken — RC1 code is green across every automated gate. Not because Codex-model requirement 10 was violated — 9 "Reload" strings in the built bundle were traced and are all outside the update flow (InAppBrowser · BrowseOverlay · Refresh-app fallback · ErrorBoundary · walkthrough-failure copy · dev-debug handle). D1's grep-guard correctly returns 0 for the 4 update-flow files.

**The walk halted at a hard architectural gap I cannot bypass in this session:**

> The installed Liquid Clips app is baked to `https://api.liquidclips.app` (prod backend on Railway). RC1's new backend endpoints — `/me/money-rollup`, `/admin/money-rollup/{user_id}`, `/affiliate/attribution/record`, `/lcos/events/ingest`, `/admin/lcos-events`, `/admin/lcos-events/topics` — are NOT deployed to prod. Your directive was **"No push, production deployment or public beta promotion yet."** Without a deploy, the installed app cannot exercise RC1 end-to-end.

## What the walk did prove (before halt)

### Commit reconcile (PASS)
- HEAD `5ce8849c` is one docs commit past D1 merge `f70ea996` — no drift between the D1 code and the Barrier D report
- Bundle promoted from HEAD via fresh `vite build` (10.62s, dist populated)
- Bundle `index.html` sha256: `8408e28748995432efd992418d6534a34057fd78824e7fc8fcce7979adb64807`

### Rollback receipt (PASS · `02-rollback-receipt.md`)
- `current.json` backed up to `current.json.pre-p3-walk` + copied to capture dir
- Single-line rollback command documented
- Both bundle SHAs recorded
- Post-walk restore executed cleanly

### Bundle inspection (PASS · D1 code IS in the built bundle)
- All 8 Codex update-journey HQ topics present: `update_detected` · `update_download_started` · `update_staged` · `update_gate_shown` · `update_restart_clicked` · `update_boot_verified` · `update_failed` · `route_restored_after_update`
- "Restart to continue" copy present (1 hit · locked)
- `lc.restore.v1` + `verifyBoot` present
- `/me/money-rollup` reference present
- `updateJourney` / `protectedJourney` names minified (expected for prod build · behaviour intact)

### "Reload" wording audit (PASS · Daniel requirement 10)
- 9 occurrences in the bundle — traced to source
- Zero in the 4 update-flow files (updateJourney.ts · UpdateReadyIndicator.tsx · RestartGate.tsx · UpdateBeacon.tsx)
- All 9 are legitimate non-update uses: InAppBrowser reload button, BrowseOverlay aria-label, Refresh-app fallback title, ErrorBoundary "Reload brick", walkthrough failure copy, `__lcDebugReloadChannels` dev handle
- D1's grep-guard test correctly enforces zero in the update flow

### Installed app + sidecar (PASS · running smoothly)
- `/Applications/Liquid Clips.app` v2.2.36 launched via `open` (screenshot `03-app-post-boot.png` · 8.1 MB)
- Sidecar process `liquid-clips-sidecar` came up alongside shell (pid 69618)
- Faster-whisper-tiny model present at `~/Library/Application Support/Liquid Clips/models/faster-whisper-tiny`
- Prod backend `api.jnremployee.com` + `api.liquidclips.app` + Railway domain all reachable · healthcheck OK

## What the walk could NOT prove (the halt gaps)

### The Codex update journey full end-to-end (requirements 1-9)
- **Gap · prod backend lacks `/lcos/events/ingest`** — the 8 HQ topics fire from the frontend but return 404 · never persist to Railway · no HQ Admin LCOS Events row will appear
- **Gap · prod backend lacks `/admin/lcos-events`** — HQ Admin view step (walk step 1h) would show empty
- **Gap · no physical UI seam** — even if backend were deployed, driving the "click Restart now" button on the modal requires macOS accessibility permissions not available in this session
- **Gap · single-bundle-swap protocol** — full end-to-end requires two-phase promotion (Codex-aware bundle first, then trigger update), and requires observing the running WebView

### The Codex behaviour requirement 5 (physical relaunch)
- **Bundle-level PASS** — `@tauri-apps/plugin-process::relaunch` is imported in `updater.ts`, `IntroSplash.tsx`, and D1's `updateJourney.ts`. Programmatic quit+relaunch is available
- **Runtime GAP** — cannot physically click the modal button to fire the transition without accessibility permissions

### The real clipping journey (requirement 2)
- **Backend integration test GREEN** (pytest 434/434 · C3's `test_clip_run_endtoend.py` proves ffmpeg round-trip against fixture MP4)
- **Real customer-like walk GAP** — driving the native macOS file picker programmatically requires accessibility permissions
- **Real Anthropic clip judgment against prod backend GAP** — prod backend proxies to Anthropic and would work; but the flow requires physical file picker interaction

### The money journey (requirement 4)
- **Local backend PASS** — pytest 434/434 covers `/me/money-rollup` and admin mirror byte-identical (13 assertions in `test_money_rollup_consistency.py`)
- **Installed-app-vs-prod-backend GAP** — endpoint doesn't exist in prod. Wallet page will 404 on `/me/money-rollup` if the installed app tries to call it

### Real campaign submission (requirement 3)
- **Backend contract PASS** — `campaign-submit.real-id.test.ts` proves no `preview_campaign_id` in production code (10 assertions)
- **Real submission GAP** — requires a designated safe beta/test Whop campaign ID from Daniel + physical UI interaction to select it

## Bug class + canonical owner for the halt

**Class:** BC-006 · shared-infrastructure state under parallel dispatch (proposed extension)

Actually more precisely: **this is a release-topology gap, not a code bug.** The RC1 sprint disciplined "no push, no deploy" throughout so that the sprint could be reviewed atomically. The correct sequencing was always going to be:

1. Sprint discipline: no push, no deploy (this session · complete)
2. Daniel reviews the sprint (RC1_FINAL_PROOF_PACK.md)
3. Daniel authorises the coordinated release: backend deploy + bundle promotion together
4. THEN the installed-app P3 walk against the deployed system

Skipping step 3 makes step 4 impossible.

**Canonical owner:** integration lead + Daniel (release coordination · not a code owner)
**Layer:** runtime/backend release topology (not a native concern)

## Minimum path to SHIP-READY

1. **Authorise `railway up --service junior-backend` from `junior-backend/`** — deploys RC1 backend including all 6 new endpoints. Idempotent lifespan migrations (Train B3 · Train C2) auto-apply the new `lcos_event` table and any other schema changes. Reversible via prior Railway rollback.
2. **Verify prod healthcheck** after deploy · confirm `/lcos/events/ingest` returns 202 · confirm `/me/money-rollup` returns valid shape when hit with a real JWT.
3. **Re-promote the RC1 bundle locally** (per this walk's rollback receipt · the `rc1-p3-5ce8849c-1783855426` bundle is still on disk at `~/Library/Application Support/Liquid Clips/runtime/bundles/rc1-p3-5ce8849c-1783855426`)
4. **Daniel executes the physical portion of the walk** — steps that require native macOS interaction: native file picker (real MP4 → upload) · click Restart-now on the gate modal · Cmd+R preservation · reveal-in-Finder · real campaign submit modal selection. Estimated 30-40 min.
5. **Daniel signs off** at `P3_WALK_SIGNOFF.md` with PASS per section.
6. **Then RC1 SHIP-READY.**

## Recommended mini-wave (before deploy)

**NONE required.** RC1 code is green. The halt is not a code defect. The blocker is a release-orchestration decision.

If you want a mini-wave that would raise confidence further (optional):
- **Mini-wave: pre-deploy dry-run.** Backend deployed to a Railway `staging` service (if it exists · else Railway's PR-preview URL). Installed app URL override in a debug menu (feature-flagged) to point at the staging URL. Full walk against staging first. Ships to prod only after staging PASS. **Recommend as follow-up · not blocking.**

## Preservation of failure evidence

All walk artifacts under `lcos/reports/rc1-sprint/p3-walk-capture/`:
- `00-current.json.pre-p3-walk` · bundle state before promotion
- `01-current.json.p3-staged` · bundle state during walk
- `02-rollback-receipt.md` · rollback command + SHA anchors
- `03-app-post-boot.png` · installed-app screenshot after launch (8.1 MB · full-screen)
- This signoff · `P3_WALK_SIGNOFF.md`

Bundle `rc1-p3-5ce8849c-1783855426` remains staged on disk for re-promotion once backend deploys.

## No push · no deploy · no promotion this session

Rollback executed. Machine restored to `2.2.36-state-drift-fixed`. Zero shell touches. Zero code changes this walk (only bundle promotion + rollback · both filesystem operations).

## Summary

**RC1 DO NOT SHIP.**

Reason: prod backend RC1 endpoints not deployed. Not a code defect. Not a Codex-model violation. Not a copy failure.

Path forward is short: authorise the backend deploy, run the physical walk, sign off. RC1 code is green and ready.
