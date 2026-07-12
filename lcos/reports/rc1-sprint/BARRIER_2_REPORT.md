# RC1 Sprint · Barrier 2 · Post-Train-B

**Barrier commit sequence:** B1 merge → B2 merge (with conflict resolution) → B3 merge
**Post-barrier HEAD:** `7f2c47cf` on `integration/cold-entry-mode-b`
**Time:** 2026-07-12

---

## Trains merged

| Train | Branch | SHA | Bugs → FIXED_UNPROVEN | Notes |
|---|---|---|---|---|
| B1 | `wave-b1/runtime-truth` | `584223ad` | BUG-006 · BUG-007 · BUG-009 | **BUG-012 · STOP · native Rust required** |
| B2 | `wave-b2/nav-telemetry-perf` | `a9b89335` | BUG-001 · BUG-010 | Boot topic + j011 journey file |
| B3 | `wave-b3/hq-persistence` | `eb6a6436` | (infra · no direct flip) | Unblocks Doctor Full transition proofs |

## Merge conflict at B2 (resolved)

4 conflict blocks in `lcos/graph/bugs.json`:

1. **Totals** — B1 said `{open: 4, fixed_unproven: 13}`, B2 said `{open: 5, fixed_unproven: 12}`. Arithmetic truth: 7 base − 3 (B1 flips) − 2 (B2 flips) = 2 open · 15 fixed_unproven. Resolved to `{open: 2, in_progress: 0, fixed_unproven: 15, closed: 0}`.
2. **BUG-001 chain_links** — B2 added richer schema (`runtime_seen` + test `path`). Took B2's version.
3. **BUG-010 status + notes** — B2 flipped to FIXED_UNPROVEN with a detailed verification-gap disposition. Took B2's version.
4. **BUG-010 tests** — B2 replaced `to-be-authored` with actual `SideNav.learn-visibility.test.ts` passing entry. Took B2's version.

`lcos/09_BUG_LEDGER.md` auto-merged clean (adjacent-hunk resolution).

## Post-merge gate results

| Gate | Result |
|---|---|
| tsc --noEmit | clean |
| vitest | **429/429** (48 files) |
| pytest | **411/411** |
| ship-lens | deferred to Barrier 3 |
| HQ persistence live-test | pytest covers 16 assertions (idempotency, admin-gate, aggregation, DDL idempotency, session filter, pagination, size limits, UNIQUE constraint) · curl proof deferred until backend restarted |
| Perf waterfall | deferred to Train C setup |

## Ledger state

```
totals: { open: 2, in_progress: 0, fixed_unproven: 15, closed: 0 }

FIXED_UNPROVEN (15):
  Wave 1  · BUG-002 · 003 · 011 · 013
  Train A2 · BUG-004 · 008 · 014
  Train A1 · BUG-015 · 016
  Train A3 · BUG-017
  Train B1 · BUG-006 · 007 · 009
  Train B2 · BUG-001 · 010

OPEN (2):
  BUG-005 · Notifications badge drift (product decision owed)
  BUG-012 · Runtime hot-swap requires quit+relaunch (SHELL-FREEZE STOP)
```

## Class-elimination progress cumulative

| Class | Instances known | Instances eliminated | Status |
|---|---|---|---|
| BC-001 · Multi-writer state | 3 visible | 2 (state.handle · auth self-heal) | in-progress |
| BC-002 · Multi-source-of-truth | 5+ visible | 8 (identity kind · Whop chip · tier ×3 · runtime version + `__APP_VERSION__` 5-site sweep) | in-progress |
| BC-003 · Dev shortcut in prod path | 1 visible | 1 | closed-known-instance |
| BC-004 · Journey no owner | 15 canonical | 2 (j010-referral + j011-campaigns-nav) | in-progress |
| BC-005 · UI reading divergent stores | 2 visible | 1 · plus HQ persistence infra enables real detection of future instances | in-progress |

## BC-006 (proposed) · Shared-worktree state bleed under parallel isolation:worktree agents

Multiple Train A and Train B agents reported that the main-repo checkout oscillated between wave branches during their sessions. B2 and B3 each had to correct branch state; B1 flagged it explicitly. Effect: the shared working tree in `/Users/dipdip/code/jnr` reflects a non-integration branch after each parallel dispatch, which the integration lead has been resetting at each barrier.

**Not a customer bug.** Meta-tooling issue with `isolation:worktree` semantics under the current runtime. Proposed BC-006: "shared-worktree state bleed." Fix path is likely runtime-side rather than product-code. Documented for follow-up · not filed as a BUG-XXX because it's not in the LCOS scope.

## BUG-012 · STOP for integration lead escalation

**Symptom:** Runtime bundle hot-swap requires quit+relaunch; Cmd+R does not stick.

**Root cause (per B1 investigation):** `runtime_check_now` in `desktop-2/src-tauri/src/runtime.rs:494` does not call `cache_active_root` after staging a new bundle. `ACTIVE_RUNTIME_ROOT` therefore stays stale mid-session. Cmd+R re-hits the URI resolver which reads the stale cache.

**Fix proposed:** single-line addition in `runtime.rs:494` — call `cache_active_root(&new_root)` after staging.

**Runtime-only workaround exists?** No. B1 verified. The cached root is a native-side static; every runtime-only patch (JavaScript, TypeScript, Vite bundle contents) is downstream of the resolver read. Fix must happen in Rust.

**Impact of leaving OPEN through RC1 beta:**
- Beta users who receive a runtime bundle hot-swap must quit + relaunch to see the new bundle
- Documentable in beta release notes
- Not a security or auth concern
- Not a money-path concern
- Does affect "normal update works" beta gate item

**Options for you:**

1. **Lift DECISION-0003 for this one-line change.** Integration lead applies the fix, adds regression test, commits, ships. Beta gate item stays green.
2. **Leave BUG-012 OPEN for RC1.** Beta ships with the quit-and-relaunch limitation documented. Fix in a future shell revision cycle.
3. **Defer to Barrier 3 decision.** Complete Train C first, then decide with the full picture.

## Train C dispatch · held pending your call

Ready to write and dispatch Train C ownership matrix (C1 native-walk prep · C2 money journey · C3 clipping journey) as soon as you (a) resolve BUG-012 and (b) greenlight Train C.

## Deliverables (this barrier)

- 3 merge commits (B1, B2 via conflict-resolution commit, B3)
- Conflict resolution: 4 blocks in bugs.json fixed programmatically · JSON validated
- Full test sweep green
- This report
- STOP_REPORT for BUG-012 at `lcos/reports/rc1-sprint/STOP_REPORT_WAVE_B1_BUG_012.md`

No push · no tag · no deploy · no shell touches. Bugs remain FIXED_UNPROVEN.
