"use client";

/**
 * Hero · Trust strip.
 *
 * One inline row of three platform pills, rendered between the H1 and
 * the sub copy. All three are visible at all times — we are not
 * filtering to the detected OS because the strip's job is to communicate
 * "we ship on every platform you care about, honestly," not to
 * personalise. Per-platform honesty (per desktop/CLAUDE.md "Windows +
 * Linux release path"):
 *   · macOS   — Notarised by Apple   (per IG-013, Developer ID + notarised)
 *   · Windows — Available now (unsigned beta)   (no EV cert yet)
 *   · Linux   — AppImage + .deb     (AppImage portable; .deb unsigned)
 *
 * Glyphs are inline SVGs in `currentColor` — no Lucide, no external icon
 * import. Each glyph is a simple geometric mark, not a logo (Apple /
 * Microsoft / Tux trademarks are deliberately NOT used; we draw the
 * generic shape of a Mac window dot, a Windows tile, and a Linux
 * terminal prompt).
 *
 * Reduced-motion safe — pure static markup, no animation hooks.
 */
export function HeroTrustStrip() {
  return (
    <ul className="lc-w1-trust-strip" aria-label="Supported platforms and signing status">
      <li className="lc-w1-trust-pill">
        <span className="lc-w1-trust-glyph" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="11" height="11">
            <circle cx="4" cy="4" r="1.6" fill="currentColor" />
            <circle cx="8" cy="4" r="1.6" fill="currentColor" />
            <circle cx="12" cy="4" r="1.6" fill="currentColor" />
            <rect
              x="1.5"
              y="1.5"
              width="13"
              height="13"
              rx="2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        </span>
        <span className="lc-w1-trust-label">Mac · Notarised by Apple</span>
      </li>
      <li className="lc-w1-trust-pill">
        <span className="lc-w1-trust-glyph" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="11" height="11">
            <rect x="2" y="2" width="5" height="5" fill="currentColor" />
            <rect x="9" y="2" width="5" height="5" fill="currentColor" />
            <rect x="2" y="9" width="5" height="5" fill="currentColor" />
            <rect x="9" y="9" width="5" height="5" fill="currentColor" />
          </svg>
        </span>
        <span className="lc-w1-trust-label">Windows · Available now (unsigned beta)</span>
      </li>
      <li className="lc-w1-trust-pill">
        <span className="lc-w1-trust-glyph" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="11" height="11">
            <path
              d="M2 4l3 4-3 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="square"
              strokeLinejoin="miter"
            />
            <line
              x1="7"
              y1="12"
              x2="14"
              y2="12"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="square"
            />
          </svg>
        </span>
        <span className="lc-w1-trust-label">Linux · AppImage + .deb</span>
      </li>
    </ul>
  );
}
