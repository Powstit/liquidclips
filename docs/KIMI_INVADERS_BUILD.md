# Kimi build — Invaders mini game for Liquid Clips

> **Owner**: Kimi  
> **Reviewer**: Claude (Daniel relays)  
> **Reads**: This file is self-contained. You don't need any other docs.  
> **Writes**: Only the files listed in §6. **Do not edit anything else.**

---

## 1. The goal in one paragraph

Long pipeline stages (LLM clip selection, transcribe) can take 30–120 seconds. The user stares at a spinner. Build a tiny **pink-and-black Space Invaders** that the user can open during any long wait, plays right inside the app, pauses + closes cleanly when the pipeline finishes, and keeps a local high score. The brand colour is fuchsia `#FF1A8C` on paper `#0B0B10`. No external libraries, no audio, no images — pure inline SVG and canvas. The visual feel should match Liquid Clips' existing fuchsia ladder.

**Acceptance criteria** (Daniel will inspect these in order):
1. A small "Play while it loads ▶" button appears on `JuniorLoader` and `WorkingStage` after 5 seconds of waiting.
2. Click → a centered overlay opens with the game running. Esc or X closes it.
3. Arrow keys + space play the game; no focus-stealing from form inputs elsewhere.
4. Score and high score visible. High score persists to `$APPDATA/invaders.json` and survives reload.
5. When the pipeline finishes, the overlay closes itself + emits a "Pipeline ready — back to work" toast in the overlay before close.
6. No new npm packages. No audio. No external SVG / image files.
7. `tsc --noEmit` clean. `npm run tauri build -- --bundles app` clean.

---

## 2. Architecture (don't deviate)

```
┌─────────────────────────────────────────┐
│ App.tsx                                 │
│ ├─ MainShell (existing)                 │
│ └─ <InvadersOverlay />  ← single mount  │
│    (Claude adds this one line)          │
└─────────────────────────────────────────┘

InvadersOverlay portals to document.body, reads `useInvadersStore()`.
When store.open === true, renders the game modal.

JuniorLoader / WorkingStage import <InvadersTrigger /> and render it
in their existing button slot. Trigger calls invadersStore.open().

Game logic is pure (no React) so it's testable + the render loop
doesn't fight React reconciliation.

┌─ src/lib/invaders/
│  ├─ store.ts       → tiny pub/sub: open(), close(), useIsOpen()
│  ├─ engine.ts      → pure game state machine (no DOM, no React)
│  └─ highScore.ts   → $APPDATA/invaders.json read/write
│
└─ src/components/invaders/
   ├─ InvadersOverlay.tsx  → modal shell + canvas mount + keyboard
   ├─ InvadersCanvas.tsx   → canvas render loop, consumes engine
   └─ InvadersTrigger.tsx  → "Play while it loads ▶" button
```

---

## 3. File-by-file contracts

### 3.1 `src/lib/invaders/store.ts`

Tiny pub/sub for the open/closed state. **Do not use Zustand** — keep it dependency-free, ~40 lines.

```ts
// Open/close signal for the Invaders overlay. Pub/sub pattern matches the
// existing lib/browse.ts singleton (see useBrowsePanel) so consumers don't
// need to lift state.

import { useEffect, useState } from "react";

type Listener = (open: boolean) => void;
let _open = false;
const listeners = new Set<Listener>();

export function openInvaders(): void {
  if (_open) return;
  _open = true;
  for (const l of listeners) l(true);
}

export function closeInvaders(): void {
  if (!_open) return;
  _open = false;
  for (const l of listeners) l(false);
}

export function useInvadersOpen(): boolean {
  const [open, setOpen] = useState(_open);
  useEffect(() => {
    listeners.add(setOpen);
    setOpen(_open);
    return () => { listeners.delete(setOpen); };
  }, []);
  return open;
}
```

### 3.2 `src/lib/invaders/highScore.ts`

Persistence at `$APPDATA/invaders.json`. **Match the pattern in `src/lib/briefs.ts` exactly** — same imports, same error handling, same mkdir-with-recursive trick. Capability already grants `fs:allow-appdata-write-recursive` so this just works.

Contract:
```ts
export async function getHighScore(): Promise<number>;
export async function setHighScore(n: number): Promise<void>;
```

Schema: `{ version: 1, high_score: number }`. Default 0 if file missing or parse fails. Don't crash if write fails — log + continue.

### 3.3 `src/lib/invaders/engine.ts`

**Pure game logic — no DOM, no React, no Tauri.** Testable in isolation.

Export:
```ts
export type Vec = { x: number; y: number };
export type Invader = { pos: Vec; alive: boolean; row: number; col: number };
export type Bullet = { pos: Vec; vy: number; from: "player" | "invader" };
export type GameState = {
  width: number;
  height: number;
  player: Vec;
  bullets: Bullet[];
  invaders: Invader[];
  score: number;
  wave: number;
  status: "playing" | "game-over";
  // ms since last invader step — used internally by step() for the
  // descend-and-shift cadence.
  _lastStepMs: number;
};

export function initGame(width: number, height: number): GameState;
export function step(state: GameState, dtMs: number, input: Input): GameState;
export function reset(state: GameState): GameState;

export type Input = {
  left: boolean;
  right: boolean;
  fire: boolean; // edge-triggered — true only on the frame the key first goes down
};
```

**Game rules**:
- Canvas: 480 × 320 logical pixels (the canvas element will be DPR-scaled in the component — your engine works in logical pixels).
- Player ship: 24 × 12 px, starts at `(width/2, height - 24)`, moves at 220 px/s.
- Invaders: 5 rows × 8 cols, each 24 × 16 px, 6 px spacing. Top row at y=24. Whole grid descends 12 px when an invader touches a wall. The grid steps sideways every 600 ms at wave 1, 100 ms faster every wave (floor 80 ms).
- Player bullet: 3 × 8 px, vy = -380 px/s. Max 3 in flight.
- Invader bullet: 3 × 8 px, vy = +180 px/s, randomly fired from a live invader in the bottom-most row of its column. ~1 bullet/sec.
- Player hit by bullet → game over.
- Invader reaches y > height - 36 → game over.
- All invaders dead → wave + 1, reset invader grid, increase invader speed.
- Score: hit invader = `10 * row+1`. Top row most valuable.

**Performance note**: `step` is called every animation frame at 60 fps. Allocate as little as possible — mutate `state` in place is acceptable (engine is single-instance).

### 3.4 `src/components/invaders/InvadersCanvas.tsx`

Mounts a `<canvas>` and runs the render loop. Props:
```ts
type Props = {
  state: GameState;
  onStep: (dtMs: number) => void;
  // 480 logical px wide, DPR-scaled for retina
  width: number;
  height: number;
};
```

Render loop:
- `requestAnimationFrame` with cleanup on unmount.
- Convert frame timestamps to dtMs.
- Call `onStep(dtMs)` first, then redraw the canvas from `state`.
- Canvas DPR: read `window.devicePixelRatio`, set `canvas.width = width * dpr`, `canvas.height = height * dpr`, `ctx.scale(dpr, dpr)`. Style width/height stays at logical px.

Draw primitives (no images):
- Background: solid `#0B0B10` (paper).
- Player ship: filled fuchsia `#FF1A8C` chevron pointing up.
- Invaders: 3 shape types depending on `row % 3`: square, diamond, oval — all fuchsia, slightly lighter `#FF66B8` per row.
- Bullets: 3 × 8 px rectangles. Player bullet = `#FF66B8` (glow). Invader bullet = `#C70066` (deep).
- Score top-left in Geist Mono 11px white `#F4F1EA`.
- Wave top-right in same style.

### 3.5 `src/components/invaders/InvadersOverlay.tsx`

The full overlay component. Mounted once at App-shell level (Claude adds the line). Internal structure:

```tsx
// pseudocode — actual JSX is up to you, match the brand patterns from
// EarnHowItWorks.tsx and AvatarPicker.tsx for portal + scrim
//
// Outer: createPortal(overlay, document.body)
// scrim: fixed inset-0 z-[110] bg-paper p-6 flex items-center justify-center
// card: bg-paper-elev border border-fuchsia/40 rounded-2xl
//       isolate (use Card primitive from primitives/Card.tsx)
//       width 520, height 440 (canvas + chrome)
// header: "PINK INVADERS" + score / high score + X close
// canvas mount: <InvadersCanvas state={...} onStep={...} />
// footer: "← → move · space fire · esc close"
```

Behaviour:
1. Reads `useInvadersOpen()` — if false, render null.
2. On mount: initialise game state, load high score, start RAF loop.
3. Keyboard handler attached to `window`:
   - ArrowLeft / a → input.left
   - ArrowRight / d → input.right
   - Space → input.fire (edge-triggered)
   - Escape → call `closeInvaders()`
   - **Important**: `preventDefault()` only for the keys you care about. Don't swallow Tab / Enter / typing — those belong to forms in other layers (even though the overlay covers them, a user might Esc out and the form needs to behave).
4. On unmount: cancel RAF, save high score if `score > savedHighScore`, remove listeners.
5. On game over: show a "Game over · Play again ▶" button. Clicking calls `reset()` on the engine state.
6. When the pipeline finishes externally, `closeInvaders()` will be called from outside (Claude wires this — see §5). Your overlay just unmounts cleanly when `useInvadersOpen()` flips to false.
7. Body scroll lock + restore on close (same as `AvatarPicker.tsx`).

### 3.6 `src/components/invaders/InvadersTrigger.tsx`

A small button. **No new variants** — use the existing `Button` primitive from `src/components/primitives/Button.tsx`.

```tsx
type Props = {
  // Optional delay (ms) before the trigger shows. Defaults to 5000 — only
  // appears after 5s of waiting so it doesn't pop in for fast operations.
  delayMs?: number;
};

export function InvadersTrigger({ delayMs = 5000 }: Props) {
  const [visible, setVisible] = useState(delayMs === 0);
  useEffect(() => {
    if (delayMs === 0) return;
    const id = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(id);
  }, [delayMs]);
  if (!visible) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={openInvaders}
      title="Play Invaders while you wait"
    >
      Play while it loads ▶
    </Button>
  );
}
```

---

## 4. Visual spec

| Element | Value |
|---|---|
| Canvas size | 480 × 320 logical px |
| Background | `#0B0B10` (paper) |
| Player ship | `#FF1A8C` (fuchsia) |
| Invaders rows 1–2 | `#FF1A8C` |
| Invaders rows 3–4 | `#FF66B8` (deep) |
| Invaders row 5 | `#FF8FCB` (glow) |
| Player bullet | `#FF66B8` |
| Invader bullet | `#C70066` |
| Score / wave text | `#F4F1EA` (ink) at 11 px Geist Mono uppercase |
| Modal card | Use `<Card elevation="raised" />` from primitives — gives you isolate + var(--color-paper-elev) bg + border-line-strong + shadow-e2 |
| Scrim | `bg-paper` (fully opaque, matches EarnHowItWorks pattern) |

No glow filters, no blur, no animations beyond the game loop itself. Crisp pixel rendering — set `canvas.style.imageRendering = "pixelated"` if it improves the look at 480 px logical width.

---

## 5. Integration points (Claude does this — listed so you know what's coming)

Once you ship, **Claude** will add three lines:

1. **`src/App.tsx`** — one import + one mount inside `MainShell`:
   ```tsx
   import { InvadersOverlay } from "./components/invaders/InvadersOverlay";
   // …
   <InvadersOverlay />
   ```

2. **`src/components/JuniorLoader.tsx`** — render `<InvadersTrigger />` somewhere in the footer area.

3. **`src/components/WorkingStage.tsx`** — render `<InvadersTrigger />` next to the existing Cancel button.

4. **`src/App.tsx`** auto-close hook — when `view.kind` transitions to `"results"`, `"lifted"`, `"failed"`, `"canceled"`, `"empty"` (i.e. any terminal state for the pipeline), Claude will call `closeInvaders()` from `lib/invaders/store`. **You don't wire this — just expose `closeInvaders()` as a public export.**

---

## 6. Files YOU create (the whole list — nothing else)

```
src/lib/invaders/store.ts
src/lib/invaders/engine.ts
src/lib/invaders/highScore.ts
src/components/invaders/InvadersOverlay.tsx
src/components/invaders/InvadersCanvas.tsx
src/components/invaders/InvadersTrigger.tsx
```

That's six files. Nothing else.

---

## 7. Files YOU MUST NOT TOUCH

- `src/App.tsx` — Claude wires the mount + auto-close
- `src/components/earn/**` — Claude/Codex own this
- `src/components/payouts/**` — Claude owns this
- `src/components/primitives/**` — frozen for this sprint; if you need a primitive variant, file it as a comment in your code and Claude will add it
- `src/lib/sidecar.ts`, `src/lib/backend.ts`, `src/lib/browse.ts`, `src/lib/briefs.ts`, `src/lib/submissions.ts`, `src/lib/payoutsAggregations.ts`, `src/lib/avatars.tsx`, `src/lib/avatarChoice.ts`, `src/lib/updater.ts`, `src/lib/activation.ts`, `src/lib/flags.ts`, `src/lib/whop-iframe.ts`, `src/lib/telemetry.ts`, `src/lib/useTier.ts`, `src/lib/useCountUp.ts`
- `src-tauri/**` — no Rust changes needed; capabilities already grant `fs:allow-appdata-write-recursive`
- `desktop/src-tauri/capabilities/default.json` — fs perms already in place
- `package.json` — **do not install new packages**. If you think you need one, the answer is no — use vanilla canvas + React
- `desktop/src/index.css` — design tokens are frozen
- `desktop/python-sidecar/**` — backend-side, not yours
- Any docs in `desktop/docs/` or `docs/` — Claude maintains those

---

## 8. How to verify before handoff

Run these in order before telling Daniel you're done:

```bash
cd ~/Desktop/jnr/desktop
npx tsc --noEmit                      # must be clean
npm run tauri build -- --bundles app  # must succeed
```

Smoke test manually:
1. Edit `src/App.tsx` temporarily to mount `<InvadersOverlay />` and a test button that calls `openInvaders()`. **Remove this before commit.** (Claude will add the real wiring.)
2. `bash scripts/local-install.sh`
3. Click the test button → game opens centered, plays, Esc closes, X closes, game-over shows replay
4. Score increments on hit; high score persists across app restart
5. Game pauses + RAF cancels when the overlay is closed (no CPU leak)

---

## 9. How to commit + hand back

```bash
cd ~/Desktop/jnr
git add desktop/src/lib/invaders/ desktop/src/components/invaders/
git status -s   # should show ONLY those 6 files
git commit -m "feat(invaders): pink/black mini game during long pipeline waits

Plays during LLM / transcribe / download stages so users stop staring at
spinners. Pure canvas, no deps, no audio. High score persists to
\$APPDATA/invaders.json. Wired into JuniorLoader + WorkingStage via the
new InvadersTrigger button (renders after 5s wait). Overlay portaled to
document.body with body-scroll lock; Esc closes; auto-closes when
pipeline reaches a terminal state.

Co-Authored-By: Kimi <noreply@kimi>
"
git push origin main
```

Then tell Daniel: **"Invaders is in `6107697..<your sha>`. Six files in `src/lib/invaders/` + `src/components/invaders/`. Ready for Claude to wire `<InvadersOverlay />` into `App.tsx` + the autoclose hook."**

---

## 10. Things Claude wants you to know

- The `Button`, `Card`, `IconButton`, `Pill` primitives in `src/components/primitives/` are stable — use them. They have `isolate` and the solid `bg-paper-elev` baked in already; you don't need to fight transparency.
- The Tauri fs plugin permission for `$APPDATA` is already granted — `briefs.ts` and `submissions.ts` use the exact same pattern; copy their `ensureAppDataDir` / `readFile` / `writeFile` helpers.
- React 18 strict mode is on; everything you write will mount → unmount → remount in dev. Make sure RAF + listener cleanup is bulletproof.
- The dark theme: `--color-paper = #0B0B10`, `--color-ink = #F4F1EA`, `--color-fuchsia = #FF1A8C`. These are CSS vars in `index.css` if you want to read them from JS (`getComputedStyle(document.documentElement).getPropertyValue('--color-fuchsia')`).
- Daniel's UX bar: "make it sick / cool" — so the player ship should feel snappy (220 px/s is good), bullets should feel punchy (380 px/s up), invaders should accelerate per wave so it gets genuinely hard.

If you hit an unknown — log it in a `// QUESTION FOR CLAUDE:` comment inline, ship without it, and Claude will resolve in the wiring pass.
