/**
 * liveProbe · production-safe telemetry so a maintainer can SEE every
 * error + fetch happening in a release Tauri build without needing
 * Web Inspector access.
 *
 * 2026-07-20 · Daniel: "why cant u tell from ur end u should have eys
 * on every page" — Tauri release WebView isn't inspectable, so this
 * probe substitutes: every JS error, unhandled rejection, and fetch
 * result gets a `[lc-probe]` console.error line that macOS unified
 * log captures. `log show --process liquid-clips-shell --last 5m |
 * grep '\[lc-probe\]'` from any terminal gives a live X-ray of the
 * running app.
 *
 * Kept LEAN so it can't itself cause the class of bug we're diagnosing:
 *   - Never buffers · logs synchronously
 *   - Never fetches · piggy-backs on browser console output only
 *   - Never throws · every branch is try/catch → console.error fallback
 *   - Loop-guarded · fetch wrapper skips itself
 *   - URL redaction · JWTs + tokens replaced with `****`
 */

const TAG = "[lc-probe]";

function redactUrl(u: string): string {
  return u
    .replace(/(token|auth|jwt|key|secret|password)=[^&#]*/gi, "$1=****")
    .slice(0, 240);
}

function shortStack(err: unknown): string {
  if (!(err instanceof Error)) return String(err).slice(0, 200);
  const s = err.stack ?? err.message ?? String(err);
  return s.split("\n").slice(0, 4).join(" · ").slice(0, 400);
}

/**
 * Install once at boot. Safe to call multiple times (idempotent via
 * a window flag).
 */
export function installLiveProbe(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __LC_PROBE_INSTALLED?: boolean };
  if (w.__LC_PROBE_INSTALLED) return;
  w.__LC_PROBE_INSTALLED = true;

  // ── JS errors (throw in render, event handler, etc.) ────────────────
  window.addEventListener("error", (evt) => {
    try {
      const t = evt.target as HTMLElement | null;
      const targetSrc =
        t && "src" in t ? (t as HTMLImageElement).src :
        t && "href" in t ? (t as HTMLLinkElement).href :
        "";
      // eslint-disable-next-line no-console
      console.error(
        `${TAG} error · msg="${(evt.message ?? "").slice(0, 200)}" ` +
        `src="${redactUrl(targetSrc)}" ` +
        `file="${evt.filename ?? ""}:${evt.lineno ?? "?"}:${evt.colno ?? "?"}"`,
      );
    } catch { /* never rethrow */ }
  }, true);

  // ── Unhandled promise rejections ────────────────────────────────────
  window.addEventListener("unhandledrejection", (evt) => {
    try {
      // eslint-disable-next-line no-console
      console.error(
        `${TAG} reject · ${shortStack(evt.reason)}`,
      );
    } catch { /* never rethrow */ }
  });

  // ── fetch wrap · log every URL + method + status/latency ────────────
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = async function probeFetch(...args) {
      let url = "?";
      let method = "GET";
      try {
        const req = args[0];
        url = typeof req === "string" ? req : (req as Request).url;
        method = (args[1]?.method ?? (typeof req !== "string" ? (req as Request).method : "GET"))
          .toUpperCase();
      } catch { /* url extraction failed · keep placeholder */ }
      const t0 = Date.now();
      try {
        const res = await origFetch.apply(window, args);
        const ms = Date.now() - t0;
        if (res.status >= 400 || ms > 3000) {
          // eslint-disable-next-line no-console
          console.error(
            `${TAG} fetch · ${method} ${res.status} ${ms}ms · ${redactUrl(url)}`,
          );
        }
        return res;
      } catch (err) {
        const ms = Date.now() - t0;
        try {
          // eslint-disable-next-line no-console
          console.error(
            `${TAG} fetch-throw · ${method} ${ms}ms · ${redactUrl(url)} · ${shortStack(err)}`,
          );
        } catch { /* silent */ }
        throw err;
      }
    };
  }

  // ── Route-change breadcrumb ─────────────────────────────────────────
  window.addEventListener("hashchange", () => {
    try {
      // eslint-disable-next-line no-console
      console.error(`${TAG} route · ${location.hash}`);
    } catch { /* silent */ }
  });

  // ── Announce installation so we can prove it's active from log ─────
  try {
    // eslint-disable-next-line no-console
    console.error(`${TAG} installed at ${new Date().toISOString()}`);
  } catch { /* silent */ }
}
