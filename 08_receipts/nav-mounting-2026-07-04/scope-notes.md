# Scope notes · Phase 8 nav mounting 2026-07-04

## Section: NAV MOUNTING mode

Locked in by claude-2's paste-back at
`~/Desktop/liquidclips-marketing-hq-v2/01_specs/mini-layers/PHASE-8-NAV-MOUNTING-PASTE-FOR-CLAUDE-1.md`.
Nothing else moved until every mount landed green with tsc + vitest +
regression check per mount. Same 26/26 assertions rigor as
security-hardening.

Branch: `feature/nav-mounting-2026-07-04` off `security/2026-07-04-hardening-pass`.

Root problem the user-journey-lens surfaced: 6 Section-B ports were
dead code. Beautiful surfaces · never mounted · zero user reach. This
sprint made every one reachable.

## Mount #1 · LoginActivation as unauth boot gate

Commit: `a4c9e69`

Delivered:
- `desktop-2/src/App.tsx` · added `LoginActivation` lazy import ·
  replaced `<LoginOnboardingRoute />` inside AuthGate with
  `<LoginActivation onContinue={...} />` · onContinue triggers a
  best-effort `resumeJwtFromKeychainForAuthAction`.
- LoginOnboardingRoute lazy import preserved with a `void` reference
  so tsc's `noUnusedLocals` doesn't strip it. Rolling back is a
  one-line AuthGate swap.
- `desktop-2/src/App.test.tsx` (new) · 5 source-file assertions
  guarding the mount against silent revert (lazy import · onContinue
  wire · no live LoginOnboardingRoute render · hasJwt /
  hasJwtKeychainPresence contracts intact · IntroSplash + FunnelGate
  + HardUpdateGate boot chrome preserved).

## Mount #2 · SyncMailMoneyDrop → #/outreach section

Commit: `fdad483`

Delivered:
- `desktop-2/src/shell/sectionIds.ts` · added `SECTION_OUTREACH` to
  the canonical `SECTION_IDS` map. Not added to
  `DEPRECATED_SECTION_IDS` so the BUG-047 harness won't flag.
- `desktop-2/src/shell/sectionRegistry.ts` · registered the entry at
  route "outreach" with `navVisible:false` (Home hero CTA copy still
  pending sign-off · router-only for now, reachable via
  `window.location.hash = "#/outreach"`).
- `desktop-2/src/sections/outreach/OutreachSection.tsx` (new) · thin
  wrapper hoisting `SyncMailMoneyDrop`. `onSendComplete` navigates
  back to `#/home` so a completed send returns to the workbench.
- `desktop-2/src/sections/outreach/OutreachSection.test.ts` (new) ·
  6 assertions (registry entry · route resolution · component
  identity · not-deprecated · 10-section preservation · wrapper
  contract).

Guard rail 12 (WIRE only):
- Reused `FLOW_000_APP_SHELL` for the section flowIds rather than
  introducing a new FLOW_ID. Multiple existing sections already
  reuse this generic top-level flow (Home · Learn · Account).

## Mount #3 · WalletDetail inside AccountSection

Commit: `48899e6`

Delivered:
- `desktop-2/src/sections/account/AccountSection.tsx` · replaced the
  stub identity / tier / affiliate HUD cards (which read from the
  `fixtures/fakeAccount.preview` fixture with no user data) with
  `<WalletDetail />` — the Section-B port owns the full account view.
- `desktop-2/src/sections/account/AccountSection.test.ts` (new) ·
  5 assertions (WalletDetail import + render · fakeAccount import
  removed · router entry preserved · fictional-only CLIPPERS roster ·
  no real-creator emails).

Guard-rail checks:
- Kade decoupling · `lint-kade-decoupling.sh` · 0 output lines.
- Kade anchor · `assert-kade-anchor.sh` · 0 output lines.
- IG-011 (webview room height cascade) · N/A · AccountSection is not
  a native-webview room.

## Mount #4 · CatalogCarousel inside CampaignsSection

Commit: `0a007c3`

Delivered:
- `desktop-2/src/sections/campaigns/CampaignsSection.tsx` · replaced
  the legacy `All campaigns` `lc-grid-3` `lc-hud-card` grid with
  `<CatalogCarousel />` from the Section-B port. The carousel owns
  its own 6 states + dev scrubber. `selectedId` state above still
  drives the "active campaign" header block. `onClipClick`
  intentionally NOT wired — CatalogCarousel's Tile shape is not
  FakeCampaign, and Layer 4 (F7) will pass real tiles once
  `/yt/batch-lookup` lands.
- `desktop-2/src/sections/campaigns/CampaignsSection.test.ts` (new) ·
  5 assertions (import · render swap · router entry preserved ·
  Create + Watermark modal scaffolding intact · zero `bounty` in
  CatalogCarousel non-comment lines).

## Mount #5 · CancellationIntercept modal from Cancel button

Commit: `aa81548`

Delivered:
- `desktop-2/src/sections/account/AccountSection.tsx` · wrapped the
  Mount #3 WalletDetail render with a corner-pinned "Cancel
  subscription" trigger + conditional `<CancellationIntercept />`
  modal. Local `useState` for `cancelOpen`. `handleKeepSubscription`
  closes the modal. `handleQuietCancel` also closes and carries a
  `TODO(phase-9)` marker where the real Whop cancel-subscription
  RPC will plug in.
- `desktop-2/src/sections/account/AccountSection.mount5.test.ts`
  (new) · 5 assertions.

Interpretation note (spec-vs-code):
- Spec's regression check mentions `performCancellation()` as an
  existing wire. Grep across desktop-2/src returned zero hits — no
  Whop cancel-subscription RPC exists in this repo today. Guard rail
  12 forbids inventing a new RPC wrapper. Guard rail 13 says: notice
  a Phase-9 P1 · mark TODO(phase-9) · do NOT fix in Phase 8. Applied
  that discipline · onQuiet dismisses the modal and carries a
  `TODO(phase-9)` marker. Mount #5's charter was reachability of the
  intercept surface, not the cancellation RPC.

## Mount #6 · EmbedPreviewCard inside campaign builder

Commit: `27a4e2f`

Delivered:
- `desktop-2/src/sections/campaigns/CampaignsSection.tsx` · imported
  `EmbedPreviewCard` from the ported campaign-builder route and
  rendered it inside a `.campaign-preview-slot` wrapper below the
  Mount #4 CatalogCarousel. `showScrubber={import.meta.env.DEV}`
  toggle only. `onCta` intentionally NOT wired — the CTA click
  routes to `handleActivationUrl` / funnel-session at the preview
  page already, and the sender-side preview is decorative until the
  campaign builder gains a real preview-video-id field.
- `desktop-2/src/sections/campaigns/CampaignsSection.mount6.test.ts`
  (new) · 5 assertions (import · render inside campaign-preview-slot ·
  Mount #4 CatalogCarousel preserved above · Create + Watermark
  modal scaffolding intact · zero `bounty` in EmbedPreviewCard
  non-comment lines).

## Guard-rail summary (per guard rail sub-section per rail)

Rail 1 · security-hardening commits (08d4da2 · db14ac8 · 64f911e ·
  f706187 · e0efb2a · 333a404) untouched · verified via `git diff`.
Rail 2 · `dangerouslySetInnerHTML` in `routes/**` · 0.
Rail 3 · `if secret:` fail-open · 0.
Rail 4 · IRON GATE IG-NNN sentinel count = 25 unchanged. Every mount
  scanned target files with `grep -n "IRON GATE"` before editing.
Rail 5 · WalletDetail CLIPPERS roster still ships only the 10
  approved fictional names. Real-creator email domains still 0.
Rail 6 · No pricing / voice edits made. Cancellation-intercept &
  sync-mail-money-drop pricing (`$99.99/mo` + `$50/mo per referral`)
  unchanged. `bounty` count in mount targets = 0.
Rail 7 · Zero pushes. All 6 commits stay local on
  `feature/nav-mounting-2026-07-04`.
Rail 8 · Zero builds. tsc + vitest + cargo test only.
Rail 9 · HALT after each mount · 6 HALTs · 6 signoff-* messages ·
  every mount re-authorised before the next started.
Rail 10 · Zero regressions:
  * desktop-2 tsc: clean
  * desktop-2 vitest: 39 baseline → 70 passed
  * desktop-2 cargo: 5 baseline preserved
  * junior-backend pytest: 272 preserved
  * All Phase-7 sweeps stay at 0
Rail 11 · User-state audit table shows every primitive UNCHANGED
  (see user-state-audit.txt).
Rail 12 · No new hooks / stores / RPCs / CSS tokens. Only
  documented judgement calls: (a) reused FLOW_000_APP_SHELL for
  Mount #2's flowIds; (b) added a local `useState` inside
  AccountSection for Mount #5's modal open/close — component-local
  state, not a store.
Rail 13 · One `TODO(phase-9)` marker added (Mount #5 · Whop
  cancel-subscription RPC). No Phase-9 P1 items were fixed in
  Phase 8 commits.
Rail 14 · Branch tree respected · every commit lands on
  `feature/nav-mounting-2026-07-04` off
  `security/2026-07-04-hardening-pass` · zero rebases · zero
  merges into main.

## Phase 8 close-out results

Full test suite (all above baseline):
- desktop-2 tsc            · clean
- desktop-2 vitest         · **70 passed** / 11 test files
- desktop-2 cargo test     · **5 passed**
- account-app tsc          · clean
- marketing tsc            · clean
- junior-backend pytest    · **272 passed**

Reachability greps (each ≥ 1):
- LoginActivation in App.tsx           · 5
- SyncMailMoneyDrop in sections/outreach   · 9
- WalletDetail in sections/account         · 19
- CatalogCarousel in sections/campaigns    · 18
- CancellationIntercept in sections/account · 8
- EmbedPreviewCard in sections/campaigns   · 14

Regression greps (each = 0):
- dangerouslySetInnerHTML in routes/**  · 0
- `if secret:` fail-open in backend     · 0
- lc-default-salt live default          · 0 (only memorial comment)
- Real creator emails in routes         · 0
- CSS local grad literals in routes/**  · 0
- IRON GATE IG-NNN sentinel drift       · 0 (count 25 = baseline)

Iron-gate scripts:
- lint-kade-decoupling.sh · exit 0 · 0 output lines
- assert-kade-anchor.sh   · exit 0 · 0 output lines
- brand-kit-drift-check.sh · exit 1 · PRE-EXISTING drift in legacy
  `desktop/` (v0.7.x). `git diff security..feature/nav-mounting-2026-07-04
  -- desktop/` = 0 lines. Not a Phase 8 regression.

## Status

Section nav-mounting FULLY CLOSED · 6 mounts landed · zero drift on
Phase 7 wins · 31 new vitest assertions guard every mount from
silent revert.

Waiting for `signoff nav-mounting`. Nothing else moves until signoff.

Section B fully closed AND fully reachable end-to-end.
