# Commit Impact Report

**Branch:** `wave-d1/codex-update-journey`
**Commit SHA:** `c0ffc8abbb0393aad198bd84b5a378ce0eb5f4f3`
**Base commit:** `51fc037b` (`integration/cold-entry-mode-b`)
**Author (LCOS wave owner):** Train D1 agent (dispatched by integration lead · RC1 release train)
**Cluster:** `cluster-3.runtime-and-updates` · BC-004 (business journey with no canonical owner) · BUG-012 partial mitigation
**Bugs targeted:** BUG-012 (Codex-style workaround lands · native fix still owed · status stays OPEN per Daniel Option-3 disposition)
**Time:** `2026-07-12T11:57Z`

---

### 1. Files changed

| File | Change type | Owner (LCOS) | Line-range |
|---|---|---|---|
| `desktop-2/src/lib/updateJourney.ts` | add | `feature.update-state-machine` · j015 7-state contract | +410 |
| `desktop-2/src/lib/protectedJourney.ts` | add | `feature.protected-journey-registry` · cross-cutting | +115 |
| `desktop-2/src/lib/bootRestore.ts` | add | `feature.boot-restore-verifier` · `lc.restore.v1` semantics | +185 |
| `desktop-2/src/design-os/update/UpdateReadyIndicator.tsx` (+ CSS) | add | Visible soft pill (non-critical + deferred) | +76 tsx / +63 css |
| `desktop-2/src/design-os/update/RestartGate.tsx` (+ CSS) | add | Mandatory blocking modal (critical + user-triggered) | +82 tsx / +97 css |
| `desktop-2/src/components/UpdateBeacon.tsx` | edit | Refactor to transport-only · consumes `updateJourney.*` transitions | ~all body rewritten (~230 lines) |
| `desktop-2/src/components/UpdateBeacon.test.ts` | edit | Update source-contract asserts to new integration shape | +18 / -14 |
| `desktop-2/src/main.tsx` | edit | Wire boot-side State 6 verification (`verifyBootAndRestore`) | +33 |
| `desktop-2/src/App.tsx` | edit | Mount `UpdateReadyIndicator` + `RestartGate` alongside beacon | +12 / -0 |
| `desktop-2/src/design-os/engine/UploadPortal.tsx` | edit | Register `j005-upload` while open OR submitting | +6 |
| `desktop-2/src/design-os/studio/ExportPanel.tsx` | edit | Register `j007-my-clips` while baking OR ransom modal open | +8 |
| `desktop-2/src/components/publish/SubmitToWhopModal.tsx` | edit | Register `j004-connect-whop` while modal open | +7 |
| `desktop-2/src/design-os/components/SubmitToWhopModal.tsx` | edit | Register `j004-connect-whop` while open OR submitting | +8 |
| `desktop-2/src/routes/wallet-detail/WalletDetail.tsx` | edit | Register `j011-payout` while claiming/awaiting_signature/released | +10 |
| `desktop-2/src/design-os/onboarding/ClaimHandleSheet.tsx` | edit | Register `j001-fresh-user-otp-identity` while handle==null OR submitting | +10 |
| `desktop-2/src/lib/updateJourney.state-machine.test.ts` | add | 12 j015 acceptance IDs + telemetry parity + grep guard | +324 |
| `desktop-2/src/lib/protectedJourney.test.tsx` | add | Ref-counting + subscribers + React hook | +130 |
| `desktop-2/src/lib/bootRestore.test.ts` | add | write/read/clear + verdicts + route restoration | +130 |
| `desktop-2/src/design-os/update/RestartGate.test.tsx` | add | Mount/defer/copy assertions · 6 tests | +130 |
| `desktop-2/src/design-os/update/UpdateReadyIndicator.test.tsx` | add | Soft/deferred/click promotion · 4 tests | +105 |
| `desktop-2/src/components/UpdateBeacon.no-reload-wording.test.ts` | add | Grep guard · 4 owned files free of `\breload\b` | +45 |
| `junior-backend/tests/test_lcos_event_update_topics.py` | add | All 8 update topics persist + retrieve + dedupe · 3 tests | +215 |
| `lcos/04_JOURNEY_BIBLE/j015-runtime-update.md` | edit | Append "Implementation landed" · files + protected surfaces + tests | +55 |
| `lcos/09_BUG_LEDGER.md` | edit | BUG-012 "Implementation Journey Landed" block · status stays OPEN | +20 |

### 2. Canonical owner change

**Before:** UpdateBeacon owned its own "booted vs staged" comparison + rendered a "Reload" pill. The reload wording implied same-session activation which was the exact failure mode BUG-012 surfaced to Daniel. Protected-journey deferral did not exist — a critical update mounted the mandatory modal even during an active upload or clip run. No boot-side verification of `booted_version == staged_version` existed.

**After:** `desktop-2/src/lib/updateJourney.ts` is the ONE source of truth for update state. Two hooks (`useUpdateJourney`, `useShouldMountGate`) + one imperative surface (`transitionTo*` / `tryMountGate`). `UpdateBeacon` is now transport-only: it polls `runtime_info` + `runtime_check_now`, listens for `lc:runtime-staged`, and calls the correct state transition. Visible UI is `UpdateReadyIndicator` (soft) and `RestartGate` (mandatory). Every activation goes through a quit + relaunch — no same-session cache-switch is attempted, which is honest under the unfixed BUG-012.

**Duplicate writers removed:** the old beacon-owned `stagedVersion`/`bootedVersion`/`visible` React state is gone. `useRuntimeVersion` (Train B1) stays the canonical version-pill reader (unchanged, referenced read-only).

**Duplicate writers preserved (with justification):** `HardUpdateGate` (security-critical launch-time updates) stays as the outermost boot wrapper — separate concern, separate telemetry, separate visual language. Wave D1's `RestartGate` handles runtime-bundle updates only.

### 3. Chain-link updates

| Layer | Before | After | Delta |
|---|---|---|---|
| Mission fingerprint | `[M3]` (Trust · fragile) + `[M4]` (Retention · fragile) — user could be interrupted mid-work or see a Reload pill that didn't work | `[M3]` proven at every state transition · `[M4]` proven via protected-journey deferral | Trust + retention proofs land |
| Capability | `capability.operational-excellence` (partial owner) | Owner extended: `feature.update-state-machine` + `feature.protected-journey-registry` + `feature.boot-restore-verifier` | +3 new feature IDs |
| Feature | 1 (UpdateBeacon monolith) | 6 (updateJourney · protectedJourney · bootRestore · UpdateReadyIndicator · RestartGate · UpdateBeacon transport) | Split by concern |
| Journey | `j015-runtime-update` (Codex model · authored 2026-07-12) | `j015-runtime-update` (AMBER · Codex model IMPLEMENTED) | Status advance |
| Station | 8 declared (checking · downloading · staged · gate-critical · gate-non-critical · restarting · restored · failed) | 8 wired to state transitions in the machine | All 8 mapped to code |
| Canonical state | none for update lifecycle | `state.update-journey` (owner: `hook.useUpdateJourney`) | +1 canonical state |

### 4. Journeys affected

| Journey ID | Before status | After status (predicted) | Verification method |
|---|---|---|---|
| `j015-runtime-update` | AUTHORED (2026-07-12) · unimplemented | AMBER (7-state machine + 8 telemetry topics + 6 protected surfaces wired + 12 acceptance IDs green) | `updateJourney.state-machine.test.ts` (14 tests · covers all 12 acceptance IDs) + `test_lcos_event_update_topics.py` (3 tests · all 8 topics) |
| `j005-upload` | AMBER | Unchanged · registered as protected via `useProtectedJourney` in UploadPortal | `protectedJourney.test.tsx` |
| `j006-clip-generation` | AMBER | Unchanged · registered as protected via `useEngineSession().phase === "running"` in UpdateBeacon | vitest sweep |
| `j007-my-clips` | AMBER (Train C3) | Unchanged · registered as protected via ExportPanel `pretending` / `ransomOpen` state | vitest sweep |
| `j004-connect-whop` | AMBER | Registered as protected in both SubmitToWhopModal variants | vitest sweep |
| `j011-payout` | AMBER (Train C2) | Registered as protected during claim + signature + released states | vitest sweep |
| `j001-fresh-user-otp-identity` | AMBER (Wave 1) | Registered as protected while handle unclaimed OR submitting | vitest sweep |

### 5. Golden paths affected

| Path | Impact |
|---|---|
| Runtime update detection | Silent · manifest poll fires only when engine not running |
| Runtime download | Silent · no visible indicator |
| Runtime staging | Non-critical: soft pill · Critical: auto-mount mandatory gate (deferred if any protected active) |
| Runtime activation | ALWAYS quit + relaunch · never same-session cache-switch (honest under BUG-012) |
| Boot post-restart | State 6 verification: match → restore route + JWT + draft · mismatch → State 7 failed |
| Protected-journey deferral | 6 surfaces defer the gate · resume attempt on release |
| HQ observability | All 8 update topics persist to `lcos_event` via Train B3 dual-write · queryable via `/admin/lcos-events?topic=update_*` |

### 6. Business capabilities affected

| Capability | Impact | Mission fingerprint delta |
|---|---|---|
| `capability.operational-excellence` | Runtime update no longer interrupts active work · every activation is honest (quit + relaunch) · every transition observable in HQ | M3 (Trust) provable · M4 (Retention) provable |

### 7. Telemetry

**Topics added or changed (all 8 locked by j015 · persisted via Train B3):**
| Topic | Payload | Consumer | Persistence today |
|---|---|---|---|
| `update_detected` | `{current, next}` | HQ Update Funnel | stdout + LCOS events |
| `update_download_started` | `{current, next, size_bytes}` | HQ Update Funnel | stdout + LCOS events |
| `update_staged` | `{current, next, staged_at_ts_ms}` | HQ Update Funnel | stdout + LCOS events |
| `update_gate_shown` | `{current, next, criticality, deferred_by_protected_journey?}` | HQ Update Funnel | stdout + LCOS events |
| `update_restart_clicked` | `{current, next, ts_ms}` | HQ Update Funnel | stdout + LCOS events |
| `update_boot_verified` | `{booted_version, staged_version, matches}` | HQ Update Funnel · State 6 proof | stdout + LCOS events |
| `update_failed` | `{current, next, stage, reason}` | HQ Update Funnel · State 7 | stdout + LCOS events |
| `route_restored_after_update` | `{last_safe_route, restored}` | HQ Update Funnel · State 6 restore proof | stdout + LCOS events |

**Topics deleted:**
| Topic | Reason | Backfill test |
|---|---|---|
| `update_beacon_reload_clicked` | Reload semantics retired · replaced by `update_restart_clicked` | `updateJourney.state-machine.test.ts::restart-persists-restore-state` |
| `update_beacon_shown` | Superseded by `update_gate_shown` + soft indicator (which is the same journey moment with richer payload) | Same test file · `staged-to-gate-*` cases |

Backwards compat: `update_beacon_check_failed` retained on the transport layer (BUG-009 dedup) · now ALSO flips the journey to State 7 via `markFailed("download", …)` on repeated `runtime_check_now` failures.

### 8. Regression tests

**Added (unit / contract):**
- `desktop-2/src/lib/updateJourney.state-machine.test.ts` — 14 tests covering all 12 acceptance IDs from j015 + topic parity + grep guard
- `desktop-2/src/lib/protectedJourney.test.tsx` — 6 tests · ref-counting + subscribers + React hook lifecycle
- `desktop-2/src/lib/bootRestore.test.ts` — 14 tests · round-trip + verdicts + stale detection + route restoration
- `desktop-2/src/design-os/update/RestartGate.test.tsx` — 6 tests · mount/defer/copy/CTA
- `desktop-2/src/design-os/update/UpdateReadyIndicator.test.tsx` — 4 tests · soft/deferred/click
- `desktop-2/src/components/UpdateBeacon.no-reload-wording.test.ts` — 4 grep-guard assertions (one per owned file)
- `junior-backend/tests/test_lcos_event_update_topics.py` — 3 tests · all 8 topics persist + retrieve + dedupe + criticality variance

**Test sweep post-commit:**
- `pytest`: **433 passed / 2 failed (pre-existing OTP failures unrelated to D1 · confirmed same on base 51fc037b)** (was 431+ baseline · +3 new · same 2 pre-existing red)
- `vitest`: **567 passed / 1 skipped / 61 files** (was 55+ files baseline · +6 new test files)
- `tsc --noEmit`: **clean**
- Grep guard: **0 `\breload\b` matches** in the 4 owned files

### 9. Data-state cover

Journey `UpdateJourneySnapshot` covers 7 states with explicit failure sub-states. `verifyBoot` returns 4 verdicts: `matched` / `mismatched` / `no-snapshot` / `stale` (stale = restore snapshot older than 10 minutes, treated as abandoned).

Boot restore snapshot shape:

```
{
  jwt: string | null,
  identity: Record<string, unknown> | null,
  last_safe_route: string | null,
  draft_state: Record<string, unknown> | null,
  ts_ms: number,
  current_version: string,
  staged_version: string,
}
```

Restore route write is guarded — only overwrites `location.hash` when the app booted into an empty hash. If the user had explicitly navigated by the time verify runs, the user's choice wins.

### 10. Live-DB proof owed

Doctor Full walk against Railway prod DB deferred to Barrier 3 (integration lead). The regression tests exercise every code path against SQLite in-memory + jsdom; the byte-identical `lcos_event` retrieval test proves the persistence contract at the API level.

### 11. Backend endpoints added / changed

None. The 8 telemetry topics ride the existing `POST /lcos/events/ingest` + `GET /admin/lcos-events` endpoints landed by Train B3. `test_lcos_event_update_topics.py` proves the topics survive the round-trip.

### 12. Frontend hooks added / changed

| Hook | Purpose |
|---|---|
| `useUpdateJourney()` (`desktop-2/src/lib/updateJourney.ts`) | Reactive read of the journey snapshot · used by both visible surfaces |
| `useShouldMountGate()` | Convenience — true when `state === "gate"` (RestartGate reads this) |
| `useShouldShowIndicator()` | Convenience — true for non-critical staged OR critical-deferred (UpdateReadyIndicator reads this) |
| `useBootVerification(bootedVersion)` | Effect wrapper around `verifyBootAndRestore` for consumers that prefer a hook shape |
| `useProtectedJourney(id, active)` (`desktop-2/src/lib/protectedJourney.ts`) | Cross-cutting registration used by 7 protected surfaces |

### 13. STOP conditions

None triggered.
- No Rust · no Cargo · no `src-tauri/**` edits · no `tauri.conf.json` edit.
- No `package.json` edit · no new npm deps · `@tauri-apps/plugin-process` (used for `relaunch()`) already installed.
- Tauri `relaunch()` command exists — no workaround needed.
- All 6 protected surfaces identified and wired.
- Zero "Reload" wording in owned files · grep guard active.

### 14. Journey files updated

- `lcos/04_JOURNEY_BIBLE/j015-runtime-update.md` — appended "Implementation landed" section listing every owned file · protected-surface map · test file map · BUG-012 disposition note

### 15. Class-elimination progress (per DECISION-0011)

| Class | Before | After | Instances eliminated |
|---|---|---|---|
| BC-004 · Business journey with no canonical owner | j015 authored but unimplemented (Wave B1 STOP report) | j015 AMBER · 7-state machine wired · all 8 telemetry topics persist | **1 instance closed** |
| BC-005 · UI reading divergent stores | UpdateBeacon owned local `stagedVersion`/`bootedVersion`/`visible` state parallel to `useRuntimeVersion` | Beacon is transport-only · journey is the ONE source · every consumer reads `useUpdateJourney()` | **1 instance closed** on update surfaces |
| BC-002 · Multi-source-of-truth (indirect) | "Reload" pill implied same-session activation while native cache stayed pinned | Honest restart-gated activation · never claims same-session hot-swap | Indirect: eliminates a customer-visible truth mismatch |

Cumulative eliminated instances after Train D1:
- BC-004: 6 + 1 = **7**
- BC-005: 4 + 1 = **5**

### 16. Auto-answers for BUG-012 partial mitigation (per DECISION-0010 · 8 architectural questions)

**BUG-012 (partial · native fix still owed):**
1. **Owner:** `capability.operational-excellence` → `feature.update-state-machine` (`updateJourney`)
2. **Canonical state:** `state.update-journey` (owner: `hook.useUpdateJourney` per this wave)
3. **Owning station:** `station.update.gate-critical` + `station.update.restarting` + `station.update.restored` + `station.update.failed`
4. **Test seams:** `data-testid="restart-gate"` · `data-testid="update-ready-indicator"` · `data-testid="restart-gate-cta"` · `data-testid="update-ready-indicator-btn"` · plus `data-current`/`data-next`/`data-critical`/`data-deferred`/`data-deferred-by` attributes
5. **Telemetry topics:** all 8 j015 topics wired through `lcDiag()` · persisted via Train B3
6. **Recovery path:** relaunch failure → journey flips to `failed` state 5's error surfaces as State 7 · boot mismatch → `update_failed { stage: "boot", reason: "booted_version does not match staged_version" }` + clear restore key so we don't loop-fail
7. **Regression tests:** `updateJourney.state-machine.test.ts::boot-mismatch-triggers-failed-state` + `failed-preserves-known-good-runtime` + `restart-persists-restore-state`
8. **HQ observation:** `/admin/lcos-events?topic=update_*` returns every transition · `update_boot_verified.matches` is the single boolean that proves activation succeeded end-to-end

### 17. Provenance

- Base commit: `51fc037b` on `integration/cold-entry-mode-b`
- Branch: `wave-d1/codex-update-journey`
- HEAD after this commit: `c0ffc8abbb0393aad198bd84b5a378ce0eb5f4f3`
- Test sweep: vitest 567/568 (1 pre-existing skipped) · pytest 433/435 (2 pre-existing OTP failures confirmed on base) · tsc clean
- Grep guard: 0 `\breload\b` matches on the 4 owned files
- Class-elimination: BC-004 -1 · BC-005 -1 on update surfaces
- No push · no tag · no deploy · no shell touches · no new npm deps · shell freeze intact
- BUG-012 status: OPEN (native fix at `src-tauri/src/runtime.rs:494` still owed) · beta workaround shipped
