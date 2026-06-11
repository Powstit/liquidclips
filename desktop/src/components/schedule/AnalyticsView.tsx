// Analytics sub-tab of Schedule (Schedule v2).
//
// Three sections:
//   1. Overview tiles (total views, total engagement, best channel, best clip)
//   2. Per-channel table (sortable by views/engagement/posts)
//   3. Top clips leaderboard (top 10 by views, link to platform post URL)
//
// Reads ONLY from post_analytics (refreshed by cron every 30 min). UI shows
// "Updated X min ago" stamp so the user knows the data is mildly stale.

import { useEffect, useMemo, useState } from "react";
import { openSmart as openExternal } from "../../lib/openSmart";
import { AlertTriangle, BarChart3, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { PlatformIcon, type PlatformId } from "../PlatformIcon";
import * as backend from "../../lib/backend";
import { humanError } from "../../lib/sidecar";
import type { AnalyticsOverview, AnalyticsWindow, ChannelAnalyticsRow } from "./types";

const WINDOWS: AnalyticsWindow[] = ["7d", "30d", "90d", "all"];
const WINDOW_LABELS: Record<AnalyticsWindow, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "all": "All time",
};

type Sort = "views" | "engagement" | "posts";

export function AnalyticsView() {
  const [window, setWindow] = useState<AnalyticsWindow>("30d");
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [channelRows, setChannelRows] = useState<ChannelAnalyticsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("views");
  // Bump to force a re-fetch from the error banner's retry button.
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    // Today backend.analyticsOverview/Channels swallow errors and return
    // null / [] (see backend.ts:1134-1150). That's being fixed elsewhere.
    // The try/catch here is the contract we want once they throw — a thrown
    // rejection lands in `loadError` instead of stranding the user on an
    // infinite loader or rendering the "No analytics yet" empty state as a
    // lie. We do NOT treat the legitimate empty-data sentinel (`null` +
    // `[]`) as an error — that's a genuine first-time state.
    (async () => {
      try {
        const [o, ch] = await Promise.all([
          backend.analyticsOverview(window),
          backend.analyticsChannels(window),
        ]);
        if (cancelled) return;
        setOverview(o);
        setChannelRows(ch);
      } catch (e) {
        if (cancelled) return;
        setOverview(null);
        setChannelRows([]);
        setLoadError(humanError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [window, retryNonce]);

  const sortedChannels = useMemo(() => {
    const copy = [...channelRows];
    copy.sort((a, b) => (b[sort] as number) - (a[sort] as number));
    return copy;
  }, [channelRows, sort]);

  if (loading) {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 className="h-7 w-7 animate-spin text-fuchsia" />
      </div>
    );
  }

  // Truthful "no data" check — only render the empty hero when the load
  // succeeded AND the backend genuinely returned zero posts. A load error is
  // surfaced explicitly above so the user can retry instead of being lied to
  // with "no analytics yet".
  const noData = !loadError && (!overview || overview.total_posts === 0);

  return (
    <div className="flex flex-col gap-6">
      {/* Window picker */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-full border border-line bg-paper p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors ${
                window === w
                  ? "bg-fuchsia text-paper"
                  : "text-text-secondary hover:text-ink"
              }`}
            >
              {WINDOW_LABELS[w]}
            </button>
          ))}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          refreshes every 30 min
        </span>
      </div>

      {loadError ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 px-8 py-12 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--color-danger)]/10 text-[var(--color-danger)]">
            <AlertTriangle size={20} strokeWidth={2.5} />
          </span>
          <h3 className="font-display text-[18px] font-semibold tracking-[-0.02em] text-ink">
            Couldn't load analytics
          </h3>
          <p className="max-w-md font-sans text-[13px] leading-relaxed text-text-secondary">
            {loadError}
          </p>
          <button
            onClick={() => setRetryNonce((n) => n + 1)}
            className="inline-flex items-center gap-2 rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[13px] font-medium text-paper hover:bg-fuchsia-bright"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      ) : noData ? (
        <EmptyAnalytics />
      ) : (
        <>
          {/* Overview tiles — Task #69 HUD chrome: corner brackets + soft
              inner fuchsia glow wrap the analytics grid so the Mission Deck
              reads as a live HUD readout. See docs/RPO_VISUAL_LANGUAGE.md. */}
          <div className="hud-frame grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label="Total views"
              value={fmtNum(overview!.total_views)}
              accent
            />
            <Tile
              label="Total engagement"
              value={fmtNum(overview!.total_engagement)}
            />
            <Tile
              label="Best channel"
              value={overview!.best_channel?.label ?? "—"}
              sub={overview!.best_channel ? `${fmtNum(overview!.best_channel.views)} views` : undefined}
            />
            <Tile
              label="Best clip"
              value={overview!.best_clip?.title ?? "—"}
              sub={overview!.best_clip ? `${fmtNum(overview!.best_clip.views)} views · ${overview!.best_clip.platform}` : undefined}
              onClick={overview!.best_clip?.post_url ? () => void openExternal(overview!.best_clip!.post_url!) : undefined}
            />
          </div>

          {/* Channels table */}
          {/* v0.7.50 — Brand-kit pass. Outer `border border-line` retired
              (IG-012 ban on solid card borders); replaced with library-
              card bracket spans + warm paper bg. The inner row divider
              stays (it's a table separator, not a card border). */}
          <div className="library-card relative rounded-2xl bg-paper-warm/40">
            <span className="library-card-corner library-card-corner-tl" />
            <span className="library-card-corner library-card-corner-tr" />
            <span className="library-card-corner library-card-corner-bl" />
            <span className="library-card-corner library-card-corner-br" />
            <div className="flex items-center justify-between border-b border-line/60 px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
                channels · {WINDOW_LABELS[window].toLowerCase()}
              </p>
              <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
                <span>sort:</span>
                {(["views", "engagement", "posts"] as Sort[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSort(s)}
                    className={`rounded-md px-2 py-0.5 transition-colors ${
                      sort === s ? "bg-fuchsia-soft text-fuchsia-deep" : "hover:text-ink"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            {sortedChannels.length === 0 ? (
              // Distinguish "overview ready, per-channel still settling" from
              // "no posts in this window at all". If we have an overview but
              // the per-channel breakdown is empty, that's a partial-fail
              // (or in-flight aggregation) — not the same story as a window
              // with literally zero posts.
              overview && overview.total_posts > 0 ? (
                <p className="px-4 py-6 text-center font-mono text-[11px] text-text-tertiary">
                  overview ready — per-channel data still loading
                </p>
              ) : (
                <p className="px-4 py-6 text-center font-mono text-[11px] text-text-tertiary">
                  no analytics for this window yet
                </p>
              )
            ) : (
              <ul className="divide-y divide-line/40">
                {sortedChannels.map((c) => (
                  <li key={c.channel_id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <ChannelPlatformBadge platform={c.platform} />
                      <div className="min-w-0">
                        <p className="truncate font-sans text-[13px] font-medium text-ink">{c.label}</p>
                        {c.handle && (
                          <p className="truncate font-mono text-[10px] text-text-tertiary">{c.handle}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-right">
                      <Stat label="posts" value={String(c.posts)} />
                      <Stat label="views" value={fmtNum(c.views)} />
                      <Stat label="engage" value={fmtNum(c.engagement)} />
                      <Stat label="rate" value={c.engagement_rate !== null ? `${c.engagement_rate}%` : "—"} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function EmptyAnalytics() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-line bg-paper-warm/40 px-8 py-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-fuchsia text-paper">
        <BarChart3 size={18} strokeWidth={2.5} />
      </span>
      <h3 className="font-display text-[18px] font-semibold tracking-[-0.02em] text-ink">
        No analytics yet
      </h3>
      <p className="max-w-md font-sans text-[13px] leading-relaxed text-text-secondary">
        Numbers show up here once your first post goes live. If you just published, stats appear after the next refresh cycle — usually within 30 minutes. Otherwise, publish a clip from the Workspace to get started.
      </p>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  accent,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`flex flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-colors ${
        accent
          ? "border-fuchsia/40 bg-fuchsia-soft/30"
          : "border-line bg-paper hover:border-fuchsia/40"
      } ${onClick ? "cursor-pointer hover:shadow-[var(--glow-sm)]" : "cursor-default"}`}
    >
      <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
        {label}
      </p>
      <p className={`font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] ${accent ? "text-fuchsia-deep" : "text-ink"} truncate w-full`}>
        {value}
      </p>
      {sub && (
        <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary truncate w-full">
          {sub} {onClick && <ExternalLink className="inline h-3 w-3" />}
        </p>
      )}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="font-mono text-[9px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">{label}</span>
      <span className="font-display text-[14px] font-semibold text-ink tabular-nums">{value}</span>
    </div>
  );
}

function ChannelPlatformBadge({ platform }: { platform: string }) {
  const id = (platform === "twitter" ? "x" : platform) as PlatformId;
  const known = ["youtube", "tiktok", "instagram", "x"].includes(id);
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink text-paper">
      {known ? <PlatformIcon id={id} className="h-3.5 w-3.5" /> : (
        <span className="font-mono text-[10px] uppercase">{platform[0]}</span>
      )}
    </span>
  );
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

