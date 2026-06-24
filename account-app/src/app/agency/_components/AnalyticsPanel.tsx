"use client";

// AnalyticsPanel — rollup metrics for a single campaign.
// Reads /agency/campaigns/{slug}/analytics — status counts, total
// verified views, total payout, top 5 clippers.

import { useCallback, useEffect, useState } from "react";
import { InfoIcon } from "@/components/admin/_lib/InfoIcon";
import { LiveBadge } from "@/components/admin/_lib/LiveBadge";
import { useDataSource } from "@/components/admin/_lib/useDataSource";
import {
  AgencyApiError,
  campaignAnalytics,
  type AgencyCampaignAnalytics,
} from "@/lib/agency-campaigns";
import { StatusChip } from "./StatusChip";

export function AnalyticsPanel({ slug }: { slug: string }) {
  const src = useDataSource();
  const [data, setData] = useState<AgencyCampaignAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const a = await campaignAnalytics(slug);
      setData(a);
      src.report("analytics", "ok");
    } catch (e) {
      if (e instanceof AgencyApiError) setError(`Load failed (${e.status}).`);
      else setError("Load failed — backend unreachable.");
      src.report("analytics", "fail");
    }
  }, [slug, src]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-3xl border border-line bg-paper-warm/40 p-5 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            Analytics
            <InfoIcon hint="Rollup over CampaignSubmission rows for this campaign. Counts are server-side from junior-backend." />
          </div>
          <p className="mt-1 font-sans text-[12px] text-text-secondary">
            Submission breakdown · top earners · total payout.
          </p>
        </div>
        <LiveBadge state={src.state} />
      </header>

      {error ? (
        <div className="mt-4 rounded-md border border-fuchsia-deep/30 bg-fuchsia-soft/30 px-3 py-2 font-mono text-[12px] text-fuchsia-deep">
          {error}
        </div>
      ) : null}

      {data === null && !error ? (
        <Skel />
      ) : data && data.total_submissions === 0 ? (
        <EmptyState />
      ) : data ? (
        <div className="mt-5 space-y-5">
          {/* Totals */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile
              label="Submissions"
              hint="Total CampaignSubmission rows for this campaign."
              value={data.total_submissions.toLocaleString()}
            />
            <Tile
              label="Verified views"
              hint="Sum of CampaignSubmission.verified_views — counts Whop has confirmed."
              value={data.total_verified_views.toLocaleString()}
            />
            <Tile
              label="Total payout"
              hint="Sum of CampaignSubmission.payout_usd_cents / 100."
              value={`$${(data.total_payout_usd_cents / 100).toFixed(2)}`}
            />
            <Tile
              label="Top clippers"
              hint="Distinct clippers with at least one paid submission."
              value={data.top_clippers.length.toString()}
            />
          </div>

          {/* Status counts */}
          <div className="rounded-2xl border border-line bg-paper p-4">
            <div className="flex items-center font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              status breakdown
              <InfoIcon hint="Grouped count of CampaignSubmission.status — submitted, accepted, rejected, forwarded, paid." />
            </div>
            {Object.keys(data.status_counts).length === 0 ? (
              <p className="mt-3 font-mono text-[11px] text-text-tertiary">
                no status entries
              </p>
            ) : (
              <ul className="mt-3 flex flex-wrap gap-2">
                {Object.entries(data.status_counts).map(([s, c]) => (
                  <li
                    key={s}
                    className="flex items-center gap-2 rounded-full border border-line bg-paper-warm/40 px-3 py-1"
                  >
                    <StatusChip status={s} />
                    <span className="font-mono text-[11px] text-ink tabular-nums">
                      {c.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Top clippers */}
          <div className="rounded-2xl border border-line bg-paper p-4">
            <div className="flex items-center font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              top clippers
              <InfoIcon hint="Top 5 users by paid-submission count on this campaign. user_id is the internal users.id (no PII)." />
            </div>
            {data.top_clippers.length === 0 ? (
              <p className="mt-3 font-mono text-[11px] text-text-tertiary">
                no paid submissions yet
              </p>
            ) : (
              <table className="mt-3 min-w-full font-mono text-[11px]">
                <thead className="text-text-tertiary">
                  <tr className="text-left">
                    <th className="px-2 py-1">user</th>
                    <th className="px-2 py-1 text-right">paid clips</th>
                    <th className="px-2 py-1 text-right">earned</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_clippers.map((c) => (
                    <tr key={c.user_id} className="border-t border-line/40">
                      <td className="px-2 py-1 text-text-secondary">
                        {c.user_id.slice(0, 12)}…
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-ink">
                        {c.paid_count}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-ink">
                        ${(c.total_payout_usd_cents / 100).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-paper px-4 py-3">
      <div className="flex items-center font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
        {label}
        <InfoIcon hint={hint} />
      </div>
      <div className="mt-1 font-display text-[20px] font-semibold tracking-[-0.02em] text-ink">
        {value}
      </div>
    </div>
  );
}

function Skel() {
  return (
    <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-2xl border border-line bg-paper"
        />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-6 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line/80 bg-paper px-6 py-10 text-center">
      <h3 className="font-display text-[16px] font-semibold tracking-[-0.02em] text-ink">
        No analytics yet.
      </h3>
      <p className="max-w-md font-sans text-[13px] leading-relaxed text-text-secondary">
        As clippers submit work the rollup updates automatically. Check back
        after the first few approvals.
      </p>
    </div>
  );
}
