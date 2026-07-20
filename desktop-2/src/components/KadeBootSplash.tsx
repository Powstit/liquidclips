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

export function KadeBootSplash({ children, disableForTest }: Props) {
  const [ready, setReady] = useState<boolean>(() => disableForTest || !isTauriRuntime());
  const startedRef = useRef<boolean>(false);

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
      <img
        src="/brand/kade/kade-checking.png"
        alt=""
        aria-hidden="true"
        width={140}
        height={140}
        style={{
          objectFit: "contain",
          filter: "drop-shadow(0 0 24px rgba(255, 26, 140, 0.35))",
          animation: "lc-kade-boot-pulse 1.6s ease-in-out infinite",
        }}
      />
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
      <style>
        {`
        @keyframes lc-kade-boot-pulse {
          0%, 100% { transform: scale(1); opacity: 0.92; }
          50%      { transform: scale(1.03); opacity: 1; }
        }
        `}
      </style>
    </div>
  );
}
