/**
 * WorldLayer · single-mount, fixed cinematic backdrop
 *
 * Per Phase 4B-rev rule: every route uses its SECTION-SPECIFIC world.
 * No generic cockpit fallback unless explicitly the cockpit-home surface.
 *
 * Layers (back → front):
 *   1. .lc-world-scene · the world webp (fixed full-bleed, slow pan)
 *   2. .lc-world-tint  · radial fuchsia tint (low opacity, screen blend)
 *   3. .lc-world-rim   · diagonal fuchsia key streak
 *   4. .lc-world-vignette · radial dark mask
 *   5. .lc-world-grain · subtle film grain (CSS only, no PNG)
 */

import { useEffect, useRef } from "react";
import { getWorld } from "../assets/assetRegistry";
import "./WorldLayer.css";

export type WorldKey =
  | "cockpit-home"
  | "source-bay"
  | "cutting-floor"
  | "studio-deck"
  | "mission-pedestal"
  | "squad-lounge"
  | "relay-tower"
  | "boot-sequence";

/** PRODUCT STANDARD (locked 2026-06-25 · one cockpit room): when a
 *  requested world is absent from the asset registry, fall back to the
 *  cockpit-home anchor instead of going dark. The DOM exposes the
 *  fallback status via `data-world-registry-resolved` so QA can fail
 *  loudly when the registry drifts away from a consuming surface. */
const FALLBACK_WORLD: WorldKey = "cockpit-home";

interface ResolvedWorld {
  path: string;
  resolvedFromRegistry: boolean;
  registryId: string | null;
}

function resolveWorldPath(world: WorldKey): ResolvedWorld {
  const entry = getWorld(world);
  if (entry) {
    return { path: entry.publicPath, resolvedFromRegistry: true, registryId: entry.id };
  }
  // Loud signal in console + DOM so the QA gate and devtools both
  // surface the drift — never silently swallow a missing world.
  // eslint-disable-next-line no-console
  console.warn(
    `[WorldLayer] world "${world}" missing from assetRegistry · falling back to ${FALLBACK_WORLD}.`,
  );
  const fallback = getWorld(FALLBACK_WORLD);
  return {
    path: fallback?.publicPath ?? "/brand/worlds/cockpit-home.webp",
    resolvedFromRegistry: false,
    registryId: fallback?.id ?? null,
  };
}

export interface WorldLayerProps {
  world: WorldKey;
  /** Optional particle canvas. Kept opt-in because a forever repainting
   * backdrop makes route navigation feel sluggish in the Tauri WebView. */
  particles?: boolean;
}

export function WorldLayer({ world, particles = false }: WorldLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!particles) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const dots: Array<{ x: number; y: number; r: number; vx: number; vy: number; a: number; c: [number, number, number] }> = [];
    const N = 48;
    let w = 0, h = 0;
    let running = true;
    let raf = 0;

    const resize = () => {
      w = canvas.width = window.innerWidth * dpr;
      h = canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };
    const spawn = (d: typeof dots[number]) => {
      d.x = Math.random() * w;
      d.y = Math.random() * h;
      d.r = (Math.random() * 1.5 + 0.4) * dpr;
      d.vx = (Math.random() - 0.5) * 0.08 * dpr;
      d.vy = (Math.random() * 0.14 + 0.04) * dpr;
      d.a = Math.random() * 0.6 + 0.2;
      d.c = Math.random() < 0.14 ? [255, 102, 184] : [248, 246, 240];
    };
    for (let i = 0; i < N; i++) {
      const d = { x: 0, y: 0, r: 1, vx: 0, vy: 0, a: 0.5, c: [248, 246, 240] as [number, number, number] };
      spawn(d);
      dots.push(d);
    }
    resize();
    window.addEventListener("resize", resize);
    const onVis = () => (running = !document.hidden);
    document.addEventListener("visibilitychange", onVis);
    const tick = () => {
      if (running) {
        ctx.clearRect(0, 0, w, h);
        for (const d of dots) {
          d.x += d.vx; d.y += d.vy;
          if (d.y > h + 4) spawn(d);
          if (d.x < -4) d.x = w + 4;
          if (d.x > w + 4) d.x = -4;
          ctx.beginPath();
          ctx.fillStyle = `rgba(${d.c[0]},${d.c[1]},${d.c[2]},${d.a})`;
          ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      raf = requestAnimationFrame(tick);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [particles]);

  const resolved = resolveWorldPath(world);

  return (
    <div
      className="lc-world"
      aria-hidden="true"
      data-world-key={world}
      data-world-registry-resolved={String(resolved.resolvedFromRegistry)}
      data-world-registry-id={resolved.registryId ?? ""}
    >
      <div
        className="lc-world-scene"
        style={{ backgroundImage: `url(${resolved.path})` }}
      />
      <div className="lc-world-tint" />
      <div className="lc-world-rim" />
      <div className="lc-world-vignette" />
      <div className="lc-world-grain" />
      {particles && <canvas ref={canvasRef} className="lc-world-canvas" />}
    </div>
  );
}
