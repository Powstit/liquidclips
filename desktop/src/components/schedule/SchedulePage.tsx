// Top-level Schedule page (Schedule v2).
//
// Three sub-tabs: Loadout / Queue / Analytics. Sub-tab is the source of
// truth for what's rendered below the tab strip. Defaults to Loadout when
// the user has zero channels (the empty state pulls them into the right
// flow), otherwise Queue.
//
// v0.7.78 — Phase 3 Schedule/Social Connections clarity:
//   1. Header truth-line — explicit Ayrshare attribution under subcopy.
//   2. Pill row with counts — replaces underlined tabs with the demo
//      `.pill / .pill.is-active` vocabulary. Counts are real (channels
//      from listChannels, queue from useDirectPublishQueue).
//   3. Routed-to chip row — one chip per connected handle, plus
//      pending/unlinked/error chips where ChannelRow already encodes
//      them. No fakes.
//   4. Connected-accounts rail mounts above BOTH Queue and Channels
//      sub-tabs so the platform state is visible on every entry.
//   5. ConnectFirstPrompt leads above the pill row when channels.length
//      === 0 — replaces the buried bottom-of-Queue empty state.
//
// v0.6.39 — Queue sub-tab absorbs what used to live on the Upload tab:
//   1. A 4-slot platforms rail (YouTube / TikTok / Instagram / X) showing
//      which platforms are linked via Ayrshare.
//   2. DirectPublishQueue (drop-a-finished-clip surface)
//   3. LocalQueue (assisted reminder queue — local, runs offline)
//   4. ScheduleQueue (hosted auto-publish — gated on PUBLISHING_ENABLED)

import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, Layers, BarChart3, Plus, type LucideIcon } from "lucide-react";
import { ChannelsManager } from "./ChannelsManager";
import { AnalyticsView } from "./AnalyticsView";
import { ScheduleQueue } from "../ScheduleQueue";
import { DirectPublishQueue } from "../upload/DirectPublishQueue";
import { LocalQueue } from "../upload/LocalQueue";
import { ConnectFirstPrompt } from "../upload/ConnectFirstPrompt";
import { useDirectPublishQueue } from "../upload/useDirectPublishQueue";
import { PlatformIcon, type PlatformId } from "../PlatformIcon";
import { getCachedLicenseJwt, type Channel, type ChannelPlatform, type ConnectionPlatform } from "../../lib/backend";
import { usePlatformConnections } from "../../lib/usePlatformConnections";
import { PUBLISHING_ENABLED } from "../../lib/flags";
import { sidecar, type Project } from "../../lib/sidecar";
import { prettyPlatform } from "./types";

type Sub = "queue" | "channels" | "analytics";

// Fixed slot order for the rail — same set Ayrshare returns linked status
// for; keeps the rail layout stable regardless of connection count.
const PLATFORM_SLOTS: ConnectionPlatform[] = ["youtube", "tiktok", "instagram", "x"];

// Routed-to chip tones mirror ChannelRow's status semantics so the
// connect-state vocabulary stays consistent across surfaces.
type ChipTone = "ok" | "warn" | "danger" | "muted";

const CHIP_BG: Record<ChipTone, string> = {
  ok: "bg-fuchsia-soft/30",
  warn: "bg-amber-400/15",
  danger: "bg-[var(--color-danger)]/15",
  muted: "bg-paper-elev/60",
};

const CHIP_TEXT: Record<ChipTone, string> = {
  ok: "text-fuchsia-deep",
  warn: "text-amber-400",
  danger: "text-[var(--color-danger)]",
  muted: "text-text-secondary",
};

const CHIP_BORDER: Record<ChipTone, string> = {
  ok: "border-fuchsia/40",
  warn: "border-amber-400/30",
  danger: "border-[var(--color-danger)]/30",
  muted: "border-line",
};

export function SchedulePage({
  onOpenProject,
  initialSub,
  initialConnectRequest,
}: {
  onOpenWorkspace?: () => void;
  /** Promote a direct-publish upload into the normal project editor. Optional
   *  — defaults to no-op; Schedule itself never navigates to ResultsGrid,
   *  but DirectPublishQueue requires the prop. */
  onOpenProject?: (project: Project) => void;
  /** Analytics Phase 1 — when set, Schedule mounts on this sub-tab instead of
   *  the default "queue". Used by deep-links from Schedule → Channels
   *  ("view analytics") and ChannelCard ("analytics →"). Honored once, on
   *  mount — subsequent user tab clicks take over. */
  initialSub?: Sub;
  initialConnectRequest?: { platform: ChannelPlatform; nonce: number } | null;
} = {}) {
  // onOpenWorkspace was useful when Schedule was a single-tab placeholder;
  // the 3-tab v2 doesn't need it. Kept as an optional prop for caller
  // back-compat (App.tsx still passes it but we ignore).
  const [sub, setSub] = useState<Sub>(initialSub ?? "queue");
  const [pendingConnectPlatform, setPendingConnectPlatform] = useState<ChannelPlatform | null>(null);
  const consumedConnectNonceRef = useRef<number | null>(null);
  const { snapshot, refresh } = usePlatformConnections();
  const channels = useMemo<Channel[] | null>(
    () => (snapshot.kind === "loaded" ? snapshot.channels : snapshot.kind === "error" ? [] : null),
    [snapshot],
  );
  const connection = snapshot.kind === "loaded" ? snapshot.ayrshare : null;
  const [authed, setAuthed] = useState<boolean | null>(null);

  // v0.7.78 — Channels + connection state now come from the canonical
  // `usePlatformConnections` hook (listChannels + socialGetConnectionStrict).
  // The hook refreshes automatically on channel link/mutation events, so
  // Schedule's pill counts, routed-to chips, and connected-accounts rail all
  // read from the same source as PublishModal, ChannelPicker, and ClipReadyCard.
  // We still re-read on sub-tab change as a belt-and-braces freshness kick.
  useEffect(() => {
    void refresh();
  }, [sub, refresh]);

  useEffect(() => {
    if (sub !== "channels" || !pendingConnectPlatform) return;
    const platform = pendingConnectPlatform;
    setPendingConnectPlatform(null);
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("lc:channel-connect-request", { detail: { platform } }),
      );
    }, 0);
  }, [pendingConnectPlatform, sub]);

  useEffect(() => {
    if (!initialConnectRequest) return;
    if (consumedConnectNonceRef.current === initialConnectRequest.nonce) return;
    consumedConnectNonceRef.current = initialConnectRequest.nonce;
    setSub("channels");
    setPendingConnectPlatform(initialConnectRequest.platform);
  }, [initialConnectRequest]);

  // Initial auto-jump to Channels when the user has zero channels.
  useEffect(() => {
    if (channels && channels.length === 0 && !initialSub) setSub("channels");
  }, [channels, initialSub]);

  // Hydrate signed-in indicator for the rail header. Mirrors UploadTab's
  // pattern: use the cache-only JWT check, and fall back to the presence
  // file (no keychain) when the cache is empty.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cached = getCachedLicenseJwt();
      if (!cached) {
        let present = false;
        try {
          ({ present } = await sidecar.licenseJwtPresence());
        } catch {
          present = false;
        }
        if (!cancelled) setAuthed(present);
        return;
      }
      if (!cancelled) setAuthed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // v0.7.78 — Direct-publish queue count for the Queue tab pill.
  //
  // NOTE on staleness: DirectPublishQueue (mounted inside the Queue sub-tab)
  // owns its own hook instance and writes to the same JSON file via the
  // sidecar. The hook does not currently emit a window event on persist, so
  // this count can briefly lag a card-level add/remove until SchedulePage
  // re-mounts. Counts are still REAL — they come from the persisted
  // .direct-publish-queue.json — never fabricated. Trading off briefly-
  // stale-real for never-fake.
  const { items: queueItems } = useDirectPublishQueue();
  const queueCount = queueItems?.length ?? 0;

  const channelCount = channels?.length ?? 0;
  const hasChannels = channels !== null && channels.length > 0;
  const channelsReady = channels !== null;
  const ayrsharePlatformsLc = useMemo(
    () => (connection?.platforms ?? []).map((p) => p.toLowerCase()),
    [connection],
  );
  const linkedPlatformSet = useMemo(
    () => new Set(ayrsharePlatformsLc),
    [ayrsharePlatformsLc],
  );

  // Routed-to chip set. One chip per channel:
  //   • Active (or stale-but-Ayrshare-linked)  → handle / platform label, ok tone
  //   • pending_link                            → "finish linking · {platform}", warn
  //   • unlinked                                → "disconnected · {platform}", warn
  //   • error                                   → "connection error · {platform}", danger
  //   • paused                                  → "paused · {platform}", muted
  //   • deleted                                 → row filtered out
  // Plus a single trailing "+ add" pill that routes to Channels.
  // Every chip maps to a real DB row from listChannels(); never fabricated.
  const routedChips = useMemo(() => {
    if (!channels) return [];
    type Chip = { key: string; label: string; tone: ChipTone; title: string };
    const out: Chip[] = [];
    for (const c of channels) {
      if (c.status === "deleted") continue;
      const platformLc = c.platform.toLowerCase();
      const ayrshareLinked =
        linkedPlatformSet.has(platformLc) ||
        (platformLc === "x" && linkedPlatformSet.has("twitter")) ||
        (platformLc === "twitter" && linkedPlatformSet.has("x"));
      const effectivelyActive =
        c.status === "active" ||
        ((c.status === "pending_link" || c.status === "unlinked") && ayrshareLinked);
      if (effectivelyActive) {
        const cleaned = (c.handle ?? "").replace(/^@+/, "").trim();
        const label = cleaned ? `@${cleaned}` : prettyPlatform(c.platform);
        out.push({
          key: c.id,
          label,
          tone: "ok",
          title: `${prettyPlatform(c.platform)} — connected`,
        });
        continue;
      }
      const platformPretty = prettyPlatform(c.platform);
      switch (c.status) {
        case "pending_link":
          out.push({
            key: c.id,
            label: `finish linking · ${c.platform}`,
            tone: "warn",
            title: `${platformPretty} — finish linking in Channels`,
          });
          break;
        case "unlinked":
          out.push({
            key: c.id,
            label: `disconnected · ${c.platform}`,
            tone: "warn",
            title: `${platformPretty} — relink in Channels`,
          });
          break;
        case "error":
          out.push({
            key: c.id,
            label: `connection error · ${c.platform}`,
            tone: "danger",
            title: `${platformPretty} — reconnect required`,
          });
          break;
        case "paused":
          out.push({
            key: c.id,
            label: `paused · ${c.platform}`,
            tone: "muted",
            title: `${platformPretty} — paused`,
          });
          break;
      }
    }
    return out;
  }, [channels, linkedPlatformSet]);

  // ConnectedAccountsRail — extracted so it mounts above BOTH Queue and
  // Channels sub-tabs. Renders 4 fixed Ayrshare slots; `data-hot="true"`
  // on the linked ones lights the cockpit corners.
  const accountsRail = (
    <section className="relative bg-transparent px-5 py-4">
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
        connected accounts
        <span className="ml-auto font-mono text-[10px] text-text-tertiary">
          {authed === false
            ? "sign in to view"
            : connection
            ? `${connection.platforms.length} linked`
            : "—"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {PLATFORM_SLOTS.map((p) => {
          const hot = linkedPlatformSet.has(p);
          // Connected icons open Channels for management. Disconnected icons
          // request the same backend-generated OAuth link the Add Channel flow
          // uses, so clicking Instagram/TikTok/YouTube/X starts that provider.
          return (
            <button
              key={p}
              type="button"
              data-hot={hot ? "true" : "false"}
              onClick={() => {
                setSub("channels");
                if (!hot) setPendingConnectPlatform(p);
              }}
              title={
                hot
                  ? `${prettyPlatform(p)} — connected · manage in Channels`
                  : `Connect ${prettyPlatform(p)} in Channels`
              }
              aria-label={
                hot
                  ? `${prettyPlatform(p)} connected — open Channels`
                  : `Connect ${prettyPlatform(p)} — open Channels`
              }
              className="library-card group relative flex flex-col items-center justify-center gap-1.5 bg-transparent px-3 py-3 transition-colors hover:bg-fuchsia-soft/10"
            >
              <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
              <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
              <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
              <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
              <PlatformIcon
                id={p as PlatformId}
                className={`h-4 w-4 ${hot ? "text-ink" : "text-text-tertiary"} group-hover:text-fuchsia-deep`}
              />
              <span
                className={`font-mono text-[9px] uppercase tracking-[0.16em] ${
                  hot ? "text-ink" : "text-text-tertiary"
                } group-hover:text-fuchsia-deep`}
              >
                {p}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );

  return (
    // v0.5.1 — Mission Deck. Cyan-cool top-edge band signals "mission
    // control" vs. workspace's fuchsia dojo. See docs/RPO_VISUAL_LANGUAGE.md.
    <div className="deck deck-schedule mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          <Calendar size={11} className="text-fuchsia" />
          schedule
        </div>
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Plan your next post.
        </h1>
        <p className="font-sans text-[14px] leading-relaxed text-text-secondary">
          Manage every social channel, queue posts to fire automatically, and see what&apos;s working — all from one place.
        </p>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
          Publishes through Ayrshare to YouTube Shorts, TikTok, Instagram Reels, and X.
        </p>
      </header>

      {/* v0.7.78 — ConnectFirstPrompt lead. When the user has zero channels,
          this panel is the first thing they see on every sub-tab. Replaces
          the buried bottom-of-Queue empty state. Routes Open Schedule → to
          the Channels sub-tab (in-tab navigation; no App.tsx change). */}
      {channelsReady && channelCount === 0 && (
        <ConnectFirstPrompt
          variant="panel"
          onOpenSchedule={() => setSub("channels")}
        />
      )}

      {/* v0.7.78 — Pill row with real counts. Replaces the underlined
          TabButton strip with the demo `.pill / .pill.is-active` vocabulary.
          Counts render only when > 0 so an empty queue shows "Queue" rather
          than "Queue · 0". */}
      <div className="flex items-center gap-2">
        <PillTab
          id="queue"
          current={sub}
          setCurrent={setSub}
          Icon={Calendar}
          label="Queue"
          count={queueCount > 0 ? queueCount : undefined}
        />
        <PillTab
          id="channels"
          current={sub}
          setCurrent={setSub}
          Icon={Layers}
          label="Channels"
          count={channelCount > 0 ? channelCount : undefined}
        />
        <PillTab
          id="analytics"
          current={sub}
          setCurrent={setSub}
          Icon={BarChart3}
          label="Analytics"
        />
      </div>

      {/* v0.7.78 — Routed-to chip row. One chip per channel from
          listChannels() — connected handles, finish-linking, disconnected,
          connection-error, and paused — plus a trailing "+ add" pill that
          jumps to Channels. Visible on every sub-tab so the user always
          knows where posts land. */}
      {hasChannels && routedChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            routed to
          </span>
          {routedChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setSub("channels")}
              className={`inline-flex items-center rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${CHIP_BG[chip.tone]} ${CHIP_TEXT[chip.tone]} ${CHIP_BORDER[chip.tone]} hover:border-fuchsia hover:text-fuchsia-deep`}
              title={chip.title}
              aria-label={chip.title}
            >
              {chip.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSub("channels")}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary transition-colors hover:border-fuchsia hover:text-fuchsia-deep"
            title="Open Channels to link or manage another platform"
          >
            <Plus className="h-3 w-3" strokeWidth={2.25} />
            add
          </button>
        </div>
      )}

      {sub === "queue" && (
        <div className="flex flex-col gap-6">
          {/* Connected platforms rail */}
          {accountsRail}

          {/* 1. Direct publish — drop a finished clip and ship it without
              the long-form clip-pick pipeline. The most important entry
              point per the consolidation pass, so it sits at the top. */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              direct publish
            </div>
            <DirectPublishQueue
              onOpenProject={onOpenProject ?? (() => undefined)}
              onOpenSchedule={() => setSub("channels")}
            />
          </section>

          {/* 2. Local "Liquid Clips reminds, you post" queue. Always
              available, no tier gate, no Postiz dependency — runs from
              $CLIPS_HOME/.schedule.json. */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              schedule &mdash; assisted &middot; local
            </div>
            <LocalQueue />
          </section>

          {/* 3. Backend auto-publish queue (premium, hosted). When
              PUBLISHING_ENABLED is off, the eyebrow flips to "coming soon"
              and a small explainer replaces the queue — same conditional
              pattern Upload tab used. */}
          {PUBLISHING_ENABLED ? (
            <section className="flex flex-col gap-3">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                auto-publish &mdash; hosted &middot; live
              </div>
              <ScheduleQueue />
            </section>
          ) : (
            <section className="flex flex-col gap-3">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                auto-publish &mdash; hosted &middot; coming soon
              </div>
              <div className="relative bg-transparent px-5 py-4">
                <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
                <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
                <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
                <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
                <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
                  One-tap publishing across your connected accounts is in beta. We're verifying the full
                  path end-to-end before flipping it on. For now, use the local schedule above &mdash;
                  Liquid Clips reminds you when it's time and copies your caption so you post in one tap.
                </p>
              </div>
            </section>
          )}
        </div>
      )}

      {sub === "channels" && (
        <div className="flex flex-col gap-6">
          {/* v0.7.78 — Rail promoted to Channels sub-tab too so the user
              sees what's connected the moment they land on Channels, not
              only on Queue. */}
          {accountsRail}
          <ChannelsManager
            onOpenAnalytics={() => {
              // TODO(analytics-phase-2): forward channelId so AnalyticsView
              // pre-filters by channel. Wiring point: pass a channelFilter
              // prop into <AnalyticsView /> at SchedulePage.tsx (the
              // {sub === "analytics"} branch below) and let it pre-select
              // that row in the channels table. Today the click just lands
              // the user on the analytics tab — they scan the row themselves.
              setSub("analytics");
            }}
          />
        </div>
      )}

      {sub === "analytics" && <AnalyticsView />}
    </div>
  );
}

function PillTab({
  id,
  current,
  setCurrent,
  Icon,
  label,
  count,
}: {
  id: Sub;
  current: Sub;
  setCurrent: (v: Sub) => void;
  Icon: LucideIcon;
  label: string;
  count?: number;
}) {
  const active = current === id;
  return (
    <button
      type="button"
      onClick={() => setCurrent(id)}
      aria-pressed={active}
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${
        active
          ? "border-transparent bg-fuchsia text-ink shadow-[var(--glow-sm)]"
          : "border-line bg-paper text-text-secondary hover:border-fuchsia hover:text-ink"
      }`}
    >
      <Icon size={12} className={active ? "text-ink" : "text-fuchsia"} />
      <span>{label}</span>
      {typeof count === "number" && (
        <span
          className={`font-mono text-[10px] ${
            active ? "opacity-90" : "text-text-tertiary"
          }`}
        >
          · {count}
        </span>
      )}
    </button>
  );
}
