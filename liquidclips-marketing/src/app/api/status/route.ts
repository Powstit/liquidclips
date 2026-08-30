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
  let killedFeatures: string[] = [];
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
        // 2026-08-30 audit fix. Pull the killed_features list from
        // /healthcheck so the status page can render per-feature
        // "temporarily paused" cards. Beats the previous version
        // where /status said "all operational" while /submissions
        // returned 503 to every request.
        if (Array.isArray(b.killed_features)) {
          killedFeatures = b.killed_features.filter((x): x is string => typeof x === "string");
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

  // 2026-08-30 audit fix. Publishing (Ayrshare) subsystem removed —
  // for the 275-user beta, users share clips via the in-app browser's
  // persistent-cookie session on the social platforms directly. No
  // Ayrshare in the beta path → no reason to show it on the status
  // page (was previously showing false-green from `ayrshare_configured`
  // which only means "API key is set," not "Ayrshare's service is up").
  //
  // If publishing surfaces come back online for a wider launch, re-
  // add the subsystem here with a REAL health probe (Ayrshare's own
  // status endpoint or a canary POST), not a config-flag proxy.

  // --- 2. Per-feature launch-day kill switches --------------------
  //   Each flag currently active becomes its own "temporarily paused"
  //   card. Empty when nothing is killed = happy path invisible.
  const KILLED_LABELS: Record<string, { label: string; note: string }> = {
    clip_submissions: {
      label: "Clip submissions",
      note: "Submitting new clips is temporarily paused. Existing submissions still process. Local editing works.",
    },
    clip_generation: {
      label: "Clip generation",
      note: "AI-assisted clip generation is temporarily paused. Manual clipping in the workstation still works.",
    },
    publishing: {
      label: "Publishing",
      note: "Multi-platform publishing is temporarily paused. Share your clips manually via the in-app browser.",
    },
    wallet_withdrawal: {
      label: "Wallet withdrawals",
      note: "Withdrawals are temporarily paused. Your balance is safe.",
    },
    ai_transcribe: {
      label: "Hosted transcription",
      note: "Hosted transcription is temporarily paused. Local transcription in the sidecar still works.",
    },
    ai_llm: {
      label: "Hosted AI",
      note: "The hosted Anthropic + OpenAI clip-judge paths are temporarily paused. Manual clipping still works.",
    },
    community_chat: {
      label: "Community chat",
      note: "Posting to community rooms is temporarily paused. Reading + reactions still work.",
    },
    whop_redirect: {
      label: "Whop redirects",
      note: "In-app links to Whop are temporarily paused. Access Whop directly at whop.com.",
    },
  };
  for (const flag of killedFeatures) {
    const meta = KILLED_LABELS[flag];
    subsystems.push({
      key: `killed:${flag}`,
      label: meta?.label ?? flag,
      status: "down",
      note: meta?.note ?? `${flag} is temporarily disabled by admin.`,
    });
  }

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
