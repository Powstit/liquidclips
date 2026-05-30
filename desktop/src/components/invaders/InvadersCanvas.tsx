import { useEffect, useRef } from "react";
import type { GameState } from "../../lib/invaders/engine";

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
      draw(c, stateRef.current, width, height);
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
) {
  // background
  ctx.fillStyle = "#0B0B10";
  ctx.fillRect(0, 0, w, h);

  // invaders
  for (const i of state.invaders) {
    if (!i.alive) continue;
    const color = invaderColor(i.row);
    ctx.fillStyle = color;
    const x = i.pos.x - 12;
    const y = i.pos.y - 8;
    drawInvaderShape(ctx, i.row % 3, x, y, 24, 16);
  }

  // player ship — fuchsia chevron pointing up
  ctx.fillStyle = "#FF1A8C";
  const px = state.player.x;
  const py = state.player.y;
  ctx.beginPath();
  ctx.moveTo(px, py - 6);
  ctx.lineTo(px + 12, py + 6);
  ctx.lineTo(px - 12, py + 6);
  ctx.closePath();
  ctx.fill();

  // bullets
  for (const b of state.bullets) {
    ctx.fillStyle = b.from === "player" ? "#FF66B8" : "#C70066";
    ctx.fillRect(b.pos.x - 1.5, b.pos.y - 4, 3, 8);
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
