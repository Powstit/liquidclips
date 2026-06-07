// ship-lens v0.7.14: K-β — SwipeCard
// Individual bounty card in the swipe deck. Animated with CSS transforms.
// Part of the BountySwipe surface.

import type { Bounty } from "./BountySwipe";

interface SwipeCardProps {
  bounty: Bounty;
  index: number;
  active: boolean;
  direction: "left" | "right" | null;
}

export function SwipeCard({ bounty, index, active, direction }: SwipeCardProps) {
  // Offset stacked cards for depth illusion
  const stackOffset = index * 4;
  const scale = 1 - index * 0.02;

  let transform = `translateY(${stackOffset}px) scale(${scale})`;
  let opacity = 1 - index * 0.15;

  if (direction === "right") {
    transform += " translateX(120%) rotate(12deg)";
    opacity = 0;
  } else if (direction === "left") {
    transform += " translateX(-120%) rotate(-12deg)";
    opacity = 0;
  }

  return (
    <div
      className={`absolute inset-0 rounded-2xl border border-line bg-paper shadow-xl transition-all duration-220 ease-out ${
        active ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      style={{ transform, opacity, zIndex: 100 - index }}
      aria-hidden={!active}
    >
      {/* Brand header */}
      <div className="flex items-center gap-3 px-5 pt-5">
        <div
          className="grid h-10 w-10 place-items-center rounded-xl font-display text-[14px] font-bold text-white"
          style={{ backgroundColor: bounty.brand_color }}
        >
          {bounty.brand[0]}
        </div>
        <div className="flex flex-col">
          <span className="font-display text-[14px] font-semibold text-ink">
            {bounty.brand}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            {bounty.deadline}
          </span>
        </div>
      </div>

      {/* Match score */}
      <div className="px-5 pt-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">
            {bounty.match_score}% match
          </span>
        </div>
      </div>

      {/* Title */}
      <div className="px-5 pt-3">
        <h3 className="font-display text-[16px] font-semibold leading-snug text-ink">
          {bounty.title}
        </h3>
      </div>

      {/* Description (if available) */}
      {bounty.description && (
        <p className="px-5 pt-2 font-sans text-[12px] leading-relaxed text-text-secondary line-clamp-3">
          {bounty.description}
        </p>
      )}

      {/* Reward */}
      <div className="px-5 pt-3">
        <span className="inline-block rounded-full bg-fuchsia/10 px-3 py-1 font-mono text-[11px] font-medium text-fuchsia">
          {bounty.reward}
        </span>
      </div>

      {/* Brief video placeholder */}
      {bounty.brief_video_url && (
        <div className="mx-5 mt-4 aspect-video overflow-hidden rounded-xl bg-paper-deep">
          <div className="flex h-full w-full items-center justify-center text-text-tertiary">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em]">
              Brief video
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
