// Thin client-side proxy → junior-backend `/admin/audit-log`.
//
// The AI Terminal client component can call this when it needs to append
// a non-AI audit entry (e.g. "context switched", "session cleared")
// without needing to know the internal secret. The /api/admin/ai/run
// handler already audits AI calls server-side; this exists for the small
// set of client-initiated audit events.
//
// Contract matches Agent 3's `POST /admin/audit-log`:
//   { actor_email, action, target_type, target_id, payload_json, result }

import { NextResponse, type NextRequest } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdmin } from "@/lib/admin-allowlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

type AuditBody = {
  action?: string;
  target_type?: string;
  target_id?: string;
  payload_json?: Record<string, unknown>;
  result?: "ok" | "error";
};

export async function POST(req: NextRequest): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }
  const email = (user.primaryEmailAddress?.emailAddress ?? "").trim().toLowerCase();
  if (!isAdmin(email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }

  let body: AuditBody;
  try {
    body = (await req.json()) as AuditBody;
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  // P0-002 audit-forge guard:
  //   - `action` MUST start with "ai.client." (this route is for client-side
  //     AI-terminal audit pings only; everything else must come from a
  //     server-side mutation endpoint).
  //   - `target_type` / `target_id` are server-overridden to "ai"/"terminal"
  //     regardless of client input.
  //   - `result` is clamped to "ok" | "error".
  //   - `actor_email` forced from Clerk session (existing behaviour).
  const action =
    typeof body.action === "string" ? body.action : "ai.client.unspecified";
  if (!action.startsWith("ai.client.")) {
    return NextResponse.json(
      { error: "action prefix not allowed for client audit" },
      { status: 403 },
    );
  }

  const payload = {
    actor_email: email,
    action,
    target_type: "ai",
    target_id: "terminal",
    payload_json:
      body.payload_json && typeof body.payload_json === "object"
        ? body.payload_json
        : {},
    result: body.result === "error" ? "error" : "ok",
  };

  try {
    const res = await fetch(`${BACKEND_URL}/admin/audit-log`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
  }
}
