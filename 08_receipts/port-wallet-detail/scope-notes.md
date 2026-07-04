# Scope notes · Port · wallet-detail

## What ships

- `desktop-2/src/routes/wallet-detail/WalletDetail.tsx` ·
  6-state React component covering the full D2 v1.1 slug map:
  `fresh-install` · `populated` · `hover-marques` · `hover-ali` ·
  `hover-airrack` · `hover-johnny`. Renders the hero (balance + 4
  stat cards + withdraw), the two-column body (clippers + drops
  feed), and the footer (coach bubble + fine print). Coach video
  = `/brand/founder/founder-wallet.mp4` (Daniel's affiliate
  transcript · 33 sec).
- `desktop-2/src/routes/wallet-detail/WalletDetail.css` ·
  ports every visual primitive: panel + Whop pill + panel-clip
  scanlines, hero balance ($46px tabular-num), stat card row,
  withdraw button (fuchsia glow), clipper row grid (32/1fr/auto/
  auto), status pill ladder (paid · streak · missed · cancelled),
  drop feed row, floating hover card (`position: fixed`), 72×72
  Kade avatar rim on the hover card, coach bubble oblong pill,
  fine-print line. Brand tokens from `src/brand/brandTheme.css`
  with five local helpers (`--wd-paper-slate`, `--wd-fuchsia-rim`,
  `--wd-fuchsia-soft`, `--wd-line-vivid`, `--wd-amber`) — amber
  is scope-limited to the `is-missed` state pill per mockup and
  does not appear as a CTA color.

## Hover uses page.hover() · NOT data-state (D2 v1.1)

Rows carry `data-tile` attributes so Playwright's `page.hover()`
targets them directly:

| Hover state       | data-tile slug     | Kade pose      |
|-------------------|--------------------|----------------|
| `hover-marques`   | `streak-row-0`     | `celebration`  |
| `hover-ali`       | `paid-row-1`       | `success`      |
| `hover-airrack`   | `missed-row-0`     | `error`        |
| `hover-johnny`    | `cancelled-row-0`  | `idle`         |
| Emma (secondary streak) | `streak-row-1` | `celebration` |
| Casey · Cleo · Colin · Simone · Marina | `paid-row-{0,2,3,4,5}` | `success` |

Native `:hover` + `onMouseEnter` handler position the fixed hover
card next to the row. When Playwright fires `page.hover(<selector>)`,
the same React state path fires — no test-only branch.

## Pricing lock

$50/mo per referral · 50% of the $99.99 founder-cohort price.
Matches the sync-mail port fix commit (2f4f22e). Zero references
to $100/mo remaining. Roster shows 15 paying clippers × $50 =
$750/mo · balance $247.50 (mid-cycle) · lifetime $1,485.

## What did NOT change (scope-out honored)

- No changes to existing `src/design-os/earn/WalletPanel.tsx`
  (that's the pre-port legacy panel). This lands as a NEW route,
  parent shell wires when Daniel greenlights.
- No changes to `src/lib/wallet.ts`, `me/wallet/summary` fetcher,
  or `whop_payments.py` on the backend.
- No new npm deps.
- Voice audit: zero `bounty` occurrences.

## Assets

Copied into `desktop-2/public/brand/`:
- `founder/founder-wallet.mp4` (Daniel's coach video)
- `kade/kade-celebration.webp` · `kade-success.webp` ·
  `kade-error.webp` · `kade-idle.webp` (already present)
- `whop/whop_logo_lockup_white.svg` (already present)

## Daniel's walk

1. `npm run tauri:dev` (from desktop-2)
2. Mount the route (dev scrubber top-left)
3. Click scrubber state 1 (fresh-install) → hero balance dim,
   clipper list shows the empty hint
4. Click 2 (populated) → 15 paying rows, drops feed active,
   withdraw enabled
5. Hover Marques' row → paid + streak card with `celebration`
   Kade top-right
6. Hover Airrack's row → grace card with `error` Kade
7. Hover Johnny's row → cancelled card with `idle` Kade
8. Tap coach bubble → founder-wallet.mp4 unmutes + restarts

## Regression

- tsc --noEmit · green
- vitest run · 26 passed / 3 files (F5 / F6 tests untouched)
- No IG-005 sentinels touched (this is a new route, not a
  workspace redesign)
