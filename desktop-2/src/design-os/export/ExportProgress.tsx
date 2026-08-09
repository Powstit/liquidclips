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
import { describeError } from "../errors/customerSafeErrors";
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
              {isComplete && (
                // 2026-08-07 · was just "Complete · ready to ship" — never
                // said where the file went. `history[0]` is the just-
                // finished job (listHistory() re-fetches on phase change,
                // most-recent-first); fall back to the generic line if it
                // hasn't landed yet.
                history[0]?.outputPath
                  ? `Complete · saved as ${history[0].outputPath.split(/[/\\]/).pop()}`
                  : "Complete · ready to ship"
              )}
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
          <p className="lc-exp-prog-err" role="alert" aria-live="assertive">
            {/* Audit D fix · prefer the human-safe field. 2026-08-07 ·
                switched the fallback from sanitizeError (PII-redaction
                only — still shows a raw "RuntimeError: ..." blob) to
                describeError's classified title, matching the same
                customer-safe copy used in Workstation.tsx / StageRail.tsx. */}
            {session.error.human ?? describeError(session.error.message, { scenario: "upload" }).title}
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
                    onClick={async () => {
                      // Ship-lens P1-CM04-002 fix (2026-07-06) · honour
                      // the new tri-state contract. On a real "file not
                      // found" (expired history row), tell the user.
                      // Silent skip in dev / preview (not_wired).
                      try {
                        const r = await exportApi.revealInFinder(job.outputPath!);
                        if (r.revealed) return;
                        if (r.reason === "not_found") {
                          bus.emit("toast", {
                            kind: "warning",
                            title: "Couldn't reveal",
                            body: `File not found · ${(job.outputPath ?? "").split("/").pop() ?? ""}`,
                          });
                        } else if (r.reason === "error") {
                          bus.emit("toast", {
                            kind: "error",
                            title: "Reveal failed",
                            body: r.error ?? "Unknown error",
                          });
                        }
                      } catch (err) {
                        bus.emit("toast", {
                          kind: "error",
                          title: "Reveal failed",
                          body: err instanceof Error ? err.message : String(err),
                        });
                      }
                    }}
                    aria-label="Reveal exported file in Finder"
                    title="Reveal in Finder"
                  >
                    Reveal
                  </button>
                )}
                {job.outputPath && (
                  <button
                    type="button"
                    className="lc-exp-hist-action"
                    onClick={async () => {
                      // Ship-lens P1-CM04-002 fix (2026-07-06) · honour
                      // the new tri-state contract. Success toast on
                      // dest · info on user-cancel · silent on not_wired.
                      // Ship-lens RPC-contract fix (2026-07-06) · surface
                      // not_found and error reasons distinctly (previously
                      // collapsed into the cancelled branch which lied to
                      // users about the failure mode).
                      try {
                        const r = await exportApi.saveCopyAs(job.outputPath!);
                        if (r.dest) {
                          bus.emit("toast", {
                            kind: "success",
                            title: "Copy saved",
                            body: r.dest.split("/").pop() ?? r.dest,
                          });
                        } else if (r.reason === "not_found") {
                          bus.emit("toast", {
                            kind: "error",
                            title: "Source file missing",
                            body: "The exported file was moved or deleted.",
                          });
                        } else if (r.reason === "error") {
                          bus.emit("toast", {
                            kind: "error",
                            title: "Save failed",
                            body: r.error ?? "Unknown copy error",
                          });
                        } else if (r.reason === "cancelled") {
                          bus.emit("toast", {
                            kind: "info",
                            title: "Save cancelled",
                            body: "No destination selected.",
                          });
                        }
                      } catch (err) {
                        bus.emit("toast", {
                          kind: "error",
                          title: "Save failed",
                          body: err instanceof Error ? err.message : String(err),
                        });
                      }
                    }}
                    aria-label="Save a copy of the exported file to another location"
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
