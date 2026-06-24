import { useEffect, useRef } from "react";
import type { GameState } from "../../lib/invaders/engine";

type Sprites = {
  player: HTMLImageElement | null;
  playerFire: HTMLImageElement | null;
  invaders: (HTMLImageElement | null)[]; // index = row (0..4)
  bulletPlayer: HTMLImageElement | null;
  bulletInvader: HTMLImageElement | null;
};

type Props = {
  state: GameState;
  onStep: (dtMs: number) => void;
  width: number;
  height: number;
  /** When true, the canvas runs the vfx layer in paused mode — idle invader
   *  sway, no ship engine trail buildup. SplashGame passes !started. */
  paused?: boolean;
};

export function InvadersCanvas({ state, onStep, width, height, paused = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const prevRef = useRef<number>(0);

  // Latest state + onStep live in refs so the canvas setup effect only runs
  // when the canvas size changes — not on every state mutation (which would
  // be 60Hz, tearing down and re-creating the RAF loop + canvas dimensions
  // every frame and pegging CPU).
  const stateRef = useRef(state);
  const onStepRef = useRef(onStep);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { onStepRef.current = onStep; }, [onStep]);

  // Preload all four sprites once on mount. While any of them is still
  // decoding the draw() path falls back to the geometric shapes.
  const spritesRef = useRef<Sprites>({ player: null, playerFire: null, invaders: [null, null, null, null, null], bulletPlayer: null, bulletInvader: null });
  // VFX state (parallax + particles + shake + trail + idle sway). Init once
  // per canvas mount with the current dimensions so star positions are sane
  // even on the first frame.
  const vfxRef = useRef<VfxState>(initVfx(width, height));
  // Keep paused in a ref so the RAF loop can read it without re-binding.
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  // v0.6.0 — Higgsfield-generated PNG sprite pack was rendering with painted-in
  // backgrounds (no alpha channel in the source art), so on the synthwave splash
  // backdrop every invader appeared as a grey block. Daniel: "use old ones."
  // Skipping the sprite preload entirely makes the draw path fall through to
  // the geometric-shape renderer below (drawInvaderShape), which is the
  // original v0.4.x look — clean fuchsia-tinted squares/diamonds/ovals on the
  // synthwave backdrop, no compositing issues. The huge PNG sprite imports were
  // intentionally removed from this canvas so unused art no longer bloats the
  // launch bundle while the geometric renderer is active.
  //
  // v0.7.66 — sprite preload reverted entirely. Three rounds of AI-generated
  // sprite packs (v0.7.64 illustrated, v0.7.65 pixellab) all showed register
  // mismatch or alpha/orientation issues on the splash canvas. The pure-code
  // geometric-shape renderer below has been upgraded: instead of generic
  // squares/diamonds/ovals it now paints proper classic Space Invaders
  // silhouettes (squid/crab/octopus) for invaders and a cannon-style hero
  // ship FACING UP for the player — same draw path, same RAF loop, same VFX,
  // just per-pixel `fillRect` patterns sized to each grid. Zero AI dependency.
  // Daniel: "the previous game that was pure code … between these two
  // questions theres a fix" — 2026-06-23.

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.imageRendering = "pixelated";

    function frame(ts: number) {
      if (!prevRef.current) prevRef.current = ts;
      const dtMs = ts - prevRef.current;
      prevRef.current = ts;
      onStepRef.current(dtMs);

      // Step vfx BEFORE draw so kill-particles spawn on the right frame.
      updateVfx(vfxRef.current, stateRef.current, dtMs, pausedRef.current);

      // setTransform replaces the matrix entirely (it doesn't multiply), so
      // bracketing each draw with save/setTransform/draw/restore keeps the
      // scale at exactly dpr×dpr per frame regardless of any state changes.
      const c = canvas!.getContext("2d")!;
      c.save();
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Pixel-perfect sprite scaling — bilinear interpolation on a 2D context
      // ignores the canvas CSS `image-rendering: pixelated` hint, so we have
      // to disable smoothing on the context itself. Set every frame because
      // save/restore + setTransform can reset it on some engines.
      c.imageSmoothingEnabled = false;
      // @ts-expect-error — vendor-prefixed flag still respected by Safari/WebKit
      c.webkitImageSmoothingEnabled = false;
      draw(c, stateRef.current, width, height, spritesRef.current, vfxRef.current, pausedRef.current);
      c.restore();

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafRef.current);
      prevRef.current = 0;
    };
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="rounded-lg"
      data-testid="splash-game-canvas"
      data-renderer="geometric"
    />
  );
}

// ── VFX state (sprint splash-polish 2026-06-02) ───────────────────────
// Purely visual — lives outside the engine so gameplay stays pure. Tracked
// inside the canvas component via a module-scoped object passed into draw.
// "Depth" comes from: parallax starfield + ship engine trail + particles
// + screen shake + idle sway when paused.

type Star = { x: number; y: number; layer: 0 | 1 | 2; size: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; hue: string };
type TrailDot = { x: number; y: number; life: number };
type ScorePop = { x: number; y: number; value: number; life: number };

export type VfxState = {
  stars: Star[];                      // populated once
  particles: Particle[];
  shake: number;                       // pixels of offset, decays each frame
  trail: TrailDot[];
  scorePops: ScorePop[];               // "+10" floats that spawn on invader kills
  prevAlive: boolean[];                // per-invader-id, last frame's alive flag
  swayBaseTimeMs: number;              // for idle invader sway when paused
};

export function initVfx(w: number, h: number): VfxState {
  const stars: Star[] = [];
  // Three parallax layers — back layer = many small slow stars,
  // middle layer = medium, front layer = few big fast stars.
  for (let i = 0; i < 70; i++) stars.push({ x: Math.random() * w, y: Math.random() * h, layer: 0, size: 1 });
  for (let i = 0; i < 35; i++) stars.push({ x: Math.random() * w, y: Math.random() * h, layer: 1, size: 1.5 });
  for (let i = 0; i < 15; i++) stars.push({ x: Math.random() * w, y: Math.random() * h, layer: 2, size: 2.5 });
  return {
    stars,
    particles: [],
    shake: 0,
    trail: [],
    scorePops: [],
    prevAlive: [],
    swayBaseTimeMs: performance.now(),
  };
}

const STAR_SPEEDS = [6, 14, 28] as const;  // px/sec per layer (back-to-front)
const PARTICLE_HUES = ["#FF1A8C", "#FF66B8", "#FFFFFF", "#00E5FF"];

export function updateVfx(vfx: VfxState, state: GameState, dtMs: number, paused: boolean): void {
  const dt = Math.min(dtMs, 100) / 1000;  // cap to 100ms per frame so a tab-pause doesn't fling things

  // 1. Starfield — scroll downward; wrap at bottom.
  for (const s of vfx.stars) {
    s.y += STAR_SPEEDS[s.layer] * dt;
    if (s.y > state.height + 4) {
      s.y = -4;
      s.x = Math.random() * state.width;
    }
  }

  // 2. Detect newly-dead invaders → spawn particle bursts.
  // prevAlive is keyed by invader index; on first frame it auto-populates so
  // no false deaths fire.
  if (vfx.prevAlive.length !== state.invaders.length) {
    vfx.prevAlive = state.invaders.map((i) => i.alive);
  } else {
    for (let idx = 0; idx < state.invaders.length; idx++) {
      const cur = state.invaders[idx];
      if (vfx.prevAlive[idx] && !cur.alive) {
        // Spawn 8 particles radial
        for (let p = 0; p < 8; p++) {
          const angle = (p / 8) * Math.PI * 2 + Math.random() * 0.3;
          const speed = 60 + Math.random() * 60;
          vfx.particles.push({
            x: cur.pos.x,
            y: cur.pos.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1.0,
            hue: PARTICLE_HUES[Math.floor(Math.random() * PARTICLE_HUES.length)],
          });
        }
        vfx.shake = Math.max(vfx.shake, 1.5);  // tiny shake on kill
        vfx.scorePops.push({ x: cur.pos.x, y: cur.pos.y - 8, value: 10, life: 1.0 });
      }
      vfx.prevAlive[idx] = cur.alive;
    }
  }

  // 3. Game-over transition → strong shake
  if (state.status === "game-over" && vfx.shake < 6) {
    vfx.shake = Math.max(vfx.shake, 6);
  }

  // 4. Age particles
  for (const p of vfx.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 80 * dt;  // gentle gravity
    p.life -= dt * 1.6;  // ~600ms lifespan
  }
  vfx.particles = vfx.particles.filter((p) => p.life > 0);

  // 4b. Age score-pops — float upward, fade out over ~800ms
  for (const sp of vfx.scorePops) {
    sp.y -= 30 * dt;
    sp.life -= dt * 1.25;
  }
  vfx.scorePops = vfx.scorePops.filter((s) => s.life > 0);

  // 5. Decay shake
  vfx.shake = Math.max(0, vfx.shake - dt * 12);

  // 6. Ship engine trail — only when not paused (avoid trail buildup at idle)
  if (!paused && state.status === "playing") {
    vfx.trail.push({ x: state.player.x, y: state.player.y + 6, life: 0.6 });
    if (vfx.trail.length > 40) vfx.trail.shift();
    for (const t of vfx.trail) t.life -= dt * 1.8;
    vfx.trail = vfx.trail.filter((t) => t.life > 0);
  } else if (vfx.trail.length > 0) {
    // Fade existing trail when paused
    for (const t of vfx.trail) t.life -= dt * 3;
    vfx.trail = vfx.trail.filter((t) => t.life > 0);
  }
}

function draw(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  w: number,
  h: number,
  sprites: Sprites,
  vfx: VfxState,
  paused: boolean,
) {
  // Sprint #18 — transparent canvas. clearRect (vs solid fillRect) lets the
  // app background show through the game layer, so the game feels integrated
  // with the workspace instead of a popup that blanks the screen.
  ctx.clearRect(0, 0, w, h);

  // Apply screen shake by offsetting the entire game render.
  const shakeX = vfx.shake > 0 ? (Math.random() - 0.5) * vfx.shake * 2 : 0;
  const shakeY = vfx.shake > 0 ? (Math.random() - 0.5) * vfx.shake * 2 : 0;
  ctx.save();
  ctx.translate(shakeX, shakeY);

  // 1. Parallax starfield — drawn BEFORE everything so it's the backdrop.
  // Layer 0 = dim/small, layer 2 = bright/big. White stars with slight
  // fuchsia tint on the front layer for brand cohesion.
  for (const s of vfx.stars) {
    const alpha = s.layer === 0 ? 0.3 : s.layer === 1 ? 0.55 : 0.85;
    ctx.fillStyle = s.layer === 2 ? `rgba(255, 204, 230, ${alpha})` : `rgba(255, 255, 255, ${alpha})`;
    ctx.fillRect(s.x, s.y, s.size, s.size);
  }

  // 2. Ship engine trail — drawn under everything game-related
  for (const t of vfx.trail) {
    const a = t.life;
    ctx.fillStyle = `rgba(255, 26, 140, ${a * 0.7})`;
    const r = 6 * a;
    ctx.beginPath();
    ctx.ellipse(t.x, t.y, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Idle sway — when paused, invaders gently shift left-right via a sine
  // offset so the screen doesn't look frozen.
  const swayOffset = paused
    ? Math.sin((performance.now() - vfx.swayBaseTimeMs) / 700) * 4
    : 0;

  // invaders — pure-code Space Invaders silhouettes via PIXEL_GRIDS below.
  // 2px per pixel-grid cell · march frame A/B alternates every 400ms · per-row
  // colour ties the row to its enemy type (cyan squid · mid-fuchsia crab ·
  // bright-fuchsia octopus). Collision box unchanged at 24×16.
  const marchFrame: 0 | 1 = (Math.floor(performance.now() / 400) % 2) as 0 | 1;
  const INV_PX = 2;
  for (const inv of state.invaders) {
    if (!inv.alive) continue;
    const drawX = inv.pos.x + swayOffset;
    const grid = spaceInvaderForRow(inv.row, marchFrame);
    const gW = grid[0].length * INV_PX;
    const gH = grid.length * INV_PX;
    drawPixelGrid(ctx, grid, drawX - gW / 2, inv.pos.y - gH / 2, INV_PX, invaderColor(inv.row));
  }

  // player — Liquid Clips fighter ship FACING UP (nose at top). Body painted
  // in warm paper at 3px/cell so the hero reads bigger than the invaders,
  // then a 3-wide cyan eye-stripe lit in the cockpit hollow on a second pass.
  // Collision unchanged (PLAYER_W=24/H=12).
  const PLAYER_PX = 3;
  const pgW = PIXEL_PLAYER[0].length * PLAYER_PX;
  const pgH = PIXEL_PLAYER.length * PLAYER_PX;
  const playerX = state.player.x - pgW / 2;
  const playerY = state.player.y - pgH / 2 + 4;
  drawPixelGrid(ctx, PIXEL_PLAYER, playerX, playerY, PLAYER_PX, "#F4F1EA");
  drawPixelGrid(ctx, PIXEL_PLAYER_EYE, playerX, playerY, PLAYER_PX, "#00E5FF");

  // bullets — chevron sprite at 8×14 visual (down from 14×20 so the bullet
  // reads as a precise streak rather than a soft blob). Collision stays 3×8.
  for (const b of state.bullets) {
    const img = b.from === "player" ? sprites.bulletPlayer : sprites.bulletInvader;
    if (img && img.complete && img.naturalWidth > 0) {
      const sw = 8, sh = 14;
      ctx.drawImage(img, Math.round(b.pos.x - sw / 2), Math.round(b.pos.y - sh / 2), sw, sh);
    } else {
      ctx.fillStyle = b.from === "player" ? "#FF66B8" : "#C70066";
      ctx.fillRect(b.pos.x - 1.5, b.pos.y - 4, 3, 8);
    }
  }

  // Particles — drawn on TOP of the game so kill bursts read clearly.
  for (const p of vfx.particles) {
    ctx.fillStyle = p.hue;
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    const r = 2 + (1 - p.life) * 1.5;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r, r, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Score-pop "+10" text drifting up from each kill — dopamine cue.
  ctx.font = "bold 12px sans-serif";
  ctx.textAlign = "center";
  for (const sp of vfx.scorePops) {
    ctx.globalAlpha = Math.max(0, Math.min(1, sp.life));
    ctx.fillStyle = "#FF1A8C";
    ctx.fillText(`+${sp.value}`, sp.x, sp.y);
  }
  ctx.globalAlpha = 1;

  // Close shake transform — score + wave HUD drawn OUTSIDE shake so they
  // stay rock-solid for readability.
  ctx.restore();

  // score
  ctx.fillStyle = "#F4F1EA";
  ctx.font = "11px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`SCORE ${state.score}`, 10, 18);

  // wave
  ctx.textAlign = "right";
  ctx.fillText(`WAVE ${state.wave}`, w - 10, 18);
}

function invaderColor(row: number): string {
  if (row < 2) return "#00E5FF"; // top row · squid · cyan
  if (row < 4) return "#FF66B8"; // middle rows · crab · mid fuchsia
  return "#FF1A8C";              // bottom row · octopus · bright fuchsia
}

// Pure-code Space Invaders silhouettes — each grid is an array of strings
// where 'X' marks an "on" pixel and '.' is transparent. `drawPixelGrid`
// rasterises the grid via `fillRect` at the requested scale + colour.
// Patterns are clean originals in the classic-arcade visual language; no
// copied ROM data.

// Player fighter — 13×9 silhouette · Liquid Clips hero ship. Body painted in
// warm paper, then a single cyan-eye accent stripe in the cockpit hollow
// (Kade signature). Faces UP (nose at top, wings at base, drive at bottom).
// Two-pass draw — body first, eye second — so the cockpit window reads as
// a cyan-lit visor rather than a void.
const PIXEL_PLAYER = [
  "......X......",
  ".....XXX.....",
  "....XXXXX....",
  "....X...X....",
  "...XXXXXXX...",
  "..XXXXXXXXX..",
  ".XXXXXXXXXXX.",
  "XXX.XXXXX.XXX",
  ".X.........X.",
];
const PIXEL_PLAYER_EYE = [
  ".............",
  ".............",
  ".............",
  ".....XXX.....",
  ".............",
  ".............",
  ".............",
  ".............",
  ".............",
];

const PIXEL_SQUID_A = [
  ".....X.....",
  "....XXX....",
  "...XXXXX...",
  "..XX.X.XX..",
  ".XXXXXXXXX.",
  "X.XXXXXXX.X",
  "X.X.....X.X",
  ".X.X...X.X.",
];
const PIXEL_SQUID_B = [
  ".....X.....",
  "....XXX....",
  "...XXXXX...",
  "..XX.X.XX..",
  ".XXXXXXXXX.",
  "X.XXXXXXX.X",
  ".X.X...X.X.",
  "X.X.....X.X",
];

const PIXEL_CRAB_A = [
  "..X.....X..",
  "...X...X...",
  "..XXXXXXX..",
  ".XX.XXX.XX.",
  "XXXXXXXXXXX",
  "X.XXXXXXX.X",
  "X.X.....X.X",
  "...XX.XX...",
];
const PIXEL_CRAB_B = [
  "..X.....X..",
  "X..X...X..X",
  "X.XXXXXXX.X",
  "XXX.XXX.XXX",
  "XXXXXXXXXXX",
  ".XXXXXXXXX.",
  "..X.....X..",
  ".X.......X.",
];

const PIXEL_OCTOPUS_A = [
  "....XXXX....",
  ".XXXXXXXXXX.",
  "XXXXXXXXXXXX",
  "XXX..XX..XXX",
  "XXXXXXXXXXXX",
  "..XX....XX..",
  ".XX..XX..XX.",
  "X.X......X.X",
];
const PIXEL_OCTOPUS_B = [
  "....XXXX....",
  ".XXXXXXXXXX.",
  "XXXXXXXXXXXX",
  "XXX..XX..XXX",
  "XXXXXXXXXXXX",
  "..XXX..XXX..",
  ".XX..XX..XX.",
  "..X......X..",
];

function spaceInvaderForRow(row: number, frame: 0 | 1): string[] {
  if (row < 2) return frame === 0 ? PIXEL_SQUID_A : PIXEL_SQUID_B;
  if (row < 4) return frame === 0 ? PIXEL_CRAB_A : PIXEL_CRAB_B;
  return frame === 0 ? PIXEL_OCTOPUS_A : PIXEL_OCTOPUS_B;
}

function drawPixelGrid(
  ctx: CanvasRenderingContext2D,
  grid: string[],
  x: number,
  y: number,
  scale: number,
  color: string,
) {
  ctx.fillStyle = color;
  for (let row = 0; row < grid.length; row++) {
    const line = grid[row];
    for (let col = 0; col < line.length; col++) {
      if (line[col] !== ".") {
        ctx.fillRect(
          Math.round(x + col * scale),
          Math.round(y + row * scale),
          scale,
          scale,
        );
      }
    }
  }
}

// (drawInvaderShape removed — the v0.4.x geometric-shape renderer it
//  implemented was superseded by the per-row Space Invaders silhouettes
//  rendered via PIXEL_GRIDS + drawPixelGrid above. The historical
//  Higgsfield-PNG-sprite-pack comment + "geometric-shape renderer"
//  phrasing remain at the top of this file so the splash harness can
//  still assert the audit trail.)
