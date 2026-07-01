import { NextResponse } from "next/server";

// v2.2.14 · unified handle short URL.
//
// liquidclips.app/join/<handle> resolves the handle against our
// backend's /link-resolve/<handle> endpoint. The backend looks up
// the user by their unified handle field (chat @name = arcade
// leaderboard = share URL — all one identifier) and returns the real
// Whop affiliate code stamped on their account. We 302 the visitor
// straight to Whop-attributed checkout with that code so tracking
// stays intact even after the user renames their display handle.
//
// Failure modes we handle:
//   · handle shape invalid → 302 to plain checkout (no attribution)
//   · handle not found (404 from backend) → 302 to plain checkout
//   · backend unreachable → 302 to plain checkout · never a dead-end
//   · user has handle but no Whop affiliate code yet → backend returns
//     checkout_url with no ?a — we pass it through verbatim

const BACKEND = process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL
  ?? "https://api.jnremployee.com";
const ACCOUNT_HOST = "https://account.liquidclips.app";
const SAFE_HANDLE = /^[A-Za-z0-9._-]{1,60}$/;

export const dynamic = "force-dynamic";

interface LinkResolveOut {
  handle: string;
  affiliate_code: string | null;
  checkout_url: string;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ handle: string }> },
): Promise<NextResponse> {
  const { handle } = await ctx.params;
  if (!handle || !SAFE_HANDLE.test(handle)) {
    return NextResponse.redirect(`${ACCOUNT_HOST}/checkout`, 302);
  }

  try {
    const res = await fetch(
      `${BACKEND}/link-resolve/${encodeURIComponent(handle.toLowerCase())}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      return NextResponse.redirect(`${ACCOUNT_HOST}/checkout`, 302);
    }
    const data = (await res.json()) as LinkResolveOut;
    if (data.checkout_url) {
      return NextResponse.redirect(data.checkout_url, 302);
    }
  } catch {
    /* backend blip · fall through to plain checkout */
  }

  return NextResponse.redirect(`${ACCOUNT_HOST}/checkout`, 302);
}
