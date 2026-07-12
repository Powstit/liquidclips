# j015 · Runtime Update Journey (Codex model)

**Journey ID:** j015-runtime-update
**Owning capability:** capability.operational-excellence
**Mission fingerprint:** M3 (Trust) · M4 (Retention)
**Locked by:** Daniel · 2026-07-12 · BUG-012 disposition update
**Related bugs:** BUG-012 (native cache-switch fix pending shell revision)

## Philosophy

Runtime updates are a **background concern**. The user is never interrupted by an update while doing meaningful work. Updates are staged silently. The app only interrupts the user at a **deliberate, safe gate** when activation truly requires a restart.

## The seven states

```
┌─────────────┐   detected     ┌──────────────┐   200 OK        ┌────────────┐
│ 1. Checking │ ─────────────▶ │ 2. Downloading│ ──────────────▶ │ 3. Update  │
│  (silent)   │                │   silently    │                │  ready     │
└─────────────┘                └──────────────┘                 └─────┬──────┘
                                                                     │
                             ┌───────────────────────────────────────┘
                             │ non-critical: soft indicator only
                             │ critical: block navigation
                             ▼
                       ┌──────────────┐   user click     ┌──────────────┐
                       │ 4. Restart   │ ──────────────▶  │ 5. Restarting│
                       │   required   │                  │ (quit+launch)│
                       └──────────────┘                  └──────┬───────┘
                                                                │
                                                                ▼
                       ┌──────────────────────────────────────────────┐
                       │ 6. Restored on new runtime                    │
                       │   verify booted_version == staged_version     │
                       │   restore JWT + identity + last safe route    │
                       │   + recoverable draft/session state           │
                       └──────────────────────────────────────────────┘

                              (if any of 2,3,5,6 fails)
                                          ▼
                       ┌──────────────────────────────┐
                       │ 7. Update failed · safe retry │
                       │   remain on known-good runtime │
                       │   surface "Try again" CTA     │
                       └──────────────────────────────┘
```

## State-by-state contract

### State 1 · Checking

- Trigger: boot + every N minutes (existing UpdateBeacon polling)
- Visible: nothing
- Backend call: `GET /runtime/manifest.json` (Train B1 fix returns 204 on empty)
- Telemetry: nothing (checking is idle)

### State 2 · Downloading silently

- Trigger: manifest reports a new version
- Visible: nothing (or tiny non-blocking spinner in Diagnostics section)
- Action: download the bundle to staging directory
- Telemetry: `update_detected { current, next }` · then `update_download_started { current, next, size_bytes }`

### State 3 · Update ready (staged)

- Trigger: download completes; bundle written to `~/Library/Application Support/Liquid Clips/runtime/bundles/<next>/`
- Visible:
  - **Non-critical update:** small "Update ready" indicator in Diagnostics section OR next to app version. Non-blocking.
  - **Critical update:** no visible change yet · waits for next safe checkpoint
- Telemetry: `update_staged { current, next, staged_at_ts_ms }`

### State 4 · Restart required

- Trigger:
  - **Non-critical:** user clicks the "Update ready" indicator OR reaches a safe checkpoint AND has been idle for N minutes
  - **Critical:** immediately after staging completes AND no active protected journey
- Visible: **mandatory gate modal**. Plain language:
  > **Update ready · Restart to continue.**
  > A new version is ready. The app will quit and relaunch to activate it. Your sign-in, current view, and any unsaved draft will be restored.
- CTA: single button — "Restart now"
- Blocking: cannot dismiss. All navigation blocked. If a protected journey is active, gate defers until the journey completes.
- Telemetry: `update_gate_shown { current, next, criticality, deferred_by_protected_journey?: string }`

### State 5 · Restarting

- Trigger: user clicks "Restart now"
- Visible: brief spinner
- Action:
  1. Persist app state to disk: `{ jwt, identity, last_safe_route, draft_state, ts_ms }` under a boot-restore key (e.g. `localStorage["lc.restore.v1"]`)
  2. Emit `update_restart_clicked { current, next, ts_ms }`
  3. Emit `route_restored_after_update.staged` (pre-restart marker so we can pair on boot)
  4. Call `runtime_check_now` (which stages) then invoke a quit command that also unstages the OLD current.json pointer if native permits
  5. macOS quit + relaunch (until BUG-012 native fix ships · Cmd+R does not activate mid-session)
- Telemetry: `update_restart_clicked`

### State 6 · Restored on new runtime

- Trigger: app boots
- Action:
  1. Read `runtime_info` — capture `booted_version`
  2. Compare against `localStorage["lc.restore.v1"].staged_version`
  3. If equal: activation succeeded. Restore JWT + identity + last safe route + draft state. Clear restore key.
  4. If not equal: activation failed. Log · treat as State 7.
- Telemetry: `update_boot_verified { booted_version, staged_version, matches: true }` on success · `route_restored_after_update { last_safe_route, restored: true }` on route restore
- **Never claim update applied until booted version matches staged version.**

### State 7 · Update failed · safe retry

- Trigger: any step (2, 3, 5, 6) fails
- Visible: gentle "Update failed. Try again." indicator with "Retry" CTA
- Action: remain on known-good runtime · do NOT flip current.json pointer to the failed bundle
- Telemetry: `update_failed { current, next, stage: 'download'|'stage'|'boot', reason }`

## Critical vs non-critical classification

A runtime update is **critical** if the manifest declares any of:

- `criticality: "auth"` — auth flow change (OTP, JWT, session)
- `criticality: "money"` — money-path change (wallet, affiliate, payout, cancellation)
- `criticality: "data-integrity"` — schema or ledger integrity fix
- `criticality: "clipping"` — clip generation pipeline fix
- `criticality: "compatibility"` — backend API contract change requiring frontend update

Non-critical (`criticality: null` or `"cosmetic"|"perf"|"copy"`) means the update ready indicator is shown but navigation is not blocked.

## Protected journeys · never interrupt

The mandatory gate defers if the user is inside any of:

- `j005-upload` (upload in progress)
- `j006-clip-generation` (clip run pending)
- `j007-my-clips` — only if the user is exporting or copying a clip
- `j004-connect-whop` (mid-OAuth)
- `j011-payout` (mid-withdrawal)
- `j001-fresh-user-otp-identity` (mid-claim ceremony)

Gate deferral emits `update_gate_shown { deferred_by_protected_journey: <journey-id> }` so HQ can measure how often deferrals happen and for how long.

Once the protected journey completes, the gate mounts.

## HQ telemetry topics (all locked by INV-011 · transition proofs)

| Topic | Fired when | Payload | Persisted (B3) |
|---|---|---|---|
| `update_detected` | manifest reports newer version | `{ current, next }` | ✅ via `/lcos/events/ingest` |
| `update_download_started` | download begins | `{ current, next, size_bytes }` | ✅ |
| `update_staged` | download completes + bundle written | `{ current, next, staged_at_ts_ms }` | ✅ |
| `update_gate_shown` | mandatory gate mounts (or defers) | `{ current, next, criticality, deferred_by_protected_journey? }` | ✅ |
| `update_restart_clicked` | user clicks Restart now | `{ current, next, ts_ms }` | ✅ |
| `update_boot_verified` | app boots on new runtime | `{ booted_version, staged_version, matches }` | ✅ |
| `update_failed` | any step fails | `{ current, next, stage, reason }` | ✅ |
| `route_restored_after_update` | route + draft restored post-boot | `{ last_safe_route, restored }` | ✅ |

All eight topics ride the Train B3 dual-write path (`diagnosticLogger.flush()` posts to `/lcos/events/ingest`) so Doctor Full can prove the transitions.

## Entry / exit conditions

- **Entry:** app boot completes AND user hasJwt (checking runs even without JWT · gate only mounts when user is authenticated)
- **Exit (success):** State 6 · route restored · draft restored
- **Exit (drift):** State 7 · surfaced as "Update failed" · does not roll back known-good runtime

## Beta truth for BUG-012 (2026-07-12 disposition)

Until the native cache-switch fix (`runtime.rs:494 · call cache_active_root(&app) after staging`) is approved:

- Runtime updates DO stage in background
- Current session CANNOT activate the new runtime (native cache stays pinned to boot-time value)
- Quit + relaunch is required after every runtime update
- NO manual reinstall is required (the runtime bundle path is unchanged; only the process needs restarting)

The State 5 "Restarting" step therefore calls the Tauri quit command (which OS-level relaunches the app if we tag it that way, OR forces the user to double-click the app icon again — TBD in implementation).

**This journey's Codex-style state machine is compatible with BUG-012 unfixed.** Restart-gated activation is the honest truth. Users see the same behaviour whether BUG-012 is fixed or not; the difference is which mid-session actions are permitted to skip the gate.

## Acceptance test IDs

- `update.state-machine.test.ts::checking-to-downloading` (backend mocked · manifest 200)
- `update.state-machine.test.ts::downloading-to-staged` (bundle write mocked)
- `update.state-machine.test.ts::staged-to-gate-non-critical` (manifest criticality null)
- `update.state-machine.test.ts::staged-to-gate-critical-mounts-immediately`
- `update.state-machine.test.ts::gate-defers-during-protected-journey` (mocks j005 active)
- `update.state-machine.test.ts::gate-mounts-after-protected-journey-completes`
- `update.state-machine.test.ts::restart-persists-restore-state` (localStorage assertion)
- `update.state-machine.test.ts::boot-restores-jwt-identity-route-draft`
- `update.state-machine.test.ts::boot-mismatch-triggers-failed-state`
- `update.state-machine.test.ts::failed-preserves-known-good-runtime`
- Backend: `test_lcos_event_update_topics.py::all-8-topics-persist-idempotent`
- HQ view: `LcosEventsTab.test.tsx::filter-by-topic-update-*` (verify visible)

## Owning stations (P6 registry)

- `station.update.checking`
- `station.update.downloading`
- `station.update.staged`
- `station.update.gate-critical`
- `station.update.gate-non-critical`
- `station.update.restarting`
- `station.update.restored`
- `station.update.failed`

## Related decisions + invariants

- DECISION-0003 · shell freeze (not lifted for this journey · Codex-model works without Rust changes)
- DECISION-0009 · wave lifecycle
- DECISION-0010 · 8 auto-answers per bug
- INV-006 · one canonical writer for `state.runtime-version` (owner: `hook.useRuntimeVersion` per Train B1)
- INV-011 · every transition produces telemetry + regression test + journey step + owning station
