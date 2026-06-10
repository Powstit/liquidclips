// Server-side Sentry verification. Hit /api/sentry-test (curl works) and the
// server throws — should appear in the Sentry dashboard within ~30s with the
// Node.js runtime tag. Delete this route once verified.

import { NextResponse } from "next/server";

export async function GET() {
  // Deliberate throw — captures via instrumentation.ts onRequestError +
  // global error handlers in sentry.server.config.ts.
  throw new Error("Sentry test from /api/sentry-test (server)");

  // Unreachable but keeps the type checker happy.
  return NextResponse.json({ ok: false });
}
