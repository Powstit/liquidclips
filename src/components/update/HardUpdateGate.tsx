/**
 * HardUpdateGate · un-bypassable launch-time update enforcement
 *
 * The lesson from the v2.2.5 → v2.2.7 cycle: an installed binary can
 * silently drift far enough behind the manifest that the customer
 * experiences regressions we already shipped fixes for. The auto-updater
 * prompt was passive — users could dismiss it and keep running the
 * broken layout. This gate removes that bypass.
 *
 * Boot contract:
 *   1. Mount as the OUTERMOST wrapper around the app tree (above
 *      DesignOSAppShell + IntroSplash + everything else).
 *   2. On mount, fire one check() through lib/updater.ts.
 *   3. If `available` · render a full-viewport blocker on TOP of the
 *      app tree. The blocker has its own backdrop, owns pointer events,
 *      and exposes exactly ONE action: "Install Update & Relaunch".
 *   4. If `up-to-date` OR `error` (network blip, manifest 404, etc.) ·
 *      step out of the way and let the app render. We don't punish
 *      users for a transient backend hiccup — the gate fires the next
 *      launch when the network recovers.
 *
 * Design discipline:
 *   - Browser preview (Vite dev / Playwright) short-circuits to children
 *     immediately — no Tauri APIs available, and the e2e suites can't
 *     run if the gate captures every launch.
 *   - No "Skip for now" button. No close icon. No ESC handler. No
 *     click-outside-to-dismiss. The whole point is that the only path
 *     forward is the install button.
 *   - During download/install we surface progress so the user knows
 *     the app isn't frozen, but the gate itself still blocks input.
 *   - On install error we show the message + a Retry button. The user
 *     still cannot reach the app — the install must succeed.
 *
 * Visual language:
 *   - Dark cinematic backdrop (matches the Liquid Clips world bg
 *     vocabulary) with a fuchsia radial bloom so the gate feels like
 *     part of the brand and not a generic OS dialog.
 *   - Single content card centred on the viewport.
 *   - One primary CTA, brand-fuchsia, hover-glow.
 *   - Progress bar uses the same fuchsia gradient as the Wallet hero.
 *
 * Test seam:
 *   - `data-testid="hard-update-gate"` on the root overlay.
 *   - `data-testid="hard-update-install"` on the primary button.
 *   - `data-state` attribute reflects the current state-machine value
 *     so Playwright can assert the gate state without parsing copy.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Player } from "@remotion/player";
import {
  applyUpdate,
  checkForUpdate,
  type UpdateState,
} from "../../lib/updater";
import { UpdateKadeComposition, type UpdateKadeState } from "./UpdateKadeComposition";

type GateState =
  | { kind: "checking" }
  | { kind: "clear" }
  | UpdateState;

function isTauri(): boolean {
  return (
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function progressPct(state: GateState): number | null {
  if (state.kind !== "downloading") return null;
  if (state.total == null || state.total === 0) return null;
  return Math.min(100, Math.round((state.downloaded / state.total) * 100));
}

function kadeStateFor(state: GateState): UpdateKadeState {
  if (state.kind === "checking") return "checking";
  if (state.kind === "available") return "available";
  if (state.kind === "downloading") return "downloading";
  if (state.kind === "installing") return "installing";
  if (state.kind === "error") return "error";
  return "checking";
}

/* Demo mode · `?demoUpdateGate=1` in the URL forces the gate into
 * `available` state with a mock update so Daniel can walk through the
 * Kade + Remotion visual in `tauri dev` without needing a real manifest
 * bump. Nobody types this URL in prod · zero risk. */
function demoUpdateForced(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("demoUpdateGate") === "1";
  } catch {
    return false;
  }
}

const MOCK_UPDATE = {
  version: "2.2.28-demo",
  date: new Date().toISOString(),
  body: "Demo mode · this is a preview of the mandatory update gate",
} as unknown as UpdateState extends { kind: "available"; update: infer U } ? U : never;

export function HardUpdateGate({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  /* Short-circuit in browser preview · Playwright + Vite dev never
   * hit the Tauri updater plumbing, and a gate that captured every
   * page reload would block the entire e2e suite. Demo mode overrides
   * this so the visual is testable in a browser too. */
  if (!isTauri() && !demoUpdateForced()) return <>{children}</>;

  const [state, setState] = useState<GateState>(
    demoUpdateForced()
      ? { kind: "available", update: MOCK_UPDATE }
      : { kind: "checking" },
  );

  useEffect(() => {
    if (demoUpdateForced()) return;
    let cancelled = false;
    void (async () => {
      const result = await checkForUpdate();
      if (cancelled) return;
      if (result.kind === "available") {
        setState({ kind: "available", update: result.update });
      } else {
        /* up-to-date OR error · don't block. Error = transient (no
         * network, manifest 5xx). Locking the user out forever on a
         * single failed check would be worse than the regression we
         * are guarding against. The next launch re-checks. */
        setState({ kind: "clear" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* `checking` · render children. The IntroSplash already covers boot
   * paint, so the user never sees a blank screen. If the check resolves
   * to `available` before they can interact, the modal mounts on top
   * and intercepts every input via pointer-events on a fixed-position
   * backdrop. */
  if (state.kind === "checking" || state.kind === "clear") {
    return <>{children}</>;
  }

  /* States from this point: available · downloading · installing ·
   * error. All render the blocker. */
  return (
    <>
      {children}
      <Overlay state={state} setState={setState} />
    </>
  );
}

/* ──────── Overlay ──────── */

function Overlay({
  state,
  setState,
}: {
  state: GateState;
  setState: (next: GateState) => void;
}): React.ReactElement {
  const pct = progressPct(state);

  const onInstall = async () => {
    if (state.kind !== "available") return;
    const update = state.update;
    await applyUpdate(update, (next) => setState(next));
    /* applyUpdate calls relaunch() on success. We never reach here on
     * a happy path. If the OS prevented the relaunch (extremely rare —
     * usually a sandboxing edge case), the state machine sits at
     * `installing` and the user has to quit + reopen manually. */
  };

  const onRetry = () => {
    /* Drop back to the checking state so the user can re-hit the
     * primary button. The gate stays mounted, but a fresh check pulls
     * the latest manifest in case the previous failure was a partial
     * manifest write. */
    setState({ kind: "checking" });
    void (async () => {
      const result = await checkForUpdate();
      if (result.kind === "available") {
        setState({ kind: "available", update: result.update });
      } else if (result.kind === "up-to-date") {
        setState({ kind: "clear" });
      } else {
        setState(result);
      }
    })();
  };

  const ctaLabel =
    state.kind === "available"
      ? "Download update"
      : state.kind === "downloading"
        ? pct != null
          ? `Downloading · ${pct}%`
          : "Downloading…"
        : state.kind === "installing"
          ? "Installing · don't close the app"
          : state.kind === "error"
            ? "Retry install"
            : "Install Update & Relaunch";

  const subline =
    state.kind === "available"
      ? `New Liquid Clips ${state.update.version} is ready. Download to continue — the current build is missing required fixes.`
      : state.kind === "downloading"
        ? state.total != null
          ? `${fmtBytes(state.downloaded)} of ${fmtBytes(state.total)}`
          : `${fmtBytes(state.downloaded)} downloaded`
        : state.kind === "installing"
          ? "Writing the new build · Liquid Clips will relaunch in a moment."
          : state.kind === "error"
            ? state.message
            : "";

  const ctaDisabled =
    state.kind === "downloading" || state.kind === "installing";

  const ctaHandler =
    state.kind === "error" ? onRetry : onInstall;

  return (
    <div
      className="lc-hard-update-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lc-hard-update-title"
      data-testid="hard-update-gate"
      data-state={state.kind}
    >
      <style>{HARD_UPDATE_STYLES}</style>
      <div className="lc-hard-update-card">
        {/* Kade · Remotion composition loops indefinitely, swaps pose
            with gate state. Sits above the copy so the animation is
            the first thing the user sees on the gate. */}
        <div className="lc-hard-update-kade" aria-hidden="true">
          <Player
            component={UpdateKadeComposition}
            inputProps={{ state: kadeStateFor(state) }}
            durationInFrames={180}
            compositionWidth={360}
            compositionHeight={260}
            fps={30}
            loop
            autoPlay
            controls={false}
            style={{ width: "100%", height: "100%" }}
          />
        </div>
        <span className="lc-hard-update-eyebrow">Liquid Clips</span>
        <h1 className="lc-hard-update-title" id="lc-hard-update-title">
          Update Required
        </h1>
        <p className="lc-hard-update-sub" data-testid="hard-update-sub">
          {subline}
        </p>

        {pct != null && (
          <div
            className="lc-hard-update-progress"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="lc-hard-update-progress-fill"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        <button
          type="button"
          className="lc-hard-update-cta"
          data-testid="hard-update-install"
          onClick={() => {
            void ctaHandler();
          }}
          disabled={ctaDisabled}
          autoFocus
        >
          {ctaLabel}
        </button>

        <p className="lc-hard-update-foot">
          This safeguard ensures the latest signed build before you can
          use the app. Notarised by Apple · powered by the Liquid Clips
          updater.
        </p>
      </div>
    </div>
  );
}

/* ──────── Inline styles (self-contained · no extra CSS file) ──────── */

const HARD_UPDATE_STYLES = `
.lc-hard-update-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: grid;
  place-items: center;
  padding: 32px;
  background:
    radial-gradient(80% 70% at 50% 20%, rgba(255, 26, 140, 0.22), transparent 70%),
    linear-gradient(180deg, rgba(11, 11, 22, 0.97), rgba(20, 6, 18, 0.99));
  -webkit-backdrop-filter: blur(18px) saturate(140%);
          backdrop-filter: blur(18px) saturate(140%);
  pointer-events: auto;
  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  animation: lc-hard-update-fade-in 220ms ease-out;
}

@keyframes lc-hard-update-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.lc-hard-update-card {
  position: relative;
  width: 100%;
  max-width: 520px;
  padding: 36px 36px 28px;
  border-radius: 22px;
  border: 1px solid rgba(255, 26, 140, 0.34);
  background:
    linear-gradient(180deg, rgba(22, 18, 30, 0.94), rgba(14, 11, 20, 0.92));
  box-shadow:
    0 30px 80px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(255, 26, 140, 0.08) inset,
    0 60px 100px -40px rgba(255, 26, 140, 0.30);
  text-align: left;
  color: #f4f1ea;
}

.lc-hard-update-kade {
  position: relative;
  width: 100%;
  height: 220px;
  margin: -8px 0 18px;
  border-radius: 18px;
  overflow: hidden;
  background: transparent;
  pointer-events: none;
}

.lc-hard-update-eyebrow {
  display: block;
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #ff66b8;
  margin-bottom: 14px;
}

.lc-hard-update-title {
  margin: 0 0 12px;
  font-family: var(--font-display, "Geist", -apple-system, sans-serif);
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #f4f1ea;
}

.lc-hard-update-sub {
  margin: 0 0 22px;
  font-size: 14px;
  line-height: 1.5;
  color: #c8c4be;
}

.lc-hard-update-progress {
  position: relative;
  width: 100%;
  height: 8px;
  margin: 0 0 22px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.lc-hard-update-progress-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(90deg, #ff1a8c, #ff66b8);
  border-radius: 999px;
  transition: width 220ms ease;
}

.lc-hard-update-cta {
  display: block;
  width: 100%;
  padding: 14px 18px;
  border: 0;
  border-radius: 14px;
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0;
  color: #ffffff;
  background: linear-gradient(180deg, #ff1a8c, #d40d70);
  box-shadow:
    0 8px 22px rgba(255, 26, 140, 0.35),
    0 0 0 1px rgba(255, 255, 255, 0.06) inset;
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
}

.lc-hard-update-cta:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow:
    0 12px 28px rgba(255, 26, 140, 0.45),
    0 0 0 1px rgba(255, 255, 255, 0.10) inset;
}

.lc-hard-update-cta:disabled {
  opacity: 0.72;
  cursor: progress;
}

.lc-hard-update-foot {
  margin: 18px 0 0;
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: #86837e;
  line-height: 1.5;
}
`;
