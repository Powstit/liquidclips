/**
 * GET /api/status · public status endpoint for status.liquidclips.app.
 *
 * Server-side proxy that hits junior-backend `/healthcheck` (Railway)
 * and shapes the response into per-subsystem chips the /status page
 * renders. Doing this server-side avoids CORS on the browser call and
 * lets us add other health probes (Vercel · Whop pings · Ayrshare ·
 * runtime manifest) without exposing internal endpoints or coupling
 * the browser to a specific backend host.
 *
 * Cached 15s via `revalidate` so a burst of tab-refreshes doesn't
 * hammer the backend. Longer intervals hide real outages from users;
 * shorter intervals waste requests and rate-limit budget.
 */

import { NextResponse } from "next/server";

// Backend host per DEPLOYMENT.md (2026-07-29 confirmed with Daniel:
// api.jnremployee.com is the canonical; api.liquidclips.app is the
// stale/old domain wrongly documented as canonical in some places).
const BACKEND_URL = process.env.STATUS_BACKEND_URL || "https://api.jnremployee.com";

// Vercel Next.js runtime cache · 15s per §revalidate. Note in the
// route's `export const revalidate = 15` below.
export const revalidate = 15;

export type SubsystemStatus = "operational" | "degraded" | "down" | "unknown";

export interface StatusSubsystem {
  key: string;
  label: string;
  status: SubsystemStatus;
  note?: string | null;
}

export interface StatusPayload {
  overall: SubsystemStatus;
  subsystems: StatusSubsystem[];
  checked_at_iso: string;
  backend_url: string;
}

function overallFrom(subsystems: StatusSubsystem[]): SubsystemStatus {
  if (subsystems.some((s) => s.status === "down")) return "down";
  if (subsystems.some((s) => s.status === "degraded")) return "degraded";
  if (subsystems.some((s) => s.status === "unknown")) return "degraded";
  return "operational";
}

export async function GET(): Promise<NextResponse<StatusPayload>> {
  const checkedAt = new Date().toISOString();
  const subsystems: StatusSubsystem[] = [];

  // --- 1. Backend API healthcheck ---------------------------------
  //   Hit /healthcheck with an 8s timeout. Any non-200 or exception
  //   flips backend → `down`. Slow response (>3s but <=8s) → `degraded`.
  const t0 = Date.now();
  let backendStatus: SubsystemStatus = "unknown";
  let ayrshareConfigured: boolean | null = null;
  let ayrshareWebhookSecured: boolean | null = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const r = await fetch(`${BACKEND_URL}/healthcheck`, {
      signal: controller.signal,
      // Server-fetch cache disabled — the OUTER `revalidate = 15` on
      // this route governs cadence; inner fetch stays fresh so we
      // don't double-cache a stale healthcheck.
      cache: "no-store",
    });
    clearTimeout(timeout);
    const elapsed = Date.now() - t0;
    if (r.ok) {
      backendStatus = elapsed > 3_000 ? "degraded" : "operational";
      const body: unknown = await r.json();
      if (body && typeof body === "object") {
        const b = body as Record<string, unknown>;
        if (typeof b.ayrshare_configured === "boolean") {
          ayrshareConfigured = b.ayrshare_configured;
        }
        if (typeof b.ayrshare_webhook_secured === "boolean") {
          ayrshareWebhookSecured = b.ayrshare_webhook_secured;
        }
      }
    } else {
      backendStatus = "down";
    }
  } catch {
    backendStatus = "down";
  }
  subsystems.push({
    key: "backend",
    label: "Backend API",
    status: backendStatus,
    note:
      backendStatus === "down"
        ? "The Liquid Clips backend is not responding. Sign-in, submissions, and payouts may be temporarily unavailable."
        : backendStatus === "degraded"
          ? "The backend is responding slowly."
          : null,
  });

  // --- 2. Publishing (Ayrshare) -----------------------------------
  //   Derived from the healthcheck's own flag — if the backend is
  //   down we can't know; report unknown rather than falsely-green.
  const publishingStatus: SubsystemStatus =
    backendStatus === "down"
      ? "unknown"
      : ayrshareConfigured === false
        ? "down"
        : ayrshareConfigured === true
          ? "operational"
          : "unknown";
  subsystems.push({
    key: "publishing",
    label: "Publishing (Ayrshare)",
    status: publishingStatus,
    note:
      publishingStatus === "down"
        ? "Scheduled + immediate posts to TikTok / YouTube / IG are paused. The rest of the app works."
        : publishingStatus === "unknown" && backendStatus !== "down"
          ? "Publishing status not surfaced by the backend."
          : null,
  });

  // --- 3. Webhook signature verification --------------------------
  //   Not user-visible severity, but ops-visible on the status page.
  const webhookStatus: SubsystemStatus =
    backendStatus === "down"
      ? "unknown"
      : ayrshareWebhookSecured === false
        ? "degraded"
        : ayrshareWebhookSecured === true
          ? "operational"
          : "unknown";
  subsystems.push({
    key: "webhooks",
    label: "Webhook signing",
    status: webhookStatus,
    note:
      webhookStatus === "degraded"
        ? "Webhook signature verification is bypassed. Not user-visible; ops should investigate."
        : null,
  });

  const payload: StatusPayload = {
    overall: overallFrom(subsystems),
    subsystems,
    checked_at_iso: checkedAt,
    backend_url: BACKEND_URL,
  };

  return NextResponse.json(payload, {
    headers: {
      // Client-side polling reads this every 30s. Public cache 15s
      // matches the outer revalidate so intermediary caches (Cloudfront /
      // Vercel Edge) don't stale beyond one poll cycle.
      "cache-control": "public, max-age=15, stale-while-revalidate=30",
    },
  });
}
