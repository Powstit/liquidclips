import { useEffect, useState } from "react";
import { ACHIEVEMENTS, ACHIEVEMENT_ORDER, listEarned, onAchievementUnlocked, type AchievementId } from "../lib/achievements";

/**
 * Sprint #18a — Achievement shelf. Renders all known badges in a grid, earned
 * ones in full colour, unearned ones desaturated with a thin dashed outline.
 * Subscribes to the global achievement bus so the shelf live-updates when a
 * user unlocks something while the Settings panel is open.
 *
 * Lives in Settings → Account. Tiny — under 100 LOC.
 */
export function BadgeShelf() {
  const [earned, setEarned] = useState<Set<AchievementId>>(() => listEarned());

  useEffect(() => {
    const off = onAchievementUnlocked(() => setEarned(listEarned()));
    // Also re-read on mount in case localStorage was mutated by another
    // window (rare, but cheap to guard against).
    setEarned(listEarned());
    return off;
  }, []);

  const total = ACHIEVEMENT_ORDER.length;
  const earnedCount = earned.size;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          achievements
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-fuchsia-deep tabular-nums">
          {earnedCount} / {total}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
        {ACHIEVEMENT_ORDER.map((id) => {
          const a = ACHIEVEMENTS[id];
          const is = earned.has(id);
          return (
            <div
              key={id}
              className={`group relative flex aspect-square flex-col items-center justify-center rounded-xl border p-2 transition-all ${
                is
                  ? "border-fuchsia/30 bg-paper-elev shadow-[var(--shadow-e1)]"
                  : "border-dashed border-line bg-paper-warm/30"
              }`}
              title={is ? `${a.title} — ${a.blurb}` : `${a.title} — locked`}
            >
              <img
                src={a.art}
                alt={a.title}
                className={`h-full w-full object-contain transition-all ${
                  is ? "" : "opacity-25 grayscale"
                }`}
              />
              {/* Tooltip-style label under the sprite — only renders on hover */}
              <span
                className={`pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.1em] opacity-0 transition-opacity group-hover:opacity-100 ${
                  is ? "text-fuchsia-deep" : "text-text-tertiary"
                }`}
              >
                {a.title}
              </span>
            </div>
          );
        })}
      </div>
      {earnedCount === 0 && (
        <p className="font-mono text-[10px] text-text-tertiary">
          Cut your first clip to start unlocking badges.
        </p>
      )}
    </div>
  );
}
