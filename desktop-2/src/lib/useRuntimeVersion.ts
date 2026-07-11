/**
 * useRuntimeVersion · RC1 state-drift trifecta · P1-C · 2026-07-11
 *
 * Acceptance criterion 6: runtime version display uses the ACTIVE
 * runtime bundle version, not only the shell version.
 *
 * Before this hook, `TopHud` rendered `__APP_VERSION__` — a build-time
 * constant baked into the Tauri shell at package time. After a
 * hot-swap runtime update the shell version stayed pinned to the
 * originally-shipped number even though the JS bundle came from a
 * newer manifest download. Support tickets asking "which version am
 * I on?" got wrong answers.
 *
 * This hook resolves the honest active version:
 *   - In Tauri: invoke("runtime_info") → returns { active_version, … }.
 *     `active_version` reflects whichever bundle is currently mounted
 *     (bundled OR staged from ~/Library/AppSupport). Falls back to
 *     `__APP_VERSION__` if the invoke throws (missing command, permission).
 *   - In browser preview / Playwright: no Tauri IPC available →
 *     falls back to `__APP_VERSION__` immediately.
 *
 * Zero shell / Rust / Cargo edits · we reuse the existing `runtime_info`
 * command that UpdateBeacon + Settings already call.
 */

import { useEffect, useState } from "react";
import { lcDiag } from "./diagnosticLogger";

// Vite injects `__APP_VERSION__` at build time from package.json. Kept
// as the honest fallback when Tauri IPC is unavailable.
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
 * runtime version when the Tauri invoke resolves.
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
    void (async () => {
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
    })();
    return () => { cancelled = true; };
  }, []);

  return snapshot;
}
