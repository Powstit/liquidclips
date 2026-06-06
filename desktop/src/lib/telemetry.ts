// Desktop error telemetry — fire-and-forget structured reports to the backend
// collector (POST /telemetry/desktop-error). METADATA ONLY: event name, app
// version, os/arch, route/action, http status / error code, a short SANITIZED
// message. NEVER sends the license JWT, Whop tokens, secrets, or file paths.
//
// This is the "report" half of the bug loop: the app self-heals known states
// (stale JWT, offline, update failure, export cap) AND reports them so Admin HQ
// can show where real users break. Reporting must never throw or block the app.

// v0.7.x — canonical backend host. Same Railway service also serves at
// api.jnremployee.com for back-compat with v0.7.2 and older installs.
const PROD_BACKEND_URL = "https://api.liquidclips.app";
const DEV_BACKEND_URL = "http://localhost:8000";
const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ??
  (import.meta.env.DEV ? DEV_BACKEND_URL : PROD_BACKEND_URL);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g;
// Strip anything that looks like a filesystem path so we never leak local paths.
const PATH_RE = /(?:\/[\w.\- ]+){2,}|[A-Za-z]:\\[^\s]+/g;

function sanitize(msg: string | null | undefined): string | null {
  if (!msg) return null;
  return String(msg)
    .replace(EMAIL_RE, "[email]")
    .replace(PATH_RE, "[path]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300) || null;
}

let appVersion = "unknown";
let osName = "unknown";
let cpuArch = "unknown";
let cachedUserRef: string | null = null;
let metaLoaded = false;

const CONSENT_KEY = "liquidclips:telemetry-consent:v1";

/** True when the user has opted in to anonymous telemetry. Default = false
 * (opt-in posture). Persists across launches via localStorage so the
 * Settings toggle is honored unconditionally. */
export function getTelemetryConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the user's consent choice from the Settings toggle. */
export function setTelemetryConsent(allow: boolean): void {
  try {
    if (allow) {
      localStorage.setItem(CONSENT_KEY, "1");
    } else {
      localStorage.removeItem(CONSENT_KEY);
    }
  } catch {
    /* localStorage unavailable — silently keep the in-memory default */
  }
}

/** Set the internal user id (backend user id / clerk id — NOT a JWT) for
 * grouping in Admin HQ. Best-effort; safe to leave unset. */
export function setTelemetryUserRef(ref: string | null): void {
  cachedUserRef = ref;
}

async function loadMeta(): Promise<void> {
  if (metaLoaded) return;
  metaLoaded = true;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    appVersion = await getVersion();
  } catch {
    /* not in Tauri / API unavailable */
  }
  try {
    const ua = (typeof navigator !== "undefined" ? navigator.userAgent : "") || "";
    osName = /Mac/i.test(ua) ? "macos" : /Win/i.test(ua) ? "windows" : /Linux/i.test(ua) ? "linux" : "unknown";
    cpuArch = /arm64|aarch64/i.test(ua) ? "aarch64" : /(x86_64|x64|Intel|Win64)/i.test(ua) ? "x86_64" : "unknown";
  } catch {
    /* navigator unavailable */
  }
}

export type DesktopErrorReport = {
  route?: string | null;
  http_status?: number | null;
  error_code?: string | null;
  message?: string | null;
};

export async function reportDesktopError(event: string, opts: DesktopErrorReport = {}): Promise<void> {
  // Privacy: honor the Settings → telemetry consent toggle. Default is opt-out
  // (getTelemetryConsent() returns false until the user flips the switch),
  // matching the Liquid Clips local-first positioning. The reporter goes
  // completely silent when consent is absent — no fetch, no log.
  if (!getTelemetryConsent()) {
    return;
  }
  try {
    await loadMeta();
    const body = {
      event,
      app_version: appVersion,
      os: osName,
      arch: cpuArch,
      route: opts.route ?? null,
      http_status: opts.http_status ?? null,
      error_code: opts.error_code ?? null,
      message: sanitize(opts.message),
      user_ref: cachedUserRef,
    };
    await fetch(`${BACKEND_URL}/telemetry/desktop-error`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* telemetry must NEVER break the app */
  }
}
