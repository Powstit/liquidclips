// v0.7.48 — Visibility-aware interval hook.
//
// Wraps setInterval but automatically pauses when the document is hidden
// (user switched tabs, minimized window, etc.). Resumes when visible again.
// This prevents wasted CPU/battery on background timers that only need to
// run when the user is actually looking at the app.
//
// Use this for any polling, countdown, or refresh loop that doesn't need
// to stay hot while the app is backgrounded.

import { useEffect, useRef } from "react";

export function useVisibilityInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;
  const intervalId = useRef<number | null>(null);

  useEffect(() => {
    if (delay === null) return;
    const ms = delay; // narrow for closure

    function tick() {
      savedCallback.current();
    }

    function start() {
      if (intervalId.current) window.clearInterval(intervalId.current);
      intervalId.current = window.setInterval(tick, ms);
    }

    function stop() {
      if (intervalId.current) {
        window.clearInterval(intervalId.current);
        intervalId.current = null;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        stop();
      } else {
        tick(); // catch up immediately on return
        start();
      }
    }

    if (document.visibilityState !== "hidden") {
      start();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [delay]);
}
