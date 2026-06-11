// ───── IRON GATE IG-010 (v0.8.0-pre) — see docs/IRON_GATES.md ─────
// Singleton-listener pattern for the v0.8.0 non-blocking ingest path.
// Mirrors useGlobalBakeEvents — listeners MUST attach on mount via
// useEffect, NOT lazily inside waitForIngest. Lazy attachment leaks fast
// events between sidecar.startIngestUrl() returning and Tauri listeners
// being registered.
//
// Usage:
//   const { waitForIngest } = useIngestEvents();
//   await sidecar.startIngestUrl(url, brief, intent, bounty);
//   const result = await waitForIngest(url);

import { useCallback, useEffect } from "react";
import {
  onIngestComplete,
  onIngestError,
  type IngestComplete,
  type IngestError,
} from "./sidecar";

type IngestResult =
  | { status: "complete"; project: IngestComplete["project"]; downloaded_path: string }
  | { status: "error"; message: string };

type Pending = {
  resolve: (r: IngestResult) => void;
  reject: (e: Error) => void;
};

const pending = new Map<string, Pending>();

let listenersActive = false;
let unlistenComplete: (() => void) | undefined;
let unlistenError: (() => void) | undefined;

async function ensureListeners() {
  if (listenersActive) return;
  listenersActive = true;

  unlistenComplete = await onIngestComplete((payload: IngestComplete) => {
    const p = pending.get(payload.url);
    if (!p) return;
    pending.delete(payload.url);
    p.resolve({
      status: "complete",
      project: payload.project,
      downloaded_path: payload.downloaded_path,
    });
  });

  unlistenError = await onIngestError((payload: IngestError) => {
    const p = pending.get(payload.url);
    if (!p) return;
    pending.delete(payload.url);
    p.resolve({ status: "error", message: payload.message });
  });
}

export function cleanupIngestListeners() {
  unlistenComplete?.();
  unlistenError?.();
  listenersActive = false;
  pending.clear();
}

export function useIngestEvents() {
  // IRON GATE IG-010 — on-mount listener attach (do not move into Promise body)
  useEffect(() => { void ensureListeners(); }, []);

  const waitForIngest = useCallback(
    (url: string, timeoutMs = 900_000): Promise<IngestResult> => {
      return new Promise((resolve, reject) => {
        if (pending.has(url)) {
          reject(new Error(`Ingest already pending for ${url}`));
          return;
        }
        pending.set(url, { resolve, reject });

        // 15-min safety timeout. URL ingests download + transcode + pack —
        // long-form videos legitimately take several minutes. Bigger than
        // useGlobalBakeEvents (5min) because the underlying op is heavier.
        window.setTimeout(() => {
          if (!pending.has(url)) return;
          pending.delete(url);
          reject(new Error(`Ingest timeout for ${url} after ${timeoutMs}ms`));
        }, timeoutMs);
      });
    },
    [],
  );

  return { waitForIngest };
}
// ───── END IRON GATE IG-010 ─────
