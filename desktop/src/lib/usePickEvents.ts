// ───── IRON GATE IG-010 (v0.8.0-pre) — see docs/IRON_GATES.md ─────
// Singleton-listener pattern for v0.8.0 non-blocking pick more clips.
// Mirrors useGlobalBakeEvents — listeners MUST attach on mount via
// useEffect, NOT lazily inside waitForPick.
//
// Usage:
//   const { waitForPick } = usePickEvents();
//   await sidecar.startPickMoreClips(slug);
//   const result = await waitForPick(slug);

import { useCallback, useEffect } from "react";
import {
  onPickComplete,
  onPickError,
  type PickComplete,
  type PickError,
  type Project,
} from "./sidecar";

type PickResult =
  | { status: "complete"; project: Project; added: number; skipped: number }
  | { status: "error"; message: string; canceled?: boolean };

type Pending = {
  resolve: (r: PickResult) => void;
  reject: (e: Error) => void;
};

const pending = new Map<string, Pending>();

let listenersActive = false;
let unlistenComplete: (() => void) | undefined;
let unlistenError: (() => void) | undefined;

async function ensureListeners() {
  if (listenersActive) return;
  listenersActive = true;

  unlistenComplete = await onPickComplete((payload: PickComplete) => {
    const p = pending.get(payload.slug);
    if (!p) return;
    pending.delete(payload.slug);
    p.resolve({ status: "complete", project: payload.project, added: payload.added, skipped: payload.skipped });
  });

  unlistenError = await onPickError((payload: PickError) => {
    const p = pending.get(payload.slug);
    if (!p) return;
    pending.delete(payload.slug);
    p.resolve({ status: "error", message: payload.message, canceled: payload.canceled });
  });
}

export function cleanupPickListeners() {
  unlistenComplete?.();
  unlistenError?.();
  listenersActive = false;
  pending.clear();
}

export function usePickEvents() {
  // IRON GATE IG-010 — on-mount listener attach (do not move into Promise body)
  useEffect(() => { void ensureListeners(); }, []);

  const waitForPick = useCallback(
    (slug: string, timeoutMs = 600_000): Promise<PickResult> => {
      return new Promise((resolve, reject) => {
        if (pending.has(slug)) {
          reject(new Error(`Pick already pending for ${slug}`));
          return;
        }
        pending.set(slug, { resolve, reject });
        // 10-min safety — pick-more rebuilds clips so legitimately long.
        window.setTimeout(() => {
          if (!pending.has(slug)) return;
          pending.delete(slug);
          reject(new Error(`Pick more clips timeout for ${slug} after ${timeoutMs}ms`));
        }, timeoutMs);
      });
    },
    [],
  );

  return { waitForPick };
}
// ───── END IRON GATE IG-010 ─────
