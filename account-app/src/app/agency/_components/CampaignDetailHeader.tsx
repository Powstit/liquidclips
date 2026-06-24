"use client";

// CampaignDetailHeader — title + status + stats strip for the detail
// page. Stats derive from the Whop snapshot when enrichment landed.

import { InfoIcon } from "@/components/admin/_lib/InfoIcon";
import type { CampaignBlock } from "@/lib/agency-campaigns";
import { StatusChip } from "./StatusChip";

export function CampaignDetailHeader({ row }: { row: CampaignBlock }) {
  const title = row.title || row.slug;
  const snap = (row.whop_reward_snapshot ?? {}) as {
    acceptedSubmissionsCount?: number;
    totalPaid?: number;
    spotsRemaining?: number;
    budgetAmount?: number;
  };
  const submitted = snap.acceptedSubmissionsCount ?? null;
  const paidCents = snap.totalPaid ?? null;
  const budgetCents = snap.budgetAmount ?? null;
  const spotsRemaining = snap.spotsRemaining ?? null;
  return (
    <header className="rounded-3xl border border-line bg-paper-warm/40 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            campaign
          </div>
          <h1 className="mt-2 font-display text-[clamp(24px,3vw,32px)] font-semibold leading-tight tracking-[-0.02em] text-ink">
            {title}
          </h1>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            {row.slug}
          </p>
        </div>
        <StatusChip status={row.status} size="md" />
      </div>

      {row.banner_url ? (
        <div
          className="mt-5 h-40 w-full rounded-2xl border border-line"
          style={{
            backgroundImage: `url(${row.banner_url})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
          aria-label="Campaign banner"
        />
      ) : null}

      <dl className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Type"
          hint="Backend sponsored_campaigns.campaign_type — clip | coordination | affiliate | submission."
          value={row.campaign_type}
        />
        <Stat
          label="Submitted"
          hint="Accepted submissions on the linked Whop reward (snapshot)."
          value={submitted === null ? "—" : submitted.toLocaleString()}
        />
        <Stat
          label="Paid out"
          hint="totalPaid from the Whop reward snapshot, in USD."
          value={paidCents === null ? "—" : `$${(paidCents / 100).toFixed(0)}`}
        />
        <Stat
          label="Spots left"
          hint="spotsRemaining from the Whop reward snapshot. Blank if the reward has no cap."
          value={spotsRemaining === null ? "—" : spotsRemaining.toLocaleString()}
        />
      </dl>

      {budgetCents !== null ? (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          budget · ${(budgetCents / 100).toLocaleString()}
        </p>
      ) : null}

      {row.whop_reward_url ? (
        <p className="mt-3 font-mono text-[11px] text-text-secondary">
          Whop reward ·{" "}
          <a
            href={row.whop_reward_url}
            target="_blank"
            rel="noreferrer"
            className="text-fuchsia underline-offset-4 hover:underline"
          >
            {shortUrl(row.whop_reward_url)}
          </a>
        </p>
      ) : null}
    </header>
  );
}

function Stat({
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

function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    const path = url.pathname.length > 30 ? `${url.pathname.slice(0, 28)}…` : url.pathname;
    return `${url.host}${path}`;
  } catch {
    return u.slice(0, 40);
  }
}
