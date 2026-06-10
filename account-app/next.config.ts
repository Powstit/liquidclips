import path from "node:path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
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
