import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

// v0.7.x — satellite domain support. The SAME deployment serves both
// account.jnremployee.com (primary) and account.liquidclips.app (satellite).
// Satellite config lives in app/layout.tsx (ClerkProvider isSatellite / domain /
// signInUrl / signUpUrl) because it needs server-side host detection via
// headers(). Middleware just enables Clerk on the request path so the
// __clerk_handshake and __clerk_synced flows work correctly.
//
// Clerk v7 note: clerkMiddleware takes a static options object. The previous
// two-argument form (handler + options function) was silently ignored.
//
// v0.7.55 P0-001 fix — frame-deny headers MUST NOT cascade onto /embed/*
// because the Tauri webview hosts them inside the desktop app. The prior
// attempt used a `source: '/((?!embed/).*)'` negative-lookahead in
// next.config.ts. Next.js merges headers across every matching source —
// the `/embed/:path*` source set `frame-ancestors *` but the merge with
// the global rule still resulted in DENY winning. Live probe confirmed
// `content-security-policy: frame-ancestors 'none'` + `x-frame-options:
// DENY` on /embed/earn in production until this middleware took over.
//
// The middleware approach is the only path that gives us per-request
// header control without an ALL-matches merge.
// IRON GATE IG-HQ-001 — HQ admin IP allowlist.
// The block below is the FIRST line of defense for the HQ command-center.
// It runs BEFORE Clerk does anything observable to the caller, so probing
// /admin/* from an unlisted IP is indistinguishable from a 404 on a route
// that doesn't exist (no auth challenge, no redirect — silent denial).
//
// Match set: /admin/*  AND  /api/admin/*  (and only those).
// Source of truth: ADMIN_ALLOWED_IPS env var (CSV). Empty list = lock-out.
//
// IP source (P1-005 trust boundary):
//   1. x-vercel-forwarded-for — Vercel signs this header at the edge; the
//      browser CANNOT spoof a value that reaches our code. This is the
//      only trustworthy source in production.
//   2. x-forwarded-for — fallback ONLY in development (NODE_ENV !==
//      "production") for local testing. In production we ignore it
//      because the browser can set it before Vercel's edge sees the
//      request.
//   3. localhost dev sets neither → list is effectively closed unless dev
//      IP added.
//
// DO NOT edit this block without iron-gate-lens authorization. Touching the
// failure mode (404 vs 403 vs redirect) leaks admin existence.
function ipAllowedForAdmin(req: NextRequest): boolean {
  const vercel = req.headers.get("x-vercel-forwarded-for") ?? "";
  let firstHop = vercel.split(",")[0]?.trim() ?? "";
  if (!firstHop && process.env.NODE_ENV !== "production") {
    const xff = req.headers.get("x-forwarded-for") ?? "";
    firstHop = xff.split(",")[0]?.trim() ?? "";
  }
  const allowed = (process.env.ADMIN_ALLOWED_IPS ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
  if (!firstHop || allowed.length === 0) return false;
  return allowed.includes(firstHop);
}

function isAdminPath(pathname: string): boolean {
  return pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
}

// Recovery surfaces are the break-glass path for a locked-out admin.
// They MUST be reachable from a non-allowlisted IP (hotel wifi after a
// lost-laptop scenario), so they bypass the IP gate. Backend still
// rate-limits (3/24h per IP) AND runs strict 3-factor verification on
// non-allowlisted IPs (5-of-5 emails + PIN + auth code).
function isRecoveryPath(pathname: string): boolean {
  return (
    pathname.startsWith("/admin/recovery") ||
    pathname.startsWith("/api/admin/recovery")
  );
}

export default clerkMiddleware(async (_auth, req: NextRequest) => {
  const pathname = req.nextUrl.pathname;

  // IRON GATE IG-HQ-001 — admin IP gate runs BEFORE everything else.
  // Recovery surfaces are exempt (see isRecoveryPath rationale).
  if (
    isAdminPath(pathname) &&
    !isRecoveryPath(pathname) &&
    !ipAllowedForAdmin(req)
  ) {
    // 404 (not 403). Don't confirm the surface exists.
    return new NextResponse("Not Found", { status: 404 });
  }

  const res = NextResponse.next();
  if (pathname.startsWith("/embed")) {
    // Embed surfaces — frame-presentable for the Tauri webview. Don't
    // set frame-ancestors at all so the SSR layout's CSP wins. (Setting
    // `frame-ancestors *` would override any tighter policy a future
    // page might want; setting nothing preserves the option.)
    res.headers.delete("content-security-policy");
    res.headers.delete("x-frame-options");
  } else {
    // Everything else — explicit frame deny. Prevents marketing pages,
    // dashboard, sign-in, admin from being iframed by a third party.
    res.headers.set("content-security-policy", "frame-ancestors 'none'");
    res.headers.set("x-frame-options", "DENY");
  }
  return res;
});

export const config = {
  matcher: [
    // Match all routes except static assets we host directly.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always route Clerk's auto-proxy path.
    "/__clerk/(.*)",
    "/(api|trpc)(.*)",
  ],
};
