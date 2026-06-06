// Top-level Schedule page (Schedule v2).
//
// Three sub-tabs: Queue / Loadout / Analytics. Sub-tab is the source of
// truth for what's rendered below the tab strip. Defaults to Loadout when
// the user has zero channels (the empty state pulls them into the right
// flow), otherwise Queue.
//
// v0.6.39 — Queue sub-tab now absorbs what used to live on the Upload tab:
//   1. A 4-slot platforms rail (YouTube / TikTok / Instagram / X) showing
//      which platforms are linked via Ayrshare.
//   2. DirectPublishQueue (drop-a-finished-clip surface)
//   3. LocalQueue (assisted reminder queue — local, runs offline)
//   4. ScheduleQueue (hosted auto-publish — gated on PUBLISHING_ENABLED)
// All three lanes carry mono eyebrows so the user reads the three layers
// clearly. Outer surfaces are transparent; fuchsia HUD bracket corners
// replace solid borders per the cockpit design language.

import { useEffect, useState } from "react";
import { Calendar, Layers, BarChart3, type LucideIcon } from "lucide-react";
import { ChannelsManager } from "./ChannelsManager";
import { AnalyticsView } from "./AnalyticsView";
import { ScheduleQueue } from "../ScheduleQueue";
import { DirectPublishQueue } from "../upload/DirectPublishQueue";
import { LocalQueue } from "../upload/LocalQueue";
import { PlatformIcon, type PlatformId } from "../PlatformIcon";
import * as backend from "../../lib/backend";
import { socialGetConnection, type SocialConnectionState, type ConnectionPlatform } from "../../lib/backend";
import { PUBLISHING_ENABLED } from "../../lib/flags";
import { sidecar, type Project } from "../../lib/sidecar";

type Sub = "queue" | "channels" | "analytics";

// Fixed slot order for the rail — same set Ayrshare returns linked status
// for; keeps the rail layout stable regardless of connection count.
const PLATFORM_SLOTS: ConnectionPlatform[] = ["youtube", "tiktok", "instagram", "x"];

export function SchedulePage({
  onOpenSettings,
  onOpenProject,
  initialSub,
}: {
  onOpenWorkspace?: () => void;
  /** Settings → Connections is where the user actually links accounts.
   *  Optional — defaults to a no-op so Schedule doesn't crash if the host
   *  doesn't wire it. */
  onOpenSettings?: () => void;
  /** Promote a direct-publish upload into the normal project editor. Optional
   *  — defaults to no-op; Schedule itself never navigates to ResultsGrid,
   *  but DirectPublishQueue requires the prop. */
  onOpenProject?: (project: Project) => void;
  /** Analytics Phase 1 — when set, Schedule mounts on this sub-tab instead of
   *  the default "queue". Used by deep-links from Settings → Connections
   *  ("view analytics") and ChannelCard ("analytics →"). Honored once, on
   *  mount — subsequent user tab clicks take over. */
  initialSub?: Sub;
} = {}) {
  // onOpenWorkspace was useful when Schedule was a single-tab placeholder;
  // the 3-tab v2 doesn't need it. Kept as an optional prop for caller
  // back-compat (App.tsx still passes it but we ignore).
  const [sub, setSub] = useState<Sub>(initialSub ?? "queue");
  const [hasChannels, setHasChannels] = useState<boolean | null>(null);
  const [connection, setConnection] = useState<SocialConnectionState | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);

  // Auto-jump to Loadout when user has zero channels (so the empty state is
  // the first thing they see). Only runs once on mount; subsequent
  // navigation honors user clicks. Skipped when `initialSub` is set — a
  // deep-link from Settings/ChannelCard already specifies where to land,
  // and yanking that user to Loadout would strand them at the wrong tab.
  useEffect(() => {
    void backend.listChannels().then((cs) => {
      setHasChannels(cs.length > 0);
      if (cs.length === 0 && !initialSub) setSub("channels");
    });
  }, [initialSub]);

  // Hydrate the connected-platforms rail. Mirrors UploadTab's pattern:
  // require a license JWT, then fetch the Ayrshare connection state.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { value: jwt } = await sidecar.licenseJwtRead();
        if (cancelled) return;
        if (!jwt) {
          setAuthed(false);
          return;
        }
        setAuthed(true);
        const state = await socialGetConnection();
        if (!cancelled) setConnection(state);
      } catch {
        if (!cancelled) setConnection(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const linkedPlatforms = new Set<string>(connection?.platforms ?? []);

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
          Schedule clips across your channels.
        </h1>
        <p className="font-sans text-[14px] leading-relaxed text-text-secondary">
          Manage every social channel, queue posts to fire automatically, and see what's working — all from one place.
        </p>
      </header>

      {/* Tab strip */}
      <div className="flex items-center gap-1 border-b border-line">
        <TabButton id="queue" current={sub} setCurrent={setSub} Icon={Calendar} label="Queue" />
        {/* Task #69 — "Channels" → "Loadout" per RPO vocab. The sub-tab
            id stays "channels" so navigation + analytics keys unchanged;
            only the visible label flips. See docs/RPO_VISUAL_LANGUAGE.md. */}
        <TabButton id="channels" current={sub} setCurrent={setSub} Icon={Layers} label="Loadout" />
        <TabButton id="analytics" current={sub} setCurrent={setSub} Icon={BarChart3} label="Analytics" />
      </div>

      {sub === "queue" && (
        <div className="flex flex-col gap-6">
          {/* Connected platforms rail — replaces the Upload tab's
              glanceable. Four fixed slots; `data-hot="true"` on linked
              ones so the cockpit corners light up. */}
          <section className="relative bg-transparent px-5 py-4">
            <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
            <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
            <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
            <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              connected accounts
              <span className="ml-auto font-mono text-[10px] text-text-tertiary">
                {authed === false ? "sign in to view" : connection ? `${connection.platforms.length} linked` : "—"}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {PLATFORM_SLOTS.map((p) => {
                const hot = linkedPlatforms.has(p);
                return (
                  <div
                    key={p}
                    data-hot={hot ? "true" : "false"}
                    className="library-card relative flex flex-col items-center justify-center gap-1.5 bg-transparent px-3 py-3"
                  >
                    <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
                    <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
                    <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
                    <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
                    <PlatformIcon
                      id={p as PlatformId}
                      className={`h-4 w-4 ${hot ? "text-ink" : "text-text-tertiary"}`}
                    />
                    <span
                      className={`font-mono text-[9px] uppercase tracking-[0.16em] ${
                        hot ? "text-ink" : "text-text-tertiary"
                      }`}
                    >
                      {p}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 1. Direct publish — drop a finished clip and ship it without
              the long-form clip-pick pipeline. The most important entry
              point per the consolidation pass, so it sits at the top. */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              direct publish
            </div>
            <DirectPublishQueue
              onOpenSettings={onOpenSettings ?? (() => undefined)}
              onOpenProject={onOpenProject ?? (() => undefined)}
              onOpenSchedule={undefined}
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

          {hasChannels === false && (
            <div className="relative bg-transparent p-5">
              <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
              <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
              <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
              <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
              <p className="font-display text-[15px] font-semibold text-ink">
                You haven't added any channels yet.
              </p>
              <p className="mt-1 font-sans text-[13px] text-text-secondary">
                Add a channel first, then you'll be able to schedule clips to it from the Workspace or directly here.
              </p>
              <button
                onClick={() => setSub("channels")}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 font-sans text-[12px] font-medium text-paper hover:bg-fuchsia"
              >
                Go to Loadout →
              </button>
            </div>
          )}
        </div>
      )}

      {sub === "channels" && (
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
      )}

      {sub === "analytics" && <AnalyticsView />}
    </div>
  );
}

function TabButton({
  id,
  current,
  setCurrent,
  Icon,
  label,
}: {
  id: Sub;
  current: Sub;
  setCurrent: (v: Sub) => void;
  Icon: LucideIcon;
  label: string;
}) {
  const active = current === id;
  return (
    <button
      onClick={() => setCurrent(id)}
      className={`relative inline-flex items-center gap-2 px-4 py-3 font-sans text-[13px] font-medium transition-colors ${
        active ? "text-ink" : "text-text-secondary hover:text-ink"
      }`}
    >
      <Icon size={14} className={active ? "text-fuchsia" : ""} />
      {label}
      {active && (
        <span
          className="absolute bottom-0 left-0 right-0 h-0.5 bg-fuchsia"
          aria-hidden
        />
      )}
    </button>
  );
}
