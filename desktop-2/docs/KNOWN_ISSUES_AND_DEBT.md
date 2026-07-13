# Known Issues & Debt · Liquid Clips Desktop

Every remaining warning, intentional skip, `FIXME`, mocked integration,
incomplete API, deferred refactor, perf concern, test limitation, and
roadmap-only feature. **No hidden debt.** Anything not listed here is
not known to us.

`Dropbox: /Liquid Clips/RC1 Handover/known-issues/`

Baseline commit: `d97c2e71` (2026-07-12 · post-D1 residual close).
Runtime version: `2.2.36`.

---

## 1. Open bugs (from `lcos/09_BUG_LEDGER.md`)

Full detail per bug in the ledger. Enumerated here so nothing hides.

### 1.1 OPEN

| Bug | Symptom | Severity | Files |
|---|---|---|---|
| **BUG-005** | Notifications badge drifts from empty inbox (local-only counter, no backend wire) | P2 | `src/inbox/*`, backend `/notifications` |
| **BUG-012** | Runtime bundle hot-swap requires quit+relaunch (Cmd+R doesn't stick) | P1 · deferred (Daniel Option 3) | `src-tauri/src/runtime.rs` (READ-ONLY, shell frozen) |

BUG-012 is **native** — the fix is one line inside
`runtime.rs::runtime_check_now` (`cache_active_root(&app)` after
`check_and_stage_runtime` returns). Shell freeze blocks it. Runtime-only
mitigation shipped in Train D1 (Codex-style restart-gated update
journey — see `docs/SELF_HEALING_ROADMAP.md`). See ledger
`lcos/09_BUG_LEDGER.md:886-1005` for full root cause.

### 1.2 FIXED_UNPROVEN

Fixes have landed and pass tests; runtime end-to-end walk still owed.

| Bug | Symptom | Category |
|---|---|---|
| **BUG-001** | Campaigns click telemetry not emitting | Observability |
| **BUG-002** | Authenticated user shows "Guest · Admin" in avatar | Identity |
| **BUG-003** | No handle claim path · no LC-ID visible surface | Identity |
| **BUG-004** | "Connect Whop" not visible from all states | Whop |
| **BUG-006** | Version pill shows shell version when runtime bundle is newer | Runtime |
| **BUG-007** | `__APP_VERSION__` hardcoded in Settings, IntroSplash, DiagnosticsSection | Runtime |
| **BUG-008** | `ExportPanel` + `OverlayTemplateGallery` + `ReactionControls` defaulted `userTier="free"` | Tier |
| **BUG-009** | `UpdateBeacon` 404-polled `/runtime/manifest.json` | Runtime |
| **BUG-010** | Learn nav item visibility on cold-boot unverified | Nav |
| **BUG-011** | `text-transform: uppercase` obscures identity pill copy verification | Identity |
| **BUG-013** | "Good evening ✦" static — never personalized | Identity |
| **BUG-014** | Home hero lacks Whop CTA when unconnected | Whop |
| **BUG-015** | Identity hydration stuck at `kind="pending"` · ladder never advances off `Signing in…` | Identity |
| **BUG-016** | Auth writer enforcement gap · `cachedHasJwt` doesn't detect raw localStorage writes | Auth |
| **BUG-017** | Referral journey · no canonical owner · no test seam | Referral |

Each of the above closes when the Doctor pass confirms the fix on a
live cold-boot walk. See `lcos/09_BUG_LEDGER.md` for the "Closes only
when" contract per bug.

---

## 2. Playwright skips (32 total, all documented)

Total intentional skip count from live grep on
`desktop-2/tests/**/*.spec.ts`: **44 raw hits** (some are the
description of the skip block, some are the block itself). Reported
count of test-level skips in the D1 cert:
`lcos/reports/rc1-sprint/AUTOMATED_RELEASE_STATE.md:66` — **32 skips**.

### 2.1 NATIVE (~24 skips)

Cannot run in Vite-dev — Tauri shell, sidecar, real API keys, macOS URL
schemes, human interaction. Documented in
`desktop-2/tests/native-walk-prep/` (5 specs). Physical walk owned by
Daniel per `lcos/reports/rc1-sprint/P3_WALK_SIGNOFF.md`.

| Spec | Line | Reason |
|---|---|---|
| `golden-path/walk.spec.ts` | 278 | Whop OAuth dance requires external browser + real Whop credentials. Gap doc owed. |
| `golden-path/walk.spec.ts` | 361 | Python sidecar + OpenAI + real video. Not simulatable in Vite dev browser. |
| `golden-path/walk.spec.ts` | 366 | Ayrshare Profile Key + real social account. External OAuth dance. (Ayrshare is a MISTAKE per `feedback_ayrshare_mistake.md` — the walk-around is the persistent-cookie in-app webview.) |
| `golden-path/walk.spec.ts` | 606 | Tauri updater is native. UpdateBeacon polls a native command not available in Vite dev. |
| `native-walk-prep/j004-whop-oauth.spec.ts` | 242, 247, 252, 257 | 4 Whop OAuth steps · native URL scheme + external browser |
| `native-walk-prep/j005-upload.spec.ts` | 223, 228, 233, 238 | 4 upload steps · Tauri plugin-dialog + native file picker |
| `native-walk-prep/j006-clip-generation.spec.ts` | 271, 276, 281, 286 | 4 clip-gen steps · sidecar + OpenAI + real video + real ffmpeg |
| `native-walk-prep/j007-publish.spec.ts` | 269, 274, 279, 284 | 4 publish steps · external + native |
| `native-walk-prep/j015-runtime-update.spec.ts` | 284, 289, 294, 299 | 4 runtime-update steps · Tauri updater + native install |

Each `native-walk-prep` spec ships with a `.md` companion documenting the
physical walk contract (referenced from the spec header comments).

### 2.2 Pre-refactor (~7 skips)

Waiting for wire-up. All are `test.fixme` with the rewrite directive
inline.

| Spec | Line | Reason |
|---|---|---|
| `activation-flow.spec.ts` | 124 | Phase 1 (2026-07-12) · `LoginOnboarding` retired in favour of `SimpleLoginPanel`. Test drove the whole activation state machine off `[data-testid=login-state-*]` pill. Rewrite once SimpleLoginPanel signed-in path has an equivalent end-to-end pill or the deep-link activation flow moves onto SimpleLoginPanel. |
| `clerk-otp-login.spec.ts` | 70 | Clerk panel not rendered — publishable key not set in env. Ambient skip. |
| `earn-affiliate-polish.spec.ts` | 219 | Waiting on `WalletDetail` parity for affiliate widget · `#/earn` now resolves to Section-pipeline WalletDetail; `[data-testid=earn-stage]`, `data-earn-lifetime-earned`, and `lc-affiliate-widget` no longer exist. |
| `earn-affiliate-polish.spec.ts` | 295 | D1 residual · same WalletDetail parity gap · re-author against `wallet-panel` + `wd-root` primitives once Section pipeline exposes an affiliate widget with `data-referral-url`. |
| `earn-station.spec.ts` | 104 | D1 residual · WalletDetail parity gap · money-surface rule 2026-07-10 retired Design-OS `EarnRoute`. Re-author as a WalletDetail-native honest-zeros walk when Section pipeline surfaces an `earn-summary` data-attr set with parity to the retired EarnRoute contract. |
| `file-drop-export.spec.ts` | 44 | Fire `source:drop` → `GlobalDropConsumer` → clips → export. Waiting on rewire. |
| `gate1-proof.spec.ts` | 24 | LoginOnboarding retired; SimpleLoginPanel is the primary signed-out surface and does not render `.sim-h1`. Rewrite against SimpleLoginPanel's h1 (`Sign in to Liquid Clips`) once the visual regression contract is defined. |
| `gate1-proof.spec.ts` | 104 | LoginOnboarding retired; `login-start-button` + `data-activation-status` state machine no longer exists. Rewrite against SimpleLoginPanel's `data-phase=email` → `data-phase=code`. |
| `library-my-clips.spec.ts` | 131 | Library route collapsed into Workstation. `#/library` now aliases via `SimulatorRouter ALIAS_FOR`. Canonical-clips-live-in-Workstation guarantee covered by `full-clipping-journey` + `caption-editing` + `export-clip` specs. |
| `thumbnail-identity.spec.ts` | 50 | Upload photo → identity saved → thumbnails render. Waiting on rewire. |
| `url-clip-export.spec.ts` | 41 | Paste URL → sidecar chain → clips render → MP4 on disk. Waiting on sidecar test seam. |
| `watermark-proof.spec.ts` | 397 | D1 residual · harness `/me` mock defeats the Phase C unknown-tier boot. Needs `seedAuthenticatedShell({ mockMe: false })` opt-out to re-author. |

### 2.3 Ambient (~1 skip)

`clerk-otp-login:70` — skips when `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is
not set in the test environment. Passes when the env is provided.

---

## 3. Vitest skips (1 total)

| Spec | Reason |
|---|---|
| `src/routes/upload/upload.journey.test.ts::j005-upload · station.upload.user_action_pick_file` | Native-only. `@tauri-apps/plugin-dialog::open()` is native. Not a required automated release path — sibling `test-upload-native.ts` covers the native path. Reference: `lcos/reports/rc1-sprint/AUTOMATED_RELEASE_STATE.md:78`. |

---

## 4. Playwright residual failure (1 composite spec)

| Spec | Line | Symptom |
|---|---|---|
| `tests/e2e/button-audit.spec.ts` | 239 | Composite audit — 6 residual controls out of 262+ audited (98.5% reduction from baseline) |

The 6 residuals:

| Surface | Control | Issue |
|---|---|---|
| Home Clipper | My Clips button | Click timeout (4s budget) — race between `nav:click` and Workstation route mount, OR real product bug. Fix estimate: bump the audit's per-click budget to 8s OR investigate the state-machine race. |
| Home Agency | My Clips button | Same as above. |
| Home Agency | kade-minimize control | Click timeout — Kade companion minimize control. Feature regression suspect OR missing click handler. |
| Campaigns Clipper | kade-minimize control | Same as Home Agency. |
| Wallet | wallet-offline-retry | Click has no observable effect. WalletDetail's offline retry doesn't produce a user-visible effect when clicked on the harness's mocked-clean state (the mock returns valid data). Audit-spec logic needs a special-case for retry-on-clean-state controls. |

Console-error inflation to 8991 (from 3630) is a **test-side** issue —
`keepalive: true` on `src/lib/diagnosticLogger.ts:101` prevents
Playwright's `page.route` from intercepting the telemetry POST. Same
limitation documented at `_auth-harness.ts::isHarnessNoiseConsoleError`.
The audit spec's console-error collector doesn't currently apply that
filter — it uses its own separate collector.

All fixes are runtime-only or audit-spec-side. None require
locked-feature removal.

Full detail: `lcos/reports/rc1-sprint/AUTOMATED_RELEASE_STATE.md:94-130`.

---

## 5. TODO / FIXME source markers

Live grep on `desktop-2/src/**`: **17 hits.** Enumerated below by
severity.

### 5.1 Backend contract gaps (MEDIUM)

| Location | TODO |
|---|---|
| `src/routes/wallet-detail/WalletDetail.tsx:380` | Surface these fields on `/me/wallet/summary`. Until then, local placeholders. |
| `src/routes/wallet-detail/WalletDetail.tsx:385` | `activeClipperCount: number \| null = null` — `summary.affiliate_active_count` not surfaced yet |
| `src/routes/wallet-detail/WalletDetail.tsx:394` | `subscriptionCostCents: number \| null = null` — `summary.subscription_cost_usd_cents` not surfaced yet |
| `src/routes/wallet-detail/WalletDetail.tsx:830` | Surface roster count yet (see backend TODO above) |
| `src/routes/wallet-detail/WalletDetail.tsx:1239` | `referral_qr_scan_detected` — best-effort — cannot detect QR scan client-side |
| `src/routes/wallet-detail/money-rollup.test.ts:55` | Regression against pre-Train-C `mrrCents = null` TODO |

**Owner:** backend (`junior-backend/`). Frontend renders honest empty
states while the fields are `null` — per the "no fixture data" rule in
`desktop-2/CLAUDE.md:102-104`.

### 5.2 Phase-9 wire (LOW)

| Location | TODO |
|---|---|
| `src/sections/account/AccountSection.tsx:17` | Phase 9 · when real Whop cancel wire lands, replace `TODO(phase-9)` |
| `src/sections/account/AccountSection.mount5.test.ts:10, 57, 59, 62` | Test regressions ensuring the `TODO(phase-9)` marker survives until the real Whop wire lands |

**Owner:** dev team once Whop cancel API is greenlit. Fixture-parity
test at `AccountSection.mount5.test.ts:62` asserts the marker is
present.

### 5.3 F5 / cross-ref (LOW)

| Location | TODO |
|---|---|
| `src/lib/f5/youtubeCrossRef.ts:4, 32` | Real F7 worker (`POST /yt/batch-lookup`) wire pending |
| `src/lib/f5/googleOAuth.ts:5, 57` | Google OAuth `client_id` env var not set yet — fail loudly if missing |
| `src/lib/f5/scanner.test.ts:191` | Test asserts `misconfigured` state when `client_id` missing |

**Blocked on:** Daniel providing the Google Cloud client ID. The code
already fails loudly (per the auth-safety rule).

### 5.4 Brand (LOW)

| Location | TODO |
|---|---|
| `src/design-os/components/ConsoleNav.css:16` | Drop `/brand/textures/sidebar-glass.webp` when assets ready |

Cosmetic. Falls back to CSS gradient today.

---

## 6. `@ts-expect-error` / `@ts-ignore` (1 total)

| Location | Reason |
|---|---|
| `src/overlays/invaders/InvadersCanvas.tsx:100` | Vendor-prefixed WebKit flag — still respected by Safari/WebKit. Necessary for canvas-blur performance on macOS. |

Justified · scoped · single-line.

---

## 7. Mocked integrations

| Integration | Where | Note |
|---|---|---|
| Notifications inbox (`/notifications`) | `src/inbox/*` | Local-only counter (BUG-005). Backend endpoint not wired. |
| Clerk publishable key | `tests/e2e/clerk-otp-login.spec.ts` | Skipped in envs where the key is absent (ambient skip). |
| Google OAuth client ID | `src/lib/f5/googleOAuth.ts` | Missing env var → `misconfigured` state (fails loudly, tested). |
| Whop cancel API (Phase 9) | `src/sections/account/AccountSection.tsx:17` | Marker in place; wire not yet greenlit. |
| Ayrshare | (removed) | Ayrshare is a **MISTAKE** per `feedback_ayrshare_mistake.md`. Replaced by the persistent-cookie in-app webview walk-around. `assert-shell-contracts.sh:206-222` asserts the walk-around messaging. |
| Postiz | (hidden) | Multi-tenant publisher hosted on Railway. Customers never see "Postiz." See `feedback_postiz_architecture.md`. |
| Test harness `/me` mock | `tests/e2e/_auth-harness.ts` + `_auth-harness.self-test.spec.ts` | Default seed mocks `/me`. Opt-out (`seedAuthenticatedShell({ mockMe: false })`) needed for the Phase C unknown-tier watermark walk — see `watermark-proof.spec.ts:397`. |

---

## 8. Incomplete APIs

| API | Status | Note |
|---|---|---|
| `POST /hq/nodes/intercession` | Scoped, not shipped | Backend consumer of the Watchdog `interceptionBus`. See `docs/PROTOCOL_SELF_HEALING_NODES.md`. |
| `GET /hq/nodes/state` | Scoped, not shipped | HQ health grid consumer. |
| `POST /hq/nodes/{id}/override` | Scoped, not shipped | HQ "Pause Node" + apiKey injection. |
| `POST /me/wallet/summary` (roster count · affiliate active count · subscription cost) | Partial | Fields listed in `WalletDetail.tsx:380-394` return `null` today. |
| `POST /notifications` | Not wired | BUG-005. |
| `/embed/earn` frame-deny check | Live | Middleware at `account-app/src/middleware.ts` — must not deny embed paths. Verified per deploy (`DEPLOYMENT.md:47-65`). |

---

## 9. Deferred refactors

- **Section-pipeline affiliate widget parity with WalletDetail** — blocks
  `earn-affiliate-polish.spec.ts:219, 295` and `earn-station.spec.ts:104`
  from being un-fixme'd. Owner: dev team.
- **SimpleLoginPanel visual regression contract** — blocks
  `gate1-proof.spec.ts:24` from being un-fixme'd. Owner: dev team.
- **SimpleLoginPanel deep-link activation flow** — blocks
  `activation-flow.spec.ts:124` from being un-fixme'd. Owner: dev team +
  product review (auth flow shape).
- **`seedAuthenticatedShell({ mockMe: false })` opt-out** — blocks
  `watermark-proof.spec.ts:397`. Small harness change. Owner: dev team.
- **`GlobalDropConsumer` test seam** — blocks
  `file-drop-export.spec.ts:44`. Owner: dev team.
- **URL-clip sidecar test seam** — blocks `url-clip-export.spec.ts:41`.
  Owner: dev team once sidecar exposes a deterministic test hook.

---

## 10. Perf concerns

- **BUG-001** — Campaigns click telemetry (`nav_click_performance`) not
  emitting on cold-boot. Ledger `lcos/09_BUG_LEDGER.md:1071`. Related
  to BUG-006 + BUG-012. FIXED_UNPROVEN — waiting for the Doctor
  end-to-end proof.
- **BUG-010** — Learn nav item visibility on cold-boot unverified.
  Ledger `lcos/09_BUG_LEDGER.md:1008`. FIXED_UNPROVEN.
- **Main bundle 1,060 kB** (gzip 327 kB) — Vite build warning-only.
  Reference: `lcos/reports/rc1-sprint/RC1_FINAL_PROOF_PACK.md:39`. Chunk
  split candidates: brand assets, invader game, workstation editor.
- **D1 sweep run-time 34.7 min** — 169 tests. Vite dev cold-compile
  adds 10-30s on first hit per test. See
  `desktop-2/playwright.config.ts:24-32`.
- **Perf contract** (mandatory for new code, per
  `desktop-2/CLAUDE.md:98-101`) — static posters · no `backdrop-filter:
  blur()` in new code · no infinite CSS animations · transitions ≤100ms
  · transform / opacity only · `contain: layout paint style` where safe
  · no polling · no route-level remounts.
- **Console-error inflation** in `button-audit` (see §4) — 8991
  telemetry POSTs that Playwright cannot intercept due to
  `keepalive: true` in `diagnosticLogger.ts:101`. Test-side fix by
  extending the audit's console-error filter.

---

## 11. Test limitations

- Playwright drives Vite dev, not the Tauri webview. Production Tauri
  APIs (plugin-fs, convertFileSrc, etc.) are runtime-detected in app
  code and degrade to web equivalents for the test. See
  `desktop-2/playwright.config.ts:2-9`.
- Native paths (Tauri shell, sidecar, real API keys, macOS URL schemes,
  human interaction) cannot run in Playwright — hence the 24 native
  skips. Physical walk owned by Daniel per
  `lcos/reports/rc1-sprint/P3_WALK_SIGNOFF.md`.
- Vitest runs in jsdom — DOM-level tests only; no route-level nav.
- Backend Pytest is not applicable to `desktop-2` — the desktop has no
  Python. `junior-backend` is shell-frozen and out of scope for the
  desktop-2 test run.

---

## 12. Roadmap-only features (not shipped)

Clearly enumerated so they don't appear as "done":

- **Node health backend + HQ dashboard** — see
  `docs/SELF_HEALING_ROADMAP.md` Phase 1.
- **Safe auto-repair** — see `docs/SELF_HEALING_ROADMAP.md` Phase 2.
- **Proactive prevention** — see `docs/SELF_HEALING_ROADMAP.md` Phase 3.
- **All extension points** — see `docs/SELF_EXTENDING_ROADMAP.md`.
- **Instant-upgrade "Post one like this →" carrot** on Whop bounty
  cards — see `liquid_clips_upgrade_carrot_2026-07-07.md`. Ships after
  the round-trip primitive is green.
- **Agency Earn-tab writes** (POST bounties) — see
  `liquid_clips_1dollar_in_app_2026-07-07.md`.

---

## 13. Locked product decisions the team must not change

Every one of these fails ship-lens if edited without Daniel's approval.
See `docs/OWNERSHIP_AND_ESCALATION.md` for escalation.

- **Agency-only pricing** ($0 / $99.99/mo) — see
  `liquid_clips_pricing_pivot_2026-07-06.md`.
- **Ayrshare is a MISTAKE** — walk-around is the persistent-cookie
  in-app webview. See `feedback_ayrshare_mistake.md`.
- **Money-surface rule** — money surfaces need approved HTML mockup +
  founder video + 3+ explicit states. See `desktop-2/CLAUDE.md:10-35`.
- **Whop primary, Clerk fallback** — see
  `liquid_clips_whop_lead_decision.md`.
- **Fallback resilience scoped to Wallet only** — see
  `desktop-2/CLAUDE.md:54-71`.
- **Voice: no "bounty," use "skill / clip job / paid post"** — see
  `feedback_voice_no_bounty_use_skill.md`.

---

## References

- `lcos/09_BUG_LEDGER.md` — canonical bug ledger (Anthropic never
  closes a bug · only proof closes a bug)
- `lcos/reports/rc1-sprint/AUTOMATED_RELEASE_STATE.md` — most recent
  cert
- `lcos/reports/rc1-sprint/RC1_FINAL_PROOF_PACK.md` — sprint receipt
- `desktop-2/CLAUDE.md` — shell freeze · money-surface rule · perf
  contract
- `desktop-2/playwright.config.ts` — Playwright config
- `desktop-2/tests/native-walk-prep/` — 5 native-required specs +
  companion physical walk docs
- `desktop-2/docs/PROTOCOL_SELF_HEALING_NODES.md` — Sovereign Operator
  architecture
- `docs/TEST_AND_RELEASE_RUNBOOK.md` — how to run the gates
- `docs/OWNERSHIP_AND_ESCALATION.md` — who owns what
- `[Known-issues walkthrough video](dropbox:///Liquid%20Clips/RC1%20Handover/known-issues/walkthrough.mp4)` — `TODO: Daniel · generate Dropbox share link for known-issues walkthrough video`

## Verification checklist

Files inspected while writing this doc:

- [x] `/Users/dipdip/code/jnr/lcos/09_BUG_LEDGER.md` (18 bugs, statuses, root causes)
- [x] `/Users/dipdip/code/jnr/lcos/reports/rc1-sprint/AUTOMATED_RELEASE_STATE.md` (32 skips + 1 residual detail)
- [x] `/Users/dipdip/code/jnr/lcos/reports/rc1-sprint/RC1_FINAL_PROOF_PACK.md` (baseline + skip counts)
- [x] `/Users/dipdip/code/jnr/desktop-2/tests/e2e/*.spec.ts` (skip / fixme grep)
- [x] `/Users/dipdip/code/jnr/desktop-2/tests/native-walk-prep/*.spec.ts` (24 native skips)
- [x] `/Users/dipdip/code/jnr/desktop-2/tests/golden-path/walk.spec.ts` (4 native skips)
- [x] `/Users/dipdip/code/jnr/desktop-2/src/**/*.tsx` and `*.ts` (TODO / FIXME grep · 17 hits)
- [x] `/Users/dipdip/code/jnr/desktop-2/src/routes/wallet-detail/WalletDetail.tsx` (6 TODO lines)
- [x] `/Users/dipdip/code/jnr/desktop-2/src/sections/account/AccountSection.tsx` (Phase-9 marker)
- [x] `/Users/dipdip/code/jnr/desktop-2/src/lib/f5/googleOAuth.ts` and `youtubeCrossRef.ts` (F5 TODOs)
- [x] `/Users/dipdip/code/jnr/desktop-2/src/overlays/invaders/InvadersCanvas.tsx:100` (only `@ts-expect-error`)
- [x] `/Users/dipdip/code/jnr/desktop-2/tests/e2e/earn-station.spec.ts` (D1 residual fixme)
- [x] `/Users/dipdip/code/jnr/desktop-2/tests/e2e/watermark-proof.spec.ts` (Phase C residual fixme)
