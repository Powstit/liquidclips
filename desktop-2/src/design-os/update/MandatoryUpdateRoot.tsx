/**
 * MandatoryUpdateRoot · 2026-07-14
 *
 * Root wrapper that resolves the runtime mandatory-update policy on
 * boot and periodically thereafter. When the active runtime is below
 * the manifest's `minimum_supported_version`, mounts ONLY the
 * KadeUpdateGate (children of this wrapper are not rendered) so no
 * application route, login surface, cockpit, workstation, wallet,
 * agency, settings or deep-linked route can mount behind it.
 *
 * When the status is `ok` or `unknown` (network transiently
 * unavailable + no cached mandatory policy), renders children
 * normally · the existing HardUpdateGate + UpdateBeacon + RestartGate
 * + UpdateReadyIndicator handle non-mandatory paths.
 *
 * No shell rebuild. No new Tauri commands. Frontend-only.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { KadeUpdateGate } from "./KadeUpdateGate";
import {
  resolveMandatoryStatus,
  type MandatoryStatus,
} from "../../lib/mandatoryUpdate";
import { runtimeVersionSync } from "../../lib/useRuntimeVersion";

/**
 * The backend base URL the desktop calls at runtime. Mirrors the
 * pattern used by other src/lib/* backend readers (wallet, thumbnail
 * quota, whopConnect). Falls back to production when unset.
 */
function backendUrl(): string {
  const env = (import.meta as unknown as { env?: { VITE_BACKEND_URL?: string } }).env;
  const override = env?.VITE_BACKEND_URL;
  if (typeof override === "string" && override.length > 0) return override;
  return "https://api.liquidclips.app";
}

/**
 * Baked-in channel. Matches src-tauri/src/runtime.rs `CHANNEL` const.
 * If the shell ever supports per-user channel selection, thread that
 * value through here — until then, `stable` is authoritative for
 * every installed .app.
 */
const CHANNEL = "stable";

/**
 * Poll cadence for the manifest check. Same 5-minute rhythm the
 * existing UpdateBeacon uses so the two systems see the same manifest
 * snapshot without doubling traffic.
 */
const POLL_MS = 5 * 60 * 1_000;

export interface MandatoryUpdateRootProps {
  children: ReactNode;
  /** Optional: bytes-downloaded signal from the Tauri shell. Wired
   *  through here so the KadeUpdateGate progress bar can show a real
   *  percentage when byte-progress is available. In this initial
   *  wire-up the shell doesn't emit progress events yet · left null
   *  so the indeterminate indicator carries the visual weight. */
  bytesDownloaded?: number | null;
  bytesTotal?: number | null;
  /** Optional: called when the customer clicks Retry inside the
   *  KadeUpdateGate failure surface. Default: re-runs the manifest
   *  resolution + triggers a Tauri `runtime_check_now` if available. */
  onRetry?: () => void | Promise<void>;
  /** Optional: called for Copy Diagnostics on the failure surface. */
  onCopyDiagnostics?: () => void | Promise<void>;
  /** Optional: called for Contact Support on the failure surface. */
  onContactSupport?: () => void | Promise<void>;
}

export function MandatoryUpdateRoot({
  children,
  bytesDownloaded = null,
  bytesTotal = null,
  onRetry,
  onCopyDiagnostics,
  onContactSupport,
}: MandatoryUpdateRootProps): React.ReactElement {
  const [status, setStatus] = useState<MandatoryStatus | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const active = runtimeVersionSync() ?? "0.0.0";
    const run = async (): Promise<void> => {
      const s = await resolveMandatoryStatus(backendUrl(), CHANNEL, active);
      if (!cancelled) setStatus(s);
    };
    void run();
    timerRef.current = window.setInterval(() => { void run(); }, POLL_MS);
    return () => {
      cancelled = true;
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const defaultRetry = async (): Promise<void> => {
    const active = runtimeVersionSync() ?? "0.0.0";
    const s = await resolveMandatoryStatus(backendUrl(), CHANNEL, active);
    setStatus(s);
    try {
      const mod = await import("@tauri-apps/api/core");
      await mod.invoke("runtime_check_now");
    } catch { /* browser preview · Tauri not present */ }
  };

  // First evaluation hasn't returned yet · render children so first
  // paint isn't blocked. resolveMandatoryStatus is fast (single HTTP
  // GET) and the cached-policy path returns instantly. If we later
  // discover this window is a source of route-leakage under a slow
  // network we can gate on `status === null` too, but the pre-fetch
  // path already covers the offline mandatory case via cached policy
  // (read from localStorage before the network call resolves).
  if (status === null) return <>{children}</>;

  const isMandatory =
    status.kind === "mandatory" || status.kind === "mandatory_cached";

  if (isMandatory) {
    return (
      <KadeUpdateGate
        status={status}
        bytesDownloaded={bytesDownloaded}
        bytesTotal={bytesTotal}
        onRetry={onRetry ?? defaultRetry}
        onCopyDiagnostics={onCopyDiagnostics}
        onContactSupport={onContactSupport}
      />
    );
  }

  return <>{children}</>;
}
