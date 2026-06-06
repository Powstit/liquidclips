// v0.6.3 — Workspace cover-art card (MJ creator-card pattern).
//
// Lives only on the Workspace empty state — the "moment of arrival"
// surface. Internal pages (Earn / Schedule / Upload / Payouts / Learn /
// Settings) use the typographic PageHeader instead.
//
// Visual recipe (locked from the approved /tmp/lc-mockup/v063.html):
//   - 16:7 aspect band, full-bleed painted cover (object-cover, center 32%)
//   - left-side gradient scrim so the right 60% of the painting still
//     reads while the title plate on the left stays legible
//   - four HUD bracket corners (12×12 px, fuchsia, 1.5px stroke) that
//     stagger-flicker on a 4s cycle (1s offsets each)
//   - eyebrow with live dot (1.6s breathe), display headline, lede,
//     fuchsia CTA pill that pulses 2.4s
//   - cover painting pans subtly on a 26s loop so the world breathes
//
// Animations live in src/index.css under `.lc-deck-cover-*` so the band
// stays small and props-driven.

import React from "react";

export function DeckHero({
  image,
  eyebrow,
  title,
  subtitle,
  trailing,
  className = "",
}: {
  image: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** Optional override for the fuchsia CTA pill (defaults to a label). */
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={`lc-deck-cover relative overflow-hidden rounded-3xl border border-fuchsia/30 bg-paper shadow-[0_30px_80px_-40px_rgba(255,26,140,0.55)] ${className}`}
      style={{ aspectRatio: "16 / 7" }}
    >
      {/* Painted cover — slow horizontal pan so the world looks alive. */}
      <img
        src={image}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="lc-deck-cover-img absolute inset-0 h-full w-full select-none object-cover"
        style={{ objectPosition: "center 32%" }}
      />

      {/* Left-side scrim — keeps the title plate readable across paintings. */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-3/5 bg-gradient-to-r from-paper via-paper/70 to-transparent"
        aria-hidden="true"
      />

      {/* HUD bracket corners — pure CSS, stagger-flicker via .lc-deck-cover-hud-* */}
      <span aria-hidden="true" className="lc-deck-cover-hud lc-deck-cover-hud-tl" />
      <span aria-hidden="true" className="lc-deck-cover-hud lc-deck-cover-hud-tr" />
      <span aria-hidden="true" className="lc-deck-cover-hud lc-deck-cover-hud-bl" />
      <span aria-hidden="true" className="lc-deck-cover-hud lc-deck-cover-hud-br" />

      {/* Title plate — left-aligned, fuchsia eyebrow with live dot. */}
      <div className="relative z-10 flex h-full items-center px-8 py-6">
        <div className="flex max-w-[460px] flex-col items-start gap-2 text-left text-ink">
          <div className="lc-deck-cover-eyebrow flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-fuchsia">
            <span className="lc-deck-cover-eyebrow-dot" aria-hidden="true" />
            {eyebrow}
          </div>
          <h1 className="font-display text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
            {title}
          </h1>
          {subtitle ? (
            <p className="font-sans text-[14px] leading-relaxed text-text-secondary">
              {subtitle}
            </p>
          ) : null}
          {trailing ? <div className="mt-2 lc-deck-cover-cta-wrap">{trailing}</div> : null}
        </div>
      </div>
    </header>
  );
}
