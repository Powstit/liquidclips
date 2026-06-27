/**
 * Liquid Clips · Design OS · Event hook
 *
 * React-side subscription to the bus. Auto-cleanup on unmount.
 */

import { useEffect, useRef } from "react";
import { bus, type LCEvents } from "./events";

export function useEvent<K extends keyof LCEvents>(
  event: K,
  handler: (payload: LCEvents[K]) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return bus.on(event, (payload) => handlerRef.current(payload));
  }, [event]);
}
