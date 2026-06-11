// ───── IG-012 brand-kit primitive ─────
// EmptyState — the canonical "this room has nothing yet" surface. Brand-kit
// locked: pixel invader landmark + Geist Mono eyebrow + Inter display heading
// + Inter sans body + at most ONE primary fuchsia CTA + optional ghost
// secondary. Zero solid 1px borders (which the brand kit bans on cards).
//
// Consumers: LibraryWall, ResultsGrid, Schedule queue, Earn discover when
// signed-out, anywhere the room is empty but real. Use this primitive
// instead of writing inline empty states — it kills drift class-wide.
//
// Custom glyph slot is available for surface-specific landmarks (e.g.
// Schedule could pass a clock instead of the invader), but the default
// invader keeps the rooms consistent.

import type { ReactNode } from "react";
import { PixelInvader } from "./PixelInvader";

export function EmptyState({
  eyebrow,
  heading,
  body,
  cta,
  secondaryCta,
  glyph,
  size = "md",
}: {
  eyebrow: string;
  heading: string;
  body: string;
  cta?: { label: string; onClick: () => void };
  secondaryCta?: { label: string; onClick: () => void };
  /** Optional surface-specific landmark. Defaults to the pixel invader. */
  glyph?: ReactNode;
  /** Visual rhythm. `md` default for grid-context; `lg` for full-room hero
   *  empty states; `sm` for inline / list contexts. */
  size?: "sm" | "md" | "lg";
}) {
  const config = {
    sm: { py: "py-10", glyphSize: "h-10 w-14", headSize: "text-[16px]", bodySize: "text-[12px]", maxWidth: "max-w-[340px]" },
    md: { py: "py-16", glyphSize: "h-16 w-24", headSize: "text-[22px]", bodySize: "text-[13px]", maxWidth: "max-w-[420px]" },
    lg: { py: "py-24", glyphSize: "h-24 w-32", headSize: "text-[28px]", bodySize: "text-[14px]", maxWidth: "max-w-[480px]" },
  }[size];

  return (
    <div className={`relative flex flex-col items-center text-center ${config.py}`}>
      {/* Atmosphere plate — fuchsia radial glow at low opacity so the room
          reads as "empty but alive", not "broken". */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(60% 50% at 50% 40%, rgba(255,26,140,0.18), transparent 70%)",
          opacity: 0.55,
        }}
      />

      <div className="relative">
        {glyph ?? <PixelInvader className={config.glyphSize} glow="md" />}
      </div>

      <div className="relative mt-5 font-mono text-[10px] uppercase tracking-[0.18em] font-medium text-fuchsia-deep">
        {eyebrow}
      </div>

      <h3 className={`relative mt-2 font-display ${config.headSize} font-semibold tracking-[-0.02em] text-ink leading-tight`}>
        {heading}
      </h3>

      <p className={`relative mt-2 ${config.bodySize} ${config.maxWidth} mx-auto leading-relaxed text-ink-soft`}>
        {body}
      </p>

      {(cta || secondaryCta) && (
        <div className="relative mt-6 flex flex-wrap items-center justify-center gap-2">
          {cta && (
            <button
              onClick={cta.onClick}
              className="h-10 px-5 rounded-full bg-fuchsia text-white text-[13px] font-semibold hover:bg-fuchsia-bright transition-all"
              style={{
                boxShadow: "0 0 0 1px rgba(255,26,140,0.45), 0 12px 36px rgba(255,26,140,0.28)",
              }}
            >
              {cta.label}
            </button>
          )}
          {secondaryCta && (
            // Ghost CTA — no solid border (brand-kit ban). Uses transparent
            // fill + subtle hover with fuchsia tint instead.
            <button
              onClick={secondaryCta.onClick}
              className="h-10 px-5 rounded-full font-mono text-[11px] uppercase tracking-[0.14em] font-semibold text-ink-soft hover:text-fuchsia-deep hover:bg-fuchsia-soft transition-all"
            >
              {secondaryCta.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
