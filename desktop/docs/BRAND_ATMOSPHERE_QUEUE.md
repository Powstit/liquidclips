# Liquid Clips · Brand Atmosphere Queue

The revelation: the brand isn't in the content (clips are the user's), it's in the **atmosphere wrapping the content**.

This file maps each gpt-image-1 generated plate to the live workspace surface it dresses, the brand contract it satisfies, and the CSS hook that drops it in.

Brand contract: `~/.claude/skills/liquid-clips-brand-kit/SKILL.md`
Reference success: `docs/demo-assets/cockpit-deck-cover.png` (the proof-of-pattern from the v3 demo).
Output dir: `docs/demo-assets/`

---

## 🌌 Deck atmospheres (5)

One per workspace deck. Dropped at low opacity inside the deck's outermost panel so it sits *behind* the chrome but in front of `--color-paper`.

| File | Deck | Drop point | Opacity | Emotional purpose |
|---|---|---|---|---|
| `atmosphere-workspace.png` | WorkspaceRoom | `.deck-workspace` `::before` background-image | 0.18 | Creation, atelier |
| `atmosphere-library.png` | LibraryRoom | `.deck-clips` `::before` | 0.14 | Archive, contemplation |
| `atmosphere-earn.png` | EarnRoom | `.deck-earn` `::before` | 0.20 | Arena, momentum |
| `atmosphere-schedule.png` | ScheduleRoom | `.deck-schedule` `::before` | 0.16 | Mission control |
| `atmosphere-settings.png` | SettingsRoom | `.deck-settings` `::before` | 0.10 | Loadout, settled |

CSS hook pattern:
```css
.deck-workspace::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: url("/assets/atmospheres/atmosphere-workspace.png");
  background-size: cover;
  background-position: center;
  opacity: 0.18;
  pointer-events: none;
  z-index: 0;
}
.deck-workspace > * { position: relative; z-index: 1; }
```

---

## 🎭 State plates (4)

For states the live app currently dresses in a CSS gradient or empty `<div>`. Each replaces a flat placeholder with a brand-DNA atmosphere.

| File | State | Drop point | Replaces |
|---|---|---|---|
| `state-empty-hero.png` | "Drop a video to start" empty grid | `<EmptyState>` background plate | CSS radial gradient |
| `state-bake-failed.png` | Failed render strip backdrop | `<BakeFailedStrip>` background | Solid red tint plate |
| `state-offline.png` | Sidecar lost / reconnecting | `<OfflineOverlay>` background | Dimmed app + spinner |
| `state-cmd-k.png` | ⌘K command palette spotlight | `<CommandPalette>` backdrop layer | `backdrop-filter: blur` only |

These are the four hero "the air around me changed" moments. Currently the live app handles each with a flat gradient or no plate at all.

---

## 🎯 Interaction plates (2)

For transient moments the app currently has no atmosphere for.

| File | Moment | Drop point | Trigger |
|---|---|---|---|
| `interaction-drop-target.png` | Dragging clips in from Finder | Full-screen `<DropOverlay>` | `onDragOver` window event |
| `interaction-celebration-burst.png` | First publish, milestone | Full-screen `<CelebrationOverlay>` | First successful schedule |

The `success-burst.png` in v3 demo is a smaller version of celebration-burst. This new one is the full-screen plate.

---

## 🔥 Badge (1)

| File | Use |
|---|---|
| `badge-hot-streak.png` | Replaces the text "HOT" pill chip on streaking clips. Generated brand-art, not text. Use at 28×28 inside `<ClipCard>` top-right. |

---

## Drop-in checklist (after assets land)

1. Move `docs/demo-assets/atmosphere-*.png` + `state-*.png` + `interaction-*.png` + `badge-hot-streak.png` to `src/assets/atmospheres/`.
2. Add `.deck-{name}::before` hooks to `src/index.css` per the table above.
3. Wire `<EmptyState>` / `<BakeFailedStrip>` / `<OfflineOverlay>` / `<CommandPalette>` to render their plate.
4. Add `<DropOverlay>` window listener (Tauri `webview` already supports drag events).
5. Replace `<HotPill>` text with `<img src=".../badge-hot-streak.png">`.

Plate quality is the only gate. If a generation comes out generic or off-brand, regenerate that one with a refined prompt before shipping. Don't compromise.

---

## What's NOT in this queue (intentionally)

- **Clip thumbnails** — clips are user content. The repo has Daniel's real reels on disk.
- **Stock photography** — none. Atmosphere plates carry the visual weight.
- **Hand-illustrated SVG scenes** — banned by the impeccable skill, also off-brand.
- **Platform brand icons** (YT/TT/IG/X) — separate, vectorized from official press kits, not AI-generated.
- **Sound design** — separate sprint.
- **⌘K palette component itself** — UI build, not asset generation.

Atmosphere is the unfair advantage. We get the world-built feeling of Linear / Arc / Figma without a 6-figure illustration team, by running gpt-image-1 against the brand kit as the constraint contract.

Generated 2026-06-11.
