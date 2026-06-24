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
  { id: "daily",  label: "Daily" },
  { id: "weekly", label: "Weekly" },
];

export function ScheduleModule() {
  const { settings, setSchedule } = useCockpit();
  const { date, time, lane, repeat } = settings.schedule;
  const promise = deriveSchedulePromise();

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
              data-testid="schedule-coming-soon-badge"
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

        {/* Controls remain interactive so the customer's draft survives
            clip-switch (Patch A round-trip). The honest "Queue" button
            below is disabled — no fake toast can fire. */}
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
            disabled={!promise.available}
            aria-disabled={!promise.available}
            title={promise.available ? undefined : promise.copy}
          >
            {promise.available
              ? `Queue on ${LANES.find((l) => l.id === lane)?.label}`
              : "Queue · coming soon"}
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
