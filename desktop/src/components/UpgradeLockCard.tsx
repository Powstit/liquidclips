import { open as openExternal } from "@tauri-apps/plugin-shell";

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
    <article className="relative col-span-1 flex aspect-[3/5] flex-col justify-between overflow-hidden rounded-2xl border border-fuchsia-soft bg-gradient-to-b from-fuchsia-soft/40 via-paper to-paper p-5 shadow-[0_2px_12px_rgba(15,15,18,0.04)] sm:col-span-2 lg:col-span-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
          locked · free tier
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
          {hiddenCount} more clip{hiddenCount === 1 ? "" : "s"} ready
        </span>
      </div>

      <div className="mx-auto max-w-[420px] text-center">
        <h3 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          See the other {hiddenCount}.
        </h3>
        <p className="mt-2 font-sans text-[14px] leading-relaxed text-text-secondary">
          Junior found {totalClips} clips in this video. Free shows the first 3 —
          Solo unlocks the rest, plus drip scheduling and multi-platform publishing.
        </p>
      </div>

      <div className="flex flex-col items-center gap-2">
        <button
          onClick={() => void openExternal("https://account.jnremployee.com/upgrade")}
          className="rounded-full bg-ink px-6 py-2.5 font-sans text-[14px] font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]"
        >
          Upgrade to Solo →
        </button>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
          from £12/month · cancel anytime
        </span>
      </div>
    </article>
  );
}
