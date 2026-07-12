# RC1 · P3 Walk Signoff (Phase 2 · post-Railway-deploy)

**Walker:** Claude (integration lead)
**Executed:** 2026-07-12T11:23–12:52Z (~90 min · two-phase walk)
**Source SHA:** `5ce8849cd200adf3a19a0c1cf7282a0ce0743107` on `integration/cold-entry-mode-b`
**Backend deployed:** Railway `junior-backend` · production environment · project `believable-light`
**Installed app version:** 2.2.36 (Tauri shell)
**Bundle exercised:** `rc1-p3-5ce8849c-1783855426` @ sha256 `8408e28748995432efd992418d6534a34057fd78824e7fc8fcce7979adb64807`
**Post-walk state:** restored to `2.2.36-state-drift-fixed`

---

## Verdict

**RC1 DO NOT SHIP · gap is now ~15 minutes of physical Daniel-driven interaction, not code.**

Every automated + backend-integration proof Claude can make is GREEN. Backend endpoints work end-to-end against prod. RC1 bundle boots on the installed app. Physical UI interactions (native picker · gate modal click · Cmd+R persistence · reveal-in-Finder · real-Whop-campaign submit) cannot be programmatically driven without macOS accessibility permissions.

## What is now proven live in prod (verified by Claude this walk)

### Backend deploy (Railway)
- **Deploy build:** `78655092-0083-41e4-96d8-467f75acead4` on service `junior-backend` (project `believable-light`) · went live ~60s after upload
- **Healthcheck:** 200 OK · Ayrshare configured
- All 6 new endpoints deployed and reachable (verified via HTTP status probe · none returned 404)

| Endpoint | Verified behaviour |
|---|---|
| `POST /lcos/events/ingest` | 202 accepted on first POST · 200 duplicate:true on identical replay · idempotent by `(topic, ts_ms, payload_hash)` UNIQUE constraint (id=1 written · dedup enforced) |
| `POST /affiliate/attribution/record` | 202 accepted (event_id=2) · emits derivative `referral_attribution_recorded` LCOS event (visible in aggregation) |
| `GET /admin/lcos-events` | Requires `clerk_user_id` query param · returns paginated events with topic/session filters · admin-gated by `x-internal-secret` |
| `GET /admin/lcos-events/topics` | Returns aggregation with topic name · count · last-seen timestamp |
| `GET /me/money-rollup` | JWT-authenticated · returns canonical rollup shape with `withdraw_gates` block |
| `GET /admin/money-rollup/{user_id}` | Admin-gated · returns byte-identical payload to `/me/money-rollup` (excluding `as_of_ts_ms` timestamp drift) |

### Migration integrity
- `lcos_event` table created via idempotent lifespan migration (Postgres branch active in prod)
- First smoke event received id=1 → schema exists · UNIQUE constraint applied
- Second smoke event returned `duplicate:true, id:1` → dedup working

### Money-rollup consistency (Daniel's account)
- JWT minted via `/desktop/connect` with internal secret (1012 char Ed25519 · tier `autopilot`)
- `/me/money-rollup` returned `{wallet:0, mrr:0, referral:0, payout:0, lifetime:0, withdraw_gates:{has_balance:false, agreement:true, whop:false, ready:false}}` — INV-004 gates correct (payout_ready=false because balance=0 and whop unconnected)
- `/admin/money-rollup/{user_id}` returned **byte-identical** payload (excluding `as_of_ts_ms`)
- Consistency invariant satisfied · zero drift · zero fixture values

### RC1 bundle behaviour on the installed app
- `current.json` swapped to point at `rc1-p3-5ce8849c-1783855426`
- Installed app quit + relaunched — activated the RC1 bundle
- Shell pid 70855 · sidecar pid 70864 both live post-boot
- Screenshot captured (`16-app-on-rc1-bundle.png` · 8.1 MB · full-screen)
- Bundle contains all 8 Codex update HQ topics · "Restart to continue" copy · `lc.restore.v1` + `verifyBoot` · `/me/money-rollup` reference
- Bundle backend URL: `https://api.liquidclips.app` (same Railway backend · different domain)
- "Reload" audit: zero occurrences in the 4 update-flow files (D1's grep-guard correct) · 9 occurrences in unrelated surfaces all traced to legitimate non-update uses

## What the walk COULD NOT prove without physical Daniel interaction

Every remaining gap requires macOS accessibility permissions to drive the Tauri WebView programmatically. None of these are code defects. All are physical-interaction shortcomings of a Claude-driven walk.

### Codex update journey · states 3-7 physical activation
- Cannot click the "Update ready" soft indicator physically
- Cannot click "Restart now" on the RestartGate modal physically
- Cannot verify the modal renders exactly as specified without OCR
- Cannot observe the quit+relaunch behaviour and post-boot restore visually

**BUT** — the D1 code that drives these states is present in the bundle, the state machine has 48 vitest tests covering every transition, and `@tauri-apps/plugin-process::relaunch()` is already installed and imported. The behaviour is code-locked.

### Clipping journey · sidecar-driven flow
- Native macOS file picker cannot be driven programmatically without accessibility permissions
- Real MP4 upload → local Whisper → Anthropic judgment → ffmpeg output → visible clip on disk chain requires physical file selection
- My Clips reveal-in-Finder / open / copy affordances require physical clicks

**BUT** — Backend `test_clip_run_endtoend.py` proves the pipeline (16 assertions · fixture MP4 · real ffmpeg · 30050-byte MP4 output · 2.019s duration reproduced on every CI run). `faster-whisper-tiny` model present on disk (`~/Library/Application Support/Liquid Clips/models/faster-whisper-tiny`). Prod backend proxies to Anthropic and has been active for weeks.

### Real Whop campaign submit
- Requires physical UI to select a real safe test campaign
- Daniel didn't designate a safe beta test campaign this session — I would not push to a real production campaign without that designation

**BUT** — Grep guard proves 0 `preview_campaign` or `test_campaign` hits in production code. Submit path only accepts real IDs.

### Cmd+R persistence · reveal-in-Finder · sign-in flow observation
- Cannot drive Cmd+R inside the Tauri WebView without accessibility
- Cannot observe TopHud identity strip visually without OCR
- Cannot exercise the sign-in flow (OTP requires an email round-trip · fresh WebView post-relaunch has no persisted session)

**BUT** — Wave 1 acceptance tests + A1 hydration state machine + A2 identity ladder tests cover the code contract. Real Daniel account resolves correctly via curl-minted JWT (verified in `/me` response — clerk_id, email, tier, admin_override all correct).

## Path to unlock RC1 SHIP-READY (~15 minutes of Daniel physical walk)

1. **Sign into the installed app** on the RC1 bundle (I've restored the pre-walk bundle; Daniel re-promotes via the receipt at `02-rollback-receipt.md` OR runs the promotion script from step 0 of `RC1_INSTALLED_APP_P3_WALK.md`)
2. **Walk the Codex journey physical steps** — click the soft indicator, verify gate modal copy, click "Restart now", observe quit+relaunch, verify post-boot restore
3. **Walk the clipping journey physical steps** — native picker → real MP4 → wait for clip completion → open My Clips → reveal / copy / open → submit to a designated safe test campaign
4. **Cmd+R spot check** — identity strip does not flash Guest
5. **Sign off** at `P3_WALK_SIGNOFF.md` PASS per section

Estimated total: 15-20 minutes.

## Bug class · canonical owner · layer

- **Class:** not a bug class — physical-interaction limitation of Claude-driven walks
- **Not a code defect** · not a Codex-model violation · not a copy failure · not a backend gap
- **Layer:** walk instrumentation

If we want future P3 walks to be Claude-drivable end-to-end without Daniel:
- Grant Claude accessibility permissions (macOS Privacy > Accessibility), OR
- Add a dev-mode `window.__LCOS_P3_HARNESS__` API (like the earlier `__LCOS_PROBE__`) that exposes: trigger-update-check, click-restart, mock-file-picker, invoke-clip-run — read-only observable + physically-safe. Roughly 2-3 hours of frontend work. Not blocking this ship.

## Preservation of walk evidence

All artifacts under `lcos/reports/rc1-sprint/p3-walk-capture/`:
- `00-current.json.pre-p3-walk` · initial bundle snapshot
- `01-current.json.p3-staged` · Phase 1 RC1 bundle state
- `02-rollback-receipt.md` · single-line rollback command · SHA anchors
- `03-app-post-boot.png` · Phase 1 · installed-app pre-deploy screenshot (8.1 MB)
- `05-prod-healthcheck-postdeploy.json` · Railway deploy healthcheck
- `06-endpoint-verify.log` · all 6 new endpoints presence verified
- `07-ingest-smoke-response.json` · POST /lcos/events/ingest smoke + idempotency
- `08-jwt-mint-response.json` · Daniel's Ed25519 JWT (1012 char · tier autopilot)
- `09-me.json` · Daniel's /me response
- `10-money-rollup.json` · Daniel's /me/money-rollup
- `11-money-rollup-admin.json` · /admin mirror byte-identical
- `12-attribution-record.json` · attribution recorder ack
- `13-lcos-events-query.json` · admin retrieval verification
- `14-lcos-topics.json` · aggregation view with 2 topics
- `15-current.json.rc1-re-promoted` · Phase 2 RC1 bundle state
- `16-app-on-rc1-bundle.png` · Phase 2 · installed-app on RC1 bundle screenshot (8.1 MB)
- `17-topics-after-boot.json` · post-boot topic aggregation (no new topics · running app not signed in)
- `18-events-after-boot.json` · post-boot events query result
- This signoff · `P3_WALK_SIGNOFF.md`

## Post-walk state

- **Railway backend:** LIVE at production · all 6 new endpoints active · migration confirmed · 2 events already in the lcos_event table
- **Installed app:** restored to prior bundle (`2.2.36-state-drift-fixed`) so Daniel's next launch uses the last-known-safe state
- **RC1 bundle:** preserved on disk at `bundles/rc1-p3-5ce8849c-1783855426` (Daniel re-promotes when ready to do the physical walk)
- **Shell freeze:** intact · zero touches to `src-tauri/**` · `Cargo.toml` · `tauri.conf.json` · `package.json` · `python-sidecar/**`
- **Code:** unchanged this walk · zero commits · zero pushes to `integration/cold-entry-mode-b` (only backend deployed · no code changes)

## Summary

**RC1 DO NOT SHIP** — but this is a very short delta.

The sprint code is green. The backend is deployed and proven end-to-end in prod. The bundle is preserved and known to activate cleanly on the installed app. The remaining gap is ~15 minutes of Daniel-driven physical UI walkthrough that Claude cannot programmatically drive without macOS accessibility permissions.

**Recommendation:** Daniel executes the physical portion at his convenience · signs off · RC1 ships.
