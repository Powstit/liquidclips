import { useEffect, useId, useRef, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import invaderSrc from "../assets/icons/connections/library-bug.png";

// ──────────────────────────────────────────────────────────────────────
// SidecarCrashOverlay
//
// Full-screen `position: fixed inset-0 z-[300]` overlay shown when the
// Python sidecar dies underneath the desktop app. The sidecar process
// is what powers every pipeline RPC — once it's gone the UI can't ingest,
// transcribe, cut, reframe, or read projects. So instead of letting the
// user keep clicking inert buttons we surface a clear, single moment:
//
//   "Liquid Clips needs to restart."
//   Restart Liquid Clips (primary) | Try to continue (secondary)
//
// "Try to continue" is intentional — the user may have an in-progress
// preview/playback that doesn't need RPC and we don't want to bulldoze
// them. They get reduced functionality until they restart manually.
//
// Wiring: this component listens for the `subscribeSidecarDied` event
// being added (in parallel by another agent) to `lib/sidecar.ts`. It
// accepts an optional `{ recovered: true }` payload that auto-dismisses
// the overlay if the sidecar comes back on its own. The subscription is
// feature-detected so this file compiles + runs even before the helper
// lands.
//
// Mount once at the top of App.tsx, alongside the CrashBoundary / toast
// host. Zero props.
// ──────────────────────────────────────────────────────────────────────

type CrashEvent = {
  exit_code?: number | null;
  recovered?: boolean;
};

export function SidecarCrashOverlay() {
  const [crashed, setCrashed] = useState<CrashEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const restartBtnRef = useRef<HTMLButtonElement | null>(null);
  const headlineId = useId();

  // Subscribe to the sidecar-died bus. The helper is being added in a
  // parallel diff to lib/sidecar.ts; if it isn't there yet, we silently
  // degrade so this component never crashes the app.
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const mod = (await import("../lib/sidecar")) as Record<string, unknown>;
        const fn = mod["subscribeSidecarDied"];
        if (typeof fn !== "function") return;
        if (cancelled) return;
        const result = (fn as (cb: (info: CrashEvent) => void) => unknown)(
          (info: CrashEvent) => {
            if (info && info.recovered) {
              // Defensive contract — if the sidecar bus emits a recovery
              // ping after a transient blip, auto-dismiss the overlay so
              // the user isn't trapped staring at a dead screen.
              setCrashed(null);
              setDismissed(false);
              setRestarting(false);
              return;
            }
            setCrashed(info ?? {});
            setDismissed(false);
          },
        );
        if (typeof result === "function") {
          unsub = result as () => void;
        }
      } catch {
        // sidecar.ts may not export subscribeSidecarDied yet — silently
        // degrade. Once the helper lands this branch will activate.
      }
    })();

    return () => {
      cancelled = true;
      if (unsub) {
        try {
          unsub();
        } catch {
          /* swallow — bus cleanup is best-effort */
        }
      }
    };
  }, []);

  const visible = crashed !== null && !dismissed;

  // Focus the primary action on open so Enter triggers Restart even before
  // the user touches the keyboard.
  useEffect(() => {
    if (!visible) return;
    const id = window.setTimeout(() => {
      restartBtnRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(id);
  }, [visible]);

  // Keyboard: Esc → "Try to continue" (matches secondary button); Enter or
  // Cmd-R → Restart. Captured at the window level so the overlay is the
  // top-priority shortcut target while it's mounted.
  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        doRestart();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        doRestart();
        return;
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // doRestart only reads setState — stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function doRestart() {
    if (restarting) return;
    setRestarting(true);
    // relaunch() resolves by quitting + restarting the process. If for any
    // reason it rejects (sandbox, dev mode), we surface the failure as a
    // toast and clear the restarting flag so the user can try again.
    relaunch().catch((err: unknown) => {
      setRestarting(false);
      const message =
        err instanceof Error ? err.message : "Couldn't relaunch — quit and reopen manually.";
      try {
        window.dispatchEvent(
          new CustomEvent("lc:toast", {
            detail: { kind: "error", message },
          }),
        );
      } catch {
        /* no-op */
      }
    });
  }

  if (!visible) return null;

  const exitCode = crashed?.exit_code;
  const exitCodeLabel =
    exitCode === undefined || exitCode === null ? "unknown" : String(exitCode);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={headlineId}
      className="fixed inset-0 z-[300] grid place-items-center"
    >
      {/* Backdrop — paper at 80% opacity, blur for depth. Click does NOT
          dismiss; the user must make an explicit choice. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-paper/80 backdrop-blur-md"
      />

      {/* Centered card — cockpit-frame styling with fuchsia HUD brackets. */}
      <div className="relative w-[min(560px,92vw)] rounded-2xl bg-paper-elev/95 p-7 shadow-[0_24px_80px_rgba(255,26,140,0.25)]">
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />

        <div className="flex flex-col items-center text-center">
          <img
            src={invaderSrc}
            alt=""
            aria-hidden="true"
            width={96}
            height={96}
            className="h-24 w-24 object-contain"
            style={{ filter: "drop-shadow(0 8px 24px rgba(255,26,140,0.55))" }}
          />

          <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia-deep">
            sidecar offline
          </div>

          <h2
            id={headlineId}
            className="mt-2 font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink"
          >
            Liquid Clips needs to restart
          </h2>

          <p className="mt-3 max-w-[420px] font-sans text-[14px] leading-relaxed text-text-secondary">
            The processing helper stopped responding. Your projects are safe on
            disk. Click Restart to reload — your library will be exactly as you
            left it.
          </p>

          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            Exit code: {exitCodeLabel}
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <button
              ref={restartBtnRef}
              onClick={doRestart}
              disabled={restarting}
              className="rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[14px] font-medium text-white transition-all hover:bg-fuchsia-bright disabled:cursor-not-allowed disabled:opacity-60"
            >
              {restarting ? "Restarting…" : "Restart Liquid Clips"}
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="rounded-full border border-line bg-transparent px-4 py-2 font-sans text-[13px] font-medium text-text-secondary hover:border-fuchsia hover:text-fuchsia-deep"
            >
              Try to continue
            </button>
          </div>

          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            Enter to restart · Esc to continue
          </p>
        </div>
      </div>

      {/* prefers-reduced-motion: skip slide-in fade so users with motion
          sensitivity don't get an unexpected animation on a panic screen. */}
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          [role="alertdialog"] > div:last-of-type {
            animation: lc-sidecar-crash-in 220ms ease-out;
          }
        }
        @keyframes lc-sidecar-crash-in {
          from { opacity: 0; transform: translateY(6px) scale(0.985); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
