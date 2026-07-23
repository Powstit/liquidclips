/**
 * useRecordingState · Zustand slot for screen-recording session state.
 *
 * ⚠ IRON GATE IG-COCKPIT-SCREEN-RECORDING · Screen recording contract.
 *
 * Single source of truth for the Kade Cockpit's REC pill · consumed by
 * the ComposerSuiteFrame drivetrain (pushState → setPipelineState
 * wheel 9). Never patch REC pill DOM outside the drivetrain.
 *
 * States:
 *   idle    → no session         (pill hidden)
 *   arming  → target list loading (pill dim + "…")
 *   active  → capture in progress (pill red + timer)
 *   stopping → transitioning to auto-clip (pill amber + "PROCESSING")
 *
 * 2026-07-22 · Bundle 2 · Sprint drivetrain-3
 */

import { create } from "zustand";
import type { NativeCaptureTarget } from "../engine/composer/nativeCapture";

export type RecordingStatus = "idle" | "arming" | "active" | "stopping";

interface RecordingState {
  status: RecordingStatus;
  sessionId: string | null;
  targetId: string | null;
  targetLabel: string | null;
  targets: NativeCaptureTarget[];
  startedAt: number | null;
  lastError: string | null;
  /** Path to the finished recording file after stop, before auto-clip. */
  lastRecordingPath: string | null;

  // Setters — every mutation goes through here so state changes are
  // testable + the drivetrain can subscribe to them.
  setStatus: (s: RecordingStatus) => void;
  setSession: (sessionId: string | null, startedAt: number | null) => void;
  setTarget: (id: string | null, label: string | null) => void;
  setTargets: (targets: NativeCaptureTarget[]) => void;
  setError: (msg: string | null) => void;
  setRecordingPath: (path: string | null) => void;
  reset: () => void;
}

export const useRecordingState = create<RecordingState>((set) => ({
  status: "idle",
  sessionId: null,
  targetId: null,
  targetLabel: null,
  targets: [],
  startedAt: null,
  lastError: null,
  lastRecordingPath: null,

  setStatus: (status) => set({ status }),
  setSession: (sessionId, startedAt) => set({ sessionId, startedAt }),
  setTarget: (targetId, targetLabel) => set({ targetId, targetLabel }),
  setTargets: (targets) => set({ targets }),
  setError: (lastError) => set({ lastError }),
  setRecordingPath: (lastRecordingPath) => set({ lastRecordingPath }),
  reset: () => set({
    status: "idle",
    sessionId: null,
    targetId: null,
    targetLabel: null,
    startedAt: null,
    lastError: null,
    lastRecordingPath: null,
  }),
}));

/**
 * Duration of the current recording in seconds. Convenience selector
 * so components subscribe to a single number and re-render on tick.
 */
export function useRecordingElapsedSeconds(): number {
  const startedAt = useRecordingState((s) => s.startedAt);
  const status = useRecordingState((s) => s.status);
  if (!startedAt || status !== "active") return 0;
  return Math.floor((Date.now() - startedAt) / 1000);
}
