import { useEffect, useState } from "react";
import { sidecar, humanError, type Project } from "../lib/sidecar";

// Tile at the end of the clips grid. Tap → trim-by-timestamps dialog. Sends
// the bounds to the sidecar's add_clip RPC which ffmpegs a slice from the
// project's original source. Only renders on paid tiers — gated by parent.

export function AddClipCard({
  project,
  onProjectChange,
}: {
  project: Project;
  onProjectChange: (p: Project) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="group flex aspect-[3/5] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line bg-paper-warm/30 p-4 transition-all hover:border-fuchsia hover:bg-fuchsia-soft/20 hover:shadow-[0_8px_28px_rgba(255,26,140,0.12)]"
      >
        <div className="grid h-14 w-14 place-items-center rounded-full border border-line bg-paper font-display text-[28px] font-light text-fuchsia transition-colors group-hover:border-fuchsia group-hover:bg-fuchsia group-hover:text-white">
          +
        </div>
        <div className="text-center">
          <div className="font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">
            Add a clip
          </div>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
            from the same source
          </p>
        </div>
      </button>
      {open && (
        <AddClipDialog
          project={project}
          onClose={() => setOpen(false)}
          onAdded={(p) => {
            onProjectChange(p);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function AddClipDialog({
  project,
  onClose,
  onAdded,
}: {
  project: Project;
  onClose: () => void;
  onAdded: (p: Project) => void;
}) {
  const sourceDuration =
    (project.stages.ingest?.output as { duration_seconds?: number } | undefined)?.duration_seconds ??
    0;
  const [startHms, setStartHms] = useState("0:00");
  const [endHms, setEndHms] = useState("0:30");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const startS = parseHms(startHms);
  const endS = parseHms(endHms);
  const duration = endS - startS;
  const durationOk = duration >= 5 && duration <= 180;
  const boundsOk = sourceDuration === 0 || endS <= sourceDuration + 0.1;

  async function submit() {
    if (!durationOk) {
      setError("Clip must be between 5 and 180 seconds.");
      return;
    }
    if (!boundsOk) {
      setError("End is past the source video.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await sidecar.addClip(project.slug, startS, endS, title.trim() || "Manual clip");
      onAdded(r.project);
    } catch (e) {
      setError(humanError(e));
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/95 p-6 backdrop-blur-md"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="flex w-full max-w-[480px] flex-col gap-5 rounded-2xl bg-paper p-7 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
          add a clip
        </div>

        <h2 className="font-display text-[26px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink">
          Pick the bit Liquid Clips missed.
        </h2>

        {sourceDuration > 0 && (
          <p className="-mt-2 font-mono text-[11px] text-text-tertiary">
            Source is {formatHms(sourceDuration)} long.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              Start
            </span>
            <input
              value={startHms}
              onChange={(e) => setStartHms(e.target.value)}
              placeholder="0:00"
              className="rounded-lg border border-line bg-paper-warm/40 px-3.5 py-2.5 font-mono text-[14px] text-ink focus:border-fuchsia focus:outline-none focus:ring-2 focus:ring-fuchsia/20"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              End
            </span>
            <input
              value={endHms}
              onChange={(e) => setEndHms(e.target.value)}
              placeholder="0:30"
              className="rounded-lg border border-line bg-paper-warm/40 px-3.5 py-2.5 font-mono text-[14px] text-ink focus:border-fuchsia focus:outline-none focus:ring-2 focus:ring-fuchsia/20"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            Title
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What's the hook?"
            maxLength={120}
            className="rounded-lg border border-line bg-paper-warm/40 px-3.5 py-2.5 font-sans text-[14px] text-ink focus:border-fuchsia focus:outline-none focus:ring-2 focus:ring-fuchsia/20"
          />
        </label>

        <div className="rounded-lg bg-paper-warm/40 px-3 py-2 font-mono text-[11px] text-text-secondary">
          Duration <span className="text-ink">{duration > 0 ? `${duration.toFixed(1)}s` : "—"}</span>
          {!durationOk && duration > 0 && (
            <span className="ml-2 text-[#DC2626]">5–180s only</span>
          )}
        </div>

        {error && <p className="font-mono text-[12px] text-[#DC2626]">{error}</p>}

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-line bg-paper px-5 py-2.5 font-sans text-[14px] font-medium text-ink hover:border-fuchsia disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !durationOk || !boundsOk}
            className="rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[14px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)] disabled:opacity-50"
          >
            {busy ? "Cutting…" : "Cut clip →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// "1:23.5" / "1:23" / "83" all valid.
function parseHms(input: string): number {
  const s = input.trim();
  if (!s) return 0;
  const parts = s.split(":").map((p) => parseFloat(p));
  if (parts.some((p) => Number.isNaN(p))) return 0;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function formatHms(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
