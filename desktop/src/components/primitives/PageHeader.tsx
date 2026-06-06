// Primitive: PageHeader.
//
// v0.6.2 — Linear/Whop-pattern page header that replaces the 16:9 painted
// DeckHero on every internal page (Earn, Schedule, Upload, Payouts, Learn,
// Settings). DeckHero stays only on the Workspace empty state + Splash —
// the two "moment of arrival" surfaces.
//
// Why the swap (see docs/SERIES_A_GAP_REPORT.md):
//   - Competitor scan showed 0/5 clipping competitors put painted-illustration
//     headers on every internal page; they all use type hierarchy.
//   - Painted DeckHero ate ~200px of vertical space per page; PageHeader is
//     ~80px, so we ~triple the density of cards-above-the-fold.
//   - Brand chrome stays consistent: a 32px lucide glyph in fuchsia and a 1px
//     fuchsia rule under the title hold the gangster identity without
//     fighting the content below.
//
// Visual recipe (intentionally tight):
//   [glyph] [eyebrow mono]
//           HEADLINE (display semibold 28px tracking -0.025em)
//           lede (sans 13px text-text-secondary)
//   ──────────────────────────────────────── (1px fuchsia/30 rule)
//
// Trailing slot is right-aligned on the same baseline as the headline so
// per-page actions ("Manage connections", "Open Whop dashboard") sit at the
// same height the eye expects on every page.

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type PageHeaderProps = {
  /** Tiny lucide glyph in the fuchsia eyebrow row. */
  glyph: LucideIcon;
  /** Mono-uppercase eyebrow label — e.g. "earn deck". */
  eyebrow: string;
  /** Display-font headline for the page. */
  title: string;
  /** Optional single-sentence lede. */
  subtitle?: string;
  /** Optional right-aligned actions. */
  trailing?: ReactNode;
  /** Extra classes on the outer header element. */
  className?: string;
};

export function PageHeader({
  glyph: Glyph,
  eyebrow,
  title,
  subtitle,
  trailing,
  className = "",
}: PageHeaderProps) {
  return (
    <header
      className={`relative flex flex-col gap-3 border-b border-fuchsia/25 pb-5 ${className}`}
    >
      {/* Eyebrow row — glyph + label, fuchsia, monospace. Stays small so the
          headline below carries the visual weight. */}
      <div className="flex items-center gap-2 text-fuchsia">
        <Glyph size={16} strokeWidth={2} aria-hidden="true" />
        <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] leading-none">
          {eyebrow}
        </span>
      </div>

      {/* Title + lede + optional trailing actions sit on a single flex row so
          the actions baseline-align with the headline at desktop widths and
          stack neatly below on narrow widths. */}
      <div className="flex flex-col items-start gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-[28px] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
            {title}
          </h1>
          {subtitle ? (
            <p className="max-w-[640px] font-sans text-[13px] leading-relaxed text-text-secondary">
              {subtitle}
            </p>
          ) : null}
        </div>
        {trailing ? (
          <div className="flex shrink-0 items-center gap-2">{trailing}</div>
        ) : null}
      </div>
    </header>
  );
}
