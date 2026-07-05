/**
 * bridgeToBackend · shared typed helper for HTTP calls from the
 * desktop app to junior-backend.
 *
 * C1-T6 · 2026-07-05 · Wave 2 shared-rail codemod primitive.
 * Before this helper, every TS wrapper in sidecar-stub.ts and every
 * feature module rolled its own fetch: local `backendUrl()`, local
 * `authHeaders()`, ad-hoc content-type handling, no timeout, no
 * typed error, inconsistent handling of 204 No Content, unclear on
 * whether non-2xx should throw or return null. The audit's
 * rpc-contract-lens flagged 32 wrappers doing this dance — each
 * subtly different, and half of them silently fell back to fixture
 * data on failure (audit finding #23).
 *
 * This helper is the one place that owns:
 *   * `backendUrl()` — read once from VITE_BACKEND_URL, fall back to
 *     the prod API host so packaged Tauri builds always hit prod.
 *   * `authHeaders()` — attach Authorization: Bearer <jwt> when a
 *     license JWT is available in the keychain (via authStorage).
 *   * timeout — configurable per call (default 6 s · matches the
 *     wallet client's default).
 *   * error contract — throws a `BridgeError` on any non-2xx / non-
 *     204 response, carrying the status code and parsed body so
 *     callers can surface actionable errors to the user without
 *     re-parsing the response themselves.
 *   * 204 handling — returns `undefined` (typed as `TResp`) so
 *     DELETE handlers that emit 204 don't crash on `.json()`.
 *
 * Callers pass method + path + optional args (JSON-serialised for
 * non-GET). They get back the parsed response body or a thrown
 * BridgeError. No silent mock fallback lives here — mocks belong at
 * the wrapper layer where a per-feature dev-only branch can decide
 * what to do when the real backend isn't wired yet (Vite preview,
 * CI harness with no live backend).
 *
 * Downstream consumers (this landing task): agency + channels +
 * social + whop-rewards wrappers in sidecar-stub.ts. Follow-up
 * (CM-T6): discovery + submissions + announcements + scheduling
 * wrappers.
 */

import { getJwt } from "./authStorage";

const DEFAULT_TIMEOUT_MS = 6_000;

/** Read the backend base URL from Vite env; fall back to production. */
export function backendUrl(): string {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  try {
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    /* noop */
  }
  return "https://api.liquidclips.app";
}

/** Attach Authorization: Bearer <jwt> when a JWT is available. */
export function authHeaders(): Record<string, string> {
  const jwt = getJwt();
  if (!jwt) return {};
  return { authorization: `Bearer ${jwt}` };
}

/** Thrown from bridgeToBackend on any non-2xx (and non-204) response,
 *  or when the fetch itself rejects (network · abort · timeout). The
 *  status is 0 when there was no HTTP response at all. */
export class BridgeError extends Error {
  status: number;
  body: unknown;
  path: string;
  method: string;

  constructor(
    method: string,
    path: string,
    status: number,
    body: unknown,
    message?: string,
  ) {
    super(message ?? `bridgeToBackend ${method} ${path} → ${status}`);
    this.name = "BridgeError";
    this.method = method;
    this.path = path;
    this.status = status;
    this.body = body;
  }
}

export interface BridgeOptions {
  /** Caller-supplied abort signal · combined with the internal timeout. */
  signal?: AbortSignal;
  /** Override the default 6 s timeout. */
  timeoutMs?: number;
  /** Extra headers merged after content-type + auth. */
  extraHeaders?: Record<string, string>;
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

/**
 * Fire one HTTP call to junior-backend.
 *
 * @throws BridgeError on non-2xx / non-204 response, network error, timeout.
 * @returns parsed JSON body on 2xx · `undefined` on 204 No Content.
 */
export async function bridgeToBackend<TResp>(
  method: Method,
  path: string,
  args?: unknown,
  opts?: BridgeOptions,
): Promise<TResp> {
  const url = `${backendUrl()}${path}`;
  const headers: Record<string, string> = { ...authHeaders() };
  if (method !== "GET" && args !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (opts?.extraHeaders) {
    Object.assign(headers, opts.extraHeaders);
  }

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const signal = opts?.signal ? mergeSignals(opts.signal, ctrl.signal) : ctrl.signal;

  try {
    let r: Response;
    try {
      r = await fetch(url, {
        method,
        cache: "no-store",
        headers,
        signal,
        body:
          method !== "GET" && args !== undefined
            ? JSON.stringify(args)
            : undefined,
      });
    } catch (fetchErr) {
      // Network error / DNS / TLS / abort. Surface as BridgeError with
      // status 0 so callers can distinguish this from an HTTP-level
      // failure (e.g. 502) by reading `err.status === 0`.
      throw new BridgeError(
        method,
        path,
        0,
        null,
        `bridgeToBackend ${method} ${path} · network error: ${
          fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
        }`,
      );
    }

    if (r.status === 204) return undefined as unknown as TResp;

    const text = await r.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (!r.ok) {
      throw new BridgeError(method, path, r.status, body);
    }
    return body as TResp;
  } finally {
    clearTimeout(timer);
  }
}

/** Combine two AbortSignals into one that aborts when either does. */
function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return ctrl.signal;
}
