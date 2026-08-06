/**
 * deepLinkBoot.ts · P1-1D-b · Tauri deep-link subscriber
 *
 * Headless plumbing only. Subscribes to `liquidclips://` deep-link
 * events emitted by `@tauri-apps/plugin-deep-link` and routes:
 *
 *   * `liquidclips://activate?token=…&challenge=…`
 *       → `handleActivationUrl()` from `./activation`
 *   * `liquidclips://google-oauth?token=…&refresh=…&expires_at=…&state=…`
 *       → the pending Google OAuth promise in `./googleOAuthPending`
 *         (Crew onboarding · F5 scanner).
 *   * `liquidclips://checkout-complete?status=success&plan=…`
 *       → 2026-08-05 · Whop checkout runs in the system browser (commerce
 *         URLs never open in-app), so nothing previously brought the user
 *         back to the app after paying — they had to alt-tab manually, and
 *         even then the tier only refreshed on the next throttled
 *         focus-revalidation (see useMe.ts's maybeRefetchMeOnFocus, 8s
 *         throttle). account-app's /checkout/complete success page now
 *         fires this deep-link, which the OS uses to bring the app itself
 *         to the foreground (standard custom-URL-scheme handoff — same
 *         mechanism `activate` already relies on), and we force an
 *         immediate /me refetch here rather than waiting on the throttle.
 *
 * Other verbs (e.g. the documented HQ-bridge
 * `liquidclips://open?section=…` set) are LOGGED + IGNORED · they
 * must NOT route through the activation state machine because that
 * would flip status to "failed". HQ-bridge handling lands in a
 * separate phase if/when Daniel asks.
 *
 * Discipline:
 *   - Dynamic import only (Vite + browser preview won't break when the
 *     plugin module isn't reachable).
 *   - No top-level `await`.
 *   - Browser preview returns a no-op handle.
 *   - Idempotent: second call returns the existing handle.
 *   - No Rust commands. No Keychain. No Clerk. No Whop OAuth. No UI.
 */

import { handleActivationUrl } from "./activation";
import { resolvePendingGoogleOAuth } from "./googleOAuthPending";

export interface DeepLinkBootHandle {
  /** Detach the warm-open subscriber. Idempotent. */
  dispose: () => void;
  /** True when a Tauri subscriber is wired. False for noop handles. */
  mounted: boolean;
  /** Diagnostic label · why this handle is what it is. */
  source: "tauri" | "browser-noop" | "unavailable";
}

/* ─── Module-private state · single subscriber per process ──────────── */

let currentHandle: DeepLinkBootHandle | null = null;
let mountInFlight: Promise<DeepLinkBootHandle> | null = null;

/* Dedupe ring · prevents getCurrent()'s cold-launch URL from being
 * routed twice when onOpenUrl also fires for the same URL on certain
 * platforms. Without this, the second routing would fail the challenge
 * match (pendingChallenge was cleared by the first call) and flip the
 * activation state machine to "failed" after a successful "activated". */
const RECENT_URL_TTL_MS = 10_000;
const recentUrls = new Set<string>();

function isLikelyTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isActivationUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return u.protocol === "liquidclips:" && u.hostname === "activate";
  } catch {
    return false;
  }
}

function isGoogleOAuthUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return u.protocol === "liquidclips:" && u.hostname === "google-oauth";
  } catch {
    return false;
  }
}

/** Exported for direct unit testing — pure URL-matching logic, no need to
 *  mock the Tauri plugin machinery to verify this specific routing rule. */
export function isCheckoutCompleteUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return u.protocol === "liquidclips:" && u.hostname === "checkout-complete";
  } catch {
    return false;
  }
}

async function routeUrl(rawUrl: string): Promise<void> {
  if (isActivationUrl(rawUrl)) {
    try {
      await handleActivationUrl(rawUrl);
    } catch (e) {
      // handleActivationUrl never throws by design · but if a future
      // change regressed that, we must NOT crash app boot.
      // eslint-disable-next-line no-console
      console.warn("[deepLinkBoot] handleActivationUrl threw:", e);
    }
    return;
  }
  if (isGoogleOAuthUrl(rawUrl)) {
    // Crew onboarding · F5 scanner OAuth callback. Never throws — the
    // resolver is designed to no-op if no promise is pending (e.g. the
    // user closed and reopened the app between clicking Connect and
    // Google redirecting back).
    try {
      resolvePendingGoogleOAuth(rawUrl);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[deepLinkBoot] google-oauth deep-link failed:", e);
    }
    return;
  }
  if (isCheckoutCompleteUrl(rawUrl)) {
    // The OS bringing the app to foreground for this deep-link IS the fix
    // for "payment doesn't return to the app" — everything below is the
    // secondary "make the new tier visible immediately" half. Never throws:
    // both the /me refetch and the toast are best-effort, and a failure
    // here must not crash app boot the way a bad activation URL would.
    try {
      const status = new URL(rawUrl).searchParams.get("status");
      void import("../design-os/state/useMe").then((m) => m.loadMe());
      if (status === "success") {
        void import("../design-os/bridge").then(({ bus }) => {
          bus.emit("toast", {
            kind: "success",
            title: "You're upgraded.",
            body: "Your new plan is active — welcome back.",
          });
        });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[deepLinkBoot] checkout-complete deep-link failed:", e);
    }
    return;
  }
  // Non-activation, non-google-oauth verb · HQ bridge or anything else.
  // Log and ignore.
  // eslint-disable-next-line no-console
  console.info("[deepLinkBoot] non-activation deep-link · ignored:", rawUrl);
}

function dedupeAndRoute(rawUrl: string): void {
  if (recentUrls.has(rawUrl)) return;
  recentUrls.add(rawUrl);
  setTimeout(() => { recentUrls.delete(rawUrl); }, RECENT_URL_TTL_MS);
  void routeUrl(rawUrl);
}

function makeNoopHandle(source: "browser-noop" | "unavailable"): DeepLinkBootHandle {
  return {
    dispose: () => { /* no-op */ },
    mounted: false,
    source,
  };
}

/* ─── Public mount API ──────────────────────────────────────────────── */

/** Mount the Tauri deep-link subscriber. Idempotent: a second call
 *  returns the existing handle without registering a duplicate
 *  listener. Browser preview returns a noop handle that reports
 *  `source: "browser-noop"`. Tauri runtime with the plugin missing
 *  returns `source: "unavailable"`. */
export async function mountDeepLinkSubscriber(): Promise<DeepLinkBootHandle> {
  if (currentHandle) {
    return currentHandle;
  }
  if (mountInFlight) {
    return mountInFlight;
  }

  if (!isLikelyTauri()) {
    currentHandle = makeNoopHandle("browser-noop");
    return currentHandle;
  }

  mountInFlight = (async (): Promise<DeepLinkBootHandle> => {
    let unlistenFn: (() => void) | null = null;
    try {
      // Dynamic import keeps Vite / browser preview safe when the
      // Tauri webview internals are absent. The package IS in
      // node_modules (desktop-2/package.json) so type resolution is
      // honest at compile time.
      const mod = await import("@tauri-apps/plugin-deep-link");

      // Warm-open subscriber registered FIRST so we don't miss URLs
      // that arrive between getCurrent() and onOpenUrl().
      //
      // 2026-07-05 · rpc-contract-lens P1-B · @tauri-apps/plugin-deep-link
      // v2 emits `string[]` on macOS but some Tauri v2 builds have
      // documented the callback as `string`. If the plugin ever fires
      // a single string, `for..of` would iterate character-by-character
      // and silently no-op (no isActivationUrl match). Normalise the
      // payload to an array up front so BOTH shapes route correctly.
      const unsub = await mod.onOpenUrl((payload: string | string[]) => {
        const urls = Array.isArray(payload) ? payload : [payload];
        for (const url of urls) {
          dedupeAndRoute(url);
        }
      });
      unlistenFn = typeof unsub === "function" ? unsub : null;

      // Cold-launch URLs · the OS launched the app with a deep-link.
      try {
        const initial = await mod.getCurrent();
        if (Array.isArray(initial)) {
          for (const url of initial) {
            dedupeAndRoute(url);
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[deepLinkBoot] getCurrent failed (cold-launch skipped):", e);
      }

      currentHandle = {
        dispose: () => {
          try { unlistenFn?.(); } catch { /* noop */ }
          unlistenFn = null;
          currentHandle = null;
        },
        mounted: true,
        source: "tauri",
      };
      return currentHandle;
    } catch (e) {
      // Tauri runtime present (window.__TAURI_INTERNALS__) but the
      // deep-link plugin import threw · e.g. plugin not registered in
      // tauri.conf.json or version mismatch. Fall back gracefully.
      // eslint-disable-next-line no-console
      console.warn("[deepLinkBoot] Tauri deep-link plugin unavailable:", e);
      currentHandle = makeNoopHandle("unavailable");
      return currentHandle;
    } finally {
      mountInFlight = null;
    }
  })();

  return mountInFlight;
}

/** Synchronous read of the current handle · for diagnostics. */
export function getDeepLinkHandle(): DeepLinkBootHandle | null {
  return currentHandle;
}

/* ─── Test seam ─────────────────────────────────────────────────────── */

/** Detaches and resets module state · for unit tests only. */
export function _resetDeepLinkBootForTests(): void {
  if (currentHandle) {
    try { currentHandle.dispose(); } catch { /* noop */ }
  }
  currentHandle = null;
  mountInFlight = null;
  recentUrls.clear();
}
