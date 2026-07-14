# Post-RC1 Execution Plan · Liquid Clips

**Base**: tag `rc1-dev-handover-2.2.36` · GitHub SHA `e1794812` · local certification `e446ddb7`
**Working branch**: `codex/post-rc1-launch`
**Owner**: Codex (autonomous) · humans handle exceptions
**Date opened**: 2026-07-13

This is the ordered backlog for post-RC1 work. Every landed change ships as a small reviewable commit on `codex/post-rc1-launch` and PRs upstream. `POST_RC1_PROGRESS.md` tracks completion.

---

## Governance summary

| Item | Value |
|------|-------|
| RC1 baseline | frozen · never edit `rc1-dev-handover` or move the tag |
| Codex branch | `codex/post-rc1-launch` |
| Human branches | `dev/<name>/<slug>` — no collisions on Codex-owned paths |
| Merging | small PRs into `main` after gate green; no force pushes |
| Contract drift check | before every rebase/merge into codex branch |
| Escalation triggers | product intent · pricing · payments · security · shell · locked capabilities |

---

## Immediate execution order

### 1. P3 · Live installed-app journey proof

**Objective** · prove the currently-installed Tauri app end-to-end: drop a real video → generate clips → open one → edit → export → verify output on disk.
**Current state** · pending (`tasks/#81`).
**Owning route/components** · shell (frozen) · design-os cockpit routes · `ClipRail` · `ExportModule` · Python sidecar chain.
**User impact** · this is the atomic customer promise. If it doesn't work end-to-end on Daniel's Mac, launch is blocked.
**Dependencies** · installed Liquid Clips app v2.2.36 · a real source video file · disk headroom for outputs.
**Acceptance** · exact source path + generated clip file paths + exported MP4 that plays · screenshots at each stage · duration measurements · Python sidecar log excerpts · zero manual synthesis of "success" state.
**Targeted tests** · `tests/native-walk-prep/j005-upload.spec.ts`, `j006-clip-generation.spec.ts` (all `NATIVE` skipped — driven manually here) · reuse `assert-shell-contracts.sh`.
**Release gates** · none new · this is proof, not code change.
**Risk** · low (read-only observation).
**Ownership** · Codex prepares evidence; human drives native UI if needed.
**Status** · pending.

### 2. P4 · Ship-ready regression report

**Objective** · single-page post-RC1 launch-readiness report covering the 14 customer journeys. Separates foundation-green · customer-launch-ready · mocked · roadmap · true blockers.
**Current state** · pending (`tasks/#82`).
**Owning route/components** · reads `FEATURE_INVENTORY.md`, `KNOWN_ISSUES_AND_DEBT.md`, D1 skip catalog.
**User impact** · this doc is the go/no-go artifact for launch.
**Dependencies** · P3 evidence (cross-reference against actual observed behaviour).
**Acceptance** · every one of the 14 journeys has an honest status + evidence path or stated gap; no rosy phrasing; disagreements between doc + observed behaviour flagged.
**Targeted tests** · none · pure documentation.
**Release gates** · none · document.
**Risk** · low.
**Ownership** · Codex.
**Status** · pending.

### 3. Cancellation + account-state sweep (six states)

**Objective** · walk a real non-admin persona through the six subscription states and prove UI, access gates, messaging, upgrade path, entitlement truth.
**Current state** · pending (`tasks/#110`).
**Six states** · active · trial · cancelled but still entitled (grace) · expired · payment failed · no subscription.
**Owning route/components** · `src/routes/wallet-detail/**`, `src/routes/account/**`, `src/lib/billing/adapter.ts`, `src/design-os/state/useTierCaps.ts`, `useUpgradeCta`.
**User impact** · money-surface truth. Getting any of these wrong = customer confusion, refund risk, silent churn.
**Dependencies** · real non-admin persona in staging Clerk + Whop or reliable mock harness in `_auth-harness.ts`.
**Acceptance** · one Playwright spec per state · assertions on entitlement truth + upgrade CTA + toast/dialog copy · screenshots per state · exit-criteria per state matches `FEATURE_INVENTORY.md`.
**Targeted tests** · new `tests/e2e/cancellation-six-states.spec.ts`.
**Release gates** · D1 + targeted regression on new spec.
**Risk** · medium (money surface).
**Ownership** · Codex proposes; Daniel greenlights money-surface copy or entitlement changes.
**Status** · pending.

### 4. Crew flow Path A proof

**Objective** · prove crew marker persistence (no false-repeat, correct progression, recovery after restart/reload, no duplicate reward or state transition).
**Current state** · pending (`tasks/#111`).
**Owning route/components** · `src/lib/crew*.ts`, `src/design-os/routes/crew*`, `useCrew*` hooks, backend `crew_invites` table.
**User impact** · false-repeat = duplicate reward payout = money loss.
**Dependencies** · seed data via `/webhooks/clerk` or crew invite RPC.
**Acceptance** · deterministic Playwright spec that seeds crew state, walks Path A, restarts, walks it again, asserts one-time-only transition + persistence.
**Targeted tests** · new `tests/e2e/crew-path-a-persistence.spec.ts`.
**Release gates** · D1 + targeted regression.
**Risk** · medium (reward mechanics).
**Ownership** · Codex proposes; Daniel greenlights reward math.
**Status** · pending.

### 5. Remaining feature completion queue

Ranked by user-blocking impact. Sourced from `FEATURE_INVENTORY.md` + `KNOWN_ISSUES_AND_DEBT.md`.

**Queue** (draft — Codex refines each cycle):
1. **Customer-blocking broken flows** — anything a first-time user hits that fails silently. Grep target: `feedback_forbidden_fake_done` patterns.
2. **Real integrations still mocked** — Whop bounty submission real API (currently mocked), Anthropic judgment cost accounting, real Clerk OTP for non-preview accounts.
3. **Onboarding friction** — WelcomeGate copy · first-run mode picker · Clipper vs Agency selection persistence.
4. **Performance + reliability** — BUG-001 + BUG-010 (campaign nav) Phase 2 optimization; sidecar cold-start warmup; runtime-update beacon jitter.
5. **Support/HQ diagnostics** — canonical event schema + retry buffer (see § HQ integration below).
6. **Polish** — TopHud identity states beyond signed-in/out; empty-state honesty audits; brand kit consistency (IG-012 drift check).
7. **Roadmap features** — deferred until foundation queue is empty.

**Do not** begin self-extending capabilities yet.

---

## HQ + Codex integration foundation

**Objective** · start the safe HQ wire without making HQ critical to clipping.

**First deliverables** (ordered):

1. **Canonical event schema** — Zod-typed at `desktop-2/src/lib/hqEvents.ts`. Version field. Every event carries `correlation_id`, `session_id`, `runtime_version`, `install_id`.
2. **Correlation IDs** — thread correlation through `useAuditableAction`, `diagnosticLogger`, and every `fetch` that touches backend.
3. **App-health events** — periodic heartbeat with local resource metrics (disk free, memory pressure, sidecar status).
4. **Failed-action events** — every `try/catch` in critical paths emits a typed event.
5. **Processing-failure events** — ingest / transcribe / judgment / cut failure emit typed events with sanitized error message.
6. **Support-request events** — user-initiated (Support button hits this).
7. **Update-health events** — beacon success/failure with version diff.
8. **Diagnostic-bundle generator** — user-triggered `Generate diagnostic bundle` action zips redacted logs + state to `~/Documents/Liquid Clips/diagnostic-<ts>.zip` for support forwarding.
9. **Retry + offline buffer** — events queue to IndexedDB when transport fails; flushed on reconnect. Bounded (max 1000 events · max 5MB).
10. **HQ queue contract** — backend accepts POST `/lcos/events/ingest` with the versioned schema and returns `{accepted: n, rejected: m, reasons: [...]}`.

**Golden rule** · desktop app MUST continue functioning if HQ is unavailable. All transport is fire-and-forget with keepalive. E2E gate (`__LCOS_E2E__`) already disables transport in tests.

**Privacy** · NEVER send private video content, captions, or user files to HQ unless explicitly required + approved. Redact user identifiers to `install_id + hashed handle` for behaviour events.

---

## Engineering rules (per Daniel · 2026-07-13)

For every issue:

1. reproduce
2. classify owning layer (PRODUCT/STALE-TEST/HARNESS/ENV/EXTERNAL)
3. identify root cause
4. make the smallest correct fix
5. add deterministic regression proof
6. run targeted gates
7. run broader gates per risk
8. create reviewable PR
9. include rollback instructions

**Never obtain green by**:
- hiding features
- weakening canonical assertions
- broadly suppressing errors
- adding arbitrary retries
- excluding reachable controls
- changing product intent to fit a test

---

## Locked boundaries (never change without Daniel)

- Tauri/Rust/shell
- signing or notarisation
- pricing
- payments
- user balances
- authentication architecture
- security rules
- permanent data deletion
- locked canonical features

**No shell rebuilds.** Runtime/frontend only by default.

---

## Cadence

- Codex reviews queue every session start.
- One work item at a time; small commits; PR when green.
- `POST_RC1_PROGRESS.md` updated on every completion.
- Daniel reads `POST_RC1_PROGRESS.md` for the state of the world.
