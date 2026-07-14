# INTERIM BASELINE SNAPSHOT — `e702f14d` (do NOT treat as complete)

**Status:** INTERIM · gates still running when this was first written
**Ledger commit (full SHA):** `8397e250a195e2a49ec5136f2ab2e89bccefcd5a`
**Reclassified INTERIM at:** 2026-07-12 · per Daniel directive

**Reason INTERIM:** D1 Playwright suite still executing (only 4 of 164 tests reported when this file was first committed). Complete-status amendment will be committed separately once every baseline gate finishes and the full pass/fail/skip/not-executed accounting is available.

## RECLASSIFICATION 2026-07-12 (shared root cause proven mid-sweep)

**D1 first run invalidated at 35/164** · killed for QA harness repair.

**Shared root cause · CONFIRMED:** `Playwright authenticated-session seeding no longer satisfies the current auth boot contract, so .lc-app never mounts.`

Every D1 spec whose `error-context.md` shows the `"Sign in to Liquid Clips"` page snapshot while waiting for `locator('.lc-app')` is reclassified from TEST/CONTRACT to:

**`QA HARNESS BLOCKED — authenticated shell not reached`**

Blocked specs (from first-run · 30 failure folders in `D1-test-results-INVALID-first-run/`):
- activation-bonus-states (6)
- activation-flow (1)
- agency-launch-readiness (1)
- agency-upgrade-cta-verify (2)
- brand-consistency (1)
- browse-shortcuts (2)
- browse-tab-omnipresent (1)
- button-audit (1)
- campaigns-station (1)
- caption-editing (1)
- channels-station (1)
- clerk-otp-login (3+)
- community-chat-home (8+)

**These are NOT product verdicts.** The later assertions were never reached. Product behavior of these surfaces is UNKNOWN pending re-run with a repaired harness.

### Confirmed remaining PRODUCT / TEST failures (unaffected by harness fix)
- **BC · A1 tsc TS6133 `resolvedTier` unused** — CODE/BUILD · likely polish-fixed
- **BC · A2 vitest TopHud.whop-chip Connect-Whop string-count** — TEST/CONTRACT · likely polish-fixed
- **B1 assert-kade-anchor stale EXPECTED_ROUTES** — TEST/CONTRACT · stale QA config (LoginOnboarding.tsx removed)
- **B3 assert-shell-contracts SubmitToWhopModal 9 fails** — TEST/CONTRACT · pre-existing
- **C1 smoke-gate 3 mandatory walks** — TEST/CONTRACT + env · JWT mint path
- **E2 eslint 95 problems in account-app** — TEST/CONTRACT · code hygiene drift
- **E4 smoke-embed `/embed/earn` anchor** — TEST/CONTRACT · copy drift
- **IG-014 keychain prompt** — RUNTIME PRODUCT · proven root cause · fix designed · DEFERRED

### Post-merge harness self-test status (2026-07-12 evening)

After merging `4a117790` into integration and reverting the fidelity add (`8dda6647`), main-repo self-test result: **3 passed / 2 failed**.

Passing:
- signed-out boot → LoginScreen
- signed-out with expired JWT stays signed-out
- authenticated returning boot with defaults mounts the app-shell

Failing:
- authenticated with Whop disconnected still mounts the app-shell (spec line 65)
- authenticated with Whop connected mounts the app-shell (spec line 75)

The AGENT's "5/5 pass" claim inside its isolated worktree could not be reproduced in the main-repo checkout. Root cause unclear — possibilities:
- Difference between worktree and main-repo `.playwright` state
- Race with a runaway D1 process from the earlier baseline sweep (pid 74208 · killed)
- Real edge case in the Whop-state seed logic

Discovery via D1 rerun preferred over further self-test debugging: most migrated specs use default (non-Whop) state, so the D1 sweep will reveal whether the shipped harness is fit for purpose in practice.

Fidelity follow-up commit `cf380aec` (8 missing /me keys) was reverted `8dda6647` because it broke default self-test with `remaining_exports: 999` and other speculative fields that didn't match real app expectations. Documents the Daniel-warned failure mode: harness must not invent state the real app can't reach.

### QA HARNESS repair dispatched (isolated worktree)
- Branch: `qa-harness/playwright-auth-seed`
- Creates: `tests/e2e/_auth-harness.ts` + `_auth-harness.self-test.spec.ts` + updates 13 failing spec files
- No product code touched
- Isolated commit before TopHud polish merge
- D1 sweep restarts from the beginning against the repaired harness · full 164 tests
- ONLY genuine product failures (assertions after `.lc-app` mounted) will be classified in the reclassification-final ledger

### QA HARNESS category summary (proven this sweep)
1. `| tee` masked upstream exit codes — **fixed** via `gate-run.sh` (self-test PASS)
2. self-test v1 own bug (piped wrapper through tail) — **fixed**
3. pnpm approve-builds interactive prompt — **workaround** documented
4. local uvicorn state — **workaround** documented
5. **Playwright authenticated-session seed drift** — **IN PROGRESS** (agent dispatched)
6. `healthCheck.ts:48 keychain.passive: ok` static-green — **documented** (fix in IG-014 patch)

### Ledger status
- Baseline QA CERTIFICATION: **NOT TRUSTED** until Playwright harness repaired AND D1 re-run completes
- Runner exit propagation: **TRUSTED**
- Physical walkthrough: **NOT REQUIRED**

---

# Original file body (as-was at INTERIM point)

# Complete Baseline Gap Ledger · commit `e702f14d`

**Sweep started:** 2026-07-12T13:15Z · **Ledger written:** 2026-07-12T~14:00Z
**Runner:** `lcos/scripts/gate-run.sh` (validated by 3-case self-test · exit propagation TRUSTED · semantic parse required for hidden-failure case 3)
**Runner self-test:** `/tmp/gate-run-selftest/{pass,fail7,hidden}.log` · verdict TRUSTED
**QA harness before this sweep:** UNTRUSTED (`| tee` masked upstream exits · every prior sprint "clean" tsc claim is a false zero)

**Historical sprint reports:** marked `UNTRUSTED — generated before gate-run exit propagation fix`. Not rewriting past reports; current baseline + integrated cert are the trusted state.

---

## Failure category legend

- **QA HARNESS FAILURE** — the runner/tool wrapper hid a real failure or environmental setup blocks measurement
- **CODE/BUILD FAILURE** — the codebase does not compile
- **TEST/CONTRACT FAILURE** — a source-contract, unit-test, or integration-test assertion fails
- **RUNTIME PRODUCT FAILURE** — behaviour visible to a real user on the installed app fails
- **ENVIRONMENT/DEPENDENCY FAILURE** — external dependency, running service, or filesystem state gap

---

## Gate results (baseline against `e702f14d`)

| Gate | True exit | Semantic result | Category | Exact failure | Evidence | Pre-polish? | Shared root cause |
|---|---|---|---|---|---|---|---|
| A1 · `tsc -b` | **1** | FAIL | CODE/BUILD | `desktop-2/src/design-os/components/TopHud.tsx:112 · TS6133 'resolvedTier' is declared but its value is never read` (1 error) | `A1-tsc.log` | yes | TopHud · likely removed by polish |
| A1b · `tsc --noEmit` | **2** | FAIL | CODE/BUILD | Same TS6133 · exit 2 vs `-b` exit 1 (both catch it) | `A1b-tsc-noemit.log` | yes | same as A1 |
| A2 · `vitest run` (2nd run) | **1** | FAIL | TEST/CONTRACT | `TopHud.whop-chip.test.ts:64 · "Connect Whop" string count > 2 in TopHud.tsx source` (1 file / 1 test failed · 566 pass · 1 skipped / 568 total) · initial run additionally failed `TopHud.pill.test.ts::avatar-user-name renders identity ladder` (flaky · did not reproduce on re-run) | `A2-vitest.log` | yes · both fixed by polish overlap | TopHud source-contract |
| A3 · `pytest` | **0** | PASS-with-1-skip | — | 434 pass · 1 skipped (needs semantic review of skipped test to confirm not required) | `A3-pytest.log` | — | — |
| A4 · `vite build` | **0** | PASS | — | Built in 15.57s · warning-only on chunk size | `A4-vite-build.log` | — | — |
| B1 · `assert-kade-anchor.sh` | **1** | FAIL | TEST/CONTRACT (stale expected set) | Script's `EXPECTED_ROUTES` includes `LoginOnboarding.tsx` — file does not exist in `desktop-2/src` (grep returned zero hits) | `B1-kade-anchor.log` | yes | script's EXPECTED_ROUTES stale after LoginOnboarding renamed/removed by earlier work |
| B2 · `lint-kade-decoupling.sh` | **0** | PASS | — | Empty log body · exit 0 · trusted | `B2-kade-decouple.log` | — | — |
| B3 · `assert-shell-contracts.sh` | **1** | FAIL | TEST/CONTRACT | 9 failed / 110 passed · violations concentrated on `desktop-2/src/design-os/components/SubmitToWhopModal.tsx` (lines 128, 205 cited) | `B3-shell-contracts.log` | yes | SubmitToWhopModal shell contract drift |
| B4 · `brand-kit-drift-check.sh` | **0** | PASS | — | ✓ IG-012 green | `B4-brand-drift.log` | — | — |
| C1 · `smoke-gate.sh` | **1** | FAIL | TEST/CONTRACT (with ENVIRONMENT overlay) | 3 mandatory walks failed: signin (JWT mint failed) · wallet (no JWT · cascade) · submit (no JWT · cascade). Failure walks all passed (5/5). Mandatory walk 10/10 (fixture-leak) passed. First run additionally aborted with "backend not reachable" (local `:8000` had died) — pure ENVIRONMENT · resolved by restart | `C1-smoke-gate.log` | yes | smoke-gate JWT mint path needs env config not present in this session |
| C2 · `audit-gate.sh` | **0** | PASS | — | `PASS · activity=0 ticks/hr` (queried api.jnremployee.com/audit/state) | `C2-audit-gate.log` | — | — |
| D1 · `playwright test` | **RUNNING** | 4+ ✘ so far | TEST/CONTRACT (probably PRODUCT) | Failures so far all in `tests/e2e/activation-bonus-states.spec.ts` (Earn module · Sponsored Reward Card · Sponsored Reward Strip · approved state breakdown). 164 total · 1 worker · ~15-25 min ETA | `D1-playwright.log` (live) | yes (assumed) | activation-bonus-states surface |
| E1 · `next build` (bypassed pnpm) | **0** | PASS | — | Next build produced full page tree including `/sign-up`, `/status`, `/upgrade`, `/admin`, etc. | `E1-account-next-build.log` | — | — |
| E1a · `pnpm run build` (via pnpm) | **1** | FAIL | QA HARNESS · pnpm `runDepsStatusCheck` fails on `approve-builds` prompt | pnpm required interactive approve-builds and threw. Bypass via direct `node_modules/.bin/next` binary | `E1-account-next-build.log` (initial version) | yes | pnpm approve-builds interactive prompt |
| E2 · `eslint .` (bypassed pnpm) | **1** | FAIL | TEST/CONTRACT | 95 problems · 69 errors · 26 warnings · includes `react-hooks/set-state-in-effect` errors | `E2-account-lint.log` | yes | account-app eslint drift |
| E3 · `node --test agency-tiers + agency-license-cache` (bypassed pnpm) | **0** | PASS | — | 22/22 tests · 0 fail · 381ms | `E3-account-agency-contracts.log` | — | — |
| E4 · `smoke-embed.sh` | **1** | FAIL | TEST/CONTRACT | Expected anchor missing on `/embed/earn`: `"Link your account to see your earnings"` (or copy has since changed) | `E4-smoke-embed.log` | yes | account-app embed page copy drift |
| F1-N · Lens skills | NOT YET RUN | — | — | Per Daniel's rule: "lens invocation alone is not proof · each lens must produce concrete findings, reports, commands, or test evidence." Deferred to integrated sweep where they'll be paired with concrete evidence gathering (ship-lens JSON at `desktop-2/docs/ship-lens-review.json`, bug-hunt-lens output, integration-lens output, old-app-regression-lens output). | — | — | — |
| IG-014 · keychain prompt (from memory) | — | FAIL (confirmed by Daniel this session) | RUNTIME PRODUCT | Keychain prompt appears during runtime · violates the keychain-guard invariants and BC-003-adjacent scope | tracked separately | yes | keychain guard regression |

---

## Cross-cutting QA HARNESS defects surfaced (all now fixed or documented)

| Defect | Impact | Status |
|---|---|---|
| `command 2>&1 \| tee log` returned tee's exit (always 0) | All prior sprint "tsc clean" / "vitest green" reports rely on this pattern · all UNTRUSTED | Fixed via `lcos/scripts/gate-run.sh` · self-test PASS |
| Wrapper self-test v1 piped wrapper output through `tail` · `$?` returned tail's exit | Nearly declared runner UNTRUSTED · was actually my test that was broken | Fixed v2 with `>/dev/null` redirect + separate `$?` |
| `pnpm run <script>` fails on approve-builds prompt in this account-app | E1/E2/E3 all reported exit 127 (pnpm not on `/usr/local/bin`) or exit 1 (pnpm interactive prompt failure) | Bypass documented: use `node_modules/.bin/<tool>` binaries directly |
| Local `uvicorn :8000` was not running when smoke-gate.sh first ran | C1 aborted "backend not reachable" · re-run required | Documented · restart uvicorn as pre-req |

---

## Confirmed baseline verdict

**NOT GREEN.**

### Summary

| Category | Count | Notes |
|---|---|---|
| CODE/BUILD | 1 (tsc TS6133 · `resolvedTier`) | Likely fixed by TopHud polish |
| TEST/CONTRACT | 6+ (vitest 1 · B1 · B3 · C1 · E2 · E4 · D1-in-progress) | TopHud tests probably fixed by polish · B1/B3/E2/E4/C1 pre-existing |
| RUNTIME PRODUCT | 1 (IG-014 keychain) | Needs runtime patch |
| QA HARNESS | 4 (tee-mask · self-test v1 · pnpm approve · uvicorn state) | All documented + workarounds applied |
| ENVIRONMENT | overlaps with C1 · E1-E3 above | Documented pre-reqs |

### Pre-polish vs polish-fixable overlap

The following baseline failures OVERLAP with the polish agent's OWNED surface (TopHud + identity):
- **A1 tsc** — `TopHud.tsx:112 resolvedTier unused` — polish rewrites TopHud pill/greeting section · `resolvedTier` may vanish or be consumed
- **A2 vitest 1 failure** — `TopHud.whop-chip.test.ts::does not re-implement WhopStatusChip inline` (Connect Whop string count) — polish removes standalone sign-in and consolidates chip · will change source strings
- **A2 vitest earlier flake** — `TopHud.pill.test.ts::avatar-user-name renders identity ladder (Wave 1)` — polish rewrites Kade pill · will change source patterns

**Expected integrated behaviour:** these 3 assertions either pass after polish merges (if polish maintains contract) OR fail with a NEW failure (if polish changed the contract but the tests were still on old contract). Polish agent's brief required 4 new polish tests + preserving existing TopHud test regression, so I expect either PASS or replaced-by-polish-tests.

### Pre-existing (unrelated to polish)

- **B1 stale EXPECTED_ROUTES** (LoginOnboarding.tsx removed but script wasn't updated)
- **B3 SubmitToWhopModal contract violations** (9 fails)
- **C1 smoke-gate JWT mint config** (env or contract)
- **D1 activation-bonus-states failures** (Earn module · Campaigns Sponsored Card · Clipper home strip)
- **E2 account-app eslint drift** (95 problems)
- **E4 smoke-embed** `/embed/earn` anchor
- **IG-014 keychain prompt** runtime regression

These 7 items are **PRE-POLISH baseline failures** and will remain after polish merges.

---

## Current status

- **QA certification system:** TRUSTED (gate-run.sh self-test PASS · semantic-parse-required case 3 documented)
- **Baseline (against `e702f14d`):** **NOT GREEN** · 8+ failures across 5 categories
- **Integrated runtime (post-polish):** **NOT YET TESTED**
- **Physical walkthrough:** **NOT YET REQUIRED**

## Next steps (deferred until polish merges)

1. Wait for polish agent to complete
2. Merge polish with `--no-ff` into `integration/cold-entry-mode-b`
3. Re-run corrected A-F suite against integrated commit using `gate-run.sh`
4. Diff integrated results vs this baseline · classify each failure as:
   - Pre-existing baseline failure
   - Failure fixed by polish
   - Regression introduced by polish
   - Unrelated integration failure
5. Group remaining failures by shared root cause (SubmitToWhopModal · Earn/Campaigns Sponsored surface · account-app lint drift · smoke-gate JWT config · keychain prompt · etc.)
6. Patch root-cause clusters (runtime/frontend only · no Rust · no Tauri · no backend · no new npm deps)
7. Run targeted proof per cluster
8. Run one complete clean certification sweep
9. Only then produce AUTOMATED RELEASE STATE with GREEN/NOT-GREEN verdict

## Live processes

- Playwright test:user-lens · still running · ~5 min into sweep · 4 failures observed so far in activation-bonus-states.spec.ts · will keep collecting evidence until finish
- TopHud polish agent · isolated worktree at `.claude/worktrees/agent-a683d47a53c92df88` · branch `polish/tophud-canonical-identity` at base `e702f14d` · no commits yet · will not modify

## Machine state

- Main repo: `integration/cold-entry-mode-b` @ `e702f14d` · clean tracked-file working tree
- Local uvicorn: running (pid 73438 on :8000)
- Installed app: last restored to `2.2.36-state-drift-fixed`

## No push · no deploy · no promotion this sweep
