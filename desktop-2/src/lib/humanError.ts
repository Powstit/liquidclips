/**
 * humanError · one place that turns a thrown value into a message a person
 * can act on.
 *
 * The app has ~17 call sites doing `setError(e instanceof Error ? e.message
 * : String(e))`. That leaks the browser's raw network text straight into the
 * UI — "Failed to fetch" on Chromium, "Load failed" on WebKit/Tauri, "Load
 * failed" inside the packaged app — which reads as a crash to the user. This
 * helper rewrites only those cryptic runtime errors. Anything the backend
 * threw with a real human `detail` string (e.g. the distinguishable auth
 * errors, "Hosted AI requires Pro or Agency", quota messages) is already
 * plain English, so it passes straight through unchanged.
 *
 * Design rule: never invent detail the error didn't carry. If we recognise a
 * network/timeout shape we say so; otherwise we return the original message
 * (or the caller's fallback) rather than a generic "something went wrong"
 * that hides a real, actionable backend message.
 */

const NETWORK_RE = /failed to fetch|load failed|networkerror|network request failed|fetch failed|err_internet|err_network|err_connection/i;
const TIMEOUT_RE = /timed out|timeout|the operation was aborted/i;

export function humanError(ex: unknown, fallback = "Something went wrong · try again."): string {
  // Duck-type on name/message rather than `instanceof Error`. An aborted
  // fetch throws a DOMException("AbortError"), which is NOT `instanceof Error`
  // in some runtimes (notably the packaged WebView + the test env) — a strict
  // instanceof check would let the very timeout we added slip through to the
  // generic fallback. TypeError, Error, and DOMException all carry name+message.
  if (ex !== null && typeof ex === "object" && ("message" in ex || "name" in ex)) {
    const name = String((ex as { name?: unknown }).name ?? "");
    const msg = String((ex as { message?: unknown }).message ?? "").trim();
    // A fetch that never reached the server throws a TypeError; WebKit/Tauri
    // and Chromium each phrase it differently.
    if (name === "TypeError" || NETWORK_RE.test(msg)) {
      return "Couldn't reach Liquid Clips · check your internet connection and try again.";
    }
    // AbortController timeout (or an aborted request) surfaces here.
    if (name === "AbortError" || TIMEOUT_RE.test(msg)) {
      return "That took too long · check your connection and try again.";
    }
    return msg || fallback;
  }
  if (typeof ex === "string" && ex.trim()) return ex.trim();
  return fallback;
}
