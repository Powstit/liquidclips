/**
 * ComposerRoute · the ONE composer entry.
 *
 * ⛔ IRON GATE IG-COMPOSER-REGIONS · LOCKED 2026-07-22 · Sprint 5-region
 * ─────────────────────────────────────────────────────────────────
 * The Composer surface is the highest-impact route in the product —
 * clippers spend 90% of their session here. This route enforces the
 * VSCode Workbench + Fluent 2 base+content 5-region contract:
 *
 *   1) TopBar (48px)          [data-testid="composer-topbar"]
 *   2) ActivityBar (48px)     [data-testid="composer-activitybar"]
 *   3) Editor Canvas (fluid)  [data-testid="composer-canvas"]
 *   4) Right Panel (280px)    [data-testid="composer-rightpanel"]
 *   5) Bottom Panel (240px)   [data-testid="composer-bottompanel"]
 *   6) Status Bar (22px)      [data-testid="composer-statusbar"]
 *
 * Hard rules:
 *   L4 · Kade lives at the AppShell level (StickyKade). Composer
 *        NEVER mounts its own KadeSpeechBubble / KadePanel /
 *        StickyKade / KadeController subtree instance.
 *   L6 · Base Window JSON panel · ASK TESTS chips · REMOTE ACTIVE
 *        pill are dev-only. Gated behind `?dev=1` OR
 *        `import.meta.env.DEV`. Customer builds never see them.
 *   L7 · Exactly ONE primary CTA · verb-first ("Get clips").
 *        Every secondary action lives in the Bottom Panel tabs and
 *        must be ghost/outline styled.
 *
 * Legacy shells (SimpleComposerShell · MasterComposerShell ·
 * ComposerSuiteFrame) remain on disk for the 12-guard IG-COMPOSER-
 * MODE-SWAP contract (sentinel below), and are reachable via
 * `localStorage.lc.composer.legacy=1` (MasterComposerShell) or
 * `localStorage.lc.composer.suite=1` (ComposerSuiteFrame) for
 * debugging. Default entry hits ComposerWorkbench.
 *
 * ⛔ IRON GATE IG-COMPOSER-MODE-SWAP · Sprint 2.5 · retained.
 *    ComposerRoute continues to derive the target shell from
 *    `isComposerEngaged(useComposerSession)` and animate transitions
 *    via `document.startViewTransition`. See lint-composer-mode-swap.sh.
 *
 * Related gates: IG-COMPOSER-A · IG-COMPOSER-HOSTED-INTENT ·
 * IG-COMPOSER-MODE-SWAP · IG-COMPOSER-VISUAL · IG-COMPOSER-MISS-DIAG ·
 * IG-COCKPIT-DRIVETRAIN · IG-COCKPIT-EDITOR-WIRES · IG-COCKPIT-LAUNCH-
 * POLISH · IG-COCKPIT-SUCCESS-STATE · IG-COCKPIT-CAMPAIGN-WIRES ·
 * IG-COCKPIT-SCREEN-RECORDING · IG-COCKPIT-COMING-SOON-GUARD ·
 * IG-KADE-BUBBLE-ACTIONABLE — all must still pass.
 *
 * 2026-07-22 · Sprint composer-5-region (supersedes Sprint 2.5)
 */

import { type ReactElement, useEffect, useState } from "react";
import { useComposerSession, isComposerEngaged } from "../state/useComposerSession";
import { useComposerBrain, type ComposerBrain } from "./useComposerBrain";
import { SimpleComposerShell } from "./SimpleComposerShell";
import { MasterComposerShell } from "./MasterComposerShell";
import { ComposerSuiteFrame } from "./ComposerSuiteFrame";
import { ComposerWorkbench } from "./composer/ComposerWorkbench";
import { useBrainRegistry } from "../../lib/composerBrainRegistry";
import { CelebrationFlash } from "../components/CelebrationFlash";
import { CompletionChime } from "../components/CompletionChime";
import "./ComposerRoute.css";

// View Transitions API is already typed in the DOM lib since TS 5.6 —
// we just call it defensively (browsers without it fall back to a plain
// setState, no animation). No custom declare-global needed.

/**
 * IG-COMPOSER-REGIONS · L6 dev-view gate.
 *
 * Verbatim from the sprint contract — customer builds must NEVER
 * render the Base Window JSON panel, the ASK TESTS chip strip, or the
 * REMOTE ACTIVE pill. Two independent unlocks so QA can flip either
 * without a rebuild:
 *   1. `?dev=1` in the URL (deep link · staff can share)
 *   2. `import.meta.env.DEV` at build time (Vite dev server)
 *
 * Referenced from lint-composer-regions.sh guard #2/#3/#4 — do not
 * rename the identifier without updating the grep.
 */
function useIsDevView(): boolean {
  const [isDev, setIsDev] = useState<boolean>(() => resolveIsDev());
  useEffect(() => {
    // If the user pastes `?dev=1` after mount (deep link into an
    // already-open shell) we still want the dev regions to appear.
    const onHash = () => setIsDev(resolveIsDev());
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
    };
  }, []);
  return isDev;
}

function resolveIsDev(): boolean {
  if (typeof location === "undefined") return false;
  if (location.search.includes("dev=1")) return true;
  if (location.hash.includes("dev=1")) return true;
  const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  return env?.DEV === true;
}

export function ComposerRoute(): ReactElement {
  const brain = useComposerBrain();
  const engaged = useComposerSession((s) => isComposerEngaged(s));
  const [displayedShell, setDisplayedShell] = useState<"idle" | "engaged">(engaged ? "engaged" : "idle");

  // 2026-07-22 · Sprint remote-1a · register brain in the global
  // registry so useRemoteControl (mounted app-wide in AppShell) can
  // dispatch commands into this composer.
  const setBrain = useBrainRegistry((s) => s.setBrain);
  useEffect(() => {
    setBrain(brain);
    return () => setBrain(null);
  }, [brain, setBrain]);

  // Native View Transitions API · swap the DOM inside a callback so the
  // browser captures old/new frames and morphs shared elements between them.
  useEffect(() => {
    const target: "idle" | "engaged" = engaged ? "engaged" : "idle";
    if (target === displayedShell) return;
    if (typeof document.startViewTransition === "function") {
      const tx = document.startViewTransition(() => {
        setDisplayedShell(target);
      });
      void tx.finished;
    } else {
      setDisplayedShell(target);
    }
  }, [engaged, displayedShell]);

  const isDev = useIsDevView();

  // 2026-07-22 · Sprint 5-region · default rendering path is the new
  // ComposerWorkbench. Legacy shells stay reachable via localStorage
  // opt-in flags so devs can compare visually while the redesign lands.
  //
  //   `lc.composer.legacy=1`  → MasterComposerShell (old engaged shell)
  //   `lc.composer.suite=1`   → ComposerSuiteFrame  (iframe mockup suite)
  //
  // Both flags are DEV-DIAGNOSTIC ONLY. Customer builds never flip them.
  const legacyChoice = (() => {
    try {
      const ls = window.localStorage;
      if (ls.getItem("lc.composer.suite") === "1") return "suite";
      if (ls.getItem("lc.composer.legacy") === "1") return "legacy";
      return "workbench";
    } catch { return "workbench"; }
  })();

  return (
    <div className="lc-composer-route" data-shell={displayedShell} data-composer-mode={legacyChoice}>
      {legacyChoice === "workbench" ? (
        // IG-COMPOSER-REGIONS · default entry · 5-region workbench.
        // Renders both idle + engaged states inside the same layout so
        // clippers stop losing spatial context on submit.
        <ComposerWorkbench brain={brain} engaged={displayedShell === "engaged"} isDev={isDev} />
      ) : displayedShell === "idle" ? (
        <SimpleComposerShell brain={brain} />
      ) : legacyChoice === "legacy" ? (
        <MasterComposerShell brain={brain} />
      ) : (
        <ComposerSuiteFrame brain={brain} />
      )}
      {/* CelebrationFlash listens on `composer:celebrate` and pops
       *  kade-celebration.webp for 800ms. Mounts once at the route
       *  level so it survives shell swaps. */}
      <CelebrationFlash />
      {/* Web Audio 2-note arpeggio on celebrate + subtle tick on stage
       *  transitions. Zero shipped audio assets — synthesised at runtime. */}
      <CompletionChime />
    </div>
  );
}

export type { ComposerBrain };
export default ComposerRoute;
