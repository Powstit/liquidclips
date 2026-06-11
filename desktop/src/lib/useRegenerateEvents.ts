// ───── IRON GATE IG-010 (v0.8.0-pre) — see docs/IRON_GATES.md ─────
// Singleton-listener pattern for v0.8.0 non-blocking regenerate clip.
// Mirrors useGlobalBakeEvents — listeners MUST attach on mount via
// useEffect, NOT lazily inside waitForRegenerate.
//
// Usage:
//   const { waitForRegenerate } = useRegenerateEvents();
//   await sidecar.startRegenerateClip(slug, idx, start, end);
//   const result = await waitForRegenerate(slug, idx);

import { useCallback, useEffect } from "react";
import {
  onRegenerateComplete,
  onRegenerateError,
  type RegenerateComplete,
  type RegenerateError,
  type Project,
} from "./sidecar";

type RegenerateResult =
  | { status: "complete"; project: Project }
  | { status: "error"; message: string; canceled?: boolean };

type Pending = {
  resolve: (r: RegenerateResult) => void;
  reject: (e: Error) => void;
};

const pending = new Map<string, Pending>();
const makeKey = (slug: string, idx: number) => `${slug}:${idx}`;

let listenersActive = false;
let unlistenComplete: (() => void) | undefined;
let unlistenError: (() => void) | undefined;

async function ensureListeners() {
  if (listenersActive) return;
  listenersActive = true;

  unlistenComplete = await onRegenerateComplete((payload: RegenerateComplete) => {
    const p = pending.get(makeKey(payload.slug, payload.idx));
    if (!p) return;
    pending.delete(makeKey(payload.slug, payload.idx));
    p.resolve({ status: "complete", project: payload.project });
  });

  unlistenError = await onRegenerateError((payload: RegenerateError) => {
    const p = pending.get(makeKey(payload.slug, payload.idx));
    if (!p) return;
    pending.delete(makeKey(payload.slug, payload.idx));
    p.resolve({ status: "error", message: payload.message, canceled: payload.canceled });
  });
}

export function cleanupRegenerateListeners() {
  unlistenComplete?.();
  unlistenError?.();
  listenersActive = false;
  pending.clear();
}

export function useRegenerateEvents() {
  // IRON GATE IG-010 — on-mount listener attach (do not move into Promise body)
  useEffect(() => { void ensureListeners(); }, []);

  const waitForRegenerate = useCallback(
    (slug: string, idx: number, timeoutMs = 300_000): Promise<RegenerateResult> => {
      return new Promise((resolve, reject) => {
        const key = makeKey(slug, idx);
        if (pending.has(key)) {
          reject(new Error(`Regenerate already pending for ${key}`));
          return;
        }
        pending.set(key, { resolve, reject });
        window.setTimeout(() => {
          if (!pending.has(key)) return;
          pending.delete(key);
          reject(new Error(`Regenerate timeout for ${key} after ${timeoutMs}ms`));
        }, timeoutMs);
      });
    },
    [],
  );

  return { waitForRegenerate };
}
// ───── END IRON GATE IG-010 ─────
