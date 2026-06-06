import { clerkMiddleware } from "@clerk/nextjs/server";

// v0.7.x — satellite domain support. clerkMiddleware accepts an `options`
// function which runs per-request and can return per-host config. The
// SAME deployment serves both account.jnremployee.com (primary) and
// account.liquidclips.app (satellite); the host header decides which
// mode this request is in. Sign-in on satellite redirects to primary
// via Clerk.buildSignInUrl; session syncs back via the __clerk_synced
// query param Clerk appends automatically.
const SATELLITE_HOSTS = new Set(["account.liquidclips.app"]);

export default clerkMiddleware(async () => {}, (req) => {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").toLowerCase();
  if (SATELLITE_HOSTS.has(host)) {
    return {
      isSatellite: true,
      domain: host,
      signInUrl: "https://account.jnremployee.com/sign-in",
      signUpUrl: "https://account.jnremployee.com/sign-up",
    };
  }
  return {};
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
