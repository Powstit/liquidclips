import { TierIcon } from "./TierIcon";
import { openAuthPanel } from "./auth/useAuthPanel";

// Replaces clip cards beyond the free-tier cap. One full-card CTA at the
// position where the next clip would render, with the hidden-clip count
// summarised — premium framing, not a paywall scolding.

export function UpgradeLockCard({
  hiddenCount,
  totalClips,
}: {
  hiddenCount: number;
  totalClips: number;
}) {
  return (
    <article className="relative col-span-1 flex aspect-[3/5] flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-b from-fuchsia-soft/30 via-transparent to-transparent p-5 sm:col-span-2 lg:col-span-3">
      <span className="cockpit-tile-corner-tl" aria-hidden />
      <span className="cockpit-tile-corner-tr" aria-hidden />
      <span className="cockpit-tile-corner-bl" aria-hidden />
      <span className="cockpit-tile-corner-br" aria-hidden />
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
          locked · free tier
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
          {hiddenCount} more clip{hiddenCount === 1 ? "" : "s"} ready
        </span>
      </div>

      <div className="mx-auto max-w-[420px] text-center">
        <div className="mb-4 grid h-14 w-14 mx-auto place-items-center rounded-2xl border border-fuchsia/30 bg-paper shadow-[var(--glow-sm)]">
          <TierIcon tier="solo" className="h-8 w-8" />
        </div>
        <h3 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          View all {totalClips} clips.
        </h3>
        <p className="mt-2 font-sans text-[14px] leading-relaxed text-text-secondary">
          {/* v0.7.34 — Honest framing. The prior copy said "continue clipping"
              to VIEW clips that already exist, which read as bait. The clips
              are already on disk; Solo unlocks visibility, not generation. */}
          Liquid Clips already produced {totalClips} clips from your video. Free shows the first 3 —
          Solo unlocks the other {hiddenCount}.
        </p>
      </div>

      <div className="flex flex-col items-center gap-2">
        <button
          onClick={() => openAuthPanel("upgrade")}
          className="rounded-full bg-fuchsia px-6 py-2.5 font-sans text-[14px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)]"
        >
          Upgrade to Solo →
        </button>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
          $29.99/month · cancel anytime
        </span>
      </div>
    </article>
  );
}
