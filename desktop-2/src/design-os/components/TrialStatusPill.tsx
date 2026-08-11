/**
 * TrialStatusPill · v2.2.15
 *
 * Compact "X clips left · Y days left" pill for the TopHud. Renders
 * only when the viewer is on an active trial (subscription_status ==
 * trial|trialing). Hides for paid users, free users who haven't taken
 * the trial, and admin overrides.
 *
 * Clicking the pill fires `trial:upgrade-request` on the event bus,
 * which the UpgradeApprovalModal listens for. Anywhere else in the app
 * can also emit that same event (e.g. the paywall banner) so this
 * pill is the visible mirror + one of many opener surfaces.
 */
import { bus } from "../bridge";
import { useTrial } from "../../lib/trial";
import "./TrialStatusPill.css";

export function TrialStatusPill(): JSX.Element | null {
  const { trial } = useTrial();

  if (!trial.isTrialing) return null;

  const clipsLabel =
    typeof trial.clipsRemaining === "number"
      ? `${trial.clipsRemaining} clip${trial.clipsRemaining === 1 ? "" : "s"} left`
      : "clips left";

  // 2026-08-11 — days-remaining removed from display. It showed "0 days
  // left" next to a genuinely non-zero clips count, which read as
  // contradictory/broken even though both numbers were individually
  // correct (two independent gates — see trial.ts). Reported live.
  // Clips-remaining is now the sole visible gate; urgency tint follows
  // clips alone.
  const clips = trial.clipsRemaining ?? 100;
  const urgency =
    clips <= 10
      ? "critical"
      : clips <= 20
        ? "warning"
        : "info";

  return (
    <button
      type="button"
      className="lc-trial-pill"
      data-testid="lc-trial-pill"
      data-urgency={urgency}
      data-pending={trial.approvePending}
      onClick={() => bus.emit("trial:upgrade-request", { source: "hud-pill" })}
      title="Click to lock in Solo · $29.99/mo"
    >
      <span className="lc-trial-pill-eyebrow">TRIAL</span>
      <span className="lc-trial-pill-metric">{clipsLabel}</span>
      {trial.approvePending ? (
        <span className="lc-trial-pill-status">Confirming with Whop…</span>
      ) : null}
    </button>
  );
}
