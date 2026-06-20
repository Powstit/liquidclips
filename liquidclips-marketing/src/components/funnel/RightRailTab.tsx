"use client";

import { openConsole } from "@/lib/consoleBus";

/**
 * Right-edge vertical tab. Persistent across the whole page.
 * Brand fuchsia, rotated text. Click → opens InformationConsole as an
 * overlay (no page navigation, no scroll jump).
 */
export function RightRailTab() {
  return (
    <button
      type="button"
      className="lc-railtab"
      onClick={() => openConsole()}
      aria-label="Open the information console"
    >
      <span className="lc-railtab-glyph" aria-hidden="true">◆</span>
      <span className="lc-railtab-text">THERE&apos;S MORE</span>
      <span className="lc-railtab-glyph lc-railtab-glyph--end" aria-hidden="true">→</span>
    </button>
  );
}
