/**
 * CockpitTile · Home primary action tile
 *
 * Ports `.cockpit-tile` from desktop/docs/demo-pages.html into the live shell.
 * HUD bracket corners + halo glow + icon + label + hint. The whole tile is
 * one big button — no nested CTAs, no decorative copy.
 *
 * v6 baseline structure, v7 refinements (cleaner halo, tighter bracket legs).
 */

import type { ReactNode } from "react";
import "./CockpitTile.css";

export interface CockpitTileProps {
  label: string;
  hint: string;
  icon: ReactNode;
  onClick: () => void;
  /** Visual emphasis. `engine` keeps the fuchsia halo always on. */
  tone?: "default" | "engine";
  ariaLabel?: string;
}

export function CockpitTile({
  label, hint, icon, onClick, tone = "default", ariaLabel,
}: CockpitTileProps) {
  return (
    <button
      type="button"
      className={`lc-ctile lc-ctile-${tone}`}
      onClick={onClick}
      aria-label={ariaLabel ?? `${label} · ${hint}`}
    >
      <span className="lc-ctile-halo" aria-hidden="true" />
      <span className="lc-ctc lc-ctc-tl" aria-hidden="true" />
      <span className="lc-ctc lc-ctc-tr" aria-hidden="true" />
      <span className="lc-ctc lc-ctc-bl" aria-hidden="true" />
      <span className="lc-ctc lc-ctc-br" aria-hidden="true" />
      <span className="lc-ctile-icon" aria-hidden="true">{icon}</span>
      <span className="lc-ctile-label">{label}</span>
      <span className="lc-ctile-hint">{hint}</span>
    </button>
  );
}
