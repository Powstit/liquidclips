# 09 · Bug Ledger

**No bug exists only in conversation.** Every bug lives here.

DECISION-0004 · Anthropic never closes a bug. Only proof closes a bug.

## Legend

- **Severity** — composite (business + technical). P0 blocks ship. P1 fix same-sprint. P2 defer with rationale.
- **Business consequence weights** — CRITICAL / HIGH / MEDIUM / LOW per fingerprint (Revenue · Support · Trust · Conversion).
- **Confidence** — `0.00`–`1.00`. AST-proven = 1.00. Ship-lens verified = 0.85. Anthropic inference = 0.25 max.
- **Status** — `OPEN` / `IN_PROGRESS` / `AWAITING_PROOF` / `CLOSED`.
- **Closes only when** — deterministic assertions. All must be green. Doctor Mode verifies. Human confirms flip.

---

## BUG-001 · Campaigns click telemetry not emitting

- **Symptom (customer-visible):** N/A directly customer-visible. Engineering-visible: opening Campaigns produces zero waterfall events in the log.
- **Root cause (technical):** The running app was still on a stale bundle when the click happened. Fresh boot session never emitted `nav_click_performance` even after quit+relaunch — either lcDiag buffer never flushed or the cold-boot Tauri window loaded a different bundle than `current.json` pointed at. Confidence: `0.70`.
- **Root cause (business):** Runtime bundle hot-swap doesn't reliably produce a fresh session on Tauri without a full app relaunch AND a boot event. No observable indicator to prove which bundle is actually running. Confidence: `0.80`.
- **Affected capabilities:** `capability.operational-excellence`
- **Affected journeys:** `j014-runtime-update`
- **Affected stations:** `station.update-beacon.reload`, `station.consolenav.campaigns`
- **Files involved:** `desktop-2/src/lib/navPerf.ts`, `desktop-2/src/lib/diagnosticLogger.ts`, `desktop-2/src-tauri/src/runtime.rs` (shell frozen, read-only)
- **Business consequence:**
  - Revenue: LOW · doesn't block money paths
  - Support: MEDIUM · blocks eng self-diagnosis
  - Trust: LOW · not customer-facing
  - Conversion: LOW
- **Confidence business consequence:** `0.85`
- **Severity (composite):** P1
- **Canonical source of truth:** `state.runtime-version` (owner: `hook.useRuntimeVersion`)
- **Assigned branch:** unassigned
- **Status:** OPEN
- **Permanent fix (proposed):** Fire a `lcDiag("boot", { runtime_version, source_sha, bundle_index_html_sha256 })` synchronously on first paint. Persist last-seen boot to sessionStorage so `Doctor` can prove which bundle was actually loaded. Investigate Cmd+R vs full quit+relaunch parity.
- **Regression test:** `navPerf.boot-emit.test.ts` — fresh mount emits `boot` with runtime_version within 2s
- **Closes only when:**
  1. `test.passes:navPerf.boot-emit.test.ts`
  2. Doctor sees `boot` event with correct `runtime_version` on cold-boot
  3. `nav_click_performance` lands in `/tmp/backend.log` on next Campaigns click
- **Dependencies:** BUG-006 (runtime_info shell-vs-bundle drift), BUG-012 (Cmd+R doesn't stick)
- **Discovered:** 2026-07-11 · Opened by: Daniel

---

## BUG-002 · Authenticated user shows "Guest · Admin" in avatar  *(P10 target)*

- **Symptom:** Signed-in admin's TopHud avatar shows `GUEST` name + `ADMIN` tier at the same time. Confusing at best, credibility-hit at worst.
- **Root cause (technical):** `handleFromEmail` in `TopHud.tsx:205-211` derives handle from `me.snapshot?.email`. During cold-boot before `/me` resolves, `me.snapshot` is `null` → `handleFromEmail = null` → renders `"Guest"`. Meanwhile `useTierCaps().platformRole === "admin"` may be populated from session cache. Two hooks, two different hydration timings, visible drift. Confidence: `0.95`.
- **Root cause (business):** Missing identity ladder. There is no "signing in…" transitional state, no LC-ID surface (Block 1 backend column exists but no frontend read), and no handle claim flow. The ladder should be `handle → LC-ID → "Signing in…"`, never "Guest" when JWT is present. Confidence: `0.90`.
- **Affected capabilities:** `capability.identity-trust`, `capability.affiliate-revenue`
- **Affected journeys:** `j001-fresh-user-otp-identity`, `j002-returning-user`, `j004-connect-whop`
- **Affected stations:** `station.tophud.identity-pill`, `station.tophud.avatar-name`
- **Files involved:** `desktop-2/src/design-os/components/TopHud.tsx:205, 377, 560`, `desktop-2/src/design-os/state/useMe.ts:80-92`, backend `junior-backend/app/models.py:258` (lc_id column present but unread)
- **Business consequence:**
  - Revenue: MEDIUM · signed-in admin unlikely to Connect Whop from a pill that says GUEST
  - Support: HIGH · every screenshot from a signed-in user says "Guest" → wave of tickets
  - Trust: HIGH · authenticated user shown "Guest" is a credibility hit
  - Conversion: LOW · doesn't block first-clip flow
- **Confidence business consequence:** `0.75`
- **Severity (composite):** P0
- **Canonical source of truth:** `state.current-user` (owner: `hook.useMe`) + `state.authenticated` (owner: `hook.useAuth`)
- **Assigned branch:** unassigned · Wave 1 Agent 1 (Identity)
- **Status:** OPEN
- **Permanent fix (proposed):**
  1. Priority ladder: `handle → email local-part → LC-ID → "Signing in…"` (NEVER "Guest" when `hasJwt`).
  2. Backend: `MeBackendResponse` returns `lc_id` and `handle` fields. Add `POST /me/lc-id/claim` (lazy mint on first `/me` if null).
  3. Frontend: `MeSnapshot` extends with `lcId: string | null` + `handle: string | null`. Adapter reads. TopHud + SplashLeaderboard use ladder.
  4. Loading state: while `me.source === "unknown"` AND `hasJwt`, render "Signing in…" placeholder.
- **Regression test:** `TopHud.identity-ladder.test.ts` — asserts NEVER shows "Guest" when `hasJwt=true` across all four ladder scenarios
- **Closes only when:**
  1. `test.passes:TopHud.identity-ladder.test.ts::signed-in-never-guest`
  2. `test.passes:TopHud.identity-ladder.test.ts::signing-in-during-hydration`
  3. Doctor observes: on `j001` post-OTP, avatar text ∈ {`@handle`, `LC-XXXX`, `Signing in…`} — never "Guest"
  4. HQ telemetry: `me_snapshot_hydrated` fires within 2s of `auth:signed-in` in live run
- **Dependencies:** BUG-003 (handle/LC-ID missing frontend)
- **Discovered:** 2026-07-11 · Opened by: Daniel

---

## BUG-003 · No handle claim path · no LC-ID visible surface

- **Symptom:** User has no way to claim/edit a stable public handle from a first-run surface. LC-ID exists in the backend but is invisible everywhere in the app.
- **Root cause (technical):** `users.lc_id VARCHAR(20)` column exists (`models.py:258`) but no endpoint mints/returns it. `PATCH /me/handle` exists in `AffiliateWidget.tsx:113` but only reachable via Settings/Wallet AffiliateWidget. No claim prompt on first signin. `MeBackendResponse` schema omits `lc_id`. Confidence: `0.95`.
- **Root cause (business):** Product decision to have LC-ID as a stable public identifier was made (schema evidence) but never landed in UI. Handle claim only appears in the affiliate widget — a downstream surface most users never reach. Confidence: `0.70`.
- **Affected capabilities:** `capability.identity-trust`
- **Affected journeys:** `j001-fresh-user-otp-identity`, `j003-crew-onboarding`
- **Affected stations:** future `station.identity.claim-handle`, future `station.identity.confirm-lc-id`
- **Files involved:** backend `junior-backend/app/routes/me.py` (needs lc_id return), `junior-backend/app/models.py:258`, `desktop-2/src/design-os/state/useMe.ts` (needs new fields), `desktop-2/src/design-os/earn/AffiliateWidget.tsx:109` (existing PATCH handler to reuse)
- **Business consequence:**
  - Revenue: LOW-MEDIUM · handle affects affiliate link cleanliness
  - Support: MEDIUM · users can't tell support "my LC-ID is …"
  - Trust: HIGH · missing identity anchor is why BUG-002 happens
  - Conversion: LOW
- **Confidence business consequence:** `0.65`
- **Severity (composite):** P1 (P0 if BUG-002 is treated as a symptom of this)
- **Canonical source of truth:** `state.handle`, `state.lc-id` (both owner: `hook.useMe`)
- **Assigned branch:** unassigned · Wave 1 Agent 1 (Identity)
- **Status:** OPEN
- **Permanent fix (proposed):** See BUG-002 fix. Adds first-run "Claim your handle" bottom-sheet after Crew onboarding.
- **Regression test:** `useMe.lc-id.test.ts` — asserts `lc_id` populated in adapter output; `handle-claim.flow.test.ts` — asserts first-run prompt fires exactly once
- **Closes only when:**
  1. Backend returns `lc_id` on `/me`
  2. Frontend `MeSnapshot.lcId` populated in adapter
  3. First-run claim UI mounts on first signed-in visit to Home
  4. Doctor sees `handle_claimed` event in a test run
- **Dependencies:** none (this is upstream of BUG-002)
- **Discovered:** 2026-07-11 · Opened by: Daniel

---

## BUG-004 · "Connect Whop" not visible from all states

- **Symptom:** No permanent, visible "Connect Whop" affordance. The TopHud identity pill only shows "Connect Whop" when `identityState === "connectWhop"` (JWT present, no Whop link, non-agency). Admin users and unauthed users can never see the CTA in the chrome.
- **Root cause (technical):** `identityCopy` derivation in `TopHud.tsx:216-231` has 4 states; only one shows Whop. Other surfaces (Wallet, Settings, AffiliateWidget) hide the CTA when Whop is linked → dead code for the connected state, but no PERSISTENT status chip for the unconnected state. Confidence: `0.90`.
- **Root cause (business):** No product decision to add a persistent "Whop status chip" separate from the identity pill. Historically the pill was intended as the entry point, but it competes for the same slot as sign-in and agency upgrade. Confidence: `0.70`.
- **Affected capabilities:** `capability.affiliate-revenue`
- **Affected journeys:** `j004-connect-whop`
- **Affected stations:** `station.tophud.identity-pill` (overloaded), missing `station.tophud.whop-status`
- **Files involved:** `desktop-2/src/design-os/components/TopHud.tsx:206-231`, `desktop-2/src/design-os/routes/CommandRoom.tsx` (Home hero could host CTA), `desktop-2/src/routes/wallet-detail/WalletDetail.tsx:633`, `desktop-2/src/design-os/routes/Settings.tsx:842`, `desktop-2/src/design-os/earn/AffiliateWidget.tsx:298`
- **Business consequence:**
  - Revenue: **HIGH** · Connect Whop is the MRR gate; low visibility = lost referrals
  - Support: MEDIUM · users ask "how do I get paid"
  - Trust: LOW
  - Conversion: HIGH · discovery-to-connection funnel
- **Confidence business consequence:** `0.80`
- **Severity (composite):** P1 (money-adjacent)
- **Canonical source of truth:** `state.whop-connection` (owner: `hook.useMe.snapshot.whopUserId`)
- **Assigned branch:** unassigned · Wave 1 Agent 2 (Whop/tier)
- **Status:** OPEN
- **Permanent fix (proposed):**
  1. Add persistent `WhopStatusChip` between version pill and identity pill in TopHud.
  2. Chip states: `Not connected · click to link` / `@whop-handle · linked` / `Reconnect required`.
  3. Home hero gains persistent CTA when `!me.snapshot?.whopUserId`.
- **Regression test:** `TopHud.whop-status.test.ts` — asserts chip visible for `whopUserId=null` regardless of tier
- **Closes only when:**
  1. Chip mounted in TopHud strip
  2. Chip click fires `connectWhop()`
  3. On successful link, chip flips to `linked` within 1 tick (activation:complete subscriber already exists per state-drift trifecta)
  4. Doctor observes `whop_connect_cta_clicked` telemetry from every mount site
- **Dependencies:** none
- **Discovered:** 2026-07-11 · Opened by: Daniel

---

## BUG-005 · Notifications badge drifts from empty inbox

- **Symptom:** Avatar shows "1" unread badge but opening the InboxSheet reveals no unread items (or vice versa).
- **Root cause (technical):** `unreadCount()` in `src/inbox` reduces over `localStorage.lc.inbox.messages.v1` — a local store. Backend `/notifications` endpoint is not called from desktop-2. Server-generated notifications (email digest, agency submission ack) never appear in the local store, so the badge is stale. Confidence: `0.90`.
- **Root cause (business):** Server-side notifications never wired to the desktop app. Local-events-only counter was shipped as scaffolding pending backend integration. Confidence: `0.80`.
- **Affected capabilities:** `capability.community-retention`
- **Affected journeys:** none directly (side-surface)
- **Affected stations:** `station.tophud.avatar-badge`, `station.inbox.sheet`
- **Files involved:** `desktop-2/src/inbox/*.ts`, `desktop-2/src/shell/InboxSheet.tsx`, `desktop-2/src/design-os/components/TopHud.tsx:180`
- **Business consequence:**
  - Revenue: LOW
  - Support: MEDIUM · "why does it say 1?"
  - Trust: MEDIUM · lying badge = trust drip
  - Conversion: LOW
- **Confidence business consequence:** `0.75`
- **Severity (composite):** P2
- **Canonical source of truth:** `state.unread-notifications` (owner: currently `hook.useInbox` local · target: backend `/notifications`)
- **Assigned branch:** unassigned
- **Status:** OPEN
- **Permanent fix (proposed):** Either (a) wire `/notifications` fetch → mirror into local store on interval, OR (b) accept "session-only" counter with an explicit `Local · not synced` chip. Product call.
- **Regression test:** `inbox.badge-accuracy.test.ts` — asserts badge count == unread items in sheet
- **Closes only when:**
  1. Badge count matches sheet content deterministically
  2. Test passes across cache clear + reload
  3. If backend wire chosen: `/notifications?unread=true` returns match count on every sample
- **Dependencies:** none
- **Discovered:** 2026-07-11 · Opened by: Daniel

---

## BUG-006 · Version pill shows shell version when runtime bundle is newer

- **Symptom:** After promoting a runtime bundle (e.g. `2.2.36-state-drift-fixed`), the TopHud version pill still shows the shell version (`v2.2.36`).
- **Root cause (technical):** `useRuntimeVersion.ts` invokes Tauri command `runtime_info` and reads `active_version`. But the Rust command in `desktop-2/src-tauri/src/runtime.rs` returns the shell's compiled version, not `current.json.version`. Frontend correctly falls back — but the fallback is the same string. Confidence: `0.85`.
- **Root cause (business):** Shell is frozen (DECISION-0003). Rust command was never updated to read `current.json` at runtime. This makes it impossible for a developer OR user to know which bundle they're actually running from the UI. Confidence: `0.75`.
- **Affected capabilities:** `capability.operational-excellence`
- **Affected journeys:** `j014-runtime-update`
- **Affected stations:** `station.tophud.version-pill`
- **Files involved:** `desktop-2/src-tauri/src/runtime.rs` (READ-ONLY · shell frozen), `desktop-2/src/lib/useRuntimeVersion.ts:70-90`, `~/Library/Application Support/Liquid Clips/runtime/current.json`
- **Business consequence:**
  - Revenue: LOW
  - Support: HIGH · "which version are you on?" cannot be answered by looking at the app
  - Trust: LOW
  - Conversion: LOW
- **Confidence business consequence:** `0.70`
- **Severity (composite):** P1 (blocks reproduction of any customer report)
- **Canonical source of truth:** `state.runtime-version` (owner: `hook.useRuntimeVersion` → Tauri `runtime_info`)
- **Assigned branch:** unassigned · blocked on shell unfreeze
- **Status:** OPEN (deferred pending Daniel's shell unlock decision)
- **Permanent fix (proposed) · shell-only:** Update `runtime.rs::runtime_info` to read `current.json.version` if present, fall through to shell version.
- **Alternative (runtime-only):** Frontend reads `current.json` via a plugin-fs read at boot and displays it. Prefer this until shell unlocks.
- **Regression test:** `TopHud.version-pill.test.ts::displays-runtime-version-when-set`
- **Closes only when:**
  1. Test passes
  2. On promoted bundle, pill text == `current.json.version` value within 3s of boot
  3. Doctor confirms parity across shell + runtime
- **Dependencies:** DECISION-0003 (shell freeze) — either unfreeze or take runtime-only path
- **Discovered:** 2026-07-11 · Opened by: Daniel

---

## BUG-007 · `__APP_VERSION__` still hardcoded in Settings, IntroSplash, DiagnosticsSection

- **Symptom:** Same version drift as BUG-006 · in three additional locations.
- **Root cause (technical):** Ship-lens P2-001 finding on the state-drift trifecta: version pill was fixed in TopHud but not swept to the other three sites. All still render `__APP_VERSION__` (build-time constant). Confidence: `1.00` (grep-verified).
- **Root cause (business):** Scope was tight to P1-C (TopHud only). Cleanup pass not scheduled. Confidence: `0.90`.
- **Affected capabilities:** `capability.operational-excellence`
- **Affected journeys:** `j014-runtime-update` (Diagnostics)
- **Affected stations:** `station.settings.version`, `station.introsplash.version`, `station.diagnostics.version`
- **Files involved:** `desktop-2/src/design-os/routes/Settings.tsx:539-540`, `desktop-2/src/routes/introsplash/IntroSplash.tsx:456`, `desktop-2/src/routes/diagnostics/DiagnosticsSection.tsx:22-23`
- **Business consequence:**
  - Revenue: LOW
  - Support: MEDIUM · Diagnostics is the primary "tell us your version" surface
  - Trust: LOW
  - Conversion: LOW
- **Confidence business consequence:** `0.85`
- **Severity (composite):** P2
- **Canonical source of truth:** `state.runtime-version` (owner: `hook.useRuntimeVersion`)
- **Assigned branch:** unassigned
- **Status:** OPEN
- **Permanent fix (proposed):** Sweep three sites to use `useRuntimeVersion()` per the P1-C pattern.
- **Regression test:** `version-consistency.test.ts` — grep-asserts no `__APP_VERSION__` render outside `useRuntimeVersion.ts`
- **Closes only when:**
  1. Test passes (grep = 0 hits)
  2. All three surfaces display same string as TopHud pill on a promoted bundle
- **Dependencies:** BUG-006 (upstream fix cascades)
- **Discovered:** 2026-07-11 (ship-lens) · Opened by: Ship-lens agent

---

## BUG-008 · ExportPanel + OverlayTemplateGallery + ReactionControls default `userTier="free"`

- **Symptom:** Export surfaces internally treat every user as `free` tier when no prop passed. Fail-closed (safe · watermark applied) but wrong.
- **Root cause (technical):** Ship-lens P2-002 on the state-drift trifecta: prop-deletion sweep left internal `userTier = "free"` defaults in three components. Preset gating uses the fallback tier for anything not covered by `watermarkLockedOverride`. Confidence: `1.00` (grep-verified).
- **Root cause (business):** Pattern of passing tier as prop instead of hooking `useTierCaps` internally never fully migrated. Confidence: `0.90`.
- **Affected capabilities:** `capability.content-production`
- **Affected journeys:** `j009-export-single-clip`
- **Affected stations:** `station.export.preset-picker`, `station.overlay.template-gallery`, `station.reaction.controls`
- **Files involved:** `desktop-2/src/design-os/export/ExportPanel.tsx:75, 164`, `desktop-2/src/design-os/routes/ExportRoute.tsx:328` (mounts OverlayTemplateGallery), `desktop-2/src/design-os/reactions/ReactionControls.tsx`
- **Business consequence:**
  - Revenue: MEDIUM · agency users may see Pro-locked ribbons instead of Agency-unlocked
  - Support: MEDIUM · "why is my export watermarked" when Pro
  - Trust: MEDIUM
  - Conversion: LOW
- **Confidence business consequence:** `0.80`
- **Severity (composite):** P1
- **Canonical source of truth:** `state.tier` (owner: `hook.useTierCaps`)
- **Assigned branch:** unassigned
- **Status:** OPEN
- **Permanent fix (proposed):** Internal `useTierCaps()` in each component. Delete `userTier` prop entirely. Add same regression test pattern as ExportRoute got.
- **Regression test:** `export-tier-source.test.ts` — grep-asserts no `userTier=` prop passed OR internal default
- **Closes only when:**
  1. Test passes
  2. Agency user sees Agency-unlocked ribbons in Export
- **Dependencies:** none
- **Discovered:** 2026-07-11 (ship-lens) · Opened by: Ship-lens agent

---

## BUG-009 · UpdateBeacon 404-polls `/runtime/manifest.json`

- **Symptom:** Backend log shows `[LC-CLIENT-DIAG] update_beacon_check_failed · reason "bundle endpoint returned 404"` every 5 minutes for hours from the same session.
- **Root cause (technical):** `UpdateBeacon.tsx:runtime_check_now` calls `${backend}/runtime/manifest.json` which returns 500 on local (schema missing) or 404 in some configs. Beacon retries silently at 5min interval. Confidence: `0.90`.
- **Root cause (business):** Runtime updater was designed for prod Railway where the manifest endpoint is populated. Local dev never was, and the beacon has no environment-aware backoff. Confidence: `0.75`.
- **Affected capabilities:** `capability.operational-excellence`
- **Affected journeys:** `j014-runtime-update`
- **Affected stations:** `station.update-beacon.check`
- **Files involved:** `desktop-2/src/components/UpdateBeacon.tsx:74-249`, `junior-backend/app/routes/runtime.py:64-90`
- **Business consequence:**
  - Revenue: LOW
  - Support: LOW-MEDIUM · log noise obscures real signals
  - Trust: LOW · not customer-visible
  - Conversion: LOW
- **Confidence business consequence:** `0.85`
- **Severity (composite):** P2
- **Canonical source of truth:** backend `endpoint.get_runtime_manifest`
- **Assigned branch:** unassigned
- **Status:** OPEN
- **Permanent fix (proposed):** Backend returns 204 (no-content) when no manifest available. Frontend treats 204 as "no update pending" without emitting failure telemetry.
- **Regression test:** `runtime-beacon.no-manifest.test.ts` — asserts no `update_beacon_check_failed` emitted when backend returns 204
- **Closes only when:**
  1. Test passes
  2. Live: no failure event in 30 min tail against a fresh backend
- **Dependencies:** none
- **Discovered:** 2026-07-11 · Opened by: Daniel (log observation)

---

## BUG-010 · Learn nav item visibility on cold-boot unverified

- **Symptom:** After promoting state-drift-fixed bundle and cold-boot, screenshot doesn't clearly show Learn between My Journey and Wallet. Bundle grep confirms the code is present.
- **Root cause (technical):** Verification gap · not a proven regression. `ConsoleNav.tsx:51` has the Learn entry per Block 3. `library.svg` icon path exists in bundle. Either (a) render fine but screenshot resolution too low, (b) mode gate hiding it, (c) actual render regression. Confidence root cause: `0.40`.
- **Root cause (business):** Confidence too low to name. Requires a live walk with DevTools open. Confidence: `0.30`.
- **Affected capabilities:** `capability.community-retention`
- **Affected journeys:** `j001-fresh-user-otp-identity` (post-boot nav discovery)
- **Affected stations:** `station.consolenav.learn`
- **Files involved:** `desktop-2/src/design-os/components/ConsoleNav.tsx:45-51`, `desktop-2/src/design-os/routing/SimulatorRouter.tsx` (SURFACE_FOR.learn added Block 3)
- **Business consequence:**
  - Revenue: LOW
  - Support: LOW
  - Trust: LOW
  - Conversion: MEDIUM (if truly missing, blocks Learn walkthrough discovery)
- **Confidence business consequence:** `0.40`
- **Severity (composite):** P2 (P1 if confirmed missing)
- **Canonical source of truth:** `SectionRegistry` + `SURFACE_FOR`
- **Assigned branch:** unassigned
- **Status:** OPEN (needs Doctor pass to confirm or dismiss)
- **Permanent fix (proposed):** Depends on confirmation. If genuinely missing: verify mode gate, verify render order. If just screenshot artifact: dismiss.
- **Regression test:** `ConsoleNav.learn-visible.test.ts` — asserts Learn present in nav between clipper and earn regardless of mode
- **Closes only when:**
  1. Doctor confirms Learn visible on live cold-boot walkthrough
  2. Test passes
- **Dependencies:** none
- **Discovered:** 2026-07-11 · Opened by: Daniel (visual observation)

---

## BUG-011 · `text-transform: uppercase` obscures identity pill copy verification

- **Symptom:** R7 identity pill has CSS `text-transform: uppercase`. Visually can't distinguish "SIGN IN" (pre-R7 copy) from "START FREE · 10 CLIPS" (R7 copy) in screenshots without a ruler.
- **Root cause (technical):** `TopHud.tsx:544` sets `textTransform: "uppercase"` inline. Bundle grep confirms the R7 copy is baked. But visual verification is destroyed. Confidence: `1.00`.
- **Root cause (business):** Design choice inherited from earlier era. Not deliberate obfuscation, but blocks visual QA. Confidence: `0.80`.
- **Affected capabilities:** `capability.operational-excellence` (verification), `capability.identity-trust` (visual)
- **Affected journeys:** none directly
- **Affected stations:** `station.tophud.identity-pill`
- **Files involved:** `desktop-2/src/design-os/components/TopHud.tsx:544`
- **Business consequence:**
  - Revenue: LOW
  - Support: LOW-MEDIUM · slows customer report triage
  - Trust: LOW
  - Conversion: LOW
- **Confidence business consequence:** `0.70`
- **Severity (composite):** P2
- **Canonical source of truth:** `station.tophud.identity-pill` copy
- **Assigned branch:** unassigned
- **Status:** OPEN
- **Permanent fix (proposed):** Remove `textTransform: "uppercase"` OR add a `data-identity-copy="<literal>"` attribute Playwright/Doctor can query.
- **Regression test:** none required; documentation-level fix
- **Closes only when:**
  1. Data attribute present with literal copy
  2. Doctor query returns exact string on inspection
- **Dependencies:** none
- **Discovered:** 2026-07-11 · Opened by: Daniel (verification blocker)

---

## BUG-012 · Runtime bundle hot-swap requires quit+relaunch · Cmd+R doesn't stick

- **Symptom:** After `promote-bundle.sh` flips `current.json`, sending Cmd+R to the app window doesn't consistently load the new bundle. Only full app quit + reopen reliably picks it up.
- **Root cause (technical):** Unknown. `staged_bundle_path()` in `runtime.rs` reads `current.json` per URI resolver call in theory, so Cmd+R should reload. But observed behavior contradicts. Possibly service worker cache OR Tauri window HMR path. Confidence: `0.40`.
- **Root cause (business):** No developer-facing test proves hot-swap works. No visible boot signal proves which bundle rendered. Confidence: `0.60`.
- **Affected capabilities:** `capability.operational-excellence`
- **Affected journeys:** `j014-runtime-update`
- **Affected stations:** `station.update-beacon.reload`, developer QA
- **Files involved:** `desktop-2/src-tauri/src/runtime.rs` (READ-ONLY · shell frozen)
- **Business consequence:**
  - Revenue: LOW
  - Support: MEDIUM · users clicking "Reload" on the beacon may still see old bundle
  - Trust: LOW
  - Conversion: LOW
- **Confidence business consequence:** `0.65`
- **Severity (composite):** P1 (blocks the customer-facing runtime update path)
- **Canonical source of truth:** Tauri `runtime_info` + `current.json`
- **Assigned branch:** unassigned · blocked on shell investigation
- **Status:** OPEN
- **Permanent fix (proposed):** Add boot event with runtime_version (BUG-001 fix). Investigate whether Tauri needs `webview.reload()` invoke instead of Cmd+R keystroke. If yes, wire UpdateBeacon reload button to `invoke("webview_reload")`.
- **Regression test:** `runtime-hotswap.test.ts` (integration) — promote bundle → click reload → assert new bundle version in DOM
- **Closes only when:**
  1. Test passes
  2. Live: promoting new bundle + clicking beacon reload updates version pill within 3s
- **Dependencies:** BUG-001 (need boot event to observe)
- **Discovered:** 2026-07-11 · Opened by: Daniel (observation during promote sequence)

---

## BUG-013 · "Good evening ✦" static — never personalized

- **Symptom:** TopHud greeting eyebrow always says "Good evening ✦" regardless of time of day OR signed-in user. Not addressed by name.
- **Root cause (technical):** `TopHud.tsx:75` sets `greetingEyebrow = "Good evening ✦"` as a static default. No time-of-day derivation. No user-name interpolation. Confidence: `1.00`.
- **Root cause (business):** No product decision to personalize. Placeholder copy from Phase 4B rev shipped unchanged. Confidence: `0.90`.
- **Affected capabilities:** `capability.identity-trust`
- **Affected journeys:** `j002-returning-user`
- **Affected stations:** `station.tophud.greeting-eyebrow`
- **Files involved:** `desktop-2/src/design-os/components/TopHud.tsx:75, 372`
- **Business consequence:**
  - Revenue: LOW
  - Support: LOW
  - Trust: LOW-MEDIUM · impersonal
  - Conversion: LOW
- **Confidence business consequence:** `0.60`
- **Severity (composite):** P2
- **Canonical source of truth:** `state.current-user.handle`
- **Assigned branch:** unassigned
- **Status:** OPEN
- **Permanent fix (proposed):** Derive time-of-day from local clock. Interpolate `handle`/`LC-ID`. Example: `Good evening ✦ @daniel` / `Good morning ✦ LC-A2K9`. Guest fallback: `Welcome ✦`.
- **Regression test:** `greeting.personalized.test.ts` — signed-in user sees handle in greeting
- **Closes only when:**
  1. Test passes across 4 time-of-day / 3 auth-state cases
- **Dependencies:** BUG-003 (handle/LC-ID must exist first)
- **Discovered:** 2026-07-11 · Opened by: Daniel

---

## BUG-014 · Home hero lacks Whop CTA when unconnected

- **Symptom:** Home hero shows "Find paid clipping opportunities without leaving the app" with 4 tiles (Create · My Clips · Find Rewards · Track Earnings) but no persistent Connect Whop CTA even when the user has no Whop link.
- **Root cause (technical):** `CommandRoom.tsx:HomeContent` renders 4 fixed tiles + Earn strip. No conditional CTA based on `me.snapshot?.whopUserId`. Confidence: `0.90`.
- **Root cause (business):** Product decision to keep Home hero minimal shipped in earlier UI-3 phase. Whop connection was assumed to be handled by identity pill (see BUG-004). Confidence: `0.75`.
- **Affected capabilities:** `capability.affiliate-revenue`
- **Affected journeys:** `j004-connect-whop`
- **Affected stations:** `station.home.hero`
- **Files involved:** `desktop-2/src/design-os/routes/CommandRoom.tsx`
- **Business consequence:**
  - Revenue: **HIGH** · Home is the highest-traffic surface; missing CTA = missing MRR opportunity
  - Support: LOW
  - Trust: LOW
  - Conversion: **HIGH** · discovery-to-connect funnel gap
- **Confidence business consequence:** `0.80`
- **Severity (composite):** P1 (money-adjacent · same class as BUG-004)
- **Canonical source of truth:** `state.whop-connection` (owner: `hook.useMe.snapshot.whopUserId`)
- **Assigned branch:** unassigned · Wave 1 Agent 2 (Whop/tier)
- **Status:** OPEN
- **Permanent fix (proposed):** Add conditional 5th tile OR strip-level CTA when `!me.snapshot?.whopUserId`. Copy: "Connect Whop · unlock recurring MRR →".
- **Regression test:** `home.whop-cta.test.ts` — asserts CTA visible for unconnected user, absent for connected user
- **Closes only when:**
  1. Test passes both branches
  2. Doctor sees `whop_cta_home_impressions` telemetry within 1 tick of mount when unconnected
- **Dependencies:** BUG-004 (unified Whop status story)
- **Discovered:** 2026-07-11 · Opened by: Daniel

---

## Ledger summary

| ID | Severity | Business consequence peak | Confidence rc | Dependencies | Wave |
|---|---|---|---|---|---|
| BUG-001 | P1 | Support MEDIUM | 0.70 | BUG-006, BUG-012 | 4 |
| BUG-002 | **P0** | Support HIGH · Trust HIGH | 0.95 | BUG-003 | 1 |
| BUG-003 | P1 | Trust HIGH | 0.95 | — | 1 |
| BUG-004 | P1 | Revenue HIGH · Conv HIGH | 0.90 | — | 2 |
| BUG-005 | P2 | Trust MEDIUM | 0.90 | — | later |
| BUG-006 | P1 | Support HIGH | 0.85 | shell-freeze decision | later |
| BUG-007 | P2 | Support MEDIUM | 1.00 | BUG-006 | later |
| BUG-008 | P1 | Revenue MEDIUM | 1.00 | — | 2 |
| BUG-009 | P2 | Support MEDIUM | 0.90 | — | later |
| BUG-010 | P2* | Conv MEDIUM (if confirmed) | 0.40 | — | 5 |
| BUG-011 | P2 | Support MEDIUM | 1.00 | — | later |
| BUG-012 | P1 | Support MEDIUM | 0.40 | BUG-001 | 4 |
| BUG-013 | P2 | Trust LOW-MEDIUM | 1.00 | BUG-003 | later |
| BUG-014 | P1 | Revenue HIGH · Conv HIGH | 0.90 | BUG-004 | 2 |

**Priority chain by mission fingerprint:**
- **M2 (Revenue) protection:** BUG-004 → BUG-014 → BUG-008
- **M3 (Trust) protection:** BUG-002 → BUG-003 → BUG-005 → BUG-013
- **Operational integrity:** BUG-001 → BUG-006 → BUG-007 → BUG-012 → BUG-009 → BUG-011

**P10 target (Definition of Complete):** BUG-002 — highest confidence in root cause AND business consequence chain, cleanest known-answer for Doctor Mode verification.

---

*New bugs append below this line, never above. New IDs are monotonic.*
