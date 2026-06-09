# Cockpit — final scope (v0.7.18)

The locked design after the v6 walkthrough. Three changes vs current demo. Everything else holds from `COCKPIT_LENS_SCOPE.md` and `CLIP_DASHBOARD_REWRITE_SCOPE.md`.

## 1. Frame template tiles — match the visual language

Replace the elaborate mini-frame previews with **clean dark rounded squares** that match Daniel's reference shot. The pattern:

- Tile = `40×40` rounded-lg (`8px` radius) dark grey square (`#1c1c25`)
- Inner shape uses a single muted grey fill (`rgba(200,196,190,0.18)`) to indicate layout — no glow, no gradient, no fuchsia accent on inactive tiles
- Hover: subtle border lighten + 2px lift, NO scale
- **Selected**: fuchsia bg (`rgba(255,26,140,0.18)`), inner shape becomes a fuchsia-bright (`#ff3da5`) rounded pill — same as the reference image
- Layout indicators (geometric, single-fill):
  - `none` → small filled square centered
  - `split-h` → top half filled (`50%` height bar at top)
  - `split-v` → left half filled
  - `pip-br` / `pip-tl` → small `10×8` filled rect in the corner
  - `react` → small filled circle top-right corner
  - `frame` → two thin bars top + bottom
  - `lower` → bottom-third filled bar
  - `captions` → three thin stacked bars in lower half

Row count visible inline: **8** tiles fit at the cockpit's available width.

## 2. Carousel-style "focused panel" — kill the cram

Current cockpit shows 4 modules + Master side-by-side. Each module gets ~280px and ends up cramped (Caption has 4 pills + an input + a swatch in 280px — claustrophobic).

Replacement: **state-pill nav + focused panel + persistent Master.**

### Layout

```
┌─ status strip ─────────────────────────────────────────────────────┐
│ target · LEDs · brief · streak · counters                          │
├─ state pills row ──────────────────────────────────────────────────┤
│ [Channels: 2 routed]  [Caption: brand]  [Frame: 9:16 · pip-br]    │
│   [When: now]                                                      │
├─ focused panel (slide) ────────────────────────┬─ Master (sticky) ─┤
│                                                │                   │
│  <controls for whichever pill is active>      │   pixel-invader    │
│  ~3× more breathing room than current crammed │   DEPLOY           │
│                                                │   [ schedule ]    │
│                                                │   [ autopilot ]   │
└────────────────────────────────────────────────┴───────────────────┘
```

### Behaviour

- **State pills** always show current value in `[ brackets ]` mono-lowercase ("Channels [2 routed]", "Caption [brand fuchsia]", "Frame [9:16 · pip-br]", "When [now]"). Click a pill → its section's controls become the focused panel.
- **Focused panel** transitions with a 240ms `cubic-bezier(.22, 1, 0.36, 1)` slide-fade — out 120ms, in 120ms.
- **Default focus**: Channels (the first decision the clipper makes).
- **Auto-advance hint**: after the clipper picks a value in the focused section, a small `→ next: Caption` pill appears at the bottom-right of the panel. Tapping it advances to the next pill. Skippable; not forced.
- **Master stays pinned right** at all times — sized larger (310px wide), with the pixel-Invader, DEPLOY eyebrow, big SCHEDULE pill, hint line, AUTO-PILOT (cyan, see §3).

### Why not tabs / why not keep current

- Tabs hide state. Pills show state in their label, so even the inactive sections are scannable.
- Carousel (swipe paginate) confuses keyboard users.
- The focused-panel pattern is exactly what video editors use for tool palettes (Premiere effects panel, Resolve inspector tab).

### State-pill shape

```
[ {Icon}  Channels  · 2 routed  ]
```

- Lucide icon (16px) left, name (Inter 13px semibold), state value in mono after a `·` separator.
- Active pill: `bg-fuchsia/16` + `border-fuchsia/55` + `text-fuchsia-deep`
- Inactive: `bg-paper-warm` + `border-line` + `text-ink-soft`
- Hover: lift `-2px`, border → `fuchsia/35`

## 3. Cyan accents, not gold

Drop amber/gold from any **status-indicator** pill. Keep amber **only** for OAuth-needs-finishing ("finish linking") because that's an action-required warn, not a status nuance.

Targets to swap **amber → cyan-cool (`#00e5ff`)**:

- **Mixed-state dots** on channel bus chips (when some target clips have the platform routed and others don't)
- **Mixed-state eyebrow** colour on module summaries ("[ mixed ]")
- **Mixed-state caption preview** text colour
- **Mixed-state "captions burned" toggle** colour

**Streak pill** (top status strip) — drop the fuchsia/amber gradient. Use a single fuchsia tone — the streak is a positive signal, fuchsia is right, no need for gold.

**Auto-pilot pill** — stays cyan (already correct).

This keeps the brand discipline: fuchsia for positive/action, amber for action-required warning, cyan for "different from default but neither good nor bad" (mixed state, auto-pilot suggestion, OASIS key-light decoration).

## File checklist for Kimi

```
desktop/src/components/clips-feed/GridMasterToolbar.tsx
  └─ promote to bottom dashboard (per CLIP_DASHBOARD_REWRITE_SCOPE.md)
desktop/src/components/cockpit/CockpitPanel.tsx                 (NEW)
  └─ state-pill nav + focused-panel slide
desktop/src/components/cockpit/CockpitChannels.tsx              (NEW)
desktop/src/components/cockpit/CockpitCaption.tsx               (NEW)
desktop/src/components/cockpit/CockpitFrame.tsx                 (NEW)
desktop/src/components/cockpit/CockpitWhen.tsx                  (NEW)
desktop/src/components/cockpit/CockpitMaster.tsx                (NEW — extracts the SCHEDULE + AUTO-PILOT)
desktop/src/components/cockpit/StatePill.tsx                    (NEW — the reusable pill nav chip)
desktop/src/components/clips-feed/FrameTile.tsx                 (NEW — single template tile, used both in cockpit + modal)
desktop/src/index.css
  └─ swap amber → cyan-cool on .bus-mixed-dot + caption-summary mixed state
```

Ten files, four of which are new section components. No new packages.

## Acceptance

- All 5 sections operable via mouse + keyboard (arrow keys between pills, Tab through controls).
- Master always visible regardless of which section is focused.
- State pills update value on every state change so the inactive sections stay truthful.
- Frame tiles look identical to Daniel's reference shot (clean grey + fuchsia selected, no elaborate mini-renders).
- Zero amber on mixed-state indicators (audit grep: `bg-amber`, `text-amber`, `border-amber` should only appear in the OAuth-finish-linking rescue card).

## Pairs with

- `CLIP_DASHBOARD_REWRITE_SCOPE.md` — the structural rewrite (Add-clip → duplicate, kill per-card InlineScheduler, promote MasterToolbar to bottom)
- `COCKPIT_LENS_SCOPE.md` — the lens audit (data states + journey + cut list)
- `liquid-clips-brand-kit` skill — the brand discipline these compositions inherit
