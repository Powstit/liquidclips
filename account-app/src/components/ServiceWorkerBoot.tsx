"use client";

import { useEffect } from "react";

// v0.7.56 — Registers /sw.js so the browser meets PWA install criteria
// (Chrome / Edge / Brave require a service worker with a fetch handler
// before the address-bar install icon appears). Safari doesn't require
// this for "Add to Home Screen" but the registration is harmless there.
//
// Guards:
//   • only registers when navigator.serviceWorker is defined
//   • only registers on HTTPS or localhost (browser requirement anyway)
//   • silently no-ops on registration failure — we never want a broken
//     SW to break the rest of the app
export function ServiceWorkerBoot() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    const isSecure =
      window.location.protocol === "https:" ||
      window.location.hostname === "localhost";
    if (!isSecure) return;

    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* swallow — install hint is optional, never block the app */
    });
  }, []);

  return null;
}
