# D1 Cluster Analysis · Corrected Baseline

**Baseline:** 169 tests · 85 pass · 59 fail · 24 skip · 1 did-not-run · GATE_EXIT=1
**Wall clock:** 1.3h · Log: `02-full-d1.log`
**Env state (verified):** 0 `localhost:8000`, 0 `ECONNREFUSED`, 0 `CORS policy` in D1 log itself. 29 CORS refs in verdict JSONs are all `/lcos/events/ingest` (HARNESS-class, same as the `/telemetry/diagnostic` mock added in `ac6486d7`).
**Constraint (locked):** no shrink / hide / disable / remove of any locked feature to make tests green.

**Class totals:** PRODUCT 34 · STALE-TEST 18 · HARNESS 6 · ENV 1

---

## Section 1 · Failure classification (59 tests)

| # | Spec:Line | Test (abbrev) | Class | Root-cause hypothesis |
|---|---|---|---|---|
| 1 | e2e/activation-bonus-states:59 | Earn tab · sponsored-reward-module renders | PRODUCT | WelcomeGate overlay ("Agency Access · Unlock everything") occludes WalletDetail/sponsored-reward module even after seedAuthenticatedShell. Free-tier still gated. |
| 2-4 | activation-bonus-states:144,181,214 | State transitions approved/rejected/paid | PRODUCT | Same WelcomeGate blocker |
| 5 | activation-flow:123 | cold start → auth-fail | STALE-TEST | Waits for `[data-testid="login-state-idle"]` from retired LoginOnboarding; product now ships SimpleLoginPanel (Wave 1 locked) |
| 6 | agency-launch-readiness:119 | agency end-to-end | STALE-TEST | Asserts `submissions` nav item; intentionally removed 2026-07-10 in `ConsoleNav.tsx:52-58` |
| 7 | brand-consistency:151 | every route h1 locked | PRODUCT | Route `#/earn` (WalletDetail) has no route-title `<h1>` |
| 8-9 | browse-shortcuts:33,91 | shortcut form + capacity | PRODUCT | Strict-mode: 2 elements matched `getByRole('button', { name: 'Add shortcut' })` — rail button AND `iab-scrubber-btn` "9 · add shortcut open" state pill share aria-label |
| 10 | browse-tab-omnipresent:128 | Use-in-Engine handoff | PRODUCT | `iab-scrubber` tablist intercepts pointer events over Use-in-Engine button — z-index regression |
| 11 | button-audit:239 | 11-surface control audit | HARNESS | `page.reload` → shell mocks don't survive; harness needs re-seed after reload |
| 12 | caption-editing:166 | edit captions persist | STALE-TEST | Filters `.lc-clip-cta` `hasText: /^Edit$/`; product intentionally renamed CTA to "Open clip" in `ClipCard.tsx:304` |
| 13 | channels-station:122 | source=mock zero fake | HARNESS | Test asserts `data-channels-source="mock"`; observed `real-http`. Missing route.fulfill for `/channels/*` |
| 14 | clerk-otp-login:33 | primary lane clerk OR lc-id | STALE-TEST | Test expects `clerk-otp-panel` OR `welcome-existing` primary; product ships SimpleLoginPanel as primary post Wave 1 |
| 15 | clerk-otp-login:80 | LC-ID fallback link | PRODUCT | `welcome-existing` button exists but CSS `visibility: hidden` (19 polls). SimpleLoginPanel variant hides sibling WelcomeGate CTAs |
| 16 | clerk-otp-login:98 | Whop tertiary demoted | PRODUCT | `welcome-clipper` button hidden — same CSS issue as #15 |
| 17-20 | community-chat-home:185 (×3 viewports), :245 | real chat layout + pending gate | PRODUCT | `[data-room-id="clippers-lounge"]` never renders. Sidebar shows `Rooms · 1` (only #global). BC-013 locked layout expects pending rooms. Room registry filtering wrong. |
| 21 | earn-affiliate-polish:218 | Settings ↔ Earn shared URL | STALE-TEST | Asserts `[data-testid="earn-stage"]` on old Design-OS EarnRoute; money-surface rule 2026-07-10 replaced with WalletDetail (no earn-stage testid) |
| 22 | earn-affiliate-polish:270 | affiliate/wallet honest failures | PRODUCT | `/me/wallet/summary` error → WalletDetail throws → SectionWithFallback shows generic message. Test expects WalletDetail's own `data-state="offline"` |
| 23 | earn-station:103 | honest zeros | PRODUCT | Same WalletDetail crash into SectionWithFallback |
| 24 | export-clip:151 | export end-to-end | STALE-TEST | Same `/^Edit$/` filter as #12 |
| 25 | first-run-onboarding:100 | install → connect → settings | STALE-TEST | Same LoginOnboarding retirement as #5 |
| 26 | full-clipping-journey:171 | generate→edit→export walk | STALE-TEST | Same `/^Edit$/` filter |
| 27 | gate1-proof:23 | .sim-h1 letter-spacing | STALE-TEST | Same LoginOnboarding retirement |
| 28 | gate5-routing:89 | Campaigns quick link | PRODUCT | BrowseOverlay Campaigns pushes `#/campaigns` outer hash; two-pipeline rule LOCKED requires `bus.emit("nav:click", "campaigns")` and stay on `#/home` |
| 29 | generate-create:121 | Upload/Script COMING SOON | STALE-TEST | Asserts `data-upload-state="coming-soon"`; upload is intentionally live now with "Pick file" |
| 30 | home-dashboard:101 | upload/script COMING SOON | STALE-TEST | Same as #29 |
| 31 | inbox-notifications:102 | canonical Resend retry | PRODUCT | `[data-testid="avatar-orbit-menu"]` never renders after clicking `avatar-orbit-button`. TopHud avatar-menu regression |
| 32 | library-my-clips:130 | library COMING SOON | STALE-TEST | Library route deprecated → Workstation is canonical source |
| 33 | login-lc-id-email:13 | LC-ID paste unlocks | PRODUCT | `welcome-recovery > summary` visible: false. WelcomeGate recovery affordance hidden by SimpleLoginPanel variant CSS |
| 34 | publish-reward-mint:39 | publish → RewardClip mint | PRODUCT | Reward row never appears on Earn. Compound: publish flow blocked by Cluster B rename OR WalletDetail doesn't render reward-clips list |
| 35 | reaction-journey:166 | add reaction persists | STALE-TEST | Same `/^Edit$/` filter |
| 36 | remaining-surfaces:139 | static contracts + honest stubs | PRODUCT | Same TopHud avatar-menu regression as #31 |
| 37 | schedule-honesty:111 | assisted reminders real | STALE-TEST | Same `/^Edit$/` filter |
| 38 | settings-avatar:96 | avatar menu → Settings | PRODUCT | Same TopHud avatar-menu regression as #31 |
| 39-40 | settings-cockpit:344 (1040×680, 1280×820) | clipper viewport-bounded | PRODUCT | `stageBottom > viewportHeight` (743>680, 821>820). Settings pane overflows viewport at small sizes |
| 41 | settings-cockpit:389 | clipper tabs bounded | PRODUCT | `Devices` tab missing from clipper tablist — tab was removed/regressed |
| 42-48 | settings-cockpit:454,527,541,559,583,596,607 | agency owner controls / roster / builder | PRODUCT | **P0 · React "Rendered fewer hooks than expected"** in agency-mode Settings. Conditional-hook / early-return violation. |
| 49 | settings-cockpit:645 | legacy actions reachable | PRODUCT | Same `Devices` tab missing as #41 |
| 50 | splash-and-agency-palette:93 | splash canvas · agency blue | PRODUCT | `splash-game-canvas` never renders — splash gate short-circuits with `?skipIntro=1` |
| 51 | style-journey:110 | preset+accent · watermark | STALE-TEST | Same `/^Edit$/` filter |
| 52 | system-migration:161 | proven-system cross-links | PRODUCT | `[data-testid="earn-open-affiliate"]` missing on WalletDetail (was on old EarnRoute). Referral CTA affordance regression |
| 53 | trim-clip:152 | trim + export uses new trim | STALE-TEST | Same `/^Edit$/` filter |
| 54 | wallet-malformed-response:18 | wallet-panel offline visible | PRODUCT | WalletDetail throws on malformed /me/wallet/summary → SectionWithFallback catches. Product's honest offline state should render inside WalletDetail |
| 55 | watermark-proof:193 | watermark across tiers | STALE-TEST | Same `/^Edit$/` filter |
| 56 | native-walk-prep/j007-publish:193 | Ayrshare regression guard | ENV | Prod `api.liquidclips.app/health` returns `AYRSHARE`/`PROFILE_KEY` env markers. Backend Railway env leak. |
| 57 | visual/workstation:170 | Guest/Free identity | HARNESS | `seedAuthenticatedShell` latches identity "harness" before spec's guest override; reverse-priority didn't win |
| 58 | visual/workstation:622 | zero-candidate recovery | PRODUCT | `[data-testid="ws-zero-candidates"]` doesn't render on empty results |
| 59 | visual/workstation:1126 | C7 empty hydration clears | PRODUCT | After empty hydration, `[data-testid="ws-inspector"]` still resolves — state-reset bug |

---

## Section 2 · Cluster grouping

### PRODUCT clusters

**A · Agency-Settings React hooks-order crash · P0**
- 7 tests (#42-48) · settings-cockpit
- Signature: `Section crashed · Rendered fewer hooks than expected · This may be caused by an accidental early return statement · route: home · runtime: mock`
- Fix: locate conditional hook / early return in agency-mode Settings component. Hoist all hooks above every branching return. `src/sections/settings/*.tsx` OR `src/design-os/routes/SettingsRoute.tsx`. ~5-15 loc.

**E · WalletDetail crashes on missing/malformed data**
- 3 tests (#22, #23, #54)
- Signature: SectionWithFallback shows "Wallet briefly out of reach" instead of WalletDetail's own offline state
- Fix: `src/sections/account/WalletDetail.tsx` — defensive destructures + `data-state="offline|loading|empty"` on wallet-panel root. Don't throw. ~15-40 loc.

**F · Free-tier WelcomeGate blocks Earn sponsored-reward**
- 4 tests (#1-4) · activation-bonus-states
- Signature: yaml shows `region "Agency Access activation" · heading "Unlock everything." · button "Continue with Whop"` occluding module
- Fix: WelcomeGate is locked (Wave 1). Add tier-aware / bonus-state-aware short-circuit so Earn renders sponsored-reward module while WelcomeGate stays available elsewhere. `src/sections/account/AccountSection.tsx` + WelcomeGate mount condition. ~10-20 loc.
- **Do NOT remove WelcomeGate.**

**G · TopHud avatar-orbit menu doesn't open**
- 3 tests (#31, #36, #38)
- Signature: `[data-testid="avatar-orbit-menu"]` not visible after click on `avatar-orbit-button`
- Fix: onClick handler regression in `src/design-os/components/AvatarOrbit.tsx` (or TopHud variant). Likely caused by `b356c35b` polish. ~5-10 loc.

**H · Community pending rooms missing (BC-013 locked layout)**
- 4 tests (#17-20) · community-chat-home
- Signature: `[data-room-id="clippers-lounge"]` never renders; sidebar shows `Rooms · 1 · #global`
- Fix: room registry filters out `is_connected === false`. Include pending rooms with `data-pending="true"`. `src/routes/community/**`. ~10-20 loc.

**I · WelcomeGate CTAs hidden by SimpleLoginPanel CSS**
- 3 tests (#15, #16, #33)
- Signature: `welcome-existing` / `welcome-clipper` / `welcome-recovery` buttons in DOM but `visibility: hidden`
- Fix: `src/routes/login/**` CSS · SimpleLoginPanel variant selector hides sibling WelcomeGate CTAs. Ensure fallback CTAs render. ~5-15 loc.

**K · Settings clipper viewport overflow @ 1040 & 1280**
- 2 tests (#39-40)
- Signature: `Expected: <= 680, Received: 743` and `<= 820, Received: 821`
- Fix: `.lc-settings-stage` CSS — reduce vertical padding or add `max-height: 100dvh` + inner scroll. ~5 loc.

**L · Settings Devices tab missing (clipper)**
- 2 tests (#41, #49)
- Signature: `getByRole('tab', { name: 'Devices', exact: true })` — tablist has Account/Payouts/Support/Advanced/Streaks/Referrals but no Devices
- Fix: restore Devices tab, or route Channels/Whop reachability through Advanced if intentional. Settings tab registry. ~5-10 loc.

**N · Workstation zero-candidate / hydration state-reset**
- 2 tests (#58-59)
- Signature: `ws-zero-candidates` not visible; `ws-inspector` still present after empty
- Fix: `src/design-os/engine/ResultsGrid.tsx` — empty-state branch + inspector unmount on empty hydration. ~10-20 loc.

**W · Browse rail Add-shortcut a11y & capacity**
- 2 tests (#8-9)
- Signature: `strict mode violation: 2 elements: lc-browse-rail-add AND iab-scrubber-btn "9 · add shortcut open"`
- Fix: rename or hide scrubber pill text from a11y tree; hide rail Add-shortcut button when 6 icons present. `src/components/InAppBrowser*.tsx`. ~5-15 loc.

**P · BrowseOverlay Campaigns wrong-pipeline navigation**
- 1 test (#28)
- Signature: `Expected: "#/home", Received: "#/campaigns"`
- Fix: Campaigns button handler → `bus.emit("nav:click", "campaigns")` (Design-OS pipeline) instead of outer-hash push. ~2-5 loc.

**T · brand-consistency h1 missing on Wallet (candidate STALE — needs your call)**
- 1 test (#7)
- Signature: `routes missing a route-title h1: earn`
- Fix: add `<h1>Wallet</h1>` to WalletDetail hero (approved-mockup gates) OR exempt money-surface routes from the invariant. ~2-5 loc.

**X · Browse-tab Use-in-Engine click intercepted**
- 1 test (#10)
- Signature: `iab-scrubber tablist intercepts pointer events`
- Fix: fix z-index/stacking, or `pointer-events: none` on decorative overlay. ~3-5 loc.

**Y · Splash game canvas not mounted**
- 1 test (#50)
- Signature: `splash-game-canvas` never renders
- Fix: `?skipIntro=1` override guard. ~5 loc.

**Z · Publish → RewardClip downstream break**
- 1 test (#34)
- Signature: `getByText('e2e-p7-clip')` on Earn never renders
- Fix: investigate after Cluster B lands (publish flow may be blocked by clip-card Edit → Open rename). Then verify WalletDetail renders reward-clips list.

### STALE-TEST clusters (all test-code-only)

**B · Clip-card CTA "Edit" → "Open clip"** — 8 tests (#12, 24, 26, 35, 37, 51, 53, 55). Product intentionally renamed CTA in `ClipCard.tsx:304`. Filter update per spec.
**C · Retired LoginOnboarding testids** — 3 tests (#5, 25, 27). Rewrite to SimpleLoginPanel affordances.
**D · Retired earn-stage testid** — 2 tests (#21, #52). Retarget to WalletDetail testids.
**J · Clerk primary → SimpleLoginPanel** — 1 test (#14). Add SimpleLoginPanel as third race condition.
**Q · Upload COMING-SOON honesty** — 2 tests (#29-30). Drop or invert assertion.
**R · Library route** — 1 test (#32). Drop or reassert Workstation canonical.
**S · Agency submissions nav removed** — 1 test (#6). Remove submissions from nav-text assertion.

### HARNESS clusters (all test-code-only)

**O · seedAuthenticatedShell identity latch** — 1 test (#57). Add `seedGuestShell` variant or `resetIdentity()` helper.
**U · Channels mock missing** — 1 test (#13). Add `/channels/*` route.fulfill.
**V · button-audit reload race** — 1 test (#11). Add re-seed after `page.reload`.

### ENV cluster (out of desktop-2 scope)

**ENV-1 · Ayrshare env leak on prod backend** — 1 test (#56). Unset `AYRSHARE_API_KEY` + `PROFILE_KEY` on Railway `junior-backend` service. Redeploy. Per `feedback_ayrshare_mistake.md`.

---

## Section 3 · Ranked PRODUCT clusters

Rank = severity × test count. Severity: 5 = money/auth/core clip · 4 = navigation/route · 3 = tool surface · 2 = visual · 1 = edge.

| Rank | Cluster | Sev | Tests | Score | File(s) touched |
|---|---|---|---|---|---|
| 1 | A · Agency Settings hooks crash | 5 | 7 | 35 | Settings component (hunt conditional hook) |
| 2 | F · Free-tier Earn WelcomeGate | 5 | 4 | 20 | `sections/account/AccountSection.tsx` + WelcomeGate mount |
| 3 | H · Community pending rooms | 4 | 4 | 16 | `routes/community/**` room registry filter |
| 4 | E · WalletDetail malformed-data crash | 5 | 3 | 15 | `sections/account/WalletDetail.tsx` |
| 5 | G · TopHud avatar-orbit menu | 4 | 3 | 12 | `design-os/components/AvatarOrbit.tsx` |
| 6 | I · WelcomeGate CTAs CSS-hidden | 4 | 3 | 12 | `routes/login/**` CSS |
| 7 | K · Settings viewport overflow | 3 | 2 | 6 | `.lc-settings-stage` CSS |
| 8 | L · Settings Devices tab | 3 | 2 | 6 | Settings tab registry |
| 9 | N · Workstation zero-cand/reset | 3 | 2 | 6 | `design-os/engine/ResultsGrid.tsx` |
| 10 | W · Browse rail Add-shortcut | 3 | 2 | 6 | `components/InAppBrowser*.tsx` |
| 11 | P · Campaigns wrong pipeline | 4 | 1 | 4 | BrowseOverlay Campaigns handler |
| 12 | Z · Publish → RewardClip | 4 | 1 | 4 | (investigate after B) |
| 13 | X · Use-in-Engine intercepted | 3 | 1 | 3 | `components/InAppBrowser*` z-index |
| 14 | T · brand-consistency h1 | 2 | 1 | 2 | WalletDetail h1 |
| 15 | Y · Splash canvas | 1 | 1 | 1 | Splash gate opt-out |

**PRODUCT tests total:** 34 · **cluster ranks sum:** 148

---

## Section 4 · Recommended execution order

### Phase 0 · Cheap wins first (HARNESS + ENV · ~3 tests, all test/infra)
1. **Cluster U** — `/channels/*` route.fulfill in channels-station spec
2. **Cluster V** — re-seed after `page.reload` in button-audit spec
3. **Cluster O** — `seedGuestShell` helper in `_auth-harness.ts` (or reset step)
4. **Cluster ENV-1** — hand off to Railway env owner: unset `AYRSHARE_API_KEY` + `PROFILE_KEY` on junior-backend, redeploy

### Phase 1 · STALE-TEST batch (18 tests, all test-code-only, no product touches)
1. Cluster B (Edit → Open clip · 8 tests)
2. Cluster C (LoginOnboarding testids · 3 tests)
3. Cluster D (earn-stage → wallet-panel · 2 tests)
4. Cluster J (Clerk primary → SimpleLoginPanel · 1 test)
5. Cluster Q (Upload COMING-SOON · 2 tests)
6. Cluster R (Library stage · 1 test)
7. Cluster S (Submissions nav · 1 test)

**After Phase 0+1:** pass count 85 → ~110, all remaining failures are PRODUCT.

### Phase 2 · PRODUCT top-5 by rank score
1. **A** · Agency Settings hooks crash · 7 tests
2. **F** · Free-tier Earn WelcomeGate · 4 tests
3. **E** · WalletDetail crash resilience · 3 tests
4. **H** · Community pending rooms · 4 tests
5. **G** · TopHud avatar-orbit menu · 3 tests

After Phase 2: **~24 more tests pass · running total 85 → ~134** of the 145 in-play tests (169 − 24 skips).

### Phase 3 · Remaining PRODUCT
Clusters I, K, L, N, W, P, T, X, Y, Z — 10 tests across 10 smaller diffs.

---

## Section 5 · Reminders for Daniel

### Spec-intent ambiguity (needs your call)
- **Cluster T** — money-surface rule vs brand-consistency h1 invariant: add `<h1>Wallet</h1>` to WalletDetail OR exempt money-surface routes?
- **Cluster L** — Devices tab intentionally removed or regression? Test asserts "Open Channels" + "Open Whop" reachability from Devices.
- **Cluster Q** — Upload is now live with "Pick file" · confirmed intended launch state (drop tests) or premature flip?
- **Cluster R** — Library route deprecated · confirm drop test?

### Confirmations needed on STALE calls
- **Cluster S** — Submissions nav removed 2026-07-10 in ConsoleNav.tsx:52-58 · confident STALE, confirming.
- **Cluster J** — Clerk primary collapsed into SimpleLoginPanel per Wave 1 · confirming.

### Feature regressions that predate this sweep (Wave-1 territory)
- **Cluster G** — TopHud avatar-orbit menu broken across 3 tests. Likely caused by the b356c35b canonical identity pill polish.
- **Cluster F** — WelcomeGate mounting on Earn/Sponsored-Reward for free-tier users is blocking a locked money surface.
- **Cluster A** — Agency-Settings hooks-order crash. Check the last 2-3 commits touching agency Settings.

### Harness gaps to close proactively
1. `/channels/*` mock (Cluster U) · same class as `/telemetry/diagnostic` and `/lcos/events/ingest`
2. Reload re-seed helper (Cluster V)
3. `seedGuestShell` / `resetIdentity` (Cluster O)
4. **`/lcos/events/ingest`** — 29 cosmetic verdict-JSON CORS refs · already known · same-class fix as ac6486d7

### Env action (out of scope for desktop-2)
- **Cluster ENV-1** — prod Railway backend leaks Ayrshare env markers. Per `feedback_ayrshare_mistake.md`: unset + redeploy.

### Rank-score summary
- Phase 0 + Phase 1: 85 → ~110 passes, product code untouched
- Phase 2 top-5: 85 → ~134 passes, ~24 more tests unblocked, all locked features preserved
- Phase 3: ~10 more tests across 10 smaller diffs
