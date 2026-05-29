import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { reportDesktopError } from "./telemetry";

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

export async function checkForUpdate(): Promise<UpdateState> {
  try {
    const update = await check();
    if (!update) {
      rememberUpdateCheck({ checkedAt: new Date().toISOString(), kind: "up-to-date" });
      return { kind: "up-to-date" };
    }
    rememberUpdateCheck({ checkedAt: new Date().toISOString(), kind: "available", version: update.version });
    return { kind: "available", update };
  } catch (e) {
    rememberUpdateCheck({ checkedAt: new Date().toISOString(), kind: "error", message: String(e) });
    void reportDesktopError("update_failed", { route: "update", error_code: "check_failed", message: String(e) });
    return { kind: "error", message: String(e) };
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
    void reportDesktopError("update_failed", { route: "update", error_code: "install_failed", message: String(e) });
    onProgress({ kind: "error", message: String(e) });
  }
}
