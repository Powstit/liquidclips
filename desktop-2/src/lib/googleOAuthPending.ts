/**
 * googleOAuthPending.ts · Crew onboarding · F5 scanner OAuth wire
 *
 * Bridges the OS-browser Google consent flow to the F5 scanner. The
 * `productionOAuthDriver` (see `lib/f5/realDrivers.ts`) opens Google's
 * consent URL in the OS browser via `openSmart()` and *awaits* the
 * promise returned by `awaitGoogleOAuth()`. When Google redirects
 * back to the backend, the backend serves an HTML page that fires a
 * `liquidclips://google-oauth?token=...&state=...` deep-link. The
 * plumbing in `deepLinkBoot.ts` calls `resolvePendingGoogleOAuth()`
 * which parses the URL, verifies the state nonce, and settles the
 * pending promise.
 *
 * Discipline:
 *   * Only ONE OAuth flow can be in flight at a time — starting a new
 *     one before the previous resolves cancels the old promise with
 *     TIMEOUT (the state nonce would no longer match anyway).
 *   * Tokens are held in memory ONLY. No localStorage, no keychain,
 *     no session persistence.
 *   * State nonce lives in module memory too — SessionStorage is a
 *     nice-to-have but the app only has a single BrowserWindow so
 *     module memory is enough. If Daniel ever adds multi-window
 *     support, this needs to move to sessionStorage.
 *   * Silent no-op if the deep-link arrives without a pending promise
 *     (user closed & reopened between clicking Connect and the OS
 *     browser callback). Prevents crash + spurious error toasts.
 */

import type { OAuthResult, OAuthTokens } from "./f5/googleOAuth";

// ─── Module state ──────────────────────────────────────────────────

interface Pending {
  state: string;
  resolve: (result: OAuthResult) => void;
  timeoutHandle: number | null;
}

let pending: Pending | null = null;

/** How long we wait for the deep-link callback before failing with TIMEOUT. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// ─── Public API ────────────────────────────────────────────────────

export interface AwaitGoogleOAuthArgs {
  /** The anti-CSRF nonce that will be embedded in the Google consent
   *  URL as `state=<nonce>`. The backend echoes it into the deep-link
   *  and we verify equality here. */
  state: string;
  /** Override the default 5-minute wait. Tests pass a short timeout. */
  timeoutMs?: number;
}

/** Wait for the OS-browser OAuth callback to fire `liquidclips://google-oauth`.
 *  Returns a typed OAuthResult so the F5 scanner can walk its state
 *  machine (DENIED / MISCONFIGURED / NETWORK / TIMEOUT / ok). */
export function awaitGoogleOAuth(args: AwaitGoogleOAuthArgs): Promise<OAuthResult> {
  // Cancel any previous in-flight flow (only one Google consent screen
  // can be open at a time · starting a new one implies the old one
  // is dead).
  if (pending) {
    const prev = pending;
    pending = null;
    if (prev.timeoutHandle != null) {
      window.clearTimeout(prev.timeoutHandle);
    }
    prev.resolve({ ok: false, error: "TIMEOUT", note: "superseded by new flow" });
  }

  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise<OAuthResult>((resolve) => {
    const timeoutHandle = window.setTimeout(() => {
      if (pending && pending.state === args.state) {
        pending = null;
        resolve({ ok: false, error: "TIMEOUT", note: `no callback in ${timeoutMs}ms` });
      }
    }, timeoutMs);

    pending = {
      state: args.state,
      resolve,
      timeoutHandle: typeof timeoutHandle === "number" ? timeoutHandle : null,
    };
  });
}

/** Deep-link plumbing calls this on every `liquidclips://google-oauth?...`
 *  URL. Silent no-op if no pending promise or if state doesn't match. */
export function resolvePendingGoogleOAuth(rawUrl: string): void {
  if (!pending) return;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return;
  }
  if (parsed.protocol !== "liquidclips:" || parsed.hostname !== "google-oauth") {
    return;
  }
  const state = parsed.searchParams.get("state") ?? "";
  if (state !== pending.state) {
    // State mismatch — this could be an old callback the user triggered
    // in a stale browser tab. Do NOT settle the pending promise; leave
    // it alive so the user can retry. Silent so we don't log the state
    // value (it's a nonce, but keep the hygiene).
    return;
  }
  const captured = pending;
  pending = null;
  if (captured.timeoutHandle != null) {
    window.clearTimeout(captured.timeoutHandle);
  }

  const error = parsed.searchParams.get("error");
  if (error) {
    // Backend maps Google's `access_denied` → DENIED. Preserve the code.
    const mapped =
      error === "DENIED" || error === "MISCONFIGURED" || error === "NETWORK"
        ? error
        : "DENIED";
    captured.resolve({ ok: false, error: mapped, note: `callback error=${error}` });
    return;
  }

  const access = parsed.searchParams.get("token") ?? "";
  const refresh = parsed.searchParams.get("refresh") ?? "";
  const expiresAtRaw = parsed.searchParams.get("expires_at") ?? "";
  if (!access) {
    captured.resolve({ ok: false, error: "NETWORK", note: "missing token in callback" });
    return;
  }
  const expiresAt = Number.parseInt(expiresAtRaw, 10);
  const tokens: OAuthTokens = {
    access,
    refresh: refresh || null,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 3600_000,
    scope: [
      "https://www.googleapis.com/auth/contacts.readonly",
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
  };
  captured.resolve({ ok: true, tokens });
}

/** Test seam · resets the module state so unit tests aren't order-sensitive. */
export function _resetGoogleOAuthPendingForTests(): void {
  if (pending && pending.timeoutHandle != null) {
    window.clearTimeout(pending.timeoutHandle);
  }
  pending = null;
}

/** Diagnostic — is there a pending OAuth flow? Used by tests. */
export function hasPendingGoogleOAuth(): boolean {
  return pending !== null;
}

/** Mint a fresh anti-CSRF nonce. 16 bytes → 22 base64url chars. */
export function mintOAuthNonce(): string {
  // Prefer crypto.randomUUID when available (Tauri v2 webview + modern
  // Chromium ship it). Fall back to Math.random for very old environments
  // (shouldn't ever hit in Tauri).
  const globalCrypto = (typeof crypto !== "undefined" ? crypto : null) as (Crypto & { randomUUID?: () => string }) | null;
  if (globalCrypto?.randomUUID) {
    return globalCrypto.randomUUID().replace(/-/g, "");
  }
  const bytes = new Uint8Array(16);
  if (globalCrypto?.getRandomValues) {
    globalCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
