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
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  applyUpdate,
  checkForUpdate,
  quitForManualRelaunch,
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

function fmtRate(bps: number): string {
  return `${fmtBytes(bps)}/s`;
}

// Rough, honest ETA — never shown with false precision (no seconds
// countdown that visibly lies as the real rate fluctuates). "About N
// minutes" reads as an estimate; a ticking mm:ss clock reads as a
// promise this connection can't necessarily keep.
function fmtEta(remainingBytes: number, rateBps: number): string | null {
  if (rateBps <= 0) return null;
  const seconds = remainingBytes / rateBps;
  if (seconds < 40) return "less than a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"} left`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? "" : "s"} left`;
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
  // Blocking, but not a failure in the "something broke" sense — reuses
  // the error pose since there's no dedicated asset for this state and
  // it's visually the right register (the gate needs the user to act).
  if (state.kind === "relocate-required") return "error";
  // The update succeeded — this is a "just needs a manual restart" state,
  // not a failure, so it gets the same settled/positive pose as a
  // download that's already available rather than the error pose.
  if (state.kind === "relaunch-required") return "available";
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
    /* applyUpdate calls relaunch() on success. We never reach here on the
     * happy path. If the OS prevented the relaunch, applyUpdate catches
     * it internally and reports `relaunch-required` — handled below, not
     * a silent freeze. */
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

  // 2026-09-03 · relocate-required — the running app lives on a different
  // filesystem/volume than the updater's staging temp dir (see
  // updater_safety.rs), most commonly because it's running straight from
  // a mounted DMG. We never attempted a download for this state, so
  // there's no partial-download cleanup to do — just help the user move
  // the app and let them re-check once they have.
  const onReveal = async () => {
    if (state.kind !== "relocate-required") return;
    try {
      await revealItemInDir(state.appPath);
    } catch {
      /* Finder reveal failing (rare) shouldn't block the fallback below. */
    }
  };

  const onOpenApplications = async () => {
    try {
      await openPath("/Applications");
    } catch {
      /* best-effort — the reveal action above is the primary path */
    }
  };

  const onQuit = () => {
    void quitForManualRelaunch();
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
          : state.kind === "relocate-required"
            ? "Reveal Liquid Clips in Finder"
            : state.kind === "relaunch-required"
              ? "Quit Liquid Clips"
              : state.kind === "error"
                ? "Retry install"
                : "Install Update & Relaunch";

  const subline =
    state.kind === "available"
      ? `New Liquid Clips ${state.update.version} is ready. Download to continue — the current build is missing required fixes.`
      : state.kind === "downloading"
        ? (() => {
            const bytes =
              state.total != null
                ? `${fmtBytes(state.downloaded)} of ${fmtBytes(state.total)}`
                : `${fmtBytes(state.downloaded)} downloaded`;
            const remaining = state.total != null ? state.total - state.downloaded : null;
            const eta =
              state.rateBps && remaining != null && remaining > 0
                ? fmtEta(remaining, state.rateBps)
                : null;
            const rateAndEta = state.rateBps
              ? [fmtRate(state.rateBps), eta].filter(Boolean).join(" · ")
              : null;

            // A retry after a network blip resets byte progress to 0 —
            // without this, that looks identical to a fresh stall instead
            // of visible self-recovery. See updater.ts's retry loop.
            const retryPrefix =
              state.attempt && state.attempt > 1
                ? `Reconnecting after a network hiccup — attempt ${state.attempt} of ${state.maxAttempts} · `
                : "";

            // The soft stall hint (see updater.ts's DOWNLOAD_STALL_HINT_MS)
            // fires well before the hard idle timeout gives up — this is
            // the difference between "looks frozen" and "visibly still
            // trying" during a slow-but-alive stretch on a bad connection.
            if (state.stalling) {
              return `${retryPrefix}${bytes} · still trying — your connection may be slow.`;
            }
            return `${retryPrefix}${bytes}${rateAndEta ? ` · ${rateAndEta}` : ""}`;
          })()
        : state.kind === "installing"
          ? "Writing the new build · Liquid Clips will relaunch in a moment."
          : state.kind === "relocate-required"
            ? "Liquid Clips needs to be moved to your Applications folder before it can update."
            : state.kind === "relaunch-required"
              ? "Liquid Clips has been updated. Quit and reopen the app to finish."
              : state.kind === "error"
                ? state.message
                : "";

  const errorDetail = state.kind === "error" ? state.detail : undefined;

  const ctaDisabled =
    state.kind === "downloading" || state.kind === "installing";

  const ctaHandler =
    state.kind === "error"
      ? onRetry
      : state.kind === "relocate-required"
        ? onReveal
        : state.kind === "relaunch-required"
          ? onQuit
          : onInstall;

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

        {/* Technical detail, never the headline — see friendlyError() in
            lib/updater.ts. Keeps a genuinely new/unexpected failure fully
            visible for support without ever being the first (or scariest)
            thing a user reads. */}
        {errorDetail && errorDetail !== subline && (
          <p className="lc-hard-update-detail" data-testid="hard-update-detail">
            {errorDetail}
          </p>
        )}

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

        {state.kind === "relocate-required" && (
          <div className="lc-hard-update-secondary" data-testid="hard-update-relocate-actions">
            <button
              type="button"
              className="lc-hard-update-link"
              onClick={() => {
                void onOpenApplications();
              }}
            >
              Open Applications folder
            </button>
            <span aria-hidden="true"> · </span>
            <button
              type="button"
              className="lc-hard-update-link"
              data-testid="hard-update-relocate-recheck"
              onClick={onRetry}
            >
              I've moved it — check again
            </button>
          </div>
        )}

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

.lc-hard-update-detail {
  margin: -14px 0 22px;
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: #86837e;
  word-break: break-word;
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

.lc-hard-update-secondary {
  margin: 12px 0 0;
  text-align: center;
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 12px;
  color: #86837e;
}

.lc-hard-update-link {
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  color: #ff8cc4;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.lc-hard-update-link:hover {
  color: #ff66b8;
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
