// ship-lens v0.7.14: K-β — BountySwipe
// SURFACE: Bounty Swipe (Tinder-style discovery)
// CONTRACT: useBountySwipe.ts (Claude C3)
// Card-deck view for bounty discovery. Swipe right to save, left to skip.
// Supports touch gestures, keyboard arrows, and button row.

import { useState, useCallback, useEffect, useRef } from "react";
import { SwipeCard } from "./SwipeCard";

export interface Bounty {
  id: string;
  brand: string;
  title: string;
  reward: string;
  deadline: string;
  match_score: number;
  brief_video_url?: string;
  brand_color: string;
  description?: string;
}

interface BountySwipeProps {
  bounties: Bounty[];
  onSave: (id: string) => void;
  onSkip: (id: string) => void;
  isLoading?: boolean;
}

export function BountySwipe({ bounties, onSave, onSkip, isLoading }: BountySwipeProps) {
  const [stack, setStack] = useState<Bounty[]>(bounties);
  const [direction, setDirection] = useState<"left" | "right" | null>(null);
  const [savedCount, setSavedCount] = useState(0);

  // Sync external bounties when they change (e.g., after a fetch)
  useEffect(() => {
    setStack(bounties);
  }, [bounties]);

  const current = stack[0];

  const handleSwipe = useCallback((dir: "left" | "right") => {
    if (!current) return;
    setDirection(dir);
    setTimeout(() => {
      if (dir === "right") {
        onSave(current.id);
        setSavedCount((c) => c + 1);
      } else {
        onSkip(current.id);
      }
      setStack((prev) => prev.slice(1));
      setDirection(null);
    }, 220);
  }, [current, onSave, onSkip]);

  // Touch gesture support
  const touchStartX = useRef<number | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const threshold = 80;
    if (dx > threshold) handleSwipe("right");
    else if (dx < -threshold) handleSwipe("left");
    touchStartX.current = null;
  };

  // Keyboard arrow support
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "ArrowRight") handleSwipe("right");
    if (e.key === "ArrowLeft") handleSwipe("left");
  }, [handleSwipe]);

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          Loading bounties<span className="animate-pulse">_</span>
        </p>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="font-display text-[18px] font-semibold text-ink">No more bounties</p>
        <p className="font-sans text-[13px] text-text-secondary">Check back later for new opportunities.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-4">
      {/* Card stack — up to 5 visible */}
      <div
        className="relative h-[440px] w-full max-w-[360px]"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {stack.slice(0, 5).map((bounty, i) => (
          <SwipeCard
            key={bounty.id}
            bounty={bounty}
            index={i}
            active={i === 0}
            direction={i === 0 ? direction : null}
          />
        ))}
      </div>

      {/* Button row */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => handleSwipe("left")}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-paper text-text-secondary transition-colors hover:border-red-500 hover:text-red-500"
          aria-label="Skip"
        >
          ✕
        </button>
        <button
          onClick={() => handleSwipe("right")}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-fuchsia text-white shadow-[0_0_24px_rgba(255,26,140,0.35)] transition-colors hover:bg-fuchsia-deep"
          aria-label="Save"
        >
          ✓
        </button>
      </div>

      {/* Counter */}
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
        {savedCount} saved · {stack.length} remaining
      </p>
    </div>
  );
}
