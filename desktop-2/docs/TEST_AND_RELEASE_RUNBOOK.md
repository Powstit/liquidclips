# Test & Release Runbook · Liquid Clips Desktop

The canonical rules for how tests run and how releases happen. If any
other doc disagrees with this file, **this file wins** for test +
release procedure. The shell is FROZEN — see
`desktop-2/CLAUDE.md:1-6`. Every user-visible change lands as a
pure-frontend runtime bundle and hot-swaps via the updater manifest.

`Dropbox: /Liquid Clips/RC1 Handover/test-release/`

---

## 1. Trusted gate runner

Every gate command MUST go through `lcos/scripts/gate-run.sh`.

**Why:** the original `command | tee log` idiom silently returned tee's
exit code (always 0). The runner captures the **upstream** command's
exit code and appends `GATE_EXIT=<n>` to the log. Documented at
`lcos/scripts/gate-run.sh:1-24`.

Usage:

```bash
bash lcos/scripts/gate-run.sh <log-path> <command…>
```

The runner exits with the underlying command's real status. Reproducible
runs depend on this — never bypass it.

Logs live under `lcos/reports/`.

---

## 2. Canonical commands, in required order

Run these top-to-bottom. Every step must be green before the next
step's failure is meaningful.

### 2.1 Shell contract guard

```bash
bash desktop-2/scripts/assert-shell-contracts.sh
```

Enforces every locked shell fact — package name, Tauri identifier,
product name, Kade poses, brand assets, launch routes, browser + Whop
handoff, auth + keychain safety, paywalls, publish / schedule, sidecar
+ updater bundle, version alignment across `package.json` +
`tauri.conf.json` + `Cargo.toml`, no old-brand drift. See the script
for the full assertion list.

**Pass criterion:** `Shell guard: <PASS> passed, 0 failed`.

### 2.2 TypeScript

```bash
cd desktop-2 && npx tsc -b
```

TypeScript project build. Must be **clean** (no diagnostics).

### 2.3 Vitest

```bash
cd desktop-2 && npm test
```

Runs `vitest run` — includes `src/**/*.test.ts` and `src/**/*.test.tsx`.
Configured at `desktop-2/vitest.config.ts` (jsdom environment).

**Current baseline:** 578 pass · 1 skipped · 61 files (from
`lcos/reports/rc1-sprint/AUTOMATED_RELEASE_STATE.md:61`).

The single skip is `src/routes/upload/upload.journey.test.ts::j005-upload`
— native-only, covered by sibling `test-upload-native.ts`.

### 2.4 Targeted Playwright

```bash
cd desktop-2 && PW_PORT=1970 npx playwright test tests/e2e/<spec>.spec.ts --reporter=list
```

Any surface-level change runs a targeted spec **before** the full sweep. Single-spec runtime ~2 min vs 34-46 min for full sweep.

**PW_PORT is worktree-safe** — parallel agents pick unique ports (1420 default · 1431 · 1970 · 1830). See `desktop-2/playwright.config.ts:14-19`.

### 2.5 Full D1 sweep

```bash
cd desktop-2 && PW_PORT=1970 npx playwright test --reporter=list
```

Runs every spec under `desktop-2/tests/e2e/`,
`desktop-2/tests/visual/`, `desktop-2/tests/golden-path/`, and
`desktop-2/tests/native-walk-prep/`. Discovery pattern is
`/.*\.spec\.ts$/` from `desktop-2/playwright.config.ts:38`.

**Baseline runtime:** ~34.7 min for 169 tests
(`lcos/reports/rc1-sprint/AUTOMATED_RELEASE_STATE.md:180`). Prior
measurements ran 46 min — expect the range 30–50 min depending on
machine and Vite dev cold-compile hits.

**Current certification state:** 136 pass · 1 fail · 32 skip · 169
total (as of `2026-07-12 · d97c2e71` per
`lcos/reports/rc1-sprint/AUTOMATED_RELEASE_STATE.md:66`).

The 1 residual is a composite `button-audit` spec with 6 individual
control edge cases — see `docs/KNOWN_ISSUES_AND_DEBT.md`.

### 2.6 Required order

```
guard → tsc → vitest → targeted → D1
```

Never claim green on a downstream step while an upstream step is red.
The guard catches shell contract violations that would waste hours of
Playwright compute.

---

## 3. Targeted-proof rules

- **Every surface-level change** (any file in `src/routes/**`,
  `src/sections/**`, or `src/design-os/routes/**`) requires a targeted
  Playwright spec run before the full sweep.
- **The spec must be the one that guards the changed surface**, not a
  neighbouring spec. If no spec guards the surface, write one — the
  targeted proof is the definition of "I know this works."
- **Vite dev cold-compile can take 10–30 s** on first hit. Playwright
  local timeouts are set generously to match (240 s test / 120 s action)
  — see `desktop-2/playwright.config.ts:24-32`.

---

## 4. Full-certification rules

Full D1 certifies at:

- **Pass:** 136 (+ any targeted-proof adds since baseline)
- **Fail:** 0 required · 1 acceptable if it is the documented composite
  `button-audit` residual and the six edge cases are unchanged
- **Skip:** 32 documented — see `docs/KNOWN_ISSUES_AND_DEBT.md`

All 32 skips are documented and none block a required release path. The
distribution:

- **NATIVE (~24):** `test.skip(true, "NATIVE_REQUIRED · <reason>")` under
  `desktop-2/tests/native-walk-prep/j00{4,5,6,7,15}*` and
  `desktop-2/tests/golden-path/walk.spec.ts`. All have Daniel-owned
  physical-walk counterparts.
- **Pre-refactor (~7):** `test.fixme(true, "Phase 1 (2026-07-12) · …")`
  or `test.fixme(true, "D1 residual (2026-07-13) · …")` for tests
  waiting on Section-pipeline / SimpleLoginPanel / WalletDetail parity.
- **Ambient (~1):** `clerk-otp-login:70` skips when the Clerk
  publishable key is not set in env.

---

## 5. Failure classification — 6 lanes

Every failed test is classified into exactly one lane. Rule from
`docs/HQ_CODEX_OPERATING_MODEL.md` (see companion doc).

| Lane | Meaning | Fix owner |
|---|---|---|
| **PRODUCT** | The app behaves wrong for a real user. | Dev team (Codex or human) |
| **STALE-TEST** | The test expects an old contract that has since moved. | Dev team — rewrite the test |
| **HARNESS** | The `_auth-harness`, seed, or mock infra is off. | Dev team — infra owner |
| **ENV** | Localhost 8000 down, ECONNREFUSED, CORS, port collision, missing env var. | Dev team — env owner |
| **EXTERNAL** | Whop / Clerk / Vercel / Railway / Apple returned a real error. | Escalate (see `docs/OWNERSHIP_AND_ESCALATION.md`) |
| **SUPPORT** | Real user issue reported inside a test-first bug report. | Dev team + support |
| **FEATURE-REQUEST** | Not a bug — a new capability. | Product review before code. |

The classification lives at the top of each test's failure block in
`test-results/*/verdict.json`. Merge conflicts arise when two agents
disagree — the tie-break is `docs/OWNERSHIP_AND_ESCALATION.md`.

---

## 6. False-green avoidance

The completion discipline from `~/.claude/skills/completion-discipline`
applies to every claim in a test/release report:

- **Source code proves on disk.** Not built, not visible.
- **A successful build proves built.** Not installed, not visually
  correct.
- **Vite / dev proof does not prove the installed Tauri app.**
- **HTTP 200 proves reachability.** Not the changed feature.
- **Anonymous 401 proves authentication.** Not cross-tenant isolation.
- **Push, backend deploy, Vercel deploy, and desktop release are
  separate states.** A green push is not a green deploy.

Every report after a mutation must include:

- Item name
- State (on disk · built · deployed · verified live)
- Direct proof (exact-artifact evidence)
- Regression proof (what stops it re-breaking)
- Remaining gap

If direct or regression proof is missing, downgrade the state and say
what remains. Never make Daniel type "prove."

---

## 7. Trace / screenshot / log preservation

- `desktop-2/test-results/` — per-failure Playwright traces + screenshots + verdicts. Preserved for the current cert cycle.
- `desktop-2/playwright-report/` — HTML report from the last full sweep.
- `lcos/reports/` — gate-run logs (`GATE_EXIT=<n>` footer per log).
- `lcos/reports/rc1-sprint/baseline-corrected/` — latest full-cycle proof pack.
- `desktop-2/tests/e2e/boot-baseline-*.json` — cold-boot snapshots; latest at `boot-baseline-latest.json`.

Preservation rule: never delete a failure artifact without a matching green rerun in the same cycle.

---

## 8. Runtime-only release path

The shell is **FROZEN**. Rust / Cargo / `tauri.conf` / sidecar /
`package.json` / new native commands / shell rebuild are **not allowed
without an explicit greenlight from Daniel** (`desktop-2/CLAUDE.md:1-6`).

Every user-visible change ships as a **runtime bundle** that hot-swaps
via the updater manifest. Users get the new bundle without reinstalling
the DMG.

### 8.1 Tag-triggered CI flow

The release script is `desktop-2/scripts/ship.sh`, invoked as:

```bash
cd desktop-2
./scripts/ship.sh <version> "release notes"
# e.g. ./scripts/ship.sh 2.2.37 "Wallet malformed-response state polish"
```

The script:

1. Validates the version (semver) and the branch (must be `main`).
2. Bumps `package.json`, `tauri.conf.json`, and `Cargo.toml` in lock-step
   (per the Phase C1 alignment guard at
   `desktop-2/scripts/assert-shell-contracts.sh:233-243`).
3. Tags `desktop-2-vX.Y.Z` and pushes.
4. Waits for GitHub Actions `Release desktop-2` to go green for **both**
   `aarch64` and `x86_64` matrix jobs.
5. Verifies the draft GitHub release contains all six required assets
   (`Liquid.Clips_X.Y.Z_aarch64.dmg`, `Liquid.Clips_X.Y.Z_x86_64.dmg`,
   `Liquid.Clips_aarch64.app.tar.gz` + `.sig`,
   `Liquid.Clips_x86_64.app.tar.gz` + `.sig`).
6. Mirrors the signed updater artefacts to the backend at
   `POST https://api.jnremployee.com/updates/upload`.
7. Verifies `GET https://updates.liquidclips.app/latest.json?target=…`
   reports the new version for **both** target slugs.

See `desktop-2/RELEASING.md:32-50` for the full "what a ship is,
exactly" definition.

### 8.2 Runtime bundle vs shell

- **Runtime bundle** = the `dist/` Vite build (React + CSS + assets).
  Ships via the Codex-style update journey shipped Train D1 (see
  `docs/SELF_HEALING_ROADMAP.md`).
- **Shell** = the native Tauri binary. Only rebuilt for a signed +
  notarised installer.

If a change is pure-frontend, it lands in the runtime bundle and users
get it via the updater. Cmd+R does **not** currently swap runtime
mid-session (BUG-012, native-cache issue) — the D1 restart-gated
journey mitigates this.

---

## 9. Rollback

Manifest revert. The updater serves whatever `latest.json` says. To roll
back:

```bash
# Repoint latest.json at the previous version (backend-side).
# The next `updateJourney` check on any user's install pulls the old
# bundle and stages it; the user's next voluntary restart is on the
# previous runtime.
```

Because the shell hosts the runtime rather than being it, rollback does
not require a new DMG install.

---

## 10. Manual walkthrough is NOT the functional release gate

Automation proves functionality first. Manual walkthrough is a
**confidence check** — not the gate.

Ordering:

1. Guard + tsc + vitest + targeted + D1 all green.
2. Runtime build clean (`vite build` at 10-13 s baseline · 1,060 kB
   main bundle · gzip 327 kB).
3. Manual walkthrough (P3 walk — see
   `lcos/reports/rc1-sprint/P3_WALK_SIGNOFF.md`).
4. Ship.

If a manual walk finds a bug that automation missed, the fix ships with
a **new spec** that would have caught it. Otherwise the manual walk
becomes a load-bearing part of the release, and that's how false-green
sneaks in.

---

## Release checklist

Run these before shipping. All boxes green = ship.

- [ ] Working tree clean (`git status`)
- [ ] On `main` (`git branch --show-current`)
- [ ] Local `main` matches origin (`git rev-parse HEAD` == `git rev-parse origin/main`)
- [ ] `bash desktop-2/scripts/assert-shell-contracts.sh` — 0 fails
- [ ] `cd desktop-2 && npx tsc -b` — clean
- [ ] `cd desktop-2 && npm test` — 578 pass · 1 skip · 0 fail
- [ ] Targeted Playwright specs for every changed surface — pass
- [ ] `cd desktop-2 && PW_PORT=1970 npx playwright test --reporter=list` — 136 pass · 1 acceptable fail (`button-audit` residual) · 32 skip
- [ ] `cd desktop-2 && npx vite build` — clean, main bundle within ±5% of 1,060 kB
- [ ] Iron gates: `bash desktop-2/scripts/iron-gates/agency-preview-paywall.sh` — pass
- [ ] Brand-drift IG-012: `bash desktop-2/scripts/brand-kit-drift-check.sh` — pass
- [ ] Runtime-update D1 journey verified end-to-end on a local install (see `SELF_HEALING_ROADMAP.md` §Codex-style)
- [ ] No secret values in commits (`git log -p origin/main..HEAD | grep -iE 'apikey|secret|token|password'` — empty)
- [ ] Backend deployed (if API changed) — `curl -s https://api.liquidclips.app/healthcheck` returns 200
- [ ] account-app deployed (if `/embed/*` changed) — `curl -sI https://account.liquidclips.app/embed/earn | grep -iE 'content-security|x-frame'` — empty (no deny headers on embed path)
- [ ] `./scripts/ship.sh <version> "notes"` — the script's own gate list green
- [ ] `GET https://updates.liquidclips.app/latest.json?target=darwin-aarch64` returns new version
- [ ] `GET https://updates.liquidclips.app/latest.json?target=darwin-x86_64` returns new version
- [ ] Local DMG install from the draft GitHub release — app launches, version pill shows new version, `updateJourney` state machine visible under Settings
- [ ] Manual walkthrough (confidence check) — see `lcos/reports/rc1-sprint/P3_WALK_SIGNOFF.md` for the walk contract
- [ ] Daniel signs off — see `docs/OWNERSHIP_AND_ESCALATION.md` §Releases

---

## References

- `lcos/scripts/gate-run.sh` — trusted gate runner
- `desktop-2/scripts/assert-shell-contracts.sh` — shell guard
- `desktop-2/playwright.config.ts` — Playwright config
- `desktop-2/vitest.config.ts` — Vitest config
- `desktop-2/scripts/ship.sh` — ship script
- `desktop-2/RELEASING.md` — full "what a ship is" definition
- `DEPLOYMENT.md` (root) — canonical deploy topology
- `lcos/reports/rc1-sprint/AUTOMATED_RELEASE_STATE.md` — most recent cert
- `lcos/reports/rc1-sprint/RC1_FINAL_PROOF_PACK.md` — sprint receipt
- `docs/KNOWN_ISSUES_AND_DEBT.md` — the 32 skips + 1 residual
- `docs/OWNERSHIP_AND_ESCALATION.md` — sign-off owner per surface
- `[Release walk video · v2.2.36](dropbox:///Liquid%20Clips/RC1%20Handover/test-release/v2.2.36-walk.mp4)` — `TODO: Daniel · generate Dropbox share link for release walk video`

## Verification checklist

Files inspected while writing this doc:

- [x] `/Users/dipdip/code/jnr/lcos/scripts/gate-run.sh`
- [x] `/Users/dipdip/code/jnr/desktop-2/scripts/assert-shell-contracts.sh`
- [x] `/Users/dipdip/code/jnr/desktop-2/package.json`
- [x] `/Users/dipdip/code/jnr/desktop-2/playwright.config.ts`
- [x] `/Users/dipdip/code/jnr/desktop-2/vitest.config.ts`
- [x] `/Users/dipdip/code/jnr/desktop-2/scripts/ship.sh`
- [x] `/Users/dipdip/code/jnr/desktop-2/RELEASING.md`
- [x] `/Users/dipdip/code/jnr/DEPLOYMENT.md`
- [x] `/Users/dipdip/code/jnr/lcos/reports/rc1-sprint/AUTOMATED_RELEASE_STATE.md`
- [x] `/Users/dipdip/code/jnr/lcos/reports/rc1-sprint/RC1_FINAL_PROOF_PACK.md`
- [x] `/Users/dipdip/code/jnr/lcos/reports/rc1-sprint/HANDOVER_PLAN_QUEUED.md`
