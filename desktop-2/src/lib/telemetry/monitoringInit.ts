/**
 * monitoringInit · Sentry + PostHog bootstrap.
 *
 * Runs synchronously at app startup (see main.tsx) BEFORE React mounts
 * so both monitors capture boot-time crashes and bootstrap-path events.
 * Both inits are env-gated: missing DSN/key = silent no-op, so dev
 * builds and CI without the env values don't touch either service.
 *
 * Both SDKs are attached to `globalThis` after init so the existing
 * envelope-sink pattern (`sentrySink.ts` reads `globalThis.Sentry`,
 * `posthogSink.ts` reads `globalThis.posthog`) picks them up without
 * any further wiring. That was the shape those files were already
 * written to consume — this file supplies the previously-missing
 * globals.
 *
 * Why not just `import` from the sinks? The sinks were designed as
 * loose-coupled optional consumers so a bundle without the SDKs can
 * still ship. Preserving that contract means the SDKs live behind
 * this one init module — the rest of the codebase stays SDK-agnostic.
 *
 * Every call is wrapped in try/catch so a telemetry init failure can
 * never take down the app. Silent monitoring is bad; a crashed app
 * because monitoring failed is worse.
 */

import * as Sentry from "@sentry/react";
import posthog from "posthog-js";

const SENTRY_SAMPLE_RATE = 0.15; // 15% of transactions traced (cost-aware)
const POSTHOG_DEFAULT_HOST = "https://us.i.posthog.com";

/**
 * Initialise Sentry + PostHog. Idempotent: safe to call multiple
 * times, but should only be called once (from `main.tsx` bootstrap).
 *
 * Returns a summary object useful for lcDiag telemetry so the boot
 * event can record whether monitoring came online.
 */
export function initMonitoring(): {
  sentryEnabled: boolean;
  posthogEnabled: boolean;
} {
  const sentryDsn = readEnv("VITE_SENTRY_DSN");
  const posthogKey = readEnv("VITE_POSTHOG_KEY");
  const posthogHost = readEnv("VITE_POSTHOG_HOST") ?? POSTHOG_DEFAULT_HOST;
  const environment = readEnv("VITE_LC_ENV") ?? readEnv("MODE") ?? "production";
  const release = readEnv("VITE_APP_VERSION") ?? readEnv("VITE_GIT_SHA") ?? undefined;

  let sentryEnabled = false;
  if (sentryDsn) {
    try {
      Sentry.init({
        dsn: sentryDsn,
        environment,
        release,
        tracesSampleRate: SENTRY_SAMPLE_RATE,
        // Never send events for benign network-abort noise the user
        // caused by closing the app / reloading. Sentry defaults would
        // flood alerts otherwise.
        ignoreErrors: [
          "AbortError",
          "The user aborted a request",
          "NetworkError when attempting to fetch resource",
          "Load failed",
        ],
        // PII redaction · never ship raw email or JWT contents to
        // Sentry. junior-backend already redacts server-side; this is
        // the browser-side belt.
        beforeSend(event) {
          try {
            if (event.user) {
              // Keep the id (server-side hash), strip email + ip.
              const { id } = event.user;
              event.user = id ? { id: String(id) } : {};
            }
            if (event.request?.headers) {
              delete event.request.headers.authorization;
              delete event.request.headers.Authorization;
              delete event.request.headers.cookie;
              delete event.request.headers.Cookie;
            }
          } catch {
            /* redact failure never blocks send */
          }
          return event;
        },
      });
      // Expose to global so `sentrySink.ts` picks it up.
      (globalThis as unknown as { Sentry?: typeof Sentry }).Sentry = Sentry;
      sentryEnabled = true;
    } catch {
      /* silent — telemetry init must never crash the app */
    }
  }

  let posthogEnabled = false;
  if (posthogKey) {
    try {
      posthog.init(posthogKey, {
        api_host: posthogHost,
        // Tauri app, not a website — we fire events via lcDiag by
        // hand. Disable everything auto so we control the volume +
        // shape completely.
        capture_pageview: false,
        capture_pageleave: false,
        autocapture: false,
        disable_session_recording: true,
        persistence: "localStorage",
        loaded: () => {
          // Nothing to do; sink picks it up from globalThis.
        },
      });
      (globalThis as unknown as { posthog?: typeof posthog }).posthog = posthog;
      posthogEnabled = true;
    } catch {
      /* silent */
    }
  }

  return { sentryEnabled, posthogEnabled };
}

/** Small wrapper around import.meta.env that survives SSR / older Vite. */
function readEnv(name: string): string | undefined {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const v = (import.meta as any).env?.[name];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Explicit "capture this error to Sentry" for error boundaries.
 * Silent no-op if Sentry isn't initialised. Adds a component tag so
 * the alert triage says "which route/component crashed."
 */
export function captureBoundaryError(
  err: Error,
  ctx: { route?: string; component?: string; sessionId?: string },
): void {
  try {
    const S = (globalThis as unknown as { Sentry?: typeof Sentry }).Sentry;
    if (!S) return;
    S.withScope((scope) => {
      if (ctx.route) scope.setTag("lc.route", ctx.route);
      if (ctx.component) scope.setTag("lc.component", ctx.component);
      if (ctx.sessionId) scope.setTag("lc.session_id", ctx.sessionId);
      scope.setLevel("error");
      S.captureException(err);
    });
  } catch {
    /* silent */
  }
}
