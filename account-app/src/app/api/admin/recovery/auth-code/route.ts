import { NextResponse, type NextRequest } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";

// HQ Agent 5 · Recovery /auth-code proxy.
//
// Identical contract to /pin — admin-gated, body forwarded, internal secret
// stays server-side. The backend stores a bcrypt hash; we never see or echo
// the raw code after submit.

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

const ADMIN_FALLBACK = [
  "danieldiyepriye@gmail.com",
  "mrddokubo@gmail.com",
  "crazycatjackkids@gmail.com",
  "thedoks2019@gmail.com",
];

function adminList(): string[] {
  const env = process.env.JUNIOR_ADMIN_EMAILS ?? "";
  const src = env ? env.split(",") : ADMIN_FALLBACK;
  return src.map((e) => e.trim().toLowerCase()).filter(Boolean);
}

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
  if (!email || !adminList().includes(email)) return null;
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
    if (k === "clerk_user_id") continue;
    params.set(k, v);
  }
  params.set("clerk_user_id", adminId);

  const target = `${BACKEND_URL}/admin/recovery/auth-code?${params.toString()}`;

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
