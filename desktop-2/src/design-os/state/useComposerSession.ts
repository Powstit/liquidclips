/**
 * useComposerSession · shared composer state across SimpleComposer +
 * MasterComposer shells. State survives the mode swap (idle → engaged)
 * because it lives OUTSIDE either component.
 *
 * ⛔ IRON GATE IG-COMPOSER-MODE-SWAP · both composer shells MUST read
 *    from this slot. Owning state locally in either shell breaks the
 *    swap animation (state gets dropped mid-view-transition).
 *
 * 2026-07-22 · Sprint 2.5 · idle → engaged cinematic swap
 */

import { create } from "zustand";
import type { Clip } from "../engine/types";

export type KadeMood = "idle" | "thinking" | "alert" | "collapsed";

export interface ProgressState {
  stage: string;
  percent: number | null;
  note?: string;
  segmentsDone?: number;
  segmentsTotal?: number;
}

export type IntentStatus =
  | { kind: "ok"; ms: number; action: string; quota: number | null }
  | { kind: "fail"; message: string }
  | null;

export interface ComposerReply {
  title: string;
  body: string;
  severity: "info" | "warn";
}

interface ComposerSessionState {
  /* — turn state — */
  command: string;
  history: readonly string[];
  pendingUtterance: string;
  awaitingSource: boolean;
  urlDraft: string;
  showUrlInput: boolean;
  sessionCtx: Record<string, string>;

  /* — sidecar run state — */
  activeSlug: string | null;
  progress: ProgressState | null;
  clips: readonly Clip[];
  runError: string | null;

  /* — visibility mirrors — */
  lastReply: ComposerReply | null;
  kadeMood: KadeMood;
  lastIntentStatus: IntentStatus;

  /* — shell mode override — */
  /**
   * When set, user forced a specific shell. "auto" = follow isEngaged
   * computation. "idle" = force SimpleComposer. "engaged" = force
   * MasterComposer. Wired to the HUD's Kade | Classic toggle.
   */
  shellOverride: "auto" | "idle" | "engaged";

  /* — actions (setters that shells call) — */
  setCommand: (v: string) => void;
  pushHistory: (cmd: string) => void;
  setPendingUtterance: (v: string) => void;
  setAwaitingSource: (v: boolean) => void;
  setUrlDraft: (v: string) => void;
  setShowUrlInput: (v: boolean) => void;
  updateSessionCtx: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  setActiveSlug: (v: string | null) => void;
  setProgress: (v: ProgressState | null) => void;
  setClips: (v: readonly Clip[]) => void;
  setRunError: (v: string | null) => void;
  setLastReply: (v: ComposerReply | null) => void;
  setKadeMood: (v: KadeMood) => void;
  setLastIntentStatus: (v: IntentStatus) => void;
  setShellOverride: (v: "auto" | "idle" | "engaged") => void;
  /** Clear all turn state · returns the composer to idle. */
  clearSession: () => void;
}

const INITIAL: Omit<ComposerSessionState,
  | "setCommand" | "pushHistory" | "setPendingUtterance" | "setAwaitingSource"
  | "setUrlDraft" | "setShowUrlInput" | "updateSessionCtx" | "setActiveSlug"
  | "setProgress" | "setClips" | "setRunError" | "setLastReply" | "setKadeMood"
  | "setLastIntentStatus" | "setShellOverride" | "clearSession"
> = {
  command: "",
  history: [],
  pendingUtterance: "",
  awaitingSource: false,
  urlDraft: "",
  showUrlInput: false,
  sessionCtx: {},
  activeSlug: null,
  progress: null,
  clips: [],
  runError: null,
  lastReply: null,
  kadeMood: "idle",
  lastIntentStatus: null,
  shellOverride: "auto",
};

export const useComposerSession = create<ComposerSessionState>((set) => ({
  ...INITIAL,
  setCommand: (v) => set({ command: v }),
  pushHistory: (cmd) =>
    set((s) => ({
      history: [cmd, ...s.history.filter((prev) => prev !== cmd)].slice(0, 8),
    })),
  setPendingUtterance: (v) => set({ pendingUtterance: v }),
  setAwaitingSource: (v) => set({ awaitingSource: v }),
  setUrlDraft: (v) => set({ urlDraft: v }),
  setShowUrlInput: (v) => set({ showUrlInput: v }),
  updateSessionCtx: (updater) => set((s) => ({ sessionCtx: updater(s.sessionCtx) })),
  setActiveSlug: (v) => set({ activeSlug: v }),
  setProgress: (v) => set({ progress: v }),
  setClips: (v) => set({ clips: v }),
  setRunError: (v) => set({ runError: v }),
  setLastReply: (v) => set({ lastReply: v }),
  setKadeMood: (v) => set({ kadeMood: v }),
  setLastIntentStatus: (v) => set({ lastIntentStatus: v }),
  setShellOverride: (v) => set({ shellOverride: v }),
  clearSession: () =>
    set({
      command: "",
      history: [],
      pendingUtterance: "",
      awaitingSource: false,
      urlDraft: "",
      showUrlInput: false,
      sessionCtx: {},
      activeSlug: null,
      progress: null,
      clips: [],
      runError: null,
      lastReply: null,
      kadeMood: "idle",
      lastIntentStatus: null,
      // shellOverride kept · user preference persists across clears
    }),
}));

/**
 * Derived: is the composer engaged (working state) vs idle (greeter)?
 * ComposerRoute uses this to decide which shell to render.
 *
 * "Engaged" = user has submitted or a run is in-flight or results are up.
 * "Idle" = pristine state · user hasn't touched anything.
 *
 * shellOverride wins over the computed value so the user can force
 * either shell via the Kade | Classic toggle.
 */
export function isComposerEngaged(s: ComposerSessionState): boolean {
  if (s.shellOverride === "idle") return false;
  if (s.shellOverride === "engaged") return true;
  return (
    s.history.length > 0 ||
    s.awaitingSource ||
    s.progress !== null ||
    s.clips.length > 0 ||
    s.activeSlug !== null ||
    s.lastReply !== null
  );
}
