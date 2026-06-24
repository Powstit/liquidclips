/**
 * ExportProgress · Phase 6H H-8
 *
 * Active export progress strip + history table. Reads from the engine
 * session bus (engine:progress { stage: "export" }) and the export-stub
 * history. Wraps the AllowanceBar primitive for live progress.
 */

import { useEffect, useState } from "react";
import { GlassCard, AllowanceBar } from "../components";
import { useEngineSession } from "../state/useEngineSession";
import { exportApi } from "../engine/sidecar-stub";
import type { ExportJob } from "./types";
import { bus } from "../bridge";
import "./ExportProgress.css";

export interface ExportProgressProps {
  /** Show the per-row history table beneath the live progress. */
  showHistory?: boolean;
}

export function ExportProgress({ showHistory = true }: ExportProgressProps) {
  const session = useEngineSession();
  const [history, setHistory] = useState<ExportJob[]>([]);

  // Hydrate history
  useEffect(() => {
    let cancelled = false;
    void exportApi.listHistory().then((r) => {
      if (!cancelled) setHistory(r.jobs);
    });
    return () => { cancelled = true; };
  }, [session.phase]);

  const isRunning = session.phase === "running" && session.stage === "export";
  const isComplete = session.phase === "complete";
  const isError = session.phase === "error";

  const pct = isRunning && session.percent != null ? Math.round(session.percent * 100) : 0;

  return (
    <div className="lc-exp-progress">
      {/* Live progress card */}
      <GlassCard density="default" className="lc-exp-prog-card">
        <header className="lc-exp-prog-head">
          <div>
            <span className="lc-exp-prog-eb">Render queue</span>
            <span className="lc-exp-prog-status">
              {isRunning  && "Rendering…"}
              {isComplete && "Complete · ready to ship"}
              {isError    && "Render failed"}
              {!isRunning && !isComplete && !isError && "Idle · no active export"}
            </span>
          </div>
          {isRunning && (
            <button
              type="button"
              className="lc-exp-prog-cancel"
              onClick={async () => {
                await exportApi.cancelExport();
                bus.emit("toast", { kind: "info", title: "Export", body: "Cancel signalled." });
              }}
            >
              Cancel
            </button>
          )}
        </header>

        {(isRunning || isComplete) && (
          <AllowanceBar
            state={isComplete ? "healthy" : isRunning ? "low" : "empty"}
            used={isComplete ? 100 : pct}
            total={100}
            label={isComplete ? "Done" : (session.note ?? `${pct}%`)}
          />
        )}

        {isError && session.error && (
          <p className="lc-exp-prog-err">
            {session.error.human ?? session.error.message}
          </p>
        )}
      </GlassCard>

      {/* History */}
      {showHistory && history.length > 0 && (
        <GlassCard density="default" className="lc-exp-hist-card">
          <header className="lc-exp-hist-head">
            <span className="lc-exp-eb">Recent exports</span>
            <span className="lc-exp-hist-sub">{history.length}</span>
          </header>
          <ul className="lc-exp-hist-list">
            {history.slice(0, 6).map((job) => (
              <li key={job.id} className="lc-exp-hist-row">
                <span className={`lc-exp-hist-status lc-exp-hist-status-${job.status}`}>
                  {job.status}
                </span>
                <span className="lc-exp-hist-title" title={job.clipTitle}>{job.clipTitle}</span>
                <span className="lc-exp-hist-format">{job.format} · {job.preset}</span>
                {job.watermark && <span className="lc-exp-hist-wm">watermark</span>}
                <span className="lc-exp-hist-time">{relTime(job.createdAt)}</span>
                {job.outputPath && (
                  <button
                    type="button"
                    className="lc-exp-hist-action"
                    onClick={() => void exportApi.revealInFinder(job.outputPath!)}
                    title="Reveal in Finder"
                  >
                    Reveal
                  </button>
                )}
                {job.outputPath && (
                  <button
                    type="button"
                    className="lc-exp-hist-action"
                    onClick={() => void exportApi.saveCopyAs(job.outputPath!)}
                    title="Save copy as…"
                  >
                    Save as
                  </button>
                )}
              </li>
            ))}
          </ul>
        </GlassCard>
      )}
    </div>
  );
}

function relTime(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "now";
    if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
  } catch { return iso.slice(11, 16); }
}
