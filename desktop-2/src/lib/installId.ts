/**
 * Client install identifier — one-per-install stable UUID.
 *
 * Provides `getInstallId()` so HQ telemetry can bucket per install
 * without exposing raw identity (email, handle). This value:
 *
 *   * is generated on first read and persisted to `localStorage`
 *   * survives reload + relaunch + runtime bundle hot-swap
 *   * resets on explicit "hard reset" (localStorage clear) — expected
 *   * NEVER carries PII — a UUID has no user-recoverable meaning
 *
 * Consumers:
 *   - `hqEvents.identifiers.install_id`
 *   - future support-bundle uploader (for correlating a customer report
 *     with the corresponding HQ event stream)
 */

const INSTALL_ID_KEY = "lc.install.id.v1";
const INSTALL_ID_PREFIX = "install_";

let cached: string | null = null;

function generateInstallId(): string {
  const crypto = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (crypto && "randomUUID" in crypto) {
    return `${INSTALL_ID_PREFIX}${crypto.randomUUID()}`;
  }
  // Fallback for older WebViews — not cryptographic; uniqueness is the
  // only requirement.
  const rand = Math.random().toString(36).slice(2, 10);
  return `${INSTALL_ID_PREFIX}${Date.now().toString(36)}_${rand}`;
}

/**
 * Returns the persistent install id for this app copy.
 *
 * First read creates + persists a UUID; subsequent reads reuse it.
 * Safe to call from any surface (returns a cached value after the
 * first hit; no async work).
 *
 * Falls back to an in-memory identifier when localStorage is
 * unavailable — the value still stays stable within the current
 * process but resets on relaunch. HQ dashboards treat that as an
 * "install ephemeral" bucket rather than crashing.
 */
export function getInstallId(): string {
  if (cached) return cached;
  try {
    const stored = window.localStorage.getItem(INSTALL_ID_KEY);
    if (stored && stored.startsWith(INSTALL_ID_PREFIX)) {
      cached = stored;
      return cached;
    }
    const fresh = generateInstallId();
    window.localStorage.setItem(INSTALL_ID_KEY, fresh);
    cached = fresh;
    return cached;
  } catch {
    // localStorage denied — memoise a session-only id so callers stay
    // deterministic within the process.
    if (!cached) cached = generateInstallId();
    return cached;
  }
}

/** Test seam: reset the module cache so unit tests can exercise the
 *  first-read path per case. NOT exported to production consumers. */
export function __resetInstallIdCacheForTests(): void {
  cached = null;
}
