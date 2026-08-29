// P1-4-d · Liquid Clips 2.0 updater bridge.
//
// Slim port of legacy desktop/src/lib/updater.ts. Telemetry + humanError
// dependencies dropped · we surface plain Error.message instead. The
// minisign-signed bundle endpoint + signing keypair are shared with
// legacy desktop (see ../../src-tauri/tauri.conf.json `plugins.updater`).
//
// Callable from any surface · no boot-time auto-check is wired here · a
// future Settings → "Check for updates" surface (P1-4-e) consumes this.

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; update: Update }
  | { kind: "up-to-date" }
  | {
      kind: "downloading";
      downloaded: number;
      total: number | null;
      /** Set only when this is a retry after a failed attempt — lets the
       *  gate show "Retrying · attempt 2 of 4" instead of looking frozen
       *  on the same 0-byte progress a fresh stall would show. */
      attempt?: number;
      maxAttempts?: number;
    }
  | { kind: "installing" }
  | { kind: "error"; message: string };

export type LastUpdateCheck = {
  checkedAt: string;
  kind: "available" | "up-to-date" | "error";
  version?: string;
  message?: string;
};

export const LAST_UPDATE_CHECK_KEY = "liquidclips:last-update-check";

function rememberUpdateCheck(state: LastUpdateCheck) {
  try {
    localStorage.setItem(LAST_UPDATE_CHECK_KEY, JSON.stringify(state));
  } catch {
    /* localStorage can be unavailable in test/web shims */
  }
}

export function readLastUpdateCheck(): LastUpdateCheck | null {
  try {
    const raw = localStorage.getItem(LAST_UPDATE_CHECK_KEY);
    return raw ? (JSON.parse(raw) as LastUpdateCheck) : null;
  } catch {
    return null;
  }
}

function toMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export async function checkForUpdate(): Promise<UpdateState> {
  try {
    const update = await check();
    if (!update) {
      rememberUpdateCheck({ checkedAt: new Date().toISOString(), kind: "up-to-date" });
      return { kind: "up-to-date" };
    }
    rememberUpdateCheck({
      checkedAt: new Date().toISOString(),
      kind: "available",
      version: update.version,
    });
    return { kind: "available", update };
  } catch (e) {
    const message = toMessage(e);
    rememberUpdateCheck({ checkedAt: new Date().toISOString(), kind: "error", message });
    return { kind: "error", message };
  }
}

// 2026-08-29 — observed live: a real beta tester's "Download update"
// looked permanently stuck. Root cause traced to update.downloadAndInstall()
// being a single unresumable call — Tauri's updater plugin has no built-in
// retry, so any transient network blip (the exact kind we personally hit
// repeatedly downloading this same GitHub release asset type tonight) fails
// the whole ~1GB download outright with no automatic recovery. Mirrors the
// curl -C -/--retry pattern that got tonight's own installs through.
//
// Real byte-level resume isn't available at this plugin API level (each
// attempt re-downloads from scratch), but a bounded retry loop turns a
// single-blip hard failure into a self-healing one — the same shape of fix,
// applied where the actual customer hits it.
const MAX_DOWNLOAD_ATTEMPTS = 4;
const RETRY_BACKOFF_MS = 3000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function applyUpdate(
  update: Update,
  onProgress: (state: UpdateState) => void,
): Promise<void> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      let downloaded = 0;
      let total: number | null = null;
      const attemptMeta = attempt > 1 ? { attempt, maxAttempts: MAX_DOWNLOAD_ATTEMPTS } : {};
      onProgress({ kind: "downloading", downloaded: 0, total: null, ...attemptMeta });
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? null;
            onProgress({ kind: "downloading", downloaded: 0, total, ...attemptMeta });
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            onProgress({ kind: "downloading", downloaded, total, ...attemptMeta });
            break;
          case "Finished":
            onProgress({ kind: "installing" });
            break;
        }
      });
      await relaunch();
      return;
    } catch (e) {
      lastError = e;
      if (attempt < MAX_DOWNLOAD_ATTEMPTS) {
        await wait(RETRY_BACKOFF_MS);
      }
    }
  }

  onProgress({ kind: "error", message: toMessage(lastError) });
}
