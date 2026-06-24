/**
 * StageRail · 7-stage pipeline progress (Design OS render of legacy WorkingStage)
 *
 * Phase 6C. Drops the legacy WorkingStage visual — keeps the data shape and
 * staging order. Renders seven tiles (one per pipeline stage). The active
 * stage gets a fuchsia bloom + AllowanceBar; completed stages get the
 * checkmark + cyan; pending stages stay dim. Reads from `useEngineSession`
 * so it picks up any sidecar event the tauri-adapter forwards.
 *
 * Stage order: ingest · audio · transcribe · llm · cut · reframe · thumbs.
 */

import { GlassCard, AllowanceBar } from "../components";
import { useEngineSession } from "../state/useEngineSession";
import {
  STAGE_ORDER,
  STAGE_LABEL,
  type StageName,
} from "./types";
import "./StageRail.css";

export interface StageRailProps {
  /** If the parent already has a project loaded, pass stage state directly
   *  so completed stages stay completed across re-mounts. The session-driven
   *  `running` overlay still wins for the currently active stage. */
  stages?: Partial<Record<StageName, { done: boolean; failed?: boolean }>>;
}

export function StageRail({ stages = {} }: StageRailProps) {
  const session = useEngineSession();

  return (
    <div className="lc-stage-rail">
      {STAGE_ORDER.map((stage) => {
        const isActive = session.phase === "running" && session.stage === stage;
        // session.stage is a broader EngineStage (includes bake/regenerate/etc.) —
        // map only the pipeline stages onto the rail for completion sweep.
        const railSessionStage = STAGE_ORDER.includes(session.stage as StageName)
          ? (session.stage as StageName)
          : "thumbs";
        // Mark stages "done" not just on terminal complete, but also when the
        // currently running stage has progressed past them (BUG-023 · the
        // pipeline marches forward, the rail should reflect that visibly).
        const isDone = stages[stage]?.done === true ||
          (session.phase === "complete" && STAGE_ORDER.indexOf(railSessionStage) >= STAGE_ORDER.indexOf(stage)) ||
          (session.phase === "running" && STAGE_ORDER.indexOf(railSessionStage) > STAGE_ORDER.indexOf(stage));
        const isFailed = stages[stage]?.failed === true ||
          (session.phase === "error" && session.stage === stage);

        const cls = [
          "lc-stage-tile",
          isActive && "is-active",
          isDone && !isActive && "is-done",
          isFailed && "is-failed",
        ].filter(Boolean).join(" ");

        const percent = isActive && session.percent != null
          ? Math.round(session.percent * 100)
          : null;

        return (
          <GlassCard
            key={stage}
            density="quiet"
            className={cls}
            hoverLift
          >
            <span className="lc-stage-eb">{stage}</span>
            <span className="lc-stage-label">{STAGE_LABEL[stage]}</span>

            {/* Active stage shows live progress + last-text-note */}
            {isActive && (
              <>
                <AllowanceBar
                  state="healthy"
                  used={percent ?? 0}
                  total={100}
                  label={percent != null ? `${percent}%` : "Working"}
                />
                {session.note && (
                  <span className="lc-stage-note">{session.note}</span>
                )}
              </>
            )}

            {/* Static states */}
            {!isActive && isDone && (
              <span className="lc-stage-state lc-stage-state-done">Complete</span>
            )}
            {!isActive && !isDone && !isFailed && (
              <span className="lc-stage-state lc-stage-state-pending">Pending</span>
            )}
            {isFailed && (
              <span className="lc-stage-state lc-stage-state-failed">
                {session.error?.human || session.error?.message || "Failed"}
              </span>
            )}
          </GlassCard>
        );
      })}
    </div>
  );
}
