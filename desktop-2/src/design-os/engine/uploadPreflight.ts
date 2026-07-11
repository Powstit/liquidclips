/**
 * uploadPreflight · Block 2 · 2026-07-11
 *
 * Client-side gate that runs BEFORE the sidecar ever sees a file path.
 * Catches every source-file failure mode we can prove from the OS
 * without shipping the whole file to the sidecar first:
 *
 *   - file does not exist
 *   - file exists but is 0 bytes (Dropbox smart-sync placeholder,
 *     iCloud eviction, Time Machine restore-in-progress, empty write)
 *   - Dropbox placeholder heuristic (0 bytes + path contains "Dropbox")
 *     produces a specific, actionable message
 *   - unsupported extension (belt-and-braces alongside the picker filter)
 *   - unreadable (permission denied on the first byte read)
 *
 * ffprobe / codec / duration / audio-track checks stay on the sidecar
 * side — this preflight only proves the OS-level basics so a stub or a
 * dead symlink never reaches `sidecar.startRun` and gets swallowed by
 * a stuck StageRail.
 *
 * Runtime-only. No Rust, no Cargo, no Tauri config touched. Uses the
 * existing @tauri-apps/plugin-fs dependency.
 */

export type PreflightReason =
  | "not_found"
  | "empty_file"
  | "dropbox_stub"
  | "unsupported_type"
  | "unreadable";

export interface PreflightOk {
  ok: true;
  path: string;
  filename: string;
  size: number;
}

export interface PreflightFail {
  ok: false;
  path: string;
  filename: string;
  reason: PreflightReason;
  humanMessage: string;
  /** Debug detail — NOT customer-facing. Kept short + PII-safe. */
  detail?: string;
}

export type PreflightResult = PreflightOk | PreflightFail;

const SUPPORTED_EXTS = ["mp4", "mov", "m4v", "webm"] as const;

function basename(path: string): string {
  const s = path.split(/[\\/]/).pop();
  return typeof s === "string" && s.length > 0 ? s : path;
}

function extLower(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

function looksLikeDropboxPath(path: string): boolean {
  // Match "/Dropbox", "\Dropbox", "Uncle Daniel Dropbox", any variant
  // where "Dropbox" is a directory component. Case-insensitive.
  return /(?:^|[\\/])[^\\/]*Dropbox[^\\/]*(?:[\\/]|$)/i.test(path);
}

/**
 * Run every safe OS-level check on the source file.
 *
 * Never throws. On Tauri host it uses `@tauri-apps/plugin-fs`; on non-
 * Tauri (browser preview) it returns `ok:true` (the picker is disabled
 * outside Tauri so this path won't fire in practice — the fallback
 * matches the picker's own honest-error copy elsewhere).
 */
export async function preflightSourceFile(path: string): Promise<PreflightResult> {
  const filename = basename(path);
  const ext = extLower(filename);

  // Extension gate first — cheap and catches picker bypass (e.g. drag +
  // drop of a .txt onto the window).
  if (!SUPPORTED_EXTS.includes(ext as (typeof SUPPORTED_EXTS)[number])) {
    return {
      ok: false,
      path,
      filename,
      reason: "unsupported_type",
      humanMessage: `${filename} isn't a supported video type. Try an .mp4, .mov, .m4v, or .webm file.`,
    };
  }

  const isTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (!isTauri) {
    // Non-Tauri host (Vite dev in browser). Ingest is gated elsewhere;
    // don't second-guess it here.
    return { ok: true, path, filename, size: -1 };
  }

  let stat: { size?: number } | null = null;
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    stat = await fs.stat(path);
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    // stat throws with a NotFound-style message when the path doesn't
    // resolve. Everything else counts as unreadable.
    const lower = msg.toLowerCase();
    const notFound =
      lower.includes("no such file") ||
      lower.includes("not found") ||
      lower.includes("nosuchfile") ||
      lower.includes("cannot find");
    if (notFound) {
      return {
        ok: false,
        path,
        filename,
        reason: "not_found",
        humanMessage: `${filename} isn't at that path anymore. Try another video.`,
        detail: msg.slice(0, 120),
      };
    }
    return {
      ok: false,
      path,
      filename,
      reason: "unreadable",
      humanMessage: `Liquid Clips can't read ${filename} · check the file's permissions in Finder and try again.`,
      detail: msg.slice(0, 120),
    };
  }

  const size = typeof stat?.size === "number" ? stat.size : -1;

  if (size === 0) {
    if (looksLikeDropboxPath(path)) {
      return {
        ok: false,
        path,
        filename,
        reason: "dropbox_stub",
        humanMessage:
          `${filename} is stored in Dropbox but hasn't downloaded to this Mac yet. ` +
          `In Finder, right-click it and choose Make Available Offline, then try again.`,
      };
    }
    return {
      ok: false,
      path,
      filename,
      reason: "empty_file",
      humanMessage:
        `${filename} is 0 bytes — the file didn't finish downloading or writing. Wait for it to finish and try again.`,
    };
  }

  return { ok: true, path, filename, size };
}
