"use client";

// CampaignDetailClient — tabbed detail surface (Overview / Submissions /
// Analytics / Edit / Archive).
//
// Lives client-side because tab state + form mutations are interactive.
// The server page upstream handled the auth gate; this component fetches
// the campaign row via the proxy and renders the active tab.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { InfoIcon } from "@/components/admin/_lib/InfoIcon";
import {
  AgencyApiError,
  archiveCampaign,
  getCampaign,
  publishCampaign,
  refreshReward,
  type CampaignBlock,
} from "@/lib/agency-campaigns";
import { CampaignDetailHeader } from "../../_components/CampaignDetailHeader";
import { CampaignForm } from "../../_components/CampaignForm";
import { SubmissionsTable } from "../../_components/SubmissionsTable";
import { AnalyticsPanel } from "../../_components/AnalyticsPanel";

type Tab = "overview" | "submissions" | "analytics" | "edit" | "archive";

const TABS: { id: Tab; label: string; hint: string }[] = [
  {
    id: "overview",
    label: "Overview",
    hint: "Brief, reward link, snapshot state, publish + refresh actions.",
  },
  {
    id: "submissions",
    label: "Submissions",
    hint: "Clip submissions for this campaign · filter by status.",
  },
  {
    id: "analytics",
    label: "Analytics",
    hint: "Rollup metrics · status breakdown · top clippers · payout total.",
  },
  {
    id: "edit",
    label: "Edit",
    hint: "Change title, brief, banner, tier visibility. Slug is locked once saved.",
  },
  {
    id: "archive",
    label: "Archive",
    hint: "Archive removes the campaign from the public feed. Type the slug to confirm.",
  },
];

export function CampaignDetailClient({ slug }: { slug: string }) {
  const [row, setRow] = useState<CampaignBlock | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await getCampaign(slug);
      setRow(r);
    } catch (e) {
      if (e instanceof AgencyApiError && e.status === 404) {
        setLoadError("That campaign doesn't exist.");
      } else if (e instanceof AgencyApiError) {
        setLoadError(`Load failed (${e.status}).`);
      } else {
        setLoadError("Load failed — backend unreachable.");
      }
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-[1080px] px-6 py-10">
        <Link
          href="/agency"
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary hover:text-ink"
        >
          ← Agency
        </Link>
        <div className="mt-6 rounded-3xl border border-fuchsia-deep/30 bg-fuchsia-soft/20 p-6">
          <h2 className="font-display text-[20px] font-semibold tracking-[-0.02em] text-fuchsia-deep">
            {loadError}
          </h2>
          <p className="mt-2 font-sans text-[13px] text-text-secondary">
            slug · <span className="font-mono">{slug}</span>
          </p>
        </div>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="mx-auto max-w-[1080px] px-6 py-10">
        <div className="h-12 w-32 animate-pulse rounded-md bg-paper-elev" />
        <div className="mt-6 h-40 w-full animate-pulse rounded-3xl bg-paper-elev" />
        <div className="mt-4 h-10 w-3/4 animate-pulse rounded-md bg-paper-elev" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-10">
      <Link
        href="/agency"
        className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary hover:text-ink"
      >
        ← Agency
      </Link>

      <div className="mt-4 space-y-5">
        <CampaignDetailHeader row={row} />

        <nav className="flex flex-wrap gap-2 border-b border-line pb-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={
                tab === t.id
                  ? "rounded-full bg-fuchsia px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink"
                  : "rounded-full border border-line bg-paper px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-text-secondary hover:border-fuchsia hover:text-ink"
              }
            >
              {t.label}
              <InfoIcon hint={t.hint} />
            </button>
          ))}
        </nav>

        {tab === "overview" && <OverviewTab row={row} onMutate={load} />}
        {tab === "submissions" && <SubmissionsTable slug={row.slug} />}
        {tab === "analytics" && <AnalyticsPanel slug={row.slug} />}
        {tab === "edit" && (
          <section className="rounded-3xl border border-line bg-paper-warm/40 p-5 sm:p-6">
            <CampaignForm
              mode="edit"
              initial={row}
              onSaved={(r) => setRow(r)}
            />
          </section>
        )}
        {tab === "archive" && (
          <ArchiveTab row={row} />
        )}
      </div>
    </div>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────
function OverviewTab({
  row,
  onMutate,
}: {
  row: CampaignBlock;
  onMutate: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function doPublish() {
    setBusy("publish");
    setError(null);
    try {
      await publishCampaign(row.slug);
      await onMutate();
    } catch (e) {
      if (e instanceof AgencyApiError) {
        setError(parsePublishError(e.body) ?? `Publish failed (${e.status}).`);
      } else {
        setError("Publish failed — backend unreachable.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function doRefresh() {
    setBusy("refresh");
    setError(null);
    try {
      await refreshReward(row.slug);
      await onMutate();
    } catch (e) {
      if (e instanceof AgencyApiError) setError(`Refresh failed (${e.status}).`);
      else setError("Refresh failed — backend unreachable.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border border-line bg-paper-warm/40 p-5 sm:p-6">
        <div className="flex items-center font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          brief
          <InfoIcon hint="sponsored_campaigns.description · the brief clippers read. Mirror your Whop reward rules here." />
        </div>
        <p className="mt-3 whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-ink">
          {row.description?.trim() || (
            <em className="text-text-tertiary">
              No brief yet — add one via the Edit tab before publishing.
            </em>
          )}
        </p>
      </div>

      <div className="rounded-3xl border border-line bg-paper-warm/40 p-5 sm:p-6">
        <div className="flex items-center font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          whop reward snapshot
          <InfoIcon hint="whop_reward_snapshot_status · enriched | not_enriched | unreachable | not_attempted. Enriched = we fetched the reward from Whop; not_enriched = the reward isn't visible to our App API Key (still publishable URL-only)." />
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Mini label="snapshot status" value={row.whop_reward_snapshot_status} />
          <Mini label="reward state" value={row.whop_reward_state ?? "—"} />
          <Mini
            label="last synced"
            value={
              row.whop_reward_synced_at
                ? new Date(row.whop_reward_synced_at).toLocaleString()
                : "—"
            }
          />
        </dl>
        {row.whop_reward_last_error ? (
          <p className="mt-3 font-mono text-[11px] text-fuchsia-deep">
            {row.whop_reward_last_error}
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-fuchsia-deep/30 bg-fuchsia-soft/30 px-3 py-2 font-mono text-[12px] text-fuchsia-deep">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button
          type="button"
          onClick={doRefresh}
          disabled={busy !== null}
          className="rounded-full border border-line bg-paper px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia hover:text-fuchsia disabled:opacity-50"
        >
          {busy === "refresh" ? "Refreshing…" : "Refresh reward snapshot"}
        </button>
        <button
          type="button"
          onClick={doPublish}
          disabled={busy !== null || row.status === "live"}
          className="ml-auto rounded-full bg-fuchsia px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink hover:bg-fuchsia-bright disabled:opacity-50"
        >
          {busy === "publish"
            ? "Publishing…"
            : row.status === "live"
              ? "Already live"
              : "Publish"}
        </button>
      </div>
    </section>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
        {label}
      </div>
      <div className="mt-1 font-mono text-[12px] text-ink">{value}</div>
    </div>
  );
}

function parsePublishError(body: string): string | null {
  try {
    const j = JSON.parse(body) as { detail?: unknown };
    if (
      typeof j.detail === "object" &&
      j.detail &&
      "errors" in j.detail &&
      Array.isArray((j.detail as { errors: unknown[] }).errors)
    ) {
      return (j.detail as { errors: string[] }).errors.join(" · ");
    }
    if (typeof j.detail === "string") return j.detail;
  } catch {
    /* fall through */
  }
  return null;
}

// ── Archive tab ──────────────────────────────────────────────────────
function ArchiveTab({ row }: { row: CampaignBlock }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expected = useMemo(() => `ARCHIVE ${row.slug}`, [row.slug]);
  const matches = typed.trim() === expected;

  async function doArchive() {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await archiveCampaign(row.slug);
      router.push("/agency");
    } catch (e) {
      if (e instanceof AgencyApiError) setError(`Archive failed (${e.status}).`);
      else setError("Archive failed — backend unreachable.");
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-fuchsia-deep/30 bg-paper-warm/40 p-5 sm:p-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
        danger zone
      </div>
      <h3 className="mt-2 font-display text-[20px] font-semibold tracking-[-0.02em] text-ink">
        Archive this campaign.
      </h3>
      <p className="mt-2 max-w-xl font-sans text-[14px] leading-relaxed text-text-secondary">
        Archiving deletes the campaign row · clippers stop seeing it · existing
        submissions remain on Whop but no new clips can be submitted. This is
        permanent in v1 — there is no un-archive button.
      </p>
      <label className="mt-5 flex flex-col gap-1">
        <span className="flex items-center font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          type to confirm
          <InfoIcon hint={`Type "${expected}" exactly — case-sensitive — to enable the archive button.`} />
        </span>
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={expected}
          className="rounded-md border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink placeholder:text-text-tertiary focus:border-fuchsia-deep focus:outline-none"
        />
      </label>
      {error ? (
        <p className="mt-3 font-mono text-[12px] text-fuchsia-deep">{error}</p>
      ) : null}
      <div className="mt-5 flex items-center justify-end">
        <button
          type="button"
          onClick={doArchive}
          disabled={!matches || busy}
          className="rounded-full border border-fuchsia-deep bg-paper px-5 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fuchsia-deep hover:bg-fuchsia-soft/40 disabled:opacity-40"
        >
          {busy ? "Archiving…" : "Archive campaign"}
        </button>
      </div>
    </section>
  );
}
