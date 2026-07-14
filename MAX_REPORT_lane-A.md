# MAX_REPORT · Lane A · Product surface

**Sprint:** 2-lane cold-entry mode-B · 2026-07-10
**Lane:** A · Product surface (Tauri shell FROZEN · pure-frontend only)
**Base:** `integration/cold-entry-mode-b` @ `e02dcd2` off `codex/user-ready-clipping`
**Worktree branch:** `worktree-agent-a5526bd68ceeae460`
**Merge plan:** parent fast-forwards this worktree branch into
`integration/cold-entry-mode-b`. All commits LOCAL. No pushes / no
deploys / no tags.

## 1 · Commits

| # | Chapter                                             | SHA        |
|---|-----------------------------------------------------|------------|
| 1 | `docs(desktop-2): money-surface rule + two-pipeline pattern (Chapter 1)`                     | `a3388bef46929342f23c5a714cea5a618eb86e33` |
| 2 | `docs(desktop-2): copy 8 approved HTML mockups + 7 walkthrough MP4s (Chapter 2)`             | `8da95e6f79479abaf81141d90a93d2ed6039c831` |
| 3 | `feat(desktop-2): route Earn nav → WalletDetail · rename label to Wallet (Chapter 3)`         | `3f5cdeaf08e73fad2998a0b26634bfd2284683cc` |
| 10 | `feat(wallet-detail): full parity with approved mockup · real hooks · behavioral HQ events (Chapter 10)` | `077a650ea5949ab33b325978c832f850d940b667` |

## 2 · Chapter 1 · CLAUDE.md diff confirmation

- File created: `desktop-2/CLAUDE.md` (did not exist before this sprint).
- `## The money-surface rule (LOCKED 2026-07-10)` — landed, verbatim
  body from spec, links to `desktop-2/docs/mockups/approved/`,
  `src/routes/`, `src/design-os/routes/`.
- `## Two-pipeline pattern (LOCKED 2026-07-10)` — landed immediately
  below, spells out **Section → Design OS → BootFallback**. References
  `SectionWithFallback` by name (Lane B territory; not read or
  grepped in this worktree).

Grep proof:

```
$ grep -n "money-surface rule\|Two-pipeline pattern\|SectionWithFallback" desktop-2/CLAUDE.md
9:## The money-surface rule (LOCKED 2026-07-10)
30:## Two-pipeline pattern (LOCKED 2026-07-10)
50:   `SectionWithFallback` wrapper renders the honest boot screen instead
```

## 3 · Chapter 2 · file inventory

### Approved HTML (sha256 verified vs source · all OK)

| Source (`~/Desktop/liquidclips-marketing-hq-v2/05_html-mockups/approved/`) | Dest (`desktop-2/docs/mockups/approved/`) | sha256 |
|-----|-----|-----|
| `login-activation.html`                | `login-activation.html`                | `56b4e67f…` |
| `catalog-carousel.html`                | `catalog-carousel.html`                | `6e4f3283…` |
| `cold-email-preview-embed-card.html`   | `cold-email-preview-embed-card.html`   | `f9ebf8f1…` |
| `demo-video-placement.html`            | `demo-video-placement.html`            | `771bf1c6…` |
| `in-app-browser.html`                  | `in-app-browser.html`                  | `102225d7…` |
| `sync-mail-money-drop.html`            | `sync-mail-money-drop.html`            | `4f652f50…` |
| `wallet-detail.html`                   | `wallet-detail.html`                   | `b9bf8652…` |
| `cancellation-intercept.html`          | `cancellation-intercept.html`          | `aec7c995…` |

### Founder videos · verified vs source-folder sizes

| Source (`~/Desktop/liquidclips-marketing-hq-v2/03_assets-core/founder/`) | Dest (`desktop-2/public/brand/founder/`) | Bytes | Match |
|-----|-----|-----|-----|
| `founder-hook.mp4`   | `founder-hook.mp4`   | 3652333 | OK  |
| `founder-wallet.mp4` | `founder-wallet.mp4` | 2186567 | OK  |

Both bytes-exact match to the source folder — no replacement needed.

### Walkthrough MP4s (renamed to kebab-case)

| Source (`~/Downloads/Uncle Daniel Dropbox/…/Complete Demo Walkthroughs/`) | Dest (`desktop-2/public/brand/walkthroughs/`) | Bytes |
|-----|-----|-----|
| `01 - Clipping - Pick a Video to Clip.mp4`                | `01-clipping-pick-a-video.mp4`                    | 510605  |
| `02 - Login and Activation.mp4`                          | `02-login-and-activation.mp4`                     | 906587  |
| `03 - The Money Moment (Broadcast and Get Paid).mp4`     | `03-money-moment-broadcast-and-get-paid.mp4`      | 1152608 |
| `04 - Earn - Wallet and Payouts.mp4`                     | `04-earn-wallet-and-payouts.mp4`                  | 361810  |
| `05 - Cancellation Save.mp4`                             | `05-cancellation-save.mp4`                        | 359377  |
| `06 - In-App Browser.mp4`                                | `06-in-app-browser.mp4`                           | 692033  |
| `07 - Cold Email Preview Card.mp4`                       | `07-cold-email-preview-card.mp4`                  | 474766  |

`desktop-2/public/brand/walkthroughs/README.md` maps each MP4 to
its surface + approved HTML (see chapter 2 commit).

### New markers

- `desktop-2/docs/mockups/APPROVED_SOURCE.md` — canonical-source rule
  + current inventory table + references back to `CLAUDE.md`.
- `.gitignore` was NOT modified: neither `public/brand/walkthroughs/`
  nor `docs/mockups/approved/` was previously ignored, so the spec's
  "only modify .gitignore if being ignored" gate stays untouched.

## 4 · Chapter 3 · nav routing

Approach used: **hybrid Option 3b** — the nav item's `route` id stays
`"earn"` (RouteId union in `bridge/events.ts` does not include
`"account"`, and swapping the id would require touching that union +
every other `RouteId` consumer). Instead:

1. `ConsoleNav.tsx` · `label: "Earn"` → `label: "Wallet"` (visible
   text) + explanatory comment referencing this sprint. Route id
   `"earn"` preserved so Kade pose (`earn-mode`) + bus semantics
   don't drift.
2. `SimulatorRouter.tsx` · `SURFACE_FOR.earn` no longer renders
   `<EarnRoute />`. It renders the Section-pipeline `<WalletDetail />`
   wrapped in `<Watchdog id="money/mo-10/wallet-detail" cluster="money"
   label="Wallet Referral Ledger" source="src/routes/wallet-detail/
   WalletDetail.tsx"><EngineErrorBoundary route="account"
   component="WalletDetail">…</EngineErrorBoundary></Watchdog>`. The
   lazy chunk imports `WalletDetail` from `../../routes/wallet-detail/
   WalletDetail`. Legacy `EarnRoute` file at `src/design-os/routes/
   Earn.tsx` remains on disk (many sibling files in
   `src/design-os/earn/*` import shared primitives · dead code sweep
   deferred).
3. `SimulatorRouter.tsx` · new `ALIAS_FOR.account = { to: "earn" }`
   so any deep-link that leaks past the outer AppShell's section
   resolver still lands on `<WalletDetail />` (defensive · outer
   AppShell already maps `#/account` → `SECTION_ACCOUNT` →
   `AccountSection` → `<WalletDetail />`).
4. `BrowseOverlay.tsx` quick-link `label: "Earn"` → `label: "Wallet"`.
5. Playwright specs updated:
   - `tests/e2e/gate5-routing.spec.ts` LC-UI-P0-G5-002 · `hasText:
     "Earn"` → `hasText: "Wallet"`.
   - `tests/e2e/button-audit.spec.ts` · route case label `"Earn"` →
     `"Wallet"` (internal audit label · no user-visible impact).

Grep proof · `#/earn` and `#/account` both resolve to the WalletDetail
surface:

```
$ grep -n "earn:" desktop-2/src/design-os/routing/SimulatorRouter.tsx
80:  earn:        () => (
81:    <Watchdog
82:      id="money/mo-10/wallet-detail"
...
88:        <WalletDetailLazy />
...

$ grep -n 'account:\|"account"' desktop-2/src/design-os/routing/SimulatorRouter.tsx
131:  account:   { to: "earn" },

$ grep -n 'route: "account"\|route: "earn"' desktop-2/src/shell/sectionRegistry.ts
118:    route: "account",
```

`#/account` → outer `useHashRoute` → `SECTION_ACCOUNT` (from
`sectionRegistry.ts:117`) → `AccountSection` (already imports and
renders `<WalletDetail />` on the very first line of its return
statement · `sections/account/AccountSection.tsx:143`).

`#/earn` → outer `useHashRoute` finds no section entry with route
`"earn"` (SECTION_EARN entry was removed by UX-1-b) → falls to
`SECTION_HOME` → `HomeSection` renders `SimulatorRouter` → SimulatorRouter's
own hashchange listener grabs `#/earn` → `SURFACE_FOR.earn` renders
`<WalletDetail />`.

Nav click on the "Wallet" pill fires `bus.emit("nav:click", { route:
"earn" })` (unchanged shape) → `_lcdiag` events + Kade pose swap +
SimulatorRouter surface swap all continue to fire.

## 5 · Chapter 10 · mockup-vs-code parity table

Reading order: element description (from approved mockup) → file:line
in `desktop-2/src/routes/wallet-detail/WalletDetail.tsx` → hook or CSS
class / testid.

| Element                        | File:line                                    | Hook / class / testid                  |
|--------------------------------|----------------------------------------------|----------------------------------------|
| 6-state selector (visually hidden until admin override) | `WalletDetail.tsx:430-449` (`.wd-scrubber`)      | `WALLET_MOCKUP_STATES` const + `readAdminOverride()` (Lane B TODO) · `data-testid="wallet-state-scrubber"` |
| POWERED BY WHOP header badge   | `WalletDetail.tsx:459-467` (`.wd-whop-pill`) | `/brand/whop/whop_logo_lockup_white.svg` · `data-testid="wallet-powered-by-whop"` |
| Breadcrumb (BACK · WALLET · REFERRAL LEDGER) | `WalletDetail.tsx:494-505` (`.wd-hero-meta` + `.wd-back-btn` + `.wd-wallet-label`) | `props.onBack` |
| Filter pills (BALANCE · WHOP · INSTANT — informational eyebrow) | `WalletDetail.tsx:506-514` (`.wd-balance-eyebrow`) | Static copy: "Balance · Whop · instant" · `data-testid="wallet-filter-pills"` |
| Balance value ($X fills the moment a sub hits) | `WalletDetail.tsx:518-520` (`.wd-balance-value`) | `useWalletLedger().summary.balance_cents` → `fmtUsdCents` · `data-testid="wallet-balance"` |
| Balance subline (MRR + next payout) | `WalletDetail.tsx:521-523` (`.wd-balance-mrr`) | `mrrCents` (hidden until backend field lands) + `nextPayoutAt` → `fmtRelativeTime` |
| 4-metric row (Active · Your MRR · Lifetime · Break-even) | `WalletDetail.tsx:523-585` (`.wd-stat-row`) | See §6 · missing fields hidden with graceful degradation to `Balance / Pending / Next payout` triad · `data-testid="wallet-4-metric-row"` |
| WITHDRAW CTA                    | `WalletDetail.tsx:587-614` (`.wd-withdraw-btn`) | `runClaim` → `postWalletClaim` (from `src/lib/wallet.ts`) · disabled state routes through `claimDisabled` · `data-testid="wallet-withdraw"` |
| Your Clippers card + PAYING/ALL filter + empty | `WalletDetail.tsx:621-663` (`.wd-col` first) | Honest empty · roster field not in API today · `data-testid="wallet-clippers-card"` + `wallet-clippers-empty` |
| Recent Drops card + MONTH/LIFETIME filter + empty / populated | `WalletDetail.tsx:665-737` (`.wd-col` second) | `summary.recent_ledger` → `ledgerRowLabel` + `ledgerRowMeta` · `data-testid="wallet-drops-card"` + `wallet-drops-empty` + `wallet-drop-row` (per row) |
| Founder video (`/brand/founder/founder-wallet.mp4`) in `SafeVideo` | `WalletDetail.tsx:743-767` (`.wd-coach-thumb`) | `<SafeVideo src="/brand/founder/founder-wallet.mp4" autoPlay muted playsInline loop preload="auto" />` |
| Speech-bubble quote (Daniel's verbatim script) | `WalletDetail.tsx:768-778` (`.wd-coach-script`) | Static copy — verbatim per spec |
| CLICK FOR SOUND button          | `WalletDetail.tsx:779-788` (`.wd-coach-audio`) | `toggleMute` · `data-testid="wallet-founder-sound"` · `data-muted="true|false"` |
| Footer fine-print               | `WalletDetail.tsx:790-793` (`.wd-fine`)      | Static copy: `Withdrawals via Whop payout portal · $50 min · 5% platform fee · ACH 2-3d · or Instant fee` |

Comments called out per hidden cell so a future backend patch can flip
each one on with a single line (see `WalletDetail.tsx:283-298`).

## 6 · Real hook mapping · every visible number/list

| Visible field                         | Hook · path                                              | Backend endpoint                          |
|---------------------------------------|----------------------------------------------------------|-------------------------------------------|
| Balance value ($X.XX)                 | `useWalletLedger().summary.balance_cents`                | `GET /me/wallet/summary`                  |
| Balance subline (pending + next)      | `summary.pending_cents` + `summary.next_payout_at`       | `GET /me/wallet/summary`                  |
| Balance subline (MRR)                 | `mrrCents` · TODO(backend): `summary.monthly_recurring_referral_usd_cents` | `GET /me/wallet/summary` (field TBD) |
| Lifetime paid (`Lifetime` metric)     | `summary.pipeline.paid_usd_cents`                        | `GET /me/wallet/summary`                  |
| Active clippers (metric row)          | `activeClipperCount` · TODO(backend): `summary.affiliate_active_count` | field TBD                     |
| Your MRR (metric row)                 | `mrrCents` · TODO(backend): same field as subline        | field TBD                                 |
| Break-even ratio (metric row)         | `lifetimePaidCents / subscriptionCostCents` · TODO(backend): `summary.subscription_cost_usd_cents` | field TBD |
| Balance / Pending / Next payout fallback tiles | `balance_cents` / `pending_cents` / `next_payout_at` | `GET /me/wallet/summary`             |
| Recent drops rows                     | `summary.recent_ledger[]` (id, type, amount_cents, source, created_at) | `GET /me/wallet/summary`     |
| Withdraw CTA action                   | `postWalletClaim()` → `POST /me/wallet/claim`            | `POST /me/wallet/claim`                   |
| Withdraw signature gate               | `blocked_reason.signature_url` opens `browse-campaign` overlay, listens for `affiliate_agreement_signed` postMessage | `POST /me/wallet/claim`                   |

## 7 · Loading / empty / error state proof per card

- Loading (full-panel): `wallet-loading` testid · copy `"Loading your wallet…"` · `WalletDetail.tsx:352-357`.
- Unauthorized: `wallet-unauthorized` testid · copy `"Sign in to see your wallet"` · CTA `"Sign in"` · `WalletDetail.tsx:369-380`.
- Error: `wallet-error` testid · copy per `errorReason` (network / shape / http) · CTA `"Retry"` → `refetch()` · `WalletDetail.tsx:401-411`.
- Empty (Your clippers): `wallet-clippers-empty` testid · copy `"Send outreach from the money-moment window · every clipper who subs = $50/mo, for LIFE"` · `WalletDetail.tsx:657-660`.
- Empty (Recent drops): `wallet-drops-empty` testid · copy `"0 drops so far · The moment a clipper subs, their $50 lands here instantly"` · `WalletDetail.tsx:696-701`.
- Populated ledger row: `wallet-drop-row` testid · each row carries `data-ledger-type` · `WalletDetail.tsx:711-733`.

Grep proof of copy strings:

```
$ grep -n 'money-moment window\|0 drops\|Loading your wallet\|Wallet briefly out of reach\|Sign in to see your wallet' desktop-2/src/routes/wallet-detail/WalletDetail.tsx
354:              <div className="wd-full-title">Loading your wallet…</div>
371:              <div className="wd-full-title">Sign in to see your wallet</div>
403:              <div className="wd-full-title">Wallet briefly out of reach</div>
658:                  Send outreach from the money-moment window · every
697:                    <b>0 drops</b> so far.
```

## 8 · Watchdog + EngineErrorBoundary code snippet

Wrap lives at the SimulatorRouter mount point (not inside `WalletDetail`
itself, so both mount paths — via SimulatorRouter and via AccountSection —
share the same error contract without wrapping twice):

```tsx
// desktop-2/src/design-os/routing/SimulatorRouter.tsx:80-91
earn: () => (
  <Watchdog
    id="money/mo-10/wallet-detail"
    cluster="money"
    label="Wallet Referral Ledger"
    source="src/routes/wallet-detail/WalletDetail.tsx"
  >
    <EngineErrorBoundary route="account" component="WalletDetail">
      <WalletDetailLazy />
    </EngineErrorBoundary>
  </Watchdog>
),
```

The AccountSection mount (outer AppShell → `#/account`) already wraps
its own concerns with a distinct `Watchdog id="agency/ag-13/cancel-
subscription"` (see `AccountSection.tsx:144-149`); the wallet crash
budget there is inherited from the outer `AppShell` boundary.

## 9 · HQ event proof (all behavioral · no `*_rendered`)

```
$ grep -n "lcDiag(" desktop-2/src/routes/wallet-detail/WalletDetail.tsx
122:    lcDiag('wallet_viewed', { state: uiState });
126:    lcDiag('wallet_state_viewed', { state: visibleMockupState, first_view_of_state: true });
138:    lcDiag('wallet_state_viewed', { state: visibleMockupState, first_view_of_state: firstView });
169:    lcDiag('withdraw_clicked', { available_cents: availableCents });
174:    lcDiag('withdraw_failed', { reason: 'network' });
189:    lcDiag('withdraw_failed', { reason: 'signature_frozen' });
193:    lcDiag('withdraw_failed', { reason: res.blocked_reason.code });
199:    lcDiag('withdraw_succeeded', { amount_cents: releasedCents });
247:    lcDiag('founder_video_started', { surface: 'wallet-detail', video_file: 'founder-wallet.mp4' });
261:    lcDiag('founder_video_finished', { surface, seconds_watched });
340:    lcDiag('withdraw_disabled', { reason });
```

All 8 required event topics landed:

- `wallet_viewed` (line 122)
- `wallet_state_viewed` (lines 126 + 138 · fires on mount + on
  state-scrubber change with `first_view_of_state` bool)
- `founder_video_started` (line 247 · fires the first time the user
  unmutes the video)
- `founder_video_finished` (line 261 · on `<video>` ended)
- `withdraw_clicked` (line 169)
- `withdraw_succeeded` (line 199 · amount_cents from claim response)
- `withdraw_failed` (lines 174 / 189 / 193 · one per reason branch)
- `withdraw_disabled` (line 340 · fires when disabled reason changes)

Grep confirms zero `*_rendered` events:

```
$ grep -c "_rendered'" desktop-2/src/routes/wallet-detail/WalletDetail.tsx
0
```

## 10 · Perf-budget confirmation

| Rule                                              | New TSX code adds any? | Verified via |
|---------------------------------------------------|------------------------|---------------|
| Static posters (no dynamic poster fetch)          | No · poster prop dropped after found `/brand/founder/founder-wallet-poster.png` didn't exist on disk. `SafeVideo` renders `video unavailable` if the source fails — no fake poster shown. | `grep poster desktop-2/src/routes/wallet-detail/WalletDetail.tsx` → zero hits |
| No new `backdrop-filter: blur()`                  | No new adds. Pre-existing violations in `WalletDetail.css:68 + 653` remain (scrubber + toast) but are NOT touched. | `git diff a3388be~1..HEAD -- desktop-2/src/routes/wallet-detail/WalletDetail.css` shows no CSS changes |
| No new infinite CSS animations                    | No new keyframes / `infinite` added. Pre-existing `wd-pulse` remains, not touched. | Same diff proof |
| Transitions ≤ 100ms                               | No new inline transitions in the TSX. Pre-existing values in the CSS untouched. | Same diff proof |
| transform / opacity only                          | No new inline styles other than the visually-hidden scrubber's `clip: rect(0 0 0 0); clipPath: inset(50%); position: absolute; overflow: hidden;` (visually-hidden pattern · not a paint animation). | `WalletDetail.tsx:441-444` |
| `contain: layout paint style` where safe          | Not added — safer to defer to a CSS pass since the mockup layout leans on `overflow: visible` for hover cards. | Documented as follow-up |
| No polling                                        | Confirmed. No `setInterval` / `useInterval`. Only single-fire `useEffect` on mount + `useEffect` on `visibleMockupState` change (idempotent · no fetches). | `grep -n "setInterval\|useInterval" desktop-2/src/routes/wallet-detail/WalletDetail.tsx` → zero hits |
| No route-level remounts                           | Confirmed. `useWalletLedger()` uses module-level shared cache (see `src/lib/wallet.ts:487-558` for the salvaged shared hook). WalletDetail mounts once per SimulatorRouter switch + once inside AccountSection — both mount points share the fetch. | Reading `src/lib/wallet.ts` |

## 11 · `npx tsc --noEmit`

```
$ cd desktop-2 && npx tsc --noEmit
$ echo $?
0
```

Clean (no output = zero diagnostics). Note: I symlinked
`/Users/dipdip/code/jnr/desktop-2/node_modules` into the worktree
`desktop-2/node_modules` (regular file · not committed) so tsc could
resolve deps.

## 12 · `npm test`

```
$ cd desktop-2 && npm test
> liquid-clips-shell@2.2.35 test
> vitest run

 Test Files  17 passed (17)
      Tests  135 passed (135)
   Duration  8.28s
```

## 13 · No Rust / Cargo / tauri.conf / package.json / sidecar edits

```
$ git log --oneline a3388be~1..HEAD -- desktop-2/src-tauri/ desktop-2/package.json desktop-2/pnpm-lock.yaml desktop-2/pnpm-workspace.yaml
(empty)
```

No touches to shell / native / manifests / package files across all
four Chapter commits.

## 14 · No Lane B territory touches

```
$ git log --oneline a3388be~1..HEAD -- desktop-2/src/components/SectionWithFallback.tsx junior-backend/app/routes/admin_state_override.py junior-backend/alembic/versions/ account-app/src/components/admin/StatePuppeteerTab.tsx account-app/src/components/admin/JourneyMapTab.tsx
(empty)

$ ls desktop-2/src/components/SectionWithFallback.tsx
ls: desktop-2/src/components/SectionWithFallback.tsx: No such file or directory
(Lane B territory · not present at HEAD)
```

## 15 · Screenshot / testid list for parent verification

**Honest absence:** I cannot spin up a running Tauri window from the
worktree without running `tauri:dev` (Rust build side-effects · shell
FROZEN gate) and the surface requires a signed-in Whop session I don't
have in this environment. No screenshot attached.

Instead, the surface exposes 24 `data-testid` hooks the parent /
Playwright can use to verify each Chapter 10 element rendered:

- `wallet-loading` · `wallet-unauthorized` · `wallet-sign-in` · `wallet-error` · `wallet-retry`
- `wallet-state-scrubber` (visually hidden until Lane B override lands)
- `wallet-powered-by-whop`
- `wallet-expired-banner`
- `wallet-filter-pills`
- `wallet-balance`
- `wallet-4-metric-row` · `wallet-stat-active` · `wallet-stat-mrr` ·
  `wallet-stat-lifetime` · `wallet-stat-break-even` · `wallet-stat-
  balance` · `wallet-stat-pending` · `wallet-stat-next-payout`
- `wallet-withdraw`
- `wallet-clippers-card` · `wallet-clippers-empty`
- `wallet-drops-card` · `wallet-drops-empty` · `wallet-drop-row`
- `wallet-founder-video` · `wallet-founder-sound`
- `wallet-claim-toast`

## Follow-ups (not blockers · surfaced honestly)

1. Legacy Design-OS `EarnRoute` at `src/design-os/routes/Earn.tsx` still
   exists on disk with an unused lazy import path in `SimulatorRouter`.
   I removed the `SURFACE_FOR.earn` binding but did not delete
   `Earn.tsx` — many peer files under `src/design-os/earn/*` import
   shared primitives from it. Full sweep deferred to a follow-up sprint.
2. Four visible fields (`activeClipperCount`, `mrrCents`,
   `subscriptionCostCents`, `breakEvenRatio`) hide their tiles until
   the backend surfaces them on `/me/wallet/summary`. Comment blocks in
   `WalletDetail.tsx:283-298` flag each with `TODO(backend):` and the
   exact field name to add.
3. Admin state-override scrubber is present but visually hidden —
   `readAdminOverride()` is a `TODO(lane-b)` stub. Wire once
   `admin_state_override.checkOverride('wallet-detail')` ships.
4. Founder-wallet poster (`/brand/founder/founder-wallet-poster.png`)
   is not on disk. `SafeVideo` will render `video unavailable` if the
   source ever 404s. Ideal follow-up: capture a first-frame poster
   from `founder-wallet.mp4` and drop it here.
