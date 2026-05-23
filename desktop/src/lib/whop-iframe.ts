// Whop iframe auth bridge — SCAFFOLDING, not yet production-real.
//
// Status (2026-05-23): the message names + URL-param names below were guessed,
// not pulled from Whop's SDK. According to docs.whop.com/llms-full.txt the
// actual auth contract for a registered Whop app is:
//   1. Whop hosts the app at https://whop.com/experiences/<id> (iframe parent
//      origin = "https://whop.com" — NOT "*.whop.com").
//   2. Whop injects "x-whop-user-token" as an HTTP header on every same-origin
//      request the iframe makes. The token is a short-lived JWT.
//   3. The backend verifies the JWT via the @whop/sdk `verifyUserToken` call
//      reading that header.
//   4. The official client package is @whop/iframe + @whop/react. createSdk()
//      is for app→Whop actions (in-app purchase modal, etc.) — NOT for reading
//      the user token, which is server-side only.
//
// Implications:
//   - For a Tauri desktop build (this app), iframe auth never applies. The
//     desktop is not framed by Whop. Standalone paste / OAuth is the path.
//   - For a future web build of Junior registered as a Whop app, drop this
//     file and replace with @whop/iframe + a backend route that reads
//     x-whop-user-token. The postMessage shape below is not part of that flow.
//
// Why this file still exists: inWhopIframe() is still useful for any future
// web-preview hosted inside Whop (it doesn't auth — it just decides which UI
// chrome to show). The postMessage bridge is left as a stub that is now a
// no-op in practice, and attachWhopIframeAuth() calls onTokenFailed promptly
// so the UI surfaces "use the paste flow" instead of spinning forever.

import { sidecar } from "./sidecar";

/** True iff we're running inside a whop.com iframe. Two signals:
 *   1. window.parent !== window  (we're framed)
 *   2. document.referrer matches *.whop.com  (parent is Whop)
 * Either signal alone is too noisy — we require both.
 */
export function inWhopIframe(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.parent === window) return false;
    const ref = (document.referrer || "").toLowerCase();
    if (!ref) {
      // Referrer can be blank on subsequent navigations even inside Whop.
      // Fall back to checking ancestor origin if available, but treat the
      // /experiences/ path as a strong hint we're framed by Whop.
      return /^\/experiences\//.test(window.location.pathname);
    }
    return /whop\.com(?::\d+)?\/?$/.test(new URL(ref).host) ||
      /whop\.com$/.test(new URL(ref).hostname);
  } catch {
    return false;
  }
}


/** Try to find a Whop user/session token in the URL hash. We do NOT accept
 * generic `token=` from the query string — that leaks into browser history,
 * referer headers, hosting logs, and analytics before we can scrub it. Only
 * Whop-namespaced keys in the URL fragment (which is never sent to servers)
 * are accepted, and the URL is rewritten immediately after capture so the
 * token doesn't survive a screenshot or a back-button.
 *
 * Returns { token, location } so the caller can clean both the hash and any
 * stray query string in one history.replaceState call.
 */
function tokenFromUrl(): { token: string; source: "hash" } | null {
  if (typeof window === "undefined") return null;
  const candidates = ["whop_token", "whop_user_token", "session_token", "id_token"];

  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : "";
  if (hash) {
    const h = new URLSearchParams(hash);
    for (const k of candidates) {
      const v = h.get(k);
      if (v) return { token: v, source: "hash" };
    }
  }
  return null;
}


/** Strip token-shaped fragment + query params from the URL so the token
 * doesn't survive a screenshot, browser back, or referer header. */
function scrubUrlAfterCapture(): void {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    const tokenKeys = ["whop_token", "whop_user_token", "session_token", "id_token", "token", "access_token"];

    let changed = false;
    for (const k of tokenKeys) {
      if (url.searchParams.has(k)) {
        url.searchParams.delete(k);
        changed = true;
      }
    }
    if (url.hash) {
      const h = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
      let hashChanged = false;
      for (const k of tokenKeys) {
        if (h.has(k)) {
          h.delete(k);
          hashChanged = true;
        }
      }
      if (hashChanged) {
        const remaining = h.toString();
        url.hash = remaining ? `#${remaining}` : "";
        changed = true;
      }
    }
    if (changed) {
      window.history.replaceState(window.history.state, "", url.toString());
    }
  } catch {
    /* best-effort scrub — silent on failure */
  }
}


/** Cryptographically random request id used to bind a postMessage reply to
 * the request we sent. Without this, a hostile sibling app inside Whop could
 * race a reply at us. Falls back to Math.random in test/older environments. */
function makeNonce(): string {
  try {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}


/** Set up the iframe auth bridge.
 *
 * Behaviour:
 *   - Runs once on mount.
 *   - Reads any token in the URL and ships it to the sidecar straight away.
 *   - Posts to the Whop parent asking for the user's identity (best-effort).
 *   - Listens for inbound postMessage from whop.com for token push/refresh.
 *   - Cleans up on unmount.
 *
 * Returns a teardown function — call on component unmount to remove the
 * listener and clear the sidecar's in-memory token.
 */
export function attachWhopIframeAuth(opts: {
  onTokenCaptured?: (source: "url" | "postMessage") => void;
  onTokenFailed?: () => void;
}): () => void {
  if (typeof window === "undefined" || !inWhopIframe()) {
    // No-op outside Whop — caller stays on the standalone paste path.
    return () => undefined;
  }

  let cancelled = false;
  const requestId = makeNonce();

  // 1. URL-hash path — synchronous, fastest. Hash-only by design (query
  //    strings leak; see tokenFromUrl). On capture we scrub the URL and
  //    fire a global event so consumers (EarnTab) react without polling.
  const urlToken = tokenFromUrl();
  if (urlToken) {
    void (async () => {
      try {
        await sidecar.whopSetSessionToken(urlToken.token);
        scrubUrlAfterCapture();
        if (!cancelled) {
          opts.onTokenCaptured?.("url");
          window.dispatchEvent(new CustomEvent("junior:whop-auth", { detail: { source: "url" } }));
        }
      } catch {
        if (!cancelled) opts.onTokenFailed?.();
      }
    })();
  }

  // 2. Ask the parent — STUB path. Real Whop apps don't reply to these
  //    message names. We send the request with a one-shot nonce and a known
  //    target origin (https://whop.com); reply listener requires the same
  //    nonce + e.source === window.parent before believing it.
  const targetOrigin = "https://whop.com";
  try {
    window.parent.postMessage(
      { type: "whop.app.requestAuth", source: "junior", requestId },
      targetOrigin,
    );
  } catch {
    /* cross-origin parent access can throw — ignore */
  }
  const failTimer = window.setTimeout(() => {
    if (!cancelled) opts.onTokenFailed?.();
  }, 3000);

  // 3. Inbound listener. Hardened:
  //    - origin allowlist (https://whop.com)
  //    - e.source MUST be the parent window
  //    - reply must echo our requestId AND carry a recognised response type
  //    Without all three, we ignore the message entirely.
  function onMessage(e: MessageEvent) {
    if (cancelled) return;
    if (!isFromWhop(e.origin)) return;
    if (e.source !== window.parent) return;
    const data = e.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== "object") return;
    const type = typeof data.type === "string" ? data.type : "";
    if (type !== "whop.app.authResponse" && type !== "whop.auth.token") return;
    if (typeof data.requestId === "string" && data.requestId !== requestId) return;
    const token = extractTokenFromMessage(data);
    if (!token) return;
    void (async () => {
      try {
        await sidecar.whopSetSessionToken(token);
        if (!cancelled) {
          opts.onTokenCaptured?.("postMessage");
          window.dispatchEvent(new CustomEvent("junior:whop-auth", { detail: { source: "postMessage" } }));
        }
      } catch {
        if (!cancelled) opts.onTokenFailed?.();
      }
    })();
  }
  window.addEventListener("message", onMessage);

  return () => {
    cancelled = true;
    window.clearTimeout(failTimer);
    window.removeEventListener("message", onMessage);
    // Clear the in-memory token so a stale Whop session doesn't leak into
    // a subsequent standalone-mode launch in the same process.
    void sidecar.whopClearSessionToken().catch(() => undefined);
  };
}


function isFromWhop(origin: string): boolean {
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    return /(^|\.)whop\.com$/i.test(host);
  } catch {
    return false;
  }
}


/** Whop's iframe SDK has used several message shapes over the years:
 *   { type: "auth", payload: { token } }
 *   { type: "whop.auth", token }
 *   { type: "user", id_token }
 * Try them all; return the first plausible string.
 */
function extractTokenFromMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  const direct =
    asString(d.token) ||
    asString(d.id_token) ||
    asString(d.session_token) ||
    asString(d.whop_user_token) ||
    asString(d.access_token);
  if (direct) return direct;

  const payload = d.payload as Record<string, unknown> | undefined;
  if (payload && typeof payload === "object") {
    const nested =
      asString(payload.token) ||
      asString(payload.id_token) ||
      asString(payload.session_token) ||
      asString(payload.access_token);
    if (nested) return nested;
  }

  return null;
}


function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
