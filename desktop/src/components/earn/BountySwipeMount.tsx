// ship-lens v0.7.14: K5 — BountySwipeMount
// SURFACE: Earn → Discover (native swipe deck)
// CONTRACT: useBountySwipe (consumed via WhopBounty)
//
// Adapter that bridges the contract hook (returns WhopBounty) to the
// presentational BountySwipe component (consumes a simpler `Bounty`
// shape with brand / reward / deadline / match_score). Owns:
//   - hook subscription
//   - WhopBounty → Bounty projection
//   - "Save" path that forwards into the workspace via onStartBounty
//   - "Browse all" CTA that flips Earn's parent sub-tab to the webview
//
// Why a separate file: EarnTab stays a thin router; the BountySwipe
// component stays presentational; the adapter is the only place that
// knows about the WhopBounty shape AND the Bounty shape at once.

import { useCallback, useMemo } from "react";
import { BountySwipe, type Bounty } from "./BountySwipe";
import { useBountySwipe } from "../../contracts/useBountySwipe";
import { sidecar, humanError, type WhopBounty } from "../../lib/sidecar";

// Stable colour from the brand string so the SwipeCard avatar has a
// distinct fill per campaign without the hook owning brand chrome.
// Hue-only HSL keeps contrast against white text constant.
function brandColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

function formatReward(b: WhopBounty): string {
  // Whop returns amounts as integer minor units (cents). Prefer
  // rewardPerUnitAmount (per-submission payout) over base / budget.
  const cents = b.rewardPerUnitAmount || b.baseUnitAmount || 0;
  if (cents <= 0) return "Reward TBD";
  const dollars = cents / 100;
  const currency = (b.currency || "USD").toUpperCase();
  const symbol = currency === "USD" ? "$" : currency === "GBP" ? "£" : currency === "EUR" ? "€" : "";
  const formatted = dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2);
  return symbol ? `${symbol}${formatted}` : `${formatted} ${currency}`;
}

function formatDeadline(b: WhopBounty): string {
  // Whop bounties don't carry an explicit deadline on the public list;
  // surface spots-remaining as a scarcity signal instead so the card
  // doesn't render an empty deadline row.
  const spots = b.spotsRemaining;
  if (typeof spots === "number" && spots > 0) {
    return `${spots} spot${spots === 1 ? "" : "s"} left`;
  }
  if (b.status && b.status.toLowerCase() !== "active") {
    return b.status;
  }
  return "Open";
}

function matchScore(b: WhopBounty): number {
  // Until the LC-Score backend wires up (sponsored-rewards sprint), seed
  // a deterministic pseudo-score from the bounty id so the card has the
  // colour it expects. Defaults the matrix-locked 75 from memory.
  let h = 0;
  for (let i = 0; i < b.id.length; i++) {
    h = (h * 17 + b.id.charCodeAt(i)) >>> 0;
  }
  return 70 + (h % 21); // 70 - 90
}

function toDeckBounty(b: WhopBounty): Bounty {
  // Brand string: prefer the experience name (the Whop community / page),
  // fall back to the bounty author username, finally to "Sponsor".
  const brand =
    (b.experience && b.experience.name) ||
    b.user.username ||
    b.user.name ||
    "Sponsor";
  return {
    id: b.id,
    brand,
    title: b.title,
    reward: formatReward(b),
    deadline: formatDeadline(b),
    match_score: matchScore(b),
    brand_color: brandColor(brand),
    description: b.description,
  };
}

export function BountySwipeMount({
  onStartBounty,
  onBrowseAll,
}: {
  onStartBounty: (bounty: WhopBounty) => void;
  onBrowseAll: () => void;
}) {
  const { bounties, loading, error, saveBounty, skipBounty, refresh } = useBountySwipe();

  const deck = useMemo(() => bounties.map(toDeckBounty), [bounties]);

  // Save path: persist via the hook AND hand the full WhopBounty off to
  // the workspace so the user can immediately start clipping. The hook
  // owns the persisted-saved-id set; the workspace owns the editor.
  const handleSave = useCallback(
    (id: string) => {
      const target = bounties.find((b) => b.id === id);
      saveBounty(id);
      if (target) {
        try {
          onStartBounty(target);
        } catch (e) {
          // Swallow + surface via console; deck has already advanced.
          console.error("[bounty-swipe] start-bounty failed:", humanError(e));
        }
      }
    },
    [bounties, saveBounty, onStartBounty],
  );

  const handleSkip = useCallback(
    (id: string) => {
      skipBounty(id);
    },
    [skipBounty],
  );

  // Manual refresh — exposed via the "Browse all" / "Refresh" row at the
  // bottom of the deck so the user can pull fresh bounties without
  // re-mounting the surface.
  const handleRefresh = useCallback(() => {
    void refresh().catch((e) => {
      console.error("[bounty-swipe] refresh failed:", humanError(e));
    });
  }, [refresh]);

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header — mirrors the Earn embed's quiet caption row */}
      <div className="shrink-0 px-6 pt-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          Discover bounties
        </p>
        <p className="mt-1 font-sans text-[12px] text-text-secondary">
          Swipe right to save and start clipping. Skip the rest.
        </p>
      </div>

      {/* Deck — fills the rest of the panel */}
      <div className="min-h-0 flex-1">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
              Could not load bounties
            </p>
            <p className="max-w-sm text-center font-sans text-[12px] text-text-secondary">
              {error}
            </p>
            <button
              onClick={handleRefresh}
              className="rounded-md border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary hover:border-fuchsia hover:text-fuchsia"
            >
              Try again
            </button>
          </div>
        ) : (
          <BountySwipe
            bounties={deck}
            onSave={handleSave}
            onSkip={handleSkip}
            isLoading={loading}
          />
        )}
      </div>

      {/* Footer — exit to the full webview embed */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-6 py-3">
        <button
          onClick={handleRefresh}
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary hover:text-text-secondary"
        >
          Refresh
        </button>
        <button
          onClick={onBrowseAll}
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia hover:text-fuchsia-deep"
        >
          Browse all &rarr;
        </button>
      </div>
    </div>
  );
}

// Re-export so a future caller could pull WhopBounty / sidecar through
// this module without importing the sidecar barrel directly. Keeping the
// reference live also stops the bundler from tree-shaking it away in the
// (unlikely) event the inline `sidecar` import above gets refactored
// out — the type-only import alone would not retain the runtime symbol.
export const _sidecarRefForTreeshake = sidecar;
