import { useEffect, useMemo, useState } from "react";
import { sidecar, humanError, type DripSlot, type Project } from "../lib/sidecar";
import { PlatformIcon, type PlatformId } from "./PlatformIcon";

// Spec §1.5 preview calendar — 14-day grid (or 7/21/28 depending on weeks
// picker), each clip as a card under its day column at platform-icon row.
// User can change weeks ▾ ; "Reset to optimal" recomputes the plan.

type Weeks = 1 | 2 | 3 | 4;

const KNOWN_PLATFORMS: PlatformId[] = ["youtube", "tiktok", "instagram", "x"];

// Monochrome platform mark — shared PlatformIcon glyph set (no emoji). Falls
// back to a neutral bullet for anything unrecognised.
function PlatformGlyph({ platform }: { platform: string }) {
  if ((KNOWN_PLATFORMS as string[]).includes(platform)) {
    return <PlatformIcon id={platform as PlatformId} className="h-3 w-3" />;
  }
  return <span aria-hidden>•</span>;
}

export function DripCalendar({
  project,
  onClose,
  onConfirm,
}: {
  project: Project;
  onClose: () => void;
  onConfirm: (slots: DripSlot[]) => Promise<void>;
}) {
  const [weeks, setWeeks] = useState<Weeks>(2);
  const [slots, setSlots] = useState<DripSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Best-effort user-TZ offset relative to UTC.
  const tzOffset = useMemo(() => -new Date().getTimezoneOffset() / 60, []);

  useEffect(() => {
    let cancelled = false;
    setSlots(null);
    setError(null);
    sidecar
      .dripPlan(project.slug, weeks, tzOffset)
      .then((r) => {
        if (!cancelled) setSlots(r.slots);
      })
      .catch((e) => {
        if (!cancelled) setError(humanError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [project.slug, weeks, tzOffset]);

  async function confirm() {
    if (!slots || slots.length === 0) return;
    setBusy(true);
    try {
      await onConfirm(slots);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  const days = weeks * 7;
  const dayBuckets = useMemo(() => {
    if (!slots) return [];
    const start = new Date(slots[0]?.scheduled_for ?? new Date().toISOString());
    start.setHours(0, 0, 0, 0);
    const buckets: { date: Date; entries: DripSlot[] }[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      buckets.push({ date: d, entries: [] });
    }
    for (const slot of slots) {
      const dt = new Date(slot.scheduled_for);
      const idx = Math.floor((dt.getTime() - start.getTime()) / 86400000);
      if (idx >= 0 && idx < buckets.length) buckets[idx].entries.push(slot);
    }
    return buckets;
  }, [slots, days]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-paper/95 p-6 backdrop-blur-md" onClick={onClose}>
      <div
        className="flex h-full max-h-[92vh] w-full max-w-[1240px] flex-col overflow-hidden rounded-2xl bg-paper shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
              drip across
            </div>
            <h2 className="mt-1 font-display text-[24px] font-semibold tracking-[-0.02em] text-ink">
              {project.clips.length} clips · {weeks} week{weeks === 1 ? "" : "s"} · auto-distributed
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {([1, 2, 3, 4] as Weeks[]).map((w) => (
              <button
                key={w}
                onClick={() => setWeeks(w)}
                className={`rounded-full px-4 py-1.5 font-mono text-[12px] uppercase tracking-[0.08em] transition-colors ${
                  weeks === w ? "bg-fuchsia text-white" : "border border-line text-text-secondary hover:border-fuchsia hover:text-ink"
                }`}
              >
                {w}w
              </button>
            ))}
            <button
              onClick={onClose}
              className="ml-2 rounded-full border border-line bg-paper px-4 py-1.5 font-mono text-[11px] text-text-secondary hover:border-fuchsia hover:text-ink"
            >
              Close
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-6">
          {error && (
            <p className="mb-4 font-mono text-[12px] text-[#DC2626]">{error}</p>
          )}
          {!slots && !error && (
            <p className="font-mono text-[12px] text-text-tertiary">
              Planning the drip<span className="blink">_</span>
            </p>
          )}
          {slots && (
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${Math.min(7, days)}, minmax(0, 1fr))` }}
            >
              {dayBuckets.map((b, i) => (
                <DayColumn key={i} date={b.date} entries={b.entries} />
              ))}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-line px-6 py-4">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            {slots ? `${slots.length} clips queued · platforms rotate · 1-2 per day` : "—"}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setWeeks(weeks)}
              className="rounded-full border border-line bg-paper px-5 py-2.5 font-sans text-[14px] font-medium text-ink hover:border-fuchsia"
            >
              Reset to optimal
            </button>
            <button
              onClick={confirm}
              disabled={!slots || busy}
              className="rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[14px] font-medium text-white hover:bg-fuchsia-bright hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)] disabled:opacity-50"
            >
              {busy ? "Scheduling…" : `Schedule all ${slots?.length ?? 0} →`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function DayColumn({ date, entries }: { date: Date; entries: DripSlot[] }) {
  const dayLabel = date.toLocaleDateString(undefined, { weekday: "short" });
  const dateLabel = date.getDate();
  return (
    <div className="flex min-h-[300px] flex-col rounded-2xl border border-line bg-paper-warm/40 p-3">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">{dayLabel}</span>
        <span className="font-display text-[18px] font-bold tracking-[-0.02em] text-ink">{dateLabel}</span>
      </div>
      <div className="flex flex-col gap-2">
        {entries.map((slot) => (
          <SlotCard key={`${slot.clip_idx}-${slot.platform}`} slot={slot} />
        ))}
        {entries.length === 0 && (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">—</span>
        )}
      </div>
    </div>
  );
}

function SlotCard({ slot }: { slot: DripSlot }) {
  const t = new Date(slot.scheduled_for);
  const hh = t.getHours().toString().padStart(2, "0");
  const mm = t.getMinutes().toString().padStart(2, "0");
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-line bg-paper p-2">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
        <span className="inline-flex items-center text-fuchsia">
          <PlatformGlyph platform={slot.platform} />
        </span>
        <span>{slot.platform}</span>
        <span className="ml-auto">{hh}:{mm}</span>
      </div>
      <div className="line-clamp-2 font-sans text-[11px] leading-snug text-ink">{slot.clip_title}</div>
    </div>
  );
}
