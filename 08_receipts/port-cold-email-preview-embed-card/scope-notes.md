# Scope notes · Port · cold-email-preview-embed-card

## Section B port #7 · component (not a route)

Source: `05_html-mockups/approved/cold-email-preview-embed-card.html`
Target: `desktop-2/src/routes/campaign-builder/EmbedPreviewCard.tsx`

Slotted into the campaign-builder hero for SENDER-side preview.
Sender opens the campaign builder and sees this card as it would
land in the recipient's Gmail preview pane (Gmail preview pane is
360-420px wide · card is 640px max with mobile responsive at 480px).

The MARKETING-SITE version — where the actual recipient lands from
the cold email — is HQ's territory in a future handoff. This port
covers the sender preview only.

## 7 states covered (D2 v1.1)

| # | State                 | Kade pose                       | CTA slot                                |
|---|-----------------------|---------------------------------|-----------------------------------------|
| 1 | `loading`             | `kade-generating-captions`      | Unlock everything · $99.99 (shimmered)  |
| 2 | `populated`           | `kade-earn-mode`                | Unlock everything · $99.99              |
| 3 | `empty_catalog`       | `kade-idle`                     | See what we tried                        |
| 4 | `critical_countdown`  | `kade-warning`                  | Unlock now · $99.99                     |
| 5 | `already_settled`     | `kade-success`                  | Open Liquid Clips                        |
| 6 | `expired`             | `kade-hover`                    | Rescan my channel next quarter           |
| 7 | `offline`             | `kade-error`                    | Try again                                |

Countdown ticks live when state === populated (proves the card
feels alive during Daniel's walk). Every other state uses static
countdown or `——:——:——` skeleton.

## Brand-kit §13 compliance

§13a Currency lock:
  - Mockup used £99.99 across every render slot (historical GBP).
  - Port swaps to $99.99 per §13a USD lockup.
  - `£` rendered occurrences: **0** (docstring comment reworded).
  - `$99.99` occurrences: **10** (balance amount + CTA labels
    across all states).

§13b Voice:
  - `bounty` occurrences: **0**.
  - Copy uses "clips" · "unlock" · "scan your channel" per §13b
    19yo-clipper voice.

§13c Whop lockup: N/A. This card is the Liquid Clips delivery-node
branding (cold-email frame), not a Whop paywall. No Whop pill on
this surface.

§13d Halo bleed: N/A (no Whop pill).

§13g Kade reuse: all 7 poses from the approved 24. All verified
present on disk in `desktop-2/public/brand/kade/`. `kade-warning`
is the "Special" pose for the critical countdown state (per §13g
"Special: shooter · hover · warning (soft error)").

## §5 HUD vocabulary

- 4 bracket corners on the card (`::before`, `::after`,
  `.epc-hud-tr`, `.epc-hud-br`) at fuchsia @ 0.9 opacity.
- Scanline overlay pinned inside card (`mix-blend-mode: overlay`).
- Fuchsia-only accent throughout. Cyan reserved for the
  `empty_catalog` banner only (§2 discipline: cyan is decoration,
  not CTA).

## Component API

- `showScrubber` · defaults to `import.meta.env.DEV`. When true,
  the dev-walk stage renders (viewport-fill + scrubber). When
  false, the component renders bare — parent (campaign-builder
  hero) provides its own layout wrapper.
- `initialState` · defaults to `'populated'` (the sender preview
  default).
- `onCta(key, state)` · called on primary CTA click. `key` is one
  of `unlock`, `reactivate`, `open-desktop`, `explore`, `retry`
  so the campaign-builder shell can route accordingly (e.g. show
  a "you've picked the money state · locked in for the recipient
  view" toast).
- `handle` / `handleSub` / `handleInitials` · optional recipient
  overrides. Defaults preview against Marques Brownlee.

## Panel-design-lens

Scan units: 7 (node header · state banner [1 visible per state]
· batch strip · status ledger · balance row · CTA · signature).
Kade avatar is decoration, not counted.

One primary CTA per state · fuchsia glow · full-width.
No competing tokens.

## Wire hooks

- No Tauri IPC.
- No backend fetches from this component. Campaign-builder shell
  can drive the state via `initialState` and inspect `onCta`
  clicks to pipeline into whatever action the sender takes.

## Iron gates

- IG-005 workspace UI untouched.
- No `src-tauri/` changes.
- IG-012 brand tokens read from `src/brand/brandTheme.css`.

## Regression

- tsc --noEmit · green
- vitest run · 26 passed / 3 files
- No new npm deps

## Daniel's walk

1. `cd desktop-2 && npm run tauri:dev`
2. Mount the component with `showScrubber` (dev auto-shows it).
3. Cycle states 1 → 7 in order.
4. State 2 (populated) countdown ticks live · Kade earn-mode
   bottom-right.
5. State 4 (critical_countdown) card border pulses fuchsia ·
   Kade warning bottom-right.
6. State 5 (already_settled) balance amount line-through · Kade
   success bottom-right.
7. `signoff port-cold-email-preview-embed-card` when satisfied.
