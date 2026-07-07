/**
 * authStorage · Phase P1-1B · Auth storage + JWT bridge
 *
 * Single source of truth for reading + writing the Liquid Clips license
 * JWT in the desktop-2 shell. Adapter-shaped so future runtimes (native
 * Keychain via Tauri secret command · P1-1F polish) can layer in without
 * touching call sites.
 *
 * Current behavior:
 *   - Browser preview · localStorage at `lc.license.jwt.v1`.
 *   - Tauri runtime · localStorage hot-path cache plus an OS Keychain mirror.
 *     Boot checks the non-secret presence file before reading a credential,
 *     preventing macOS permission prompts for signed-out users.
 *
 * Scope discipline (locked):
 *   - Pure storage adapter · no UI · no deep-link · no Clerk SDK · no
 *     Whop OAuth · no provider secrets.
 *   - getJwt() / setJwt() / clearJwt() / hasJwt() / getAuthSource() are
 *     SYNC (the hot path · used by `authHeaders()` on every backend
 *     fetch · can't be async). The async `initAuthStorage()` primes a
 *     module-level cache for runtimes that need it.
 */

/** localStorage key · MUST stay in sync with any external consumer that
 *  paste-injects a real JWT for browser-preview testing (e.g. the
 *  diagnostic toast in `Channels.tsx`). */
export const LICENSE_JWT_STORAGE_KEY = "lc.license.jwt.v1";

/** Reserved for the P1-1F native Keychain path · matches IG-014 from the
 *  legacy desktop app so the eventual Rust command can share namespace. */
export const NATIVE_KEYCHAIN_NAMESPACE = "app.liquidclips.auth.v1";

export type AuthSource =
  | "tauri-keychain"       // Native macOS/Windows credential store
  | "browser-localstorage" // Browser preview and Tauri hot-path fallback
  | "memory-only"          // Tauri secret command failed · in-memory cache only
  | "unavailable";         // SSR / Node test runner / `window` not present

/* Module-private cache · primed by initAuthStorage() when a Tauri secret
 * command lands. Until then, the cache mirrors localStorage and the
 * getJwt() hot path reads localStorage directly. */
let memoryCache: string | null = null;
let cachedSource: AuthSource = "unavailable";
let initialized = false;

function readStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** SYNC read. Hot path · called by every authHeaders() invocation. */
export function getJwt(): string | null {
  if (memoryCache) return memoryCache;
  const s = readStorage();
  if (!s) return null;
  const v = s.getItem(LICENSE_JWT_STORAGE_KEY);
  if (v && v.length > 0) {
    memoryCache = v;
    return v;
  }
  return null;
}

/** SYNC write. Writes to memory + localStorage. Mirrors legacy IG-014:
 *  NEVER touches OS Keychain from a hot path. Keychain writes are gated
 *  behind the explicit `setJwtKeychainForAuthAction()` function — only
 *  the sign-in / reconnect / connect-desktop flows may call it. */
export function setJwt(jwt: string): void {
  if (!jwt) return;
  memoryCache = jwt;
  const s = readStorage();
  if (s) s.setItem(LICENSE_JWT_STORAGE_KEY, jwt);
  /* 2026-06-24 · IG-014 mirror — removed passive `void writeJwtToKeychain(jwt)`
   * call. That auto-invocation triggered the macOS Keychain "allow access"
   * prompt on every fresh install / rebuild. Callers that genuinely need
   * the native mirror call `setJwtKeychainForAuthAction()` explicitly. */
}

/** SYNC clear. Removes from memory + localStorage. Mirrors legacy IG-014:
 *  NEVER touches OS Keychain from a hot path. Explicit sign-out flows
 *  may call `clearJwtKeychainForAuthAction()` if they want the native
 *  mirror cleared too. */
export function clearJwt(): void {
  memoryCache = null;
  const s = readStorage();
  if (s) s.removeItem(LICENSE_JWT_STORAGE_KEY);
  /* 2026-06-24 · IG-014 mirror — removed passive `void deleteJwtFromKeychain()`
   * call for the same reason as setJwt() above. */
}

/* ─── IG-014 mirror · Tauri Keychain bridge (explicit-auth-action only) ───
 *
 * 2026-06-24 — these functions WILL trigger a macOS Keychain Access prompt
 * the first time the OS sees this binary identity. The legacy IG-014
 * invariant: only the 6 approved auth actions may call them (sign-in,
 * sign-out, reconnect, connect-desktop callback, reset-login-session
 * button, cold-boot resume). Passive callers MUST use getJwt() / setJwt()
 * / clearJwt() which only touch memory + localStorage. */

/** AUTH-ACTION ONLY · explicit Keychain write. Use after sign-in /
 *  reconnect when the user has just authenticated and a Keychain prompt
 *  feels in-context. Returns true if the write succeeded. */
export async function setJwtKeychainForAuthAction(jwt: string): Promise<boolean> {
  if (!jwt || !isTauriRuntime()) return false;
  try {
    const mod = await import("@tauri-apps/api/core");
    await mod.invoke("secret_set_jwt", { jwt });
    cachedSource = "tauri-keychain";
    return true;
  } catch {
    return false;
  }
}

/** AUTH-ACTION ONLY · explicit Keychain delete. Use during full sign-out. */
export async function clearJwtKeychainForAuthAction(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const mod = await import("@tauri-apps/api/core");
    await mod.invoke("secret_delete_jwt");
  } catch {
    /* swallow — localStorage is the durable backing */
  }
}

/** AUTH-ACTION ONLY · explicit Keychain read. Use during cold-boot
 *  session resume AFTER confirming via presence file that a JWT exists.
 *  Primes the memory cache + localStorage when successful. */
export async function resumeJwtFromKeychainForAuthAction(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    const mod = await import("@tauri-apps/api/core");
    const v = await mod.invoke<string | null>("secret_get_jwt");
    if (typeof v === "string" && v.length > 0) {
      memoryCache = v;
      cachedSource = "tauri-keychain";
      const s = readStorage();
      if (s) s.setItem(LICENSE_JWT_STORAGE_KEY, v);
      return v;
    }
    return null;
  } catch {
    return null;
  }
}

/** Boot-safe presence check. Reads the plaintext boolean mirror shared with
 * the Python sidecar; it never asks macOS Keychain for a secret value. */
export async function hasJwtKeychainPresence(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const mod = await import("@tauri-apps/api/core");
    const presence = await mod.invoke<Record<string, boolean>>("secret_presence_get");
    return presence.LICENSE_JWT === true;
  } catch {
    return false;
  }
}

export function hasJwt(): boolean {
  return getJwt() !== null;
}

/** Diagnostic label · which adapter answered the most recent read.
 *
 *  P1-1F-b · `initAuthStorage()` flips this to `"tauri-keychain"` when
 *  a Tauri prime read succeeds · `writeJwtToKeychain()` flips it on the
 *  first successful native write. Otherwise it stays
 *  `"browser-localstorage"` (working fallback) or `"unavailable"` (SSR).
 *  We do NOT speculate · the label reflects the LAST observed reality. */
export function getAuthSource(): AuthSource {
  if (typeof window === "undefined") return "unavailable";
  if (cachedSource !== "unavailable") return cachedSource;
  cachedSource = "browser-localstorage";
  return cachedSource;
}

/** Async one-shot init · primes the module cache from localStorage.
 *
 *  2026-06-24 · IG-014 mirror — this used to ALSO read the Tauri Keychain
 *  on boot via `invoke("secret_get_jwt")`, which triggered the macOS
 *  Keychain Access prompt on every fresh install / rebuild. Removed.
 *  Cold-boot keychain resume is now opt-in via
 *  `resumeJwtFromKeychainForAuthAction()`, called by the explicit
 *  resume-session flow only.
 *
 *  Safe to call multiple times · second + calls no-op. */
export async function initAuthStorage(): Promise<AuthSource> {
  if (initialized) return cachedSource;
  initialized = true;

  // localStorage prime · sync, fast, always runs.
  const s = readStorage();
  if (s) {
    const v = s.getItem(LICENSE_JWT_STORAGE_KEY);
    if (v && v.length > 0) memoryCache = v;
    cachedSource = "browser-localstorage";
  }

  if (cachedSource === "unavailable") cachedSource = "browser-localstorage";
  return cachedSource;
}

/** Test seam · resets the module cache. Test-only. */
export function _resetAuthStorageForTests(): void {
  memoryCache = null;
  cachedSource = "unavailable";
  initialized = false;
  /* 2026-06-24 · IG-014 mirror — clear native Keychain via the explicit
   * auth-action function instead of the removed private helper. Safe no-op
   * in browser preview (early-returns when isTauriRuntime() is false). */
  void clearJwtKeychainForAuthAction();
}
