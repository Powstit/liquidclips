"use client";

// SubmissionsTable — clip submissions for a single campaign.
// Pulls from /agency/campaigns/{slug}/submissions with optional status
// filter. Empty + error states render distinctly.

import { useCallback, useEffect, useState } from "react";
import { InfoIcon } from "@/components/admin/_lib/InfoIcon";
import { LiveBadge } from "@/components/admin/_lib/LiveBadge";
import { useDataSource } from "@/components/admin/_lib/useDataSource";
import {
  AgencyApiError,
  listSubmissions,
  type AgencySubmissionRow,
} from "@/lib/agency-campaigns";
import { StatusChip } from "./StatusChip";

const FILTERS = [
  { value: "", label: "all" },
  { value: "submitted", label: "submitted" },
  { value: "accepted", label: "accepted" },
  { value: "rejected", label: "rejected" },
  { value: "forwarded", label: "forwarded" },
  { value: "paid", label: "paid" },
];

export function SubmissionsTable({ slug }: { slug: string }) {
  const src = useDataSource();
  const [rows, setRows] = useState<AgencySubmissionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await listSubmissions(slug, statusFilter || null);
      setRows(data);
      src.report("submissions", "ok");
    } catch (e) {
      if (e instanceof AgencyApiError) {
        setError(`Load failed (${e.status}).`);
      } else {
        setError("Load failed — backend unreachable.");
      }
      src.report("submissions", "fail");
    }
  }, [slug, statusFilter, src]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- triggers async fetch that hydrates React state from backend — canonical external-sync use of useEffect
    void load();
  }, [load]);

  return (
    <section className="rounded-3xl border border-line bg-paper-warm/40 p-5 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            Submissions
            <InfoIcon hint="CampaignSubmission rows for this campaign · sorted newest first. status filter narrows to a single bucket." />
          </div>
          <p className="mt-1 font-sans text-[12px] text-text-secondary">
            Each row is a clip a clipper submitted via the desktop / Whop bounty.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LiveBadge state={src.state} />
          <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            status
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink focus:border-fuchsia focus:outline-none"
            >
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {error ? (
        <div className="mt-4 rounded-md border border-fuchsia-deep/30 bg-fuchsia-soft/30 px-3 py-2 font-mono text-[12px] text-fuchsia-deep">
          {error}
        </div>
      ) : null}

      {rows === null && !error ? (
        <RowSkeletons />
      ) : rows && rows.length === 0 ? (
        <EmptyState filtered={!!statusFilter} />
      ) : rows && rows.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full font-mono text-[11px]">
            <thead className="border-b border-line text-text-tertiary">
              <tr className="text-left">
                <th className="px-2 py-2">
                  when
                  <InfoIcon hint="CampaignSubmission.created_at · UTC, server-set." />
                </th>
                <th className="px-2 py-2">
                  status
                  <InfoIcon hint="CampaignSubmission.status · submitted | accepted | rejected | forwarded | paid." />
                </th>
                <th className="px-2 py-2">
                  clipper
                  <InfoIcon hint="users.id of the clipper. Short id only — no PII." />
                </th>
                <th className="px-2 py-2">
                  clip
                  <InfoIcon hint="CampaignSubmission.clip_url · opens in a new tab." />
                </th>
                <th className="px-2 py-2 text-right">
                  views
                  <InfoIcon hint="verified_views set by Whop on payout." />
                </th>
                <th className="px-2 py-2 text-right">
                  payout
                  <InfoIcon hint="payout_usd_cents / 100 · USD this clip earned." />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line/40">
                  <td className="px-2 py-2 text-text-tertiary">
                    {fmtDate(r.created_at)}
                  </td>
                  <td className="px-2 py-2">
                    <StatusChip status={r.status} />
                    {r.status === "rejected" && r.rejection_reason ? (
                      <div className="mt-1 text-[10px] text-fuchsia-deep">
                        {r.rejection_reason}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-text-secondary">
                    {r.user_id.slice(0, 10)}…
                  </td>
                  <td className="max-w-[18ch] truncate px-2 py-2 text-fuchsia">
                    <a
                      href={r.clip_url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      open ↗
                    </a>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">
                    {r.verified_views.toLocaleString()}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">
                    ${(r.payout_usd_cents / 100).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function RowSkeletons() {
  return (
    <div className="mt-4 space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-8 w-full animate-pulse rounded-md bg-paper-elev"
        />
      ))}
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="mt-6 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line/80 bg-paper px-6 py-10 text-center">
      <h3 className="font-display text-[16px] font-semibold tracking-[-0.02em] text-ink">
        {filtered ? "No submissions in that bucket yet." : "No submissions yet."}
      </h3>
      <p className="max-w-md font-sans text-[13px] leading-relaxed text-text-secondary">
        {filtered
          ? "Pick a different status filter, or wait for new clips to land."
          : "Clippers can submit as soon as your campaign is live. Submissions land here as Whop forwards them."}
      </p>
    </div>
  );
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 16);
  }
}
