// Sentry server (Node.js) init. Runs in the Next.js Node runtime for server
// components, server actions, and API routes. Captures unhandled server errors
// and traces a portion of requests.

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn:
    process.env.SENTRY_DSN ??
    "https://d8cb20dbccc11e5db66a16b636c3d34e@o4511540773191680.ingest.us.sentry.io/4511540778106880",

  sendDefaultPii: true,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Attach local variable values to stack frames so we get meaningful context.
  includeLocalVariables: true,

  enableLogs: true,
});
