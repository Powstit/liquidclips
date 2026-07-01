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
  const daysLabel =
    typeof trial.daysRemaining === "number"
      ? `${trial.daysRemaining} day${trial.daysRemaining === 1 ? "" : "s"} left`
      : "days left";

  // Urgency tint: red under 10 clips OR under 2 days · amber under 20 clips OR under 4 days · fuchsia normal.
  const clips = trial.clipsRemaining ?? 100;
  const days = trial.daysRemaining ?? 7;
  const urgency =
    clips <= 10 || days <= 1
      ? "critical"
      : clips <= 20 || days <= 3
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
      <span className="lc-trial-pill-sep">·</span>
      <span className="lc-trial-pill-metric">{daysLabel}</span>
      {trial.approvePending ? (
        <span className="lc-trial-pill-status">Confirming with Whop…</span>
      ) : null}
    </button>
  );
}
