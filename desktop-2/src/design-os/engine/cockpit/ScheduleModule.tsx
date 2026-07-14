/**
 * ScheduleModule · cockpit · UI-2 + BUG-038 honest-stub
 *
 * All controls remain interactive enough to persist a customer's draft
 * (date/time/lane/repeat round-trip through clipSettingsStore — Patch A),
 * but the module is honest about not reaching a scheduler. The single
 * source of truth is `deriveSchedulePromise()` — PublishModule's
 * "Schedule +1h" button reads from the same function.
 *
 * The previous FAKE-toast "Queued" path has been REMOVED. The "Queue"
 * button is disabled with a visible "Coming soon" affordance.
 */

import { useState } from "react";
import { bus } from "../../bridge";
import { useChannels } from "../../state/useChannels";
import { useEngineSession } from "../../state/useEngineSession";
import { useSchedule } from "../../state/useSchedule";
import {
  isUploadableVideoPath,
  requestAssistedSchedulePermission,
} from "../../schedule/assistedSchedule";
import { readExportPath } from "../../schedule/exportPathStore";
import { useCockpit, type ScheduleLane, type ScheduleRepeat } from "./CockpitContext";
import { deriveSchedulePromise } from "./scheduleStatus";
import "./modules.css";

const LANES: ReadonlyArray<{ id: ScheduleLane; label: string }> = [
  { id: "tiktok",    label: "TikTok" },
  { id: "youtube",   label: "YouTube" },
  { id: "instagram", label: "Instagram" },
  { id: "x",         label: "X" },
];

const REPEAT: ReadonlyArray<{ id: ScheduleRepeat; label: string }> = [
  { id: "none",   label: "Once" },
];

export function ScheduleModule({ outputPathOverride }: { outputPathOverride?: string }) {
  const { focusedClip, settings, setSchedule } = useCockpit();
  const { date, time, lane, repeat } = settings.schedule;
  const promise = deriveSchedulePromise();
  const channels = useChannels();
  const scheduler = useSchedule();
  const session = useEngineSession();
  const [queueing, setQueueing] = useState(false);
  const slug = session.project?.slug ?? session.slug ?? "";
  const outputPath = outputPathOverride
    ?? focusedClip.vertical_path
    ?? focusedClip.cut_path
    ?? readExportPath(slug, focusedClip.idx)
    ?? "";
  const target = channels.asTargetAccounts.find((account) => (
    account.platform === lane &&
    (account.state === "connected" || account.state === "active-target")
  ));
  const canQueue = (
    promise.available &&
    !queueing &&
    !!date &&
    !!time &&
    !!slug &&
    isUploadableVideoPath(outputPath) &&
    !!target
  );

  const queueReminder = async () => {
    if (!canQueue || !target) return;
    setQueueing(true);
    try {
      await requestAssistedSchedulePermission();
      const created = await scheduler.scheduleClip({
        clipId: `clip-${focusedClip.idx}`,
        clipTitle: focusedClip.title,
        projectSlug: slug,
        targetAccountIds: [target.id],
        accounts: [{
          id: target.id,
          platform: target.platform,
          label: target.label,
          handle: target.handle,
        }],
        outputPath,
        scheduledFor: new Date(`${date}T${time}`).toISOString(),
        captionOverride: settings.caption.text.trim() || undefined,
      });
      if (created.length > 0) {
        // 2026-07-14 · Post-RC1 paid-beta fix (Daniel greenlit).
        // Removed the previous `bus.emit("nav:click", "schedule")` here.
        // That side-effect force-navigated the customer OUT of the
        // Workstation route as a side-effect of a background scheduling
        // action, which unmounted the entire cockpit subtree and dropped
        // the customer's open editor + focused clip. Confirmed root cause
        // of the full-clipping-journey step-12 flake (Path C trace shows
        // provider unmount at the emit timestamp). The customer already
        // sees the schedule module they were interacting with; a toast
        // is the honest confirmation, and the sidebar Schedule button
        // remains one click away for anyone who wants the top-level
        // Schedule surface.
        bus.emit("toast", {
          kind: "success",
          title: "Reminder set",
          body: "You'll get a nudge when it's time to post.",
          ttl: 4_000,
        });
      }
    } finally {
      setQueueing(false);
    }
  };

  const blockedCopy = !isUploadableVideoPath(outputPath)
    ? "Render this clip before scheduling."
    : !target
      ? `Connect a ${LANES.find((item) => item.id === lane)?.label} account first.`
      : !date || !time
        ? "Choose a date and time."
        : !slug
          ? "Open a project before scheduling."
          : promise.copy;

  return (
    <section
      className="lc-cd-mod"
      data-testid="schedule-block"
      data-schedule-available={String(promise.available)}
      data-schedule-state={promise.state}
    >
      <div>
        <header className="lc-cd-mod-head">
          <span className="lc-cd-mod-eb">
            Schedule
            <span
              data-testid="schedule-status-badge"
              style={{
                marginLeft: 8,
                fontSize: 9,
                letterSpacing: ".15em",
                padding: "2px 6px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,.18)",
                color: "rgba(255,255,255,.66)",
                textTransform: "uppercase",
              }}
            >
              {promise.badge}
            </span>
          </span>
          <span className="lc-cd-mod-sub" data-testid="schedule-copy">{promise.copy}</span>
        </header>

        {/* Draft settings persist per clip. Queue writes a real local
            reminder only when a rendered file and connected target exist. */}
        <div className="lc-cd-section">
          <div className="lc-cd-row">
            <div className="lc-cd-section" style={{ flex: 1 }}>
              <span className="lc-cd-lbl">Date</span>
              <input
                className="lc-cd-input"
                data-testid="schedule-date"
                type="date"
                value={date}
                onChange={(e) => setSchedule({ date: e.target.value })}
              />
            </div>
            <div className="lc-cd-section" style={{ flex: 1 }}>
              <span className="lc-cd-lbl">Time</span>
              <input
                className="lc-cd-input"
                data-testid="schedule-time"
                type="time"
                value={time}
                onChange={(e) => setSchedule({ time: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="lc-cd-section" style={{ marginTop: 14 }}>
          <span className="lc-cd-lbl">Lane</span>
          <div className="lc-cd-row" role="radiogroup" aria-label="Schedule lane">
            {LANES.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                data-testid={`schedule-lane-${l.id}`}
                aria-checked={lane === l.id}
                className={`lc-cd-chip ${lane === l.id ? "on" : ""}`}
                onClick={() => setSchedule({ lane: l.id })}
              >{l.label}</button>
            ))}
          </div>
        </div>

        <div className="lc-cd-section" style={{ marginTop: 14 }}>
          <span className="lc-cd-lbl">Repeat</span>
          <div className="lc-cd-row" role="radiogroup" aria-label="Schedule repeat">
            {REPEAT.map((r) => (
              <button
                key={r.id}
                type="button"
                role="radio"
                data-testid={`schedule-repeat-${r.id}`}
                aria-checked={repeat === r.id}
                className={`lc-cd-chip ${repeat === r.id ? "on" : ""}`}
                onClick={() => setSchedule({ repeat: r.id })}
              >{r.label}</button>
            ))}
          </div>
        </div>

        <div className="lc-cd-row" style={{ marginTop: 18 }}>
          <button
            type="button"
            data-testid="schedule-queue"
            className="lc-cd-primary"
            disabled={!canQueue}
            aria-disabled={!canQueue}
            title={canQueue ? undefined : blockedCopy}
            onClick={() => { void queueReminder(); }}
          >
            {queueing
              ? "Setting reminder…"
              : `Remind me · ${LANES.find((l) => l.id === lane)?.label}`}
          </button>
          <button
            type="button"
            data-testid="schedule-clear"
            className="lc-cd-ghost"
            onClick={() => setSchedule({ date: "", time: "" })}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="lc-cd-readout" aria-label="Schedule summary">
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Next launch</span>
          <span className="lc-cd-readout-val">{summarize(date, time)}</span>
        </div>
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Lane</span>
          <span className="lc-cd-readout-val">{LANES.find((l) => l.id === lane)?.label}</span>
        </div>
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Repeat</span>
          <span className="lc-cd-readout-val">{REPEAT.find((r) => r.id === repeat)?.label}</span>
        </div>
      </div>
    </section>
  );
}

function summarize(date: string, time: string): string {
  if (!date || !time) return "Not set";
  return `${date} · ${time}`;
}
