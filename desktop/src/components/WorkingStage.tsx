import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { onStageProgress, type Project, type StageName, type StageProgress } from "../lib/sidecar";
import transcribeIcon from "../assets/pipeline/transcribe.png";
import cutIcon from "../assets/pipeline/cut.png";
import reframeIcon from "../assets/pipeline/reframe.png";
import thumbsIcon from "../assets/pipeline/thumbs.png";

type ProgressBlob = StageProgress;

// The four craft stages have generated marks (A10); ingest/audio/llm are
// plumbing and render as a quiet dot, giving the rail a natural hierarchy.
const STAGE_ICON: Partial<Record<StageName, string>> = {
  transcribe: transcribeIcon,
  cut: cutIcon,
  reframe: reframeIcon,
  thumbs: thumbsIcon,
};

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

function formatEta(seconds: number): string {
  if (seconds < 60) return `~${seconds}s`;
  const m = Math.ceil(seconds / 60);
  return `~${m} min`;
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
  const [progress, setProgress] = useState<ProgressBlob | null>(null);

  // Stage progress arrives via Tauri events the Python sidecar emits between
  // segments / clips. Previously we polled .progress.json on disk, but the
  // default fs scope can't read ~/Junior/projects/* so every poll silently
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

  async function requestCancel() {
    if (cancelRequested) return;
    setCancelRequested(true);
    try {
      // Drop a .cancel marker that Python stages check between segments / clips.
      // Bypasses the blocked RPC channel — file write is instant.
      await writeTextFile(`${project.root}/.cancel`, "1");
    } catch (e) {
      console.warn("cancel write failed:", e);
    }
  }
  const [elapsed, setElapsed] = useState(0);
  const startedAt = project.stages[currentStage]?.started_at ?? null;

  useEffect(() => {
    if (!startedAt) {
      setElapsed(0);
      return;
    }
    const start = startedAt * 1000;
    const tick = () => setElapsed((Date.now() - start) / 1000);
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const currentIdx = stages.findIndex((s) => s.key === currentStage);
  const poster = posterPathOf(project);

  return (
    <div className="w-full max-w-[860px]">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        {poster && (
          <div className="aspect-video w-full overflow-hidden rounded-2xl border border-line bg-paper-warm sm:w-[280px] sm:shrink-0">
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

      <ul className="mt-8 space-y-2.5">
        {stages.map((stage, idx) => {
          const state = project.stages[stage.key];
          const status = state?.status ?? "pending";
          const isCurrent = idx === currentIdx;
          const done = status === "done";
          const failed = status === "failed";
          const icon = STAGE_ICON[stage.key];

          const showProgress =
            isCurrent && progress && progress.stage === stage.key && progress.total_seconds > 0;
          const pct = showProgress
            ? Math.min(100, Math.round((progress!.processed_seconds / progress!.total_seconds) * 100))
            : null;
          const countLabel = showProgress
            ? stage.key === "transcribe"
              ? `${Math.floor(progress!.processed_seconds)}s / ${Math.floor(progress!.total_seconds)}s`
              : `${Math.round(progress!.processed_seconds)} / ${Math.round(progress!.total_seconds)} clips`
            : null;

          const chipCls = failed
            ? "border-[#DC2626] bg-paper"
            : isCurrent
              ? "border-fuchsia bg-paper shadow-[var(--glow-md)]"
              : done
                ? "border-fuchsia/30 bg-fuchsia-soft/30"
                : "border-line bg-paper-warm opacity-50";
          const labelCls = failed
            ? "text-[#DC2626]"
            : isCurrent
              ? "text-ink"
              : done
                ? "text-fuchsia-deep"
                : "text-text-tertiary";

          return (
            <li key={stage.key} className="flex items-start gap-3">
              <div
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition-all duration-300 ${chipCls}`}
              >
                {icon ? (
                  <img
                    src={icon}
                    alt=""
                    className={`h-6 w-6 object-contain transition-opacity ${isCurrent || done ? "opacity-100" : "opacity-60"}`}
                  />
                ) : (
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${isCurrent || done ? "bg-fuchsia" : "bg-text-tertiary"}`}
                  />
                )}
              </div>
              <div className="min-w-0 flex-1 pt-1.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[14px]">
                  <span className={labelCls}>
                    {isCurrent ? stage.runningLabel : failed ? `${stage.label} — failed` : stage.label}
                    {isCurrent && <span className="blink ml-1 text-fuchsia">_</span>}
                  </span>
                  {pct !== null && (
                    <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-fuchsia-deep">
                      {pct}%
                    </span>
                  )}
                  {countLabel && (
                    <span className="font-mono text-[11px] text-text-tertiary">· {countLabel}</span>
                  )}
                </div>
                {pct !== null && (
                  <>
                    <div className="mt-2 h-1 w-[440px] max-w-full overflow-hidden rounded-full bg-line">
                      <div
                        className="h-full bg-fuchsia transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {progress!.last_text && (
                      <p className="mt-1 max-w-[640px] truncate font-mono text-[11px] italic text-text-tertiary">
                        "{progress!.last_text}"
                      </p>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-10 flex flex-wrap items-center gap-4 font-mono text-[12px] text-text-secondary">
        <span>Elapsed {formatElapsed(elapsed)}</span>
        <span>·</span>
        <span>{currentIdx + 1} / {stages.length}</span>
        <button
          onClick={requestCancel}
          disabled={cancelRequested}
          className="ml-auto rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary transition-colors hover:border-[#DC2626] hover:text-[#DC2626] disabled:opacity-50"
        >
          {cancelRequested ? "Cancelling…" : "Cancel"}
        </button>
        {(() => {
          const duration = durationSecondsOf(project);
          const eta = etaSeconds(currentStage, duration);
          if (!duration || !eta) return null;
          return (
            <>
              <span>·</span>
              <span className="text-fuchsia-deep">
                {formatEta(eta)} {currentStage === "transcribe" ? `for ${Math.ceil(duration / 60)} min of audio` : "for this step"}
              </span>
            </>
          );
        })()}
      </div>
    </div>
  );
}
