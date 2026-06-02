import { useEffect, useRef, useState } from "react";
import type { GameState } from "../../lib/invaders/engine";

// Sprites bundled by Vite (import-as-URL). Loaded once per canvas mount as
// HTMLImageElements so draw() doesn't pay an Image() decode per frame. While
// they're still decoding the draw path falls back to the geometric shapes
// the engine shipped with, so the splash never blanks out on first paint.
//
// 2026-06-02 sprite pack refresh — 5 per-row invader variants from Higgsfield
// Nano Banana 2 (boss / mothership / elite / drone / grunt) + redesigned
// neon-fuchsia player ship. Each invader is pre-coloured so we drop the
// per-row hue-rotate filter and read each row as a distinct enemy tier
// straight from the art.
import playerShipUrl from "../../assets/invaders/player_ship.png";
import invaderBossUrl from "../../assets/invaders/boss.png";
import invaderMothershipUrl from "../../assets/invaders/mothership.png";
import invaderEliteUrl from "../../assets/invaders/elite.png";
import invaderDroneUrl from "../../assets/invaders/drone.png";
import invaderGruntUrl from "../../assets/invaders/grunt.png";
import bulletPlayerUrl from "../../assets/invaders/bullet-player.png";
import bulletInvaderUrl from "../../assets/invaders/bullet-invader.png";

type Sprites = {
  player: HTMLImageElement | null;
  invaders: (HTMLImageElement | null)[]; // index = row (0..4)
  bulletPlayer: HTMLImageElement | null;
  bulletInvader: HTMLImageElement | null;
};

// Per-row sprite mapping. Top row = boss tier (rarest, strongest visual).
// Bottom row = grunt (most common). Mid rows pick from the pack to give a
// satisfying gradient of menace.
const ROW_SPRITE_URL = [
  invaderBossUrl,        // row 0 — boss
  invaderMothershipUrl,  // row 1 — mothership
  invaderEliteUrl,       // row 2 — elite
  invaderDroneUrl,       // row 3 — drone
  invaderGruntUrl,       // row 4 — grunt
];


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
  const spritesRef = useRef<Sprites>({ player: null, invaders: [null, null, null, null, null], bulletPlayer: null, bulletInvader: null });
  // VFX state (parallax + particles + shake + trail + idle sway). Init once
  // per canvas mount with the current dimensions so star positions are sane
  // even on the first frame.
  const vfxRef = useRef<VfxState>(initVfx(width, height));
  // Keep paused in a ref so the RAF loop can read it without re-binding.
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  const [, setSpritesReady] = useState(0); // bumps to trigger re-render once decoded
  useEffect(() => {
    let cancelled = false;
    const load = (url: string) => new Promise<HTMLImageElement>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(img); // silently fall back to shapes
      img.src = url;
    });
    Promise.all([
      load(playerShipUrl),
      load(ROW_SPRITE_URL[0]),
      load(ROW_SPRITE_URL[1]),
      load(ROW_SPRITE_URL[2]),
      load(ROW_SPRITE_URL[3]),
      load(ROW_SPRITE_URL[4]),
      load(bulletPlayerUrl),
      load(bulletInvaderUrl),
    ]).then(([p, r0, r1, r2, r3, r4, bp, bi]) => {
      if (cancelled) return;
      spritesRef.current = { player: p, invaders: [r0, r1, r2, r3, r4], bulletPlayer: bp, bulletInvader: bi };
      setSpritesReady((n) => n + 1);
    });
    return () => { cancelled = true; };
  }, []);

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

  return <canvas ref={canvasRef} className="rounded-lg" />;
}

// ── VFX state (sprint splash-polish 2026-06-02) ───────────────────────
// Purely visual — lives outside the engine so gameplay stays pure. Tracked
// inside the canvas component via a module-scoped object passed into draw.
// "Depth" comes from: parallax starfield + ship engine trail + particles
// + screen shake + idle sway when paused.

type Star = { x: number; y: number; layer: 0 | 1 | 2; size: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; hue: string };
type TrailDot = { x: number; y: number; life: number };

export type VfxState = {
  stars: Star[];                      // populated once
  particles: Particle[];
  shake: number;                       // pixels of offset, decays each frame
  trail: TrailDot[];
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

  // invaders — per-row sprite from the Higgsfield pack. Visual box is 36×36
  // (slightly larger than the 32×32 single-wasp era to read the detail in
  // the new art); collision math stays unchanged on the engine's 24×16.
  // Mothership (row 1) gets a wider 48×28 box because the art is letterbox.
  for (const i of state.invaders) {
    if (!i.alive) continue;
    const drawX = i.pos.x + swayOffset;
    const rowIdx = Math.min(i.row, ROW_SPRITE_URL.length - 1);
    const img = sprites.invaders[rowIdx];
    if (img && img.complete && img.naturalWidth > 0) {
      const isMothership = rowIdx === 1;
      const sw = isMothership ? 48 : 36;
      const sh = isMothership ? 28 : 36;
      ctx.drawImage(img, drawX - sw / 2, i.pos.y - sh / 2, sw, sh);
    } else {
      // Fallback while the image is still decoding on first paint.
      ctx.fillStyle = invaderColor(i.row);
      drawInvaderShape(ctx, i.row % 3, drawX - 12, i.pos.y - 8, 24, 16);
    }
  }

  // player ship — visual 44×44, collision unchanged (PLAYER_W=24/H=12)
  const px = state.player.x;
  const py = state.player.y;
  if (sprites.player && sprites.player.complete && sprites.player.naturalWidth > 0) {
    const sw = 44, sh = 44;
    ctx.drawImage(sprites.player, px - sw / 2, py - sh / 2 + 4, sw, sh);
  } else {
    ctx.fillStyle = "#FF1A8C";
    ctx.beginPath();
    ctx.moveTo(px, py - 6);
    ctx.lineTo(px + 12, py + 6);
    ctx.lineTo(px - 12, py + 6);
    ctx.closePath();
    ctx.fill();
  }

  // bullets — chevron sprite at 14×20 visual, collision stays 3×8
  for (const b of state.bullets) {
    const img = b.from === "player" ? sprites.bulletPlayer : sprites.bulletInvader;
    if (img && img.complete && img.naturalWidth > 0) {
      const sw = 14, sh = 20;
      ctx.drawImage(img, b.pos.x - sw / 2, b.pos.y - sh / 2, sw, sh);
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
  if (row < 2) return "#FF1A8C";
  if (row < 4) return "#FF66B8";
  return "#FF8FCB";
}

function drawInvaderShape(
  ctx: CanvasRenderingContext2D,
  shape: number,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (shape === 0) {
    // square
    ctx.fillRect(x, y, w, h);
  } else if (shape === 1) {
    // diamond
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w, y + h / 2);
    ctx.lineTo(x + w / 2, y + h);
    ctx.lineTo(x, y + h / 2);
    ctx.closePath();
    ctx.fill();
  } else {
    // oval
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
