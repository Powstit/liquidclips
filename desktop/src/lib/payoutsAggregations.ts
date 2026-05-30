// Payouts aggregations — pure functions over local tracker data + affiliate
// snapshot. No backend calls; everything here is derived state for the
// Payouts tab and the AffiliateHero ticker tile.
//
// "Pending" definition for local tracker submissions: any status that is
// post-clip but not yet paid (posted, submitted, approved). "Paid" is the
// terminal money-in-your-account state. "Draft" and "rejected" contribute
// to neither pending nor paid totals.

import type { CampaignBrief } from "./briefs";
import type { ClipSubmission } from "./submissions";

const PENDING_STATUSES = new Set(["posted", "submitted", "approved"]);

export type MoneyTotals = {
  paid_usd: number;
  pending_usd: number;
  total_views: number;
  paid_count: number;
  pending_count: number;
};

function parseMoney(raw: string | null | undefined): number {
  if (!raw) return 0;
  const m = raw.match(/-?\d+(\.\d+)?/);
  if (!m) return 0;
  const n = Number.parseFloat(m[0]);
  return Number.isFinite(n) ? n : 0;
}

// All-time totals from the local tracker. Pending uses estimated_payout
// because the user logs it themselves; paid uses actual_payout.
export function trackerTotals(submissions: ClipSubmission[]): MoneyTotals {
  let paid = 0;
  let pending = 0;
  let paidCount = 0;
  let pendingCount = 0;
  let views = 0;
  for (const s of submissions) {
    views += s.views || 0;
    if (s.status === "paid") {
      paid += parseMoney(s.actual_payout);
      paidCount++;
    } else if (PENDING_STATUSES.has(s.status)) {
      pending += parseMoney(s.estimated_payout || s.actual_payout);
      pendingCount++;
    }
  }
  return {
    paid_usd: paid,
    pending_usd: pending,
    total_views: views,
    paid_count: paidCount,
    pending_count: pendingCount,
  };
}

// Sum of paid submissions for the current calendar month, local time.
// Used by the "Paid this month" hero tile so the user sees velocity.
export function paidThisMonth(submissions: ClipSubmission[]): number {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let total = 0;
  for (const s of submissions) {
    if (s.status !== "paid") continue;
    const ts = Date.parse(s.updated_at);
    if (Number.isFinite(ts) && ts >= monthStart) {
      total += parseMoney(s.actual_payout);
    }
  }
  return total;
}

export type CampaignEarnings = {
  brief_id: string | null;
  brief_title: string;
  paid_usd: number;
  pending_usd: number;
  clip_count: number;
};

// Group submissions by brief_id, sum money per campaign. Submissions with
// no brief_id ("Unattached") collapse into a single synthetic row so the
// breakdown stays scannable.
export function earnedByCampaign(
  submissions: ClipSubmission[],
  briefs: CampaignBrief[],
): CampaignEarnings[] {
  const titleById = new Map<string, string>();
  for (const b of briefs) titleById.set(b.id, b.title || "Untitled campaign");

  const buckets = new Map<string, CampaignEarnings>();
  for (const s of submissions) {
    const key = s.brief_id ?? "__unattached__";
    const existing = buckets.get(key) ?? {
      brief_id: s.brief_id,
      brief_title: s.brief_id ? titleById.get(s.brief_id) ?? "Untitled campaign" : "Unattached clips",
      paid_usd: 0,
      pending_usd: 0,
      clip_count: 0,
    };
    existing.clip_count++;
    if (s.status === "paid") existing.paid_usd += parseMoney(s.actual_payout);
    else if (PENDING_STATUSES.has(s.status))
      existing.pending_usd += parseMoney(s.estimated_payout || s.actual_payout);
    buckets.set(key, existing);
  }

  return [...buckets.values()]
    .filter((e) => e.paid_usd > 0 || e.pending_usd > 0 || e.clip_count > 0)
    .sort((a, b) => b.paid_usd + b.pending_usd - (a.paid_usd + a.pending_usd));
}

export type RecentPayout = {
  id: string;
  source: "whop" | "stripe" | "tracker";
  source_label: string;
  amount_usd: number;
  at: string; // ISO datetime
  description: string;
};

// Until backend exposes a real merged payouts feed, "Recent payouts" is
// derived from local tracker submissions where status === "paid". Each row
// is sourced as "tracker" so the UI can show provenance ("logged by you").
export function recentPayoutsFromTracker(
  submissions: ClipSubmission[],
  briefs: CampaignBrief[],
  limit = 10,
): RecentPayout[] {
  const titleById = new Map<string, string>();
  for (const b of briefs) titleById.set(b.id, b.title || "Untitled campaign");

  return submissions
    .filter((s) => s.status === "paid" && parseMoney(s.actual_payout) > 0)
    .map<RecentPayout>((s) => ({
      id: s.id,
      source: "tracker",
      source_label: "Logged · Whop",
      amount_usd: parseMoney(s.actual_payout),
      at: s.updated_at,
      description: s.brief_id
        ? titleById.get(s.brief_id) ?? "Untitled campaign"
        : "Unattached clip",
    }))
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit);
}

// Format helpers — kept here so the Payouts UI components don't reimplement
// the same money / date conventions.
export function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function fmtUsdCompact(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}
