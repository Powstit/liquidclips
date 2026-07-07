/**
 * useKadeFromSession · drives StickyKade from the engine session
 *
 * The Design OS bus already mirrors nav:hover into StickyKade. The engine
 * session derives a Kade pose per stage (see STAGE_TO_KADE in
 * useEngineSession.ts). This hook bridges the two: whenever the session's
 * suggested pose changes, fire bus.emit("nav:hover") so StickyKade reacts
 * the same way it does on nav hover. Keeps Kade user-action-driven (no
 * random motion).
 *
 * Routes call this once near the root of their content.
 */

import { useEffect, useRef } from "react";
import { bus, type RouteId } from "../bridge";
import { useEngineSession } from "./useEngineSession";

export function useKadeFromSession(route: RouteId): void {
  const session = useEngineSession();
  const lastRef = useRef<string | null>(null);

  useEffect(() => {
    const key = `${session.phase}:${session.stage ?? "_"}:${session.kade}`;
    if (lastRef.current === key) return;
    lastRef.current = key;
    if (session.phase === "idle") return;
    bus.emit("nav:hover", { route, kade: session.kade });
  }, [route, session.kade, session.phase, session.stage]);
}
