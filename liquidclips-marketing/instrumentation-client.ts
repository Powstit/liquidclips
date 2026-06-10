// Sentry client (browser) init. Runs on every page render in the user's browser.
// Captures unhandled errors, navigation transitions, session replay segments,
// and traces a portion of requests for performance monitoring.
//
// DSN is public-by-design (Sentry rate-limits by project + IP, not by secrecy).
// Use NEXT_PUBLIC_SENTRY_DSN env var so it can be overridden per environment
// without rebuilding the bundle.

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn:
    process.env.NEXT_PUBLIC_SENTRY_DSN ??
    "https://d8cb20dbccc11e5db66a16b636c3d34e@o4511540773191680.ingest.us.sentry.io/4511540778106880",

  sendDefaultPii: true,

  // 100% sampling in dev, 10% in production. Adjust upward if traffic is light.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Session Replay: 10% of all sessions, 100% of sessions containing errors.
  // Lets us watch a recording of what the user did before the crash.
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  // Sentry Logs — structured logs from Sentry.logger.* calls.
  enableLogs: true,

  integrations: [Sentry.replayIntegration()],
});

// Hook into App Router navigation transitions so we capture client-side route
// changes as spans.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
