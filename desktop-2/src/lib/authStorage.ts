/**
 * authStorage · Phase P1-1B · Auth storage + JWT bridge
 *
 * Single source of truth for reading + writing the Liquid Clips license
 * JWT in the desktop-2 shell. Adapter-shaped so future runtimes (native
 * Keychain via Tauri secret command · P1-1F polish) can layer in without
 * touching call sites.
 *
 * Today's behavior (P1-1B scope):
 *   - Browser preview · localStorage at `lc.license.jwt.v1`.
 *   - Tauri runtime  · localStorage SAME key (the native Keychain command
 *     does not exist yet in desktop-2's Rust shell · see
 *     `src-tauri/Cargo.toml`). `initAuthStorage()` includes a forward-
 *     ready hook that tries `invoke("secret_get_jwt")` and gracefully
 *     falls through when the command is absent.
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
  | "tauri-keychain"      // Native macOS/Windows credential store (P1-1F · not yet wired)
  | "browser-localstorage" // Browser preview AND today's Tauri shell (P1-1B fallback)
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

/** SYNC write. Writes to memory + localStorage immediately · also fires
 *  a best-effort native-Keychain write on Tauri (no `await` · the
 *  function stays sync · failures are swallowed because the
 *  localStorage path is the durable fallback). */
export function setJwt(jwt: string): void {
  if (!jwt) return;
  memoryCache = jwt;
  const s = readStorage();
  if (s) s.setItem(LICENSE_JWT_STORAGE_KEY, jwt);
  /* P1-1F-b · best-effort native Keychain write. Errors are swallowed
   * silently · the JWT is already in memory + localStorage · the
   * Keychain mirror is bonus, not a guarantee. We do NOT log the JWT. */
  void writeJwtToKeychain(jwt);
}

/** SYNC clear. Removes from memory + localStorage immediately · also
 *  fires a best-effort native-Keychain delete on Tauri. */
export function clearJwt(): void {
  memoryCache = null;
  const s = readStorage();
  if (s) s.removeItem(LICENSE_JWT_STORAGE_KEY);
  /* P1-1F-b · best-effort native Keychain delete. Errors swallowed. */
  void deleteJwtFromKeychain();
}

/* ─── P1-1F-b · Tauri Keychain bridge (best-effort) ───────────────── */

async function writeJwtToKeychain(jwt: string): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const mod = await import("@tauri-apps/api/core");
    await mod.invoke("secret_set_jwt", { jwt });
    /* On the FIRST successful write, flip the diagnostic label so
     * getAuthSource() reports the truth. */
    cachedSource = "tauri-keychain";
  } catch {
    /* Command not registered · OS keychain denied · runtime not Tauri ·
     * any failure is fine because localStorage already has the JWT.
     * NEVER log the JWT itself.
     *
     * P1-1F-b · gap-fix 2 · if the Keychain previously held an older
     * value AND this write failed for the new one, the next boot's
     * prime would pick up the stale Keychain value and overwrite the
     * correct newer JWT in localStorage. Best-effort delete the native
     * entry so next-boot prime returns null and localStorage wins.
     * Best-effort means: if the delete also fails, we accept the
     * theoretical stale-on-restart risk · localStorage is still the
     * working fallback for this session. */
    void deleteJwtFromKeychain();
  }
}

async function deleteJwtFromKeychain(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const mod = await import("@tauri-apps/api/core");
    await mod.invoke("secret_delete_jwt");
  } catch {
    /* Same swallow rationale as writeJwtToKeychain. */
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

/** Async one-shot init · primes the module cache from the most
 *  authoritative source available. P1-1B today: localStorage. P1-1F
 *  tomorrow: tries Tauri keychain command first, falls back to
 *  localStorage if the command isn't registered.
 *
 *  Safe to call multiple times · second + calls no-op. */
export async function initAuthStorage(): Promise<AuthSource> {
  if (initialized) return cachedSource;
  initialized = true;

  // localStorage prime · sync, fast, always runs first.
  const s = readStorage();
  if (s) {
    const v = s.getItem(LICENSE_JWT_STORAGE_KEY);
    if (v && v.length > 0) memoryCache = v;
    cachedSource = "browser-localstorage";
  }

  // Tauri Keychain prime · forward-ready hook · gracefully no-ops when
  // the secret_get_jwt command isn't registered in the Rust shell yet.
  if (isTauriRuntime()) {
    let keychainHadValue = false;
    try {
      const mod = await import("@tauri-apps/api/core");
      const v = await mod.invoke<string | null>("secret_get_jwt");
      if (typeof v === "string" && v.length > 0) {
        memoryCache = v;
        cachedSource = "tauri-keychain";
        if (s) s.setItem(LICENSE_JWT_STORAGE_KEY, v);
        keychainHadValue = true;
      }
    } catch {
      // Command not registered (P1-1B reality). Stay on localStorage.
      // The label above already reflects "browser-localstorage".
    }
    /* P1-1F-b · gap-fix 1 · localStorage → Keychain migration backfill.
     *
     * If we're in a Tauri runtime, the Keychain prime did NOT return a
     * value (either it was empty or the command threw), AND the
     * localStorage prime above populated memoryCache, then this is an
     * existing user upgrading to the P1-1F-b build · seed the Keychain
     * with the current JWT so future boots benefit from native storage.
     *
     * Fire-and-forget so we never block initAuthStorage() on the
     * backfill. Failure is silent · localStorage stays the working
     * fallback. */
    if (!keychainHadValue && memoryCache) {
      void writeJwtToKeychain(memoryCache);
    }
  }

  if (cachedSource === "unavailable") cachedSource = "browser-localstorage";
  return cachedSource;
}

/** Test seam · resets the module cache. Test-only. */
export function _resetAuthStorageForTests(): void {
  memoryCache = null;
  cachedSource = "unavailable";
  initialized = false;
  /* P1-1F-b · gap-fix 3 · also clear the native Keychain entry so test
   * isolation holds when tests run under a Tauri runtime. Safe no-op in
   * browser preview (deleteJwtFromKeychain early-returns when
   * isTauriRuntime() is false). Failure is silent · this is a test
   * seam, not production. */
  void deleteJwtFromKeychain();
}
