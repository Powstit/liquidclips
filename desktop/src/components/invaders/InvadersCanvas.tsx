import { useEffect, useRef, useState } from "react";
import type { GameState } from "../../lib/invaders/engine";

// Sprites bundled by Vite (import-as-URL). Loaded once per canvas mount as
// HTMLImageElements so draw() doesn't pay an Image() decode per frame. While
// they're still decoding the draw path falls back to the geometric shapes
// the engine shipped with, so the splash never blanks out on first paint.
import playerShipUrl from "../../assets/invaders/player-ship.png";
import invaderWaspUrl from "../../assets/invaders/invader-wasp.png";
import bulletPlayerUrl from "../../assets/invaders/bullet-player.png";
import bulletInvaderUrl from "../../assets/invaders/bullet-invader.png";

type Sprites = {
  player: HTMLImageElement | null;
  invader: HTMLImageElement | null;
  bulletPlayer: HTMLImageElement | null;
  bulletInvader: HTMLImageElement | null;
};

// Per-row hue rotation so all 5 invader rows share the one wasp asset but
// read as distinct colour tiers. Row 0 is the "queen" (most red/elite),
// row 4 is the "grunt" (most green).
const ROW_HUE: Record<number, string> = {
  0: "hue-rotate(-20deg) saturate(1.15)",   // red/magenta queen
  1: "hue-rotate(10deg)",                    // amber
  2: "hue-rotate(45deg) saturate(0.95)",     // yellow
  3: "hue-rotate(80deg)",                    // lime
  4: "hue-rotate(110deg) saturate(0.9)",     // teal grunt
};


type Props = {
  state: GameState;
  onStep: (dtMs: number) => void;
  width: number;
  height: number;
};

export function InvadersCanvas({ state, onStep, width, height }: Props) {
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
  const spritesRef = useRef<Sprites>({ player: null, invader: null, bulletPlayer: null, bulletInvader: null });
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
      load(invaderWaspUrl),
      load(bulletPlayerUrl),
      load(bulletInvaderUrl),
    ]).then(([p, i, bp, bi]) => {
      if (cancelled) return;
      spritesRef.current = { player: p, invader: i, bulletPlayer: bp, bulletInvader: bi };
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

      // setTransform replaces the matrix entirely (it doesn't multiply), so
      // bracketing each draw with save/setTransform/draw/restore keeps the
      // scale at exactly dpr×dpr per frame regardless of any state changes.
      const c = canvas!.getContext("2d")!;
      c.save();
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(c, stateRef.current, width, height, spritesRef.current);
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

function draw(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  w: number,
  h: number,
  sprites: Sprites,
) {
  // Sprint #18 — transparent canvas. clearRect (vs solid fillRect) lets the
  // app background show through the game layer, so the game feels integrated
  // with the workspace instead of a popup that blanks the screen.
  ctx.clearRect(0, 0, w, h);

  // invaders — sprite scaled up from collision-box (24×16) to visual (32×32)
  // so the wasp art reads at the splash canvas size; collision math is
  // unchanged so gameplay feel stays the same as the geometric shapes.
  for (const i of state.invaders) {
    if (!i.alive) continue;
    if (sprites.invader && sprites.invader.complete && sprites.invader.naturalWidth > 0) {
      const sw = 32, sh = 32;
      ctx.save();
      // Per-row hue rotation so each row reads as a distinct enemy tier.
      ctx.filter = ROW_HUE[i.row] ?? "none";
      ctx.drawImage(sprites.invader, i.pos.x - sw / 2, i.pos.y - sh / 2, sw, sh);
      ctx.restore();
    } else {
      // Fallback while the image is still decoding on first paint.
      ctx.fillStyle = invaderColor(i.row);
      drawInvaderShape(ctx, i.row % 3, i.pos.x - 12, i.pos.y - 8, 24, 16);
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
