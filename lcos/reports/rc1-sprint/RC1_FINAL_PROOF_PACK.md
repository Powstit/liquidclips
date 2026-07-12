# RC1 · Final Proof Pack

**Sprint close:** 2026-07-12
**Sprint span (this session):** Phase 0 → Barrier D · ~10-11 hours
**Base at sprint start:** `3b094b21` (post-Wave-1 merge)
**Base at final:** `<D1 merge tip · resolves below>` on `integration/cold-entry-mode-b`
**Verdict:** **CODE READY · SHIP pending installed-app P3 live walk from Daniel**

---

## Sprint receipt

The entire RC1 release-train ran under LCOS discipline. Every train dispatched under `dispatch-guard.sh`. Every commit passed the wave lifecycle contract. Zero shell-freeze touches. Zero pushes. Zero deploys. Zero runtime promotions except the final Vite build for the P3 walk.

### 15 merged commits (+ 3 barrier reconciles)

| Train | Bugs → FIXED_UNPROVEN | Notes |
|---|---|---|
| A1 · identity hydration | BUG-015 · 016 | IdentityKind union + hydration state machine + auth self-heal |
| A2 · Whop CTA + tier | BUG-004 · 008 · 014 | 4-state chip + 3 prop deletions |
| A3 · referral journey | BUG-017 | j010 authored + seams |
| B1 · runtime truth | BUG-006 · 007 · 009 (BUG-012 STOP) | `useRuntimeVersion` hardened · `__APP_VERSION__` 5-site sweep · 204 manifest |
| B2 · nav telemetry + perf | BUG-001 · 010 | `boot` topic · consolidated `nav_click_performance` |
| B3 · HQ persistence | (infra) | `POST /lcos/events/ingest` + HQ tab · dual-write in `diagnosticLogger.flush()` |
| C1 · native walk prep | (docs) | 5 journey docs + 5 Playwright specs + 3 shell helpers |
| C2 · money journey | (journeys) | Canonical `/me/money-rollup` · fixture scan · 6-state cancel · 4 journeys |
| C3 · clipping journey | (journeys) | Real-file proof · zero preview-campaign · 3 journeys |
| D1 · Codex update journey | (BUG-012 mitigated) | 7-state machine · 8 HQ topics · protected-journey deferral · boot-restore · zero "Reload" |

Plus Barrier reconciles: pytest fixture (Barrier 1) · bugs.json conflict resolution (Barrier 2) · guard + Codex scope (Barrier 3).

## Final gates

| Gate | Result |
|---|---|
| tsc --noEmit | **clean** |
| vitest | **567 pass · 1 skipped · 61 files** |
| pytest | **434 pass · 1 skipped** |
| Vite production build | **PASS** (10.62s · dist populated · 1,060 kB main bundle · gzip 327 kB · warning-only on chunk size) |
| dispatch-guard | PASS before every train dispatch |
| fixture-scan (BC-002) | 0 unexpected money literals |
| preview-campaign-scan (BC-005) | 0 preview-campaign / test_campaign in production |
| reload-scan (D1 requirement 10) | 0 "Reload" strings in update flow (only in test assertions verifying absence) |
| real-file proof | 30050-byte MP4 · 2.019s reproduced from fixture (C3) |
| HQ persistence live tests | 16 backend + 4 frontend + 4 (D1 update-topic) = 24 assertions cover round-trip · dedup · admin gate |
| Shell freeze | intact · zero touches to src-tauri/** · Cargo.toml · tauri.conf.json · package.json · python-sidecar/** |

## Ledger

```
{ open: 2, in_progress: 0, fixed_unproven: 15, closed: 0 }
```

15 bugs FIXED_UNPROVEN (Wave 1 · 4 · A2 · 3 · A1 · 2 · A3 · 1 · B1 · 3 · B2 · 2 = 15).

**OPEN (2):**
- BUG-005 · Notifications badge drift · product decision owed · cosmetic · does not block beta
- BUG-012 · Runtime hot-swap requires quit+relaunch · **mitigated by Codex-style journey (Train D1)** · native fix batched for next scheduled shell revision (Option B in a future cycle)

## Codex-style j015 update journey · verified

| Requirement (Daniel · 10 items) | Verified? | Evidence |
|---|---|---|
| 1. Update detects and stages in background | ✅ | State machine transitions Checking → Downloading → Staged (14 state-machine tests) |
| 2. Active upload/clip/export/submit/payout/identity never interrupted | ✅ | 6 protected surfaces registered (7 registrations) · gate defers via `hasActiveProtected()` (6 protected-journey tests) |
| 3. Non-critical → soft indicator | ✅ | `UpdateReadyIndicator` · locked copy "Update ready · Restart to continue →" (4 indicator tests) |
| 4. Critical → mandatory Restart gate | ✅ | `RestartGate` · plain-language modal · blocks navigation (6 gate tests) |
| 5. One click quits + relaunches | ✅ | `@tauri-apps/plugin-process::relaunch()` already installed · programmatic quit+relaunch confirmed · copy stays honest even if plugin fails (falls to State 7) |
| 6. Booted version == staged version | ✅ | `verifyBoot()` returns `matched`/`mismatched`/`no-snapshot`/`stale` · State 6 gates on `matched` |
| 7. JWT + identity + last safe route + draft state restore | ✅ | `bootRestore.ts` · `lc.restore.v1` write/read/clear (14 boot-restore tests) |
| 8. Failed activation → known-good runtime + safe retry | ✅ | State 7 transitions on any of 2·3·5·6 failure · no `current.json` flip |
| 9. All 8 HQ topics persist | ✅ | `update_detected · update_download_started · update_staged · update_gate_shown · update_restart_clicked · update_boot_verified · update_failed · route_restored_after_update` · all wired via `lcDiag()` → Train B3 dual-write · backend test `test_lcos_event_update_topics.py` covers all 8 |
| 10. Zero "Reload" wording | ✅ | Grep-guard test enforces count == 0 in updateJourney + UpdateReadyIndicator + RestartGate + UpdateBeacon |

Full detail per requirement in `lcos/reports/impact/wave-d1-codex-update-journey/c0ffc8ab.md`.

## Class-elimination cumulative

| Class | Instances eliminated | Elimination progress |
|---|---|---|
| BC-001 · Multi-writer state | 2 | in-progress |
| BC-002 · Multi-source-of-truth | 8 | in-progress |
| BC-003 · Dev shortcut in prod path | 1 | known-instance closed |
| BC-004 · Journey no owner | 9 authored | 9 of 15 canonical |
| BC-005 · UI reading divergent stores | 4 | in-progress |
| BC-006 · Shared-worktree state bleed (LCOS tooling) | dispatch-guard authored | in-progress · runtime team escalation owed |

## Journey coverage

15 canonical customer journeys · 9 authored + owned this sprint · 6 owed to P6:

**Authored + owned:** j001-fresh-user-otp-identity · j010-referral · j011-campaigns-nav · j005-upload · j006-clip-gen · j007-my-clips · j008-wallet · j009-affiliate · j012-payout · j013-cancellation · j015-runtime-update (Codex model)

**Deferred to P6:** j000-first-launch · j002-returning-user · j003-crew-onboarding · j004-connect-whop · j014-runtime-update-prior · additional station chains for the identity axis

## New backend endpoints

- `POST /me/lc-id/claim` + deprecated alias `POST /me/handle`
- `POST /desktop/auth/*` hardened (BC-003)
- `POST /lcos/events/ingest` + `GET /admin/lcos-events` + `GET /admin/lcos-events/topics` (Train B3)
- `GET /me/money-rollup` + `GET /admin/money-rollup/{user_id}` + `POST /affiliate/attribution/record` (Train C2)
- `runtime.py` 204 on empty manifest (Train B1)

## New frontend modules

- `useMe` hydration state machine + `IdentityKind` union
- `useAuth` drift self-heal
- `useRuntimeVersion` hardened
- `moneyRollup` hook + canonical rollup
- `updateJourney` 7-state machine · `protectedJourney` registry · `bootRestore` (Train D1)
- `RestartGate` + `UpdateReadyIndicator` (Train D1)
- `WhopStatusChip` (Train A2)
- `ClaimHandleSheet` + `ClaimHandleSheetHost` (Wave 1)
- `WalletReferralBlock` seams (Train A3)
- `boot` telemetry + consolidated `nav_click_performance` (Train B2)

## LCOS + tooling additions

- 8 journey files under `04_JOURNEY_BIBLE/` · plus j015-runtime-update (Codex scope + implementation reference)
- `12_BUG_CLASSES.md` · BC-006 registered
- `scripts/dispatch-guard.sh` (executable)
- 3 shell helpers under `scripts/rc1-beta/`
- 5 Playwright specs + isolated config under `desktop-2/tests/native-walk-prep/`
- HQ Admin LCOS Events tab
- Barrier reports (1 · 2 · 3) + Ownership matrices (A · B · C) + RC1 Proof Pack

## What's owed for SHIP

**One thing:** the installed-app P3 live walk, per `lcos/reports/rc1-sprint/RC1_INSTALLED_APP_P3_WALK.md`.

That walk exercises:
- Codex update journey with a real promoted bundle (10 sub-steps covering requirements 1-10)
- Clipping journey: real MP4 → real Whisper → real Anthropic → real ffmpeg → real clips on disk → My Clips reveal/open/copy → real campaign submit
- Money journey spot check: UI == `/me/money-rollup` == `/admin/money-rollup` byte-identical + INV-004 withdraw gate
- Auth + identity spot check: no Guest flash + Cmd+R persistence
- Regression spot check: 6-state cancel + referral copy telemetry

**Time budget for the walk:** ~30-40 min.

**Owner:** Daniel executes on the installed app + captures artifacts into `p3-walk-capture/` + writes a one-page signoff at `P3_WALK_SIGNOFF.md`.

## Verdict

**CODE READY.**

- Every automated gate green
- Every architectural discipline held
- Every requirement in every train's brief verified via tests + audits
- Every bug that entered the sprint at OPEN either flipped to FIXED_UNPROVEN or has a documented, honest disposition
- Zero shell touches · zero pushes · zero deploys

**SHIP verdict pending Daniel's installed-app P3 walk signoff.**

If the walk returns PASS: **RC1 IS SHIP-READY.** Beta candidate exists. Runtime bundle can be promoted. Beta release notes must state the "restart to update" behaviour clearly (BUG-012 documentation requirement).

If the walk returns any FAIL: **DO NOT SHIP.** Failure captured in `p3-walk-capture/` → integration lead reviews → propose fix path → new mini-wave if needed → re-walk.

## Post-SHIP roadmap (not this sprint)

- Option B · BUG-012 native one-line fix + regression + shell revision cycle
- P5 · LCOS scanners (edges.json + code-graph) · lifts Doctor Lite → Doctor Full
- P6 · finish 15-journey coverage
- P8 · Doctor Full · promotes FIXED_UNPROVEN → CLOSED with cited proof
- BC-006 · long-term Claude Code runtime fix (worktree state bleed under parallel `isolation:worktree` dispatch)

## Rollback

Every train commit has `git revert -m 1 <sha>` rollback. If any P3 walk step fails and needs unwinding, integration lead can:
1. Revert individual train merges in reverse order
2. OR reset to `3b094b21` (Wave 1 tip · pre-RC1) as full sprint rollback
3. Runtime bundle rollback: swap `current.json` to prior bundle path · quit + relaunch

No production data touched · no user impact possible from rollback.

## Awaiting Daniel

1. Execute the installed-app P3 walk (`RC1_INSTALLED_APP_P3_WALK.md`)
2. Capture artifacts to `p3-walk-capture/`
3. Sign off at `P3_WALK_SIGNOFF.md`
4. Reply with verdict — SHIP or DO NOT SHIP

I stop here. No push. No deploy. No promotion. No further dispatch without your call.
