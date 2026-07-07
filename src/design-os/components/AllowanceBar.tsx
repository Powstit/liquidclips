/**
 * AllowanceBar · clip allowance display
 *
 * 4 states: healthy / low / empty / unlimited.
 * Pairs with DSEG count and a Phase 4A bar SVG.
 *
 * COLLISION RULE: the label text and the DSEG value stack VERTICALLY so they
 * never compete for the same row width. Bar is full-width below.
 */

import type { AllowanceState } from "../bridge";
import "./AllowanceBar.css";

const BAR_FOR: Record<AllowanceState, string> = {
  healthy:   "/brand/allowance/bar-healthy.svg",
  low:       "/brand/allowance/bar-low.svg",
  empty:     "/brand/allowance/bar-empty.svg",
  unlimited: "/brand/allowance/bar-unlimited.svg",
};

const TONE_FOR: Record<AllowanceState, "fx" | "amber" | "danger" | "fxd"> = {
  healthy: "fx", low: "amber", empty: "danger", unlimited: "fxd",
};

export interface AllowanceBarProps {
  state: AllowanceState;
  used: number;
  total: number;
  label?: string;
  className?: string;
}

export function AllowanceBar({
  state, used, total, label = "Free clips left", className = "",
}: AllowanceBarProps) {
  const tone = TONE_FOR[state];
  const val =
    state === "unlimited"
      ? "∞"
      : `${used} / ${total}`;

  return (
    <div className={`lc-allowance lc-allowance-${state} ${className}`}>
      <div className="lc-allowance-row">
        <span className="lc-allowance-label">{label}</span>
        <span className={`lc-allowance-val lc-tone-${tone}`}>{val}</span>
      </div>
      <img className="lc-allowance-bar" src={BAR_FOR[state]} alt="" />
    </div>
  );
}
