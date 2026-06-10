// Sentry client (browser) init for the account-app. Runs in every user's
// browser on every page render. Captures unhandled errors, navigation spans,
// session replay segments, and a sampled portion of traces.

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn:
    process.env.NEXT_PUBLIC_SENTRY_DSN ??
    "https://d8cb20dbccc11e5db66a16b636c3d34e@o4511540773191680.ingest.us.sentry.io/4511540778106880",

  sendDefaultPii: true,

  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Session Replay — 10% of all sessions, 100% of sessions containing errors.
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  enableLogs: true,

  integrations: [Sentry.replayIntegration()],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
