import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { isValidReferralCode } from "@/lib/referralCode";

// v0.7.59 — Marketing now hosts the customer-facing auth routes natively
// (/sign-in, /sign-up, /connect-desktop). clerkMiddleware needs to run on
// every request that might surface a Clerk widget so the handshake +
// session-cookie flows complete correctly.
//
// Phase 4 add · referral capture. When a visitor lands with `?ref=CODE`,
// we set two cookies (lc_ref + lc_source) and fire-and-forget a POST to
// the click-log endpoint so the click is recorded in the DB. Cookies
// persist 30 days — matches the spec'd attribution window.

const REF_COOKIE = "lc_ref";
const SOURCE_COOKIE = "lc_source";
const REF_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export default clerkMiddleware(async (_auth, req: NextRequest) => {
  const res = NextResponse.next();
  res.headers.set("content-security-policy", "frame-ancestors 'none'");
  res.headers.set("x-frame-options", "DENY");

  // ── Referral capture · runs only on document requests (not /_next, not
  // /api), bounded by the matcher below. ───────────────────────────────
  const url = new URL(req.url);
  const refParam = url.searchParams.get("ref");

  if (refParam && isValidReferralCode(refParam)) {
    const existing = req.cookies.get(REF_COOKIE)?.value;

    // First-touch attribution — only set the cookie if we don't already
    // hold a valid ref for this visitor. Prevents the last-touch from
    // overwriting a real earlier referrer.
    if (!isValidReferralCode(existing)) {
      res.cookies.set(REF_COOKIE, refParam, {
        path: "/",
        maxAge: REF_COOKIE_MAX_AGE,
        sameSite: "lax",
        secure: true,
        // 2026-07-04 hardening · httpOnly:true prevents XSS from
        // reading the ref cookie. Nothing on the frontend needs to
        // read it directly — the DB row is the source of truth.
        httpOnly: true,
      });
      res.cookies.set(SOURCE_COOKIE, "referral", {
        path: "/",
        maxAge: REF_COOKIE_MAX_AGE,
        sameSite: "lax",
        secure: true,
        // 2026-07-04 hardening · httpOnly:true prevents XSS from
        // reading the ref cookie. Nothing on the frontend needs to
        // read it directly — the DB row is the source of truth.
        httpOnly: true,
      });

      // Fire-and-forget click log. We don't await — middleware must stay
      // fast. The click route writes to the referral_clicks DB table
      // (or no-ops gracefully if DATABASE_URL isn't set yet).
      try {
        const clickUrl = new URL("/api/referrals/click", url.origin);
        // Pass through Vercel's geo header so the click row gets country.
        const country =
          req.headers.get("x-vercel-ip-country") ??
          req.headers.get("cf-ipcountry") ??
          null;
        const ip =
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          req.headers.get("x-real-ip") ??
          null;
        const ua = req.headers.get("user-agent") ?? null;
        const landedPath = url.pathname;

        // Don't await — the response continues immediately.
        void fetch(clickUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            referralCode: refParam,
            country,
            ip,
            ua,
            landedPath,
          }),
        });
      } catch {
        // Silent · click log is non-essential for page render.
      }
    }
  }

  return res;
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/__clerk/(.*)",
    "/(api|trpc)(.*)",
  ],
};
