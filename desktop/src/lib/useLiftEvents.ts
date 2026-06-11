// ───── IRON GATE IG-010 (v0.8.0-pre) — see docs/IRON_GATES.md ─────
// Singleton-listener pattern for the v0.8.0 non-blocking lift transcript
// path. Mirrors useIngestEvents — listeners MUST attach on mount via
// useEffect, NOT lazily inside waitForLift.
//
// Usage:
//   const { waitForLift } = useLiftEvents();
//   await sidecar.startLiftTranscript(url);
//   const result = await waitForLift(url);

import { useCallback, useEffect } from "react";
import {
  onLiftComplete,
  onLiftError,
  type LiftComplete,
  type LiftError,
  type LiftTranscriptResult,
} from "./sidecar";

type LiftResult =
  | { status: "complete"; transcript: LiftTranscriptResult }
  | { status: "error"; message: string };

type Pending = {
  resolve: (r: LiftResult) => void;
  reject: (e: Error) => void;
};

const pending = new Map<string, Pending>();

let listenersActive = false;
let unlistenComplete: (() => void) | undefined;
let unlistenError: (() => void) | undefined;

async function ensureListeners() {
  if (listenersActive) return;
  listenersActive = true;

  unlistenComplete = await onLiftComplete((payload: LiftComplete) => {
    const p = pending.get(payload.url);
    if (!p) return;
    pending.delete(payload.url);
    p.resolve({ status: "complete", transcript: payload });
  });

  unlistenError = await onLiftError((payload: LiftError) => {
    const p = pending.get(payload.url);
    if (!p) return;
    pending.delete(payload.url);
    p.resolve({ status: "error", message: payload.message });
  });
}

export function cleanupLiftListeners() {
  unlistenComplete?.();
  unlistenError?.();
  listenersActive = false;
  pending.clear();
}

export function useLiftEvents() {
  // IRON GATE IG-010 — on-mount listener attach (do not move into Promise body)
  useEffect(() => { void ensureListeners(); }, []);

  const waitForLift = useCallback(
    (url: string, timeoutMs = 60 * 60 * 1000): Promise<LiftResult> => {
      return new Promise((resolve, reject) => {
        if (pending.has(url)) {
          reject(new Error(`Lift already pending for ${url}`));
          return;
        }
        pending.set(url, { resolve, reject });

        // 1h safety timeout matches the absolute floor App.tsx previously
        // enforced via Promise.race. The sidecar emits clearer scaled
        // timeout errors before this fires; this is the last-resort net.
        window.setTimeout(() => {
          if (!pending.has(url)) return;
          pending.delete(url);
          reject(new Error("Transcription took longer than 1 hour — give up and try a shorter video."));
        }, timeoutMs);
      });
    },
    [],
  );

  return { waitForLift };
}
// ───── END IRON GATE IG-010 ─────
