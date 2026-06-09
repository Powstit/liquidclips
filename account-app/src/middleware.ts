// Clerk SDK v7+ requires this middleware for satellite-domain handshake.
// Without it, account.liquidclips.app (satellite) hangs at `isLoaded=false`
// because the __clerk_handshake redirect to account.jnremployee.com (primary)
// never fires. Primary worked without middleware because it has direct cookie
// access; the satellite has to sync from primary via the handshake mechanism
// configured on `<ClerkProvider isSatellite domain signInUrl />` in layout.tsx.
//
// All routes are public — auth happens through `<SignIn />` / `<SignUp />`
// components on the client. We're not protecting any routes here, just
// enabling the handshake.

import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals + static assets.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run on API + trpc routes.
    "/(api|trpc)(.*)",
  ],
};
