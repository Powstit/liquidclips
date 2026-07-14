/**
 * RC1 Train B3 · HQ read-only proxy for GET /admin/lcos-events/topics.
 * See sibling ../route.ts for the auth flow rationale.
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

export async function GET(_req: NextRequest): Promise<Response> {
  const adminId = await requireAdminId();
  if (!adminId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const params = new URLSearchParams({ clerk_user_id: adminId });
  const target = `${BACKEND_URL}/admin/lcos-events/topics?${params.toString()}`;
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
