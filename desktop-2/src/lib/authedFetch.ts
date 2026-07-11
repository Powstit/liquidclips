/**
 * authedFetch · L1 · 2026-07-11 · global 401 interceptor.
 *
 * A thin wrapper around `fetch` that centralises the "session expired"
 * recovery path so every backend caller behaves the same way:
 *   1. Attach the current JWT (if any) to the `Authorization` header.
 *   2. Perform the fetch.
 *   3. On 401 Unauthorized:
 *        · clear the stale JWT (memory + localStorage + native Keychain)
 *        · preserve the current route in `sessionStorage.lc.postAuthRedirect`
 *        · emit `auth:signed-out` with `{ reason: "expired_401" }`
 *        · surface ONE toast · "Your session expired · sign in again"
 *        · return the raw Response so callers that opted-in can still see
 *          the status (they must NOT surface it as an app error — the
 *          interceptor already handled the UX).
 *   4. Idempotency dampener · if we handled a 401 in the last 3s, the
 *      recovery side-effects are skipped for subsequent 401s (loop guard).
 *
 * Adoption plan · retrofit at least the surfaces that matter:
 *   `/me`, `/sync`, `/me/wallet/summary`, `/me/reward-clips`,
 *   `/me/crew/pipeline`, `/onboarding/crew/*`.
 *
 * Bare `fetch` calls still work for public endpoints (`/audit/tick`,
 * `/desktop/auth/start`, etc.) — this wrapper is opt-in for the
 * authenticated surface so we don't accidentally toast on public probes.
 *
 * No new backend endpoints. No new deps. Same JWT storage adapter that
 * `authHeaders()` already uses. Same bus event that `notifyAuthFailure`
 * already emits (this wrapper is a client-side complement to the
 * activation-machine dampener, wrapping every non-`/me` caller too).
 */

import { getJwt, clearJwt, clearJwtKeychainForAuthAction } from "./authStorage";

/* Module-private dampener · shared across every call site. */
let last401Ms = 0;
const DAMPENER_WINDOW_MS = 3_000;

/** sessionStorage key used to preserve the route the user was on when
 *  their JWT expired. WelcomeGate / SimpleLoginPanel restore the hash
 *  on successful re-auth then delete the key. */
export const POST_AUTH_REDIRECT_KEY = "lc.postAuthRedirect";

/** SUCCESSFUL sign-in path calls this to restore the route the user
 *  was viewing when the 401 dropped them. Deletes the key after
 *  reading so a subsequent boot doesn't repeatedly redirect. */
export function consumePostAuthRedirect(): string | null {
  try {
    const raw = window.sessionStorage.getItem(POST_AUTH_REDIRECT_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(POST_AUTH_REDIRECT_KEY);
    // Sanity gate · only accept `#/route` shapes we recognise; refuse
    // externally-controlled values (defence in depth · the key isn't
    // reachable from the network but keeps our invariant explicit).
    if (!/^#\/[a-z0-9_\-\/?=&]{1,120}$/i.test(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

/** Test seam · reset the internal dampener between tests. */
export function _resetAuthedFetchDampenerForTests(): void {
  last401Ms = 0;
}

function fireExpiredHandler(): void {
  const now = Date.now();
  if (now - last401Ms < DAMPENER_WINDOW_MS) {
    // Loop guard · already handled a 401 within the window.
    return;
  }
  last401Ms = now;

  // 1. Preserve the current hash BEFORE clearing anything else so a
  //    logged-out re-auth can drop the user back where they were.
  try {
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (hash && hash.startsWith("#/")) {
      window.sessionStorage.setItem(POST_AUTH_REDIRECT_KEY, hash);
    }
  } catch { /* sessionStorage may be disabled · non-fatal */ }

  // 2. Wipe JWT · both memory + localStorage + Keychain mirror.
  try { clearJwt(); } catch { /* honest no-op */ }
  void clearJwtKeychainForAuthAction();
  try {
    window.localStorage.removeItem("lc:welcome-acked");
  } catch { /* honest no-op */ }

  // 3. Announce · dynamic import so this module stays free of the
  //    design-os bridge circular dep.
  void (async () => {
    try {
      const { bus } = await import("../design-os/bridge");
      bus.emit("auth:signed-out", { reason: "expired_401" });
      bus.emit("toast", {
        kind: "warning",
        title: "Your session expired",
        body: "Sign in again to pick up where you left off.",
        ttl: 8_000,
      });
    } catch { /* bus emit best-effort */ }
  })();

  // 4. lcDiag beacon · lands in Railway logs so we can trace the drop.
  void (async () => {
    try {
      const { lcDiag } = await import("./diagnosticLogger");
      lcDiag("authed_fetch_401_intercepted", {
        preserved_hash: (() => {
          try { return window.sessionStorage.getItem(POST_AUTH_REDIRECT_KEY) ?? ""; }
          catch { return ""; }
        })(),
      });
    } catch { /* non-fatal */ }
  })();
}

export interface AuthedFetchInit extends RequestInit {
  /** When `true`, do NOT attach the Authorization header even if a
   *  JWT is present (for the rare authenticated-optional public probe).
   *  Default: attach when a JWT exists. */
  skipAuthHeader?: boolean;
  /** When `true`, do NOT trigger the 401 side-effects (used by the
   *  activation orchestrator which owns its own dampener). Default:
   *  handle 401s. */
  skip401Handler?: boolean;
}

/**
 * Perform an authenticated fetch. On 401 the interceptor fires the
 * expired-session UX exactly once per 3s window, then returns the raw
 * Response so callers can still branch on `r.status` if they need to.
 *
 * The caller MUST NOT surface a "You lost your session" error itself —
 * the interceptor owns that copy. Callers should instead treat 401 as
 * "no data" (return null / [] / whatever their loading state expects).
 */
export async function authedFetch(
  input: RequestInfo | URL,
  init: AuthedFetchInit = {},
): Promise<Response> {
  const { skipAuthHeader, skip401Handler, ...rest } = init;
  const headers = new Headers(rest.headers ?? {});
  if (!skipAuthHeader) {
    const jwt = getJwt();
    if (jwt && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${jwt}`);
    }
  }
  const r = await fetch(input, { ...rest, headers });
  if (r.status === 401 && !skip401Handler) {
    fireExpiredHandler();
  }
  return r;
}

/** JSON convenience wrapper · sets `content-type: application/json`
 *  on POST/PUT/PATCH by default, JSON-stringifies the `body` if it's
 *  an object. Returns the raw Response — callers still parse.
 *
 *  `body` is deliberately typed as `unknown` (not `BodyInit`) so the
 *  caller can pass a plain object literal without a cast — the
 *  wrapper JSON.stringifies before hitting fetch. */
export type AuthedFetchJsonInit = Omit<AuthedFetchInit, "body"> & { body?: unknown };
export async function authedFetchJson(
  input: RequestInfo | URL,
  init: AuthedFetchJsonInit = {},
): Promise<Response> {
  const { body, ...rest } = init;
  const headers = new Headers(rest.headers ?? {});
  const method = (rest.method ?? "GET").toUpperCase();
  const needsJson =
    body !== undefined && (method === "POST" || method === "PUT" || method === "PATCH");
  if (needsJson && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const finalBody = needsJson
    ? typeof body === "string"
      ? body
      : JSON.stringify(body ?? {})
    : (body as BodyInit | null | undefined);
  return authedFetch(input, { ...rest, headers, body: finalBody });
}
