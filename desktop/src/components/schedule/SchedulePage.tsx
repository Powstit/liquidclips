// Top-level Schedule page (Schedule v2).
//
// Three sub-tabs: Queue / Channels / Analytics. Sub-tab is the source of
// truth for what's rendered below the tab strip. Defaults to Channels when
// the user has zero channels (the empty state pulls them into the right
// flow), otherwise Queue.

import { useEffect, useState } from "react";
import { Calendar, Layers, BarChart3 } from "lucide-react";
import { ChannelsManager } from "./ChannelsManager";
import { AnalyticsView } from "./AnalyticsView";
import { ScheduleQueue } from "../ScheduleQueue";
import { HudChip } from "../cockpit/HudChip";
import * as backend from "../../lib/backend";

type Sub = "queue" | "channels" | "analytics";

export function SchedulePage(_props: { onOpenWorkspace?: () => void } = {}) {
  // onOpenWorkspace was useful when Schedule was a single-tab placeholder;
  // the 3-tab v2 doesn't need it. Kept as an optional prop for caller
  // back-compat (App.tsx still passes it but we ignore).
  const [sub, setSub] = useState<Sub>("queue");
  const [hasChannels, setHasChannels] = useState<boolean | null>(null);

  // Auto-jump to Channels when user has zero (so the empty state is the
  // first thing they see). Only runs once on mount; subsequent navigation
  // honors user clicks.
  useEffect(() => {
    void backend.listChannels().then((cs) => {
      setHasChannels(cs.length > 0);
      if (cs.length === 0) setSub("channels");
    });
  }, []);

  return (
    // v0.5.1 — Mission Deck. Cyan-cool top-edge band signals "mission
    // control" vs. workspace's fuchsia dojo. See docs/RPO_VISUAL_LANGUAGE.md.
    <div className="deck deck-schedule mx-auto flex w-full max-w-5xl flex-col gap-6 bg-transparent px-6 py-8">
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

      {/* Tab strip — HudChip segmented control. No bottom border plate;
          the chip's bracket-corner active state carries the affordance. */}
      <div className="flex items-center gap-1.5">
        <HudChip active={sub === "queue"} onClick={() => setSub("queue")}>
          <Calendar size={11} /> Queue
        </HudChip>
        {/* Task #69 — "Channels" → "Loadout" per RPO vocab. The sub-tab
            id stays "channels" so navigation + analytics keys unchanged;
            only the visible label flips. */}
        <HudChip active={sub === "channels"} onClick={() => setSub("channels")}>
          <Layers size={11} /> Loadout
        </HudChip>
        <HudChip active={sub === "analytics"} onClick={() => setSub("analytics")}>
          <BarChart3 size={11} /> Analytics
        </HudChip>
      </div>

      {sub === "queue" && (
        <div className="flex flex-col gap-4">
          <ScheduleQueue />
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
              <div className="mt-3">
                <HudChip active={false} onClick={() => setSub("channels")}>
                  Go to Loadout →
                </HudChip>
              </div>
            </div>
          )}
        </div>
      )}

      {sub === "channels" && <ChannelsManager />}

      {sub === "analytics" && <AnalyticsView />}
    </div>
  );
}


