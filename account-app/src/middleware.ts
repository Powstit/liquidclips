import { clerkMiddleware } from "@clerk/nextjs/server";

// v0.7.x — satellite domain support. The SAME deployment serves both
// account.jnremployee.com (primary) and account.liquidclips.app (satellite).
// Satellite config lives in app/layout.tsx (ClerkProvider isSatellite / domain /
// signInUrl / signUpUrl) because it needs server-side host detection via
// headers(). Middleware just enables Clerk on the request path so the
// __clerk_handshake and __clerk_synced flows work correctly.
//
// Clerk v7 note: clerkMiddleware takes a static options object. The previous
// two-argument form (handler + options function) was silently ignored.

export default clerkMiddleware();

export const config = {
  matcher: [
    // Match all routes except static assets we host directly.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always route Clerk's auto-proxy path.
    "/__clerk/(.*)",
    "/(api|trpc)(.*)",
  ],
};
