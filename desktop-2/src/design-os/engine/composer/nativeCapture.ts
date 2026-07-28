/**
 * nativeCapture · Composer Class D · scap-backed screen capture client.
 *
 * ⚠ IRON GATE IG-COMPOSER-GG · Native screen capture contract (D1/D2/D5).
 *
 * Wraps the Tauri commands registered from src-tauri/src/screen_capture.rs
 * (which uses the `scap` crate · ScreenCaptureKit on macOS 13.0+). Falls
 * back to a mock shape when Tauri is unavailable (e.g. dev in a plain
 * browser) so the UI can render its states end-to-end without crashing.
 *
 * Verified via WebFetch (2026-07-18):
 *   * scap 0.1.0-beta.1 requires macOS 13.0+ · min-system-version bumped
 *     in tauri.conf.json to match.
 *   * ScreenCaptureKit permission is granted via System Settings > Privacy
 *     & Security > Screen Recording · triggered by the first
 *     scap::request_permission() call at runtime, NO Info.plist key.
 *
 * D3 (camera) + D4 (countdown) + D2 mic → see mediaCapture.ts
 * (IG-COMPOSER-FF). This module is ONLY for the scap/ScreenCaptureKit
 * path (D1 screen · D5 multi-monitor · D2 system audio · pending
 * upstream scap audio support).
 */

import { invoke } from "@tauri-apps/api/core";

export interface NativeCaptureSupportStatus {
  supported: boolean;
  hasPermission: boolean;
}

export interface NativeCaptureTarget {
  id: string;
  kind: string;
  label: string;
}

export interface NativeCaptureStartResponse {
  sessionId: string;
  startedAtMs: number;
}

export interface NativeCaptureStopResponse {
  sessionId: string;
  durationMs: number;
  /** Absolute path to the finished recording. Real, on-disk MP4 —
   *  see screen_capture.rs; this used to not exist at all. */
  outputPath: string;
  outputBytes: number;
}

function isTauriAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as typeof window & { __TAURI_INTERNALS__?: unknown };
  return typeof w.__TAURI_INTERNALS__ !== "undefined";
}

export async function nativeCaptureSupportStatus(): Promise<NativeCaptureSupportStatus> {
  if (!isTauriAvailable()) {
    return { supported: false, hasPermission: false };
  }
  const raw = await invoke<{ supported: boolean; has_permission: boolean }>(
    "screen_capture_support_status",
  );
  return { supported: raw.supported, hasPermission: raw.has_permission };
}

export async function nativeCaptureRequestPermission(): Promise<boolean> {
  if (!isTauriAvailable()) return false;
  return await invoke<boolean>("screen_capture_request_permission");
}

export async function nativeCaptureListTargets(): Promise<NativeCaptureTarget[]> {
  if (!isTauriAvailable()) return [];
  const raw = await invoke<Array<{ id: string; kind: string; label: string }>>(
    "screen_capture_list_targets",
  );
  return raw.map((t) => ({ id: t.id, kind: t.kind, label: t.label }));
}

export async function nativeCaptureStart(
  sessionId: string,
  targetIdx?: number,
  resolution?: string,
): Promise<NativeCaptureStartResponse> {
  if (!isTauriAvailable()) {
    throw new Error("nativeCapture.tauri_unavailable");
  }
  const raw = await invoke<{ session_id: string; started_at_ms: number }>(
    "screen_capture_start",
    { sessionId, targetIdx, resolution },
  );
  return { sessionId: raw.session_id, startedAtMs: raw.started_at_ms };
}

export async function nativeCaptureStop(
  sessionId: string,
): Promise<NativeCaptureStopResponse> {
  if (!isTauriAvailable()) {
    throw new Error("nativeCapture.tauri_unavailable");
  }
  const raw = await invoke<{
    session_id: string;
    duration_ms: number;
    output_path: string;
    output_bytes: number;
  }>("screen_capture_stop", { sessionId });
  return {
    sessionId: raw.session_id,
    durationMs: raw.duration_ms,
    outputPath: raw.output_path,
    outputBytes: raw.output_bytes,
  };
}
