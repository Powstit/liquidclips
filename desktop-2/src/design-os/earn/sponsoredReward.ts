/**
 * Sponsored Reward · constants + Sovereign 2.2 forward-compat types
 *
 * ⚠ IRON GATE IG-SOV-2.2-001 · Sponsored Reward Rules
 * Daniel locked these rules 2026-06-23. They mirror Sovereign Master PRD
 * 2.2 Section I.2 (Multi-Tier Unlocking Matrix & Paywall Lock). Do not
 * change the threshold, payout, clearance window, or qualification paths
 * without an explicit override in the same turn.
 *
 * Rules (canonical · render via <RewardRules> in every clipping reward UI):
 *   - $50 USD per 5,000 authenticated tracked views (recurring · counter
 *     loops to 0 after payout)
 *   - OR $50 USD per 5 paying-sub referrals (alternative path)
 *   - Active paid subscription required to TRACK views or CLAIM payout
 *   - Cancellation pauses tracking (views frozen, no growth, resumes on
 *     re-sub) — this is the churn-prevention lock-in
 *   - 7-day clearance hold after milestone reached + subscription active
 *   - 5% Liquid Clips protocol fee deducted from payout (per Sovereign 2.2)
 *   - $10 minimum withdrawal threshold (per Sovereign 2.2)
 *   - Authenticated-view requirement: matched to posted clip URLs (per
 *     Sovereign 2.2 Section III · fraud shield)
 *   - Pool budget visible to user (per Sovereign 2.2 transparency)
 *
 * Anti-fraud (Sovereign 2.2 Section III, baked into copy now, enforced
 * at backend later):
 *   - Hardware fingerprint node isolation (one wallet per device)
 *   - Engagement-ratio audit: ≥3% likes/views, ≥0.5% comments/views
 *   - Algorithmic purge resilience (views deleted mid-hold → ledger reverts)
 *
 * Wallet (Sovereign 2.2 Section IV, copy-only today):
 *   - Sui zkLogin wallet derived from Google/Apple OAuth
 *   - Gasless USDC payouts via Shinami Gas Station
 *   - 300-400ms settlement target
 *
 * // SOVEREIGN-2.2 grep marker for every file that needs re-wiring when
 * the 2.2 backend lands.
 */

/* ──────── Carrot economics (Daniel-locked) ──────── */

export const SPONSORED_REWARD_AMOUNT_USD = 50;
export const SPONSORED_REWARD_VIEW_THRESHOLD = 5_000;
export const SPONSORED_REWARD_AFFILIATE_THRESHOLD = 5;
export const SPONSORED_REWARD_CLEARANCE_DAYS = 7;

/* ──────── Sovereign 2.2 economics (copy-only today, backend later) ──────── */

/** Liquid Clips protocol fee deducted from every withdrawal · 5% flat. */
export const SOVEREIGN_PROTOCOL_FEE_PCT = 5;
/** Minimum withdrawal threshold · USDC · gasless via Shinami. */
export const SOVEREIGN_WITHDRAWAL_MIN_USD = 10;
/** Pool budget (notional · funded from sub revenue · Sovereign 2.2). */
export const SPONSORED_REWARD_POOL_NOTIONAL_USD = 1_000_000;

/* ──────── Anti-fraud thresholds (Sovereign 2.2 Section III) ──────── */

/** Like / view engagement floor. Below this, ledger row stays unverified. */
export const FRAUD_LIKE_VIEW_RATIO_MIN = 0.03;
/** Comment / view engagement floor. Below this, ledger row stays unverified. */
export const FRAUD_COMMENT_VIEW_RATIO_MIN = 0.005;

/* ──────── Sovereign 2.2 ledger states ──────── */

/**
 * Reward clearance state · maps Sovereign 2.2 SQL enum verbatim.
 *
 * From Sovereign Master PRD Section VI:
 *   CREATE TYPE reward_clearance_state AS ENUM
 *     ('UNFUNDED_BOUNTY', 'PENDING_CLEARANCE', 'AVAILABLE', 'WITHDRAWN');
 *
 * Mapping to current ActivationBonusState (legacy → 2.2):
 *   - not_started               → unfunded_bounty (pool not yet activated for user)
 *   - tracking                  → unfunded_bounty (no rewards earned yet)
 *   - milestone_reached         → unfunded_bounty (needs subscription)
 *   - subscription_required     → unfunded_bounty
 *   - pending_clearance         → pending_clearance
 *   - approved                  → available
 *   - paid                      → withdrawn
 *   - rejected                  → (no Sovereign equivalent · stays unfunded_bounty)
 */
export type RewardClearanceState =
  | "unfunded_bounty"
  | "pending_clearance"
  | "available"
  | "withdrawn";

/* ──────── Sovereign 2.2 wallet field stub ──────── */

/** Sui zkLogin wallet address · null until 2.2 wires Shinami zkLogin.
 *  Bound permanently to Web2 identity (Google/Apple OAuth subject). */
export type SuiWalletAddress = string | null;

/* ──────── Helpers ──────── */

/** Convert legacy ActivationBonusState to the Sovereign 2.2 ledger state. */
export function activationStateToClearanceState(
  state:
    | "not_started"
    | "tracking"
    | "milestone_reached"
    | "subscription_required"
    | "pending_clearance"
    | "approved"
    | "rejected"
    | "paid",
): RewardClearanceState {
  switch (state) {
    case "pending_clearance": return "pending_clearance";
    case "approved":          return "available";
    case "paid":              return "withdrawn";
    default:                  return "unfunded_bounty";
  }
}

/** Net payout after protocol fee. */
export function netPayoutUsd(grossUsd: number): number {
  return grossUsd * (1 - SOVEREIGN_PROTOCOL_FEE_PCT / 100);
}

/** Protocol fee taken from a gross payout. */
export function protocolFeeUsd(grossUsd: number): number {
  return grossUsd * (SOVEREIGN_PROTOCOL_FEE_PCT / 100);
}

/* ──────── Banner asset ──────── */

/** Existing brand mp4 used as Sponsored Reward banner placeholder until
 *  Daniel writes the proper brief and we generate a bespoke asset.
 *  8s loop, 3MB, fits "viral energy" vibe. */
export const SPONSORED_REWARD_BANNER_MP4 = "/brand/intro/intro-splash.mp4";
