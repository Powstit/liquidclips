/**
 * MetricBoard · DSEG-only scoreboard surface
 *
 * Rule: DSEG7 digits ONLY. Labels stay Geist Mono uppercase.
 * Never use this for nav, buttons, body, hero titles.
 *
 * Daniel's locked metric uses:
 *   - clippers / agencies / campaigns counts
 *   - free clips left
 *   - countdown timers
 *   - leaderboard ranks
 *   - earnings counters
 *   - processing %
 */

import "./MetricBoard.css";

export type MetricTone = "fx" | "cy" | "amber" | "danger";
export type MetricSize = "xs" | "sm" | "md" | "lg" | "xl";

export interface MetricBoardProps {
  label: string;
  value: string | number;
  unit?: string;
  tone?: MetricTone;
  size?: MetricSize;
  /** Render the unlit "8" ghost segments behind the value (authentic 7-seg behaviour). */
  ghost?: string;
  className?: string;
}

const FONT_SIZE: Record<MetricSize, number> = { xs: 13, sm: 18, md: 28, lg: 48, xl: 72 };

export function MetricBoard({
  label, value, unit, tone = "fx", size = "md", ghost, className = "",
}: MetricBoardProps) {
  const cls = ["lc-metric-board", `lc-tone-${tone}`, className].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      <div className="lc-metric-label">{label}</div>
      <div className="lc-metric-stack" style={{ fontSize: FONT_SIZE[size] }}>
        {ghost && <span className="lc-metric-ghost" aria-hidden="true">{ghost}</span>}
        <span className="lc-metric-num">{value}</span>
        {unit && <span className="lc-metric-unit">{unit}</span>}
      </div>
    </div>
  );
}

/** Countdown · separate component because the colon must blink. */
export function CountdownBoard({
  label, hours, minutes, size = "md", tone = "fx", className = "",
}: { label: string; hours: number; minutes: number; size?: MetricSize; tone?: MetricTone; className?: string }) {
  const cls = ["lc-metric-board", `lc-tone-${tone}`, className].filter(Boolean).join(" ");
  const fs = FONT_SIZE[size];
  return (
    <div className={cls}>
      <div className="lc-metric-label">{label}</div>
      <div className="lc-metric-stack" style={{ fontSize: fs }}>
        <span className="lc-metric-num">
          {String(hours).padStart(2, "0")}
          <span className="lc-metric-colon">:</span>
          {String(minutes).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}
