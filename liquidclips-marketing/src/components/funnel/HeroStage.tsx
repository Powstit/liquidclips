"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { HeroPaste } from "./HeroPaste";

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║   LOCKED VISUAL BASELINE · KADE WORLD · WINDOW 1                 ║
 * ║   Approved by Daniel · do not redesign · do not rebuild.         ║
 * ║                                                                  ║
 * ║   Future sections inherit:                                       ║
 * ║     · tokens   · :root --w1-room/--w1-fx/--w1-cy/...             ║
 * ║     · spacing  · 22-32 px stage padding · 60 px content top      ║
 * ║     · glow     · radial cyan rim, fuchsia bloom on action        ║
 * ║     · reticle  · solid 1px brackets · NEVER dashed/dotted        ║
 * ║     · type     · Inter Black H1 · Geist Mono eyebrows · 0.22em   ║
 * ║     · motion   · transform/opacity only · reduced-motion gate    ║
 * ║                                                                  ║
 * ║   If you touch this file outside a small responsive fix, you     ║
 * ║   are changing the standard the rest of the page renders to.    ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Window 1 · Drop the Tape.
 * One continuous near-black room. Camera is low and front-facing.
 * Hero URL input is the hardware. Real footage floats at depth behind
 * it (ghosted videos waiting to be scanned). Kade stands to the right
 * of the input as an idle scout · wakes on focus.
 */

const GHOSTS = [
  { src: "/cinematic/demo-clip.mp4",   x: -28, y:  -8, scale: 0.78, rot:  -6, opacity: 0.32, blur: 2 },
  { src: "/cinematic/demo-clip-2.mp4", x:  34, y: -16, scale: 0.62, rot:   8, opacity: 0.28, blur: 3 },
  { src: "/cinematic/demo-clip-3.mp4", x:  18, y:  22, scale: 0.54, rot: -10, opacity: 0.24, blur: 2 },
  { src: "/img/clipper-editing.jpg",   x: -36, y:  18, scale: 0.5,  rot:  10, opacity: 0.30, blur: 3, still: true },
  { src: "/img/clipper-win.jpg",       x:  44, y:  28, scale: 0.42, rot:  -4, opacity: 0.22, blur: 4, still: true },
];

export function HeroStage() {
  const stageRef = useRef<HTMLElement>(null);
  const kadeRef = useRef<HTMLDivElement>(null);
  const kadeGlowRef = useRef<HTMLDivElement>(null);
  const depthRef = useRef<HTMLDivElement>(null);
  const [awake, setAwake] = useState(false);
  const [reduced, setReduced] = useState(false);

  // Reduced-motion gate.
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(m.matches);
    const fn = (e: MediaQueryListEvent) => setReduced(e.matches);
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  }, []);

  // Pointer parallax · kade + glow + depth field. Transform-only.
  useEffect(() => {
    if (reduced) return;
    const stage = stageRef.current;
    if (!stage) return;
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
    function tick() {
      cx += (tx - cx) * 0.08;
      cy += (ty - cy) * 0.08;
      if (kadeRef.current)
        kadeRef.current.style.transform = `translate3d(${cx * -18}px, ${cy * -14}px, 0)`;
      if (kadeGlowRef.current)
        kadeGlowRef.current.style.transform = `translate3d(${cx * -10}px, ${cy * -8}px, 0)`;
      if (depthRef.current)
        depthRef.current.style.transform = `translate3d(${cx * -24}px, ${cy * -16}px, 0)`;
      if (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    }
    function onMove(e: PointerEvent) {
      if (!stage) return;
      const r = stage.getBoundingClientRect();
      if (!r.width) return;
      tx = ((e.clientX - r.left) / r.width) * 2 - 1;
      ty = ((e.clientY - r.top) / r.height) * 2 - 1;
      if (!raf) raf = requestAnimationFrame(tick);
    }
    function onLeave() {
      tx = 0; ty = 0;
      if (!raf) raf = requestAnimationFrame(tick);
    }
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerleave", onLeave);
    return () => {
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced]);

  return (
    <section ref={stageRef} className={`lc-w1 ${awake ? "lc-w1--wake" : ""}`}>
      {/* room plate · near-black with two-source neon */}
      <div className="lc-w1-room" aria-hidden="true">
        <div className="lc-w1-room-bloom-fx" />
        <div className="lc-w1-room-bloom-cy" />
        <div className="lc-w1-room-floor" />
        <div className="lc-w1-room-grid" />
        <div className="lc-w1-room-scanlines" />
        <div className="lc-w1-room-vignette" />
      </div>

      {/* depth field · ghosted videos waiting to be scanned */}
      <div className="lc-w1-depth" ref={depthRef} aria-hidden="true">
        {GHOSTS.map((g, i) => (
          <div
            key={i}
            className={`lc-w1-ghost ${g.still ? "is-still" : ""}`}
            style={{
              left: `calc(50% + ${g.x}vw)`,
              top: `calc(50% + ${g.y}vh)`,
              transform: `translate(-50%, -50%) rotate(${g.rot}deg) scale(${g.scale})`,
              opacity: g.opacity,
              filter: `blur(${g.blur}px) saturate(0.55) brightness(0.7)`,
            }}
          >
            {g.still ? (
              <Image
                src={g.src}
                alt=""
                width={640}
                height={360}
                className="lc-w1-ghost-media"
                priority={i < 2}
              />
            ) : (
              <video
                src={g.src}
                muted
                autoPlay
                loop
                playsInline
                preload="metadata"
                className="lc-w1-ghost-media"
                poster="/cinematic/cabinet-demo-frame.png"
              />
            )}
            {/* solid reticle frame on each ghost · "queued tape" feel */}
            <span className="lc-w1-ghost-bracket lc-w1-ghost-bracket--tl" />
            <span className="lc-w1-ghost-bracket lc-w1-ghost-bracket--tr" />
            <span className="lc-w1-ghost-bracket lc-w1-ghost-bracket--bl" />
            <span className="lc-w1-ghost-bracket lc-w1-ghost-bracket--br" />
          </div>
        ))}
      </div>

      {/* top HUD · console identity · quiet chrome */}
      <div className="lc-w1-hud">
        <div className="lc-w1-hud-left">
          <span className="lc-w1-hud-mark">liquid/clips</span>
          <span className="lc-w1-hud-sep">/</span>
          <span className="lc-w1-hud-sub">the workbench · console v0.8</span>
        </div>
        <div className="lc-w1-hud-right">
          <span className="lc-w1-hud-pill">
            <span className="lc-w1-hud-dot" /> KADE // SCOUT UNIT ONLINE
          </span>
        </div>
      </div>

      {/* Kade · idle on standby, wakes on input focus */}
      <div className="lc-w1-kade-rig">
        <div ref={kadeGlowRef} className="lc-w1-kade-cyan-rim" aria-hidden="true" />
        <div ref={kadeRef} className="lc-w1-kade">
          <Image
            src="/brand/kade/kade-idle.webp"
            alt=""
            width={720}
            height={720}
            className="lc-w1-kade-img"
            priority
          />
          <span className="lc-w1-kade-blink" aria-hidden="true" />
        </div>
      </div>

      {/* centred copy block · low front-facing camera */}
      <div className="lc-w1-content">
        <div className="lc-w1-eb">
          <span className="lc-w1-eb-dot" /> KADE // SCOUT UNIT ONLINE
        </div>

        <h1 className="lc-w1-h1">
          Your next <em>viral clip</em> is hiding in a 90-minute video.
        </h1>

        <p className="lc-w1-sub">
          Paste the long video. Kade takes it from there.
        </p>

        <HeroPaste onWake={setAwake} />

        <div className="lc-w1-status">
          <span>NO CREDITS</span>
          <span className="lc-w1-status-sep" aria-hidden="true">·</span>
          <span>NO TIMELINE</span>
          <span className="lc-w1-status-sep" aria-hidden="true">·</span>
          <span>NO GUESSING</span>
        </div>
      </div>

      {/* corner ticks · the "room" reads as a console, not a webpage */}
      <span className="lc-w1-tick lc-w1-tick--tl" aria-hidden="true" />
      <span className="lc-w1-tick lc-w1-tick--tr" aria-hidden="true" />
      <span className="lc-w1-tick lc-w1-tick--bl" aria-hidden="true" />
      <span className="lc-w1-tick lc-w1-tick--br" aria-hidden="true" />
    </section>
  );
}
