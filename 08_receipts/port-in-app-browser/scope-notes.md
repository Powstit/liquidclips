# Scope notes · Port · in-app-browser

## What ships

- `desktop-2/src/routes/in-app-browser/InAppBrowser.tsx` ·
  11 states covering the full D2 v1.1 slug map + 2 new
  additions for the sync-mail button family:

  | # | State                | Kade pose               | Intent    |
  |---|----------------------|-------------------------|-----------|
  | 1 | `default`            | `kade-community-mode`   | whop      |
  | 2 | `loading`            | `kade-community-mode`   | whop      |
  | 3 | `error`              | `kade-error`            | whop      |
  | 4 | `maximized`          | `kade-community-mode`   | whop      |
  | 5 | `gmail-inbox`        | `kade-idle`             | gmail     |
  | 6 | `whop-checkout`      | `kade-earn-mode`        | checkout  |
  | 7 | `youtube-auth`       | `kade-idle`             | youtube   |
  | 8 | `engine-consumable`  | `kade-idle`             | engine    |
  | 9 | `add-shortcut-open`  | `kade-community-mode`   | whop      |
  | 10 | `outreach-inbox`   *new* · `kade-hover`     | outreach  |
  | 11 | `other-mail-linked` *new* · `kade-hover`   | outreach  |

- `desktop-2/src/routes/in-app-browser/InAppBrowser.css` ·
  full chrome: whop pill (top-center), HUD brackets, scanline
  overlay, chrome header (traffic lights + intent pill +
  domain + close/max/system-browser buttons), toolbar (nav
  cluster + address bar with lock glyph + Use-in-Engine
  cyan pill + sync-mail button family), quick-links row,
  body split (56px rail + webview slot), Kade avatar
  positioned bottom-right of webview slot, floating
  add-shortcut form (opens on rail `+`).

## sync-mail button family (Daniel 2026-07-04)

Two buttons in the toolbar-actions cell:

- **Sync Gmail** (primary fuchsia · `iab-sync-mail-btn`) → calls
  `props.onSyncGmail` (parent wires to Layer 2 F5 OAuth flow)
  + sets state → `gmail-inbox`.
- **Other** (quiet outline · `iab-sync-mail-btn is-quiet`) →
  calls `props.onSyncOther` (stub for now · full flow ships
  as its own mini-layer post-G1) + sets state →
  `other-mail-linked`. Shows a "Coming: Outlook · iCloud ·
  Custom domain" list.

Both buttons carry title tooltips for the walk. No inline
popover; each button is its own single-tap action, matching
the mockup's single-purpose CTA rule.

## Rust bridge

browse.rs untouched · `src-tauri/src/browse.rs` receives no
edits from this port. The port is chrome-
only; the actual webview slot in production is painted by
the existing Rust child WebView (Layer 5 will harden it in
G2). The mock in this port lives in the same slot geometry so
Rust bounds don't need updating.

## Pricing lock

$99.99/mo (Whop checkout state) · matches sync-mail port fix
2f4f22e + wallet-detail port 2eace65. Zero references to
$100/mo remaining.

## Voice / branding checks

- Banned word `bounty` → zero occurrences.
- Brand tokens from `src/brand/brandTheme.css` with 8 local
  helpers (all inside the one-fuchsia rule; the `--iab-amber`
  helper is scope-limited to Gmail intent + Community quick-
  link · never a CTA color · matches mockup).
- Whop pill floats on the top border of the overlay (same
  primitive as ports 1-3).

## What did NOT change (scope-out honored)

- `src-tauri/src/browse.rs` untouched.
- `src/components/browser/BrowseOverlay.tsx` untouched · this
  lands as a new route; parent shell wires when Daniel
  greenlights.
- No new npm deps.

## Daniel's walk

1. `cd desktop-2 && npm run tauri:dev`
2. Mount the route (dev scrubber top-left · 11 buttons)
3. Cycle through 1 → 11 in order
4. On state 5 (gmail-inbox) tap "Sync Gmail" → triggers the
   F5 OAuth handler if parent shell wired it
5. On any state tap "Other" → jumps to state 11
   (other-mail-linked) showing Outlook/iCloud/Custom
6. On state 9 rail `+` opens the add-shortcut form
7. `signoff port-in-app-browser` when satisfied.

## Regression

- tsc --noEmit · green
- vitest run · 26 passed / 3 files (F5 · F6 tests untouched)
- No IG-005 sentinels touched (new route, no workspace
  redesign)
- No `src-tauri/` changes
