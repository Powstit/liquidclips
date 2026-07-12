/**
 * RC1 Train B3 · HQ read-only proxy for GET /admin/lcos-events.
 *
 * Same three-layer defence-in-depth as /api/admin/[...path]/route.ts:
 *   1. Clerk auth on this Next.js route.
 *   2. Server-side capability check (HQ_READ) with the email allowlist
 *      as a compat fallback.
 *   3. The backend also re-checks `is_admin_email` via require_admin.
 *
 * The internal secret + admin email list NEVER reach the browser.
 */

import { NextResponse, type NextRequest } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdmin } from "@/lib/admin-allowlist";
import {
  fetchCapabilities,
  hasCapability,
  CAP,
} from "@/lib/server-capabilities";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

async function requireAdminId(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const user = await currentUser();
  if (!user) return null;
  const email = (user.primaryEmailAddress?.emailAddress ?? "")
    .trim()
    .toLowerCase();

  const snapshot = await fetchCapabilities(userId);
  if (snapshot && hasCapability(snapshot, CAP.HQ_READ)) return userId;
  if (snapshot === null && isAdmin(email)) return userId;
  return null;
}

export async function GET(req: NextRequest): Promise<Response> {
  const adminId = await requireAdminId();
  if (!adminId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const incoming = new URL(req.url).searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of incoming.entries()) {
    if (k === "clerk_user_id") continue; // never trust the client
    params.set(k, v);
  }
  params.set("clerk_user_id", adminId);

  const target = `${BACKEND_URL}/admin/lcos-events?${params.toString()}`;
  try {
    const res = await fetch(target, {
      method: "GET",
      headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "" },
      cache: "no-store",
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
  }
}
