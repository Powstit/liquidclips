import { useEffect, useState } from "react";
import thumbFitness from "../../assets/sponsored/thumb-fitness.png";
import thumbBusiness from "../../assets/sponsored/thumb-business.png";
import thumbTech from "../../assets/sponsored/thumb-tech.png";
import thumbCreator from "../../assets/sponsored/thumb-creator.png";
import badgeSponsored from "../../assets/sponsored/badge-sponsored.png";

/**
 * Sprint #15 — Sponsored Clips carousel. Sits at the top of the workspace
 * (replaces the legacy brief bar). YouTube-thumbnail-style horizontal scroll
 * of 16:9 cards advertising paid clipping campaigns. Click any card → user
 * lands on the Earn tab where they can claim the campaign.
 *
 * For now these are placeholder slots (4 generated via gpt-image-1) until
 * real Whop bounty thumbnails come back from the backend. When the backend
 * gets a `/sponsored-clips` endpoint, swap PLACEHOLDERS for that response
 * and the UI is unchanged.
 *
 * Carousel mechanics:
 * - Auto-advance every 5s, paused while hovered or while user has focus
 * - Manual dot indicators below the strip
 * - Mouse-drag + trackpad scroll work natively via CSS `scroll-snap-type`
 * - Each card has a "SPONSORED" pill badge overlay in top-right corner
 */

type SponsoredCard = {
  id: string;
  thumbnail: string;
  sponsor: string;
  payout: string;          // "$20 / clip" or "$5 / 1k views"
  niche: string;
};

const PLACEHOLDERS: SponsoredCard[] = [
  { id: "p1", thumbnail: thumbFitness,  sponsor: "Available — fitness niche",  payout: "$20 / clip",       niche: "Fitness" },
  { id: "p2", thumbnail: thumbBusiness, sponsor: "Available — business niche", payout: "$5 / 1k views",    niche: "Business" },
  { id: "p3", thumbnail: thumbTech,     sponsor: "Available — tech niche",     payout: "$15 / clip",       niche: "Tech / Podcast" },
  { id: "p4", thumbnail: thumbCreator,  sponsor: "Available — creator economy",payout: "$5 / clip",        niche: "Lifestyle" },
];

export function SponsoredClipsCarousel({
  onOpenEarn,
}: {
  // Click a card → navigate to the Earn tab. App.tsx wires this to setNavTab.
  onOpenEarn: () => void;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  // Auto-advance every 5s when not paused.
  useEffect(() => {
    if (paused) return;
    const t = window.setInterval(() => {
      setActiveIdx((i) => (i + 1) % PLACEHOLDERS.length);
    }, 5000);
    return () => window.clearInterval(t);
  }, [paused]);

  return (
    <div
      className="w-full max-w-[720px]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="mb-2 flex items-baseline justify-between px-1">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
          sponsored clipping rewards
        </span>
        <button
          onClick={onOpenEarn}
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep hover:text-fuchsia"
        >
          see all →
        </button>
      </div>
      <div
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2"
        style={{ scrollbarWidth: "thin" }}
      >
        {PLACEHOLDERS.map((card, i) => (
          <button
            key={card.id}
            onClick={onOpenEarn}
            onFocus={() => setActiveIdx(i)}
            className={`group relative shrink-0 snap-start overflow-hidden rounded-xl border transition-all focus:outline-none ${
              i === activeIdx
                ? "border-fuchsia/40 shadow-[var(--shadow-e2)]"
                : "border-line hover:border-fuchsia/30"
            }`}
            style={{ width: 280, height: 158 }}
            title={`${card.niche} — ${card.payout}`}
          >
            <img
              src={card.thumbnail}
              alt={card.niche}
              className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
              draggable={false}
            />
            <img
              src={badgeSponsored}
              alt="Sponsored"
              className="pointer-events-none absolute right-2 top-2 h-6 w-auto drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)]"
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end bg-gradient-to-t from-black/70 via-black/20 to-transparent p-3">
              <div className="flex flex-col gap-0.5 text-left">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/80">
                  {card.niche}
                </span>
                <span className="font-display text-[14px] font-semibold leading-tight text-white">
                  {card.payout}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
      {/* Dot indicators */}
      <div className="mt-1 flex justify-center gap-1.5">
        {PLACEHOLDERS.map((_, i) => (
          <button
            key={i}
            onClick={() => setActiveIdx(i)}
            aria-label={`Go to card ${i + 1}`}
            className={`h-1.5 rounded-full transition-all ${
              i === activeIdx
                ? "w-6 bg-fuchsia"
                : "w-1.5 bg-line hover:bg-text-tertiary"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
