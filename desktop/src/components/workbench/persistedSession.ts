// ship-lens v0.7.8: W4 — drop dead `view` field from PersistedSession (no Grid mode); back-compat reader accepts old blobs with stale `view` and discards the field on next write.
// Workbench session persistence.
//
// Writes a tiny JSON blob to localStorage so reopening a project lands the
// user back on the same windows, ratios, focus, and selection. Writes are
// debounced by the store; this module just owns the read/write/flush surface.
//
// The schema is versioned. If we ever change PersistedSession shape, bump
// LC_WORKBENCH_SCHEMA_VERSION and add a migration arm in `read()`.

import type { PersistedSession } from "./types";
import { LC_WORKBENCH_PREF_KEY, LC_WORKBENCH_SCHEMA_VERSION } from "./types";

function emptyState(): PersistedSession {
  return {
    version: LC_WORKBENCH_SCHEMA_VERSION,
    byProject: {},
  };
}

function isPersistedSession(value: unknown): value is PersistedSession {
  // v0.7.8 W4: legacy blobs may carry a `view` field — we accept and silently
  // discard it. Only `version` + `byProject` shape matter going forward.
  if (!value || typeof value !== "object") return false;
  const v = value as { version?: unknown; byProject?: unknown };
  if (v.version !== LC_WORKBENCH_SCHEMA_VERSION) return false;
  if (!v.byProject || typeof v.byProject !== "object") return false;
  return true;
}

// R3 — throttle quota toast to once per session so a full disk doesn't spam.
let hasToastedQuota = false;

function isQuotaError(e: unknown): boolean {
  return (
    e instanceof DOMException && e.name === "QuotaExceededError"
  );
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    // Some Tauri webview configs throw on localStorage access in tests.
    return null;
  }
}

/** Read the persisted blob. Always returns a valid PersistedSession —
 *  on parse error, schema mismatch, or missing key, returns an empty state.
 *  v0.7.8 W4: normalizes legacy blobs by returning only `{ version, byProject }`
 *  — any stale `view` field on disk is dropped on first read. */
export function read(): PersistedSession {
  const ls = safeLocalStorage();
  if (!ls) return emptyState();
  try {
    const raw = ls.getItem(LC_WORKBENCH_PREF_KEY);
    if (!raw) return emptyState();
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedSession(parsed)) return emptyState();
    return { version: parsed.version, byProject: parsed.byProject };
  } catch {
    return emptyState();
  }
}

/** Best-effort persist. Quota / SecurityError / serialization errors are
 *  swallowed — we never want a persistence failure to crash the editor.
 *  R3: surfaces QuotaExceededError once per session via the lc:toast bus. */
export function write(state: PersistedSession): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.setItem(LC_WORKBENCH_PREF_KEY, JSON.stringify(state));
  } catch (e) {
    if (isQuotaError(e) && !hasToastedQuota) {
      hasToastedQuota = true;
      window.dispatchEvent(
        new CustomEvent("lc:toast", {
          detail: {
            kind: "warn",
            message:
              "Storage full — workbench layout won't save. Free up disk space.",
          },
        }),
      );
    }
    // All other errors (private-mode, serialization, etc.) stay swallowed.
  }
}

/** Synchronous flush — same body as write() today, but kept separate so the
 *  beforeunload path can never accidentally be made async. */
export function flush(state: PersistedSession): void {
  write(state);
}

// --- beforeunload registration ---------------------------------------------
//
// The store registers itself here via setFlushSource so we don't take a
// circular dependency on the store module. If no source has been registered
// (tests, SSR), the listener is a no-op.

type FlushSource = () => PersistedSession;
let flushSource: FlushSource | null = null;

export function setFlushSource(fn: FlushSource | null): void {
  flushSource = fn;
}

if (typeof window !== "undefined") {
  try {
    window.addEventListener("beforeunload", () => {
      const fn = flushSource;
      if (!fn) return;
      try {
        flush(fn());
      } catch {
        // Never block unload.
      }
    });
  } catch {
    // addEventListener can throw in some sandboxed contexts.
  }
}
