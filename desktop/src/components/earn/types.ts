// Shared types for the Earn tab UX. The actual WhopBounty / WhopSubmission
// shapes live in lib/sidecar.ts — these are the helpers and view-state types.

import type { WhopBounty, WhopSubmission } from "../../lib/sidecar";

export type ConnectedPlatform = "youtube" | "tiktok" | "instagram" | "x";

export type SortKey = "best_match" | "highest_payout" | "most_spots" | "closing_soon";

export type EarnTab = "available" | "in_progress" | "submitted" | "approved";

export function allowedPlatforms(b: WhopBounty): ConnectedPlatform[] {
  const out: ConnectedPlatform[] = [];
  if (b.allowYoutube) out.push("youtube");
  if (b.allowTiktok) out.push("tiktok");
  if (b.allowInstagram) out.push("instagram");
  if (b.allowX) out.push("x");
  return out;
}

export function formatPayout(b: WhopBounty): string {
  const sym = b.currency === "GBP" ? "£" : b.currency === "USD" ? "$" : "";
  return `${sym}${b.rewardPerUnitAmount.toFixed(2)} / 1k views`;
}

export function moneySymbol(currency: string): string {
  if (currency === "GBP") return "£";
  if (currency === "USD") return "$";
  if (currency === "EUR") return "€";
  return "";
}

export function openBudget(b: WhopBounty): number {
  const remaining = Math.max(0, (b.budgetAmount || 0) - (b.totalPaid || 0));
  if (remaining > 0) return remaining;
  // Fallback when Whop omits a remaining budget: estimate from open spots.
  return Math.max(0, b.spotsRemaining || 0) * Math.max(0, b.rewardPerUnitAmount || 0);
}

export function formatBudget(b: WhopBounty): string {
  return `${moneySymbol(b.currency)}${openBudget(b).toFixed(0)}`;
}

export function approvalRisk(b: WhopBounty): "low" | "med" | "high" {
  // Heuristic until Whop exposes approval rate per bounty. For now: rules
  // density implies risk — long descriptions = more rules to violate.
  const len = (b.description || "").length;
  if (len < 120) return "low";
  if (len < 280) return "med";
  return "high";
}

export function effortFor(b: WhopBounty): "low" | "med" | "high" {
  // Heuristic from accepted submissions count — bounties with lots of
  // accepted clips are easier to crack. Reverse: few accepted → harder.
  if (b.acceptedSubmissionsCount > 15) return "low";
  if (b.acceptedSubmissionsCount > 5) return "med";
  return "high";
}

export function fitScore(b: WhopBounty, connected: ConnectedPlatform[]): number {
  // 0-100 score combining platform overlap + spots-remaining headroom +
  // payout signal. Cheap-and-cheerful — real ML scoring waits for v0.5+.
  const allow = allowedPlatforms(b);
  const overlap = allow.filter((p) => connected.includes(p)).length;
  const platformBoost = connected.length === 0 ? 50 : (overlap / allow.length) * 60;
  const spotsBoost = Math.min(25, (b.spotsRemaining / b.acceptedSubmissionsLimit) * 25);
  const payoutBoost = Math.min(15, b.rewardPerUnitAmount * 1.5);
  return Math.round(platformBoost + spotsBoost + payoutBoost);
}

export function opportunityScore(b: WhopBounty, connected: ConnectedPlatform[]): number {
  // "What should I work on now?" score. It rewards fit, enough remaining
  // budget/spots, decent payout, and proof that other submissions are getting
  // accepted. It is guidance, not a payout guarantee.
  const fit = fitScore(b, connected);
  const spotsRatio =
    b.acceptedSubmissionsLimit > 0
      ? Math.max(0, Math.min(1, b.spotsRemaining / b.acceptedSubmissionsLimit))
      : b.spotsRemaining > 0
      ? 0.5
      : 0;
  const payout = Math.min(1, Math.max(0, b.rewardPerUnitAmount) / 50);
  const acceptance =
    b.acceptedSubmissionsCount > 20
      ? 1
      : b.acceptedSubmissionsCount > 8
      ? 0.75
      : b.acceptedSubmissionsCount > 2
      ? 0.45
      : 0.25;
  const riskPenalty = approvalRisk(b) === "high" ? 10 : approvalRisk(b) === "med" ? 4 : 0;
  return Math.max(0, Math.min(100, Math.round(fit * 0.48 + spotsRatio * 22 + payout * 18 + acceptance * 12 - riskPenalty)));
}

export function opportunityLabel(score: number): "Best chance" | "Good target" | "Read brief" {
  if (score >= 78) return "Best chance";
  if (score >= 58) return "Good target";
  return "Read brief";
}

export function sortBounties(
  list: WhopBounty[],
  key: SortKey,
  connected: ConnectedPlatform[],
): WhopBounty[] {
  const copy = [...list];
  if (key === "highest_payout") {
    copy.sort((a, b) => b.rewardPerUnitAmount - a.rewardPerUnitAmount);
  } else if (key === "most_spots") {
    copy.sort((a, b) => b.spotsRemaining - a.spotsRemaining);
  } else if (key === "closing_soon") {
    copy.sort((a, b) => a.spotsRemaining - b.spotsRemaining);
  } else {
    // best_match — composite Fit score
    copy.sort(
      (a, b) =>
        opportunityScore(b, connected) - opportunityScore(a, connected),
    );
  }
  return copy;
}

export function matchesFilter(
  b: WhopBounty,
  filterPlatforms: ConnectedPlatform[],
  openOnly: boolean,
): boolean {
  if (openOnly && b.spotsRemaining <= 0) return false;
  if (filterPlatforms.length === 0) return true;
  const allow = allowedPlatforms(b);
  return filterPlatforms.some((p) => allow.includes(p));
}

export type SubmissionSummary = WhopSubmission & { localCheckedAt?: string };
