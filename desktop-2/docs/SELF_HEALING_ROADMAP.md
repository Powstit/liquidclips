# Self-Healing Roadmap · Liquid Clips Desktop

> **This is a roadmap, not current production.** The v1 primitive (Watchdog +
> KadeRepairScreen + nodeRegistry + interceptionBus) landed on
> `desktop-2` 2026-07-06. The backend + HQ dashboard that consumes it are
> **scoped, not shipped**. Do not describe self-healing as a live feature.

`Dropbox: /Liquid Clips/RC1 Handover/self-healing/`

---

## Vision

Each installed Liquid Clips app becomes a **bounded self-healing clipping
workstation**. When something local goes wrong (disk full, sidecar crash,
corrupted local DB, denied permission, outdated bundle) the app diagnoses
the failure, attempts a safe app-level repair, and — win or lose — reports
the attempt to HQ so we see patterns across the install base.

The rule that keeps this safe: **repair only inside the app's own boundary.
Never touch the user's files. Never silently retry a paid operation. Never
hide errors from HQ.**

---

## What "self-healing" specifically means for a clipping desktop app

| Symptom | Safe self-heal |
|---|---|
| Disk full during export | Detect at write time · surface `KadeRepairScreen` · prompt cleanup of `~/Library/Application Support/app.liquidclips.desktop/tmp/*` |
| Python sidecar crashed / not responding | Auto-restart via the Rust supervisor (currently manual in `desktop/python-sidecar`) — planned |
| Corrupted local DB (`junior-backend.db` or `localStorage["lc.*"]`) | Offer one-click reset behind a "will lose local drafts" confirm |
| Permissions denied (Screen Recording · Files · Microphone) | Detect on first-use failure · guide the user through System Settings with a link + brand copy |
| Runtime bundle stale (BUG-006 / BUG-007 / BUG-009 / BUG-012) | Codex-style restart-gated update journey (7-state machine landed in Train D1) |
| Component crash (React error boundary) | Node-scoped `Watchdog` renders `KadeRepairScreen` for just that Node · shell keeps working |
| Silent-swallow (like Slice-3 `startAssistedHandoff` toasting fake success) | Blocked by `watchdogWrap` HOF — every catch dispatches an intercession event |

---

## What's ALREADY in place

The primitives below already ship and pass gates. They are the foundation
the roadmap phases below build on.

### v0 · Error boundaries (shipped)

- `desktop-2/src/design-os/components/EngineErrorBoundary.tsx` — per-brick
  crash isolation with structured `EngineBoundaryMeta`. Wraps every
  user-reachable route. Referenced in `desktop-2/CLAUDE.md:95`.
- `desktop-2/src/components/SectionWithFallback.tsx` — Section-pipeline
  wrapper that catches a crash inside a section and mounts a
  `FallbackComponent` instead. **Scoped to Wallet only** per
  `desktop-2/CLAUDE.md:54-71`. The `EarnRoute` (Design OS) is the
  older fallback for the `WalletDetail` (Section pipeline). See
  `src/sections/account/AccountSection.tsx:33-40, 154-156`.
- The `SectionWithFallback` primitive emits `section_fallback_triggered`
  exactly once per trip via `lcDiag` — no `*_rendered` telemetry, matches
  the `desktop-2/CLAUDE.md:96-97` behavioural rule.

### v1 · Sovereign Operator Watchdog (shipped 2026-07-06)

Files under `desktop-2/src/lib/watchdog/`:

| File | Purpose |
|---|---|
| `types.ts` | `NodeId` · `NodeHealth` · `FailureRecord` · `AdminOverride` · `NodeState` shapes and thresholds |
| `nodeRegistry.ts` | In-memory `Map` + localStorage persistence · `registerNode` / `recordFailure` / `setOverride` / `subscribe` |
| `interceptionBus.ts` | `dispatchIntercession(record)` — local bus event + best-effort `POST /hq/nodes/intercession` |
| `Watchdog.tsx` | React error boundary + `watchdogWrap()` async HOF + `useNodeState()` hook |
| `KadeRepairScreen.tsx` + `.css` | Fallback UI · Kade error avatar + 5:00 countdown + fuchsia pulse ring · respects `prefers-reduced-motion` |
| `nodeRegistry` health thresholds | green (0–2 failures) · yellow (3–9) · red (≥10 → trips Intercession LLM) |

Architecture reference: `desktop-2/docs/PROTOCOL_SELF_HEALING_NODES.md`.

### v1 · Codex-style Runtime Update Journey (shipped Train D1, 2026-07-13)

Files:

- `desktop-2/src/lib/update/updateJourney.ts` — 7-state machine
  (Checking → Downloading silently → Update ready → Restart required →
  Restarting → Restored on new runtime → Update failed with safe retry)
- `desktop-2/src/lib/update/protectedJourney.ts` — never interrupts upload,
  clip-run, export, submit, payout, identity claim
- `desktop-2/src/lib/update/bootRestore.ts` — one-click restart persists JWT
  + identity + last safe route + draft state via `localStorage["lc.restore.v1"]`
- 8 HQ telemetry topics wired through `src/lib/diagnosticLogger.ts`

This is the runtime-only mitigation for `BUG-012` (native `runtime.rs`
cache stays stale mid-session — see `lcos/09_BUG_LEDGER.md:886-1005`).
BUG-012's root cause is native (`src-tauri/src/runtime.rs::serve_runtime_uri`
reads a cached `ACTIVE_RUNTIME_ROOT` that `runtime_check_now` doesn't
refresh). Because the shell is FROZEN, D1 mitigated the customer-visible
symptom by making the restart honest and rich in observability.

---

## Roadmap phases

### Phase 1 · Instrumentation (v1.5 · next 4–6 weeks)

Goal: every user-reachable Node registered, every failure visible.

- Wire every one of the 80 customer journeys catalogued in
  `account-app/src/components/admin/JourneyMapTab.tsx` to a `<Watchdog>`
  with a stable `nodeId` (e.g. `money/mo-01/assisted-handoff`).
- Convert every remaining silent-swallow catch to `watchdogWrap`.
- Ship the backend endpoints scoped in
  `desktop-2/docs/PROTOCOL_SELF_HEALING_NODES.md`:
  - `POST /hq/nodes/intercession`
  - `GET  /hq/nodes/state`
  - `POST /hq/nodes/{id}/override`
- Ship `NodeHealthTab` inside `account-app/src/components/admin/` — live
  health grid, per-Node line-of-code pinpoint, one-click "Pause Node",
  per-Node API-key injection form, Intercession LLM trigger button.

**Exit criterion:** HQ can render live green / yellow / red per cluster for
every one of the 80 journeys, with zero polling from the desktop side.

### Phase 2 · Safe auto-repair (v2 · post-Cohort 0)

Goal: repair happens without asking the user, but only for repairs on the
allow-list below.

| Repair | Trigger | Action |
|---|---|---|
| Sidecar restart | Sidecar health-probe fails 2× in 60s | Rust supervisor restarts sidecar · emit HQ event |
| tmp cleanup | Disk-full write error inside `~/Library/Application Support/app.liquidclips.desktop/tmp` | Delete files older than 24h · retry the failed write |
| Runtime auto-reload | `updateJourney` reaches `Restored on new runtime` state on boot | Silent · matches shipped D1 behaviour |
| Corrupted `localStorage["lc.*"]` key | JSON parse fails on hydration | Delete just that key · reload the affected Node · emit event |
| Missing brand asset | `<img onError>` for `public/brand/*` | Fall back to text label · emit event |

**Bounded by:** the allow-list. Any repair not on it stays a Phase-1 event
(logged) and never becomes a Phase-2 auto-fix without explicit review.

### Phase 3 · Proactive prevention (v3 · TBD)

Goal: stop the user hitting the failure at all.

- Boot-time disk-space check → warn at <2 GB free, block export at <500 MB.
- Boot-time permissions check → surface System Settings deep-link if
  Screen Recording / Files / Microphone is not granted.
- Boot-time runtime hash check → verify the loaded bundle matches
  `current.json` before showing UI. If mismatch, force restart via
  the `updateJourney` state machine.
- Pattern learning from HQ intercession stream — if the same Node reaches
  red for >5% of the install base, Codex proposes a Phase-2 auto-repair
  entry with regression test.

---

## Bounded scope — what self-healing MUST NEVER do

Every one of these is a **hard boundary**. Repair code that violates any
of them fails ship-lens.

1. **Never mutate user files.** All repairs stay inside
   `~/Library/Application Support/app.liquidclips.desktop/*`. The user's
   video sources, exports, and drafts are read-only from the repair layer.
2. **Never silently retry a paid operation.** Anything that could cost
   money (transcription API call, Whop submission, publish attempt) is
   protected. On failure the user sees the error and clicks Retry.
3. **Never hide errors from HQ.** Every repair attempt — success or
   failure — dispatches through `interceptionBus`. No `try { … } catch {}`
   that swallows silently.
4. **Never repair identity, auth, or money surfaces automatically.** Wallet,
   Cold-entry, Outreach, Cancellation, Catalog stay under manual retry.
   Reason: the money-surface rule (`desktop-2/CLAUDE.md:10-35`).
5. **Never repair across users.** All repairs are scoped to the current
   user's local storage.
6. **Never touch iron-gate sentinels or shell code.** Any repair that would
   need to modify `src-tauri/**`, `Cargo.toml`, `tauri.conf.json`, or
   `package.json` is not a repair — it is a shell release and follows
   `desktop-2/RELEASING.md`.

---

## Escalation to HQ

Every self-heal attempt logs to HQ so we see patterns. This is what
converts individual repairs into a system that gets smarter.

- **Transport:** `dispatchIntercession()` in
  `desktop-2/src/lib/watchdog/interceptionBus.ts` — local bus event +
  best-effort `POST /hq/nodes/intercession`.
- **Payload:** `FailureRecord` from
  `desktop-2/src/lib/watchdog/types.ts` — sanitized error message (bearer
  tokens, JWTs, emails, long hex/base64 blobs scrubbed by
  `sanitizeError`), `nodeId`, timestamp, retry count, whether an
  auto-repair fired.
- **Consumer (planned):** `NodeHealthTab` in `account-app/src/components/admin/`
  — see Phase 1.
- **Failure of HQ is not user-visible.** HQ is not on the critical clip /
  render / export path. If the intercession POST fails, the local repair
  still happens; the event just doesn't reach the dashboard.

---

## References

- `desktop-2/CLAUDE.md:54-71` — Fallback resilience scoped to Wallet only
- `desktop-2/CLAUDE.md:95-104` — Watchdog + EngineErrorBoundary wrap every user-reachable route · perf contract · behavioural telemetry rules
- `desktop-2/docs/PROTOCOL_SELF_HEALING_NODES.md` — Sovereign Operator architecture v1
- `desktop-2/src/lib/watchdog/*` — the shipped primitive
- `desktop-2/src/components/SectionWithFallback.tsx` — Wallet-only Section fallback
- `desktop-2/src/design-os/components/EngineErrorBoundary.tsx` — per-brick boundary
- `lcos/09_BUG_LEDGER.md:886-1005` — BUG-012 native runtime-cache issue that runtime-only D1 mitigated
- `[Self-healing walkthrough video](dropbox:///Liquid%20Clips/RC1%20Handover/self-healing/walkthrough.mp4)` — `TODO: Daniel · generate Dropbox share link for self-healing walkthrough`

## Verification checklist

Files inspected while writing this doc:

- [x] `/Users/dipdip/code/jnr/desktop-2/CLAUDE.md`
- [x] `/Users/dipdip/code/jnr/CLAUDE.md`
- [x] `/Users/dipdip/code/jnr/DEPLOYMENT.md`
- [x] `/Users/dipdip/code/jnr/desktop-2/docs/PROTOCOL_SELF_HEALING_NODES.md`
- [x] `/Users/dipdip/code/jnr/desktop-2/src/lib/watchdog/Watchdog.tsx`
- [x] `/Users/dipdip/code/jnr/desktop-2/src/lib/watchdog/` (directory listing)
- [x] `/Users/dipdip/code/jnr/desktop-2/src/components/SectionWithFallback.tsx`
- [x] `/Users/dipdip/code/jnr/desktop-2/src/sections/account/AccountSection.tsx`
- [x] `/Users/dipdip/code/jnr/lcos/09_BUG_LEDGER.md` (BUG-012 native root cause)
