/**
 * useRuntimeVersion · single canonical source of truth for the
 * "which bundle is rendering right now?" question.
 *
 * BC-002 elimination target (BUG-006 · BUG-007).
 *
 * ─────────────────────────────────────────────────────────────
 * History
 *   RC1 · P1-C (2026-07-11) — wired `TopHud` version pill to
 *   invoke("runtime_info") so the pill stops reading the shell
 *   build-time constant. That closed BUG-006 at the pill site
 *   but 4 other surfaces (App.tsx boot telemetry × 2,
 *   DiagnosticsSection, IntroSplash, Settings, telemetry
 *   bootstrap) still rendered `__APP_VERSION__` directly — that
 *   is BUG-007. This wave (B1 · RC1) sweeps every reader onto
 *   this hook (React callers) or `runtimeVersionSync()` (non-
 *   React callers), leaving `__APP_VERSION__` referenced from
 *   this module only.
 *
 *   Wave B1 · RC1 (2026-07-12) — added a `lc:runtime-staged`
 *   Tauri event subscriber so if a runtime bundle is staged mid-
 *   session (UpdateBeacon path) the pill flips to the newly-
 *   active version without a route remount. This also feeds
 *   BUG-012 investigation — Cmd+R hot-swap can be surfaced in
 *   the pill even when the URI resolver cache is stale.
 *
 * ─────────────────────────────────────────────────────────────
 * Shape
 *   In Tauri: invoke("runtime_info") → { active_version, source, … }.
 *     `active_version` reflects whichever bundle the runtime URI
 *     resolver mounted (bundled OR staged from ~/Library/AppSupport).
 *     Falls back to `__APP_VERSION__` if the invoke throws
 *     (missing command, permission denied).
 *   In browser preview / Playwright: no Tauri IPC available →
 *     falls back to `__APP_VERSION__` immediately.
 *
 * Zero shell / Rust / Cargo edits · we reuse the existing
 * `runtime_info` command that UpdateBeacon + Settings already call.
 */

import { useEffect, useState } from "react";
import { lcDiag } from "./diagnosticLogger";

// Vite injects `__APP_VERSION__` at build time from package.json. Kept
// as the honest fallback when Tauri IPC is unavailable. Referenced ONLY
// from this module — every other reader consumes `useRuntimeVersion()`
// or `runtimeVersionSync()`. Grep guard in the test suite enforces
// that count == 1 across `src/**`.
declare const __APP_VERSION__: string | undefined;

interface RuntimeInfoShape {
  active_version: string;
  source: "bundled" | "staged" | string;
  staged_bundle_path: string | null;
  last_check: unknown;
  manifest_url: string;
  channel: string;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Deterministic shell fallback. Used before the Tauri invoke resolves
 *  AND when the invoke throws (browser preview, missing command). */
function shellFallback(): string {
  if (typeof __APP_VERSION__ === "string" && __APP_VERSION__.length > 0) {
    return __APP_VERSION__;
  }
  return "dev";
}

/**
 * Synchronous shell-fallback reader for non-React callers (App.tsx
 * boot telemetry, telemetry/bootstrap.ts). Returns the same fallback
 * the hook would render before the invoke resolves. Callers that need
 * the LIVE runtime-bundle version must use the hook (they mount inside
 * React) — the sync form is honest for boot-time telemetry where the
 * shell version is the correct answer anyway (the invoke would race
 * with the very first `flowTrace` line).
 */
export function runtimeVersionSync(): string {
  return shellFallback();
}

export interface RuntimeVersionSnapshot {
  /** The version string to render. Honest across environments:
   *  - Tauri: active runtime bundle version (bundled or staged).
   *  - Browser preview: shell `__APP_VERSION__` fallback. */
  version: string;
  /** Where the version came from · lets consumers annotate the UI
   *  (e.g. a tooltip "runtime bundle" vs "shell build") if desired. */
  source: "runtime-active" | "shell-fallback";
}

/**
 * Reactive runtime version. Renders the shell fallback synchronously
 * at first render (no flash of empty text), then upgrades to the real
 * runtime version when the Tauri invoke resolves. Also re-reads when
 * a `lc:runtime-staged` event fires so a mid-session bundle promotion
 * updates every consumer on the same tick.
 */
export function useRuntimeVersion(): RuntimeVersionSnapshot {
  const [snapshot, setSnapshot] = useState<RuntimeVersionSnapshot>(() => ({
    version: shellFallback(),
    source: "shell-fallback",
  }));

  useEffect(() => {
    if (!isTauriRuntime()) {
      // Browser preview / Playwright → shell fallback is the honest
      // answer; skip the invoke entirely.
      return;
    }
    let cancelled = false;
    let unlistenStaged: (() => void) | undefined;

    async function readOnce(): Promise<void> {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const info = await invoke<RuntimeInfoShape>("runtime_info");
        if (cancelled) return;
        if (info && typeof info.active_version === "string" && info.active_version.length > 0) {
          setSnapshot({ version: info.active_version, source: "runtime-active" });
        }
      } catch (err) {
        // Missing command / permission → keep the shell fallback. Emit
        // a diag so we can spot this in the wild without breaking the
        // pill render.
        try {
          lcDiag("runtime_version_read_failed", {
            reason: err instanceof Error ? err.message : String(err),
          });
        } catch { /* diag failure must not break the render */ }
      }
    }

    void (async () => {
      // Initial read at mount.
      await readOnce();
      if (cancelled) return;
      // Wave B1 · RC1 (2026-07-12) — a bundle staged mid-session
      // fires `lc:runtime-staged` from src-tauri/src/runtime.rs.
      // Re-read `runtime_info` so the pill snaps to the new version
      // even before Cmd+R. Non-fatal on failure — the initial value
      // stays.
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const off = await listen("lc:runtime-staged", () => {
          void readOnce();
        });
        if (cancelled) off();
        else unlistenStaged = off;
      } catch {
        // Missing event plugin in some preview harnesses — non-fatal.
      }
    })();

    return () => {
      cancelled = true;
      if (unlistenStaged) unlistenStaged();
    };
  }, []);

  return snapshot;
}
