"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

/**
 * Window 2 · Kade Scans.
 * Inherits LOCKED W1 standard. Camera ~15° above horizon · scan chamber.
 * Cyan dominates · fuchsia ONLY when a hook is detected.
 */

const TERMINAL_LINES = [
  "READING TRANSCRIPT…",
  "DETECTING HOOKS…",
  "MARKING REPLAY MOMENTS…",
  "SCORING VIRAL TENSION…",
  "BUILDING YOUR VAULT…",
];

const HOOK_MARKERS = [
  { left: "18%", top: "32%", label: "HOOK · 00:42" },
  { left: "62%", top: "58%", label: "HOOK · 03:18" },
  { left: "78%", top: "28%", label: "HOOK · 07:04" },
];

export function KadeScansWindow() {
  const [lineIdx, setLineIdx] = useState(0);
  const [hookSpark, setHookSpark] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(m.matches);
    const fn = (e: MediaQueryListEvent) => setReduced(e.matches);
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => {
      setLineIdx((i) => (i + 1) % TERMINAL_LINES.length);
    }, 2400);
    return () => window.clearInterval(id);
  }, [reduced]);

  // Fuchsia hook-detected spark fires every ~6s · only when scan loop visible
  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => {
      setHookSpark((n) => n + 1);
    }, 5800);
    return () => window.clearInterval(id);
  }, [reduced]);

  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <section className="lc-w2" aria-labelledby="lc-w2-h">
      <div className="lc-w2-hud">
        <span className="lc-w2-eb">
          <span className="lc-w2-eb-dot" /> KADE // SCANNING TAPE 01
        </span>
        <span className="lc-w2-status">CYAN · DATA · STATUS</span>
      </div>

      <div className="lc-w2-grid">
        {/* Left · the scan chamber */}
        <div className="lc-w2-chamber">
          <span className="lc-w2-bracket lc-w2-bracket--tl" aria-hidden="true" />
          <span className="lc-w2-bracket lc-w2-bracket--tr" aria-hidden="true" />
          <span className="lc-w2-bracket lc-w2-bracket--bl" aria-hidden="true" />
          <span className="lc-w2-bracket lc-w2-bracket--br" aria-hidden="true" />

          <div className="lc-w2-well">
            <video
              ref={videoRef}
              src="/cinematic/demo-clip.mp4"
              poster="/cinematic/cabinet-demo-frame.png"
              muted
              autoPlay
              loop
              playsInline
              preload="metadata"
              className="lc-w2-footage"
            />

            {/* cyan scan bar */}
            <div className="lc-w2-scanbar" aria-hidden="true" />

            {/* horizontal scanlines overlay */}
            <div className="lc-w2-scan-overlay" aria-hidden="true" />

            {/* hook markers · fuchsia rings · pulse on schedule */}
            {HOOK_MARKERS.map((m, i) => (
              <div
                key={i}
                className="lc-w2-hook"
                style={{ left: m.left, top: m.top, animationDelay: `${i * 1.6}s` }}
                data-spark={hookSpark}
              >
                <span className="lc-w2-hook-ring" />
                <span className="lc-w2-hook-label">{m.label}</span>
              </div>
            ))}

            <div className="lc-w2-readout">
              <span className="lc-w2-readout-eb">SCAN · LIVE</span>
              <span className="lc-w2-readout-line">{TERMINAL_LINES[lineIdx]}</span>
            </div>
          </div>
        </div>

        {/* Right · copy + Kade */}
        <div className="lc-w2-side">
          <span className="lc-w2-side-eb">KADE SCANS</span>
          <h2 id="lc-w2-h" className="lc-w2-h2">
            Kade <em>finds</em> the moments.
          </h2>
          <p className="lc-w2-sub">
            The best part is usually buried. Kade digs it out.
          </p>

          <ul className="lc-w2-terminal" aria-live="polite">
            {TERMINAL_LINES.map((line, i) => (
              <li
                key={line}
                className={`lc-w2-terminal-line ${i === lineIdx ? "is-active" : ""} ${i < lineIdx ? "is-done" : ""}`}
              >
                <span className="lc-w2-terminal-dot" />
                <span className="lc-w2-terminal-text">{line}</span>
              </li>
            ))}
          </ul>

          <div className="lc-w2-kade-wrap">
            <div className="lc-w2-kade-rim" aria-hidden="true" />
            <Image
              src="/brand/kade/kade-reading-brief.webp"
              alt=""
              width={420}
              height={420}
              className="lc-w2-kade"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
