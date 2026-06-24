import { NextResponse, type NextRequest } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdmin } from "@/lib/admin-allowlist";

// HQ Agent 5 · Recovery /pin proxy.
//
// Sets (or rotates with ?force=true) the recovery PIN. Admin-gated end-to-end:
//   1. Clerk session must exist + primary email is on the admin allowlist
//      (defence in depth — the backend re-checks via require_admin).
//   2. clerk_user_id is injected server-side from the verified session, so the
//      browser can never spoof another admin's id.
//   3. The internal secret stays on the server.
//
// The backend refuses to silently overwrite an existing hash unless ?force=true
// is passed; the form must surface a "rotate" confirmation before sending it.

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

async function requireAdminId(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const user = await currentUser();
  if (!user) return null;
  const email = (
    user.primaryEmailAddress?.emailAddress ?? ""
  )
    .trim()
    .toLowerCase();
  if (!isAdmin(email)) return null;
  return userId;
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<Response> {
  const adminId = await requireAdminId();
  if (!adminId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.text();
  const incoming = new URL(req.url).searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of incoming.entries()) {
    if (k === "clerk_user_id") continue; // never trust the client
    params.set(k, v);
  }
  params.set("clerk_user_id", adminId);

  const target = `${BACKEND_URL}/admin/recovery/pin?${params.toString()}`;

  try {
    const res = await fetch(target, {
      method: "POST",
      headers: {
        "content-type":
          req.headers.get("content-type") ?? "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
      },
      body,
      cache: "no-store",
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "content-type":
          res.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "backend unreachable" },
      { status: 502 },
    );
  }
}
