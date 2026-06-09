import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { onStageProgress, type Project, type StageName, type StageProgress } from "../lib/sidecar";
import { InvadersTrigger } from "./invaders/InvadersTrigger";

type ProgressBlob = StageProgress;

type Row = { key: StageName; label: string; runningLabel: string };

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function posterPathOf(project: Project): string | null {
  const out = project.stages.ingest?.output as { poster_path?: string | null } | undefined;
  return out?.poster_path ?? null;
}

function durationSecondsOf(project: Project): number {
  const out = project.stages.ingest?.output as { duration_seconds?: number } | undefined;
  return out?.duration_seconds ?? 0;
}

// Rough ETA factor — how much faster each stage runs than real-time on
// Intel CPU (Tiny whisper, single-pass ffmpeg). Numbers tuned from real runs;
// undershoot is better than overshoot so we round up the estimate.
const STAGE_SPEED: Record<StageName, number> = {
  ingest: 80,
  audio: 60,
  transcribe: 5,     // tiny whisper ~5× real-time on Intel
  llm: 30,           // big LLM round-trip — wall clock 5-15s, treat as fast
  cut: 8,
  reframe: 4,
  thumbs: 6,
};

function etaSeconds(stage: StageName, duration: number): number {
  if (duration <= 0) return 0;
  const factor = STAGE_SPEED[stage] ?? 5;
  return Math.max(2, Math.ceil(duration / factor));
}

// Live mm:ss countdown format — precise so it visibly decrements every second
// rather than jumping between "~5 min" and "~4 min". `tabular-nums` on the
// surrounding span keeps the digits stable as they tick down.
function formatMmSs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r.toString().padStart(2, "0")}s` : `${r}s`;
}

export function WorkingStage({
  project,
  stages,
  currentStage,
}: {
  project: Project;
  stages: Row[];
  currentStage: StageName;
}) {
  const [cancelRequested, setCancelRequested] = useState(false);
  // P1 #14 — when the cancel marker is ignored (sidecar wedged, stage about
  // to checkpoint), "Cancelling…" can sit forever. After 6s we surface a
  // visible fallback link telling the user they can force-quit.
  const [cancelStuck, setCancelStuck] = useState(false);
  const [progress, setProgress] = useState<ProgressBlob | null>(null);
  // P1 #9 — "stalled" warning. If no progress event arrives for 90s the
  // shimmer becomes a lie. Surface a muted line so the user knows we haven't
  // forgotten about them — long jobs are normal; silence isn't.
  const [stalled, setStalled] = useState(false);

  // Stage progress arrives via Tauri events the Python sidecar emits between
  // segments / clips. Previously we polled .progress.json on disk, but the
  // default fs scope can't read ~/LiquidClips/projects/* so every poll silently
  // failed and the bar never showed.
  useEffect(() => {
    let cancelled = false;
    setProgress(null);
    const unlistenPromise = onStageProgress((p) => {
      if (cancelled) return;
      if (p.stage !== currentStage) return;
      setProgress(p);
    });
    return () => {
      cancelled = true;
      void unlistenPromise.then((un) => un());
    };
  }, [currentStage]);

  // P1 #9 — stall watchdog. Resets every time we get a progress event OR
  // the stage changes; if 90s pass without either, surface the message.
  useEffect(() => {
    setStalled(false);
    const id = window.setTimeout(() => setStalled(true), 90_000);
    return () => window.clearTimeout(id);
  }, [currentStage, progress]);

  // P1 #14 — fallback for ignored cancels. Starts the 6s timer the moment the
  // user clicks Cancel; cleared if the component unmounts (parent transitions
  // away to canceled/failed/results).
  useEffect(() => {
    if (!cancelRequested) return;
    const id = window.setTimeout(() => setCancelStuck(true), 6_000);
    return () => window.clearTimeout(id);
  }, [cancelRequested]);

  async function requestCancel() {
    if (cancelRequested) return;
    setCancelRequested(true);
    // P0 #3 / #4 — tell App.tsx via window bus so the between-stage loop bails
    // before the next sidecar call. App.tsx also writes the ~/LiquidClips/
    // .lift_cancel marker for the sidecar. Both markers fire together; this
    // is the "real Cancel" path the lens calls out.
    try {
      window.dispatchEvent(new CustomEvent("lc:pipeline-cancel"));
    } catch {
      /* event constructor unavailable — non-fatal */
    }
    try {
      // Drop a .cancel marker that Python stages check between segments / clips.
      // Bypasses the blocked RPC channel — file write is instant.
      await writeTextFile(`${project.root}/.cancel`, "1");
    } catch (e) {
      console.warn("cancel write failed:", e);
    }
  }
  const [elapsed, setElapsed] = useState(0);
  // tickNow drives the live countdown — separate from elapsed (250ms) so the
  // mm:ss display only refreshes when the second changes.
  const [tickNow, setTickNow] = useState(() => Date.now());
  const startedAt = project.stages[currentStage]?.started_at ?? null;

  useEffect(() => {
    if (!startedAt) {
      setElapsed(0);
      setTickNow(Date.now());
      return;
    }
    const start = startedAt * 1000;
    const tick = () => {
      setElapsed((Date.now() - start) / 1000);
      setTickNow(Date.now());
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [startedAt]);

  // Adaptive ETA: when a stage emits processed/total (cut/reframe/thumbs do per
  // clip; transcribe per audio second), compute remaining = (total-processed) /
  // measured_rate so the countdown reflects ACTUAL machine speed instead of a
  // pre-baked guess. Recomputed on stage change OR a new progress event so the
  // countdown ticks smoothly between rate corrections.
  const [etaCompleteAt, setEtaCompleteAt] = useState<number | null>(null);
  useEffect(() => {
    if (!startedAt) {
      setEtaCompleteAt(null);
      return;
    }
    const elapsedInStage = Math.max(0.5, Date.now() / 1000 - startedAt);
    let remainingSeconds: number | null = null;
    if (
      progress &&
      progress.stage === currentStage &&
      progress.total_seconds > 0 &&
      progress.processed_seconds > 0
    ) {
      const rate = progress.processed_seconds / elapsedInStage;
      if (rate > 0) {
        remainingSeconds = Math.max(
          0,
          (progress.total_seconds - progress.processed_seconds) / rate,
        );
      }
    }
    if (remainingSeconds === null) {
      const duration = durationSecondsOf(project);
      if (duration) {
        const est = etaSeconds(currentStage, duration);
        remainingSeconds = Math.max(0, est - elapsedInStage);
      }
    }
    setEtaCompleteAt(
      remainingSeconds === null ? null : Date.now() + remainingSeconds * 1000,
    );
  }, [startedAt, currentStage, progress, project]);

  const currentIdx = stages.findIndex((s) => s.key === currentStage);
  const poster = posterPathOf(project);

  return (
    <div className="library-card w-full max-w-[860px] bg-transparent p-6">
      <span className="library-card-corner-tl" aria-hidden="true" />
      <span className="library-card-corner-tr" aria-hidden="true" />
      <span className="library-card-corner-bl" aria-hidden="true" />
      <span className="library-card-corner-br" aria-hidden="true" />
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        {poster && (
          <div className="cockpit-frame aspect-video w-full overflow-hidden rounded-2xl bg-transparent sm:w-[280px] sm:shrink-0">
            <span className="cockpit-tile-corner-tl" aria-hidden="true" />
            <span className="cockpit-tile-corner-tr" aria-hidden="true" />
            <span className="cockpit-tile-corner-bl" aria-hidden="true" />
            <span className="cockpit-tile-corner-br" aria-hidden="true" />
            <img src={convertFileSrc(poster)} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
            working
          </div>
          <h2 className="mt-2 font-display text-[28px] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
            {project.source_filename}
          </h2>
          <p className="mt-1 break-all font-mono text-[11px] text-text-tertiary">{project.root}</p>
        </div>
      </div>

      <ul className="mt-8 space-y-3 font-mono text-[14px]">
        {stages.map((stage, idx) => {
          const state = project.stages[stage.key];
          const status = state?.status ?? "pending";
          const isCurrent = idx === currentIdx;

          if (status === "done") {
            return (
              <li key={stage.key} className="flex items-center gap-3 text-fuchsia-bright">
                <span>✓</span>
                <span>{stage.label}</span>
              </li>
            );
          }
          if (status === "failed") {
            return (
              <li key={stage.key} className="flex items-center gap-3 text-[var(--color-danger)]">
                <span>×</span>
                <span>{stage.label} — failed</span>
              </li>
            );
          }
          if (isCurrent) {
            const showProgress =
              progress && progress.stage === stage.key && progress.total_seconds > 0;
            const pct = showProgress
              ? Math.min(100, Math.round((progress!.processed_seconds / progress!.total_seconds) * 100))
              : null;
            const countLabel = showProgress
              ? stage.key === "transcribe"
                ? `${Math.floor(progress!.processed_seconds)}s / ${Math.floor(progress!.total_seconds)}s`
                : `${Math.round(progress!.processed_seconds)} / ${Math.round(progress!.total_seconds)} clips`
              : null;
            return (
              <li key={stage.key} className="flex flex-col gap-2 text-ink">
                <div className="flex items-center gap-3">
                  <span className="text-fuchsia">›</span>
                  <span>
                    {stage.runningLabel}
                    <span className="blink ml-1 text-fuchsia">_</span>
                  </span>
                  {pct !== null && (
                    <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fuchsia-deep">
                      {pct}%
                    </span>
                  )}
                  {countLabel && (
                    <span className="ml-2 font-mono text-[11px] text-text-tertiary">
                      · {countLabel}
                    </span>
                  )}
                </div>
                {pct !== null && (
                  <>
                    <div className="ml-6 h-1.5 w-[440px] max-w-full overflow-hidden rounded-full bg-paper-elev/60">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          background: "var(--grad-fuchsia)",
                          boxShadow: "var(--glow-sm)",
                        }}
                      />
                    </div>
                    {progress!.last_text && (
                      <p className="ml-6 max-w-[640px] truncate font-mono text-[11px] italic text-text-tertiary">
                        "{progress!.last_text}"
                      </p>
                    )}
                  </>
                )}
                {pct === null && (
                  <>
                    <div className="ml-6 h-1.5 w-[440px] max-w-full overflow-hidden rounded-full bg-paper-elev/60">
                      <div className="working-stage-shimmer h-full w-1/3 rounded-full" />
                    </div>
                    {/* P1 #9 — stalled message. 90s with no progress event
                        means the shimmer alone reads as a lie; tell the user
                        we still expect this to finish. */}
                    {stalled && (
                      <p className="ml-6 font-mono text-[11px] italic text-text-tertiary">
                        Still working — this is taking longer than usual.
                      </p>
                    )}
                  </>
                )}
              </li>
            );
          }
          return (
            <li key={stage.key} className="flex items-center gap-3 text-text-tertiary">
              <span>○</span>
              <span>{stage.label}</span>
            </li>
          );
        })}
      </ul>

      <div className="mt-10 flex flex-wrap items-center gap-4 font-mono text-[12px] text-text-secondary">
        <span className="tabular-nums">Elapsed {formatElapsed(elapsed)}</span>
        <span>·</span>
        <span>{currentIdx + 1} / {stages.length}</span>
        <div className="ml-auto flex items-center gap-2">
          <InvadersTrigger />
          <button
            onClick={requestCancel}
            disabled={cancelRequested}
            className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary transition-colors hover:border-[var(--color-danger)] hover:text-[var(--color-danger)] disabled:opacity-50"
          >
            {cancelRequested ? "Cancelling…" : "Cancel"}
          </button>
        </div>
        {etaCompleteAt !== null && (
          <>
            <span>·</span>
            <span className="text-fuchsia-deep tabular-nums">
              {tickNow >= etaCompleteAt
                ? "wrapping up…"
                : `${formatMmSs(etaCompleteAt - tickNow)} remaining`}
            </span>
          </>
        )}
      </div>
      {/* P1 #14 — fallback when the cancel marker is ignored. After 6s of
          "Cancelling…" the user gets a visible escape hatch. We can't actually
          force-quit from JS — but telling them they can is better than the
          button sitting forever in a faux-loading state. */}
      {cancelRequested && cancelStuck && (
        <p className="mt-3 font-mono text-[11px] text-text-tertiary">
          Couldn&apos;t stop — force-quit Liquid Clips if needed.
        </p>
      )}
    </div>
  );
}
