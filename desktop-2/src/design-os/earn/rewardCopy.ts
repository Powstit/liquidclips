/**
 * rewardCopy · one source of truth for what the sponsored-reward
 * surfaces (card, module, strip) render in their headline / amount
 * / status.
 *
 * When VITE_LAUNCH_COMING_SOON=1 · every surface renders "Coming
 * soon" copy so we don't promise a specific $50 activation bonus
 * before the trial-revenue funding rail exists.
 *
 * When the flag is off · original carrot copy returns (Claim your
 * $50 · 5,000 authenticated views · etc).
 */

import { isLaunchComingSoonMode } from "../../lib/launchMode";
import {
  SPONSORED_REWARD_AMOUNT_USD,
  SPONSORED_REWARD_VIEW_THRESHOLD,
} from "./sponsoredReward";

export interface SponsoredRewardCopy {
  /** Big card headline. */
  title: string;
  /** Amount overlay on the banner (e.g. "$50" or "Preview"). */
  amountLabel: string;
  /** Amount sub-line (e.g. "per 5,000 views" or "Live at launch"). */
  amountSub: string;
  /** Card sub-copy paragraph. */
  sub: string;
  /** CTA arrow copy inside the card. */
  cta: string;
  /** Home-strip short label (e.g. "$50 bonus" or "Coming soon"). */
  stripAmount: string;
  /** When true, callers hide progress bars, status pills, and
   *  earn-flow CTAs · nothing to progress against yet. */
  isPreview: boolean;
}

export function getSponsoredRewardCopy(): SponsoredRewardCopy {
  if (isLaunchComingSoonMode()) {
    return {
      title: "Coming soon",
      amountLabel: "Soon",
      amountSub: "Live at launch",
      sub: "Sponsored rewards land the moment the funding rail flips on. Get set up now · your first eligible clip is credited automatically.",
      cta: "View rules",
      stripAmount: "Coming soon",
      isPreview: true,
    };
  }
  return {
    title: `Claim your $${SPONSORED_REWARD_AMOUNT_USD}`,
    amountLabel: `$${SPONSORED_REWARD_AMOUNT_USD}`,
    amountSub: `per ${SPONSORED_REWARD_VIEW_THRESHOLD.toLocaleString()} views`,
    sub: "Hit 5,000 authenticated tracked views OR refer 5 paying subscribers · pay nothing · cancel anytime.",
    cta: "View reward →",
    stripAmount: `$${SPONSORED_REWARD_AMOUNT_USD} bonus`,
    isPreview: false,
  };
}
