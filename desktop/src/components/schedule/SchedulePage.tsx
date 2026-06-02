// Top-level Schedule page (Schedule v2).
//
// Three sub-tabs: Queue / Channels / Analytics. Sub-tab is the source of
// truth for what's rendered below the tab strip. Defaults to Channels when
// the user has zero channels (the empty state pulls them into the right
// flow), otherwise Queue.

import { useEffect, useState } from "react";
import { Calendar, Layers, BarChart3, type LucideIcon } from "lucide-react";
import { ChannelsManager } from "./ChannelsManager";
import { AnalyticsView } from "./AnalyticsView";
import { ScheduleQueue } from "../ScheduleQueue";
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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
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
        <TabButton id="channels" current={sub} setCurrent={setSub} Icon={Layers} label="Channels" />
        <TabButton id="analytics" current={sub} setCurrent={setSub} Icon={BarChart3} label="Analytics" />
      </div>

      {sub === "queue" && (
        <div className="flex flex-col gap-4">
          <ScheduleQueue />
          {hasChannels === false && (
            <div className="rounded-2xl border border-dashed border-line bg-paper-warm/40 p-5">
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
                Go to Channels →
              </button>
            </div>
          )}
        </div>
      )}

      {sub === "channels" && <ChannelsManager />}

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

