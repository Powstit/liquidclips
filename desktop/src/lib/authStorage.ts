// ───── IRON GATE IG-014 (v0.7.58) — see desktop/docs/IRON_GATES.md ─────
// AUTH-KEYCHAIN INVARIANT. Single source of truth for Liquid Clips auth
// storage. See docs/auth-keychain-invariant.md for the canonical statement.
//
// THE INVARIANT (do not regress):
//
//   Liquid Clips must NEVER read the macOS Keychain passively. Boot, mount,
//   Earn open, Schedule open, Notification sheet open, Inline-scheduler
//   drawer open, polling loops, focus / visibilitychange handlers, quota
//   checks, publish submit, schedule submit, queue cancel / retry, and
//   notification row clicks MUST use `getCachedLicenseJwt()` only.
//
//   If the cache is empty, surface `RECONNECT_PROMPT_COPY` from the catch
//   site. Do NOT call `readLicenseJwtForAuthAction()`.
//
//   Only these actions may touch auth storage (i.e. call
//   `readLicenseJwtForAuthAction`, `primeLicenseJwtCache`, or
//   `invalidateLicenseJwtCache`):
//     • Sign in
//     • Sign out
//     • Reconnect account
//     • Connect-desktop callback (activation.ts deep-link handler)
//     • Explicit "Reset login session" button
//
// HOW THIS IS ENFORCED:
//   1. `scripts/assert-no-passive-keychain.sh` — pre-commit gate. Blocks
//      any commit that re-introduces a passive Keychain caller outside the
//      approved auth files.
//   2. `tests/no-passive-keychain.test.mjs` — node:test fixture. Static
//      analysis assertions over the source tree.
//   3. Dev-mode runtime guard inside `readLicenseJwtForAuthAction`. Throws
//      if `explicitAuthAction !== true`.
//   4. `IRON GATE IG-014` sentinel in this file + `docs/IRON_GATES.md`.
//      Pre-commit hook refuses sentinel deletion without explicit override.
//
// HOW TO HARDEN A NEW SURFACE:
//   • Mount / lifecycle paths: read `getCachedLicenseJwt()`. On null,
//     render a reconnect state using `RECONNECT_PROMPT_COPY`.
//   • Submit / action paths that need the JWT: call
//     `requireCachedLicenseJwtOrThrow()`. Catch `CachedJwtUnavailableError`
//     and surface the reconnect copy inline (toast / banner / form error).
//   • If you genuinely need to read Keychain (you are one of the 5 allowed
//     auth actions): call `readLicenseJwtForAuthAction({ explicitAuthAction:
//     true, callerLabel: "auth.<your-flow>" })`. This is the ONLY path that
//     touches Keychain. Add your file to the approved-auth-files list in
//     `scripts/assert-no-passive-keychain.sh` and `tests/no-passive-keychain.test.mjs`.

import { sidecar } from "./sidecar";

/** Canonical user-facing reconnect copy. Use this string from any surface
 *  that needs auth storage and finds the cache empty. Do not invent a
 *  different phrase — consistency keeps the user oriented across the app. */
export const RECONNECT_PROMPT_COPY =
  "Please sign in again to reconnect your account.";

/** Typed error thrown by `requireCachedLicenseJwtOrThrow`. The error's
 *  message IS `RECONNECT_PROMPT_COPY` so direct render of `err.message`
 *  satisfies the invariant copy contract. */
export class CachedJwtUnavailableError extends Error {
  constructor() {
    super(RECONNECT_PROMPT_COPY);
    this.name = "CachedJwtUnavailableError";
  }
}

// In-memory JWT cache. Populated ONLY by the four explicit auth actions via
// `primeLicenseJwtCache`. Cleared by `invalidateLicenseJwtCache`. Never
// touches localStorage / disk — restart = re-sign-in.
let _jwtCache: { value: string | null } | null = null;

/** SAFE — synchronous accessor. Returns the cached JWT if any explicit auth
 *  action has filled it this session; otherwise null.
 *
 *  NEVER triggers a Keychain prompt. Use this from every passive lifecycle
 *  caller: mount-time loads, drawer-open useEffects, polling-free refresh
 *  buttons, quota checks, submit handlers, row clicks, etc. */
export function getCachedLicenseJwt(): string | null {
  return _jwtCache?.value ?? null;
}

/** SAFE — boot-safe presence check. Reads the plaintext presence-file
 *  mirror, never the OS Keychain.
 *
 *  Use to decide between "Sign in" copy (presence false → first install)
 *  and "Please sign in again" copy (presence true but cache empty → user
 *  was signed in, app restarted, cache flushed). */
export async function licenseJwtPresence(): Promise<boolean> {
  try {
    const { present } = await sidecar.licenseJwtPresence();
    return present;
  } catch {
    return false;
  }
}

/** SAFE — synchronous cache-required accessor. Throws
 *  `CachedJwtUnavailableError` if the cache is empty. NEVER triggers a
 *  Keychain prompt.
 *
 *  Use from submit / action paths where the JWT is required (publish,
 *  schedule, cancel, retry, markRead, paywall notify, export quota). The
 *  catch site surfaces `RECONNECT_PROMPT_COPY` as a toast / banner. */
export function requireCachedLicenseJwtOrThrow(): string {
  const cached = _jwtCache?.value ?? null;
  if (!cached) throw new CachedJwtUnavailableError();
  return cached;
}

/** AUTH-ACTION ONLY — prime the in-memory cache from a known-good JWT
 *  obtained by one of the five explicit auth actions:
 *    • Sign in (activation.ts → `handleDeepLink`)
 *    • Sign out (the rare "sign back in immediately" path)
 *    • Reconnect account
 *    • Connect-desktop callback (same handler as Sign in today)
 *    • Explicit "Reset login session" + re-mint
 *
 *  Do NOT call this from a passive caller. Surfaces should read from
 *  `getCachedLicenseJwt()` instead. */
export function primeLicenseJwtCache(jwt: string): void {
  _jwtCache = { value: jwt };
}

/** AUTH-ACTION ONLY — wipe the in-memory cache. Call sites:
 *    • Sign out (full atomic wipe)
 *    • Explicit "Reset login session" button
 *    • 401 self-heal path in `authedFetch` (token rejected by backend)
 *
 *  Forces the next surface mount to render the reconnect UI rather than
 *  acting on a stale token. */
export function invalidateLicenseJwtCache(): void {
  _jwtCache = null;
}

/** AUTH-ACTION ONLY — the ONE path allowed to read the OS Keychain.
 *  Triggers a macOS Keychain UI prompt on rebuilt / renamed binaries.
 *
 *  DO NOT call from:
 *    • render or mount
 *    • polling (`setInterval`, `useVisibilityInterval`, etc.)
 *    • tab open / drawer open / sheet open
 *    • Earn / Schedule / Notifications surfaces
 *    • quota checks, publish submit, schedule submit, queue actions,
 *      notification row clicks, paywall notify
 *    • passive refresh (focus, visibilitychange)
 *
 *  Approved call sites:
 *    • `src/lib/activation.ts` — Connect-desktop deep-link handler.
 *    • Auth panel sign-in flow (post-Clerk return path).
 *    • Explicit "Reset login session" + re-mint.
 *
 *  The dev-mode guard throws if `explicitAuthAction !== true`. CI script
 *  and test fixture block any caller outside the approved auth files. */
export async function readLicenseJwtForAuthAction(opts: {
  explicitAuthAction: true;
  callerLabel: string;
}): Promise<string | null> {
  // Dev runtime guard: violation throws loudly during local development so
  // a regression can't quietly land. Prod build skips the throw but still
  // logs the event for telemetry triage.
  const isDev = typeof import.meta !== "undefined"
    && import.meta.env
    && (import.meta.env.DEV === true || import.meta.env.MODE === "development");
  if (isDev) {
    if (opts.explicitAuthAction !== true) {
      throw new Error(
        `auth-keychain invariant: ${opts.callerLabel} called readLicenseJwtForAuthAction without explicitAuthAction=true`,
      );
    }
    // eslint-disable-next-line no-console
    console.debug("[auth-keychain]", {
      method: "readLicenseJwtForAuthAction",
      keyName: "LICENSE_JWT",
      serviceNamespace: "app.liquidclips.auth.v1",
      callerLabel: opts.callerLabel,
      explicitAuthAction: opts.explicitAuthAction,
    });
  }
  try {
    const res = await sidecar.licenseJwtRead();
    if (res?.value) primeLicenseJwtCache(res.value);
    return res?.value ?? null;
  } catch {
    return null;
  }
}
