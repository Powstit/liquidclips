# SplashGame Asset Map

> Canonical record of which cinematic + game assets are LIVE in the splash
> sequence, which are FUTURE work, and the spend posture.
>
> Companion to [`KADE_ASSET_SCOPE_MAP.md`](./KADE_ASSET_SCOPE_MAP.md) — that
> doc is the long-form character/brand audit; this doc is the short-form
> shipping ledger.
>
> Last update: 2026-06-23

---

## Status ledger

| Asset | State | Path |
|---|---|---|
| Cinematic intro (22.0s · 1280×720 · h264+aac) | **ACCEPTED · interim** · ships as-is, no rollback | `desktop-2/public/brand/intro/intro.mp4` |
| Prior intro (Oasis-boy era · 9.2 MB) | retained as rollback artifact | `desktop-2/public/brand/intro/intro.prev-v2-20260623.mp4` |
| Full Kade-protagonist cinematic (6 NEW shots per scope map) | **FUTURE asset work** — not scheduled for current ship cycle | n/a (regeneration plan in `KADE_ASSET_SCOPE_MAP.md` §3) |
| Kade shooter frames (up-1 idle · up-4 fire-peak) | **AVAILABLE to SplashGame** · wired into `InvadersCanvas` draw path | `desktop-2/public/brand/kade/up-sequence/kade-up-{1..6}.{png,webp}` |
| Kade shooter frames (up-2/3/5/6) | on disk, not yet rendered (idle ↔ fire two-state is enough for v1) | same dir |
| Brand-kit bug enemies (5 in use) | **AVAILABLE to SplashGame** · wired per row | `desktop-2/public/brand/enemies/bug-{grunt,mothbug,glitch,spider,rulebreak}.webp` |
| Pixel-art arcade sprites (player_ship, grunt, elite, drone, mothership, …) | on disk, **NOT in use** (opaque-bg v0.6.0 regression unresolved) | `desktop-2/public/brand/invaders/*.png` |

---

## Spend posture

- **No new video generation planned.** Seedance credits exhausted; Higgsfield
  reserved for future cinematic regeneration (not this cycle).
- **MCP video tools** (`mcp-video` server, native + CLI) — used for tiny
  diagnostics (`video_info`, frame extraction). Not for creative work in the
  current cycle.
- **gpt-image-1** — held in reserve for the future 6-shot Kade cinematic
  (~$0.36 total per `KADE_ASSET_SCOPE_MAP.md` §6).

---

## Harness contracts preserved

The Tier-1 splash harness (`tests/e2e/splash-and-agency-palette.spec.ts`)
asserts the following source markers in `InvadersCanvas.tsx`; the sprite
re-enable in v0.7.64 keeps every one of them intact:

- `data-testid="splash-game-canvas"`
- `data-renderer="geometric"`
- Historical "Higgsfield-generated PNG sprite pack" comment (audit-record)
- "geometric-shape renderer" / "geometric shapes" phrasing (fallback-proof
  documentation)

The geometric fallback stays in `draw()` per-sprite, so any future decode
failure remains visually safe and the data-renderer marker remains truthful
about the failure path.

---

## Reversibility

One-commit removal path for the sprite re-enable:

1. Revert the `useEffect` sprite-preload block in `InvadersCanvas.tsx`
2. Revert the `playerFire` slot in the `Sprites` type
3. Revert the `kadeSprite` / `playerFiring` swap in `draw()`'s player branch
4. (Optional) Delete `desktop-2/public/brand/kade/up-sequence/*` if not used
   by any other surface

The intro.mp4 swap is similarly reversible: `cp intro.prev-v2-20260623.mp4
intro.mp4`.
