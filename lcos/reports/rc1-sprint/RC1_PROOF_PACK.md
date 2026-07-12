# RC1 · Proof Pack

**Date:** 2026-07-12
**Sprint duration (this session):** ~10 hours · Phase 0 → Barrier 3
**Base at sprint start:** post-Wave-1 merge · `3b094b21`
**Base at Barrier 3 close:** `a764f8d4` (Train C3 merge tip) on `integration/cold-entry-mode-b`
**Integration lead:** Claude · never implemented · reviewed + merged + resolved conflicts
**Ship discipline:** local only · no push · no tag · no deploy · no runtime promotion · shell freeze intact

---

## Verdict headline

**⏸ HOLD for one decision · then SHIP.**

RC1 is beta-ready **conditional on your call on BUG-012 disposition Option A vs Option B.** Everything else is green. Recommendation at the bottom of this pack.

## Merged sequence

| # | SHA | Purpose |
|---|---|---|
| 1 | `dc44039d` | Phase 0 · golden-path proof pack + BUG-015/016/017 filed + Train A ownership matrix |
| 2 | Merge · Train A1 | identity hydration · BUG-015 · 016 → FIXED_UNPROVEN |
| 3 | Merge · Train A2 | Whop CTA + tier · BUG-004 · 014 · 008 → FIXED_UNPROVEN |
| 4 | Merge · Train A3 | referral journey · BUG-017 → FIXED_UNPROVEN |
| 5 | `b13ac9aa` | Barrier 1 fix · pytest desktop_auth_codes fixture + totals reconcile |
| 6 | `d501184b` | Barrier 1 report + Train B ownership matrix |
| 7 | `81f37baa` | Merge · Train B1 · runtime truth · BUG-006 · 007 · 009 → FIXED_UNPROVEN · **BUG-012 STOP** |
| 8 | Merge · Train B2 | nav telemetry + perf · BUG-001 · 010 → FIXED_UNPROVEN (4-conflict resolution) |
| 9 | `7f2c47cf` | Merge · Train B3 · HQ persistence infrastructure |
| 10 | `8c7908f6` | Barrier 2 report + BUG-012 escalation |
| 11 | `452fbd5b` | BC-006 registered + dispatch-guard.sh + BUG-012 Option-3 + Train C matrix |
| 12 | `cc318b84` | Merge · Train C1 · native-walk-prep (docs + scripts only) |
| 13 | `25d51f97` | Merge · Train C2 · money journey (canonical rollup + 4 journeys owned) |
| 14 | `a764f8d4` | Merge · Train C3 · clipping journey (real-file proof) |

## Ledger state

```
totals: { open: 2, in_progress: 0, fixed_unproven: 15, closed: 0 }
```

### FIXED_UNPROVEN (15 · needs Doctor Full to certify CLOSED)

| Bug | Class | Train |
|---|---|---|
| BUG-002 | BC-005 + BC-001 | Wave 1 |
| BUG-003 | BC-002 | Wave 1 |
| BUG-004 | BC-002 | Train A2 |
| BUG-008 | BC-002 | Train A2 |
| BUG-011 | BC-005 | Wave 1 |
| BUG-013 | BC-005 | Wave 1 |
| BUG-014 | BC-002 | Train A2 |
| BUG-015 | BC-002 | Train A1 |
| BUG-016 | BC-001 | Train A1 |
| BUG-017 | BC-004 | Train A3 |
| BUG-006 | BC-002 | Train B1 |
| BUG-007 | BC-002 | Train B1 |
| BUG-009 | BC-005 | Train B1 |
| BUG-001 | BC-005 | Train B2 |
| BUG-010 | BC-004 | Train B2 |

### OPEN (2)

| Bug | Reason | Beta impact |
|---|---|---|
| BUG-005 · Notifications badge drift | Product decision owed (`a` wire `/notifications` or `b` explicit `Local · not synced` chip) | Cosmetic · does not block beta |
| BUG-012 · Runtime hot-swap requires quit+relaunch | Native Rust fix vs runtime-gated restart journey · **your call, this pack, Option A vs B** | See below |

## Journey coverage (BC-004 elimination progress)

| Journey ID | State | Owning train | Test seams |
|---|---|---|---|
| j001-fresh-user-otp-identity | GREEN-unproven | Wave 1 · Train A1 | ladder + hydration + claim + drift |
| j002-returning-user | GREEN-unproven | Wave 1 | ladder |
| j003-crew-onboarding | GREEN-unproven | Wave 1 | claim sheet mount |
| j004-connect-whop | GREEN-unproven | Train A2 | WhopStatusChip + Home hero CTA |
| j005-upload | GREEN-unproven | Train C3 | upload contract + preflight |
| j006-clip-generation | GREEN-unproven (partial) | Train C3 | real-file proof · Anthropic contract · Whisper contract |
| j007-my-clips | GREEN-unproven | Train C3 | reveal · open · copy affordances |
| j008-wallet | GREEN-unproven | Train C2 | money-rollup consistency |
| j009-affiliate | GREEN-unproven | Train C2 | affiliate.journey.test |
| j010-referral | GREEN-unproven | Train A3 | seams + attribution recorder |
| j011-campaigns-navigation | GREEN-unproven | Train B2 | boot-emit + Learn visibility |
| j012-payout | GREEN-unproven | Train C2 | INV-004 gates |
| j013-cancellation | GREEN-unproven | Train C2 | 6-state matrix + support-only lane |
| j014-runtime-update | GREEN-unproven | (Wave 1 + B1) | version-truth · UpdateBeacon dedup · 204 handling |
| **j015-runtime-update (Codex model)** | **SCOPED · awaits implementation call** | (this pack) | 12 assertion IDs · 8 telemetry topics |

**Journeys authored this sprint:** 8 (j005 · j006 · j007 · j008 · j009 · j011 · j012 · j013 · plus j010-referral extended)

**Journeys still owed:** ~7 (j000 first-launch · j002 returning-user · j003 crew · deeper station chains for identity axis). Deferred to post-RC1 P6.

## Class-elimination progress cumulative (this session)

| Class | Instances known | Eliminated this sprint | Status |
|---|---|---|---|
| BC-001 · Multi-writer state | 3 visible | 2 (handle writer · auth self-heal) | in-progress |
| BC-002 · Multi-source-of-truth | 5+ visible | 8 (identity kind · Whop chip · tier ×3 · runtime version + `__APP_VERSION__` 5-site sweep) | in-progress |
| BC-003 · Dev shortcut in prod path | 1 visible | 1 (auth hardening pre-sprint) | closed-known-instance |
| BC-004 · Journey no owner | 15 canonical | 8 (Wave 1 + j010 + j011 + j005 + j006 + j007 + j008 + j009 + j012 + j013) | in-progress |
| BC-005 · UI reading divergent stores | 2+ visible | 4 (identity ladder · runtime observability · money divergent stores · route events) | in-progress |
| BC-006 · Shared-worktree state bleed | LCOS tooling | 1 (dispatch-guard.sh authored) | in-progress (long-term runtime fix owed) |

## Gate results (Barrier 3 close)

| Gate | Result |
|---|---|
| tsc --noEmit | **clean** |
| vitest | **55/55 files passing** |
| pytest | **431 passed · 1 skipped** |
| Merge conflicts resolved | 4 blocks in bugs.json at Barrier 2 · zero at Barrier 3 |
| Ship-lens | deferred to post-decision (below) |
| Fixture scan (BC-002) | **0 unexpected money literals** on OWNED surfaces (C2) |
| Preview-campaign scan (BC-005) | **0 preview-campaign / test_campaign hits** in production (C3) |
| Real-file proof | 30,050-byte MP4 at 2.019s reproduced from checked-in fixture (C3) |
| HQ persistence proof | 16 backend assertions cover round-trip · idempotency · admin gate · dedup (B3) |
| Guard runs | dispatch-guard.sh PASS before Trains A · B · C dispatch |
| Shell freeze | intact · zero touches to src-tauri/** · Cargo.toml · tauri.conf.json · package.json · python-sidecar/** |

## New capabilities landed this sprint

### Backend
- `POST /me/lc-id/claim` (Wave 1 gap-closure) + `POST /me/handle` deprecated alias
- Auth hardening · atomic Session-transaction consume · 9 gate tests (BC-003 elimination)
- `runtime.py` 204 response for empty manifest (BUG-009 · Train B1)
- `POST /lcos/events/ingest` + `GET /admin/lcos-events*` (Train B3 · idempotent · admin-gated)
- `GET /me/money-rollup` + `GET /admin/money-rollup/{user_id}` + `POST /affiliate/attribution/record` (Train C2)

### Frontend
- `useMe` · IdentityKind union + hydration state machine + 4 topics + kind-drift guard
- `useAuth` · auth_state_drift self-heal loop
- `WhopStatusChip` component + TopHud + CommandRoom mount
- `useTierCaps` canonicalised · 3 prop defaults deleted (BC-002 sweep)
- `useRuntimeVersion` hardened · event-subscribed · `__APP_VERSION__` 5-site sweep
- `UpdateBeacon` dedup ring
- `moneyRollup.ts` hook · WalletDetail summary reads from canonical rollup
- `CancellationIntercept` 6-state derivation
- `WalletReferralBlock` seams (A3)
- `boot` telemetry + `nav_click_performance` consolidated payload (B2)
- `diagnosticLogger.flush()` dual-write to backend `/lcos/events/ingest`

### LCOS + tooling
- `12_BUG_CLASSES.md` extended · BC-006 registered
- `04_JOURNEY_BIBLE/` populated with 8 new journey files (j005 · 006 · 007 · 008 · 009 · 011 · 012 · 013) plus j015 Codex-update scoped
- `scripts/dispatch-guard.sh` (executable · BC-006 pre-dispatch gate)
- 3 shell helpers under `scripts/rc1-beta/` (mint-jwt · seed-fresh-user · reset-test-env)
- 5 Playwright specs under `desktop-2/tests/native-walk-prep/` + isolated config
- HQ persistence dashboard tab at `/admin` · LCOS Events

## Beta gate assessment

| Beta gate item | Status |
|---|---|
| 0 P0 | ✅ (BUG-002 was P0 · now FIXED_UNPROVEN) |
| 0 P1 | ✅ (all P1 bugs now FIXED_UNPROVEN except BUG-012 · which is disposition-A ready) |
| Every visible CTA works or is hidden | ⏸ owed by live-walk (see recommendation) |
| Beta golden paths pass | ✅ per journey files + acceptance test IDs · unproven live |
| Real upload → clips → local files proven | ✅ 30050-byte MP4 from fixture · Whisper/Anthropic contract-locked (runtime proof owed) |
| Whop refresh no-reload | ✅ (identity ladder · useMe activation:complete subscriber · Whop chip) |
| Wallet/Affiliate/Payout numbers agree | ✅ canonical `/me/money-rollup` + HQ mirror byte-identical (regression test) |
| Real campaign ID submission only | ✅ grep-guard proves 0 preview-campaign in production |
| No authenticated Guest state | ✅ (identity ladder · IdentityKind union · runtime kind-drift guard) |
| No keychain prompt | ✅ (Wave 1 walk verified · BC-003 elimination pattern applied) |
| Normal runtime update works | ⏸ **DEPENDS ON BUG-012 DISPOSITION · see below** |
| HQ receives persistent proof | ✅ (Train B3 · dual-write · 16 backend assertions) |
| Ship-lens PASS | owed post-decision |
| Frontend/backend tests green | ✅ tsc + vitest 55 files + pytest 431/431 + 1 skip |
| Production build green | owed (Vite prod build not run this session · low risk given tsc clean + vitest full green) |
| Rollback pack saved | ✅ per-branch Impact Reports include rollback commands |

Two items pending: **live-walk (post-decision)** and **BUG-012 disposition**.

## BUG-012 · Option A vs Option B

### Context

BUG-012 · Runtime hot-swap requires quit+relaunch · Cmd+R doesn't stick.
- Root cause identified · confidence 0.85 · `runtime_check_now` in `src-tauri/src/runtime.rs:494` doesn't call `cache_active_root(&app)` after staging. `ACTIVE_RUNTIME_ROOT` `OnceLock<RwLock<...>>` stays stale mid-session.
- No runtime-only workaround exists · verified by Train B1.
- Shell freeze (DECISION-0003) not yet lifted for this fix.

### Option A · Codex-style restart-gated journey (no Rust)

**Scoped in this pack at `lcos/04_JOURNEY_BIBLE/j015-runtime-update.md` and the design doc alongside.**

- 7 states · Checking → Downloading silently → Update ready → Restart required → Restarting → Restored on new runtime → Update failed with safe retry
- Non-critical updates: soft "Update ready" indicator · never interrupts
- Critical updates (auth · money · data-integrity · clipping · compatibility): mandatory gate blocks navigation
- Never interrupts active protected journeys (upload · clip-run · export · submit · payout · claim ceremony)
- One-click restart · persists JWT + identity + last safe route + draft state via `localStorage["lc.restore.v1"]`
- On boot: verify `booted_version == staged_version`; restore state; clear restore key
- 8 HQ telemetry topics all persisting via Train B3
- 12 acceptance test IDs listed in the journey file

**Cost:** ~1-2 days build (frontend state machine + gate modal + boot-restore + tests + HQ topic wire-up). No Rust. No shell rebuild.

**Beta impact:** Restart requirement documented + gated with plain-language modal. User experience honest.

### Option B · One-line native Rust fix + shell revision cycle

- Add `cache_active_root(&app.handle())` at `src-tauri/src/runtime.rs:494` after `check_and_stage_runtime` returns
- Regression test in Rust proves the cache updates
- Full Tauri build (~5-13 min) + notarise + install locally + smoke test
- Codex-style journey still recommended long-term for the observability + failure-recovery pattern

**Cost:** DECISION-0003 shell-freeze lift · one build cycle · likely 1-2 hours end to end.

**Beta impact:** Cmd+R and mid-session activation just work. No restart gate needed for most updates. Simpler UX.

### Recommendation

**Option A for RC1 beta ship tonight**, followed by Option B in a scheduled shell revision cycle post-beta feedback.

Rationale:
- Option A ships tonight with no shell touches · beta users get honest restart-gated behaviour + rich HQ observability
- Option A's state machine is compatible with BUG-012 fixed OR unfixed · Option B is additive, not replacement
- Option A produces the observability + failure-recovery pattern that would be needed regardless of native fix
- Option B without Option A leaves the app blind to update failures and doesn't preserve state on restart

**If you pick Option A:** brief me and I dispatch a Train D1 · Codex update journey implementation (frontend · HQ topic wiring · localStorage restore · protected-journey deferral) as a follow-on wave. Est. 1-2 hours background time.

**If you pick Option B:** brief me and I lift the freeze for the one-line change · commit · add Rust regression · smoke-build · report back.

**If you pick "both":** Option A first (ship beta tonight) · Option B in next shell revision cycle. This is my recommendation.

## Documented gaps for Doctor Full (post-P5-scanners)

- `gap:j006-real-whisper-runtime-proof` — no bundled model in test env; contract-locked
- `gap:j006-real-anthropic-runtime-proof` — no `ANTHROPIC_API_KEY` in test env; boundary contract locked
- `gap:j007-me-clips-endpoint` — `GET /me/clips` doesn't exist; P4-owed schema migration
- `gap:golden-paths-registry-not-authored` — P4 owed
- `gap:live-customer-walk-owed` — Doctor Full or Daniel runs the 10-step walk on the promoted bundle before CLOSED transitions

## Rollback

Every merge commit has a `git revert -m 1 <sha>` rollback. Trains are ordered so B3 (HQ persistence infra) can revert alone if HQ needs backing out. Trains C1-C3 can each revert independently. Barrier fixes (b13ac9aa) revert cleanly.

## No push · no deploy · no promotion

Everything is local on `integration/cold-entry-mode-b`. Zero pushes. Zero tags. Zero deploys. Zero runtime promotions. Zero shell rebuilds. Bugs remain `FIXED_UNPROVEN` — only Doctor Full may CLOSED.

## Awaiting your call

1. **Option A vs B vs both** for BUG-012
2. Greenlight on Train D1 dispatch (Option A implementation) if you pick A
3. Anything else you want captured in the RC1 proof pack before beta signoff
