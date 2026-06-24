import { Lock } from "./icons/BrandGlyphs";
import { openUpgradeWhenSignedIn } from "../lib/upgradeWithAuth";
import { useActivation } from "../lib/activation";
import { openSmart } from "../lib/openSmart";

// Premium paywall card surfaced wherever a feature is gated behind Pro.
// Accepts surface-specific copy props; falls back to the legacy clip-cap
// framing so existing callers that pass `hiddenCount` / `totalClips` keep
// working without a migration.

const DEFAULT_BULLETS = [
  "Unlimited clip visibility",
  "Higher export quality",
  "Priority support",
];

export function UpgradeLockCard({
  hiddenCount,
  totalClips,
  title,
  body,
  bullets,
}: {
  hiddenCount?: number;
  totalClips?: number;
  title?: string;
  body?: string;
  bullets?: string[];
}) {
  const { activate } = useActivation();

  const hasLegacy =
    typeof hiddenCount === "number" && typeof totalClips === "number";

  const surfaceTitle =
    title ??
    (hasLegacy ? `View all ${totalClips} clips.` : "Unlock this feature.");

  const surfaceBody =
    body ??
    (hasLegacy
      ? `Liquid Clips already produced ${totalClips} clips from your video. Free shows the first 3 — Solo unlocks the other ${hiddenCount}.`
      : "Upgrade to Solo to unlock this and every Pro feature.");

  const surfaceBullets = bullets ?? DEFAULT_BULLETS;

  return (
    <article className="relative overflow-hidden rounded-2xl border border-fuchsia/40 bg-paper-warm p-5 shadow-[var(--glow-md)]">
      {/* Subtle gradient backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-fuchsia-soft/30 via-transparent to-transparent"
      />

      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
            Pro unlocks this
          </span>
          {hasLegacy ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
              {hiddenCount} more clip{hiddenCount === 1 ? "" : "s"} ready
            </span>
          ) : null}
        </div>

        <div className="mt-5 flex flex-col items-center text-center">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-fuchsia/30 bg-paper shadow-[var(--glow-sm)]">
            <Lock className="h-7 w-7 text-fuchsia-deep" />
          </div>

          <h2 className="max-w-[420px] font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
            {surfaceTitle}
          </h2>

          <p className="mt-2 max-w-[420px] font-sans text-[14px] leading-relaxed text-text-secondary">
            {surfaceBody}
          </p>

          <ul className="mt-4 flex flex-col items-start gap-1.5 text-left">
            {surfaceBullets.map((b) => (
              <li
                key={b}
                className="flex items-center gap-2 font-sans text-[13px] text-text-secondary"
              >
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-fuchsia-deep"
                />
                {b}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex flex-col items-center gap-2">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => openUpgradeWhenSignedIn()}
              className="btn-primary"
            >
              Upgrade →
            </button>
            <button
              onClick={() => void openSmart("https://account.liquidclips.app/upgrade")}
              className="btn-ghost"
            >
              See plans
            </button>
          </div>

          <button
            onClick={() => activate({ via: "browser" })}
            className="mt-1 font-sans text-[12px] text-text-tertiary underline-offset-2 transition-colors hover:text-fuchsia-deep hover:underline"
          >
            Already paid? Refresh session
          </button>
        </div>
      </div>
    </article>
  );
}
