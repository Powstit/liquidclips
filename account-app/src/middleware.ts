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
// IRON GATE IG-HQ-001 — HQ admin gates.
//
// HISTORY: an IP allowlist used to gate /admin/* before Clerk auth, returning
// 404 to non-allowlisted IPs. Removed 2026-06-25 per Daniel: too much friction
// for a solo founder on a rotating ISP IP, while delivering little extra
// security on top of the email + Clerk + 2FA + recovery stack already in
// place. The gate now relies on:
//   1. Clerk session (must be signed in)
//   2. Admin email allowlist (JUNIOR_ADMIN_EMAILS env, checked in page.tsx
//      server component for /admin and via lib/admin-allowlist.ts for every
//      /api/admin/* route)
//   3. Clerk 2FA on the admin account (configured in Clerk dashboard)
//   4. Recovery flow (3-of-5 emails + PIN + auth code) for full lockout
//
// Trade-off vs the previous design: a stolen Clerk session cookie + admin
// email is enough to read HQ. Sensitive mutations still require typed
// confirmation strings + audit log entries. We retain the recovery path
// helper for the (now-unused) IP-aware fast path inside admin_recovery.py.

export default clerkMiddleware(async (_auth, req: NextRequest) => {
  const pathname = req.nextUrl.pathname;

  const res = NextResponse.next();
  if (pathname.startsWith("/embed")) {
    // 2026-07-04 hardening · explicit frame-ancestors instead of
    // deleting the header. The prior "just delete both" strategy
    // relied on the layout CSP + no attacker-side reissue, which
    // is fine in Tauri today but leaks a clickjacking window to
    // any browser that visits an /embed/* URL directly (attacker
    // frames it inside evil.com and reads jwt via postMessage).
    // Setting frame-ancestors to the Tauri origins keeps the
    // desktop working while browsers refuse to iframe the page.
    res.headers.set(
      "content-security-policy",
      "frame-ancestors 'self' tauri://localhost https://tauri.localhost http://tauri.localhost;",
    );
    // CSP frame-ancestors supersedes X-Frame-Options where honoured,
    // and we need to drop the DENY so Tauri actually gets to render.
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
