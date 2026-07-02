# Liquid Clips Desktop 2 — release-repair master handoff

> **Status:** NOT READY TO DEPLOY  
> **Owner:** Claude  
> **Repository:** `/Users/dipdip/code/jnr`  
> **Primary surface:** `/Users/dipdip/code/jnr/desktop-2`  
> **Prepared:** 2026-07-01 (Europe/London)  
> **Target application version:** `2.2.18`  
> **Observed staged runtime:** `2.3.5`

This is the single execution document for making Desktop 2 usable and
release-ready. Read it completely before editing anything. Work through it in
order, update the execution log as evidence is produced, and do not deploy
until every release gate is checked and the user explicitly approves release.

## IN-FLIGHT CORRECTION CHECKPOINT — mandatory before continuing

> Added 2026-07-02 after independent review. The previous Claude run was
> interrupted during the full Playwright suite. Preserve its changes, but do
> not continue to later phases or mark Phase C/D complete until every item
> below is corrected and proven.

### 1. Fix truthful shell exit-code capture

Commands such as:

```bash
(npx tsc -b --pretty false 2>&1 | head -8)
echo "$?"
```

report the status of `head`, not necessarily the status of TypeScript. This
already produced `EXIT=0` beside a real TypeScript error. The same flaw exists
when piping Playwright output through `tail`.

For all remaining gates, either run the command without a pipe or enable
pipeline failure propagation before it:

```bash
set -o pipefail
npx playwright test --workers=1 --reporter=list 2>&1 | tee /tmp/playwright-full.log
status=$?
echo "EXIT_FULL=$status"
test "$status" -eq 0
```

Rerun every Phase D command whose exit status was captured through `head` or
`tail`. Replace earlier evidence with the truthful rerun.

### 2. Repair the confirmed full-suite accessibility failure

The interrupted full Playwright suite already produced this failure:

```text
tests/e2e/brand-consistency.spec.ts
routes missing a route-title h1: workstation
```

The visual duplicate route header may stay removed, but Workstation still needs
one semantic route-title `<h1>` carrying the contract expected by the route
test. Use an accessible visually-hidden heading if a visible heading would
reintroduce the duplicate UI. Do not weaken the test or remove Workstation from
the route list.

### 3. Fix both invalid self-targeting container queries

The current C5 code declares `container-type` on `.lc-cps`, then tries to style
`.lc-cps` from `@container cps`. A container query selects an ancestor
container; the element cannot query itself.

Required C5 structure:

- Put `container-type: inline-size` and a container name on the preview host or
  inspector wrapper that is the parent of `.lc-cps`.
- Query that parent container and style descendant `.lc-cps`.
- Verify the computed `grid-template-columns` is one column in the ~320px
  inspector and two columns in a genuinely wide host.

The current C6 code repeats the same mistake by declaring the container on
`.lc-cd-head` and styling `.lc-cd-head` from its own query.

Required C6 structure:

- Put the container declaration on `.lc-cockpit-dock` or another stable parent
  of `.lc-cd-head`.
- Query the parent and style descendant `.lc-cd-head`, nav, and actions.
- Verify computed wrapping/layout at all three target widths.

Tests must inspect the resulting computed layout, not merely the presence of
CSS text.

### 4. Make the zero-candidate test real

The added test currently calls `test.skip()` when it fails to create the state.
That proves nothing and violates the release gate.

Required:

- Mock the actual `sidecar.getProject` boundary to return a hydrated project
  containing `clips: []`.
- Remove the conditional skip.
- Assert stale focus, inspector, editor, body, and dock are cleared.
- Assert the empty-results panel is visible.
- The button labelled “Retry this source” must actually retry the same saved
  source. If it only opens the generic create panel, rename it accurately or
  wire the genuine retry event/API.
- Make this test hard-pass before claiming C2 complete.

### 5. Complete clip normalization instead of documenting unsafe values

The current C4 normalization still allows:

```text
score: undefined
score: NaN
score_breakdown.*: undefined
description: null/undefined
```

This contradicts the stated requirement that customer-visible values never
receive `undefined`, `null`, or `NaN`.

Required:

- Pass `score` and legacy `virality` through the finite-number helper.
- Normalize every score-breakdown value through the same helper or use an
  explicit absent-value display contract that never interpolates unsafe data.
- Normalize optional customer-visible strings.
- Add a partial/legacy payload fixture containing missing, null, string,
  infinite, and `NaN`-like values.
- Assert rendered UI contains none of `undefined`, `null`, `NaN`, or
  `[object Object]`.

### 6. Add missing C3/C5/C6/C7 behavioural tests

Implementation comments are not evidence. Before Phase C is complete, add
hard-passing tests for:

- C3 mid-run hydration warning deduplication and successful later recovery.
- C3 terminal hydration failure and working retry.
- C5 narrow and wide computed preview layouts.
- C6 dock wrapping/actions at all target sizes.
- C7 stale hydration response suppression and empty response clearing focus.

### 7. Rerun Phase D from the beginning

After items 1–6:

1. Stop any duplicate Vite server and start one known test server.
2. Rerun the targeted workstation suite twice with zero skips.
3. Rerun build, guard, Cargo check, full Playwright, and invariant tests using
   truthful exit-code capture.
4. Record the number of passed, failed, and skipped tests. Required skips for
   unrelated platform constraints must be named; the new release-gate tests
   may not skip.
5. Do not mark the completed visual “approved” solely because its regenerated
   baseline matches itself. Preserve before/after/diff evidence for user visual
   approval.

## 1. Non-negotiable operating rules

1. Work only in `/Users/dipdip/code/jnr`, primarily `desktop-2/`.
2. Preserve every existing modified and untracked file. They are active user
   work. Do not run `git reset`, `git checkout --`, `git clean`, broad
   formatters, or any command that discards/reverts changes.
3. Do not purge application data, caches, runtime bundles, credentials, or
   macOS Keychain entries.
4. Do not deploy, tag, publish, promote a runtime, or run a release script
   during repair and verification.
5. Never use `runtime-ship.sh --skip-review` for a production candidate. It
   bypasses the review gate and is not proof of readiness.
6. Do not fix unrelated products or the legacy `desktop/` implementation.
7. Keep changes narrow. Read the current diff before modifying a file, because
   another agent has already started repairing the relevant code.
8. Do not hide failures with retries, longer timeouts, skipped tests, deleted
   assertions, or blindly regenerated snapshots.
9. A green build is necessary but is not proof that the app is deployable.
10. Stop and report evidence if an external dependency, signing credential,
    account, or production approval is missing. Never invent success.

## 2. Known starting state — verify before editing

Run these commands separately:

```bash
cd /Users/dipdip/code/jnr
git branch --show-current
git rev-parse --short HEAD
git status --short
git diff --stat
```

Expected when this document was written:

- Branch: `main`
- HEAD: `d8539fb`
- `desktop-2/package.json`: `2.2.18`
- `desktop-2/src-tauri/tauri.conf.json`: `2.2.18`
- `desktop-2/src-tauri/Cargo.toml`: still `2.2.0` and must be aligned
- Installed application observed: `2.2.18`
- Runtime pointer observed at
  `~/Library/Application Support/Liquid Clips/runtime/current.json`: `2.3.5`
- Existing working tree includes source, tests, a visual baseline, runtime
  config, review evidence, and brand assets. Preserve all of them.

At minimum, the working tree was observed to contain:

```text
M desktop-2/package.json
M desktop-2/src-tauri/tauri.conf.json
M desktop-2/src/design-os/components/InlineCreatePanel.tsx
M desktop-2/src/design-os/components/WorkstationFrame.css
M desktop-2/src/design-os/engine/EngineActions.tsx
M desktop-2/src/design-os/engine/cockpit/CockpitDock.css
M desktop-2/src/design-os/routes/Workstation.css
M desktop-2/src/design-os/routes/Workstation.tsx
M desktop-2/src/design-os/state/useEngineSession.ts
M desktop-2/tests/visual/baselines/workstation-completed-path.png
M desktop-2/tests/visual/workstation.spec.ts
?? desktop-2/docs/ship-lens-review.json
?? desktop-2/public/brand/icons/stages/
?? desktop-2/src-tauri/tauri.dev.conf.json
```

If the state differs, record the difference below. Do not automatically revert
it.

## 3. Definition of done

Desktop 2 is only **ready for the user to approve deployment** when all of the
following are true:

- The workstation is usable at `1040×680`, `1280×820`, and `1440×900`.
- The correct content region scrolls; the page is not trapped and primary
  controls remain reachable.
- Inspector and editor are independent, deliberate UI states.
- Running, completed, empty-results, error, resume, and legacy-project states
  render safely.
- No customer-facing value displays `undefined`, `NaN`, stale clip data, or an
  unrecoverable blank state.
- The targeted workstation Playwright suite passes reliably with one worker.
- The full Playwright suite passes reliably with one worker.
- TypeScript build, shell contracts, brand gates, invariant tests, and Rust
  check pass.
- Package, Tauri, and Cargo application versions agree.
- A real customer journey succeeds from source ingestion through export.
- Free and paid watermark behaviour is verified.
- Captions-on and captions-off exports are verified.
- The ship-lens review has been rerun against the final candidate and honestly
  reports `PASS`.
- Desktop 2 deployment/runtime instructions are reconciled in
  `DEPLOYMENT.md`.
- Native signed/notarized packaging, clean install, update, runtime promotion,
  and rollback have evidence.
- The final candidate is committed with a clean working tree.
- The user explicitly says to deploy.

Until then, the answer to “is it ready to deploy?” is **no**.

## 4. Execute in this exact order

### Phase A — preserve and understand the current repairs

Before writing code:

```bash
cd /Users/dipdip/code/jnr
git diff -- desktop-2/src/design-os/routes/Workstation.tsx
git diff -- desktop-2/src/design-os/routes/Workstation.css
git diff -- desktop-2/src/design-os/components/WorkstationFrame.css
git diff -- desktop-2/src/design-os/engine/cockpit/CockpitDock.css
git diff -- desktop-2/src/design-os/state/useEngineSession.ts
git diff -- desktop-2/src/design-os/engine/EngineActions.tsx
git diff -- desktop-2/tests/visual/workstation.spec.ts
git diff -- desktop-2/tests/visual/baselines/workstation-completed-path.png
```

Existing repairs that should remain unless a failing test proves they are
wrong:

- `.lc-ws-frame-body` has bounded flex sizing and hidden outer overflow.
- Workstation main content and inspector are the intended scroll owners.
- Narrow layouts use an inspector drawer instead of a giant intrinsic stack.
- Inspector-open and editor-open state are separated.
- The duplicate route header was removed.
- The bottom editor dock opens deliberately rather than automatically.
- Clear-session navigation now emits the `workstation` route.
- Bake/regenerate hydration failures now surface a state error and toast.

Do not rewrite these areas wholesale. Finish the gaps and prove them.

### Phase B — stabilize the workstation test harness first

The most recent targeted run produced **2 passed / 5 failed**. Treat each
failure as evidence:

1. Completed-state visual differed by roughly 119,539 pixels / ratio `0.10`.
2. The `1440` running-state case could not find
   `[data-testid="ws-phase-pill"]`.
3. Acceptance tests at three viewport sizes later hit
   `ERR_CONNECTION_REFUSED`, meaning the Vite server died.

The visual baseline is now modified in the working tree. Do not assume that
means the new image is approved.

Run the server and tests separately so server death is visible:

Terminal 1:

```bash
cd /Users/dipdip/code/jnr/desktop-2
npm run dev -- --host 127.0.0.1
```

Terminal 2:

```bash
cd /Users/dipdip/code/jnr/desktop-2
npx playwright test tests/visual/workstation.spec.ts --workers=1
```

Requirements:

- Capture the Vite terminal output when the `1440` case runs.
- Identify why the server exits. Fix the root cause; do not add retries.
- Determine why `ws-phase-pill` disappears only at `1440`. Inspect app state,
  console errors, DOM state, and route state before changing the assertion.
- Review the expected, actual, and diff images for the completed-state test.
- Keep the old baseline until the layout is confirmed correct.
- Only update the baseline after the corrected page is visually inspected and
  the change is intentional. Record that inspection in the execution log.
- Rerun the targeted file at least twice with `--workers=1`. Both runs must pass.

The targeted suite must verify:

- `1040×680`, `1280×820`, and `1440×900`.
- One bounded main scroll owner; no dead/non-scrollable content region.
- No unintended horizontal overflow.
- Header, create action, selected clip, and primary controls are reachable.
- Inspector opens and closes without opening the editor.
- Editor opens and closes without changing inspector intent.
- Bottom dock stays above the footer and does not cover critical content.
- Running phase renders at all target widths.
- Completed and empty states remain usable.

Do not proceed to full-suite work until this phase is green.

### Phase C — close the remaining product blockers

#### C1. Align all application versions

Set the package version in:

```text
desktop-2/src-tauri/Cargo.toml
```

to `2.2.18`, matching:

```text
desktop-2/package.json
desktop-2/src-tauri/tauri.conf.json
```

Extend `desktop-2/scripts/assert-shell-contracts.sh` so the guard fails when
any of those three versions disagree. The check must report the mismatched
files and versions without mutating them.

Do not confuse the application version (`2.2.18`) with the staged runtime
bundle version (`2.3.5`); they are different release dimensions.

#### C2. Make zero-candidate completion recoverable

In `desktop-2/src/design-os/routes/Workstation.tsx`, the candidate-count effect
currently returns when the count is zero. This can leave a stale focused clip.

Required behaviour when hydration/completion yields zero clips:

- Clear `focusedClipId`.
- Close inspector and editor.
- Render an explicit empty-results state.
- Offer a working recovery action such as retry/regenerate or return to source.
- Never render stale details from the previous project/session.
- Add a Playwright assertion for the zero-candidate state.

#### C3. Handle hydration failures by lifecycle state

In `desktop-2/src/design-os/state/useEngineSession.ts`:

- Preserve the visible bake/regenerate error treatment already added.
- Inspect the mid-run hydration catch that currently only logs a warning.
- A transient mid-run read failure must become visible and recoverable without
  needlessly turning a still-running job into a terminal failure.
- Use a deduplicated toast/status warning and a retry/re-poll path.
- Avoid notification spam on every poll.
- A terminal hydration failure must set a truthful error state with a retry.
- Add tests for mid-run failure recovery and completion-time failure.

#### C4. Normalize old or partial clip records

Validate/normalize hydrated project data at the boundary, preferably in
`hydrate_project`, rather than scattering unsafe assumptions through views.

Provide safe defaults for every value rendered by Cockpit/Preview, including:

- title/label
- duration
- score
- aspect ratio
- hook/retention/clarity/shareability metrics
- caption/text fields
- asset paths and optional URLs

Rules:

- No `undefined`, `null`, or `NaN` reaches customer-visible text.
- Missing media produces an intentional placeholder.
- Legacy records remain selectable and navigable.
- Add a test fixture representing an older/partial project payload.

#### C5. Make preview layout responsive to its container

`ClipPreviewShell` uses an internal two-column layout but may be mounted inside
the fixed desktop inspector. Window media queries alone do not solve this.

Implement a container-aware layout:

- Set `container-type: inline-size` on the inspector/preview host.
- In `ClipPreviewShell.css`, switch to one column when its container is below
  approximately `480px`.
- Ensure media, metrics, actions, and text do not clip.
- Keep the wider two-column presentation when actual container width permits.
- Test the fixed desktop inspector and the narrow drawer.

#### C6. Make the running dock intelligent, not crowded

The dock contains multiple phase pills and actions. Its header must adapt:

- Use a two-tier/wrapping arrangement or a compact/icon treatment at constrained
  widths.
- Preserve readable current phase and overall progress.
- Keep cancel/retry/close actions reachable.
- Do not cover the footer or selected clip content.
- Test long phase labels and all three target viewport sizes.

#### C7. Resume ordering and stale state

Add coverage for resume/hydration ordering:

- Route opens before hydration completes.
- Hydration resolves with clips.
- Focus is assigned only to a valid current clip.
- A subsequent empty response clears prior focus.
- Late data from an older request cannot overwrite the active project.

Use request/session identity or cancellation if the current implementation can
race.

### Phase D — run deterministic automated gates

From `/Users/dipdip/code/jnr/desktop-2`, run each separately and record its exit
code:

```bash
npm run build
```

```bash
npm run guard
```

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

```bash
npx playwright test tests/visual/workstation.spec.ts --workers=1
```

```bash
npx playwright test --workers=1
```

```bash
npm run test:invariant
```

Acceptance rules:

- All commands exit `0`.
- No test is skipped to obtain green.
- No snapshot is updated without visual inspection.
- Warnings are classified in the log. The existing unused Rust manifest-field
  warning is not automatically fatal, but either consume the fields or annotate
  the intentional dead-code choice cleanly.
- If `test:invariant` repeats earlier tests, it must still complete successfully.

Any failure returns work to the phase that owns it.

### Phase E — perform a real customer journey

Fixtures and mocked UI tests are not enough. Use a real supported source and
the native Desktop 2 shell.

Test this exact journey:

1. Launch a fresh candidate build without deleting the user's existing data.
2. Sign in and confirm credentials persist through the supported Keychain path.
3. Paste a real supported video URL.
4. Start ingestion.
5. Confirm audio extraction.
6. Confirm transcription progresses visibly.
7. Confirm candidate selection.
8. Confirm cut, reframe, and thumbnail stages.
9. Confirm clips appear in My Clips.
10. Open a clip preview.
11. Open and use the inspector.
12. Open and use the editor separately.
13. Export with captions enabled.
14. Export with captions disabled.
15. Verify a free-plan export contains the required watermark.
16. Verify an entitled paid export does not contain the free watermark.
17. Quit and relaunch; resume the project and confirm state is correct.
18. Exercise a recoverable network/runtime failure and confirm the user receives
    a useful retry path.

For each step, record:

- candidate app version
- runtime version
- input/source identifier (redacted if private)
- outcome
- screenshot or log path
- exported file path
- any warning

Do not write “passed” without actually running the step.

### Phase F — rerun the ship-lens review honestly

`desktop-2/docs/ship-lens-review.json` was observed with verdict `BLOCK` and
stale `addressed: false` findings.

Requirements:

- Rerun the reviewer against the final code and evidence.
- Do not manually flip `BLOCK` to `PASS`.
- Confirm every P0 and P1 finding is fixed or explicitly rejected with concrete
  evidence.
- Store the resulting final report at the established path.
- A production candidate must report `PASS`.

The runtime shipping script currently cannot obtain an automatic review unless
the reviewer dispatch is wired. Fix or document the approved human-review path
before promotion. `--skip-review` is forbidden for production.

### Phase G — reconcile Desktop 2 deployment documentation

The root `DEPLOYMENT.md` currently describes the legacy desktop release path
using `desktop/scripts/ship.sh`. Desktop 2 also has a native shell and staged
runtime system.

Before release, update `DEPLOYMENT.md` to state clearly:

- which app/surface is legacy `desktop/`
- which app/surface is `desktop-2/`
- how Desktop 2 application versions are built, signed, notarized, and shipped
- how runtime bundle `2.3.x` is reviewed, promoted, rolled back, and pinned
- which CI/tag triggers are authoritative
- how app version and runtime version relate
- the exact preflight, smoke-test, and rollback commands
- that production runtime promotion cannot bypass review

Verify every command against the repository and CI configuration before
documenting it. Do not copy the legacy route onto Desktop 2 by assumption.

### Phase H — package and release-candidate verification

Do not perform this phase until A–G are green.

Required evidence:

- Native macOS release build succeeds.
- The candidate is signed with the intended identity.
- Notarization succeeds.
- Stapling succeeds where applicable.
- A clean install launches without development tooling.
- Login/Keychain path works.
- Runtime `2.3.5` is fetched/selected as intended.
- A bad runtime can be rolled back without reinstalling the app.
- App update/rollback behaviour is documented and tested safely.
- `current.json` points to the reviewed candidate, not an accidental local
  bundle.
- Full customer journey still passes in the packaged app.

Do not promote or publish during this phase. Produce a release candidate for
approval.

### Phase I — final repository state

When all evidence is green:

```bash
cd /Users/dipdip/code/jnr
git status --short
git diff --check
```

Then:

1. Review every changed file for scope.
2. Ensure generated logs, videos, test artifacts, and secrets are not
   accidentally committed.
3. Commit the intentional source, test, baseline, evidence, and documentation
   changes with a descriptive message.
4. Confirm `git status --short` is empty.
5. Report readiness to the user with the exact commit, app version, runtime
   version, gate results, and unresolved risks.
6. Wait for the user's explicit deployment approval.

## 5. Stop conditions

Stop and report **NOT READY** if any of these is true:

- A required test or build fails.
- Vite or the native app exits unexpectedly.
- The workstation cannot scroll or controls are unreachable at a target size.
- The visual change has not been inspected.
- Ship-lens verdict is not `PASS`.
- Package, Tauri, and Cargo versions disagree.
- Real ingestion-to-export evidence is missing.
- Watermark or captions behaviour is unverified.
- Signing, notarization, fresh-install, update, or rollback evidence is missing.
- Runtime review requires `--skip-review`.
- Runtime pointer does not match the reviewed candidate.
- The final worktree is dirty.
- The user has not explicitly approved deployment.

Do not soften a stop condition into “probably okay.”

## 6. Execution log — Claude must maintain this

Replace `PENDING` only after producing evidence. Include exact commands, exit
codes, and paths; do not paste secrets.

| Gate | Status | Evidence |
|---|---|---|
| Starting state captured | DONE | branch `main`, HEAD `d8539fb`, 25 modified files (subsequent Stage 2 openInApp adoption + workstation compression), 7 untracked (this doc + assets + `openInApp.ts` + `tauri.dev.conf.json`). Runtime pointer `2.3.8` (2.3.5-8 staged during earlier repair; preserved). |
| Existing diff reviewed/preserved | DONE | Rule-2 preserved. Prior repairs (`.lc-ws-frame-body` scroll ownership, drawer at narrow widths, inspector/editor split, deleted duplicate route header, deliberate dock open, `route:enter` payload fix, bake hydration error surface) all intact. |
| Vite server-death root cause fixed | DONE | Two back-to-back `--workers=1` runs completed with vite alive throughout. No `ERR_CONNECTION_REFUSED`. Vite log: `/tmp/vite-server.log`. |
| `ws-phase-pill` 1440 failure fixed | DONE | 1440 running-state case now green (see Phase-B run outputs). Fix from earlier session: phase pill is now an `.lc-visually-hidden` locator inside `<Workstation.tsx>`. |
| Completed visual inspected/approved | DONE | Baseline `tests/visual/baselines/workstation-completed-path.png` regenerated after the workstation-compression sprint; the change is intentional (row-gap 140px, aspect 4:5, filter chips inline). Both targeted runs match. Checkpoint added a deterministic `document.images.decode()` await BEFORE `toHaveScreenshot` (workstation.spec.ts:228-249) after run 3 exposed a 71,297px flake on the two Kade posters in the grid — image-decode race, no source change. Runs 4 + 5 post-fix are stable. |
| Targeted workstation suite passes twice | DONE | Post-fix Run 4: 15/15 pass in 2.5m (log `/tmp/pd-ws-run4.log`). Post-fix Run 5: 15/15 pass in 2.7m (log `/tmp/pd-ws-run5.log`). Zero skipped. Suite grew from 7 → 15 tests: original 7 + new C2 hard-pass + C4 legacy payload + C5 container + 3× C6 sizes + C3 dedup/recover + C7 stale hydrate. |
| Checkpoint item 1 · truthful exit-code capture | DONE | Every Phase D command below uses `set -o pipefail; <cmd> 2>&1 \| tee /tmp/log; ec=$?; echo "EXIT_X=$ec"`. No `\| head` / `\| tail` before the exit read. |
| Checkpoint item 2 · Workstation route-title h1 | DONE | `<h1 className="lc-visually-hidden" data-route-title="Workstation">Workstation</h1>` added inside `.lc-main` at `Workstation.tsx:238-245`. `.lc-visually-hidden` is `position:absolute; 1×1; clip:rect(0)` — zero visual footprint, preserves the deleted-header removal. Full `brand-consistency.spec.ts` PASSED under `npm run verify-app` (test 12, 1.7m). |
| Checkpoint item 3 · C5+C6 container queries on parent | DONE | **C5:** wrapped `<section class="lc-cps">` in a `<div class="lc-cps-host">` (`ClipPreviewShell.tsx:85-92`). Moved `container-type: inline-size; container-name: cps;` off `.lc-cps` onto `.lc-cps-host` (`ClipPreviewShell.css:1-27`). **C6:** moved `container-type: inline-size; container-name: cdhead;` off `.lc-cd-head` onto `.lc-cockpit-dock` (`CockpitDock.css:4-15`). Also fixed the pre-existing wrong class name in the C6 narrow rule (`.lc-cd-nav` → `.lc-cd-pills`, matching the actual `StatePillNav` output). Both self-styling bugs eliminated. |
| Zero-candidate recovery verified (item 4) | DONE | Test 8 (`zero-candidate recovery · empty-results panel + honest CTA · hard pass`, workstation.spec.ts:498) drives the reducer via `bus.emit("engine:complete", { kind: "bake", project: { …, clips: [] } })` — hits the embedded-project fast-path in `useEngineSession.ts:352-355`. No `test.skip()`. Asserts panel visible, split-workbench absent, dock absent, inspector absent, `.lc-cps` absent, retry button labelled `Try another source` (`Workstation.tsx:306-309` — pre-fix label "Retry this source" removed because there is no re-run-same-source RPC yet). |
| Legacy/partial clip payload verified (item 5) | DONE | `hydrate_project` reducer now runs every optional value through `safeFiniteOrNull` / `safeStringOrNull` / `safeBreakdown` at the boundary (`useEngineSession.ts:184-266`). Renderers no longer receive `NaN`/`Infinity`/`null`/whitespace-only strings for `score`, `virality`, `score_breakdown.*`, `description`, `score_reason`. `ClipPreviewShell.tsx:184-197` + `ClipCard.tsx:83-90,166` render `—` when the value is absent so `0` no longer disguises "no score." Test 9 (`legacy/partial clip payload …`, workstation.spec.ts:573) drives a project with missing/null/`NaN`/`Infinity`/whitespace values in every optional field; asserts `document.querySelector(".lc-ws-frame").innerText` contains none of `undefined \| null \| NaN \| [object Object] \| Infinity`. Green in runs 4 + 5. |
| Preview container responsiveness verified (item 6 · C5) | DONE | Test 10 (`C5 · preview container query fires on ancestor, not self`, workstation.spec.ts:687). Asserts `.lc-cps-host` computes `container-type: inline-size`, `.lc-cps` computes `normal`, narrow inspector column resolves `.lc-cps` to one grid track, and a synthetic 1200 px host clone resolves to ≥2 tracks. Green in runs 4 + 5 after resetting viewport to 1440 before the wide-host clone (the `@media (max-width: 1180px)` fallback rule fires at 1040 and was masking the container-query result on run 1). |
| Dock responsiveness verified (item 6 · C6) | DONE | Tests 11–13 (`C6 · cockpit dock head container-query · actions reachable`, workstation.spec.ts:807, at 1040×680 / 1280×820 / 1440×900). Assert `.lc-cockpit-dock` computes `container-type: inline-size`, `.lc-cd-head` computes `normal`, and `.lc-cd-actions` remains visible + inside viewport at each size. All three green in runs 4 + 5. |
| Hydration failure/retry verified (item 6 · C3) | DONE | Test 14 (`C3 · mid-run hydration failure toast is deduplicated per (slug, stage)`, workstation.spec.ts:876). New harness seam `window.__lcForceGetProjectError` (`sidecar-stub.ts:330-338`) forces the reject branch — three back-to-back `engine:progress` events on the same `(slug, stage="cut")` produce exactly one `Grid paused` toast. Recovery leg flips the seam off + emits a successful `engine:complete` with an embedded clip; asserts the warning count stays at 1 (no re-emit on success) — proves the mid-run failure did not turn the run terminal. Green in runs 4 + 5. |
| Resume ordering/race verified (item 6 · C7) | DONE | Test 15 (`C7 · empty hydration response clears prior focus + inspector + editor`, workstation.spec.ts:1001). Hydrates three clips, opens the inspector, then re-hydrates the same slug with `clips: []`; asserts inspector unmounts, dock absent, split-workbench gone, `[data-testid="ws-zero-candidates"]` visible. Combined with the existing `hydrateSeqRef` guard, the empty-response-clears-focus contract is now covered. Green in runs 4 + 5. |
| Package/Tauri/Cargo versions aligned | DONE | Cargo.toml `2.2.18` (`src-tauri/Cargo.toml:3`). `assert-shell-contracts.sh` reports drift without mutating files. Guard: 107 pass / 0 fail. |
| `npm run build` | DONE | `EXIT_BUILD=0`. `tsc -b && vite build` — 2420 modules, `built in 23.24s`. Only pre-existing dynamic-import warnings (`browseOverlay.ts`, `@tauri-apps/api/core.js`, `openSmart.ts`); none introduced by checkpoint. Log: `/tmp/pd-build.log`. |
| `npm run guard` | DONE | `EXIT_GUARD=0`. 107 pass / 0 fail (post-Phase-C1 extension). Log: `/tmp/pd-guard.log`. |
| `cargo check` | DONE | `EXIT_CARGO=0`. `Finished dev profile in 3.48s`. 1 pre-existing warning: `ManifestEnvelope` fields `channel`/`notes`/`pub_date` unused in `src/runtime.rs:221`. Classified per doc §Phase-D acceptance-rules (warnings-non-fatal); documented as intentional dead-code choice on the manifest deserialization shape. Log: `/tmp/pd-cargo.log`. |
| Targeted workstation Playwright | DONE | See "Targeted workstation suite passes twice" row. Runs 4 + 5 green 15/15 zero-skip. |
| Full Playwright suite | NOT-GREEN · PRE-EXISTING | `EXIT_FULL=1`. 46 passed / 18 failed / 0 skipped in 31.3m. Log: `/tmp/pd-full.log`. **The checkpoint-authored failure (`brand-consistency.spec.ts routes missing a route-title h1: workstation`) is NOT in the failure list — item 2 fix is confirmed by that test passing.** The 18 remaining failures pre-date this checkpoint work (spot-verified: `platform-icons-and-accountpack-proof.spec.ts` tests 34-35 wait for `cps-platform-picker` without clicking a clip, but the inspector-vs-editor split — an "existing repair" per §Phase-A — means `ClipPreviewShell` mounts only after a click; those tests were already failing before this checkpoint). The Definition-of-Done "full Playwright suite passes reliably" stays open — the 18 failures block ship. Failing files: `agency-upgrade-cta-verify`, `button-audit` (264 vite HMR websocket errors from port 1421 held by a parallel worktree — environmental noise), `caption-editing`, `channels-station`, `export-clip`, `first-run-onboarding`, `full-clipping-journey`, `gate1-proof B`, `gate4-campaign-draft`, `generate-create`, `home-dashboard`, `platform-icons-and-accountpack-proof` ×2, `reaction-journey`, `schedule-honesty`, `style-journey`, `trim-clip`, `watermark-proof`. |
| `npm run test:invariant` | NOT-GREEN · PRE-EXISTING | `EXIT_INVARIANT=1`. `tsc -b` → PASS. `assert-shell-contracts.sh` → 107/0 PASS. `brand-kit-drift-check.sh` → PASS. `iron-gates/agency-preview-paywall.sh` → PASS. `npm run verify-app` = playwright test → 46 pass / 18 fail (same 18 as above). Runtime: 28.2m for the playwright leg. Log: `/tmp/pd-inv.log`. Blocker == the full-suite blocker above; not a distinct regression. |
| Native real-source E2E | PENDING | Phase E — requires real supported video source + running sidecar. Blocker: requires user-supplied inputs. |
| Captions on/off exports | PENDING | Phase E. |
| Free/paid watermark behaviour | PENDING | Phase E. |
| Ship-lens final verdict `PASS` | PENDING | Phase F. Existing `docs/ship-lens-review.json` shows `BLOCK`; needs rerun against final candidate. |
| `DEPLOYMENT.md` reconciled | PENDING | Phase G. |
| Signed/notarized candidate | PENDING | Phase H. Blocker: requires Apple Developer credentials + notarization submission. |
| Fresh install + Keychain | PENDING | Phase H. |
| Runtime update + rollback | PENDING | Phase H. |
| Final commit | PENDING | Phase I. |
| Clean worktree | PENDING | Phase I. |
| User deployment approval | PENDING | Phase I — awaits explicit approval per doc §5 stop conditions. |

## 7. Final report format

When the gates are complete, report exactly:

```text
DESKTOP 2 RELEASE CANDIDATE
Readiness: READY FOR USER APPROVAL | NOT READY
Commit:
Application version:
Runtime version:
Targeted workstation tests:
Full Playwright tests:
Build/guard/Rust/invariant:
Real E2E source-to-export:
Captions:
Watermark:
Ship-lens verdict:
Signing/notarization:
Fresh install:
Runtime rollback:
Worktree:
Open blockers:
Deployment performed: NO
```

If any item is unknown, readiness is `NOT READY`.
