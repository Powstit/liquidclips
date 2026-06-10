// v0.7.32 — Reaction / overlay bake progress hook.
// Mirrors the lift-transcript listener pattern: registers a Tauri event
// listener for sidecar:overlay_progress, tracks the latest payload, and
// exposes start/stop so the caller controls the listening window.

import { useCallback, useRef, useState } from "react";
import { onOverlayProgress, type OverlayProgress } from "./sidecar";

export type ReactionBakeProgress = OverlayProgress | null;

export function useReactionBakeProgress() {
  const [progress, setProgress] = useState<ReactionBakeProgress>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const genRef = useRef(0);

  const start = useCallback(async () => {
    // Cancel any previous listener so stale bakes don't leak into the new one.
    unlistenRef.current?.();
    genRef.current += 1;
    const myGen = genRef.current;
    setProgress(null);
    const unlisten = await onOverlayProgress((p) => {
      if (genRef.current !== myGen) return; // stale-generation guard
      setProgress(p);
    });
    unlistenRef.current = unlisten;
  }, []);

  const stop = useCallback(() => {
    genRef.current += 1;
    unlistenRef.current?.();
    unlistenRef.current = null;
    setProgress(null);
  }, []);

  return { progress, start, stop };
}
