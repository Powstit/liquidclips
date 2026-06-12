// v0.7.56 — Minimal service worker for PWA installability.
//
// Chrome's install criteria require a SW with a fetch handler. We do
// the lightest thing that meets the criteria: a no-op pass-through.
// No offline caching, no background sync, no push handling — those
// would each need their own QA pass and are out of scope for the
// "install icon in the address bar" goal.
//
// Versioning: bump CACHE_VERSION when this file changes so old SW
// installations activate cleanly. Right now there's no cache, so the
// version is purely a tombstone for browser dev-tools visibility.
const CACHE_VERSION = "lc-v0.7.56";

self.addEventListener("install", (event) => {
  // skipWaiting() so the new SW takes over on the next page load
  // without requiring the user to close every tab.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Pass-through — no caching, no interception. Required for
  // installability; not used for offline behaviour.
  event.respondWith(fetch(event.request).catch(() => Response.error()));
});

// Tombstone — surfaces the version in DevTools → Application → SW.
self.__LC_SW_VERSION = CACHE_VERSION;
