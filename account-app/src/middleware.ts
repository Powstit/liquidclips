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
export default clerkMiddleware(async (_auth, req: NextRequest) => {
  const res = NextResponse.next();
  const pathname = req.nextUrl.pathname;
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
