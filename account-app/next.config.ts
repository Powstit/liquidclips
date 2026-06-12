import path from "node:path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
  // v0.7.55 P0-001 — frame-deny headers moved to src/middleware.ts so
  // per-request control is possible. Next.js merges headers across
  // every matching `source` here, which meant the prior negative-
  // lookahead pattern produced a cascade where DENY still won on
  // /embed/earn. Verified live: account.liquidclips.app/embed/earn was
  // still serving frame-ancestors 'none' + X-Frame-Options: DENY after
  // the v0.7.54 "fix". Middleware now sets the right header per path.
  async redirects() {
    return [
      // v0.7.56 — account-app no longer owns release detection. Every
      // /download* path lands on liquidclips.app/download, the single
      // source of truth for installer URLs.
      //
      // Done at the config level rather than as a server-component
      // redirect() because Next 16 + React 19 streams server-component
      // redirects as a meta-refresh tag in the HTML stream (visible flash
      // of layout chrome before redirect fires). A `redirects()` rule is
      // emitted as a true HTTP 308 from the Edge/Node runtime before any
      // page rendering — zero flash, browser-cached.
      {
        source: "/download",
        destination: "https://liquidclips.app/download",
        permanent: true,
      },
      {
        source: "/download/:path*",
        destination: "https://liquidclips.app/download",
        permanent: true,
      },
    ];
  },
};

// withSentryConfig wraps the build to upload source maps, register the tunnel
// route (so ad-blockers don't drop our error events), and inject release info.
// Source map upload needs SENTRY_AUTH_TOKEN at build time
// (create at sentry.io/settings/auth-tokens/).
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  // Proxy errors through /monitoring to bypass ad-blockers that strip Sentry.
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
});
