# Scope notes · Port · catalog-carousel

## Section B port #5 · F9 YouTube catalog

Source: `05_html-mockups/approved/catalog-carousel.html`.
Target: `desktop-2/src/routes/catalog/`.

Wires: F9 — YouTube catalog carousel. Layer 4 (F7 YT worker · in
G2) will pass the real `POST /yt/batch-lookup` response through the
optional `tiles` prop when it ships; the port renders demo tiles by
default so the route walks cleanly in `npm run tauri:dev` today.

## 6 states covered (D2 v1.1)

| # | State     | Kade pose                    | Behaviour                              |
|---|-----------|------------------------------|----------------------------------------|
| 1 | `empty`   | `kade-idle`                  | Cyan empty-hint banner · rail hidden   |
| 2 | `loading` | `kade-generating-captions`   | All 10 tiles shimmer                   |
| 3 | `partial` | `kade-cutting-clips`         | Tiles 1-6 loaded · 7-10 shimmer        |
| 4 | `ready`   | `kade-success`               | Default clean 10-tile grid             |
| 5 | `error`   | `kade-error`                 | Red error banner · rail hidden         |
| 6 | `focused` | `kade-earn-mode`             | Tile v3 highlighted + scrolled center  |

## Brand-kit §13 compliance

- **§13a Pricing** — paid-user Library surface · zero pricing
  tokens in-code (0 occurrences of `$100/mo` · 0 of `$50`). Nothing
  to break the founder-cohort math.
- **§13b Voice** — `bounty` occurrences: 0. Copy uses "clip", "clips
  ready", "your videos".
- **§13c Whop lockup** — n/a on this surface (not a paywall /
  wallet / affiliate route).
- **§13d Halo bleed** — n/a (no Whop pill on this surface).
- **§13f Approved mockup** — this port sources the approved mockup
  at `05_html-mockups/approved/catalog-carousel.html`.
- **§13g Kade reuse** — all 6 poses come from the approved 24. No
  new gen. Poses verified present on disk in
  `desktop-2/public/brand/kade/`.

## §5 HUD vocabulary honored

- 4 bracket corners at 18px on the shell (::before, ::after,
  .cat-hud-tr, .cat-hud-br) at fuchsia @ 0.9 opacity.
- Scanline overlay on shell (mix-blend-mode: overlay).
- Cockpit-tile motion vocabulary on each rail tile (hover lift +
  play overlay + fuchsia border on hover).
- Fuchsia-only accent throughout (20 refs to `--color-fuchsia`).
  Cyan used for the mode badge only (§2 discipline: cyan is
  decoration, never a CTA).

## §7 iconography

- No Pixel Invader on this route (not a mission-control /
  splash / deploy surface).
- Chevron arrows for scroll are single glyphs (`‹` `›`) —
  no icon library on this surface.
- Play triangle is a pure-CSS triangle (transparent borders +
  fuchsia fill + drop-shadow).

## Panel-design-lens (§13 baseline)

- **Scan units** ≤ 7:
  1. Kade avatar
  2. Header title + sub
  3. Mode badge
  4. Carousel shell (rail)
  5. Prev arrow
  6. Next arrow
  7. Below-strip context
- **1 primary CTA per tile** — the ghost-outline "Open in editor"
  button (tile itself + explicit button both call `onClipClick`).
- No competing primary tokens on the surface.

## Iron gates

- IG-005 (workspace UI): untouched. New route, no design-os
  route changes.
- IG-012 (brand tokens): read from `src/brand/brandTheme.css` ·
  no drift from the canonical block.

## Wire hooks

- `props.tiles` · optional injected list · Layer 4 F7 wire lands
  the real `/yt/batch-lookup` response here without touching this
  file.
- `props.onClipClick(tile)` · fires on tile click / CTA click ·
  parent shell routes to Editor with the picked video.
- No Tauri IPC on this surface · pure React.

## Regression

- tsc --noEmit · green
- vitest run · 26 passed / 3 files
- No IG-005 sentinels touched · no `src-tauri/` changes
- No new npm deps

## Daniel's walk

1. `cd desktop-2 && npm run tauri:dev`
2. Mount the route (dev scrubber top-left · 6 buttons)
3. Cycle 1 → 6 in order
4. On `focused` the middle tile (v3 · "Best of CES 2025") auto-
   scrolls to center + gets the fuchsia focus ring
5. Hover any tile → play triangle + fuchsia border lift
6. Click tile or "Open in editor" → `onClipClick` fires
7. `signoff port-catalog-carousel` when satisfied.
