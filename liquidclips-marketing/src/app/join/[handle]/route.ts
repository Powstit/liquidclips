import { NextResponse } from "next/server";

// v2.2.13 · founder-friendly short affiliate URL.
//
// liquidclips.app/join/<handle> → account.liquidclips.app/checkout?a=<handle>
//
// Purpose: give clippers + founders a clean on-brand link they can drop
// into YouTube bios, TikTok captions, DMs, and Discord — instead of the
// raw checkout URL with a query string. The <handle> is passed straight
// through to the checkout page's affiliate attribution, so tracking
// stays intact.
//
// Sanitize the handle before forwarding so a hostile URL can't inject
// query params into the checkout redirect. Only allow characters Whop
// affiliate codes actually use (alphanumeric, dash, underscore, dot).
// Anything else → redirect to the plain checkout page with no affiliate.

const ACCOUNT_HOST = "https://account.liquidclips.app";
const SAFE_HANDLE = /^[A-Za-z0-9._-]{1,60}$/;

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ handle: string }> },
): Promise<NextResponse> {
  const { handle } = await ctx.params;
  if (!handle || !SAFE_HANDLE.test(handle)) {
    return NextResponse.redirect(`${ACCOUNT_HOST}/checkout`, 302);
  }
  const url = new URL(`${ACCOUNT_HOST}/checkout`);
  url.searchParams.set("a", handle);
  return NextResponse.redirect(url.toString(), 302);
}
