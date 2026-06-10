// Server-side registration hook. Next.js calls this once per runtime when the
// server boots. Loads the matching Sentry config based on which runtime the
// request is running in.

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Automatically captures all unhandled server-side request errors. Requires
// @sentry/nextjs >= 8.28.0.
export const onRequestError = Sentry.captureRequestError;
