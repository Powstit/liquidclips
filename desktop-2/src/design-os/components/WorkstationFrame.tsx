/**
 * WorkstationFrame · Item 3 chrome shell.
 *
 * Wraps the Workstation route content in a browser/OS-style console
 * frame. Pure presentation — surfaces session metadata reported by
 * useEngineSession + lifted ResultsGrid selection count + project
 * fixture. No data ownership, no RPC calls.
 *
 * Shape:
 *   1. Title bar — 3 HUD status dots + WORKSTATION eyebrow + project
 *      name + source label + session-status pill.
 *   2. Status strip — clips count · selected count · ready-to-ship pill.
 *   3. Content slot — children render below.
 *
 * Visual contract: reuses existing Design OS vocabulary —
 * `.lc-pill`, `.lc-hud-dot`, Geist Mono eyebrow type. Adds only the
 * frame-specific classes prefixed `.lc-ws-frame-*` (see
 * WorkstationFrame.css).
 */

import { useState, type ReactNode } from "react";
import "./WorkstationFrame.css";

export type WorkstationSessionStatus =
  | "idle"
  | "running"
  | "complete"
  | "error";

export interface WorkstationFrameProps {
  /** Project name shown in the title bar. */
  projectName?: string | null;
  /** Source line under the project — URL or filename. */
  sourceLabel?: string | null;
  /** Total clips in the active project. */
  clipCount: number;
  /** Count of clips currently multi-selected in the grid. */
  selectedCount: number;
  /** Count of clips currently exportable / ready to ship. Drives the
   *  ready-pill colour + label. */
  readyCount: number;
  /** Engine session phase. */
  sessionStatus: WorkstationSessionStatus;
  /** Optional sidecar stage name (e.g. "cut", "bake") shown next to
   *  the status when phase === "running". */
  sessionStage?: string | null;
  children: ReactNode;
}

export function WorkstationFrame({
  projectName,
  sourceLabel,
  clipCount,
  selectedCount,
  readyCount,
  sessionStatus,
  sessionStage,
  children,
}: WorkstationFrameProps) {
  // BUG-029.2 + .7 · collapse/expand at any time. State is local to the
  // frame on purpose — `focusedClipIdx` lives upstream in Workstation.tsx
  // (which lives in useEngineSessionPersistence) so collapsing the frame
  // does NOT touch the selected clip. Re-expand restores everything.
  const [collapsed, setCollapsed] = useState(false);
  const tone = toneFor(sessionStatus);
  const allReady = clipCount > 0 && readyCount >= clipCount;
  const readyToneClass =
    clipCount === 0
      ? "lc-ws-frame-pill-muted"
      : allReady
        ? "lc-ws-frame-pill-on"
        : readyCount > 0
          ? "lc-ws-frame-pill-warm"
          : "lc-ws-frame-pill-muted";

  return (
    <div className={`lc-ws-frame ${collapsed ? "is-collapsed" : ""}`}>
      <div className="lc-ws-frame-titlebar">
        <div className="lc-ws-frame-titlebar-left">
          <div className="lc-ws-frame-dots" aria-hidden="true">
            <span className="lc-ws-frame-dot lc-ws-frame-dot-a" />
            <span className="lc-ws-frame-dot lc-ws-frame-dot-b" />
            <span className="lc-ws-frame-dot lc-ws-frame-dot-c" />
          </div>
          <span className="lc-ws-frame-eyebrow">Workstation</span>
          <span className="lc-ws-frame-sep" aria-hidden="true">·</span>
          <span className="lc-ws-frame-project" title={projectName ?? undefined}>
            {projectName || "no session"}
          </span>
          {sourceLabel && !collapsed && (
            <>
              <span className="lc-ws-frame-sep" aria-hidden="true">·</span>
              <span className="lc-ws-frame-source" title={sourceLabel}>
                {sourceLabel}
              </span>
            </>
          )}
        </div>
        <div className="lc-ws-frame-titlebar-right">
          <div className={`lc-pill lc-ws-frame-status lc-ws-frame-status-${tone.key}`}>
            <span className="lc-ws-frame-status-dot" aria-hidden="true" />
            <span>{tone.label}</span>
            {sessionStatus === "running" && sessionStage && (
              <span className="lc-ws-frame-status-stage">
                · {sessionStage}
              </span>
            )}
          </div>
          <button
            type="button"
            className="lc-ws-frame-collapse"
            aria-label={collapsed ? "Expand Workstation" : "Collapse Workstation"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand" : "Collapse"}
          >
            <span aria-hidden="true">{collapsed ? "▾" : "▴"}</span>
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="lc-ws-frame-statusstrip">
            <div className="lc-ws-frame-counts">
              <span className="lc-ws-frame-count">
                <span className="lc-ws-frame-count-label">Clips</span>
                <span className="lc-ws-frame-count-num">{clipCount}</span>
              </span>
              <span className="lc-ws-frame-sep" aria-hidden="true">·</span>
              <span className="lc-ws-frame-count">
                <span className="lc-ws-frame-count-label">Selected</span>
                <span className="lc-ws-frame-count-num">{selectedCount}</span>
              </span>
            </div>
            <span className={`lc-pill lc-ws-frame-ready ${readyToneClass}`}>
              <span className="lc-ws-frame-ready-glyph" aria-hidden="true" />
              {clipCount === 0
                ? "studio ready"
                : allReady
                  ? "ready to ship"
                  : `${readyCount} of ${clipCount} ready`}
            </span>
          </div>

          <div className="lc-ws-frame-body">{children}</div>
        </>
      )}
    </div>
  );
}

function toneFor(s: WorkstationSessionStatus): {
  key: "idle" | "running" | "complete" | "error";
  label: string;
} {
  switch (s) {
    case "running":
      return { key: "running", label: "running" };
    case "complete":
      return { key: "complete", label: "live" };
    case "error":
      return { key: "error", label: "fault" };
    case "idle":
    default:
      return { key: "idle", label: "idle" };
  }
}
