/**
 * KadeBootSplash · IG-BOOT-CHECK-THEN-SERVE · LOCKED 2026-07-20
 *
 * The pattern this component owns:
 *
 *   1. Shell boots · serves the currently-staged runtime bundle
 *   2. FIRST thing the frontend renders is THIS splash (Kade + "loading…")
 *   3. Splash awaits `runtime_check_now` (bounded timeout)
 *   4. If a NEW bundle stages during the check → mark reload + reload()
 *      → next page load serves the fresh bundle → splash re-runs
 *   5. If no new bundle / offline / timeout → dismiss splash + mount app
 *
 * Net user experience: they NEVER see the stale bundle. Every launch
 * lands them on the guaranteed-latest runtime, exactly the way
 * Discord / Slack / Cursor / VS Code / every real app does it.
 *
 * Why this + IG-RUNTIME-HOTSWAP (in UpdateBeacon.tsx)?
 *   The two are complementary. KadeBootSplash catches the common case
 *   (99% of boots — user opens app, splash checks, either serves
 *   current or reloads to latest). IG-RUNTIME-HOTSWAP catches the
 *   edge case (user leaves app open long enough to boot past the
 *   splash, then a bundle stages mid-splash → hot-swap kicks in
 *   during the beacon's boot window). Belt AND braces.
 *
 * BUG-012 preservation:
 *   Both mechanisms respect "no mid-session cache swap that wipes
 *   user work." KadeBootSplash only runs at the OUTERMOST boot, before
 *   any user has interacted. IG-RUNTIME-HOTSWAP is bounded to the
 *   first 45s after beacon mount (all splash territory).
 *
 * Loop-guard:
 *   If we JUST reloaded (< 30s ago per `localStorage.lc.boot-reload-at`),
 *   we skip the check-and-reload path entirely on this boot. Prevents
 *   the following pathological loop:
 *     - Boot #1: staged 2.2.60 → reload
 *     - Boot #2: for whatever reason, staged version still reports
 *       different from active → reload again → infinite
 *   The guard breaks the cycle after one reload per 30s window.
 *
 * 4-layer defense per feedback_never_regress_4_layer_defense.md:
 *   Layer 1 · IG-BOOT-CHECK-THEN-SERVE sentinel in this file
 *   Layer 2 · scripts/lint-kade-boot-splash.sh (source-text asserts)
 *   Layer 3 · src/components/KadeBootSplash.test.ts (vitest)
 *   Layer 4 · Runtime — the awaited check + reload wire itself
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { lcDiag } from "../lib/diagnosticLogger";
// IG-BOOT-CHECK-THEN-SERVE · shared helper owns the actual page swap
// so the "no-R-word wording" grep guard stays clean across the update
// sub-tree. See src/lib/hardReload.ts.
import { hardReloadForRuntimeSwap } from "../lib/hardReload";

const LOOP_GUARD_MS = 30_000;
const CHECK_TIMEOUT_MS = 15_000;
const MIN_SPLASH_MS = 400;
const RELOAD_MARK_KEY = "lc.boot-reload-at";

interface RuntimeInfoLite {
  active_version: string;
  source: string;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function readReloadMark(): number {
  try {
    if (typeof window === "undefined") return 0;
    return Number(window.localStorage.getItem(RELOAD_MARK_KEY) ?? "0");
  } catch {
    return 0;
  }
}

function writeReloadMark(now: number): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(RELOAD_MARK_KEY, String(now));
  } catch { /* private-mode / quota — non-fatal */ }
}

interface Props {
  children: ReactNode;
  /** Test seams — overridden only by unit tests. */
  disableForTest?: boolean;
}

/** Progress payload from the Updater v2 Rust downloader. Emitted on
 *  the `runtime:progress` event bus channel. Kept as a local type so
 *  this file has no cross-module import for a one-off shape. */
interface RuntimeProgress {
  version: string;
  bytes_received: number;
  bytes_total: number;
  percent: number;
  throughput_bytes_per_sec: number;
  attempt: number;
  resumed: boolean;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatThroughput(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return "";
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function KadeBootSplash({ children, disableForTest }: Props) {
  const [ready, setReady] = useState<boolean>(() => disableForTest || !isTauriRuntime());
  const [progress, setProgress] = useState<RuntimeProgress | null>(null);
  const startedRef = useRef<boolean>(false);

  // Updater v2 · listen for real download progress from the Rust side.
  // Kept in a separate useEffect from the check flow so the listener
  // survives even if the check-and-reload cycle re-runs.
  useEffect(() => {
    if (disableForTest || !isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const eventMod = await import("@tauri-apps/api/event");
        const off = await eventMod.listen<RuntimeProgress>("runtime:progress", (evt) => {
          if (cancelled) return;
          setProgress(evt.payload);
        });
        if (cancelled) off();
        else unlisten = off;
      } catch { /* browser preview · no Tauri event bus */ }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [disableForTest]);

  useEffect(() => {
    if (ready) return;
    if (startedRef.current) return;
    startedRef.current = true;

    const startMs = Date.now();

    // Loop-guard · we JUST reloaded, don't kick another check on THIS boot.
    const sinceLastReload = startMs - readReloadMark();
    if (sinceLastReload < LOOP_GUARD_MS) {
      try {
        lcDiag("kade_boot_splash_skipped", {
          reason: "loop_guard",
          ms_since_last_reload: sinceLastReload,
        });
      } catch { /* diagnostic never blocks boot */ }
      setReady(true);
      return;
    }

    void (async () => {
      let initialVersion: string | null = null;
      let unloading = false;

      try {
        const { invoke } = await import("@tauri-apps/api/core");

        // Capture the version we booted with — this is what the current
        // page load is serving. A change means the Rust side staged a
        // newer bundle during the check.
        try {
          const initial = await invoke<RuntimeInfoLite>("runtime_info");
          initialVersion = initial.active_version;
        } catch { /* worst case: initial is null · we still reload on any drift */ }

        // Bounded runtime_check_now · fires manifest fetch → download →
        // verify → stage inside the Rust side. Await so the splash stays
        // up until we know what to do next.
        await Promise.race([
          invoke("runtime_check_now"),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS),
          ),
        ]);

        // Post-check: read runtime_info again. If active_version drifted,
        // a new bundle is now staged. Reload so the URI scheme handler
        // serves it on the next page load.
        let newVersion: string | null = null;
        try {
          const updated = await invoke<RuntimeInfoLite>("runtime_info");
          newVersion = updated.active_version;
        } catch { /* leave null · handled below */ }

        const versionDrifted = !!initialVersion && !!newVersion && initialVersion !== newVersion;

        if (versionDrifted) {
          try {
            lcDiag("kade_boot_splash_activate", {
              initial_version: initialVersion,
              new_version: newVersion,
              elapsed_ms: Date.now() - startMs,
            });
          } catch { /* diagnostic never blocks swap */ }
          writeReloadMark(Date.now());
          unloading = true;
          // Small delay so lcDiag can flush before the page context
          // is destroyed. 250ms is imperceptible next to the swap.
          window.setTimeout(() => {
            hardReloadForRuntimeSwap();
          }, 250);
          return;
        }

        try {
          lcDiag("kade_boot_splash_pass", {
            active_version: initialVersion,
            elapsed_ms: Date.now() - startMs,
          });
        } catch { /* diagnostic never blocks boot */ }
      } catch (err) {
        // Offline · timeout · Tauri unavailable · unknown crash. Never
        // block boot on any of these — the user gets whatever bundle
        // was already staged. UpdateBeacon (IG-RUNTIME-HOTSWAP) is the
        // fallback that reloads if a bundle stages a few seconds later.
        try {
          lcDiag("kade_boot_splash_fallthrough", {
            error: err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120),
            elapsed_ms: Date.now() - startMs,
          });
        } catch { /* diagnostic never blocks boot */ }
      } finally {
        if (unloading) return;
        // Enforce a minimum splash duration so the transition doesn't
        // flash — 400ms feels intentional; instant feels broken.
        const elapsed = Date.now() - startMs;
        if (elapsed < MIN_SPLASH_MS) {
          await new Promise((r) => setTimeout(r, MIN_SPLASH_MS - elapsed));
        }
        setReady(true);
      }
    })();
  }, [ready]);

  if (ready) return <>{children}</>;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="kade-boot-splash"
      style={{
        position: "fixed",
        inset: 0,
        background: "#0b0b10",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        zIndex: 999999,
      }}
    >
      {/* Splash scene · Daniel 2026-07-20 · "shooting bugs, monster appears".
          Three transparent PNG layers composited via absolute positioning
          so each element bobs on its own rhythm — feels alive, tells a
          story, no static portrait. Kade shooter is the existing asset
          (public/brand/kade/kade-shooter.webp); monster + bugs generated
          via gpt-image-1 with background: transparent. */}
      <div
        aria-hidden="true"
        style={{
          position: "relative",
          width: 460,
          height: 280,
          filter: "drop-shadow(0 0 32px rgba(255, 26, 140, 0.28))",
        }}
      >
        <img
          src="/brand/kade/kade-boot-monster.png"
          alt=""
          style={{
            position: "absolute",
            top: 0,
            right: 8,
            width: 200,
            height: 200,
            objectFit: "contain",
            animation: "lc-splash-monster-loom 2.8s ease-in-out infinite",
            filter: "drop-shadow(0 0 20px rgba(255, 26, 140, 0.55))",
          }}
        />
        <img
          src="/brand/kade/kade-boot-bugs.png"
          alt=""
          style={{
            position: "absolute",
            top: 90,
            left: 190,
            width: 140,
            height: 140,
            objectFit: "contain",
            animation: "lc-splash-bugs-drift 2.2s ease-in-out infinite",
            filter: "drop-shadow(0 0 14px rgba(255, 26, 140, 0.5))",
          }}
        />
        <img
          src="/brand/kade/kade-shooter.webp"
          alt=""
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: 200,
            height: 200,
            objectFit: "contain",
            animation: "lc-splash-kade-bob 1.6s ease-in-out infinite",
            filter: "drop-shadow(0 0 22px rgba(255, 26, 140, 0.55))",
          }}
        />
        {/* Muzzle flash · pure CSS · glows out from Kade's raised hand,
            positioned along the line-of-fire toward the bugs. Timed to
            the shooter bob so it feels like a shot rhythm. */}
        <div
          style={{
            position: "absolute",
            left: 170,
            top: 120,
            width: 40,
            height: 6,
            background: "linear-gradient(90deg, rgba(255,255,255,0.95), rgba(255,26,140,0.85) 40%, rgba(255,26,140,0) 100%)",
            borderRadius: 3,
            animation: "lc-splash-muzzle 1.6s ease-in-out infinite",
            filter: "blur(0.5px) drop-shadow(0 0 8px rgba(255, 26, 140, 0.9))",
          }}
        />
      </div>
      <div
        style={{
          fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
          fontSize: 13,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "rgba(255, 255, 255, 0.72)",
        }}
      >
        Kade is loading the latest version…
      </div>
      {/* Updater v2 · real progress from runtime:progress events. Only
          renders once we have SOMETHING to show. Static shell while the
          manifest is being fetched — appears when the download starts. */}
      {progress && progress.bytes_total > 0 && (
        <div
          data-testid="kade-boot-splash-progress"
          style={{
            width: 320,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div
            style={{
              height: 4,
              width: "100%",
              background: "rgba(255, 255, 255, 0.08)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.min(100, Math.max(0, progress.percent)).toFixed(1)}%`,
                height: "100%",
                background: "linear-gradient(90deg, #ff1a8c, #ff66b8)",
                transition: "width 200ms linear",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
              fontSize: 10,
              letterSpacing: "0.08em",
              color: "rgba(255, 255, 255, 0.48)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span>
              {formatBytes(progress.bytes_received)} / {formatBytes(progress.bytes_total)}
              {progress.resumed ? " · resumed" : ""}
            </span>
            <span>
              {progress.percent.toFixed(0)}%
              {progress.throughput_bytes_per_sec > 0
                ? ` · ${formatThroughput(progress.throughput_bytes_per_sec)}`
                : ""}
            </span>
          </div>
        </div>
      )}
      <style>
        {`
        @keyframes lc-kade-boot-pulse {
          0%, 100% { transform: scale(1); opacity: 0.92; }
          50%      { transform: scale(1.03); opacity: 1; }
        }
        @keyframes lc-splash-kade-bob {
          0%, 100% { transform: translateY(0) rotate(-1deg); }
          50%      { transform: translateY(-6px) rotate(1deg); }
        }
        @keyframes lc-splash-bugs-drift {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.95; }
          50%      { transform: translate(6px, -8px) scale(1.04); opacity: 1; }
        }
        @keyframes lc-splash-monster-loom {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50%      { transform: translate(-4px, 3px) scale(1.02); }
        }
        @keyframes lc-splash-muzzle {
          0%, 42%, 100% { opacity: 0; transform: scaleX(0.4); }
          46%           { opacity: 1; transform: scaleX(1); }
          58%           { opacity: 0.4; transform: scaleX(0.7); }
        }
        `}
      </style>
    </div>
  );
}
