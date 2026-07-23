/**
 * ComposerRoute · the ONE composer entry.
 *
 * Renders SimpleComposer when idle (pristine · no history · no session)
 * and MasterComposer when engaged (any submitted command, in-flight run,
 * source picker up, or clip results). Transition uses the native View
 * Transitions API so Kade morphs between positions and panels bloom in.
 *
 * ⛔ IRON GATE IG-COMPOSER-MODE-SWAP · this route MUST host the brain
 *    exactly once and render exactly one shell at a time. Two mounts
 *    duplicate every bus subscription.
 *
 * 2026-07-22 · Sprint 2.5
 */

import { type ReactElement, useEffect, useState } from "react";
import { useComposerSession, isComposerEngaged } from "../state/useComposerSession";
import { useComposerBrain, type ComposerBrain } from "./useComposerBrain";
import { SimpleComposerShell } from "./SimpleComposerShell";
import { MasterComposerShell } from "./MasterComposerShell";
import { ComposerSuiteFrame } from "./ComposerSuiteFrame";
import { useBrainRegistry } from "../../lib/composerBrainRegistry";
import { CelebrationFlash } from "../components/CelebrationFlash";
import { CompletionChime } from "../components/CompletionChime";
import "./ComposerRoute.css";

// View Transitions API is already typed in the DOM lib since TS 5.6 —
// we just call it defensively (browsers without it fall back to a plain
// setState, no animation). No custom declare-global needed.

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
  // browser captures old/new frames and morphs shared elements
  // (Kade avatar, command bar) between them.
  useEffect(() => {
    const target: "idle" | "engaged" = engaged ? "engaged" : "idle";
    if (target === displayedShell) return;
    if (typeof document.startViewTransition === "function") {
      const tx = document.startViewTransition(() => {
        setDisplayedShell(target);
      });
      // Silent · we don't need to await the tx.finished promise here.
      void tx.finished;
    } else {
      setDisplayedShell(target);
    }
  }, [engaged, displayedShell]);

  // 2026-07-22 · mockup-parity-2 · engaged shell hosts the FULL approved
  // simulator (composer-suite.html) in an iframe so users get every
  // region — layout switcher · slot grid · transcript strip · reaction
  // bubble · fake captions · brief card · REC pill · safe-zone · audio
  // strip · timeline · waveform · watermark chip · all parameter panels
  // · ASK panel · library modal · tool panel tabs · history + ask-tests
  // strips · command bar. Set localStorage `lc.composer.legacy=1` to
  // fall back to the leaner MasterComposerShell for debugging.
  const useLegacy = (() => {
    try { return window.localStorage.getItem("lc.composer.legacy") === "1"; } catch { return false; }
  })();

  return (
    <div className="lc-composer-route" data-shell={displayedShell}>
      {displayedShell === "idle" ? (
        <SimpleComposerShell brain={brain} />
      ) : useLegacy ? (
        <MasterComposerShell brain={brain} />
      ) : (
        <ComposerSuiteFrame brain={brain} />
      )}
      {/* 2026-07-22 · mockup-parity · the celebration flash listens on
       *  `composer:celebrate` (emitted by useComposerBrain when clips
       *  finish) and pops kade-celebration.webp for 800ms. Mounts once
       *  at the route level so it survives shell swaps. */}
      <CelebrationFlash />
      {/* 2026-07-22 · audible payoff · Web Audio 2-note arpeggio on
       *  celebrate + subtle tick on stage transitions. Zero shipped
       *  audio assets — synthesised at runtime. */}
      <CompletionChime />
    </div>
  );
}

export type { ComposerBrain };
export default ComposerRoute;
