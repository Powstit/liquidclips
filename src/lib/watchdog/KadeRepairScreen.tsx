/**
 * KadeRepairScreen · friendly fallback rendered when a Watchdog-wrapped
 * node fails. Shows Kade with an "error" pose + a 5:00 countdown +
 * a "back in five" copy so the user knows the system is repairing,
 * not broken.
 *
 * Ship-lens Sovereign-Operator Protocol (2026-07-06). No white-screen
 * crashes. Every failure surfaces as a bespoke Kade moment. See
 * docs/PROTOCOL_SELF_HEALING_NODES.md for the intent.
 *
 * Motion aesthetic follows the Remotion visual language (200ms fade-in
 * · 60fps countdown updates · fuchsia pulse ring) but ships as CSS
 * keyframes so we don't pull @remotion/player into the runtime bundle.
 * The scope doc names the deferred upgrade to Player-native rendering
 * as a Post-Cohort 0 follow-up.
 */

import { useEffect, useState } from "react";
import "./KadeRepairScreen.css";

export interface KadeRepairScreenProps {
  nodeId: string;
  /** ISO or ms epoch — when the repair "completes." Purely cosmetic; the
   *  Watchdog remounts when the parent re-renders. */
  etaMs?: number;
  /** Called when the user clicks "Try again now" before the countdown
   *  finishes. Parent should reset the boundary. */
  onRetry?: () => void;
  /** Short human hint about what section broke (e.g. "Publish walk-around"). */
  sectionLabel?: string;
}

const DEFAULT_ETA_MS = 5 * 60 * 1000; // 5:00

function fmt(ms: number): string {
  if (ms <= 0) return "0:00";
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function KadeRepairScreen({
  nodeId,
  etaMs = DEFAULT_ETA_MS,
  onRetry,
  sectionLabel,
}: KadeRepairScreenProps) {
  const [now, setNow] = useState(() => Date.now());
  const deadline = now + etaMs;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remaining = Math.max(0, deadline - (Date.now()));
  void tick; // subscribed via setInterval; keep lint quiet

  return (
    <div className="lc-kade-repair" role="alert" aria-live="polite">
      <div className="lc-kade-repair-inner">
        <div className="lc-kade-repair-ring" aria-hidden="true" />
        <img
          className="lc-kade-repair-avatar"
          src="/brand/kade/kade-error.webp"
          alt=""
          aria-hidden="true"
        />
        <div className="lc-kade-repair-copy">
          <span className="lc-kade-repair-eb">System repair</span>
          <h3 className="lc-kade-repair-h">Back in five</h3>
          <p className="lc-kade-repair-body">
            {sectionLabel ? `${sectionLabel} hit a snag. ` : "This section hit a snag. "}
            Kade&rsquo;s patching it in the background — everything else in the app keeps working.
          </p>
          <div className="lc-kade-repair-countdown" aria-label={`Estimated repair time: ${fmt(remaining)}`}>
            {fmt(remaining)}
          </div>
          <div className="lc-kade-repair-actions">
            {onRetry && (
              <button type="button" className="lc-kade-repair-btn" onClick={onRetry}>
                Try again now →
              </button>
            )}
          </div>
          <span className="lc-kade-repair-node" title="Node id for HQ debugging">{nodeId}</span>
        </div>
      </div>
    </div>
  );
}
