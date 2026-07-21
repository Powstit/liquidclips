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
import "./ComposerRoute.css";

// View Transitions API is already typed in the DOM lib since TS 5.6 —
// we just call it defensively (browsers without it fall back to a plain
// setState, no animation). No custom declare-global needed.

export function ComposerRoute(): ReactElement {
  const brain = useComposerBrain();
  const engaged = useComposerSession((s) => isComposerEngaged(s));
  const [displayedShell, setDisplayedShell] = useState<"idle" | "engaged">(engaged ? "engaged" : "idle");

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

  return (
    <div className="lc-composer-route" data-shell={displayedShell}>
      {displayedShell === "idle" ? (
        <SimpleComposerShell brain={brain} />
      ) : (
        <MasterComposerShell brain={brain} />
      )}
    </div>
  );
}

export type { ComposerBrain };
export default ComposerRoute;
