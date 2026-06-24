// P0-003 · AI model health check.
//
// Reviewer flagged `claude-opus-4-7` as potentially 404-ing. The current
// Claude Code system prompt confirms it is the correct Opus 4.7 model id,
// so we do NOT change the production model. Instead this route gives Daniel
// a one-click "is the model still reachable?" probe.
//
// Contract:
//   GET /api/admin/ai/health
//   → { model: "claude-opus-4-7", ok: boolean, error?: string }
//
// Gates:
//   - Admin-only via the shared `isAdmin` allowlist (P0-001).
//   - Rate-limited to 1 call per minute per admin (in-memory) to prevent
//     the route from being used as a Anthropic-credit drain.
//   - 1 input token (prompt = "ping"), max_tokens = 1 on the response so
//     the probe cost is effectively zero.
//
// This route never returns the Anthropic API key and never echoes the
// model's content — only ok/error metadata.

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import Anthropic from "@anthropic-ai/sdk";
import { isAdmin } from "@/lib/admin-allowlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODEL = "claude-opus-4-7";

// ---- Rate limit (1 call / minute / admin, in-memory) ---------------------

const lastCallByUser = new Map<string, number>();
const ONE_MINUTE_MS = 60 * 1000;

function rateLimitHit(userId: string): boolean {
  const now = Date.now();
  const last = lastCallByUser.get(userId);
  if (last && now - last < ONE_MINUTE_MS) return true;
  lastCallByUser.set(userId, now);
  return false;
}

type AdminIdentity = { userId: string; email: string };

async function requireAdmin(): Promise<AdminIdentity | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const user = await currentUser();
  if (!user) return null;
  const email = (user.primaryEmailAddress?.emailAddress ?? "").trim().toLowerCase();
  if (!isAdmin(email)) return null;
  return { userId, email };
}

export async function GET(): Promise<Response> {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }

  if (rateLimitHit(admin.userId)) {
    return NextResponse.json(
      { model: MODEL, ok: false, error: "rate limit: 1 call/minute" },
      { status: 429 },
    );
  }

  const apiKey = process.env.CLAUDE_ADMIN_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { model: MODEL, ok: false, error: "CLAUDE_ADMIN_API_KEY not configured" },
      { status: 503 },
    );
  }

  const client = new Anthropic({ apiKey });
  try {
    await client.messages.create({
      model: MODEL,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return NextResponse.json({ model: MODEL, ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "anthropic call failed";
    return NextResponse.json(
      { model: MODEL, ok: false, error: message },
      { status: 200 },
    );
  }
}
