/**
 * Liquid Clips · Design OS · Event hook
 *
 * React-side subscription to the bus. Auto-cleanup on unmount.
 */

import { useEffect } from "react";
import { bus, type LCEvents } from "./events";

export function useEvent<K extends keyof LCEvents>(
  event: K,
  handler: (payload: LCEvents[K]) => void,
): void {
  useEffect(() => {
    return bus.on(event, handler);
    // We intentionally depend on event identity; handler is captured via closure.
    // Callers should memoise complex handlers if needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);
}
