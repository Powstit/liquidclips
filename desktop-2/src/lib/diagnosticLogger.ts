/**
 * Phase 1 · Golden-path diagnostic logger.
 *
 * Emits every probe point to:
 *   1. console (prefix `[LC-DIAG]`) — visible via DevTools
 *   2. POST /telemetry/diagnostic in batched flushes — Railway logs pick
 *      up each event as `[LC-CLIENT-DIAG]` so we can read them without
 *      opening the running app.
 *
 * Zero product logic. Zero silent catches. If flush fails, events sit
 * in memory and retry on next tick.
 *
 * Recovery brief mandate: instrument every fixture-fallback site + boot
 * state + auth lifecycle + export path + campaign_id BEFORE editing any
 * product code. Diagnostic-first, not fix-first.
 */

type DiagEvent = {
  topic: string;
  ts: number;
  data: Record<string, unknown>;
};

const BUFFER: DiagEvent[] = [];
const BUFFER_MAX = 1000;
const FLUSH_INTERVAL_MS = 2000;

function getBackendUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env || {};
  return env.VITE_BACKEND_URL || "https://api.liquidclips.app";
}

let sessionId = "";
function getSessionId(): string {
  if (sessionId) return sessionId;
  sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return sessionId;
}

export function lcDiag(topic: string, data: Record<string, unknown> = {}): void {
  const ev: DiagEvent = { topic, ts: Date.now(), data };
  BUFFER.push(ev);
  if (BUFFER.length > BUFFER_MAX) BUFFER.shift();
  try {
    // eslint-disable-next-line no-console
    console.log(`[LC-DIAG][${topic}]`, data);
  } catch { /* stringify failed · non-fatal */ }
}

async function flush(): Promise<void> {
  if (BUFFER.length === 0) return;
  const batch = BUFFER.splice(0, BUFFER.length);
  try {
    const resp = await fetch(`${getBackendUrl()}/telemetry/diagnostic`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lc-diag-session": getSessionId(),
      },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    });
    if (!resp.ok) {
      // Put them back so we retry (unless server explicitly rejected shape)
      if (resp.status >= 500 || resp.status === 0) {
        BUFFER.unshift(...batch);
      }
    }
  } catch {
    BUFFER.unshift(...batch);
  }
}

if (typeof window !== "undefined") {
  setInterval(flush, FLUSH_INTERVAL_MS);
  window.addEventListener("pagehide", () => { void flush(); });
  window.addEventListener("beforeunload", () => { void flush(); });
}

/**
 * Boot-time snapshot. Called from main.tsx before ReactDOM render.
 * Captures env mode, runtime version, Tauri presence, session id.
 */
export function bootDiag(): void {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env || {};

  let runtimeCanary: string | null = null;
  let runtimeVersion: string | null = null;
  try {
    if (typeof document !== "undefined") {
      runtimeCanary = document.querySelector('meta[name="runtime-canary"]')?.getAttribute("content") ?? null;
      runtimeVersion = document.querySelector('meta[name="runtime-version"]')?.getAttribute("content") ?? null;
    }
  } catch { /* dom access failed · non-fatal */ }

  const w = typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : {};
  const tauriPresent = "__TAURI_INTERNALS__" in w;
  const tauriMetadata = tauriPresent
    ? (w["__TAURI_METADATA__"] as Record<string, unknown> | undefined) ?? null
    : null;

  lcDiag("boot", {
    session_id: getSessionId(),
    mode: env.MODE || "unknown",
    dev: env.DEV === "true" || (env.DEV as unknown) === true,
    prod: env.PROD === "true" || (env.PROD as unknown) === true,
    has_clerk_key: !!env.VITE_CLERK_PUBLISHABLE_KEY,
    has_backend_url: !!env.VITE_BACKEND_URL,
    has_sentry_dsn: !!env.VITE_SENTRY_DSN,
    backend_url_display: env.VITE_BACKEND_URL || "unset",
    runtime_canary: runtimeCanary,
    runtime_version: runtimeVersion,
    runtime_source: runtimeVersion ? "staged" : "bundled",
    tauri_present: tauriPresent,
    tauri_metadata: tauriMetadata ? "present" : "absent",
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 120) : "no-nav",
    location_href: typeof location !== "undefined" ? location.href.slice(0, 200) : "no-loc",
    ts_iso: new Date().toISOString(),
  });
}

/**
 * Probe: SidecarState managed check. Called after Tauri boot but before
 * any user action. Attempts one lightweight sidecar call and reports the
 * result shape. Never throws.
 */
export async function probeSidecarState(): Promise<void> {
  const w = typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : {};
  const tauriPresent = "__TAURI_INTERNALS__" in w;

  if (!tauriPresent) {
    lcDiag("sidecar_probe", { result: "no_tauri", managed: false });
    return;
  }

  try {
    // Late-import so this file has no static dep on Tauri
    const mod = await import("@tauri-apps/api/core");
    const started = Date.now();
    // sidecar_call is the Rust command that dispatches to the sidecar
    // process. We call an intentional no-op method to see how it responds.
    // The Rust side either returns the sidecar's JSON, or errors with:
    //   - "state not managed" (BUG-RT-012) → cold-boot race
    //   - "no bundled sidecar" → BUG-RT-001 not-yet-fixed
    //   - "sidecar exhausted" → BUG-RT-011 restart cap tripped
    //   - or a proper method-not-found error → sidecar IS running
    let res: unknown;
    let errMsg: string | null = null;
    try {
      res = await mod.invoke("sidecar_call", { method: "ping", params: {} });
    } catch (e) {
      errMsg = e instanceof Error ? e.message : String(e);
    }
    const elapsed_ms = Date.now() - started;

    lcDiag("sidecar_probe", {
      elapsed_ms,
      managed: !errMsg || !errMsg.toLowerCase().includes("not managed"),
      error_present: !!errMsg,
      error_shape: errMsg ? classifyError(errMsg) : null,
      result_shape: res ? typeof res : null,
    });
  } catch (e) {
    lcDiag("sidecar_probe", {
      result: "import_failed",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

function classifyError(msg: string): string {
  const low = msg.toLowerCase();
  if (low.includes("not managed")) return "state_not_managed";
  if (low.includes("no bundled sidecar")) return "bundle_missing";
  if (low.includes("sidecar exhausted")) return "restart_cap";
  if (low.includes("sidecar binding resolution failed")) return "binding_failed";
  if (low.includes("command sidecar_call not found")) return "no_command";
  if (low.includes("method")) return "method_not_found";
  return "other";
}

export function getDiagSessionId(): string {
  return getSessionId();
}

export async function forceFlush(): Promise<void> {
  await flush();
}
