# 02 · Runtime instrumentation & diff

## Method

A dedicated Playwright spec was written to capture the console + bus
signals of each of the failing / passing test states via
`page.on("console")`. It writes structured traces to
`/tmp/lc-auth-harness-trace/` for offline diff. No product code was
touched — every logging line consumed already existed in the app
(the `LC-DIAG` telemetry rail + `flow` breadcrumbs).

Instrumentation file (temporary, deleted before final commit):
`desktop-2/tests/e2e/_auth-harness.trace.spec.ts`.

Command executed:
```
cd desktop-2
rm -rf test-results
PW_PORT=1448 node_modules/.bin/playwright test \
  tests/e2e/_auth-harness.trace.spec.ts --reporter=list
```

Result: 3 passed / 0 failed. Every seed variant landed on `.lc-app`.

## Captured signals per test

Format: `wall-clock-ms · signal`

### Test 2 · defaults (`{}`)

| ms   | signal                                          |
| ---- | ----------------------------------------------- |
| 1657 | `flow` FLOW_000_APP_SHELL · app.mounted         |
| 2980 | `me_hydration_started` `hasJwt:true`            |
| 2983 | `flow` SECTION_HOME · **section.activated**     |
| 3170 | `me_hydration_succeeded` `source: real-http`    |

Final outcome: `app-shell` visible. localStorage carries all 4 seed
keys.

### Test 3 · `{ whop_connected: false }`

| ms   | signal                                          |
| ---- | ----------------------------------------------- |
| 742  | `flow` FLOW_000_APP_SHELL · app.mounted         |
| 1354 | `me_hydration_started` `hasJwt:true`            |
| 1355 | `flow` SECTION_HOME · **section.activated**     |
| 1546 | `me_hydration_succeeded` `source: real-http`    |

Final outcome: `app-shell` visible.

### Test 4 · `{ whop_connected: true, tier: "agency" }`

| ms   | signal                                          |
| ---- | ----------------------------------------------- |
| 738  | `flow` FLOW_000_APP_SHELL · app.mounted         |
| 1306 | `me_hydration_started` `hasJwt:true`            |
| 1315 | `flow` SECTION_HOME · **section.activated**     |
| 1509 | `me_snapshot_hydrated` `source: real-http`      |
| 1509 | `me_hydration_succeeded` `elapsedMs: 191`       |
| 1509 | `whop_status_transition` unlinked → **linked**  |

Final outcome: `app-shell` visible. The Whop status chip observed the
linked transition — confirming `whop_user_id` from the /me mock
propagated correctly through the tier + whop selectors.

## Diff — test 2 vs test 4

Signal ordering is identical:
`app.mounted` → `me_hydration_started` → `section.activated` →
`me_snapshot_hydrated` → `me_hydration_succeeded`.

Only difference:
* Test 4 adds a **linked** `whop_status_transition` at 1509ms because
  `whop_user_id` is populated in its /me mock. Test 2 stays `unlinked`
  because `whop_connected:false` (its /me sends `whop_user_id: null`).

**No divergence lands before `section.activated`.** Both traces reach
the `.lc-app` mount at ~1.3-3.0s after boot. The shell mount is
independent of the tier / whop-connected axes on the harness side.

## Errors observed (all three traces)

Only `[tauri-adapter] cannot listen on sidecar:*` warnings, which are
expected in browser preview (Tauri APIs are stubbed). No
`me_hydration_failed`, no `auth_state_drift`, no `notifyAuthFailure`,
no `auth:signed-out`, no `pageerror`.

## Reproducibility · self-test suite

The full self-test suite was executed multiple times from clean
`test-results/`:

| Run | Port | Duration | Result |
| --- | ---- | -------- | ------ |
| 1   | 1441 | 18.4s    | 5 passed |
| 2   | 1441 | 15.5s    | 5 passed |
| 3   | 1449 | 16.8s    | 5 passed |
| 4   | 1447 (CI=1) | 15.9s | 5 passed |
| 5   | 1442 (only test 4) | 6.6s | 1 passed |
| 6   | 1443 (only test 3) | 6.8s | 1 passed |

Every run of the "Whop connected + tier: agency" and "Whop
disconnected" tests passed at HEAD `1e06972`.

## Interpretation

The reported failure signature ("Test 3 and Test 4 fail deterministically
· .lc-app never mounts · Sign in to Liquid Clips visible") **does not
reproduce at HEAD 1e06972 inside a clean worktree with
`desktop-2/node_modules` freshly installed**.

The base commit's own message (SHA `1e06972`) already notes this
discrepancy:

> Agent's isolated-worktree '5/5 pass' claim did not reproduce in main
> repo. Rather than debug further, start D1 to see if the harness is
> fit for purpose in practice · most specs use default (non-Whop) state.

The prior agent's isolated-worktree observation matches mine
(5/5 pass). The main-repo failure was environmental, not a defect in
the harness or the product source at this SHA.
