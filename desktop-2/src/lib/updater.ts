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
  | { kind: "downloading"; downloaded: number; total: number | null }
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

export async function applyUpdate(
  update: Update,
  onProgress: (state: UpdateState) => void,
): Promise<void> {
  try {
    let downloaded = 0;
    let total: number | null = null;
    onProgress({ kind: "downloading", downloaded: 0, total: null });
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength ?? null;
          onProgress({ kind: "downloading", downloaded: 0, total });
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          onProgress({ kind: "downloading", downloaded, total });
          break;
        case "Finished":
          onProgress({ kind: "installing" });
          break;
      }
    });
    await relaunch();
  } catch (e) {
    onProgress({ kind: "error", message: toMessage(e) });
  }
}
