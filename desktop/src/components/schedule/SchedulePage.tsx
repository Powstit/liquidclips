// Top-level Schedule page (Daniel's call 2026-06-02).
//
// Surfaces the existing ScheduleQueue (which until now only lived as a
// secondary section inside the Upload tab) as a first-class destination in
// the main nav. Users get one place to see every queued / scheduled / live /
// failed post across all their clips.
//
// Drip planning per-project still lives in the ResultsGrid "Drip" flow that
// opens DripCalendar — this page is the AFTER view (what's queued), not the
// authoring view (planning a new drip).

import { Calendar, Sparkles } from "lucide-react";
import { ScheduleQueue } from "../ScheduleQueue";

export function SchedulePage({
  onOpenWorkspace,
}: {
  onOpenWorkspace: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          <Calendar size={11} className="text-fuchsia" />
          your queue
        </div>
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Scheduled posts.
        </h1>
        <p className="font-sans text-[14px] leading-relaxed text-text-secondary">
          Everything you've queued for later — across clips, platforms, drip plans. Posts fire automatically via Ayrshare at the scheduled time. Cancel anything before it goes live.
        </p>
      </header>

      <ScheduleQueue />

      <div className="rounded-2xl border border-dashed border-line bg-paper-warm/40 p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fuchsia text-paper">
            <Sparkles size={14} strokeWidth={2.5} />
          </span>
          <div className="flex-1">
            <p className="font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">
              Want to plan a 14-day drip?
            </p>
            <p className="mt-1 font-sans text-[13px] leading-relaxed text-text-secondary">
              Open a project from the Workspace → click the <strong>Drip</strong> button in the results header. Liquid Lift auto-spaces your clips across the next 2 weeks at peak-engagement times per platform.
            </p>
            <button
              onClick={onOpenWorkspace}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 font-sans text-[12px] font-medium text-paper hover:bg-fuchsia"
            >
              Open Workspace →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
