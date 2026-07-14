"use client";

// CampaignList — landing-page list of every campaign owned by the
// signed-in agency. Pulls /api/agency/list which the proxy resolves via
// admin-list + filter (until the backend ships a dedicated agency-owned
// list endpoint).

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { InfoIcon } from "@/components/admin/_lib/InfoIcon";
import { LiveBadge } from "@/components/admin/_lib/LiveBadge";
import { useDataSource } from "@/components/admin/_lib/useDataSource";
import {
  AgencyApiError,
  listMyCampaigns,
  type CampaignBlock,
} from "@/lib/agency-campaigns";
import { StatusChip } from "./StatusChip";

export function CampaignList() {
  const src = useDataSource();
  const [rows, setRows] = useState<CampaignBlock[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await listMyCampaigns();
      setRows(list);
      src.report("agency-list", "ok");
    } catch (e) {
      if (e instanceof AgencyApiError && e.status === 403) {
        setError("Your account is not on the Agency tier.");
      } else if (e instanceof AgencyApiError) {
        setError(`List failed (${e.status}).`);
      } else {
        setError("List failed — backend unreachable.");
      }
      src.report("agency-list", "fail");
    }
  }, [src]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- triggers async fetch that hydrates React state from backend — canonical external-sync use of useEffect
    void load();
  }, [load]);

  return (
    <section className="rounded-3xl border border-line bg-paper-warm/40 p-5 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            Your campaigns
            <InfoIcon hint="Every campaign you created via the agency surface. Drafts, live, and archived rows all show here — the public mission feed only shows non-draft, non-closed." />
          </div>
          <p className="mt-1 font-sans text-[12px] text-text-secondary">
            Launch · edit · review submissions. The Whop reward you link is the
            source of truth for funding.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LiveBadge state={src.state} />
          <Link
            href="/agency/campaigns/new"
            className="rounded-full bg-fuchsia px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink hover:bg-fuchsia-bright"
          >
            New campaign
          </Link>
        </div>
      </header>

      {error ? (
        <div className="mt-4 rounded-md border border-fuchsia-deep/30 bg-fuchsia-soft/30 px-3 py-2 font-mono text-[12px] text-fuchsia-deep">
          {error}
        </div>
      ) : null}

      {rows === null && !error ? (
        <CardSkeletons />
      ) : rows && rows.length === 0 ? (
        <EmptyState />
      ) : rows && rows.length > 0 ? (
        <ul className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <li key={row.id}>
              <CampaignCard row={row} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// ── Card ──────────────────────────────────────────────────────────────
function CampaignCard({ row }: { row: CampaignBlock }) {
  const title = row.title || row.slug;
  const snap = (row.whop_reward_snapshot ?? {}) as {
    acceptedSubmissionsCount?: number;
    totalPaid?: number;
    spotsRemaining?: number;
  };
  const submissions = snap.acceptedSubmissionsCount ?? null;
  const paid = snap.totalPaid ?? null;
  return (
    <Link
      href={`/agency/campaigns/${encodeURIComponent(row.slug)}`}
      className="group block overflow-hidden rounded-2xl border border-line bg-paper transition-colors hover:border-fuchsia"
    >
      <div
        className="relative h-32 w-full bg-paper-elev"
        style={
          row.banner_url
            ? {
                backgroundImage: `url(${row.banner_url})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        {!row.banner_url ? <BannerGlyph /> : null}
        <div className="absolute left-3 top-3">
          <StatusChip status={row.status} />
        </div>
      </div>
      <div className="p-4">
        <h3 className="font-display text-[16px] font-semibold leading-tight text-ink line-clamp-2">
          {title}
        </h3>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          {row.slug}
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          <Stat label="type" value={row.campaign_type} />
          <Stat
            label="submitted"
            value={submissions === null ? "—" : String(submissions)}
          />
          <Stat
            label="paid"
            value={paid === null ? "—" : `$${(paid / 100).toFixed(0)}`}
          />
        </dl>
        <span className="mt-4 inline-flex items-center font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia transition-transform group-hover:translate-x-0.5">
          Open →
        </span>
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-text-tertiary">{label}</div>
      <div className="font-display text-[14px] font-semibold text-ink">
        {value}
      </div>
    </div>
  );
}

// ── Skeletons / empty ─────────────────────────────────────────────────
function CardSkeletons() {
  return (
    <ul className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <li key={i} className="overflow-hidden rounded-2xl border border-line bg-paper">
          <div className="h-32 w-full animate-pulse bg-paper-elev" />
          <div className="space-y-2 p-4">
            <div className="h-4 w-3/4 animate-pulse rounded bg-paper-elev" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-paper-elev" />
            <div className="grid grid-cols-3 gap-2 pt-2">
              <div className="h-6 animate-pulse rounded bg-paper-elev" />
              <div className="h-6 animate-pulse rounded bg-paper-elev" />
              <div className="h-6 animate-pulse rounded bg-paper-elev" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <div className="mt-6 flex flex-col items-center gap-4 rounded-2xl border border-dashed border-line/80 bg-paper px-6 py-12 text-center">
      <ChestGlyph />
      <h3 className="font-display text-[20px] font-semibold tracking-[-0.02em] text-ink">
        Launch your first campaign.
      </h3>
      <p className="max-w-md font-sans text-[14px] leading-relaxed text-text-secondary">
        Drop a Whop reward URL, write the brief, hit publish. Clippers see your
        mission in the next refresh. The funding lives on Whop — Liquid Clips
        runs the surface.
      </p>
      <Link
        href="/agency/campaigns/new"
        className="rounded-full bg-fuchsia px-5 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink hover:bg-fuchsia-bright"
      >
        New campaign
      </Link>
    </div>
  );
}

// ── Brand glyph (no CDN, no Lucide) ───────────────────────────────────
function ChestGlyph() {
  return (
    <svg
      width="72"
      height="72"
      viewBox="0 0 72 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect
        x="8"
        y="22"
        width="56"
        height="36"
        rx="6"
        stroke="var(--fuchsia)"
        strokeWidth="2"
      />
      <path
        d="M8 34 L64 34"
        stroke="var(--fuchsia)"
        strokeWidth="2"
        strokeDasharray="3 4"
      />
      <path
        d="M22 22 V14 a14 14 0 0 1 28 0 V22"
        stroke="var(--fuchsia)"
        strokeWidth="2"
        fill="none"
      />
      <circle cx="36" cy="40" r="3" fill="var(--fuchsia)" />
    </svg>
  );
}

function BannerGlyph() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <svg
        width="42"
        height="42"
        viewBox="0 0 42 42"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <rect
          x="3"
          y="9"
          width="36"
          height="24"
          rx="4"
          stroke="var(--fuchsia)"
          strokeWidth="1.5"
          strokeDasharray="2 3"
        />
        <circle cx="14" cy="20" r="3" fill="var(--fuchsia)" opacity="0.6" />
        <path
          d="M21 26 L27 18 L35 28"
          stroke="var(--fuchsia)"
          strokeWidth="1.5"
          fill="none"
        />
      </svg>
    </div>
  );
}
