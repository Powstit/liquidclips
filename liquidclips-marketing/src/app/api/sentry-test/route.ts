// Server-side Sentry verification. Hit /api/sentry-test (curl works) and the
// server emits an explicit message, an explicit exception, flushes, then
// throws. Delete this route once verified.

import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  Sentry.captureMessage("sentry-test: explicit message from /api/sentry-test", "info");
  Sentry.captureException(
    new Error("sentry-test: explicit captureException from /api/sentry-test"),
  );
  await Sentry.flush(5000);

  throw new Error("sentry-test: throw from /api/sentry-test (onRequestError path)");

  // eslint-disable-next-line no-unreachable
  return NextResponse.json({ ok: false });
}
