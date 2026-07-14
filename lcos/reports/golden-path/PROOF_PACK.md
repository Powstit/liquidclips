# LCOS · Live Golden Path Proof · PROOF_PACK

**Date:** 2026-07-12
**Branch:** `integration/cold-entry-mode-b` @ `3b094b21` (post-Wave-1)
**Backend:** `http://localhost:8000` · uvicorn · SQLite dev DB freshly wiped before walk
**Frontend:** `http://localhost:5173` · Vite dev (`import.meta.env.DEV=true` · probe active)
**Runner:** Playwright chromium via `desktop-2/tests/golden-path/walk.spec.ts`

This is a **verification exercise**, not a Wave. No push, no deploy, no promotion.

---

## 0 · Environment status

| Component | Status | Evidence |
|---|---|---|
| Backend `/healthcheck` | 200 OK | `{"status":"ok", "service":"junior-backend", "version":"0.1.0"}` |
| Backend `/desktop/connect` (internal-secret path) | 200 OK · 1008-char Ed25519 JWT issued | manual curl + walk repeated 8 times, always succeeded |
| Vite dev on :5173 | 200 OK · HMR live | `/tmp/lcos-golden-path-frontend.log` |
| Playwright chromium | v1228 installed | ran 11 tests · 0 failures |
| Dev-only probe `window.__LCOS_PROBE__` | live under DEV | `desktop-2/src/main.tsx` §LCOS Golden Path Proof block |
| SQLite dev DB fresh state | wiped before walk | 4 files removed pre-boot |

Stop conditions: none triggered.

---

## 1 · Deliverables · files created this session

| Path | Purpose |
|---|---|
| `desktop-2/src/main.tsx` (edit) | Dev-only `window.__LCOS_PROBE__` + telemetry ring-buffer under `import.meta.env.DEV` gate. READ-ONLY exposure — INV-008 compliant. |
| `desktop-2/tests/golden-path/walk.spec.ts` | 11 test blocks · 15 journeys covered (11 simulatable · 4 NATIVE_REQUIRED skipped). |
| `desktop-2/tests/golden-path/playwright.config.ts` | Isolated config that reuses external Vite (5173), doesn't clash with existing `playwright.config.ts`. |
| `lcos/reports/golden-path/capture/<journey>/<step>/*` | Per-step evidence · 11 journeys · 12 total steps · each has: screenshot.png · canonical-state.json · telemetry.json · assertions.json · backend.log.tail |
| `lcos/reports/golden-path/verdicts/j001-identity-ladder-stuck-pending.md` | Doctor Lite verdict on stuck-hydration finding |
| `lcos/reports/golden-path/verdicts/j008-wallet-nojwt-with-jwt-present.md` | Doctor Lite verdict on cross-route drift finding |
| `lcos/reports/golden-path/verdicts/j010-referral-affordance-missing-testid.md` | Doctor Lite verdict on referral coverage gap |
| `lcos/reports/golden-path/PROOF_PACK.md` | This file |

**Uncommitted.** Nothing pushed, nothing tagged, nothing built.

---

## 2 · Journey-by-journey walk verdict

| # | Journey ID | Simulatable? | Result | Capture path |
|---|---|---|---|---|
| 1 | j000-first-launch | true | **PASS** · app boots without white-screen or boot-error boundary | `capture/j000-first-launch/01-fresh-boot/` |
| 2 | j001-fresh-user-otp-identity | true | **PASS (weak)** · body does not say "Guest" but identity-kind = `"pending"` (not in documented ladder set) after 5s | `capture/j001-fresh-user-otp-identity/01-post-mint-hydration/` |
| 3 | j004-connect-whop | false | **NATIVE_REQUIRED** · Whop OAuth external browser | skipped |
| 4 | j001-station.identity.claim-handle | true | **PASS** · `POST /me/lc-id/claim` writes handle · `/me` returns `handle: "lcos079224"` | `capture/j001-station.identity.claim-handle/01-claim-handle/` |
| 5 | j005-upload | partial | **PASS (partial)** · empty-state UI mounts · native picker skipped | `capture/j005-upload/01-empty-upload-ui/` |
| 6 | j006-clip-generation | false | **NATIVE_REQUIRED** · Python sidecar + OpenAI + real video | skipped |
| 7 | j007-publish | false | **NATIVE_REQUIRED** · Ayrshare Profile Key + real social account | skipped |
| 8 | j008-wallet | true | **PASS (weak)** · `/me/affiliate` 200 · no fake money literals · BUT `data-identity-state="noJwt"` while `localStorage.hasJwt=true` | `capture/j008-wallet/01-wallet-fresh/` |
| 9 | j009-affiliate | true | **PASS** · earn route mounts · no boot error | `capture/j009-affiliate/01-earn-fresh/` |
| 10 | j010-referral | true | **WEAK-FAIL** · referral affordance not surfaced with stable test seam · assertion `referral-affordance-present` = false | `capture/j010-referral/01-referral-affordance/` |
| 11 | j011-payout | partial | **PASS (partial)** · withdraw button not visible on empty wallet · INV-004 upheld by absence | `capture/j011-payout/01-withdraw-gate/` |
| 12 | j012-cancellation | true | **PASS** · `/#/cancel` route mounts | `capture/j012-cancellation/01-cancel-mount/` |
| 13 | j013-restart | partial | **PASS** · hard reload preserves JWT in localStorage | `capture/j013-restart/02-after-reload/` |
| 14 | j014-resume | true | **PASS (weak)** · not-Guest holds · identity-kind stays "pending" post-reload (same signal as j001) | `capture/j014-resume/01-resume-identity/` |
| 15 | j015-update | false | **NATIVE_REQUIRED** · Tauri updater native | skipped |

**Totals:** 11 walked (11 test blocks PASSED at the Playwright level) · 4 NATIVE_REQUIRED · 0 walk-time exceptions.
Test-level PASS count is misleading — 3 of the passes surface architectural findings the tests were too permissive to fail on. Those are the WEAK-* rows above.

---

## 3 · Failures grouped by Bug Class

Zero hard-fail assertions. Three WEAK findings that map to existing bug classes:

### BC-002 · Multi-source-of-truth · **Finding A: Identity ladder stuck at "pending"**

- **Journeys affected:** j001, j013, j014
- **Symptom:** After JWT seed → reload, `data-identity-kind = "pending"` and `data-identity-copy = "Signing in…"` persist for the entire observation window (5–15s). The documented ladder taxonomy in `useMe.ts:65-83` names only `{handle, lc-id, email-local, signing-in, complete-profile}` — `"pending"` is a runtime-only value that the docs don't disclose.
- **Root cause suspect (MEDIUM confidence):** `TopHud.tsx:257` emits `kind: "pending"` when `hasJwt && !hydrated`. `useMe.ts` hydration transitions from `source="unknown"` → `source="real-http"` should fire `me_snapshot_hydrated` (line 127). Either the fetch never fired (browser bundle / CORS?), or the render didn't repaint. The empty telemetry buffer prevents a definitive attribution — see gap in §5.
- **Permanent architectural fix pattern (from `lcos/12_BUG_CLASSES.md` BC-002):** one canonical hook per axis · consumers read via subscription · no divergent implementations of the same axis. Needed extension: enforce INV-011 transition proof — every write to `me.source` must emit `me_snapshot_hydrated` OR fire a bounded-time `me_hydration_stalled` (currently absent).
- **Verdict:** `verdicts/j001-identity-ladder-stuck-pending.md`

### BC-001 · Multi-writer state · **Finding B: cross-route entry sees "noJwt" while localStorage has JWT**

- **Journeys affected:** j005, j008, j010, j011, j012
- **Symptom:** Any route reached via `page.goto("/#/route")` after `localStorage.setItem` (no reload) renders TopHud with `data-identity-state="noJwt"` + copy `"Start free · 10 clips"` — the signed-out marketing pitch — while localStorage carries a valid 1008-char JWT.
- **Root cause (HIGH confidence on mechanism):** `useAuth.ts:80-96` documents "same-tab storage-events don't fire; the bus events are the only in-tab notifier." Playwright's `page.evaluate(() => localStorage.setItem(…))` is a raw write that bypasses `setJwt()`, so `bus.emit("auth:signed-in")` never fires, and `cachedHasJwt` stays stale until either a reload or a `setJwt()` call.
- **Customer-path impact:** likely NONE — the canonical writer chain is `/desktop/connect` → activation.ts → `setJwt()`. Real customers never write raw storage. This is a **test-artifact expression** of the multi-writer class, not a customer-facing bug.
- **BUT** the LCOS knowledge gap it exposes IS real: no canonical dev-only `window.__lcosSetJwt` seam exists, so every future walk that seeds identity must either fully reload or silently drift.
- **Permanent architectural fix pattern (BC-001):** extract the canonical writer function; every entry point delegates to it; deprecate and retire duplicates, do not synchronise them (DECISION-0009). Applied to identity-claim already (`service.identity_claim.claim_handle`) — apply the same pattern to a dev-only JWT seed function.
- **Verdict:** `verdicts/j008-wallet-nojwt-with-jwt-present.md`

### BC-004 · Business journey with no canonical owner · **Finding C: referral affordance not test-seamable**

- **Journeys affected:** j010
- **Symptom:** WalletDetail.tsx:873 contains the referral link + QR block ("R3 2026-07-11"), but no `[data-referral-link]` selector exists for a walk to assert on.
- **Root cause:** the j010-referral journey has no station chain in `04_JOURNEYS.md` (the README-only stub) and no owning acceptance test. No stable testid seam.
- **Permanent architectural fix pattern (BC-004):** author the journey file at `lcos/04_JOURNEY_BIBLE/j010-referral.md` with owning capability, station chain (mount → link-visible → copy-clicked → QR-shared → OS-share-fired), expected telemetry per station, acceptance test IDs. Add `data-referral-link`/`data-referral-qr` to WalletDetail R3 block.
- **Verdict:** `verdicts/j010-referral-affordance-missing-testid.md`

---

## 4 · Per-failure question rollup (10-question matrix)

| Question | Finding A (identity stuck) | Finding B (cross-route noJwt) | Finding C (referral seam) |
|---|---|---|---|
| Q1 · Invariant violated | INV-010 (kind not in documented set) · INV-011 (transition proof missing) | INV-010 (cross-route drift) | INV-009 (journey without owner) |
| Q2 · Which capability degraded | identity-trust (M3) | identity-trust (M3), affiliate-revenue (M2) | affiliate-revenue (M2) |
| Q3 · Which canonical state drifted | state.current-user.identity-kind | state.authenticated vs state.current-user.identity-state | state.affiliate-code (unregistered) |
| Q4 · Doctor Lite detect? | partial (surfaced, MED confidence) | yes | yes (gap-flag) |
| Q5 · Telemetry detect? | intended to (me_snapshot_hydrated) but buffer empty · attribution gap | no · no `auth_state_drift_observed` topic exists | no · no referral topic exists |
| Q6 · Existing test detect? | no · existing tests check source strings, not runtime attrs | no · useAuth.test.ts covers canonical writer, not raw-storage drift | no · no j010 test authored |
| Q7 · Sibling bugs by root cause | BUG-002 (Guest·Admin closed) | BUG-002 (same class, different manifestation) | none (coverage gap) |
| Q8 · Permanent architectural fix (from `12_BUG_CLASSES.md`) | BC-002 pattern + INV-011 hydration-transition proof | BC-001 pattern + dev-only canonical seed seam | BC-004 pattern — author journey + telemetry + acceptance test |
| Q9 · Dependency graph node (from `graph/dependency.md`) | `hook.useMe.identityLadder` → `component.TopHud` · covered in Wave-1 delta | `hook.useAuth` → `component.TopHud` · covered | `component.WalletDetail.referral-block` · out of Wave-1 delta · gap flag |
| Q10 · Additional LCOS knowledge needed | INV-010 runtime DOM scanner (not just AST) · me-source-transition telemetry as INV-011 proof | dev-only canonical seed function + `auth_state_drift_observed` topic | j010-referral journey file · WalletDetail test seams |

---

## 5 · Doctor Lite refuse-rate + gaps

**Doctor Lite refused 4 sub-queries this run** because the answer was not in the graph:

1. **gap:telemetry-cannot-distinguish-fetch-never-fired-from-wrapper-race** — the __LCOS_TELEMETRY__ buffer was empty on every capture. Two hypotheses (fetch never fired · probe-wrap timing race with lcDiag module import) both fit. Doctor Lite refused a definitive root cause; downgraded confidence on Finding A from HIGH to MEDIUM.
2. **gap:journey-not-authored-j010-j011-j015** — no station chain exists for referral/payout/update. Doctor Lite could not fingerprint sibling telemetry topics per INV-009.
3. **gap:runtime-dom-invariant-scanner-absent** — INV-010 verifier is AST-only; no scanner yet compares `[data-identity-state]` across mounted TopHud instances against `hasJwt` at runtime. Doctor Lite cannot say "cross-route drift is not observable by any existing scanner" with certainty.
4. **gap:backend-log-access-log-suppressed** — the walk ran uvicorn with `--log-level warning`, so `/me` / `/me/affiliate` calls did not appear in the tail. Cannot confirm from log whether the browser bundle called `/me` after reload. Attribution downgrade — should re-run at `--log-level info`.

Total captured steps: **12** (11 tests · 1 has two steps for j013 before/after reload)
Total assertion runs: **34** (per-step assertions.json)
Total invariant citations across captures: **9** (INV-001, INV-002, INV-003, INV-004, INV-005, INV-006, INV-008, INV-010, INV-011)
Doctor Lite refuse-rate: **4 / (4 + 34) = 10.5%** — honestly under-covered given this is the first behavioural walk.

---

## 6 · Class-elimination progress

| Class | Status | This walk's contribution |
|---|---|---|
| BC-001 Multi-writer state | class-elimination-in-progress | Surfaced test-artifact expression on the JWT axis · confirms need for dev-only canonical seed seam (currently missing) |
| BC-002 Multi-source-of-truth | class-elimination-in-progress | Surfaced identity-kind = "pending" runtime value not in documented ladder set · closure of BC-002 for the identity ladder needs INV-011 transition-proof extension |
| BC-003 Developer shortcut in production request path | open | No new instances found in this walk · but backend log suppression prevented deeper audit |
| BC-004 Business journey with no canonical owner | open | Confirmed by Finding C · 3 of 15 journeys walked here have NO station chain (j010 · j011 · j015 also gap-flagged as NATIVE-REQUIRED) |
| BC-005 UI reading divergent stores | open | Finding A + Finding B both suspected instances awaiting runtime-DOM scanner |

---

## 7 · Recommendations · next 3 LCOS actions

1. **Build the runtime-DOM invariant scanner for INV-010.**
   Grep-AST catches source-code divergence; DOM-time catches render-time drift. A minimal implementation: Playwright fixture that walks every top-level route, snapshots `[data-identity-*]` + `localStorage.getItem("lc.license.jwt.v1")`, fails on any inconsistency between the two. This walk's `walk.spec.ts` is the seed — extend it into a permanent gate.

2. **Author the 15 journey files in `lcos/04_JOURNEY_BIBLE/`.**
   Currently a README stub. Every one of the walk's WEAK findings ultimately reduces to BC-004: there's no owner, no station chain, no telemetry expectation, no acceptance test. Fix this class first because everything downstream (Doctor Full certification, INV-011 transition proofs, INV-009 route-to-journey scanner) depends on it existing.

3. **Add a `me_hydration_stalled` telemetry topic + INV-011 extension.**
   Right now `me_snapshot_hydrated` fires on success; nothing fires on stall. That means when Finding A recurs in prod, HQ can't see it. Add a 8s-timeout topic that fires `me_hydration_stalled` with the observed `source` value, and register it in the telemetry topic registry so Doctor Full can require its absence-of-stall as a state-transition proof for the identity ladder.

---

## 8 · Rollup

- **Journeys walked:** 11 · **NATIVE_REQUIRED skipped:** 4
- **Steps captured:** 12
- **Test-level failures:** 0
- **Invariant-level WEAK findings:** 3 (BC-001 · BC-002 · BC-004)
- **Files created uncommitted:** 8 new files + 1 dev-only edit to `desktop-2/src/main.tsx`
- **Doctor Lite refuse-rate:** 10.5% (4 gaps out of 38 queries)
- **Bug ledger writes:** 0 (per rules of engagement — proposed bugs listed above, Daniel decides which to file)

**No push. No deploy. No promotion.** Awaiting Daniel review.
